#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

fail() {
  printf 'backup-error: %s\n' "$1" >&2
  exit 1
}

require_env() {
  local name="$1"
  [[ -n "${!name:-}" ]] || fail "missing required environment variable: ${name}"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

require_env MONGODB_URI_BACKUP
require_env MONGODB_DATABASE
require_env BACKUP_ENCRYPTION_PASSPHRASE

[[ "$MONGODB_DATABASE" =~ ^[A-Za-z0-9_-]+$ ]] || fail "MONGODB_DATABASE contains unsafe characters"
(( ${#BACKUP_ENCRYPTION_PASSPHRASE} >= 32 )) || fail "BACKUP_ENCRYPTION_PASSPHRASE must contain at least 32 characters"

require_command mongodump
require_command gpg
require_command sha256sum
require_command python3

output_dir="${BACKUP_OUTPUT_DIR:-$PWD/backups}"
timestamp="${BACKUP_TIMESTAMP:-$(date -u +%Y%m%dT%H%M%SZ)}"
base_name="crelith-${MONGODB_DATABASE}-${timestamp}"
encrypted_path="${output_dir}/${base_name}.archive.gz.gpg"
manifest_path="${output_dir}/${base_name}.manifest.json"
work_dir="$(mktemp -d "${RUNNER_TEMP:-/tmp}/crelith-backup.XXXXXX")"
raw_archive="${work_dir}/${base_name}.archive.gz"

cleanup() {
  rm -f "$raw_archive"
  rmdir "$work_dir" 2>/dev/null || true
}
trap cleanup EXIT

mkdir -p "$output_dir"

mongodump \
  --uri="$MONGODB_URI_BACKUP" \
  --db="$MONGODB_DATABASE" \
  --archive="$raw_archive" \
  --gzip \
  --quiet

[[ -s "$raw_archive" ]] || fail "mongodump produced an empty archive"

printf '%s' "$BACKUP_ENCRYPTION_PASSPHRASE" | gpg \
  --batch \
  --yes \
  --pinentry-mode loopback \
  --passphrase-fd 0 \
  --symmetric \
  --cipher-algo AES256 \
  --output "$encrypted_path" \
  "$raw_archive"

[[ -s "$encrypted_path" ]] || fail "encrypted backup was not created"

encrypted_sha256="$(sha256sum "$encrypted_path" | cut -d' ' -f1)"
encrypted_size="$(wc -c < "$encrypted_path" | tr -d ' ')"

BACKUP_MANIFEST_PATH="$manifest_path" \
BACKUP_DATABASE="$MONGODB_DATABASE" \
BACKUP_CREATED_AT="$timestamp" \
BACKUP_ARCHIVE_NAME="$(basename "$encrypted_path")" \
BACKUP_ARCHIVE_SHA256="$encrypted_sha256" \
BACKUP_ARCHIVE_BYTES="$encrypted_size" \
python3 - <<'PY'
import json
import os
from pathlib import Path

manifest = {
    "schema_version": 1,
    "database": os.environ["BACKUP_DATABASE"],
    "created_at_utc": os.environ["BACKUP_CREATED_AT"],
    "archive": os.environ["BACKUP_ARCHIVE_NAME"],
    "archive_sha256": os.environ["BACKUP_ARCHIVE_SHA256"],
    "archive_bytes": int(os.environ["BACKUP_ARCHIVE_BYTES"]),
    "encrypted": True,
    "encryption": "OpenPGP AES256 symmetric",
}
Path(os.environ["BACKUP_MANIFEST_PATH"]).write_text(
    json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
)
PY

printf 'backup-created: %s\n' "$encrypted_path"
printf 'backup-manifest: %s\n' "$manifest_path"
