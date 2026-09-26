import asyncio
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

os.environ.setdefault("JWT_SECRET", "test-secret-for-wallet-deletion")
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=10")
os.environ.setdefault("DB_NAME", "crelith_wallet_test")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server  # noqa: E402

USER = {"id": "user-1"}


class FakeDB(dict):
    def __getattr__(self, name):
        return self[name]


def fake_db(counts=None, exists=True):
    counts = counts or {}
    db = FakeDB()
    for collection, _ in server.ACCOUNT_REFERENCE_COLLECTIONS:
        db[collection] = SimpleNamespace(count_documents=AsyncMock(return_value=counts.get(collection, 0)))
    db["accounts"] = SimpleNamespace(
        find_one=AsyncMock(return_value={"id": "acc-1"} if exists else None),
        delete_one=AsyncMock(),
    )
    return db


def test_empty_wallet_is_deleted(monkeypatch):
    db = fake_db()
    monkeypatch.setattr(server, "db", db)
    assert asyncio.run(server.delete_account("acc-1", USER)) == {"ok": True}
    db["accounts"].delete_one.assert_awaited_once_with({"id": "acc-1", "user_id": "user-1"})


def test_wallet_with_history_is_kept_and_the_reason_is_explained(monkeypatch):
    db = fake_db({"transactions": 12, "goals": 1})
    monkeypatch.setattr(server, "db", db)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.delete_account("acc-1", USER))
    assert exc.value.status_code == 409
    assert "12 lançamento(s)" in exc.value.detail
    assert "1 meta(s)" in exc.value.detail
    db["accounts"].delete_one.assert_not_awaited()


def test_every_reference_field_is_checked(monkeypatch):
    db = fake_db()
    monkeypatch.setattr(server, "db", db)
    asyncio.run(server.delete_account("acc-1", USER))
    query = db["transactions"].count_documents.await_args.args[0]
    fields = {next(iter(clause)) for clause in query["$or"]}
    assert {"account_id", "from_account_id", "to_account_id"} <= fields


def test_unknown_wallet_is_404(monkeypatch):
    monkeypatch.setattr(server, "db", fake_db(exists=False))
    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.delete_account("nope", USER))
    assert exc.value.status_code == 404
