import asyncio
import importlib
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "aura_test")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
shared = importlib.import_module("couple_shared_api")


def _matches(doc, query):
    for key, expected in query.items():
        if key == "$or":
            if not any(_matches(doc, option) for option in expected):
                return False
            continue
        value = doc.get(key)
        if isinstance(expected, dict):
            if "$in" in expected and value not in expected["$in"]:
                return False
            if "$exists" in expected and (key in doc) != expected["$exists"]:
                return False
            if "$lt" in expected and not (value is not None and value < expected["$lt"]):
                return False
            continue
        if value != expected:
            return False
    return True


class Result:
    def __init__(self, modified_count=0):
        self.modified_count = modified_count


class Cursor:
    def __init__(self, docs):
        self.docs = docs

    async def to_list(self, _limit):
        return [dict(d) for d in self.docs]


class FakeCollection:
    def __init__(self, docs=()):
        self.docs = [dict(d) for d in docs]

    def find(self, query, projection=None):
        return Cursor([d for d in self.docs if _matches(d, query)])

    async def find_one(self, query, projection=None):
        for doc in self.docs:
            if _matches(doc, query):
                return dict(doc)
        return None

    async def insert_one(self, doc):
        self.docs.append(dict(doc))

    async def delete_one(self, query):
        self.docs = [d for d in self.docs if not _matches(d, query)]

    async def update_one(self, query, update):
        for doc in self.docs:
            if _matches(doc, query):
                doc.update(update.get("$set", {}))
                return Result(1)
        return Result(0)

    async def update_many(self, query, update):
        for doc in self.docs:
            if _matches(doc, query):
                doc.update(update.get("$set", {}))


class FakeDB:
    def __init__(self, users, couple_links, accounts, transactions=()):
        self.users = FakeCollection(users)
        self.couple_links = FakeCollection(couple_links)
        self.accounts = FakeCollection(accounts)
        self.transactions = FakeCollection(transactions)


USERS = [
    {"id": "ana", "name": "Ana", "email": "ana@example.com", "status": "active", "currency": "EUR"},
    {"id": "bruno", "name": "Bruno", "email": "bruno@example.com", "status": "active", "currency": "EUR"},
]
ACCOUNTS = [
    {"id": "wallet-ana", "user_id": "ana", "currency": "EUR"},
    {"id": "wallet-bruno", "user_id": "bruno", "currency": "EUR"},
]
ACTIVE_LINK = [{
    "id": "link-1", "requester_id": "ana", "partner_id": "bruno",
    "status": "active", "group_id": "g1",
}]


def _user(uid):
    return next(u for u in USERS if u["id"] == uid)


def _router(db):
    counter = iter(range(1, 10_000))
    notes = []

    async def push(user_id, ntype, title, message, link="", meta=None):
        notes.append({"user_id": user_id, "type": ntype, "message": message})

    router = shared.create_couple_shared_router(
        db=db,
        get_current_user=None,
        push_notification=push,
        fmt_money=lambda amount, currency="EUR": f"€ {amount:.2f}",
        normalize_currency=lambda value, fallback="EUR": value or fallback,
        new_id=lambda: f"id-{next(counter)}",
        now_iso=lambda: "2026-11-20T10:00:00+00:00",
    )
    endpoints = {r.name: r.endpoint for r in router.routes if hasattr(r, "endpoint")}
    return endpoints, notes


def _run(coro):
    return asyncio.run(coro)


def _payload(**changes):
    value = dict(
        description="Jantar",
        amount=50.0,
        date="2026-11-18",
        due_date="2026-12-01",
        account_id="wallet-ana",
    )
    value.update(changes)
    return shared.SharedExpenseIn(**value)


def test_shared_expense_splits_half_and_links_both_sides():
    db = FakeDB(USERS, ACTIVE_LINK, ACCOUNTS)
    ep, notes = _router(db)

    result = _run(ep["create_shared_expense"](_payload(), user=_user("ana")))

    txs = {t["id"]: t for t in db.transactions.docs}
    payer = txs[result["payer_expense_id"]]
    partner = txs[result["partner_expense_id"]]
    receivable = txs[result["receivable_id"]]

    assert payer["amount"] == 25.0 and payer["status"] == "paid"
    assert payer["account_id"] == "wallet-ana" and payer["date"] == "2026-11-18"
    assert partner["amount"] == 25.0 and partner["status"] == "pending"
    assert partner["user_id"] == "bruno" and partner["date"] == "2026-12-01"
    assert receivable["amount"] == 25.0 and receivable["status"] == "pending"
    assert receivable["user_id"] == "ana" and receivable["date"] == "2026-12-01"

    # Os dois lados se referenciam pelos campos de contraparte já usados no app.
    assert partner["counterparty_role"] == "debtor"
    assert receivable["counterparty_role"] == "creditor"
    assert partner["counterparty_transaction_id"] == receivable["id"]
    assert receivable["counterparty_transaction_id"] == partner["id"]
    assert partner["counterparty_link_id"] == receivable["counterparty_link_id"]
    assert {payer["couple_link_id"], partner["couple_link_id"], receivable["couple_link_id"]} == {"link-1"}
    assert {"user_id": "bruno", "type": "couple_shared_expense_added"} in [
        {"user_id": n["user_id"], "type": n["type"]} for n in notes
    ]


def test_odd_cents_are_not_lost():
    db = FakeDB(USERS, ACTIVE_LINK, ACCOUNTS)
    ep, _ = _router(db)

    result = _run(ep["create_shared_expense"](_payload(amount=50.01), user=_user("ana")))

    assert result["partner_share"] == 25.0
    assert result["payer_share"] == 25.01
    assert round(result["partner_share"] + result["payer_share"], 2) == 50.01


def test_shared_expense_requires_active_link():
    db = FakeDB(USERS, [], ACCOUNTS)
    ep, _ = _router(db)

    with pytest.raises(HTTPException) as err:
        _run(ep["create_shared_expense"](_payload(), user=_user("ana")))
    assert err.value.status_code == 409


def test_due_date_cannot_precede_payment():
    db = FakeDB(USERS, ACTIVE_LINK, ACCOUNTS)
    ep, _ = _router(db)

    with pytest.raises(HTTPException) as err:
        _run(ep["create_shared_expense"](_payload(due_date="2026-11-01"), user=_user("ana")))
    assert err.value.status_code == 400


def test_wallet_must_belong_to_payer():
    db = FakeDB(USERS, ACTIVE_LINK, ACCOUNTS)
    ep, _ = _router(db)

    with pytest.raises(HTTPException) as err:
        _run(ep["create_shared_expense"](_payload(account_id="wallet-bruno"), user=_user("ana")))
    assert err.value.status_code == 404


def test_creditor_can_settle_pending_item_on_both_sides():
    db = FakeDB(USERS, ACTIVE_LINK, ACCOUNTS)
    ep, notes = _router(db)
    created = _run(ep["create_shared_expense"](_payload(), user=_user("ana")))

    _run(ep["mark_received"](created["receivable_id"], user=_user("ana")))

    for tid in (created["receivable_id"], created["partner_expense_id"]):
        tx = next(t for t in db.transactions.docs if t["id"] == tid)
        assert tx["status"] == "paid"
        assert tx["counterparty_payment_state"] == "confirmed"
    with pytest.raises(HTTPException) as err:
        _run(ep["mark_received"](created["receivable_id"], user=_user("ana")))
    assert err.value.status_code == 409


def test_only_creditor_can_mark_received():
    db = FakeDB(USERS, ACTIVE_LINK, ACCOUNTS)
    ep, _ = _router(db)
    created = _run(ep["create_shared_expense"](_payload(), user=_user("ana")))

    with pytest.raises(HTTPException) as err:
        _run(ep["mark_received"](created["partner_expense_id"], user=_user("bruno")))
    assert err.value.status_code == 404


def test_overdue_debtor_is_notified_once_and_only_when_still_pending():
    db = FakeDB(USERS, ACTIVE_LINK, ACCOUNTS, transactions=[
        {"id": "late", "user_id": "bruno", "counterparty_role": "debtor",
         "counterparty_payment_state": "pending", "status": "pending",
         "couple_link_id": "link-1", "date": "2020-01-01", "amount": 25.0,
         "currency": "EUR", "description": "Jantar"},
        {"id": "future", "user_id": "bruno", "counterparty_role": "debtor",
         "counterparty_payment_state": "pending", "status": "pending",
         "couple_link_id": "link-1", "date": "2999-01-01", "amount": 25.0,
         "currency": "EUR", "description": "Mercado"},
        {"id": "said-paid", "user_id": "bruno", "counterparty_role": "debtor",
         "counterparty_payment_state": "awaiting_confirmation", "status": "pending",
         "couple_link_id": "link-1", "date": "2020-01-01", "amount": 25.0,
         "currency": "EUR", "description": "Gás"},
    ])
    _, notes = _router(db)
    push_calls = []

    async def push(user_id, ntype, title, message, link="", meta=None):
        push_calls.append((user_id, ntype))

    fmt = lambda amount, currency="EUR": f"€ {amount:.2f}"
    first = _run(shared.notify_overdue_shared_items(db, push, fmt))
    second = _run(shared.notify_overdue_shared_items(db, push, fmt))

    assert first == 1 and second == 0
    assert push_calls == [("bruno", "couple_payment_overdue")]
