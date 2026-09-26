import asyncio
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

os.environ.setdefault("JWT_SECRET", "test-secret-for-receivables")
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=10")
os.environ.setdefault("DB_NAME", "crelith_receivable_test")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server  # noqa: E402

USER = {"id": "user-1", "currency": "EUR"}


def db_for(receivable, claim_ok=True):
    return SimpleNamespace(
        receivables=SimpleNamespace(
            find_one=AsyncMock(return_value=dict(receivable)),
            update_one=AsyncMock(return_value=SimpleNamespace(modified_count=1 if claim_ok else 0, matched_count=1)),
            find_one_and_update=AsyncMock(return_value=dict(receivable)),
        ),
        transactions=SimpleNamespace(insert_one=AsyncMock(), delete_one=AsyncMock(), update_one=AsyncMock()),
    )


def receive(rid, received=None):
    body = server.ReceiveIn(received=received) if received is not None else None
    return asyncio.run(server.receive_receivable(rid, body, USER))


def test_receiving_creates_one_income(monkeypatch):
    db = db_for({"id": "r", "status": "pending", "amount": 100, "person": "Ana"})
    monkeypatch.setattr(server, "db", db)
    assert receive("r", True)["status"] == "received"
    db.transactions.insert_one.assert_awaited_once()
    claim = db.receivables.update_one.await_args.args[0]
    assert claim["status"] == {"$ne": "received"}


def test_a_second_tap_while_the_first_is_in_flight_creates_nothing(monkeypatch):
    # The row still reads "pending" but another request already claimed it.
    db = db_for({"id": "r", "status": "pending", "amount": 100}, claim_ok=False)
    monkeypatch.setattr(server, "db", db)
    assert receive("r", True)["status"] == "received"
    db.transactions.insert_one.assert_not_awaited()


def test_explicit_target_is_idempotent(monkeypatch):
    db = db_for({"id": "r", "status": "received", "amount": 100, "received_tx_id": "tx"})
    monkeypatch.setattr(server, "db", db)
    assert receive("r", True)["status"] == "received"
    db.transactions.insert_one.assert_not_awaited()
    db.transactions.delete_one.assert_not_awaited()


def test_undo_removes_the_income(monkeypatch):
    db = db_for({"id": "r", "status": "received", "amount": 100, "received_tx_id": "tx-1"})
    monkeypatch.setattr(server, "db", db)
    assert receive("r", False)["status"] == "pending"
    db.transactions.delete_one.assert_awaited_once_with({"id": "tx-1", "user_id": "user-1"})


def test_legacy_toggle_without_body_still_works(monkeypatch):
    db = db_for({"id": "r", "status": "pending", "amount": 100})
    monkeypatch.setattr(server, "db", db)
    assert receive("r")["status"] == "received"


def test_editing_a_received_item_updates_its_income(monkeypatch):
    db = db_for({"id": "r", "status": "received", "amount": 150, "received_tx_id": "tx-1"})
    monkeypatch.setattr(server, "db", db)
    monkeypatch.setattr(server, "account_currency_map", AsyncMock(return_value={"acc-2": "EUR"}))
    monkeypatch.setattr(server, "monetary_metadata", AsyncMock(return_value={"currency": "EUR"}))
    payload = server.ReceivableIn(person="Ana", amount=150, due_date="2026-09-01", account_id="acc-2")
    asyncio.run(server.update_receivable("r", payload, USER))
    query, update = db.transactions.update_one.await_args.args
    assert query == {"id": "tx-1", "user_id": "user-1"}
    assert update["$set"]["amount"] == 150 and update["$set"]["account_id"] == "acc-2"
