from fastapi import FastAPI
from fastapi.testclient import TestClient

from dashboard_preferences_api import (
    DASHBOARD_WIDGETS,
    create_dashboard_preferences_router,
)


class FakeUsers:
    def __init__(self, stored=None):
        self.stored = stored
        self.find_queries = []
        self.updates = []

    async def find_one(self, query, projection):
        self.find_queries.append((query, projection))
        return self.stored

    async def update_one(self, query, update):
        self.updates.append((query, update))


class FakeDatabase:
    def __init__(self, stored=None):
        self.users = FakeUsers(stored)


def make_client(database):
    app = FastAPI()
    app.include_router(
        create_dashboard_preferences_router(
            db=database,
            get_current_user=lambda: {"id": "authenticated-user"},
        )
    )
    return TestClient(app)


def test_preferences_default_to_all_widgets_for_existing_users():
    database = FakeDatabase({"id": "authenticated-user"})

    response = make_client(database).get("/api/dashboard/preferences")

    assert response.status_code == 200
    assert response.json()["widgets"] == list(DASHBOARD_WIDGETS)
    assert database.users.find_queries[0][0] == {"id": "authenticated-user"}


def test_preferences_are_saved_only_for_authenticated_user_in_canonical_order():
    database = FakeDatabase()

    response = make_client(database).put(
        "/api/dashboard/preferences",
        json={"widgets": ["budget", "balance", "insights"]},
    )

    assert response.status_code == 200
    assert response.json()["widgets"] == ["balance", "insights", "budget"]
    assert database.users.updates == [
        (
            {"id": "authenticated-user"},
            {"$set": {"dashboard_widgets": ["balance", "insights", "budget"]}},
        )
    ]


def test_preferences_allow_hiding_every_widget():
    database = FakeDatabase()

    response = make_client(database).put(
        "/api/dashboard/preferences",
        json={"widgets": []},
    )

    assert response.status_code == 200
    assert response.json()["widgets"] == []


def test_preferences_reject_unknown_or_duplicate_widgets():
    client = make_client(FakeDatabase())

    unknown = client.put(
        "/api/dashboard/preferences",
        json={"widgets": ["balance", "admin_secrets"]},
    )
    duplicate = client.put(
        "/api/dashboard/preferences",
        json={"widgets": ["balance", "balance"]},
    )

    assert unknown.status_code == 422
    assert duplicate.status_code == 422
