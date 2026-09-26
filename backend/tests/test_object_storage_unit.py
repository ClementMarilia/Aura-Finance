import asyncio
import inspect
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
import requests
from fastapi import HTTPException

os.environ.setdefault("JWT_SECRET", "test-secret-for-object-storage")
os.environ.setdefault(
    "MONGO_URL", "mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=10"
)
os.environ.setdefault("DB_NAME", "crelith_storage_test")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server  # noqa: E402
import app as production_app  # noqa: E402


PNG = b"\x89PNG\r\n\x1a\nrest"
USER = {"id": "user-1"}


class FakeResponse:
    def __init__(self, status_code=200, payload=None, content=b"", headers=None):
        self.status_code = status_code
        self._payload = payload
        self.content = content
        self.headers = headers or {}

    def json(self):
        if self._payload is None:
            raise ValueError("no json")
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"HTTP {self.status_code}")


@pytest.fixture(autouse=True)
def storage_state(monkeypatch):
    monkeypatch.setattr(server, "_storage_key", None)
    monkeypatch.setattr(server, "EMERGENT_KEY", "emergent-key")


def fake_upload(filename="receipt.png", data=PNG, content_type="image/png"):
    async def read():
        return data
    return SimpleNamespace(filename=filename, content_type=content_type, read=read)


def test_startup_never_contacts_object_storage():
    source = inspect.getsource(server.startup)
    assert "init_storage" not in source
    assert "_put_object" not in source
    assert "_get_object" not in source


def test_production_entrypoint_runs_unmodified_startup():
    assert production_app.app is server.app
    assert server.startup in server.app.router.on_startup
    assert server.init_storage.__module__ == "server"


def test_missing_key_fails_without_network(monkeypatch):
    monkeypatch.setattr(server, "EMERGENT_KEY", None)
    monkeypatch.setattr(
        server.requests, "post",
        lambda *a, **k: pytest.fail("must not call storage without a key"),
    )
    with pytest.raises(server.StorageUnavailable):
        server.init_storage()


def test_network_failure_is_typed_and_not_cached(monkeypatch):
    calls = []

    def post(*args, **kwargs):
        calls.append(1)
        if len(calls) == 1:
            raise requests.ConnectionError("down")
        return FakeResponse(payload={"storage_key": "k1"})

    monkeypatch.setattr(server.requests, "post", post)
    with pytest.raises(server.StorageUnavailable):
        server.init_storage()
    assert server._storage_key is None
    assert server.init_storage() == "k1"
    assert server.init_storage() == "k1"
    assert len(calls) == 2


@pytest.mark.parametrize("payload", [None, {}, {"storage_key": ""}, ["x"]])
def test_malformed_init_response_is_unavailable(monkeypatch, payload):
    monkeypatch.setattr(server.requests, "post", lambda *a, **k: FakeResponse(payload=payload))
    with pytest.raises(server.StorageUnavailable):
        server.init_storage()
    assert server._storage_key is None


def test_rejected_key_is_refreshed_once(monkeypatch):
    keys = iter(["stale", "fresh"])
    monkeypatch.setattr(
        server.requests, "post",
        lambda *a, **k: FakeResponse(payload={"storage_key": next(keys)}),
    )
    seen = []

    def request(method, url, headers=None, **kwargs):
        seen.append(headers["X-Storage-Key"])
        if headers["X-Storage-Key"] == "stale":
            return FakeResponse(status_code=401)
        return FakeResponse(content=b"data", headers={"Content-Type": "image/png"})

    monkeypatch.setattr(server.requests, "request", request)
    assert server._get_object("p") == (b"data", "image/png")
    assert seen == ["stale", "fresh"]
    assert server._storage_key == "fresh"


def test_get_object_distinguishes_missing_from_unavailable(monkeypatch):
    monkeypatch.setattr(server, "_storage_key", "k")
    monkeypatch.setattr(server.requests, "request", lambda *a, **k: FakeResponse(status_code=404))
    with pytest.raises(server.StorageObjectNotFound):
        server._get_object("p")

    monkeypatch.setattr(server.requests, "request", lambda *a, **k: FakeResponse(status_code=502))
    with pytest.raises(server.StorageUnavailable):
        server._get_object("p")

    def timeout(*a, **k):
        raise requests.Timeout("slow")

    monkeypatch.setattr(server.requests, "request", timeout)
    with pytest.raises(server.StorageUnavailable):
        server._get_object("p")


def test_put_object_falls_back_to_requested_path(monkeypatch):
    monkeypatch.setattr(server, "_storage_key", "k")
    monkeypatch.setattr(server.requests, "request", lambda *a, **k: FakeResponse(payload=None))
    assert server._put_object("a/b.png", PNG, "image/png") == {
        "path": "a/b.png", "size": len(PNG),
    }


def test_upload_returns_503_and_writes_nothing_when_storage_is_down(monkeypatch):
    files = SimpleNamespace(insert_one=AsyncMock(), update_one=AsyncMock())
    transactions = SimpleNamespace(
        find_one=AsyncMock(return_value={"id": "tx-1", "user_id": "user-1"}),
        update_one=AsyncMock(),
    )
    monkeypatch.setattr(server, "db", SimpleNamespace(files=files, transactions=transactions))

    def down(*a, **k):
        raise requests.ConnectionError("down")

    monkeypatch.setattr(server.requests, "post", down)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.upload_receipt("tx-1", fake_upload(), USER))

    assert exc.value.status_code == 503
    files.insert_one.assert_not_awaited()
    transactions.update_one.assert_not_awaited()


def test_upload_success_links_receipt(monkeypatch):
    files = SimpleNamespace(insert_one=AsyncMock(), update_one=AsyncMock())
    transactions = SimpleNamespace(
        find_one=AsyncMock(return_value={"id": "tx-1", "user_id": "user-1"}),
        update_one=AsyncMock(return_value=SimpleNamespace(modified_count=1)),
    )
    monkeypatch.setattr(server, "db", SimpleNamespace(files=files, transactions=transactions))
    monkeypatch.setattr(server, "_storage_key", "k")
    monkeypatch.setattr(
        server.requests, "request",
        lambda method, url, **k: FakeResponse(payload={"path": url.split("/objects/", 1)[1], "size": 12}),
    )

    receipt = asyncio.run(server.upload_receipt("tx-1", fake_upload(), USER))

    assert receipt["path"].startswith(f"{server.APP_NAME}/uploads/user-1/")
    assert receipt["content_type"] == "image/png"
    files.insert_one.assert_awaited_once()


@pytest.mark.parametrize(
    ("failure", "status"),
    [(FakeResponse(status_code=404), 404), (FakeResponse(status_code=500), 503)],
)
def test_download_maps_storage_failures(monkeypatch, failure, status):
    path = f"{server.APP_NAME}/uploads/user-1/x.png"
    files = SimpleNamespace(find_one=AsyncMock(return_value={
        "storage_path": path, "original_filename": "x.png", "content_type": "image/png",
    }))
    monkeypatch.setattr(server, "db", SimpleNamespace(files=files))
    monkeypatch.setattr(server, "_storage_key", "k")
    monkeypatch.setattr(server.requests, "request", lambda *a, **k: failure)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.download_file(path, USER))

    assert exc.value.status_code == status
