import asyncio
import copy
import importlib
import os
import sys
from pathlib import Path
from types import SimpleNamespace


os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "aura_test")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
server = importlib.import_module("server")


class UpdateResult:
    def __init__(self, matched_count):
        self.matched_count = matched_count


class SharedExpensesCollection:
    def __init__(self, expense):
        self.expense = copy.deepcopy(expense)

    async def find_one(self, query, *args, **kwargs):
        if query.get("id") == self.expense["id"]:
            return copy.deepcopy(self.expense)
        return None

    async def update_one(self, query, update, **kwargs):
        if query.get("id") != self.expense["id"]:
            return UpdateResult(0)
        participant_query = query.get("participants", {}).get("$elemMatch")
        if participant_query:
            if self.expense.get("status") == "finalized":
                return UpdateResult(0)
            target = next(
                (
                    item
                    for item in self.expense["participants"]
                    if item["user_id"] == participant_query["user_id"]
                    and item.get("paid_back") is not True
                ),
                None,
            )
            if not target:
                return UpdateResult(0)
            target["paid_back"] = True
        else:
            self.expense.update(copy.deepcopy(update.get("$set", {})))
        return UpdateResult(1)

    def find(self, *args, **kwargs):
        return StaticCursor([self.expense])


class SettlementHistoryCollection:
    def __init__(self, items=None):
        self.items = copy.deepcopy(items or [])

    async def update_one(self, query, update, upsert=False):
        existing = next(
            (
                item
                for item in self.items
                if item.get("expense_id") == query.get("expense_id")
                and item.get("debtor_id") == query.get("debtor_id")
            ),
            None,
        )
        if existing:
            return UpdateResult(1)
        if upsert:
            self.items.append(copy.deepcopy(update["$setOnInsert"]))
        return UpdateResult(0)

    async def update_many(self, query, update):
        for item in self.items:
            if item.get("expense_id") == query.get("expense_id"):
                item.update(copy.deepcopy(update.get("$set", {})))
        return UpdateResult(len(self.items))


class StaticCursor:
    def __init__(self, items):
        self.items = copy.deepcopy(items)
        self.position = 0

    async def to_list(self, _limit):
        return copy.deepcopy(self.items)

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self.position >= len(self.items):
            raise StopAsyncIteration
        item = copy.deepcopy(self.items[self.position])
        self.position += 1
        return item


class StaticCollection:
    def __init__(self, items):
        self.items = items

    def find(self, *args, **kwargs):
        return StaticCursor(self.items)


def expense_fixture():
    return {
        "id": "expense-1",
        "title": "Mercado mensal",
        "date": "2026-07-20",
        "category": "Mercado",
        "notes": "Compra da casa",
        "payer_id": "wendy",
        "participant_ids": ["wendy", "marilia", "nathalia"],
        "participants": [
            {"user_id": "wendy", "owed": 30, "paid_back": False},
            {"user_id": "marilia", "owed": 30, "paid_back": False},
            {"user_id": "nathalia", "owed": 30, "paid_back": False},
        ],
        "currency": "EUR",
        "status": "open",
    }


def test_status_only_finalizes_after_every_real_debt_is_paid():
    expense = expense_fixture()
    assert server.shared_expense_status(expense) == "open"
    expense["participants"][1]["paid_back"] = True
    assert server.shared_expense_status(expense) == "partial"
    expense["participants"][2]["paid_back"] = True
    assert server.shared_expense_status(expense) == "finalized"


def test_confirmation_finalizes_and_records_each_payment_once(monkeypatch):
    shared = SharedExpensesCollection(expense_fixture())
    history = SettlementHistoryCollection()
    monkeypatch.setattr(
        server,
        "db",
        SimpleNamespace(shared_expenses=shared, settlement_history=history),
    )

    first, first_changed = asyncio.run(
        server.confirm_shared_participant(shared.expense, "marilia")
    )
    second, second_changed = asyncio.run(
        server.confirm_shared_participant(first, "nathalia")
    )
    repeated, repeated_changed = asyncio.run(
        server.confirm_shared_participant(second, "nathalia")
    )

    assert first_changed is True
    assert first["status"] == "partial"
    assert second_changed is True
    assert second["status"] == "finalized"
    assert repeated_changed is False
    assert repeated["status"] == "finalized"
    assert len(history.items) == 2
    assert {item["debtor_id"] for item in history.items} == {"marilia", "nathalia"}
    assert all(item["expense_status"] == "finalized" for item in history.items)
    assert all(item["category"] == "Mercado" for item in history.items)


def test_backfill_repairs_legacy_paid_expense_without_history(monkeypatch):
    expense = expense_fixture()
    expense["status"] = "partial"
    expense["participants"][1]["paid_back"] = True
    expense["participants"][2]["paid_back"] = True
    shared = SharedExpensesCollection(expense)
    history = SettlementHistoryCollection()
    monkeypatch.setattr(
        server,
        "db",
        SimpleNamespace(shared_expenses=shared, settlement_history=history),
    )

    repaired = asyncio.run(server.backfill_shared_settlement_history())

    assert repaired == 2
    assert shared.expense["status"] == "finalized"
    assert len(history.items) == 2
    assert all(item["expense_status"] == "finalized" for item in history.items)


def test_search_normalization_matches_names_without_accents():
    assert server.normalized_search_text("Marília") == "marilia"
    assert server.normalized_search_text("Observação") == "observacao"


def history_call(**overrides):
    params = {
        "user": {"id": "marilia", "language": "pt"},
        "search": None,
        "specific_date": None,
        "month": None,
        "year": None,
        "start_date": None,
        "end_date": None,
        "sort": "recent",
        "limit": 1000,
    }
    params.update(overrides)
    return asyncio.run(server.settlement_history(**params))


def test_history_filters_search_period_and_sort(monkeypatch):
    history = [
        {
            "id": "history-1",
            "expense_id": "expense-1",
            "expense_title": "Café com clientes",
            "debtor_id": "marilia",
            "creditor_id": "wendy",
            "amount": 12,
            "paid_at": "2026-07-12T10:00:00+00:00",
        },
        {
            "id": "history-2",
            "expense_id": "expense-2",
            "expense_title": "Mercado",
            "debtor_id": "nathalia",
            "creditor_id": "marilia",
            "amount": 80,
            "paid_at": "2025-12-20T10:00:00+00:00",
        },
    ]
    users = [
        {"id": "marilia", "name": "Marília", "email": "marilia@example.com", "status": "active"},
        {"id": "wendy", "name": "Wendy", "email": "wendy@example.com", "status": "active"},
        {"id": "nathalia", "name": "Nathalia", "email": "nathalia@example.com", "status": "active"},
    ]
    expenses = [
        {
            "id": "expense-1",
            "title": "Café com clientes",
            "date": "2026-07-10",
            "category": "Alimentação",
            "notes": "Reunião mensal",
            "currency": "EUR",
            "status": "finalized",
        },
        {
            "id": "expense-2",
            "title": "Mercado",
            "date": "2025-12-18",
            "category": "Casa",
            "notes": "",
            "currency": "EUR",
            "status": "finalized",
        },
    ]
    monkeypatch.setattr(
        server,
        "db",
        SimpleNamespace(
            settlement_history=StaticCollection(history),
            users=StaticCollection(users),
            shared_expenses=StaticCollection(expenses),
        ),
    )

    assert [item["id"] for item in history_call(search="cafe")] == ["history-1"]
    assert [item["id"] for item in history_call(month="2026-07")] == ["history-1"]
    assert [item["id"] for item in history_call(year=2025)] == ["history-2"]
    assert [item["id"] for item in history_call(specific_date="2026-07-12")] == ["history-1"]
    assert [item["id"] for item in history_call(
        start_date="2025-12-01",
        end_date="2026-07-31",
        sort="amount_desc",
    )] == ["history-2", "history-1"]
