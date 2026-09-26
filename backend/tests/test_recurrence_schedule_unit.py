import asyncio
import os
import sys
from datetime import date
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from pymongo.errors import DuplicateKeyError

os.environ.setdefault("JWT_SECRET", "test-secret-for-recurrences")
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=10")
os.environ.setdefault("DB_NAME", "crelith_recurrence_test")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server  # noqa: E402


def run(start, freq, anchor, steps):
    out, d = [start], start
    for _ in range(steps):
        d = server._advance(d, freq, anchor)
        out.append(d)
    return out


def test_monthly_on_the_31st_does_not_drift_to_the_28th():
    dates = run(date(2026, 1, 31), "monthly", 31, 4)
    assert dates == [date(2026, 1, 31), date(2026, 2, 28), date(2026, 3, 31), date(2026, 4, 30), date(2026, 5, 31)]


def test_other_frequencies_keep_the_anchor():
    assert run(date(2026, 8, 31), "quarterly", 31, 2) == [date(2026, 8, 31), date(2026, 11, 30), date(2027, 2, 28)]
    assert run(date(2028, 2, 29), "yearly", 29, 1) == [date(2028, 2, 29), date(2029, 2, 28)]
    assert server._advance(date(2026, 3, 30), "weekly", 30) == date(2026, 4, 6)


def test_legacy_recurrences_without_anchor_use_the_current_day():
    assert server._advance(date(2026, 3, 15), "monthly") == date(2026, 4, 15)


def test_anchor_day_is_read_from_next_run():
    assert server.recurrence_anchor_day("2026-01-31") == 31
    assert server.recurrence_anchor_day("bad") is None


def recurrence_db(recurrence, update_side_effect=None):
    cursor = MagicMock()
    cursor.to_list = AsyncMock(return_value=[recurrence])
    return SimpleNamespace(
        recurrences=SimpleNamespace(find=MagicMock(return_value=cursor), update_one=AsyncMock()),
        transactions=SimpleNamespace(update_one=AsyncMock(side_effect=update_side_effect)),
    )


def test_materialize_is_an_atomic_upsert_per_occurrence(monkeypatch):
    rec = {"id": "r1", "type": "expense", "amount": 10, "frequency": "monthly",
           "next_run": "2026-01-31", "anchor_day": 31, "active": True}
    db = recurrence_db(rec)
    monkeypatch.setattr(server, "db", db)
    asyncio.run(server.materialize_recurrences("user-1", date(2026, 4, 30)))
    calls = db.transactions.update_one.await_args_list
    assert [c.args[0]["date"] for c in calls] == ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]
    assert all(c.kwargs.get("upsert") is True and "$setOnInsert" in c.args[1] for c in calls)
    assert db.recurrences.update_one.await_args.args[1] == {"$set": {"next_run": "2026-05-31"}}


def test_a_concurrent_duplicate_is_ignored(monkeypatch):
    rec = {"id": "r1", "type": "expense", "amount": 10, "frequency": "monthly",
           "next_run": "2026-01-10", "active": True}
    db = recurrence_db(rec, update_side_effect=DuplicateKeyError("dup"))
    monkeypatch.setattr(server, "db", db)
    asyncio.run(server.materialize_recurrences("user-1", date(2026, 2, 28)))
    assert db.transactions.update_one.await_count == 2
    assert db.recurrences.update_one.await_args.args[1] == {"$set": {"next_run": "2026-03-10"}}
