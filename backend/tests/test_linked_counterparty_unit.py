import asyncio
import importlib
import os
import sys
from pathlib import Path


os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "aura_test")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

app_module = importlib.import_module("app")
linked = importlib.import_module("linked_counterparty")


def test_linked_mutation_routes_are_installed_once():
    app = app_module.app

    def count(path, method):
        return sum(
            1
            for route in app.router.routes
            if getattr(route, "path", None) == path
            and method in (getattr(route, "methods", set()) or set())
        )

    assert count("/api/transactions", "POST") == 1
    assert count("/api/transactions/{tid}", "PUT") == 1
    assert count("/api/transactions/{tid}", "DELETE") == 1
    assert count("/api/transactions/{tid}/pay", "POST") == 1
    assert count("/api/transactions/bulk-delete", "POST") == 1
    assert count("/api/transactions/{tid}/reject-payment", "POST") == 1


def test_only_pending_person_expenses_are_mirrored():
    assert linked._is_linkable_expense({
        "type": "expense",
        "status": "pending",
        "person_id": "person-1",
    })
    assert not linked._is_linkable_expense({
        "type": "expense",
        "status": "paid",
        "person_id": "person-1",
    })
    assert not linked._is_linkable_expense({
        "type": "income",
        "status": "pending",
        "person_id": "person-1",
    })
    assert not linked._is_linkable_expense({
        "type": "expense",
        "status": "pending",
        "person_id": None,
    })


def test_mirror_is_income_and_does_not_reuse_private_wallet_or_category():
    source = {
        "type": "expense",
        "date": "2026-09-15",
        "amount": 30.30,
        "category_id": "private-category",
        "account_id": "private-wallet",
        "person_id": "contact",
        "description": "Roupas Primark",
        "notes": "",
        "status": "pending",
        "currency": "EUR",
        "exchange_rates": {"EUR": 1.0, "BRL": 6.4},
        "rate_date": "2026-09-15",
        "rate_source": "automatic",
    }
    mirror = linked._mirror_values(
        source,
        {"id": "debtor", "currency": "EUR"},
        {"id": "creditor", "currency": "EUR"},
    )

    assert mirror["type"] == "income"
    assert mirror["status"] == "pending"
    assert mirror["amount"] == 30.30
    assert mirror["person_id"] == "debtor"
    assert mirror["category_id"] is None
    assert mirror["account_id"] is None
    assert mirror["description"] == "Roupas Primark"


class FakeTransactions:
    def __init__(self, docs):
        self.docs = docs

    async def find_one(self, query, projection=None):
        for doc in self.docs:
            if all(doc.get(key) == value for key, value in query.items()):
                return dict(doc)
        return None

    async def update_many(self, query, update):
        for doc in self.docs:
            if all(doc.get(key) == value for key, value in query.items()):
                doc.update(update.get("$set", {}))

    async def update_one(self, query, update):
        for doc in self.docs:
            if all(doc.get(key) == value for key, value in query.items()):
                doc.update(update.get("$set", {}))


class FakeDb:
    def __init__(self, docs):
        self.transactions = FakeTransactions(docs)


def test_debtor_requests_confirmation_and_creditor_confirms(monkeypatch):
    docs = [
        {
            "id": "expense-1",
            "user_id": "debtor",
            "type": "expense",
            "status": "pending",
            "amount": 84.30,
            "currency": "EUR",
            "counterparty_link_id": "link-1",
            "counterparty_transaction_id": "income-1",
            "counterparty_user_id": "creditor",
            "counterparty_role": "debtor",
            "counterparty_payment_state": "pending",
        },
        {
            "id": "income-1",
            "user_id": "creditor",
            "type": "income",
            "status": "pending",
            "amount": 84.30,
            "currency": "EUR",
            "counterparty_link_id": "link-1",
            "counterparty_transaction_id": "expense-1",
            "counterparty_user_id": "debtor",
            "counterparty_role": "creditor",
            "counterparty_payment_state": "pending",
        },
    ]
    notifications = []

    async def fake_push(user_id, kind, title, message, link, data):
        notifications.append((user_id, kind, data))

    monkeypatch.setattr(linked.core, "db", FakeDb(docs))
    monkeypatch.setattr(linked.core, "push_notification", fake_push)

    result = asyncio.run(linked.toggle_transaction_payment(
        "expense-1",
        user={"id": "debtor", "name": "Marilia", "currency": "EUR"},
    ))
    assert result["confirmation_pending"] is True
    assert all(
        doc["counterparty_payment_state"] == "awaiting_confirmation"
        for doc in docs
    )
    assert all(doc["status"] == "pending" for doc in docs)
    assert notifications[-1][0] == "creditor"
    assert notifications[-1][1] == "linked_payment_confirmation_requested"

    result = asyncio.run(linked.toggle_transaction_payment(
        "income-1",
        user={"id": "creditor", "name": "Nathalia", "currency": "EUR"},
    ))
    assert result["confirmed"] is True
    assert all(doc["counterparty_payment_state"] == "confirmed" for doc in docs)
    assert all(doc["status"] == "paid" for doc in docs)
    assert notifications[-1][0] == "debtor"
    assert notifications[-1][1] == "linked_payment_confirmed"


def test_creditor_can_reject_payment(monkeypatch):
    docs = [
        {
            "id": "expense-1",
            "user_id": "debtor",
            "status": "pending",
            "counterparty_link_id": "link-1",
            "counterparty_transaction_id": "income-1",
            "counterparty_user_id": "creditor",
            "counterparty_role": "debtor",
            "counterparty_payment_state": "awaiting_confirmation",
        },
        {
            "id": "income-1",
            "user_id": "creditor",
            "status": "pending",
            "counterparty_link_id": "link-1",
            "counterparty_transaction_id": "expense-1",
            "counterparty_user_id": "debtor",
            "counterparty_role": "creditor",
            "counterparty_payment_state": "awaiting_confirmation",
        },
    ]
    notifications = []

    async def fake_push(user_id, kind, title, message, link, data):
        notifications.append((user_id, kind))

    monkeypatch.setattr(linked.core, "db", FakeDb(docs))
    monkeypatch.setattr(linked.core, "push_notification", fake_push)

    result = asyncio.run(linked.reject_linked_payment(
        "income-1",
        user={"id": "creditor", "name": "Nathalia"},
    ))

    assert result["rejected"] is True
    assert all(doc["status"] == "pending" for doc in docs)
    assert all(doc["counterparty_payment_state"] == "rejected" for doc in docs)
    assert notifications[-1] == ("debtor", "linked_payment_rejected")
