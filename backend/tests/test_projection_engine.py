from datetime import date

import pytest

from projection_engine import build_projection, projection_window


def convert(doc, _currency):
    return float(doc.get("amount") or 0)


def test_projection_window_rejects_unknown_range():
    with pytest.raises(ValueError):
        projection_window("365d", date(2026, 8, 4))


def test_projection_combines_future_sources_without_paid_activity():
    window = projection_window("7d", date(2026, 8, 4))
    result = build_projection(
        window=window,
        current_balance=1000,
        transactions=[
            {"id": "paid", "type": "expense", "status": "paid", "date": "2026-08-05", "amount": 999},
            {"id": "salary", "type": "income", "status": "pending", "date": "2026-08-05", "amount": 500},
            {"id": "rent", "type": "expense", "status": "pending", "date": "2026-08-06", "amount": 300},
            {"id": "transfer", "type": "transfer", "status": "pending", "date": "2026-08-06", "amount": 200},
        ],
        installments=[
            {"id": "installment", "status": "pending", "due_date": "2026-08-07", "amount": 50},
        ],
        receivables=[
            {"id": "receivable", "status": "pending", "due_date": "2026-08-08", "amount": 100},
        ],
        recurrences=[],
        convert_amount=convert,
        base_currency="EUR",
    )
    assert result["income"] == 600
    assert result["expenses"] == 350
    assert result["projected_balance"] == 1250
    assert result["net_change"] == 250


def test_materialized_recurrence_is_not_counted_twice():
    window = projection_window("30d", date(2026, 8, 4))
    result = build_projection(
        window=window,
        current_balance=0,
        transactions=[{
            "id": "materialized",
            "recurrence_id": "rec-1",
            "type": "expense",
            "status": "pending",
            "date": "2026-08-10",
            "amount": 40,
        }],
        installments=[],
        receivables=[],
        recurrences=[{
            "id": "rec-1",
            "type": "expense",
            "active": True,
            "frequency": "monthly",
            "next_run": "2026-08-10",
            "amount": 40,
        }],
        convert_amount=convert,
        base_currency="EUR",
    )
    assert result["expenses"] == 40
    assert sum(len(day["events"]) for day in result["days"]) == 1


def test_monthly_recurrence_preserves_valid_month_end():
    window = projection_window("90d", date(2026, 1, 30))
    result = build_projection(
        window=window,
        current_balance=200,
        transactions=[],
        installments=[],
        receivables=[],
        recurrences=[{
            "id": "rec-2",
            "type": "expense",
            "active": True,
            "frequency": "monthly",
            "next_run": "2026-01-31",
            "amount": 10,
        }],
        convert_amount=convert,
        base_currency="EUR",
    )
    event_dates = [
        day["date"] for day in result["days"] if day["events"]
    ]
    assert event_dates[:3] == ["2026-01-31", "2026-02-28", "2026-03-28"]
    assert result["projected_balance"] == 160
