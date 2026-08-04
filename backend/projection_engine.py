"""Pure projected cash-flow calculations.

The engine receives already-authorized, user-scoped financial documents. It
never queries the database and never infers an identity from client input.
"""

from __future__ import annotations

import calendar
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Callable, Iterable, Literal, Optional

ProjectionRange = Literal["today", "7d", "30d", "90d", "12m"]
SUPPORTED_RANGES: tuple[ProjectionRange, ...] = ("today", "7d", "30d", "90d", "12m")


@dataclass(frozen=True)
class ProjectionWindow:
    key: ProjectionRange
    start: date
    end: date


def projection_window(range_key: str, today: Optional[date] = None) -> ProjectionWindow:
    """Resolve an allow-listed range to an inclusive date window."""
    if range_key not in SUPPORTED_RANGES:
        raise ValueError("unsupported projection range")
    start = today or date.today()
    if range_key == "today":
        end = start
    elif range_key == "7d":
        end = start + timedelta(days=6)
    elif range_key == "30d":
        end = start + timedelta(days=29)
    elif range_key == "90d":
        end = start + timedelta(days=89)
    else:
        try:
            end = start.replace(year=start.year + 1) - timedelta(days=1)
        except ValueError:  # February 29
            end = start.replace(year=start.year + 1, day=28) - timedelta(days=1)
    return ProjectionWindow(key=range_key, start=start, end=end)


def parse_iso_date(value: object) -> Optional[date]:
    if not isinstance(value, str):
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def advance_recurrence(day: date, frequency: str) -> date:
    if frequency == "weekly":
        return day + timedelta(days=7)
    months = {
        "monthly": 1,
        "quarterly": 3,
        "semiannual": 6,
        "yearly": 12,
    }.get(frequency)
    if months is None:
        raise ValueError("unsupported recurrence frequency")
    month_index = day.month - 1 + months
    year = day.year + month_index // 12
    month = month_index % 12 + 1
    last_day = calendar.monthrange(year, month)[1]
    return date(year, month, min(day.day, last_day))


def _money(value: object) -> float:
    try:
        return round(float(value or 0), 2)
    except (TypeError, ValueError):
        return 0.0


def build_projection(
    *,
    window: ProjectionWindow,
    current_balance: float,
    transactions: Iterable[dict],
    installments: Iterable[dict],
    receivables: Iterable[dict],
    recurrences: Iterable[dict],
    convert_amount: Callable[[dict, str], float],
    base_currency: str,
) -> dict:
    """Build daily balances from user-scoped documents.

    Paid historical activity belongs to ``current_balance`` and is not counted
    again. Pending future transactions, installments, receivables and active
    recurrences become projection events. Materialized recurrence transactions
    suppress the matching generated recurrence event.
    """
    events_by_day: dict[date, list[dict]] = defaultdict(list)
    materialized_recurrences: set[tuple[str, str]] = set()

    def add_event(day: Optional[date], event: dict) -> None:
        if day is None or day < window.start or day > window.end:
            return
        amount = round(abs(_money(event.get("amount"))), 2)
        if amount <= 0:
            return
        events_by_day[day].append({**event, "amount": amount})

    for tx in transactions:
        tx_day = parse_iso_date(tx.get("date"))
        recurrence_id = tx.get("recurrence_id")
        if recurrence_id and tx_day:
            materialized_recurrences.add((str(recurrence_id), tx_day.isoformat()))
        if tx.get("status") != "pending" or tx.get("type") == "transfer":
            continue
        tx_type = tx.get("type")
        if tx_type not in {"income", "expense"}:
            continue
        add_event(tx_day, {
            "id": tx.get("id"),
            "source": "transaction",
            "type": tx_type,
            "description": tx.get("description") or "",
            "amount": convert_amount(tx, base_currency),
            "account_id": tx.get("account_id"),
        })

    for installment in installments:
        if installment.get("status") != "pending":
            continue
        add_event(parse_iso_date(installment.get("due_date") or installment.get("date")), {
            "id": installment.get("id"),
            "source": "installment",
            "type": "expense",
            "description": installment.get("description") or "",
            "amount": convert_amount(installment, base_currency),
            "account_id": installment.get("account_id"),
        })

    for receivable in receivables:
        if receivable.get("status") not in {None, "pending"}:
            continue
        add_event(parse_iso_date(receivable.get("due_date")), {
            "id": receivable.get("id"),
            "source": "receivable",
            "type": "income",
            "description": receivable.get("description") or receivable.get("person") or "",
            "amount": convert_amount(receivable, base_currency),
            "account_id": receivable.get("account_id"),
        })

    for recurrence in recurrences:
        if recurrence.get("active") is not True:
            continue
        recurrence_type = recurrence.get("type")
        if recurrence_type not in {"income", "expense"}:
            continue
        next_day = parse_iso_date(recurrence.get("next_run"))
        if next_day is None:
            continue
        guard = 0
        while next_day <= window.end and guard < 400:
            guard += 1
            marker = (str(recurrence.get("id")), next_day.isoformat())
            if next_day >= window.start and marker not in materialized_recurrences:
                add_event(next_day, {
                    "id": f"recurrence:{recurrence.get('id')}:{next_day.isoformat()}",
                    "source": "recurrence",
                    "type": recurrence_type,
                    "description": recurrence.get("description") or "",
                    "amount": convert_amount(recurrence, base_currency),
                    "account_id": recurrence.get("account_id"),
                    "estimated": True,
                })
            try:
                next_day = advance_recurrence(next_day, str(recurrence.get("frequency")))
            except ValueError:
                break

    running_balance = round(float(current_balance), 2)
    total_income = 0.0
    total_expense = 0.0
    days: list[dict] = []
    cursor = window.start
    while cursor <= window.end:
        day_events = sorted(
            events_by_day.get(cursor, []),
            key=lambda item: (item["type"] != "income", item.get("source", ""), item.get("id") or ""),
        )
        income = round(sum(e["amount"] for e in day_events if e["type"] == "income"), 2)
        expense = round(sum(e["amount"] for e in day_events if e["type"] == "expense"), 2)
        running_balance = round(running_balance + income - expense, 2)
        total_income = round(total_income + income, 2)
        total_expense = round(total_expense + expense, 2)
        days.append({
            "date": cursor.isoformat(),
            "income": income,
            "expense": expense,
            "balance": running_balance,
            "events": day_events,
        })
        cursor += timedelta(days=1)

    return {
        "range": window.key,
        "start_date": window.start.isoformat(),
        "end_date": window.end.isoformat(),
        "current_balance": round(float(current_balance), 2),
        "projected_balance": running_balance,
        "income": total_income,
        "expenses": total_expense,
        "net_change": round(total_income - total_expense, 2),
        "days": days,
    }
