import asyncio
import importlib
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "aura_test")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
server = importlib.import_module("server")
couple_api = importlib.import_module("couple_api")


def _matches(doc, query):
    for key, expected in query.items():
        if key == "$or":
            if not any(_matches(doc, option) for option in expected):
                return False
            continue
        value = doc.get(key)
        if isinstance(expected, dict):
            if "$in" in expected and value not in expected["$in"]:
                return False
            if "$exists" in expected and (key in doc) != expected["$exists"]:
                return False
            continue
        if value != expected:
            return False
    return True


class FakeCollection:
    def __init__(self, docs=None):
        self.docs = [dict(d) for d in (docs or [])]

    async def find_one(self, query, projection=None):
        for doc in self.docs:
            if _matches(doc, query):
                return dict(doc)
        return None

    async def insert_one(self, doc):
        self.docs.append(dict(doc))

    async def update_one(self, query, update):
        for doc in self.docs:
            if _matches(doc, query):
                doc.update(update.get("$set", {}))
                return


class FakeDB:
    def __init__(self, users=(), couple_links=(), groups=()):
        self.users = FakeCollection(users)
        self.couple_links = FakeCollection(couple_links)
        self.groups = FakeCollection(groups)


USERS = [
    {"id": "ana", "name": "Ana", "email": "ana@example.com", "status": "active"},
    {"id": "bruno", "name": "Bruno", "email": "bruno@example.com", "status": "active"},
    {"id": "carla", "name": "Carla", "email": "carla@example.com", "status": "active"},
]


def _build(db):
    counter = iter(range(1, 1000))
    notifications = []
    emails = []

    async def push(user_id, ntype, title, message, link="", meta=None):
        notifications.append({"user_id": user_id, "type": ntype})

    async def send_email(recipient, inviter_name):
        emails.append((recipient["id"], inviter_name))
        return True

    router = couple_api.create_couple_router(
        db=db,
        get_current_user=None,
        push_notification=push,
        send_invite_email=send_email,
        new_id=lambda: f"id-{next(counter)}",
        now_iso=lambda: "2026-11-20T10:00:00Z",
    )
    endpoints = {r.name: r.endpoint for r in router.routes if hasattr(r, "endpoint")}
    return endpoints, notifications, emails


def _user(uid):
    return next(u for u in USERS if u["id"] == uid)


def _run(coro):
    return asyncio.run(coro)


def test_invite_creates_pending_link_and_notifies_registered_partner():
    db = FakeDB(users=USERS)
    ep, notes, emails = _build(db)
    payload = couple_api.CoupleInvitationIn(email="Bruno@Example.com ")

    result = _run(ep["invite"](payload, user=_user("ana")))

    assert result["status"] == "sent_if_registered"
    assert db.couple_links.docs[0]["status"] == "pending"
    assert db.couple_links.docs[0]["requester_id"] == "ana"
    assert db.couple_links.docs[0]["partner_id"] == "bruno"
    assert {"user_id": "bruno", "type": "couple_invite"} in notes
    assert emails == [("bruno", "Ana")]


def test_unknown_email_gets_same_response_and_creates_nothing():
    db = FakeDB(users=USERS)
    ep, notes, emails = _build(db)

    result = _run(ep["invite"](
        couple_api.CoupleInvitationIn(email="ninguem@example.com"), user=_user("ana"),
    ))

    assert result["status"] == "sent_if_registered"
    assert db.couple_links.docs == []
    assert notes == [] and emails == []


def test_inviting_someone_who_already_has_open_link_is_silent():
    db = FakeDB(users=USERS, couple_links=[
        {"id": "x", "requester_id": "carla", "partner_id": "bruno",
         "status": "pending", "group_id": ""},
    ])
    ep, notes, _ = _build(db)

    result = _run(ep["invite"](
        couple_api.CoupleInvitationIn(email="bruno@example.com"), user=_user("ana"),
    ))

    assert result["status"] == "sent_if_registered"
    assert len(db.couple_links.docs) == 1


def test_requester_with_open_link_gets_conflict():
    db = FakeDB(users=USERS, couple_links=[
        {"id": "x", "requester_id": "ana", "partner_id": "carla",
         "status": "pending", "group_id": ""},
    ])
    ep, _, _ = _build(db)

    with pytest.raises(HTTPException) as err:
        _run(ep["invite"](
            couple_api.CoupleInvitationIn(email="bruno@example.com"), user=_user("ana"),
        ))
    assert err.value.status_code == 409


def test_accept_creates_couple_group_with_both_members():
    db = FakeDB(users=USERS, couple_links=[
        {"id": "link-1", "requester_id": "ana", "partner_id": "bruno",
         "status": "pending", "group_id": ""},
    ])
    ep, notes, _ = _build(db)

    result = _run(ep["accept"]("link-1", user=_user("bruno")))

    assert result["status"] == "active"
    group = db.groups.docs[0]
    assert group["kind"] == "couple"
    assert sorted(group["member_ids"]) == ["ana", "bruno"]
    assert db.couple_links.docs[0]["group_id"] == group["id"]
    assert {"user_id": "ana", "type": "couple_accepted"} in notes


def test_only_partner_can_accept():
    db = FakeDB(users=USERS, couple_links=[
        {"id": "link-1", "requester_id": "ana", "partner_id": "bruno",
         "status": "pending", "group_id": ""},
    ])
    ep, _, _ = _build(db)

    with pytest.raises(HTTPException) as err:
        _run(ep["accept"]("link-1", user=_user("ana")))
    assert err.value.status_code == 404
    assert db.groups.docs == []


def test_accept_refused_when_either_person_is_already_coupled():
    db = FakeDB(users=USERS, couple_links=[
        {"id": "old", "requester_id": "bruno", "partner_id": "carla",
         "status": "active", "group_id": "g0"},
        {"id": "link-1", "requester_id": "ana", "partner_id": "bruno",
         "status": "pending", "group_id": ""},
    ])
    ep, _, _ = _build(db)

    with pytest.raises(HTTPException) as err:
        _run(ep["accept"]("link-1", user=_user("bruno")))
    assert err.value.status_code == 409


def test_decline_then_new_invite_is_allowed():
    db = FakeDB(users=USERS, couple_links=[
        {"id": "link-1", "requester_id": "ana", "partner_id": "bruno",
         "status": "pending", "group_id": ""},
    ])
    ep, notes, _ = _build(db)

    _run(ep["decline"]("link-1", user=_user("bruno")))
    assert db.couple_links.docs[0]["status"] == "declined"
    assert {"user_id": "ana", "type": "couple_declined"} in notes

    _run(ep["invite"](
        couple_api.CoupleInvitationIn(email="bruno@example.com"), user=_user("ana"),
    ))
    assert [d["status"] for d in db.couple_links.docs] == ["declined", "pending"]


def test_requester_can_cancel_only_while_pending():
    db = FakeDB(users=USERS, couple_links=[
        {"id": "link-1", "requester_id": "ana", "partner_id": "bruno",
         "status": "pending", "group_id": ""},
    ])
    ep, _, _ = _build(db)

    _run(ep["cancel"]("link-1", user=_user("ana")))
    assert db.couple_links.docs[0]["status"] == "cancelled"

    with pytest.raises(HTTPException):
        _run(ep["cancel"]("link-1", user=_user("ana")))


def test_end_keeps_group_and_frees_both_people():
    db = FakeDB(
        users=USERS,
        couple_links=[{"id": "link-1", "requester_id": "ana", "partner_id": "bruno",
                       "status": "active", "group_id": "g1"}],
        groups=[{"id": "g1", "kind": "couple", "creator_id": "ana",
                 "member_ids": ["ana", "bruno"]}],
    )
    ep, _, _ = _build(db)

    result = _run(ep["end_link"](user=_user("bruno")))

    assert result["status"] == "ended"
    assert db.couple_links.docs[0]["status"] == "ended"
    assert db.groups.docs[0]["member_ids"] == ["ana", "bruno"]


def test_couple_group_rejects_new_members(monkeypatch):
    group = {"id": "g1", "kind": "couple", "creator_id": "ana",
             "member_ids": ["ana", "bruno"], "admin_ids": ["ana", "bruno"]}
    monkeypatch.setattr(server, "find_group_for_admin", _async_return(group))
    monkeypatch.setattr(server, "db", SimpleNamespace(
        users=FakeCollection(USERS), groups=FakeCollection([group]),
    ))

    with pytest.raises(HTTPException) as err:
        _run(server.add_group_member("g1", {"email": "carla@example.com"},
                                     user=_user("ana")))
    assert err.value.status_code == 400


def test_couple_group_cannot_be_deleted_directly(monkeypatch):
    group = {"id": "g1", "kind": "couple", "creator_id": "ana",
             "member_ids": ["ana", "bruno"]}
    monkeypatch.setattr(server, "db", SimpleNamespace(groups=FakeCollection([group])))

    with pytest.raises(HTTPException) as err:
        _run(server.delete_group("g1", user=_user("ana")))
    assert err.value.status_code == 400


def _async_return(value):
    async def _inner(*_args, **_kwargs):
        return value
    return _inner
