"""The catalejo command: help, version, stubs and synth (contract §8)."""

from __future__ import annotations

from pathlib import Path

import pytest
from typer.testing import CliRunner

from ingest import __version__
from ingest.cli import NOT_IMPLEMENTED_EXIT, app

runner = CliRunner()

STUBS: list[tuple[list[str], str]] = [
    (["pangenome", "ingest", "--dir", "pangenomes/KPN", "--catalog", "c.duckdb"], "4a"),
    (["pangenome", "map", "--previous", "p.duckdb", "--catalog", "c.duckdb"], "4a"),
    (["tree", "ingest", "--dir", "trees/KPN-core", "--catalog", "c.duckdb"], "4a"),
    (["embeddings", "ingest", "--file", "e.parquet", "--catalog", "c.duckdb"], "6"),
    (["release", "notes", "--catalog", "c.duckdb", "--previous", "p.duckdb"], "5"),
    (["release", "publish", "--dir", "releases/x", "--bucket", "b", "--group", "core"], "5"),
]


def test_version() -> None:
    result = runner.invoke(app, ["--version"])
    assert result.exit_code == 0
    assert result.stdout.strip() == f"catalejo {__version__}"


def test_help_lists_every_command() -> None:
    result = runner.invoke(app, ["--help"])
    assert result.exit_code == 0
    for command in ("metadata", "ingest", "pangenome", "tree", "embeddings", "sets", "groups",
                    "tombstones", "release", "synth"):  # fmt: skip
        assert command in result.stdout
    for group, commands in (
        ("metadata", ("init", "validate")),
        ("pangenome", ("ingest", "map")),
        ("release", ("check", "build", "notes", "publish")),
    ):
        sub = runner.invoke(app, [group, "--help"])
        assert sub.exit_code == 0
        for command in commands:
            assert command in sub.stdout


@pytest.mark.parametrize(("args", "milestone"), STUBS)
def test_stub_exits_non_zero_with_message(args: list[str], milestone: str) -> None:
    result = runner.invoke(app, args)
    assert result.exit_code == NOT_IMPLEMENTED_EXIT
    assert f"not implemented until milestone {milestone}" in result.stderr
    assert result.stdout == ""


def test_synth_command(tmp_path: Path) -> None:
    out = tmp_path / "synth"
    result = runner.invoke(app, ["synth", "--species", "1", "--genomes", "6", "--out", str(out)])
    assert result.exit_code == 0, result.stderr
    assert "wrote 6 genomes of 1 species" in result.stdout
    assert "metadata.csv: 6 rows" in result.stdout


def test_synth_refusal_exits_2(tmp_path: Path) -> None:
    out = tmp_path / "precious"
    out.mkdir()
    (out / "keep.txt").write_text("keep")
    result = runner.invoke(app, ["synth", "--species", "3", "--genomes", "12", "--out", str(out)])
    assert result.exit_code == 2
    assert "refusing to replace" in result.stderr


def test_synth_help_shows_the_defaults() -> None:
    result = runner.invoke(app, ["synth", "--help"])
    assert result.exit_code == 0
    text = " ".join(result.stdout.split())
    assert "[default: 10]" in text and "[default: 100]" in text
