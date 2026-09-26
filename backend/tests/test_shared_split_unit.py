import os
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

os.environ.setdefault("JWT_SECRET", "test-secret-for-shared-split")
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=10")
os.environ.setdefault("DB_NAME", "crelith_split_test")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server  # noqa: E402


def people(*values, key):
    return [{"user_id": f"u{i}", "person_id": None, key: v} for i, v in enumerate(values)]


def owed(splits):
    return [item["owed"] for item in splits]


def test_manual_split_must_add_up_to_the_total():
    assert owed(server.compute_splits(100, "manual", people(60, 40, key="amount"))) == [60, 40]
    with pytest.raises(HTTPException) as exc:
        server.compute_splits(100, "manual", people(30, 30, key="amount"))
    assert exc.value.status_code == 400
    assert "60.00" in exc.value.detail and "100.00" in exc.value.detail


def test_manual_split_tolerates_one_cent_and_rejects_negatives():
    splits = server.compute_splits(100, "manual", people(33.33, 33.33, 33.33, key="amount"))
    assert round(sum(owed(splits)), 2) == 100
    with pytest.raises(HTTPException):
        server.compute_splits(100, "manual", people(120, -20, key="amount"))


@pytest.mark.parametrize("percents", [(50, 30), (100, 50), (60, 50, -10)])
def test_percent_split_must_total_100(percents):
    with pytest.raises(HTTPException) as exc:
        server.compute_splits(90, "percent", people(*percents, key="percent"))
    assert exc.value.status_code == 400


def test_percent_split_corrects_cent_rounding():
    splits = server.compute_splits(100, "percent", people(33.33, 33.33, 33.34, key="percent"))
    assert round(sum(owed(splits)), 2) == 100
    splits = server.compute_splits(10, "percent", people(33.333, 33.333, 33.334, key="percent"))
    assert round(sum(owed(splits)), 2) == 10


def test_equal_split_is_unchanged():
    splits = server.compute_splits(100, "equal", people(None, None, None, key="amount"))
    assert owed(splits) == [33.33, 33.33, 33.34]
