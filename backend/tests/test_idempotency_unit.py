import asyncio
import copy
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError


os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault(
    "MONGO_URL",
    "mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=10",
)
os.environ.setdefault("DB_NAME", "crelith_finance_test")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server  # noqa: E402


class IdempotencyCollection:
    def __init__(self):
        self.documents = {}

    @staticmethod
    def _key(document):
        return (
            document["operation"],
            document["owner_id"],
            document["key"],
        )

    async def insert_one(self, document):
        key = self._key(document)
        if key in self.documents:
            raise DuplicateKeyError("duplicate idempotency key")
        self.documents[key] = copy.deepcopy(document)
        return SimpleNamespace(inserted_id="claim-1")

    async def find_one(self, query, *_args, **_kwargs):
        document = self.documents.get(self._key(query))
        return copy.deepcopy(document) if document else None

    async def update_one(self, query, update):
        key = self._key(query)
        document = self.documents.get(key)
        if document:
            document.update(copy.deepcopy(update.get("$set", {})))
        return SimpleNamespace(matched_count=int(document is not None))

    async def delete_one(self, query):
        key = self._key(query)
        deleted = self.documents.pop(key, None)
        return SimpleNamespace(deleted_count=int(deleted is not None))


def test_same_request_returns_original_response(monkeypatch):
    collection = IdempotencyCollection()
    monkeypatch.setattr(
        server,
        "db",
        SimpleNamespace(idempotency_requests=collection),
    )
    calls = 0

    async def create():
        nonlocal calls
        calls += 1
        return {"id": "record-1", "amount": 25}

    async def scenario():
        first = await server.run_idempotent_create(
            "create_transaction", "user-1", "request-key-0001",
            {"amount": 25}, create,
        )
        second = await server.run_idempotent_create(
            "create_transaction", "user-1", "request-key-0001",
            {"amount": 25}, create,
        )
        return first, second

    first, second = asyncio.run(scenario())

    assert calls == 1
    assert first == second == {"id": "record-1", "amount": 25}


def test_same_key_cannot_be_reused_with_different_payload(monkeypatch):
    collection = IdempotencyCollection()
    monkeypatch.setattr(
        server,
        "db",
        SimpleNamespace(idempotency_requests=collection),
    )

    async def create():
        return {"id": "record-1"}

    async def scenario():
        await server.run_idempotent_create(
            "create_transaction", "user-1", "request-key-0002",
            {"amount": 25}, create,
        )
        await server.run_idempotent_create(
            "create_transaction", "user-1", "request-key-0002",
            {"amount": 30}, create,
        )

    with pytest.raises(HTTPException) as exc:
        asyncio.run(scenario())

    assert exc.value.status_code == 409


def test_failed_request_releases_key_for_retry(monkeypatch):
    collection = IdempotencyCollection()
    monkeypatch.setattr(
        server,
        "db",
        SimpleNamespace(idempotency_requests=collection),
    )
    attempts = 0

    async def create():
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise RuntimeError("temporary database failure")
        return {"id": "record-2"}

    async def scenario():
        with pytest.raises(RuntimeError):
            await server.run_idempotent_create(
                "create_account", "user-1", "request-key-0003",
                {"name": "Principal"}, create,
            )
        return await server.run_idempotent_create(
            "create_account", "user-1", "request-key-0003",
            {"name": "Principal"}, create,
        )

    result = asyncio.run(scenario())

    assert attempts == 2
    assert result == {"id": "record-2"}
