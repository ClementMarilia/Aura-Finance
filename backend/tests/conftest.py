"""Pytest safety boundary for tests that access remote environments.

The external suites authenticate and mutate data. They are excluded before
module import unless a developer explicitly opts in with
``RUN_EXTERNAL_TESTS=1``.
"""

from __future__ import annotations

import os
from pathlib import Path


def pytest_ignore_collect(collection_path: Path, config) -> bool:
    """Keep remote, data-mutating tests out of the default test run."""

    if os.environ.get("RUN_EXTERNAL_TESTS") == "1":
        return False
    return "external" in collection_path.parts
