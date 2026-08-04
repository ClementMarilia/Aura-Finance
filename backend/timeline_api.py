"""Authenticated, read-only API for the financial calendar."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Callable, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from services.financial.timeline_engine import (
    SUPPORTED_EVENT_SOURCES,
    SUPPORTED_EVENT_STATUSES,
    SUPPORTED_EVENT_TYPES,
    build_financial_timeline,
)


MAX_CALENDAR_DAYS = 366


def _parse_date(value: str, field: str) -> date:
    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"{field} inválida") from exc


def create_timeline_router(
    *,
    db,
    get_current_user: Callable,
    amount_in_currency: Callable,
    normalize_currency: Callable,
) -> APIRouter:
    router = APIRouter(prefix="/api", tags=["calendar"])

    @router.get("/calendar")
    async def financial_calendar(
        start_date: Optional[str] = Query(default=None, max_length=10),
        end_date: Optional[str] = Query(default=None, max_length=10),
        account_id: Optional[str] = Query(default=None, max_length=120),
        category_id: Optional[str] = Query(default=None, max_length=120),
        type: Optional[str] = Query(default=None, max_length=20),
        status: Optional[str] = Query(default=None, max_length=20),
        source: Optional[str] = Query(default=None, max_length=20),
        search: str = Query(default="", max_length=120),
        user=Depends(get_current_user),
    ):
        """Return a filtered timeline built only from the authenticated owner."""
        today = date.today()
        start = _parse_date(start_date, "Data inicial") if start_date else today.replace(day=1)
        end = _parse_date(end_date, "Data final") if end_date else (
            start.replace(day=28) + timedelta(days=4)
        ).replace(day=1) - timedelta(days=1)

        if start > end:
            raise HTTPException(status_code=422, detail="A data inicial deve ser anterior à data final")
        if (end - start).days >= MAX_CALENDAR_DAYS:
            raise HTTPException(status_code=422, detail="O período máximo do calendário é de 366 dias")
        if type and type not in SUPPORTED_EVENT_TYPES:
            raise HTTPException(status_code=422, detail="Tipo de evento inválido")
        if status and status not in SUPPORTED_EVENT_STATUSES:
            raise HTTPException(status_code=422, detail="Status de evento inválido")
        if source and source not in SUPPORTED_EVENT_SOURCES:
            raise HTTPException(status_code=422, detail="Origem de evento inválida")

        user_id = user["id"]
        base_currency = normalize_currency(user.get("currency"), "EUR")
        date_range = {"$gte": start.isoformat(), "$lte": end.isoformat()}

        # All database reads are owner-scoped. Identity is never accepted from
        # query parameters, and this read-only endpoint never materializes data.
        transactions = await db.transactions.find(
            {"user_id": user_id, "date": date_range}, {"_id": 0}
        ).to_list(20000)
        installments = await db.installments.find(
            {"user_id": user_id, "due_date": date_range}, {"_id": 0}
        ).to_list(20000)
        receivables = await db.receivables.find(
            {"user_id": user_id, "due_date": date_range}, {"_id": 0}
        ).to_list(5000)
        recurrences = await db.recurrences.find(
            {"user_id": user_id, "active": True}, {"_id": 0}
        ).to_list(1000)

        purchase_ids = list({
            item.get("purchase_id") for item in installments if item.get("purchase_id")
        })
        purchases = await db.installment_purchases.find(
            {"user_id": user_id, "id": {"$in": purchase_ids}}, {"_id": 0}
        ).to_list(len(purchase_ids) or 1)
        purchases_by_id = {item["id"]: item for item in purchases}
        enriched_installments = [
            {**purchases_by_id.get(item.get("purchase_id"), {}), **item}
            for item in installments
        ]

        return build_financial_timeline(
            start=start,
            end=end,
            today=today,
            transactions=transactions,
            installments=enriched_installments,
            receivables=receivables,
            recurrences=recurrences,
            convert_amount=amount_in_currency,
            base_currency=base_currency,
            account_id=account_id,
            category_id=category_id,
            event_type=type,
            status=status,
            source=source,
            search=search,
        )

    return router
