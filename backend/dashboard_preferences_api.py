"""Per-user, validated dashboard widget preferences."""

from __future__ import annotations

from typing import Callable

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

DASHBOARD_WIDGETS = (
    "balance_summary",
    "balance",
    "income",
    "expense",
    "pending_payable",
    "receivable",
    "future_installments",
    "fixed_monthly",
    "accounts",
    "evolution",
    "categories",
    "insights",
    "projection",
    "budget",
)
DASHBOARD_WIDGET_SET = frozenset(DASHBOARD_WIDGETS)


class DashboardPreferencesIn(BaseModel):
    widgets: list[str] = Field(max_length=len(DASHBOARD_WIDGETS))


def normalize_dashboard_widgets(value) -> list[str]:
    """Return a safe configuration, falling back for missing legacy data."""
    if not isinstance(value, list):
        return list(DASHBOARD_WIDGETS)
    return [widget for widget in DASHBOARD_WIDGETS if widget in value]


def create_dashboard_preferences_router(
    *,
    db,
    get_current_user: Callable,
    prefix: str = "/api",
) -> APIRouter:
    router = APIRouter(prefix=prefix, tags=["dashboard-preferences"])

    @router.get("/dashboard/preferences")
    async def get_dashboard_preferences(user=Depends(get_current_user)):
        stored = await db.users.find_one(
            {"id": user["id"]},
            {"_id": 0, "dashboard_widgets": 1},
        )
        return {
            "widgets": normalize_dashboard_widgets(
                (stored or {}).get("dashboard_widgets")
            ),
            "available_widgets": list(DASHBOARD_WIDGETS),
            "version": 1,
        }

    @router.put("/dashboard/preferences")
    async def set_dashboard_preferences(
        body: DashboardPreferencesIn,
        user=Depends(get_current_user),
    ):
        if len(body.widgets) != len(set(body.widgets)):
            raise HTTPException(status_code=422, detail="Widgets duplicados")
        unknown = sorted(set(body.widgets) - DASHBOARD_WIDGET_SET)
        if unknown:
            raise HTTPException(status_code=422, detail="Widget de dashboard inválido")

        clean = normalize_dashboard_widgets(body.widgets)
        await db.users.update_one(
            {"id": user["id"]},
            {"$set": {"dashboard_widgets": clean}},
        )
        return {
            "widgets": clean,
            "available_widgets": list(DASHBOARD_WIDGETS),
            "version": 1,
        }

    return router
