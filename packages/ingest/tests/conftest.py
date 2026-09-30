"""Shared fixtures for the ingest tests."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from ingest.config import find_repository_root
from ingest.synth import MANIFEST, RESULTS_DIR, run_synth

SMALL_GENOMES = 12
SMALL_SEED = 7


@pytest.fixture(scope="session")
def repo_root() -> Path:
    return find_repository_root()


@pytest.fixture(scope="session")
def small_synth(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """A small synthetic run (three species, twelve genomes), shared by the tests."""
    out = tmp_path_factory.mktemp("synth") / "small"
    run_synth(out=out, n_species=3, n_genomes=SMALL_GENOMES, seed=SMALL_SEED)
    return out


@pytest.fixture(scope="session")
def small_results(small_synth: Path) -> Path:
    return small_synth / RESULTS_DIR


@pytest.fixture(scope="session")
def small_manifest(small_synth: Path) -> dict[str, Any]:
    return json.loads((small_synth / MANIFEST).read_text(encoding="utf-8"))
