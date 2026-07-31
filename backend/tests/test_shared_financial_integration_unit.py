import asyncio
import importlib
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest


os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "aura_test")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
server = importlib.import_module("server")


def shared_expense(**overrides):
    expense = {
        "id": "shared-1",
        "creator_id": "marilia",
        "payer_id": "marilia",
        "account_id": "wallet-1",
        "title": "Mercado",
        "amount": 100,
        "date": "2026-07-31",
        "category_id": "food",
        "notes": "Compra da casa",
        "currency": "EUR",
        "exchange_rate_to_base": 1,
    }
    expense.update(overrides)
    return expense


def transaction_db(existing=None):
    return SimpleNamespace(
        transactions=SimpleNamespace(
            find_one=AsyncMock(return_value=existing),
            insert_one=AsyncMock(),
            update_one=AsyncMock(),
            delete_many=AsyncMock(),
        ),
    )


def test_shared_expense_creates_one_linked_wallet_transaction(monkeypatch):
    fake_db = transaction_db()
    monkeypatch.setattr(server, "db", fake_db)

    result = asyncio.run(server.sync_shared_expense_transaction(
        shared_expense(),
        {"id": "marilia", "currency": "EUR"},
    ))

    inserted = fake_db.transactions.insert_one.await_args.args[0]
    assert result["id"] == inserted["id"]
    assert inserted["type"] == "expense"
    assert inserted["amount"] == 100
    assert inserted["account_id"] == "wallet-1"
    assert inserted["shared_expense_id"] == "shared-1"
    assert inserted["source"] == "shared_expense"
    assert inserted["editable"] is False
    fake_db.transactions.update_one.assert_not_awaited()


def test_shared_expense_updates_existing_link_instead_of_duplicating(monkeypatch):
    existing = {
        "id": "tx-linked",
        "user_id": "marilia",
        "shared_expense_id": "shared-1",
        "amount": 100,
    }
    fake_db = transaction_db(existing)
    monkeypatch.setattr(server, "db", fake_db)

    result = asyncio.run(server.sync_shared_expense_transaction(
        shared_expense(amount=125, title="Mercado e limpeza"),
        {"id": "marilia", "currency": "EUR"},
    ))

    assert result["id"] == "tx-linked"
    assert result["amount"] == 125
    update = fake_db.transactions.update_one.await_args.args[1]["$set"]
    assert update["description"] == "Mercado e limpeza"
    assert update["amount"] == 125
    fake_db.transactions.insert_one.assert_not_awaited()


def test_unlinked_shared_expense_never_changes_wallet(monkeypatch):
    fake_db = transaction_db()
    monkeypatch.setattr(server, "db", fake_db)

    result = asyncio.run(server.sync_shared_expense_transaction(
        shared_expense(account_id=None),
        {"id": "marilia", "currency": "EUR"},
    ))

    assert result is None
    fake_db.transactions.delete_many.assert_awaited_once_with({
        "shared_expense_id": "shared-1",
        "user_id": "marilia",
    })
    fake_db.transactions.insert_one.assert_not_awaited()


def test_only_payer_can_link_own_wallet(monkeypatch):
    accounts = SimpleNamespace(find_one=AsyncMock())
    monkeypatch.setattr(server, "db", SimpleNamespace(accounts=accounts))

    with pytest.raises(server.HTTPException) as exc:
        asyncio.run(server.validate_shared_expense_account(
            "wallet-of-someone-else",
            "nathalia",
            {"id": "marilia", "currency": "EUR"},
            "EUR",
        ))

    assert exc.value.status_code == 400
    accounts.find_one.assert_not_awaited()


def test_wallet_currency_must_match_shared_expense(monkeypatch):
    accounts = SimpleNamespace(find_one=AsyncMock(return_value={
        "id": "wallet-1",
        "user_id": "marilia",
        "currency": "BRL",
    }))
    monkeypatch.setattr(server, "db", SimpleNamespace(accounts=accounts))

    with pytest.raises(server.HTTPException) as exc:
        asyncio.run(server.validate_shared_expense_account(
            "wallet-1",
            "marilia",
            {"id": "marilia", "currency": "EUR"},
            "EUR",
        ))

    assert exc.value.status_code == 400
    assert "moeda" in exc.value.detail


def test_foreign_creators_category_is_not_copied_to_payers_private_ledger(monkeypatch):
    fake_db = transaction_db()
    monkeypatch.setattr(server, "db", fake_db)

    asyncio.run(server.sync_shared_expense_transaction(
        shared_expense(creator_id="nathalia"),
        {"id": "marilia", "currency": "EUR"},
    ))

    inserted = fake_db.transactions.insert_one.await_args.args[0]
    assert inserted["category_id"] is None


def test_linked_transaction_cannot_be_deleted_outside_shared_expense(monkeypatch):
    transactions = SimpleNamespace(
        find_one=AsyncMock(return_value={
            "id": "tx-linked",
            "user_id": "marilia",
            "shared_expense_id": "shared-1",
        }),
        delete_one=AsyncMock(),
    )
    monkeypatch.setattr(server, "db", SimpleNamespace(transactions=transactions))

    with pytest.raises(server.HTTPException) as exc:
        asyncio.run(server.delete_transaction(
            "tx-linked",
            user={"id": "marilia"},
        ))

    assert exc.value.status_code == 409
    transactions.delete_one.assert_not_awaited()
