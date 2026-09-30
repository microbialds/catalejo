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


@pytest.fixture(scope="session")
def small_assembled(small_results: Path, small_manifest: dict[str, Any]) -> dict[str, Any]:
    """Every genome of the small synthetic run, parsed and assembled, by genome_id."""
    from ingest.assemble import assemble_genome, parse_sample
    from ingest.config import load_typing_display
    from ingest.parsers.gtdbtk import parse_gtdbtk_summary
    from ingest.parsers.pipeline_info import parse_pipeline_info

    display = load_typing_display()
    pipeline = parse_pipeline_info(small_results)
    gtdbtk = parse_gtdbtk_summary(small_results)
    out: dict[str, Any] = {}
    for gid, info in small_manifest["genomes"].items():
        parsed = parse_sample(small_results, info["mgap_sample"], gid, gtdbtk)
        out[gid] = assemble_genome(gid, parsed, display, pipeline)
    return out


def real_example(repo_root: Path, name: str) -> Path:
    """A real mgap run under data/, skipping the test when it is absent (it is git-ignored)."""
    root = repo_root / "data" / name
    if not root.is_dir():
        pytest.skip(f"data/{name} is absent; tests against this real mgap run are skipped")
    return root
