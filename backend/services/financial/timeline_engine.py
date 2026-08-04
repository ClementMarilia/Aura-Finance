"""Pure financial timeline aggregation.

The engine receives documents already scoped to the authenticated owner. It
does not query persistence and does not accept or infer an owner identifier.
"""

from __future__ import annotations

from datetime import date
from typing import Callable, Iterable, Optional

from models.financial_event import FinancialEvent
from projection_engine import advance_recurrence, parse_iso_date

SUPPORTED_EVENT_TYPES = ("income", "expense", "transfer")
SUPPORTED_EVENT_STATUSES = ("paid", "pending", "received", "cancelled")
SUPPORTED_EVENT_SOURCES = ("transaction", "recurrence", "installment", "receivable")


def _text(value: object) -> str:
    return str(value or "").strip()


def _account_ids(item: dict) -> list[str]:
    return list(dict.fromkeys(
        _text(item.get(key))
        for key in ("account_id", "from_account_id", "to_account_id")
        if item.get(key)
    ))


def build_financial_timeline(
    *,
    start: date,
    end: date,
    today: date,
    transactions: Iterable[dict],
    installments: Iterable[dict],
    receivables: Iterable[dict],
    recurrences: Iterable[dict],
    convert_amount: Callable[[dict, str], float],
    base_currency: str,
    account_id: Optional[str] = None,
    category_id: Optional[str] = None,
    event_type: Optional[str] = None,
    status: Optional[str] = None,
    source: Optional[str] = None,
    search: str = "",
) -> dict:
    """Combine all calendar sources into a filtered, de-duplicated timeline."""
    if start > end:
        raise ValueError("invalid timeline window")

    events: list[FinancialEvent] = []
    materialized: set[tuple[str, str]] = set()
    search_term = search.casefold().strip()

    def add(raw: dict) -> None:
        day = parse_iso_date(raw.get("date"))
        if day is None or day < start or day > end:
            return
        accounts = raw.get("account_ids") or _account_ids(raw)
        raw_status = _text(raw.get("status")) or "pending"
        raw_source = _text(raw.get("source"))
        raw_type = _text(raw.get("type"))
        title = _text(raw.get("title") or raw.get("description"))
        if raw_type not in SUPPORTED_EVENT_TYPES:
            return
        if raw_status not in SUPPORTED_EVENT_STATUSES:
            return
        if raw_source not in SUPPORTED_EVENT_SOURCES:
            return
        if account_id and account_id not in accounts:
            return
        if category_id and raw.get("category_id") != category_id:
            return
        if event_type and raw_type != event_type:
            return
        if status and raw_status != status:
            return
        if source and raw_source != source:
            return
        if search_term and search_term not in title.casefold():
            return

        try:
            amount = round(abs(float(convert_amount(raw, base_currency) or 0)), 2)
        except (TypeError, ValueError):
            amount = 0.0
        if amount <= 0:
            return

        events.append(FinancialEvent(
            id=_text(raw.get("event_id") or raw.get("id")),
            source=raw_source,
            type=raw_type,
            date=day.isoformat(),
            title=title,
            amount=amount,
            currency=base_currency,
            status=raw_status,
            account_id=accounts[0] if accounts else None,
            account_ids=accounts,
            category_id=raw.get("category_id"),
            recurrence_id=raw.get("recurrence_id"),
            overdue=raw_status == "pending" and day < today,
            estimated=bool(raw.get("estimated")),
            installment_number=raw.get("installment_number"),
            installment_total=raw.get("installment_total"),
        ))

    for transaction in transactions:
        if transaction.get("receivable_id"):
            # The receivable remains the canonical calendar event after receipt.
            continue
        transaction_day = parse_iso_date(transaction.get("date"))
        recurrence_id = transaction.get("recurrence_id")
        if recurrence_id and transaction_day:
            materialized.add((str(recurrence_id), transaction_day.isoformat()))
        add({
            **transaction,
            "source": "recurrence" if recurrence_id else "transaction",
            "event_id": (
                f"recurrence:{recurrence_id}:{transaction.get('date')}"
                if recurrence_id else f"transaction:{transaction.get('id')}"
            ),
            "title": transaction.get("description") or "",
        })

    for installment in installments:
        add({
            **installment,
            "event_id": f"installment:{installment.get('id')}",
            "source": "installment",
            "type": "expense",
            "date": installment.get("due_date"),
            "title": installment.get("description") or "",
            "installment_number": installment.get("number"),
            "installment_total": installment.get("total"),
        })

    for receivable in receivables:
        add({
            **receivable,
            "event_id": f"receivable:{receivable.get('id')}",
            "source": "receivable",
            "type": "income",
            "date": receivable.get("due_date"),
            "title": receivable.get("description") or receivable.get("person") or "",
            "status": "received" if receivable.get("status") == "received" else "pending",
        })

    for recurrence in recurrences:
        if recurrence.get("active") is not True:
            continue
        next_day = parse_iso_date(recurrence.get("next_run"))
        if next_day is None:
            continue
        guard = 0
        while next_day <= end and guard < 400:
            guard += 1
            marker = (str(recurrence.get("id")), next_day.isoformat())
            if next_day >= start and marker not in materialized:
                add({
                    **recurrence,
                    "event_id": f"recurrence:{recurrence.get('id')}:{next_day.isoformat()}",
                    "source": "recurrence",
                    "date": next_day.isoformat(),
                    "title": recurrence.get("description") or "",
                    "status": "pending",
                    "recurrence_id": recurrence.get("id"),
                    "estimated": True,
                })
            try:
                next_day = advance_recurrence(next_day, str(recurrence.get("frequency")))
            except ValueError:
                break

    events.sort(key=lambda item: (item.date, item.type != "income", item.title.casefold(), item.id))
    serialized = [event.model_dump() for event in events]
    income = round(sum(
        event.amount for event in events
        if event.type == "income" and event.status != "cancelled"
    ), 2)
    expenses = round(sum(
        event.amount for event in events
        if event.type == "expense" and event.status != "cancelled"
    ), 2)
    return {
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "currency": base_currency,
        "events": serialized,
        "summary": {
            "event_count": len(events),
            "income": income,
            "expenses": expenses,
            "net": round(income - expenses, 2),
            "overdue_count": sum(1 for event in events if event.overdue),
        },
    }
