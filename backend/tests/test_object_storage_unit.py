import asyncio
import inspect
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from bson import ObjectId
from fastapi import HTTPException
from gridfs.errors import NoFile
from pymongo.errors import ServerSelectionTimeoutError

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
BACKEND = Path(__file__).resolve().parents[1]


class FakeBucket:
    def __init__(self, fail=False):
        self.blobs = {}
        self.fail = fail

    def _check(self):
        if self.fail:
            raise ServerSelectionTimeoutError("mongo down")

    async def upload_from_stream(self, filename, data, metadata=None):
        self._check()
        blob_id = ObjectId()
        self.blobs[blob_id] = (filename, data)
        return blob_id

    async def _stream(self, data):
        return SimpleNamespace(read=AsyncMock(return_value=data))

    async def open_download_stream(self, blob_id):
        self._check()
        if blob_id not in self.blobs:
            raise NoFile(blob_id)
        return await self._stream(self.blobs[blob_id][1])

    async def open_download_stream_by_name(self, filename):
        self._check()
        for name, data in self.blobs.values():
            if name == filename:
                return await self._stream(data)
        raise NoFile(filename)

    async def delete(self, blob_id):
        self._check()
        if blob_id not in self.blobs:
            raise NoFile(blob_id)
        del self.blobs[blob_id]


class AsyncCursor:
    def __init__(self, items):
        self.items = list(items)

    def __aiter__(self):
        async def gen():
            for item in self.items:
                yield item
        return gen()


@pytest.fixture
def bucket(monkeypatch):
    fake = FakeBucket()
    monkeypatch.setattr(server, "receipts_bucket", lambda: fake)
    return fake


def fake_upload(filename="receipt.png", data=PNG, content_type="image/png"):
    async def read():
        return data
    return SimpleNamespace(filename=filename, content_type=content_type, read=read)


def upload_db(modified_count=1):
    files = SimpleNamespace(insert_one=AsyncMock(), update_one=AsyncMock())
    transactions = SimpleNamespace(
        find_one=AsyncMock(return_value={"id": "tx-1", "user_id": "user-1"}),
        update_one=AsyncMock(return_value=SimpleNamespace(modified_count=modified_count)),
    )
    return SimpleNamespace(files=files, transactions=transactions)


def test_no_emergent_dependency_remains_in_backend():
    for path in BACKEND.glob("*.py"):
        text = path.read_text().lower()
        assert "emergent" not in text, path.name
    assert not hasattr(server, "STORAGE_URL")
    assert not hasattr(server, "init_storage")


def test_startup_never_blocks_on_receipt_storage():
    source = inspect.getsource(server.startup)
    assert "await purge_orphan_receipt_blobs" not in source
    assert "create_task(_purge_orphan_receipt_blobs_safely())" in source


def test_production_entrypoint_runs_unmodified_startup():
    assert production_app.app is server.app
    assert server.startup in server.app.router.on_startup


def test_receipts_use_the_application_database(monkeypatch):
    monkeypatch.setattr(server, "db", server.client[os.environ["DB_NAME"]])

    async def build():
        return server.receipts_bucket()

    bucket = asyncio.run(build())
    assert type(bucket).__name__ == "AsyncIOMotorGridFSBucket"


def test_upload_then_download_round_trip(monkeypatch, bucket):
    fake_db = upload_db()
    monkeypatch.setattr(server, "db", fake_db)

    receipt = asyncio.run(server.upload_receipt("tx-1", fake_upload(), USER))

    record = fake_db.files.insert_one.await_args.args[0]
    assert receipt["path"] == record["storage_path"]
    assert receipt["path"].startswith(f"{server.APP_NAME}/uploads/user-1/")
    assert ObjectId(record["blob_id"]) in bucket.blobs
    assert record["size"] == len(PNG)

    fake_db.files.find_one = AsyncMock(return_value=record)
    response = asyncio.run(server.download_file(receipt["path"], USER))
    assert response.body == PNG
    assert response.media_type == "image/png"


def test_upload_returns_503_and_writes_nothing_when_mongo_is_down(monkeypatch):
    fake_db = upload_db()
    monkeypatch.setattr(server, "db", fake_db)
    monkeypatch.setattr(server, "receipts_bucket", lambda: FakeBucket(fail=True))

    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.upload_receipt("tx-1", fake_upload(), USER))

    assert exc.value.status_code == 503
    fake_db.files.insert_one.assert_not_awaited()
    fake_db.transactions.update_one.assert_not_awaited()


def test_failed_link_discards_uploaded_blob(monkeypatch, bucket):
    monkeypatch.setattr(server, "db", upload_db(modified_count=0))

    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.upload_receipt("tx-1", fake_upload(), USER))

    assert exc.value.status_code == 409
    assert bucket.blobs == {}


@pytest.mark.parametrize(
    ("record", "status"),
    [
        ({"blob_id": str(ObjectId())}, 404),
        ({}, 404),  # legacy receipt stored on the removed external provider
        ({"blob_id": "not-an-object-id"}, 404),
    ],
)
def test_download_of_missing_blob_is_404(monkeypatch, bucket, record, status):
    path = f"{server.APP_NAME}/uploads/user-1/x.png"
    record = {"storage_path": path, "original_filename": "x.png",
              "content_type": "image/png", **record}
    monkeypatch.setattr(server, "db", SimpleNamespace(
        files=SimpleNamespace(find_one=AsyncMock(return_value=record))))

    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.download_file(path, USER))

    assert exc.value.status_code == status


def test_download_returns_503_when_mongo_is_down(monkeypatch):
    path = f"{server.APP_NAME}/uploads/user-1/x.png"
    record = {"storage_path": path, "blob_id": str(ObjectId())}
    monkeypatch.setattr(server, "db", SimpleNamespace(
        files=SimpleNamespace(find_one=AsyncMock(return_value=record))))
    monkeypatch.setattr(server, "receipts_bucket", lambda: FakeBucket(fail=True))

    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.download_file(path, USER))

    assert exc.value.status_code == 503


def test_delete_receipt_removes_blob(monkeypatch, bucket):
    blob_id = asyncio.run(bucket.upload_from_stream("p", PNG))
    fake_db = SimpleNamespace(
        transactions=SimpleNamespace(
            find_one=AsyncMock(return_value={"id": "tx-1", "receipt": {"file_id": "f-1"}}),
            update_one=AsyncMock(),
        ),
        files=SimpleNamespace(
            find_one=AsyncMock(return_value={"blob_id": str(blob_id)}),
            update_one=AsyncMock(),
        ),
    )
    monkeypatch.setattr(server, "db", fake_db)

    assert asyncio.run(server.delete_receipt("tx-1", USER)) == {"ok": True}
    assert bucket.blobs == {}


def test_blob_delete_failures_never_propagate(monkeypatch):
    monkeypatch.setattr(server, "receipts_bucket", lambda: FakeBucket(fail=True))
    asyncio.run(server.delete_receipt_blob(str(ObjectId())))
    asyncio.run(server.delete_receipt_blob("garbage"))
    asyncio.run(server.delete_receipt_blob(None))


def test_orphan_sweep_keeps_active_and_recent_blobs(monkeypatch, bucket):
    active = asyncio.run(bucket.upload_from_stream("active", PNG))
    orphan = asyncio.run(bucket.upload_from_stream("orphan", PNG))
    recent = asyncio.run(bucket.upload_from_stream("recent", PNG))
    old = datetime.now(timezone.utc) - timedelta(days=2)
    blobs_meta = {active: old, orphan: old, recent: datetime.now(timezone.utc)}

    def blob_find(query, projection):
        cutoff = query["uploadDate"]["$lt"]
        return AsyncCursor({"_id": b} for b, when in blobs_meta.items() if when < cutoff)

    class DB(SimpleNamespace):
        def __getitem__(self, name):
            assert name == "receipts.files"
            return SimpleNamespace(find=blob_find)

    files = SimpleNamespace(find=lambda *a, **k: AsyncCursor([{"blob_id": str(active)}]))
    monkeypatch.setattr(server, "db", DB(files=files))

    assert asyncio.run(server.purge_orphan_receipt_blobs()) == 1
    assert set(bucket.blobs) == {active, recent}
