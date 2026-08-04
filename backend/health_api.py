"""Authenticated API for the deterministic financial-health score."""

from __future__ import annotations

import calendar
from collections import defaultdict
from datetime import date
from typing import Callable

from fastapi import APIRouter, Depends

from projection_engine import build_projection, projection_window
from services.financial.health_engine import build_health_score


def _month_start(value: date, offset: int = 0) -> date:
    month_index = value.year * 12 + value.month - 1 + offset
    return date(month_index // 12, month_index % 12 + 1, 1)


def _same_elapsed_day(value: date, offset: int) -> date:
    target = _month_start(value, offset)
    last_day = calendar.monthrange(target.year, target.month)[1]
    return target.replace(day=min(value.day, last_day))


def create_health_router(
    *,
    db,
    get_current_user: Callable,
    load_account_balance_breakdowns: Callable,
    amount_in_currency: Callable,
    normalize_currency: Callable,
    prefix: str = "/api",
) -> APIRouter:
    router = APIRouter(prefix=prefix, tags=["financial-health"])

    @router.get("/financial-health")
    async def financial_health(user=Depends(get_current_user)):
        """Score only the authenticated owner's normalized financial data."""
        today = date.today()
        user_id = user["id"]
        base_currency = normalize_currency(user.get("currency"), "EUR")
        current_start = today.replace(day=1)
        previous_start = _month_start(today, -1)
        previous_end = _same_elapsed_day(today, -1)
        history_start = _month_start(today, -3)
        projection = projection_window("30d", today)

        accounts = await db.accounts.find(
            {"user_id": user_id}, {"_id": 0}
        ).to_list(200)
        account_currencies = {
            account["id"]: normalize_currency(account.get("currency"), base_currency)
            for account in accounts
        }
        transactions = await db.transactions.find(
            {
                "user_id": user_id,
                "status": {"$ne": "cancelled"},
                "$or": [
                    {"date": {
                        "$gte": history_start.isoformat(),
                        "$lte": projection.end.isoformat(),
                    }},
                    {
                        "type": "expense",
                        "status": "pending",
                        "date": {"$lt": today.isoformat()},
                    },
                ],
            },
            {"_id": 0},
        ).to_list(20000)
        installments = await db.installments.find(
            {
                "user_id": user_id,
                "status": {"$ne": "cancelled"},
                "$or": [
                    {"due_date": {
                        "$gte": history_start.isoformat(),
                        "$lte": projection.end.isoformat(),
                    }},
                    {"status": "pending", "due_date": {"$lt": today.isoformat()}},
                ],
            },
            {"_id": 0},
        ).to_list(20000)
        receivables = await db.receivables.find(
            {
                "user_id": user_id,
                "status": {"$in": ["pending", None]},
                "due_date": {
                    "$gte": today.isoformat(),
                    "$lte": projection.end.isoformat(),
                },
            },
            {"_id": 0},
        ).to_list(5000)
        recurrences = await db.recurrences.find(
            {"user_id": user_id, "active": True}, {"_id": 0}
        ).to_list(1000)
        goals = await db.goals.find(
            {"user_id": user_id}, {"_id": 0}
        ).to_list(500)
        categories = await db.categories.find(
            {"user_id": user_id}, {"_id": 0}
        ).to_list(500)

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

        def converted(document: dict, _target_currency: str | None = None) -> float:
            """Convert a financial document to the authenticated user's base currency.

            ``build_projection`` supplies the target currency as its second
            callback argument.  The health endpoint always uses ``base_currency``
            resolved from the authenticated user, so the explicit callback value
            is intentionally ignored while keeping the shared engine contract.
            """
            enriched = dict(document)
            if not enriched.get("currency"):
                enriched["currency"] = account_currencies.get(
                    enriched.get("account_id"), base_currency
                )
            return round(amount_in_currency(enriched, base_currency), 2)

        breakdowns = await load_account_balance_breakdowns(accounts, user)
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

        paid_transactions = [
            item for item in transactions
            if item.get("status") == "paid" and item.get("type") in {"income", "expense"}
        ]
        paid_installments = [
            item for item in enriched_installments if item.get("status") == "paid"
        ]
        monthly_income = round(sum(
            converted(item) for item in paid_transactions
            if item.get("type") == "income" and current_start.isoformat() <= item.get("date", "") <= today.isoformat()
        ), 2)
        monthly_expense = round(
            sum(
                converted(item) for item in paid_transactions
                if item.get("type") == "expense" and current_start.isoformat() <= item.get("date", "") <= today.isoformat()
            )
            + sum(
                converted(item) for item in paid_installments
                if current_start.isoformat() <= item.get("due_date", "") <= today.isoformat()
            ),
            2,
        )

        monthly_history = defaultdict(float)
        for item in paid_transactions:
            item_date = item.get("date", "")
            if item.get("type") == "expense" and history_start.isoformat() <= item_date < current_start.isoformat():
                monthly_history[item_date[:7]] += converted(item)
        for item in paid_installments:
            item_date = item.get("due_date", "")
            if history_start.isoformat() <= item_date < current_start.isoformat():
                monthly_history[item_date[:7]] += converted(item)
        history_values = [
            monthly_history[_month_start(today, offset).strftime("%Y-%m")]
            for offset in (-3, -2, -1)
        ]
        comparable_history = [value for value in history_values if value > 0]
        average_monthly_expense = (
            round(sum(comparable_history) / len(comparable_history), 2)
            if len(comparable_history) >= 2 else None
        )

        category_names = {
            item["id"]: item.get("name") or "Outros" for item in categories
        }
        current_categories = defaultdict(float)
        previous_categories = defaultdict(float)
        for item in paid_transactions:
            if item.get("type") != "expense" or not item.get("category_id"):
                continue
            item_date = item.get("date", "")
            if current_start.isoformat() <= item_date <= today.isoformat():
                current_categories[item["category_id"]] += converted(item)
            elif previous_start.isoformat() <= item_date <= previous_end.isoformat():
                previous_categories[item["category_id"]] += converted(item)
        for item in paid_installments:
            category_id = item.get("category_id")
            if not category_id:
                continue
            item_date = item.get("due_date", "")
            if current_start.isoformat() <= item_date <= today.isoformat():
                current_categories[category_id] += converted(item)
            elif previous_start.isoformat() <= item_date <= previous_end.isoformat():
                previous_categories[category_id] += converted(item)

        overspending = []
        for category_id, current_amount in current_categories.items():
            previous_amount = previous_categories.get(category_id, 0)
            if previous_amount < 20:
                continue
            variation = ((current_amount - previous_amount) / previous_amount) * 100
            if variation >= 15 and current_amount - previous_amount >= 10:
                overspending.append({
                    "category_id": category_id,
                    "category": category_names.get(category_id, "Outros"),
                    "current_amount": round(current_amount, 2),
                    "previous_amount": round(previous_amount, 2),
                    "variation": round(variation, 1),
                })
        overspending.sort(key=lambda item: item["variation"], reverse=True)

        overdue_transactions = [
            item for item in transactions
            if item.get("type") == "expense"
            and item.get("status") == "pending"
            and item.get("date", "") < today.isoformat()
        ]
        overdue_installments = [
            item for item in enriched_installments
            if item.get("status") == "pending" and item.get("due_date", "") < today.isoformat()
        ]
        overdue_count = len(overdue_transactions) + len(overdue_installments)
        overdue_amount = round(
            sum(converted(item) for item in overdue_transactions)
            + sum(converted(item) for item in overdue_installments),
            2,
        )

        projection_result = build_projection(
            window=projection,
            current_balance=current_balance,
            transactions=transactions,
            installments=enriched_installments,
            receivables=receivables,
            recurrences=recurrences,
            convert_amount=converted,
            base_currency=base_currency,
        )
        normalized_goals = [
            {
                **goal,
                "target_amount": amount_in_currency(
                    {**goal, "amount": goal.get("target_amount", 0)}, base_currency
                ),
                "current_amount": amount_in_currency(
                    {**goal, "amount": goal.get("current_amount", 0)}, base_currency
                ),
            }
            for goal in goals
        ]

        result = build_health_score(
            current_balance=current_balance,
            projected_balance=projection_result["projected_balance"],
            monthly_income=monthly_income,
            monthly_expense=monthly_expense,
            average_monthly_expense=average_monthly_expense,
            goals=normalized_goals,
            overdue_count=overdue_count,
            overdue_amount=overdue_amount,
            overspending_categories=overspending,
            category_comparison_available=bool(previous_categories),
            currency=base_currency,
        )
        result["period"] = {
            "start": current_start.isoformat(),
            "end": today.isoformat(),
            "projection_end": projection.end.isoformat(),
        }
        return result

    return router
