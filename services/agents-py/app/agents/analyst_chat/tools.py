"""Analyst Chat tools — strictly read-only (single execute_warehouse_query)."""
from __future__ import annotations

import logging

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from ...db.introspection import execute_warehouse_query
from ..shared.serde import dumps

log = logging.getLogger("agents.analyst_chat")


class ExecuteQueryArgs(BaseModel):
    sql: str = Field(
        description="Fully-qualified SELECT. All table references must use the project's "
                    "warehouse schema. No DDL or DML."
    )


def make_analyst_chat_tools(project_id: int) -> list[StructuredTool]:
    async def execute_warehouse_query_tool(sql: str) -> str:
        log.info("analyst-chat tool execute_warehouse_query project=%s", project_id)
        try:
            return dumps(await execute_warehouse_query(project_id, sql))
        except Exception as err:  # noqa: BLE001
            return dumps({"error": str(err)})

    return [
        StructuredTool.from_function(
            coroutine=execute_warehouse_query_tool,
            name="execute_warehouse_query",
            args_schema=ExecuteQueryArgs,
            description="Run a SELECT (or WITH ... SELECT) against the project's warehouse schema. "
                        "Read-only. Returns up to 200 rows as JSON.",
        )
    ]
