from datetime import date, timedelta

from fastapi import FastAPI
from fastapi.testclient import TestClient

from health_api import create_health_router


class FakeCursor:
    def __init__(self, documents):
        self.documents = documents

    async def to_list(self, _limit):
        return self.documents


class FakeCollection:
    def __init__(self, documents=None):
        self.documents = documents or []
        self.queries = []

    def find(self, query, _projection):
        self.queries.append(query)
        return FakeCursor(self.documents)


class FakeDatabase:
    def __init__(self):
        self.accounts = FakeCollection([{"id": "wallet", "currency": "EUR"}])
        self.transactions = FakeCollection()
        self.installments = FakeCollection()
        self.receivables = FakeCollection()
        self.recurrences = FakeCollection()
        self.goals = FakeCollection()
        self.categories = FakeCollection()
        self.installment_purchases = FakeCollection()


def make_client(database):
    app = FastAPI()
    app.include_router(create_health_router(
        db=database,
        get_current_user=lambda: {"id": "authenticated-user", "currency": "EUR"},
        load_account_balance_breakdowns=lambda accounts, _user: async_value([
            {**accounts[0], "current_balance": 500}
        ]),
        amount_in_currency=lambda document, _currency: float(document.get("amount") or 0),
        normalize_currency=lambda value, fallback="EUR": value or fallback,
    ))
    return TestClient(app)


async def async_value(value):
    return value


def test_health_api_scopes_every_private_query_to_authenticated_owner():
    database = FakeDatabase()
    response = make_client(database).get("/api/financial-health?user_id=attacker")

    assert response.status_code == 200
    assert 0 <= response.json()["score"] <= 100
    for collection in (
        database.accounts,
        database.transactions,
        database.installments,
        database.receivables,
        database.recurrences,
        database.goals,
        database.categories,
        database.installment_purchases,
    ):
        assert collection.queries
        assert collection.queries[0]["user_id"] == "authenticated-user"


def test_health_api_returns_methodology_and_neutral_missing_data():
    response = make_client(FakeDatabase()).get("/api/financial-health")
    data = response.json()

    assert response.status_code == 200
    assert data["methodology"]["version"] == 1
    assert data["summary"]["unavailable"] >= 1
    assert data["period"]["projection_end"]


def test_health_api_query_keeps_old_overdue_bills_in_scope():
    database = FakeDatabase()
    response = make_client(database).get("/api/financial-health")

    assert response.status_code == 200
    transaction_query = database.transactions.queries[0]
    installment_query = database.installments.queries[0]
    assert any(branch.get("status") == "pending" for branch in transaction_query["$or"])
    assert any(branch.get("status") == "pending" for branch in installment_query["$or"])


def test_health_api_calculates_projection_when_future_events_exist():
    database = FakeDatabase()
    future_date = (date.today() + timedelta(days=1)).isoformat()
    database.transactions.documents = [{
        "id": "future-expense",
        "user_id": "authenticated-user",
        "type": "expense",
        "status": "pending",
        "date": future_date,
        "amount": 75,
        "account_id": "wallet",
        "currency": "EUR",
    }]
    database.recurrences.documents = [{
        "id": "future-income",
        "user_id": "authenticated-user",
        "type": "income",
        "active": True,
        "next_run": future_date,
        "frequency": "monthly",
        "amount": 100,
        "account_id": "wallet",
        "currency": "EUR",
    }]

    response = make_client(database).get("/api/financial-health")

    assert response.status_code == 200
    assert response.json()["factors"]
