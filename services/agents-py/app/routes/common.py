"""Shared route helpers."""
from __future__ import annotations

from fastapi import HTTPException

from ..db.repositories import workspaces


def parse_id(raw: int) -> int:
    if not isinstance(raw, int) or raw <= 0:
        raise HTTPException(status_code=400, detail="Invalid id")
    return raw


async def load_project_or_404(project_id: int) -> dict:
    project = await workspaces.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project
