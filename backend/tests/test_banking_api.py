"""Permission and safety tests for the disabled-by-default banking POC."""
from types import SimpleNamespace

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

import banking_api


class FakeUsers:
    def __init__(self, records):
        self.records = {u["id"]: u.copy() for u in records}
        self.updates = []

    async def find_one(self, query, projection=None):
        record = self.records.get(query.get("id"))
        return record.copy() if record else None

    async def update_one(self, query, update):
        self.updates.append((query, update))
        self.records[query["id"]].update(update.get("$set", {}))

    def find(self, query, projection=None):
        return FakeCursor(list(self.records.values()))


class FakeCursor:
    def __init__(self, items):
        self.items = items

    async def to_list(self, length):
        return self.items[:length]


class FakeAudit:
    def __init__(self):
        self.events = []

    async def insert_one(self, item):
        self.events.append(item)


class FakeConnections:
    def __init__(self):
        self.updated = []

    async def update_many(self, query, update):
        self.updated.append((query, update))


class FakeDb:
    def __init__(self, records):
        self.users = FakeUsers(records)
        self.banking_access_audit = FakeAudit()
        self.bank_connections = FakeConnections()


def client_with(db, actor):
    def user():
        # Simulate an authenticated user resolved by the backend from a token.
        return db.users.records[actor["id"]]

    def super_admin():
        current = user()
        if current.get("role") != "SUPER_ADMIN":
            raise HTTPException(403, "Not permitted")
        return current

    app = FastAPI()
    app.include_router(banking_api.create_banking_router(
        db=db, get_current_user=user, require_super_admin=super_admin,
        is_super_admin=lambda u: u.get("role") == "SUPER_ADMIN",
        audit_event=lambda *args, **kwargs: None,
    ))
    return TestClient(app)


def test_banking_off_by_default_and_super_admin_has_individual_permission(monkeypatch):
    monkeypatch.delenv("BANKING_ENABLED", raising=False)
    monkeypatch.delenv("ENABLE_BANKING_APP_ID", raising=False)
    db = FakeDb([{"id": "owner", "role": "SUPER_ADMIN", "email": "owner@example.test"}])
    client = client_with(db, {"id": "owner"})
    result = client.get("/api/banking/access")
    assert result.status_code == 200
    assert result.json()["allowed"] is True
    assert result.json()["can_connect"] is False
    assert client.get("/api/banking/institutions").status_code == 503


def test_normal_user_requests_access_without_granting_it():
    db = FakeDb([{"id": "person", "role": "USER", "status": "active"}])
    client = client_with(db, {"id": "person"})
    assert client.get("/api/banking/access").json()["allowed"] is False
    assert client.post("/api/banking/request").json() == {"access": "pending"}
    assert db.users.records["person"]["banking_access"] == "pending"
    assert client.get("/api/banking/access").json()["can_connect"] is False
    assert client.get("/api/banking/institutions").status_code == 403
    assert db.banking_access_audit.events[0]["target_user_id"] == "person"


def test_only_super_admin_can_grant_permission():
    people = [
        {"id": "owner", "role": "SUPER_ADMIN", "email": "owner@example.test"},
        {"id": "admin", "role": "ADMIN", "email": "admin@example.test"},
        {"id": "person", "role": "USER", "email": "person@example.test", "status": "active"},
    ]
    db = FakeDb(people)
    regular_admin = client_with(db, {"id": "admin"})
    url = "/api/admin/banking/users/person"
    assert regular_admin.patch(url, json={"status": "approved"}).status_code == 403
    assert regular_admin.get("/api/admin/banking/users").status_code == 403

    owner = client_with(db, {"id": "owner"})
    result = owner.patch(url, json={"status": "approved"})
    assert result.status_code == 200
    assert result.json()["access"] == "approved"
    assert db.users.records["person"]["banking_access"] == "approved"
    assert db.banking_access_audit.events[-1]["actor_id"] == "owner"

    # The owner cannot revoke her own protected access.
    assert owner.patch("/api/admin/banking/users/owner",
                       json={"status": "revoked"}).status_code == 409
    assert owner.patch(url, json={"status": "invalid"}).status_code == 422


def test_admin_list_contains_only_identity_and_permission_fields():
    db = FakeDb([
        {"id": "owner", "role": "SUPER_ADMIN", "email": "owner@example.test"},
        {"id": "person", "role": "USER", "name": "Person", "email": "a@example.test",
         "status": "active", "wallet_balance": 50000, "access_token": "do-not-leak"},
    ])
    result = client_with(db, {"id": "owner"}).get("/api/admin/banking/users")
    assert result.status_code == 200
    person = next(x for x in result.json() if x["id"] == "person")
    assert person["access"] == "none"
    assert "wallet_balance" not in person
    assert "access_token" not in person


def test_approval_does_not_bypass_restricted_provider_terms(monkeypatch):
    monkeypatch.setenv("ENABLE_BANKING_MODE", "restricted")
    monkeypatch.setattr(banking_api, "banking_enabled", lambda: True)
    monkeypatch.setattr(banking_api, "banking_configured", lambda: True)
    db = FakeDb([{"id": "person", "role": "USER", "status": "active",
                  "banking_access": "approved"}])
    client = client_with(db, {"id": "person"})
    state = client.get("/api/banking/access").json()
    assert state["allowed"] is True
    assert state["can_connect"] is False
    assert client.get("/api/banking/institutions").status_code == 403
    assert client.post("/api/banking/connect", json={
        "institution": "Bank", "country": "IT"
    }).status_code == 403


def test_callbacks_reject_missing_and_invalid_state(monkeypatch):
    monkeypatch.setattr(banking_api, "banking_enabled", lambda: True)
    monkeypatch.setattr(banking_api, "banking_configured", lambda: True)
    db = FakeDb([{"id": "owner", "role": "SUPER_ADMIN"}])
    client = client_with(db, {"id": "owner"})
    assert client.get("/api/banking/callback").status_code == 400
    assert client.get("/api/banking/callback?state=short&code=123").status_code == 400


def test_inactive_accounts_cannot_be_approved():
    db = FakeDb([
        {"id": "owner", "role": "SUPER_ADMIN"},
        {"id": "person", "role": "USER", "status": "inactive"},
    ])
    client = client_with(db, {"id": "owner"})
    response = client.patch("/api/admin/banking/users/person", json={"status": "approved"})
    assert response.status_code == 409
    assert not db.users.updates
