import asyncio
import importlib
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "aura_test")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
server = importlib.import_module("server")


class Cursor:
    def __init__(self, items):
        self.items = items

    async def to_list(self, _limit):
        return self.items


def group(**changes):
    value = {
        "id": "group-1",
        "name": "Casa",
        "creator_id": "owner",
        "member_ids": ["owner", "admin", "member"],
        "admin_ids": ["owner", "admin"],
    }
    value.update(changes)
    return value


def test_legacy_group_creator_is_always_local_admin():
    legacy = group(admin_ids=None)

    assert server.group_admin_ids(legacy) == {"owner"}
    assert server.is_group_admin(legacy, "owner") is True
    assert server.is_group_admin(legacy, "member") is False


def test_list_groups_exposes_only_local_roles(monkeypatch):
    users = [
        {"id": "owner", "name": "Owner", "email": "owner@example.test"},
        {"id": "admin", "name": "Admin", "email": "admin@example.test"},
        {"id": "member", "name": "Member", "email": "member@example.test"},
    ]
    fake_db = SimpleNamespace(
        groups=SimpleNamespace(find=lambda *_args, **_kwargs: Cursor([group()])),
        users=SimpleNamespace(find=lambda *_args, **_kwargs: Cursor(users)),
    )
    monkeypatch.setattr(server, "db", fake_db)

    result = asyncio.run(server.list_groups(user={"id": "admin"}))

    assert result[0]["current_user_role"] == "admin"
    assert result[0]["can_manage_members"] is True
    assert result[0]["can_delete_group"] is False
    roles = {item["id"]: item["group_role"] for item in result[0]["members"]}
    assert roles == {"owner": "owner", "admin": "admin", "member": "member"}
    assert all("is_admin" in item for item in result[0]["members"])


def test_regular_member_cannot_manage_group(monkeypatch):
    monkeypatch.setattr(
        server,
        "db",
        SimpleNamespace(groups=SimpleNamespace(find_one=AsyncMock(return_value=group()))),
    )

    with pytest.raises(server.HTTPException) as error:
        asyncio.run(server.find_group_for_admin("group-1", "member"))

    assert error.value.status_code == 403
    server.db.groups.find_one.assert_awaited_once_with({
        "id": "group-1",
        "member_ids": "member",
    })


def test_group_admin_can_promote_member_without_global_role_change(monkeypatch):
    groups = SimpleNamespace(
        find_one=AsyncMock(return_value=group()),
        update_one=AsyncMock(),
    )
    notify = AsyncMock()
    monkeypatch.setattr(server, "db", SimpleNamespace(groups=groups))
    monkeypatch.setattr(server, "push_notification", notify)

    result = asyncio.run(server.update_group_member_role(
        "group-1",
        "member",
        server.GroupMemberRoleIn(role="admin"),
        user={"id": "admin", "name": "Admin"},
    ))

    assert result == {"ok": True, "role": "admin"}
    groups.update_one.assert_awaited_once_with(
        {
            "id": "group-1",
            "$or": [
                {"creator_id": "admin"},
                {"admin_ids": "admin"},
            ],
        },
        {"$addToSet": {"admin_ids": "member"}},
    )
    assert notify.await_args.args[5] == {
        "group_id": "group-1",
        "group_role": "admin",
    }


def test_owner_cannot_be_demoted(monkeypatch):
    monkeypatch.setattr(
        server,
        "db",
        SimpleNamespace(groups=SimpleNamespace(find_one=AsyncMock(return_value=group()))),
    )

    with pytest.raises(server.HTTPException) as error:
        asyncio.run(server.update_group_member_role(
            "group-1",
            "owner",
            server.GroupMemberRoleIn(role="member"),
            user={"id": "admin", "name": "Admin"},
        ))

    assert error.value.status_code == 400
    assert "proprietário" in error.value.detail


def test_reapplying_same_role_does_not_notify_again(monkeypatch):
    groups = SimpleNamespace(
        find_one=AsyncMock(return_value=group()),
        update_one=AsyncMock(),
    )
    notify = AsyncMock()
    monkeypatch.setattr(server, "db", SimpleNamespace(groups=groups))
    monkeypatch.setattr(server, "push_notification", notify)

    result = asyncio.run(server.update_group_member_role(
        "group-1",
        "admin",
        server.GroupMemberRoleIn(role="admin"),
        user={"id": "owner", "name": "Owner"},
    ))

    assert result == {"ok": True, "role": "admin", "unchanged": True}
    groups.update_one.assert_not_awaited()
    notify.assert_not_awaited()


def test_admin_removing_member_clears_membership_and_local_role(monkeypatch):
    groups = SimpleNamespace(
        find_one=AsyncMock(return_value=group()),
        update_one=AsyncMock(),
    )
    monkeypatch.setattr(server, "db", SimpleNamespace(groups=groups))

    result = asyncio.run(server.remove_group_member(
        "group-1",
        "member",
        user={"id": "admin"},
    ))

    assert result == {"ok": True}
    groups.update_one.assert_awaited_once_with(
        {"id": "group-1"},
        {"$pull": {"member_ids": "member", "admin_ids": "member"}},
    )


def test_group_owner_cannot_be_removed(monkeypatch):
    monkeypatch.setattr(
        server,
        "db",
        SimpleNamespace(groups=SimpleNamespace(find_one=AsyncMock(return_value=group()))),
    )

    with pytest.raises(server.HTTPException) as error:
        asyncio.run(server.remove_group_member(
            "group-1",
            "owner",
            user={"id": "admin"},
        ))

    assert error.value.status_code == 400
    assert "proprietário" in error.value.detail
