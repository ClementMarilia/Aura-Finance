#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

fail() {
  printf 'restore-error: %s\n' "$1" >&2
  exit 1
}

require_env() {
  local name="$1"
  [[ -n "${!name:-}" ]] || fail "missing required environment variable: ${name}"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

require_env BACKUP_ARCHIVE
require_env BACKUP_MANIFEST
require_env BACKUP_ENCRYPTION_PASSPHRASE
require_env RESTORE_MONGODB_URI
require_env RESTORE_DATABASE

[[ -f "$BACKUP_ARCHIVE" ]] || fail "backup archive does not exist"
[[ -f "$BACKUP_MANIFEST" ]] || fail "backup manifest does not exist"
[[ "$RESTORE_DATABASE" =~ ^[A-Za-z0-9_-]+_restore_test$ ]] || fail "RESTORE_DATABASE must end with _restore_test"

require_command gpg
require_command mongorestore
require_command mongosh
require_command sha256sum
require_command python3

manifest_database="$(python3 - "$BACKUP_MANIFEST" <<'PY'
import json
import re
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    manifest = json.load(source)
database = manifest.get("database", "")
if not re.fullmatch(r"[A-Za-z0-9_-]+", database):
    raise SystemExit("invalid source database in manifest")
print(database)
PY
)"

[[ "$RESTORE_DATABASE" != "$manifest_database" ]] || fail "refusing to restore over the source database"

expected_sha256="$(python3 - "$BACKUP_MANIFEST" <<'PY'
import json
import re
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    value = json.load(source).get("archive_sha256", "")
if not re.fullmatch(r"[0-9a-f]{64}", value):
    raise SystemExit("invalid archive checksum in manifest")
print(value)
PY
)"
actual_sha256="$(sha256sum "$BACKUP_ARCHIVE" | cut -d' ' -f1)"
[[ "$actual_sha256" == "$expected_sha256" ]] || fail "encrypted archive checksum does not match manifest"

work_dir="$(mktemp -d "${RUNNER_TEMP:-/tmp}/crelith-restore.XXXXXX")"
raw_archive="${work_dir}/restore.archive.gz"

cleanup() {
  rm -f "$raw_archive"
  rmdir "$work_dir" 2>/dev/null || true
}
trap cleanup EXIT

printf '%s' "$BACKUP_ENCRYPTION_PASSPHRASE" | gpg \
  --batch \
  --yes \
  --pinentry-mode loopback \
  --passphrase-fd 0 \
  --decrypt \
  --output "$raw_archive" \
  "$BACKUP_ARCHIVE"

[[ -s "$raw_archive" ]] || fail "decrypted archive is empty"

mongorestore \
  --uri="$RESTORE_MONGODB_URI" \
  --archive="$raw_archive" \
  --gzip \
  --drop \
  --nsFrom="${manifest_database}.*" \
  --nsTo="${RESTORE_DATABASE}.*" \
  --quiet

report_path="${RESTORE_REPORT_PATH:-$PWD/restore-report.json}"
RESTORE_REPORT_JSON="$(mongosh "$RESTORE_MONGODB_URI" --quiet --eval "
const target = db.getSiblingDB('${RESTORE_DATABASE}');
const collections = target.getCollectionNames().sort();
const counts = Object.fromEntries(collections.map(name => [name, target.getCollection(name).countDocuments({})]));
print(JSON.stringify({database: '${RESTORE_DATABASE}', collections: counts, collection_count: collections.length, document_count: Object.values(counts).reduce((sum, count) => sum + count, 0)}));
")" \
RESTORE_REPORT_PATH="$report_path" \
python3 - <<'PY'
import json
import os
from datetime import datetime, timezone
from pathlib import Path

report = json.loads(os.environ["RESTORE_REPORT_JSON"])
if report.get("collection_count", 0) < 1:
    raise SystemExit("restore verification failed: no collections were restored")
if report.get("document_count", 0) < 1:
    raise SystemExit("restore verification failed: no documents were restored")
report["verified_at_utc"] = datetime.now(timezone.utc).isoformat()
report["status"] = "passed"
Path(os.environ["RESTORE_REPORT_PATH"]).write_text(
    json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8"
)
PY

printf 'restore-verified: %s\n' "$report_path"
