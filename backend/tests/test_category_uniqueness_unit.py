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


def _matches(document, query):
    for key, expected in query.items():
        actual = document.get(key)
        if isinstance(expected, dict) and "$ne" in expected:
            if actual == expected["$ne"]:
                return False
        elif actual != expected:
            return False
    return True


class AsyncCursor:
    def __init__(self, documents):
        self.documents = documents

    def __aiter__(self):
        self._iterator = iter(self.documents)
        return self

    async def __anext__(self):
        try:
            return next(self._iterator)
        except StopIteration:
            raise StopAsyncIteration


class CategoryCollection:
    def __init__(self, documents=None):
        self.documents = [copy.deepcopy(doc) for doc in (documents or [])]

    def find(self, query, *_args, **_kwargs):
        return AsyncCursor([
            copy.deepcopy(doc)
            for doc in self.documents
            if _matches(doc, query)
        ])

    async def find_one(self, query, *_args, **_kwargs):
        return next((
            copy.deepcopy(doc)
            for doc in self.documents
            if _matches(doc, query)
        ), None)

    async def insert_one(self, document):
        name_key = document.get("name_key")
        if name_key and any(
            existing.get("user_id") == document.get("user_id")
            and existing.get("name_key") == name_key
            for existing in self.documents
        ):
            raise DuplicateKeyError("duplicate category name")
        self.documents.append(copy.deepcopy(document))
        return SimpleNamespace(inserted_id="category-1")

    async def update_one(self, query, update):
        for document in self.documents:
            if not _matches(document, query):
                continue
            candidate = {**document, **copy.deepcopy(update.get("$set", {}))}
            name_key = candidate.get("name_key")
            if name_key and any(
                existing is not document
                and existing.get("user_id") == candidate.get("user_id")
                and existing.get("name_key") == name_key
                for existing in self.documents
            ):
                raise DuplicateKeyError("duplicate category name")
            document.update(copy.deepcopy(update.get("$set", {})))
            return SimpleNamespace(matched_count=1)
        return SimpleNamespace(matched_count=0)


def test_category_name_key_ignores_case_accents_and_spacing():
    assert server.category_display_name("  Café   da   manhã ") == "Café da manhã"
    assert server.category_name_key("  Café   da   manhã ") == "cafe da manha"
    assert server.category_name_key("CAFE DA MANHA") == "cafe da manha"


def test_create_rejects_equivalent_name_for_same_user(monkeypatch):
    categories = CategoryCollection([{
        "id": "cat-1",
        "user_id": "user-1",
        "name": "Mercado",
    }])
    monkeypatch.setattr(server, "db", SimpleNamespace(categories=categories))

    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.create_category(
            server.CategoryIn(name="  MÉRCADO  "),
            user={"id": "user-1"},
            idempotency_key=None,
        ))

    assert exc.value.status_code == 409
    assert exc.value.detail == "Já existe uma categoria com esse nome"
    assert len(categories.documents) == 1


def test_same_category_name_is_allowed_for_different_users(monkeypatch):
    categories = CategoryCollection([{
        "id": "cat-1",
        "user_id": "user-1",
        "name": "Mercado",
        "name_key": "mercado",
    }])
    monkeypatch.setattr(server, "db", SimpleNamespace(categories=categories))

    created = asyncio.run(server.create_category(
        server.CategoryIn(name="Mercado"),
        user={"id": "user-2"},
        idempotency_key=None,
    ))

    assert created["name"] == "Mercado"
    assert "name_key" not in created
    assert categories.documents[1]["name_key"] == "mercado"
    assert len(categories.documents) == 2


def test_rename_to_existing_category_is_rejected(monkeypatch):
    categories = CategoryCollection([
        {"id": "cat-1", "user_id": "user-1", "name": "Mercado"},
        {"id": "cat-2", "user_id": "user-1", "name": "Viagem"},
    ])
    monkeypatch.setattr(server, "db", SimpleNamespace(categories=categories))

    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.update_category(
            "cat-2",
            server.CategoryIn(name=" mercado "),
            user={"id": "user-1"},
        ))

    assert exc.value.status_code == 409
    assert categories.documents[1]["name"] == "Viagem"


def test_legacy_duplicate_can_still_be_edited_without_data_loss(monkeypatch):
    categories = CategoryCollection([
        {"id": "cat-1", "user_id": "user-1", "name": "Mercado", "color": "#111111"},
        {"id": "cat-2", "user_id": "user-1", "name": "MERCADO", "color": "#222222"},
    ])
    monkeypatch.setattr(server, "db", SimpleNamespace(categories=categories))

    result = asyncio.run(server.update_category(
        "cat-2",
        server.CategoryIn(name="MERCADO", color="#333333"),
        user={"id": "user-1"},
    ))

    assert result == {"ok": True}
    assert categories.documents[1]["color"] == "#333333"
    assert "name_key" not in categories.documents[1]
