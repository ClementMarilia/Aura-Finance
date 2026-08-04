from fastapi import FastAPI
from fastapi.testclient import TestClient

from timeline_api import create_timeline_router


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
        self.transactions = FakeCollection()
        self.installments = FakeCollection()
        self.receivables = FakeCollection()
        self.recurrences = FakeCollection()
        self.installment_purchases = FakeCollection()


def make_client(database):
    app = FastAPI()
    app.include_router(create_timeline_router(
        db=database,
        get_current_user=lambda: {"id": "authenticated-user", "currency": "EUR"},
        amount_in_currency=lambda document, _currency: float(document.get("amount") or 0),
        normalize_currency=lambda value, fallback="EUR": value or fallback,
    ))
    return TestClient(app)


def test_calendar_scopes_every_database_query_to_authenticated_owner():
    database = FakeDatabase()
    response = make_client(database).get(
        "/api/calendar?start_date=2026-08-01&end_date=2026-08-31&user_id=attacker"
    )

    assert response.status_code == 200
    for collection in (
        database.transactions,
        database.installments,
        database.receivables,
        database.recurrences,
        database.installment_purchases,
    ):
        assert collection.queries
        assert collection.queries[0]["user_id"] == "authenticated-user"


def test_calendar_rejects_unbounded_periods_before_querying_database():
    database = FakeDatabase()
    response = make_client(database).get(
        "/api/calendar?start_date=2026-01-01&end_date=2027-01-02"
    )

    assert response.status_code == 422
    assert not database.transactions.queries
