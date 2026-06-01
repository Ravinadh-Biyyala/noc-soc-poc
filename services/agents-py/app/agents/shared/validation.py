"""SQL validators — defence-in-depth port of `src/agents/shared/validation.ts`
plus `assertMeasureFormula` from the metric-architect executor.

These run on every model-generated SQL string BEFORE it reaches Postgres.
"""
from __future__ import annotations

import re
from typing import Literal, Sequence

TransformationDdlKind = Literal["table", "view"]


class SqlValidationError(ValueError):
    """Raised when generated SQL fails a guardrail."""


_SELECT_ONLY = re.compile(r"^\s*(WITH\s|SELECT\s)", re.IGNORECASE)
_FORBIDDEN = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|GRANT|REVOKE|CREATE|MERGE|COPY|VACUUM|ANALYZE)\b",
    re.IGNORECASE,
)


def assert_select_only(sql: str) -> None:
    if not _SELECT_ONLY.search(sql):
        raise SqlValidationError("Only SELECT (or WITH ... SELECT) statements are allowed.")
    if _FORBIDDEN.search(sql):
        raise SqlValidationError(
            "SQL contains a forbidden DDL/DML keyword. Only SELECT is allowed."
        )


_SCHEMA_REF = re.compile(
    r'(?:"([a-z0-9_]+)"|([a-z0-9_]+))\s*\.\s*(?:"[a-z0-9_]+"|[a-z0-9_]+)',
    re.IGNORECASE,
)


def assert_schema_scope(sql: str, allowed_schemas: Sequence[str]) -> None:
    allowed = {s.lower() for s in allowed_schemas}
    for m in _SCHEMA_REF.finditer(sql):
        schema = (m.group(1) or m.group(2) or "").lower()
        if schema and schema not in allowed:
            raise SqlValidationError(
                f'SQL references schema "{schema}" which is not allowed for this project. '
                f"Allowed: {', '.join(allowed)}."
            )


_TRANSFORM_ALLOWED = re.compile(
    r"^\s*CREATE\s+(OR\s+REPLACE\s+)?(VIEW|TABLE|MATERIALIZED\s+VIEW)\s+", re.IGNORECASE
)
_TRANSFORM_DESTRUCTIVE = re.compile(
    r"\bDROP\b|\bDELETE\b|\bTRUNCATE\b|\bGRANT\b|\bREVOKE\b|\bALTER\b", re.IGNORECASE
)
_TRANSFORM_HEAD = re.compile(
    r'CREATE\s+(OR\s+REPLACE\s+)?(VIEW|TABLE|MATERIALIZED\s+VIEW)\s+"?([a-z0-9_]+)"?\s*\.\s*"?[a-z0-9_]+"?',
    re.IGNORECASE,
)


def ddl_kind_for_transformation(kind: str) -> TransformationDdlKind:
    k = kind.lower()
    if k in ("cleanse", "join", "rename"):
        return "table"
    return "view"


def assert_transformation_sql(
    sql: str, warehouse_schema: str, expected_ddl: TransformationDdlKind | None = None
) -> None:
    if not _TRANSFORM_ALLOWED.search(sql):
        raise SqlValidationError(
            "Transformation SQL must start with CREATE [OR REPLACE] VIEW / TABLE / MATERIALIZED VIEW."
        )
    if _TRANSFORM_DESTRUCTIVE.search(sql):
        raise SqlValidationError("Transformation SQL contains a forbidden destructive keyword.")

    head = _TRANSFORM_HEAD.search(sql)
    if not head:
        raise SqlValidationError(
            f'Transformation SQL must use a fully-qualified target like "{warehouse_schema}"."my_view".'
        )
    kind_token = head.group(2).upper()
    ddl: TransformationDdlKind = (
        "view" if (kind_token.startswith("VIEW") or "MATERIALIZED" in kind_token) else "table"
    )
    if head.group(3).lower() != warehouse_schema.lower():
        raise SqlValidationError(
            f'Transformation must target schema "{warehouse_schema}", got "{head.group(3)}".'
        )
    if expected_ddl and ddl != expected_ddl:
        raise SqlValidationError(
            f"This transformation should produce a {expected_ddl.upper()} (per its kind), "
            f"but the SQL creates a {ddl.upper()}."
        )


_NORMALIZE_HEAD = re.compile(
    r"^(\s*)CREATE\s+(OR\s+REPLACE\s+)?(VIEW|TABLE|MATERIALIZED\s+VIEW)(\s+)", re.IGNORECASE
)


def normalize_transformation_ddl(sql: str, expected_ddl: TransformationDdlKind) -> str:
    match = _NORMALIZE_HEAD.search(sql)
    if not match:
        return sql
    leading = match.group(1)
    kind = match.group(3)
    current_ddl: TransformationDdlKind = "view" if "VIEW" in kind.upper() else "table"
    if current_ddl == expected_ddl:
        return sql

    replacement = (
        f"{leading}CREATE OR REPLACE VIEW " if expected_ddl == "view" else f"{leading}CREATE TABLE "
    )
    rewritten = sql.replace(match.group(0), replacement, 1)

    if not re.search(r"\bAS\s+SELECT", rewritten, re.IGNORECASE) and re.search(
        r"\bSELECT\b", rewritten, re.IGNORECASE
    ):
        rewritten = re.sub(r"\)\s*SELECT", ") AS SELECT", rewritten, count=1, flags=re.IGNORECASE)
        rewritten = re.sub(r'"\s+SELECT', '" AS SELECT', rewritten, count=1, flags=re.IGNORECASE)
    return rewritten


_FORBIDDEN_IN_FORMULA = re.compile(
    r"\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|MERGE|COPY|VACUUM|ANALYZE|BEGIN|COMMIT|ROLLBACK)\b",
    re.IGNORECASE,
)
_LOOKS_LIKE_EXPR = re.compile(r'[A-Z_]+\(|"\w+"|\w+\.\w+', re.IGNORECASE)


def assert_measure_formula(formula: str) -> None:
    if not formula or not isinstance(formula, str):
        raise SqlValidationError("sqlFormula is required.")
    if ";" in formula:
        raise SqlValidationError(
            "sqlFormula must be an expression, not a statement. Semicolons are forbidden."
        )
    if _FORBIDDEN_IN_FORMULA.search(formula):
        raise SqlValidationError(
            "sqlFormula contains a forbidden statement keyword (CREATE/ALTER/INSERT/...). "
            "Measures are runtime expressions, not statements."
        )
    if not _LOOKS_LIKE_EXPR.search(formula):
        raise SqlValidationError("sqlFormula does not look like a SQL expression.")
