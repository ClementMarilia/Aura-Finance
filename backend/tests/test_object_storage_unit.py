import os
import sys
from pathlib import Path

os.environ.setdefault("JWT_SECRET", "test-secret-for-object-storage")
os.environ.setdefault(
    "MONGO_URL", "mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=10"
)
os.environ.setdefault("DB_NAME", "crelith_storage_test")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server  # noqa: E402
import app as production_app  # noqa: E402


BACKEND = Path(__file__).resolve().parents[1]


def test_no_emergent_dependency_remains_in_backend():
    for path in BACKEND.glob("*.py"):
        assert "emergent" not in path.read_text().lower(), path.name


def test_receipt_upload_feature_is_not_exposed():
    """Attachments are disabled: nothing may store files or call external storage."""
    paths = {getattr(route, "path", "") for route in production_app.app.routes}
    assert "/api/transactions/{tid}/receipt" not in paths
    assert "/api/files/{path:path}" not in paths
    for name in ("upload_receipt", "download_file", "delete_receipt", "init_storage"):
        assert not hasattr(server, name), name
