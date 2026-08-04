import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
BACKUP_SCRIPT = ROOT / "scripts" / "mongodb_backup.sh"
RESTORE_SCRIPT = ROOT / "scripts" / "mongodb_restore_drill.sh"
WORKFLOW = ROOT / ".github" / "workflows" / "production-backup.yml"


def run_script(script, env=None):
    return subprocess.run(
        ["bash", str(script)],
        cwd=ROOT,
        env=env or {},
        text=True,
        capture_output=True,
        check=False,
    )


def make_executable(path, content):
    path.write_text(content, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR)


class BackupAutomationTests(unittest.TestCase):
    def test_backup_scripts_have_valid_bash_syntax(self):
        for script in (BACKUP_SCRIPT, RESTORE_SCRIPT):
            result = subprocess.run(
                ["bash", "-n", str(script)],
                cwd=ROOT,
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_backup_fails_closed_without_credentials(self):
        result = run_script(BACKUP_SCRIPT)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn(
            "missing required environment variable: MONGODB_URI_BACKUP",
            result.stderr,
        )

    def test_restore_requires_an_isolated_test_database(self):
        with tempfile.TemporaryDirectory() as directory:
            temp = Path(directory)
            archive = temp / "backup.gpg"
            manifest = temp / "manifest.json"
            archive.write_bytes(b"encrypted")
            manifest.write_text("{}", encoding="utf-8")
            result = run_script(
                RESTORE_SCRIPT,
                {
                    "BACKUP_ARCHIVE": str(archive),
                    "BACKUP_MANIFEST": str(manifest),
                    "BACKUP_ENCRYPTION_PASSPHRASE": "x" * 32,
                    "RESTORE_MONGODB_URI": "mongodb://localhost:27017",
                    "RESTORE_DATABASE": "aura_finance",
                },
            )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("RESTORE_DATABASE must end with _restore_test", result.stderr)

    def test_backup_and_restore_drill_complete_with_valid_tools(self):
        with tempfile.TemporaryDirectory() as directory:
            temp = Path(directory)
            fake_bin = temp / "bin"
            output = temp / "output"
            fake_bin.mkdir()
            output.mkdir()

            make_executable(
                fake_bin / "mongodump",
                """#!/usr/bin/env bash
set -Eeuo pipefail
for arg in "$@"; do
  case "$arg" in --archive=*) archive="${arg#--archive=}" ;; esac
done
printf 'valid compressed mongo archive' > "$archive"
""",
            )
            make_executable(
                fake_bin / "gpg",
                """#!/usr/bin/env bash
set -Eeuo pipefail
output=''
input=''
while (($#)); do
  case "$1" in
    --output) output="$2"; shift 2 ;;
    --passphrase-fd|--cipher-algo) shift 2 ;;
    --batch|--yes|--pinentry-mode|--symmetric|--decrypt|loopback) shift ;;
    *) input="$1"; shift ;;
  esac
done
cp "$input" "$output"
""",
            )
            make_executable(fake_bin / "mongorestore", "#!/usr/bin/env bash\nexit 0\n")
            make_executable(
                fake_bin / "mongosh",
                """#!/usr/bin/env bash
printf '%s\n' '{"database":"crelith_restore_test","collections":{"users":2},"collection_count":1,"document_count":2}'
""",
            )

            env = os.environ.copy()
            env.update(
                {
                    "PATH": f"{fake_bin}:{env['PATH']}",
                    "MONGODB_URI_BACKUP": "mongodb://backup.invalid:27017",
                    "MONGODB_DATABASE": "aura_finance",
                    "BACKUP_ENCRYPTION_PASSPHRASE": "test-passphrase-32-characters-minimum",
                    "BACKUP_OUTPUT_DIR": str(output),
                    "BACKUP_TIMESTAMP": "20260804T120000Z",
                }
            )
            backup = run_script(BACKUP_SCRIPT, env)
            self.assertEqual(backup.returncode, 0, backup.stderr)

            archive = next(output.glob("*.archive.gz.gpg"))
            manifest = next(output.glob("*.manifest.json"))
            metadata = json.loads(manifest.read_text(encoding="utf-8"))
            self.assertEqual(metadata["database"], "aura_finance")
            self.assertTrue(metadata["encrypted"])

            report = output / "restore-report.json"
            env.update(
                {
                    "BACKUP_ARCHIVE": str(archive),
                    "BACKUP_MANIFEST": str(manifest),
                    "RESTORE_MONGODB_URI": "mongodb://127.0.0.1:27017",
                    "RESTORE_DATABASE": "crelith_restore_test",
                    "RESTORE_REPORT_PATH": str(report),
                }
            )
            restore = run_script(RESTORE_SCRIPT, env)
            self.assertEqual(restore.returncode, 0, restore.stderr)
            evidence = json.loads(report.read_text(encoding="utf-8"))
            self.assertEqual(evidence["status"], "passed")
            self.assertEqual(evidence["document_count"], 2)

    def test_workflow_is_scheduled_encrypted_and_restores_before_upload(self):
        content = WORKFLOW.read_text(encoding="utf-8")

        self.assertIn('cron: "17 3 * * *"', content)
        self.assertIn("BACKUP_ENCRYPTION_PASSPHRASE", content)
        self.assertIn("./scripts/mongodb_restore_drill.sh", content)
        self.assertLess(
            content.index("./scripts/mongodb_restore_drill.sh"),
            content.index("actions/upload-artifact@v4"),
        )
        self.assertIn("retention-days: 30", content)
        self.assertIn("permissions:\n  contents: read", content)


if __name__ == "__main__":
    unittest.main()
