"""Row mappers: DB snake_case -> the camelCase JSON shape the frontend expects.

The Express routes returned Drizzle row objects whose property names are
camelCase (e.g. `targetTableName`, `createdAt`). psycopg gives us snake_case
column names, so we map explicitly here to preserve the API contract
byte-for-byte. Timestamps become ISO strings.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any


def _iso(value: Any) -> Any:
    return value.isoformat() if isinstance(value, datetime) else value


def transformation(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "projectId": row["project_id"],
        "kind": row["kind"],
        "title": row["title"],
        "description": row["description"],
        "sourceTables": row["source_tables"] or [],
        "sql": row["sql"],
        "targetTableName": row["target_table_name"],
        "status": row["status"],
        "agentRationale": row["agent_rationale"],
        "createdAt": _iso(row["created_at"]),
        "appliedAt": _iso(row["applied_at"]),
    }


def semantic_model(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "workspaceId": row["workspace_id"],
        "status": row["status"],
        "graphDefinition": row["graph_definition"],
        "agentRationale": row["agent_rationale"],
        "createdAt": _iso(row["created_at"]),
        "updatedAt": _iso(row["updated_at"]),
    }


def metric(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "workspaceId": row["workspace_id"],
        "metricName": row["metric_name"],
        "description": row["description"],
        "sqlFormula": row["sql_formula"],
        "dependsOnTables": row["depends_on_tables"] or [],
        "status": row["status"],
        "agentRationale": row["agent_rationale"],
        "createdAt": _iso(row["created_at"]),
    }
