import asyncio
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

os.environ.setdefault("JWT_SECRET", "test-secret-for-tx-receivables")
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=10")
os.environ.setdefault("DB_NAME", "crelith_tx_receivables_test")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server  # noqa: E402

USER = {"id": "user-1", "currency": "EUR"}


def matches(doc, query):
    for key, cond in query.items():
        value = doc.get(key)
        if isinstance(cond, dict):
            if "$ne" in cond and value == cond["$ne"]:
                return False
            if "$lt" in cond and not value < cond["$lt"]:
                return False
            if "$gte" in cond and not value >= cond["$gte"]:
                return False
        elif value != cond:
            return False
    return True


class FakeCollection:
    def __init__(self, docs):
        self.docs = docs

    def find(self, query=None, projection=None):
        found = [dict(d) for d in self.docs if matches(d, query or {})]
        return SimpleNamespace(to_list=AsyncMock(return_value=found))


def receivable(rid, due, status="pending", **extra):
    return {"id": rid, "user_id": "user-1", "person": "Wendy", "description": "Celular",
            "amount": 73.0, "due_date": due, "status": status, "currency": "EUR", **extra}


def list_tx(monkeypatch, receivables, **params):
    db = SimpleNamespace(
        transactions=FakeCollection([]),
        installments=FakeCollection([]),
        installment_purchases=FakeCollection([]),
        receivables=FakeCollection(receivables),
    )
    monkeypatch.setattr(server, "db", db)
    monkeypatch.setattr(server, "materialize_recurrences", AsyncMock())
    monkeypatch.setattr(server, "account_currency_map", AsyncMock(return_value={}))
    kwargs = {"year": 2026, "month": 10, "category_id": None, "status": None,
              "type": None, "account_id": None, "currency": None, "include_carryover": True}
    kwargs.update(params)
    return asyncio.run(server.list_transactions(user=USER, **kwargs))


def test_pending_receivable_shows_up_as_income(monkeypatch):
    rows = list_tx(monkeypatch, [receivable("r1", "2026-10-15")])
    assert len(rows) == 1
    row = rows[0]
    assert row["id"] == "r1"
    assert row["source"] == "receivable"
    assert row["type"] == "income"
    assert row["status"] == "pending"
    assert row["amount"] == 73.0
    assert row["editable"] is False
    assert row["description"] == "Wendy - Celular"


def test_only_this_month_and_overdue_are_listed(monkeypatch):
    rows = list_tx(monkeypatch, [
        receivable("old", "2026-09-10"),
        receivable("now", "2026-10-15"),
        receivable("later", "2026-11-15"),
    ])
    by_id = {r["id"]: r for r in rows}
    assert set(by_id) == {"old", "now"}
    assert by_id["old"]["overdue"] is True
    assert by_id["now"]["overdue"] is False


def test_carryover_off_hides_overdue(monkeypatch):
    rows = list_tx(monkeypatch, [receivable("old", "2026-09-10"), receivable("now", "2026-10-15")],
                   include_carryover=False)
    assert [r["id"] for r in rows] == ["now"]


def test_received_receivable_is_not_duplicated(monkeypatch):
    # A received item already exists as a real income transaction.
    rows = list_tx(monkeypatch, [receivable("r1", "2026-10-15", status="received")])
    assert rows == []


def test_expense_paid_and_category_filters_exclude_receivables(monkeypatch):
    items = [receivable("r1", "2026-10-15")]
    assert list_tx(monkeypatch, items, type="expense") == []
    assert list_tx(monkeypatch, items, status="paid") == []
    assert list_tx(monkeypatch, items, category_id="cat-1") == []
    assert len(list_tx(monkeypatch, items, type="income", status="pending")) == 1


def test_account_and_currency_filters_apply(monkeypatch):
    items = [receivable("a", "2026-10-15", account_id="acc-1"),
             receivable("b", "2026-10-16", account_id="acc-2", currency="USD")]
    assert [r["id"] for r in list_tx(monkeypatch, items, account_id="acc-1")] == ["a"]
    assert [r["id"] for r in list_tx(monkeypatch, items, currency="USD")] == ["b"]
