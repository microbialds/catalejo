"""metadata init and validate (contract §4.2, §8.1 and the input rules of §9)."""

from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Any

import pytest
from typer.testing import CliRunner

from ingest import mgap_layout as L
from ingest.cli import VALIDATION_EXIT, app
from ingest.config import PlatformConfig, SpeciesRegistry, load_platform, load_species_registry
from ingest.issues import FAILURE
from ingest.metadata import (
    RECOGNIZED,
    RULE_COLUMNS,
    RULE_COUNTRY,
    RULE_DATE,
    RULE_GENOME_ID_DUPLICATE,
    RULE_GENOME_ID_MISSING,
    RULE_GENOME_ID_PATTERN,
    RULE_PLATFORM,
    RULE_SAMPLE_ABSENT,
    RULE_SAMPLE_DUPLICATE,
    RULE_SOURCE_TYPE,
    RULE_SPECIES,
    MetadataFile,
    country_codes,
    init_metadata,
    list_samples,
    parse_isolation_date,
    read_metadata,
    validate_metadata,
    write_metadata,
)

runner = CliRunner()


@pytest.fixture(scope="module")
def config() -> PlatformConfig:
    return load_platform()


@pytest.fixture(scope="module")
def registry() -> SpeciesRegistry:
    return load_species_registry()


def _table(*rows: dict[str, str]) -> MetadataFile:
    columns = list(RECOGNIZED)
    return MetadataFile(columns=columns, rows=[{c: r.get(c, "") for c in columns} for r in rows])


def _rules(table: MetadataFile, config: PlatformConfig, registry: SpeciesRegistry,
           results: Path | None = None) -> set[str]:  # fmt: skip
    return {i.rule for i in validate_metadata(table, config, registry, results)}


# init -------------------------------------------------------------------------------------------


def test_list_samples(small_results: Path, small_manifest: dict[str, Any]) -> None:
    expected = sorted(info["mgap_sample"] for info in small_manifest["genomes"].values())
    assert list_samples(small_results) == expected


def test_init_fills_derivable_columns_only(
    small_results: Path, small_manifest: dict[str, Any], config: PlatformConfig
) -> None:
    result = init_metadata(small_results, config)
    table = result.table
    assert table.columns == list(RECOGNIZED)
    assert [r["genome_id"] for r in table.rows] == sorted(small_manifest["genomes"])
    for row in table.rows:
        info = small_manifest["genomes"][row["genome_id"]]
        assert row["mgap_sample"] == info["mgap_sample"]
        assert row["platform"] == info["detected_platform"]
        assert row.get("species", "") == ""
    assert (result.samples, result.matched, result.new, result.orphans) == (12, 0, 12, [])


def test_manual_edit_survives_a_second_init(
    tmp_path: Path, small_synth: Path, small_results: Path, config: PlatformConfig
) -> None:
    first = tmp_path / "metadata.csv"
    result = runner.invoke(
        app,
        ["metadata", "init", "--mgap", str(small_results), "--out", str(first),
         "--existing", str(small_synth / "metadata.csv")],
    )  # fmt: skip
    assert result.exit_code == 0, result.stderr
    assert "wrote 12 rows" in result.stdout
    table = read_metadata(first)
    assert table.columns[-2:] == ["ward", "sequencing_batch"]
    # Manual edits: a platform override, a country, a species, an extra column.
    edited = {r["genome_id"]: r for r in table.rows}
    edited["KPN0002"]["platform"] = "hybrid"
    edited["KPN0002"]["notes"] = "re-sequenced, see batch B09"
    edited["KPN0003"]["species"] = "Klebsiella pneumoniae"
    edited["KPN0003"]["ward"] = "ICU"
    # A row for a sample no longer in the results.
    table.rows.append({c: "" for c in table.columns} | {"genome_id": "OLD0001", "country": "CL"})
    write_metadata(first, table)

    second = tmp_path / "metadata2.csv"
    result = runner.invoke(
        app,
        ["metadata", "init", "--mgap", str(small_results), "--out", str(second),
         "--existing", str(first)],
    )  # fmt: skip
    assert result.exit_code == 0, result.stderr
    assert "OLD0001" in result.stderr
    again = {r["genome_id"]: r for r in read_metadata(second).rows}
    assert again["KPN0002"]["platform"] == "hybrid"
    assert again["KPN0002"]["notes"] == "re-sequenced, see batch B09"
    assert again["KPN0003"]["species"] == "Klebsiella pneumoniae"
    assert again["KPN0003"]["ward"] == "ICU"
    assert again["OLD0001"]["country"] == "CL"
    assert list(again) == sorted(again)
    # A third run over the second output is byte-identical: the output is deterministic.
    third = tmp_path / "metadata3.csv"
    runner.invoke(
        app,
        ["metadata", "init", "--mgap", str(small_results), "--out", str(third),
         "--existing", str(second)],
    )  # fmt: skip
    assert third.read_bytes() == second.read_bytes()


def test_renamed_genome_id_is_kept(small_results: Path, config: PlatformConfig) -> None:
    table = init_metadata(small_results, config).table
    for row in table.rows:
        if row["mgap_sample"] == "KPN0002":
            row["genome_id"] = "SCL0421"
    again = init_metadata(small_results, config, table)
    assert "SCL0421" in {r["genome_id"] for r in again.table.rows}
    assert "KPN0002" not in {r["genome_id"] for r in again.table.rows}
    assert again.orphans == []


def test_prefixed_sample_matched_by_genome_id(small_results: Path, config: PlatformConfig) -> None:
    existing = _table({"genome_id": "KPN0001", "country": "AR"})
    result = init_metadata(small_results, config, existing)
    (row,) = [r for r in result.table.rows if r["genome_id"] == "KPN0001"]
    assert (row["mgap_sample"], row["country"]) == ("ont_KPN0001", "AR")
    assert result.matched == 1 and result.orphans == []


def test_empty_cells_are_written_empty(tmp_path: Path) -> None:
    path = tmp_path / "m.csv"
    write_metadata(path, _table({"genome_id": "G1"}))
    assert path.read_text().splitlines()[1] == "G1" + "," * (len(RECOGNIZED) - 1)


def test_tsv_is_read(tmp_path: Path) -> None:
    path = tmp_path / "metadata.tsv"
    path.write_text("genome_id\tcountry\tward\nG1\tCL\tICU\n", encoding="utf-8")
    table = read_metadata(path)
    assert table.rows == [{"genome_id": "G1", "country": "CL", "ward": "ICU"}]
    assert table.extra_columns() == ["ward"]


def test_init_without_samples_fails(tmp_path: Path) -> None:
    result = runner.invoke(
        app, ["metadata", "init", "--mgap", str(tmp_path), "--out", str(tmp_path / "m.csv")]
    )
    assert result.exit_code == VALIDATION_EXIT
    assert "no mgap samples" in result.stderr


def test_real_example_init(repo_root: Path, config: PlatformConfig) -> None:
    root = repo_root / "data" / "ont_example"
    if not root.is_dir():
        pytest.skip("data/ont_example is absent")
    (row,) = init_metadata(root, config).table.rows
    assert (row["genome_id"], row["mgap_sample"], row["platform"]) == (
        "SCL30014", "ont_SCL30014", L.PLATFORM_ONT,
    )  # fmt: skip


# validate ---------------------------------------------------------------------------------------


def test_synthetic_metadata_is_valid(
    small_synth: Path, small_results: Path, config: PlatformConfig, registry: SpeciesRegistry
) -> None:
    table = read_metadata(small_synth / "metadata.csv")
    assert validate_metadata(table, config, registry, small_results) == []
    result = runner.invoke(
        app,
        ["metadata", "validate", str(small_synth / "metadata.csv"), "--mgap", str(small_results)],
    )
    assert result.exit_code == 0, result.stderr
    assert "0 failures" in result.stdout


def test_rule_columns(config: PlatformConfig, registry: SpeciesRegistry) -> None:
    table = MetadataFile(columns=["sample", "country"], rows=[{"sample": "a", "country": "CL"}])
    assert _rules(table, config, registry) == {RULE_COLUMNS}


def test_rule_genome_id_missing(config: PlatformConfig, registry: SpeciesRegistry) -> None:
    assert _rules(_table({"genome_id": "", "country": "CL"}), config, registry) == {
        RULE_GENOME_ID_MISSING
    }


def test_rule_genome_id_pattern(config: PlatformConfig, registry: SpeciesRegistry) -> None:
    for bad in ("-SCL1", "SCL 1", "SCL/1", "a" * 65):
        assert _rules(_table({"genome_id": bad}), config, registry) == {RULE_GENOME_ID_PATTERN}
    assert _rules(_table({"genome_id": "SCL0421.v2_a-b"}), config, registry) == set()


def test_rule_genome_id_case_insensitive_duplicate(
    config: PlatformConfig, registry: SpeciesRegistry
) -> None:
    table = _table({"genome_id": "SCL0421"}, {"genome_id": "scl0421", "mgap_sample": "other"})
    issues = validate_metadata(table, config, registry)
    assert [(i.rule, i.severity) for i in issues] == [(RULE_GENOME_ID_DUPLICATE, FAILURE)]


def test_rule_mgap_sample_absent(
    small_results: Path, config: PlatformConfig, registry: SpeciesRegistry
) -> None:
    table = _table(
        {"genome_id": "KPN0002"},  # defaults to its genome_id, present
        {"genome_id": "KPN0001"},  # the sample is ont_KPN0001, so KPN0001 is absent
        {"genome_id": "X1", "mgap_sample": "ont_KPN0001"},
    )
    issues = validate_metadata(table, config, registry, small_results)
    assert [(i.rule, i.genome_id) for i in issues] == [(RULE_SAMPLE_ABSENT, "KPN0001")]


def test_rule_mgap_sample_mapped_twice(config: PlatformConfig, registry: SpeciesRegistry) -> None:
    table = _table(
        {"genome_id": "A1", "mgap_sample": "S1"},
        {"genome_id": "A2", "mgap_sample": "S1"},
        {"genome_id": "S2"},
        {"genome_id": "A3", "mgap_sample": "S2"},
    )
    issues = validate_metadata(table, config, registry)
    assert [(i.rule, i.genome_id) for i in issues] == [
        (RULE_SAMPLE_DUPLICATE, "A2"), (RULE_SAMPLE_DUPLICATE, "A3"),
    ]  # fmt: skip


@pytest.mark.parametrize("value", ["2019-13", "2019-02-30", "19-01-01", "2019/01/01", "Jan 2019"])
def test_rule_isolation_date(value: str, config: PlatformConfig, registry: SpeciesRegistry) -> None:
    table = _table({"genome_id": "G1", "isolation_date": value})
    assert _rules(table, config, registry) == {RULE_DATE}


def test_isolation_date_precision() -> None:
    assert parse_isolation_date("2019") == (date(2019, 1, 1), "year")
    assert parse_isolation_date("2019-07") == (date(2019, 7, 1), "month")
    assert parse_isolation_date("2019-07-23") == (date(2019, 7, 23), "day")


def test_rule_source_type(config: PlatformConfig, registry: SpeciesRegistry) -> None:
    assert _rules(_table({"genome_id": "G1", "source_type": "hospital"}), config, registry) == {
        RULE_SOURCE_TYPE
    }
    assert _rules(_table({"genome_id": "G1", "source_type": "food"}), config, registry) == set()


def test_rule_platform(config: PlatformConfig, registry: SpeciesRegistry) -> None:
    assert _rules(_table({"genome_id": "G1", "platform": "nanopore"}), config, registry) == {
        RULE_PLATFORM
    }


def test_rule_country(config: PlatformConfig, registry: SpeciesRegistry) -> None:
    for bad in ("Chile", "cl", "XX", "CHL"):
        assert _rules(_table({"genome_id": "G1", "country": bad}), config, registry) == {
            RULE_COUNTRY
        }
    assert len(country_codes()) == 249
    assert {"CL", "AR", "US", "VN", "ZA"} <= country_codes()


def test_rule_species_in_registry(config: PlatformConfig, registry: SpeciesRegistry) -> None:
    table = _table(
        {"genome_id": "G1", "species": "Streptococcus pyogenes"},
        {"genome_id": "G2", "species": "klebsiella pneumoniae"},
    )
    issues = validate_metadata(table, config, registry)
    assert [(i.rule, i.genome_id) for i in issues] == [(RULE_SPECIES, "G1")]


def test_validate_command_exits_non_zero(tmp_path: Path) -> None:
    path = tmp_path / "metadata.csv"
    write_metadata(path, _table({"genome_id": "G1", "country": "Chile"}))
    result = runner.invoke(app, ["metadata", "validate", str(path)])
    assert result.exit_code == VALIDATION_EXIT
    assert RULE_COUNTRY in result.stderr
    assert "1 failures" in result.stdout
