from datetime import date

from services.financial.timeline_engine import build_financial_timeline


def convert(document, _currency):
    return float(document.get("amount") or 0)


def build(**overrides):
    values = {
        "start": date(2026, 8, 1),
        "end": date(2026, 8, 31),
        "today": date(2026, 8, 4),
        "transactions": [],
        "installments": [],
        "receivables": [],
        "recurrences": [],
        "convert_amount": convert,
        "base_currency": "EUR",
    }
    values.update(overrides)
    return build_financial_timeline(**values)


def test_timeline_combines_sources_and_marks_overdue_events():
    result = build(
        transactions=[{
            "id": "tx-1", "type": "expense", "status": "pending",
            "date": "2026-08-02", "amount": 40, "description": "Energia",
        }],
        installments=[{
            "id": "inst-1", "status": "paid", "due_date": "2026-08-08",
            "amount": 25, "description": "Notebook", "number": 2, "total": 10,
        }],
        receivables=[{
            "id": "recv-1", "status": "received", "due_date": "2026-08-10",
            "amount": 100, "person": "Ana",
        }],
    )

    assert [event["source"] for event in result["events"]] == [
        "transaction", "installment", "receivable",
    ]
    assert result["events"][0]["overdue"] is True
    assert result["events"][1]["installment_number"] == 2
    assert result["summary"] == {
        "event_count": 3,
        "income": 100.0,
        "expenses": 65.0,
        "net": 35.0,
        "overdue_count": 1,
    }


def test_timeline_does_not_duplicate_materialized_recurrence():
    result = build(
        transactions=[{
            "id": "tx-1", "recurrence_id": "rec-1", "type": "expense",
            "status": "pending", "date": "2026-08-12", "amount": 20,
        }],
        recurrences=[{
            "id": "rec-1", "type": "expense", "active": True,
            "frequency": "monthly", "next_run": "2026-08-12", "amount": 20,
        }],
    )

    assert len(result["events"]) == 1
    assert result["events"][0]["id"] == "recurrence:rec-1:2026-08-12"


def test_timeline_filters_account_category_type_status_source_and_search():
    matching = {
        "id": "matching", "type": "income", "status": "pending",
        "date": "2026-08-20", "amount": 80, "description": "Cliente Alfa",
        "account_id": "account-1", "category_id": "category-1",
    }
    other = {
        "id": "other", "type": "expense", "status": "paid",
        "date": "2026-08-21", "amount": 20, "description": "Mercado",
        "account_id": "account-2", "category_id": "category-2",
    }
    result = build(
        transactions=[matching, other],
        account_id="account-1",
        category_id="category-1",
        event_type="income",
        status="pending",
        source="transaction",
        search="alfa",
    )

    assert [event["id"] for event in result["events"]] == ["transaction:matching"]


def test_received_transaction_is_hidden_in_favor_of_canonical_receivable():
    result = build(
        transactions=[{
            "id": "received-tx", "receivable_id": "recv-1", "type": "income",
            "status": "paid", "date": "2026-08-10", "amount": 100,
        }],
        receivables=[{
            "id": "recv-1", "status": "received", "due_date": "2026-08-08",
            "amount": 100, "description": "Pagamento cliente",
        }],
    )

    assert len(result["events"]) == 1
    assert result["events"][0]["id"] == "receivable:recv-1"


def test_cancelled_events_remain_visible_without_affecting_totals():
    result = build(transactions=[{
        "id": "cancelled", "type": "expense", "status": "cancelled",
        "date": "2026-08-11", "amount": 90, "description": "Cancelada",
    }])

    assert result["summary"]["event_count"] == 1
    assert result["summary"]["expenses"] == 0
    assert result["summary"]["net"] == 0
