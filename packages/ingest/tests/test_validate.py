"""release check: one broken fixture per rule of contract §9."""

from __future__ import annotations

import json
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import duckdb
import pytest
import yaml

from conftest import copy_catalog
from ingest import validate as v
from ingest.catalog import connect
from ingest.config import find_repository_root
from ingest.issues import FAILURE, WARNING, Issue, failures
from ingest.metadata import read_metadata, write_metadata


@pytest.fixture
def con(small_catalog: Path, tmp_path: Path) -> Iterator[duckdb.DuckDBPyConnection]:
    """A writable copy of the small catalog."""
    catalog = copy_catalog(small_catalog, tmp_path / "catalog")
    connection = connect(catalog)
    yield connection
    connection.close()


def _rules(issues: list[Issue]) -> set[tuple[str, str]]:
    return {(i.rule, i.severity) for i in issues}


def test_valid_catalog_has_only_the_expected_warnings(small_catalog: Path) -> None:
    connection = connect(small_catalog, read_only=True)
    try:
        issues = v.validate_catalog(connection)
    finally:
        connection.close()
    assert failures(issues) == []
    assert {i.rule for i in issues} == {
        v.W_MLST_ONLY, v.W_CONFLICT, v.W_MIXED_VERSIONS, v.W_NO_PANGENOME, v.W_SMALL_SET,
    }  # fmt: skip


BROKEN: list[tuple[str, Callable[[duckdb.DuckDBPyConnection], list[Issue]], str, str]] = [
    (
        "UPDATE genome SET genome_id = 'bad id' WHERE genome_id = 'KPN0006'",
        v.check_genome_id_pattern, v.R_PATTERN, FAILURE,
    ),
    (
        "UPDATE genome SET genome_id = 'kpn0001' WHERE genome_id = 'KPN0006'",
        v.check_genome_id_duplicate, v.R_DUPLICATE, FAILURE,
    ),
    (
        "INSERT INTO tombstone VALUES ('KPN0006', '2026-06', 'duplicate', NULL)",
        v.check_genome_tombstoned, v.R_TOMBSTONED, FAILURE,
    ),
    (
        "UPDATE genome SET species_code = 'XYZ' WHERE genome_id = 'KPN0006'",
        v.check_species_registered, v.R_SPECIES, FAILURE,
    ),
    (
        "DELETE FROM genome_group WHERE genome_id = 'SEN0002'",
        v.check_access_group, v.R_NO_GROUP, FAILURE,
    ),
    (
        """UPDATE feature SET "end" = 10000000 WHERE feature_id =
        (SELECT min(feature_id) FROM feature WHERE genome_id = 'KPN0006')""",
        v.check_feature_coordinates, v.R_FEATURE_COORDINATES, FAILURE,
    ),
    (
        """UPDATE feature SET start = "end" + 1 WHERE feature_id =
        (SELECT min(feature_id) FROM feature WHERE genome_id = 'KPN0006')""",
        v.check_feature_coordinates, v.R_FEATURE_COORDINATES, FAILURE,
    ),
    (
        """UPDATE annotation_hit SET feature_id = 'ffffffffffffffff' WHERE hit_id =
        (SELECT min(hit_id) FROM annotation_hit)""",
        v.check_references, v.R_REFERENCE, FAILURE,
    ),
    (
        "UPDATE mutation SET genome_id = 'GONE0001' WHERE mutation_id = (SELECT min(mutation_id) FROM mutation)",  # noqa: E501
        v.check_references, v.R_REFERENCE, FAILURE,
    ),
    (
        "UPDATE region SET genome_id = 'GONE0001' WHERE region_id = (SELECT min(region_id) FROM region)",  # noqa: E501
        v.check_references, v.R_REFERENCE, FAILURE,
    ),
    (
        "CREATE TABLE cluster_membership AS SELECT 'KPN.synth.group_1' AS cluster_id, "
        "'0000000000000000' AS feature_id, 'KPN0001' AS genome_id",
        v.check_references, v.R_REFERENCE, FAILURE,
    ),
    (
        "CREATE TABLE tree_tip AS SELECT 'KPN-core' AS tree_id, 'GONE0001' AS genome_id",
        v.check_tree_tips, v.R_TREE_TIP, FAILURE,
    ),
    (
        "CREATE TABLE cluster_membership AS SELECT 'KPN.synth.group_1' AS cluster_id, "
        "NULL AS feature_id, 'GONE0001' AS genome_id",
        v.check_pangenome_genomes, v.R_PANGENOME, FAILURE,
    ),
    (
        "UPDATE genome SET country = 'Chile' WHERE genome_id = 'KPN0006'",
        v.check_genome_vocabulary, v.R_VOCABULARY, FAILURE,
    ),
    (
        "UPDATE genome SET source_type = 'hospital' WHERE genome_id = 'KPN0006'",
        v.check_genome_vocabulary, v.R_VOCABULARY, FAILURE,
    ),
    (
        "UPDATE genome SET platform = 'nanopore' WHERE genome_id = 'KPN0006'",
        v.check_genome_vocabulary, v.R_VOCABULARY, FAILURE,
    ),
    (
        "UPDATE genome SET species_source = 'mlst' WHERE genome_id = 'KPN0006'",
        v.warn_mlst_only, v.W_MLST_ONLY, WARNING,
    ),
    (
        "UPDATE genome SET species_conflict = true WHERE genome_id = 'KPN0006'",
        v.warn_conflict, v.W_CONFLICT, WARNING,
    ),
    (
        "UPDATE tool_version SET database_version = '5.1' WHERE tool = 'bakta' "
        "AND genome_id = 'KPN0006'",
        v.warn_mixed_versions, v.W_MIXED_VERSIONS, WARNING,
    ),
    (
        "CREATE TABLE embedding AS SELECT 'KPN0001' AS genome_id",
        v.warn_no_embedding, v.W_NO_EMBEDDING, WARNING,
    ),
    (
        "DELETE FROM genome_set_member WHERE set_id = 'kpc-plasmid-carriers' "
        "AND genome_id <> 'KPN0001'",
        v.warn_small_sets, v.W_SMALL_SET, WARNING,
    ),
    (
        "INSERT INTO genome_group VALUES ('GONE0001', 'core')",
        v.warn_group_unknown_genome, v.W_GROUP_UNKNOWN, WARNING,
    ),
]  # fmt: skip


@pytest.mark.parametrize(("sql", "rule", "rule_id", "severity"), BROKEN)
def test_broken_catalog(
    con: duckdb.DuckDBPyConnection,
    sql: str,
    rule: Callable[[duckdb.DuckDBPyConnection], list[Issue]],
    rule_id: str,
    severity: str,
) -> None:
    before = rule(con)
    con.execute(sql)
    after = rule(con)
    assert len(after) > len(before)
    assert _rules(after) == {(rule_id, severity)}


def test_group_rows_of_tombstoned_genomes_are_valid(
    con: duckdb.DuckDBPyConnection, small_manifest: dict[str, Any]
) -> None:
    """A tombstoned genome keeps its genome_group rows and needs no group (decision 7c)."""
    tomb = small_manifest["plants"]["tombstone"]["genome_id"]
    assert con.execute(
        "SELECT group_id FROM genome_group WHERE genome_id = ?", [tomb]
    ).fetchall() == [("core",)]
    con.execute("INSERT INTO tombstone VALUES ('GONE0002', '2026-06', 'withdrawn', NULL)")
    assert v.check_access_group(con) == []
    assert v.warn_group_unknown_genome(con) == []
    con.execute("INSERT INTO genome_group VALUES ('GONE0002', 'core')")
    assert v.warn_group_unknown_genome(con) == []


def test_mixed_versions_are_reported_per_species(con: duckdb.DuckDBPyConnection) -> None:
    issues = v.warn_mixed_versions(con)
    assert sorted(i.message.split(":")[0] for i in issues) == ["SEN", "SEN"]


def test_no_pangenome_warning(con: duckdb.DuckDBPyConnection) -> None:
    assert {i.message[:3] for i in v.warn_no_pangenome(con)} == {"KPN", "SAU", "SEN"}
    con.execute("CREATE TABLE pangenome_species AS SELECT 'KPN' AS species_code")
    con.execute("CREATE TABLE tree AS SELECT 'SEN' AS species_code")
    assert {i.message[:3] for i in v.warn_no_pangenome(con)} == {"SAU"}


def _registry(tmp_path: Path, edit: Callable[[list[dict[str, object]]], None]) -> Path:
    path = find_repository_root() / "config" / "species_registry.yaml"
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    edit(data["species"])
    target = tmp_path / "species_registry.yaml"
    target.write_text(yaml.safe_dump(data), encoding="utf-8")
    return target


def test_color_index_shared(tmp_path: Path) -> None:
    def edit(species: list[dict[str, object]]) -> None:
        species[1]["color_index"] = 0

    issues = v.check_color_index(_registry(tmp_path, edit))
    assert _rules(issues) == {(v.R_COLOR_INDEX, FAILURE)} and "SEN" in issues[0].message


def test_color_index_outside_palette(tmp_path: Path) -> None:
    def edit(species: list[dict[str, object]]) -> None:
        species[-1]["color_index"] = 8

    assert _rules(v.check_color_index(_registry(tmp_path, edit))) == {(v.R_COLOR_INDEX, FAILURE)}
    assert v.check_color_index() == []


def test_input_rules(tmp_path: Path, small_catalog: Path, small_results: Path) -> None:
    metadata = small_catalog.parent.parent / "metadata.csv"
    assert v.validate_inputs(metadata, small_results) == []
    table = read_metadata(metadata)
    table.rows[0]["mgap_sample"] = "NOPE"
    table.rows[1]["mgap_sample"] = table.rows[2]["mgap_sample"]
    table.rows[3]["isolation_date"] = "2019-13"
    table.rows[4]["source_type"] = "hospital"
    table.rows[5]["platform"] = "minion"
    table.rows[6]["country"] = "XX"
    broken = tmp_path / "metadata.csv"
    write_metadata(broken, table)
    rules = {i.rule for i in v.validate_inputs(broken, small_results)}
    assert rules == {
        "metadata.mgap_sample_absent", "metadata.mgap_sample_duplicate",
        "metadata.isolation_date", "metadata.source_type", "metadata.platform",
        "metadata.country",
    }  # fmt: skip


def test_manifest_checksum(tmp_path: Path) -> None:
    root = tmp_path / "release"
    (root / "tables").mkdir(parents=True)
    (root / "tables" / "a.parquet").write_bytes(b"abc")
    entry = {
        "path": "tables/a.parquet",
        "bytes": 3,
        "sha256": "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    }
    (root / "manifest.json").write_text(json.dumps({"files": [entry]}))
    group = root / "core"
    group.mkdir()
    (group / "manifest.json").write_text(json.dumps({"files": [entry]}))
    (group / "tables").mkdir()
    (group / "tables" / "a.parquet").write_bytes(b"abc")
    assert v.check_manifest_checksums(root) == []
    (group / "tables" / "a.parquet").write_bytes(b"abd")
    issues = v.check_manifest_checksums(root)
    assert _rules(issues) == {(v.R_CHECKSUM, FAILURE)} and "core" in issues[0].message
    (root / "tables" / "a.parquet").unlink()
    assert len(v.check_manifest_checksums(root)) == 2
    assert _rules(v.check_manifest_checksums(tmp_path)) == {(v.R_CHECKSUM, FAILURE)}
