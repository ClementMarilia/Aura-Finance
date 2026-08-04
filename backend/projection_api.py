"""Authenticated, read-only API for projected cash flow."""

from __future__ import annotations

from datetime import date
from typing import Callable

from fastapi import APIRouter, Depends, HTTPException, Query

from projection_engine import SUPPORTED_RANGES, build_projection, projection_window


def create_projection_router(
    *,
    db,
    get_current_user: Callable,
    load_account_balance_breakdowns: Callable,
    amount_in_currency: Callable,
    normalize_currency: Callable,
) -> APIRouter:
    router = APIRouter(prefix="/api", tags=["projections"])

    @router.get("/projections")
    async def projected_cash_flow(
        range: str = Query(default="30d", max_length=4),
        user=Depends(get_current_user),
    ):
        """Return a projection built exclusively from the authenticated user data."""
        if range not in SUPPORTED_RANGES:
            raise HTTPException(status_code=422, detail="Período de projeção inválido")

        user_id = user["id"]
        base_currency = normalize_currency(user.get("currency"), "EUR")
        window = projection_window(range, date.today())

        # Every private collection is scoped by the authenticated owner. No
        # user_id, account balance or permission is accepted from the client.
        accounts = await db.accounts.find(
            {"user_id": user_id}, {"_id": 0}
        ).to_list(200)
        transactions = await db.transactions.find(
            {
                "user_id": user_id,
                "$or": [
                    {"status": "paid"},
                    {
                        "status": "pending",
                        "date": {
                            "$gte": window.start.isoformat(),
                            "$lte": window.end.isoformat(),
                        },
                    },
                ],
            },
            {"_id": 0},
        ).to_list(20000)
        installments = await db.installments.find(
            {
                "user_id": user_id,
                "$or": [
                    {"status": "paid"},
                    {
                        "status": "pending",
                        "due_date": {
                            "$gte": window.start.isoformat(),
                            "$lte": window.end.isoformat(),
                        },
                    },
                ],
            },
            {"_id": 0},
        ).to_list(20000)
        adjustments = await db.account_adjustments.find(
            {"user_id": user_id}, {"_id": 0}
        ).to_list(10000)
        receivables = await db.receivables.find(
            {
                "user_id": user_id,
                "status": {"$in": ["pending", None]},
                "due_date": {
                    "$gte": window.start.isoformat(),
                    "$lte": window.end.isoformat(),
                },
            },
            {"_id": 0},
        ).to_list(5000)
        recurrences = await db.recurrences.find(
            {"user_id": user_id, "active": True}, {"_id": 0}
        ).to_list(1000)

        breakdowns = await load_account_balance_breakdowns(
            accounts,
            user,
            transactions=transactions,
            installments=installments,
            adjustments=adjustments,
        )
        current_balance = round(sum(
            amount_in_currency(
                {
                    "amount": item.get("current_balance", 0),
                    "currency": item.get("currency", base_currency),
                    "exchange_rates": item.get("exchange_rates", {}),
                    "base_currency_at_creation": item.get("currency", base_currency),
                    "exchange_rate_to_base": 1,
                },
                base_currency,
            )
            for item in breakdowns
        ), 2)

        result = build_projection(
            window=window,
            current_balance=current_balance,
            transactions=transactions,
            installments=installments,
            receivables=receivables,
            recurrences=recurrences,
            convert_amount=amount_in_currency,
            base_currency=base_currency,
        )
        result["currency"] = base_currency
        return result

    return router
