"""applyTransformation — transactional DDL with recursive upstream-dependency
auto-apply. Direct port of `data-engineer/executor.ts::applyTransformation`.

Used both by the agent's execute_transformation tool and directly by the
/transformations/:tid/accept route.
"""
from __future__ import annotations

import re
from typing import Any

from ...db.repositories import transformations as repo
from ...db.schemas import warehouse_schema
from ..shared.validation import (
    SqlValidationError,
    assert_transformation_sql,
    ddl_kind_for_transformation,
    normalize_transformation_ddl,
)

_CREATE_OR_REPLACE_VIEW = re.compile(r"\bCREATE\s+OR\s+REPLACE\s+VIEW\b", re.IGNORECASE)


async def apply_transformation(project_id: int, transformation_id: int, _depth: int = 0) -> dict[str, Any]:
    if _depth > 5:
        return {"error": "Dependency chain too deep — possible cycle in proposed transformations."}

    row = await repo.get_raw(project_id, transformation_id)
    if not row:
        return {"error": f"Transformation {transformation_id} not found in project {project_id}"}
    if row["status"] == "applied":
        return {"status": "applied", "targetTable": row["target_table_name"]}

    warehouse = warehouse_schema(project_id)
    dependencies_applied: list[str] = []

    for src in (row["source_tables"] or []):
        parts = str(src).split(".")
        src_schema = ".".join(parts[:-1]) if len(parts) > 1 else None
        table_name = parts[-1]

        if src_schema and "_raw" in src_schema.lower():
            continue
        if src_schema and src_schema.lower() == "raw":
            continue

        is_warehouse = (
            not src_schema
            or src_schema.lower() == warehouse.lower()
            or src_schema.lower() == "warehouse"
        )
        if not is_warehouse:
            continue

        if await repo.warehouse_table_exists(project_id, table_name):
            continue

        producer = await repo.find_producer(project_id, table_name)
        if not producer:
            continue

        if producer["status"] == "proposed":
            await repo.update_status_by_id(producer["id"], "accepted")
        dep_result = await apply_transformation(project_id, producer["id"], _depth + 1)
        if "error" in dep_result:
            return {"error": f'Dependency "{table_name}" failed to apply: {dep_result["error"]}'}
        dependencies_applied.append(table_name)

    expected_ddl = ddl_kind_for_transformation(row["kind"])
    normalized_sql = normalize_transformation_ddl(row["sql"], expected_ddl)
    try:
        assert_transformation_sql(normalized_sql, warehouse, expected_ddl)
    except SqlValidationError as err:
        return {"error": str(err)}

    # Even after DROP TABLE, Postgres refuses CREATE OR REPLACE VIEW where a table
    # once stood; plain CREATE VIEW always works after the DROP.
    exec_sql = _CREATE_OR_REPLACE_VIEW.sub("CREATE VIEW", normalized_sql, count=1)

    err = await repo.run_create(project_id, row["target_table_name"], exec_sql)
    if err:
        return {"error": err}
    await repo.set_applied(transformation_id, normalized_sql)

    result: dict[str, Any] = {"status": "applied", "targetTable": row["target_table_name"], "ddl": expected_ddl}
    if dependencies_applied:
        result["dependenciesApplied"] = dependencies_applied
    return result
