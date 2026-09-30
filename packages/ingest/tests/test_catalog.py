"""catalejo ingest and the side-table commands (contract §4.6 to §4.8, §5, §8.2)."""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any

import duckdb
import pytest

from conftest import copy_catalog
from ingest import schema
from ingest.catalog import (
    FNA,
    IngestError,
    connect,
    files_dir,
    release_id_from_catalog,
    run_ingest,
)
from ingest.config import platform
from ingest.metadata import init_metadata, read_metadata, write_metadata
from ingest.side import ingest_groups, ingest_sets, ingest_tombstones

Manifest = dict[str, Any]


def _rows(catalog: Path, sql: str) -> list[Any]:
    con = connect(catalog, read_only=True)
    try:
        return con.execute(sql).fetchall()
    finally:
        con.close()


def _dump(catalog: Path) -> dict[str, list[Any]]:
    out: dict[str, list[Any]] = {}
    for spec in schema.TABLES:
        out[spec.name] = _rows(catalog, f'SELECT * FROM "{spec.name}"')
    return out


@pytest.mark.parametrize("stem", ["2026-09", "2026-09b", "synth"])
def test_release_id_from_catalog(stem: str) -> None:
    assert release_id_from_catalog(Path(f"catalog/{stem}.duckdb")) == stem


@pytest.mark.parametrize("name", ["2026-9.duckdb", "latest.duckdb", "2026-09.db"])
def test_release_id_refused(name: str) -> None:
    with pytest.raises(IngestError):
        release_id_from_catalog(Path(name))


def test_catalog_tables(small_catalog: Path, small_manifest: Manifest) -> None:
    genomes = dict(_rows(small_catalog, "SELECT genome_id, species_code FROM genome"))
    assert genomes == {g: i["species_code"] for g, i in small_manifest["genomes"].items()}
    for spec in schema.TABLES:
        columns = [r[0] for r in _rows(small_catalog, f'DESCRIBE "{spec.name}"')]
        assert tuple(columns) == spec.column_names
    assert _rows(small_catalog, "SELECT count(*) FROM annotation_hit WHERE feature_id IS NULL") == [
        (0,)
    ]
    registry = _rows(small_catalog, "SELECT species_code FROM species_registry ORDER BY 1")
    assert ("SPY",) in registry
    assert _rows(small_catalog, "SELECT DISTINCT added_release FROM genome") == [("synth",)]


def test_genome_rows_merge_metadata(small_catalog: Path, small_manifest: Manifest) -> None:
    rows = _rows(
        small_catalog,
        """SELECT genome_id, platform, species_source, species_conflict, isolation_date,
        isolation_date_precision, country FROM genome ORDER BY 1""",
    )
    plants = small_manifest["plants"]
    for gid, plat, source, conflict, when, precision, country in rows:
        info = small_manifest["genomes"][gid]
        assert plat == info["platform"]  # metadata overrides detection (hybrid SEN0001)
        assert conflict == (gid in plants["species_conflict"])
        if gid in plants["species_from_mlst_only"]["genomes"]:
            assert source == "mlst"
        assert country and len(country) == 2
        assert precision in ("year", "month", "day") and when is not None


def test_metadata_extra(small_catalog: Path, small_synth: Path) -> None:
    table = read_metadata(small_synth / "metadata.csv")
    expected = sorted(
        (r["genome_id"], k, r[k]) for r in table.rows for k in ("ward", "sequencing_batch") if r[k]
    )
    assert _rows(small_catalog, "SELECT * FROM metadata_extra ORDER BY 1, 2") == expected


def test_side_tables(small_catalog: Path, small_manifest: Manifest) -> None:
    groups = small_manifest["plants"]["access_groups"]
    tomb = small_manifest["plants"]["tombstone"]
    assert tomb["access_groups"] == ["core"]
    for group, members in groups.items():
        found = _rows(
            small_catalog, f"SELECT genome_id FROM genome_group WHERE group_id = '{group}'"
        )
        # The tombstoned genome keeps its group rows, which route its tombstone (decision 7c).
        routed = [tomb["genome_id"]] if group in tomb["access_groups"] else []
        assert sorted(g for (g,) in found) == sorted(members + routed)
    sets = dict(_rows(small_catalog, "SELECT set_id, genome_count FROM genome_set"))
    assert sets == {k: len(v) for k, v in small_manifest["plants"]["curated_sets"].items()}
    assert _rows(small_catalog, "SELECT DISTINCT kind, created_date FROM genome_set") == [
        ("curated", None)
    ]
    tomb = small_manifest["plants"]["tombstone"]
    assert _rows(small_catalog, "SELECT genome_id, replaced_by FROM tombstone") == [
        (tomb["genome_id"], tomb["replaced_by"])
    ]


def test_counters_and_sentences(small_catalog: Path) -> None:
    rows = _rows(
        small_catalog,
        """SELECT g.genome_id, g.amr_gene_count, g.amr_mutation_count, g.plasmid_contig_count,
        g.prophage_region_count,
        (SELECT count(*) FROM annotation_hit h WHERE h.genome_id = g.genome_id
         AND h.source_tool = 'amrfinderplus' AND h.element_type = 'amr'),
        (SELECT count(*) FROM mutation m WHERE m.genome_id = g.genome_id),
        (SELECT count(*) FROM contig c WHERE c.genome_id = g.genome_id
         AND c.classification = 'plasmid'),
        (SELECT count(*) FROM region r WHERE r.genome_id = g.genome_id AND r.type = 'prophage'),
        g.summary_sentence
        FROM genome g""",
    )
    for gid, a, m, p, r, a2, m2, p2, r2, sentence in rows:
        assert (a, m, p, r) == (a2, m2, p2, r2), gid
        assert sentence


def _ingest_copy(tmp_path: Path, small_synth: Path, small_results: Path) -> tuple[Path, Path]:
    metadata = tmp_path / "metadata.csv"
    existing = read_metadata(small_synth / "metadata.csv")
    write_metadata(metadata, init_metadata(small_results, platform(), existing).table)
    return metadata, tmp_path / "catalog" / "2026-09.duckdb"


def test_ingest_is_idempotent_and_keeps_side_tables(
    tmp_path: Path, small_synth: Path, small_results: Path
) -> None:
    metadata, catalog = _ingest_copy(tmp_path, small_synth, small_results)
    result = run_ingest(small_results, metadata, catalog)
    assert result.release_id == "2026-09" and result.genomes == 12
    assert result.unmapped_hits == 0
    ingest_groups(catalog, small_synth / "groups.csv", small_synth / "genome_groups.csv")
    ingest_sets(catalog, small_synth / "sets.csv")
    first = _dump(catalog)
    fna = (files_dir(catalog) / "KPN0002" / FNA).read_bytes()
    # A later release catalog built from a copy keeps added_release of known genomes.
    second = catalog.with_name("2026-10.duckdb")
    shutil.copyfile(catalog, second)
    run_ingest(small_results, metadata, catalog)
    assert _dump(catalog) == first
    assert (files_dir(catalog) / "KPN0002" / FNA).read_bytes() == fna
    run_ingest(small_results, metadata, second)
    assert _rows(second, "SELECT DISTINCT added_release FROM genome") == [("2026-09",)]
    assert not list(catalog.parent.glob("*.tmp"))


def test_ingest_refuses_invalid_metadata(
    tmp_path: Path, small_synth: Path, small_results: Path
) -> None:
    metadata, catalog = _ingest_copy(tmp_path, small_synth, small_results)
    table = read_metadata(metadata)
    table.rows[0]["country"] = "Chile"
    write_metadata(metadata, table)
    with pytest.raises(IngestError) as info:
        run_ingest(small_results, metadata, catalog)
    assert [i.rule for i in info.value.issues] == ["metadata.country"]
    assert not catalog.exists()


def test_ingest_refuses_unregistered_species(
    tmp_path: Path, small_synth: Path, small_results: Path
) -> None:
    metadata, catalog = _ingest_copy(tmp_path, small_synth, small_results)
    table = read_metadata(metadata)
    for row in table.rows:
        if row["genome_id"] == "SAU0001":
            row["species"] = "Staphylococcus argenteus"
    write_metadata(metadata, table)
    with pytest.raises(IngestError) as info:
        run_ingest(small_results, metadata, catalog)
    # The metadata rule catches it first (§9, species absent from the registry).
    assert {i.rule for i in info.value.issues} == {"genome.species_unregistered"}


def test_tombstones_remove_genomes(small_catalog: Path, tmp_path: Path) -> None:
    catalog = copy_catalog(small_catalog, tmp_path / "c")
    path = tmp_path / "tombstones.csv"
    path.write_text(
        "genome_id,removed_release,reason,replaced_by\nKPN0003,2026-06,duplicate,KPN0002\n",
        encoding="utf-8",
    )
    groups = "SELECT group_id FROM genome_group WHERE genome_id = 'KPN0003' ORDER BY 1"
    before = _rows(catalog, groups)
    assert before
    result = ingest_tombstones(catalog, path)
    assert result.rows == {"tombstone": 1, "removed_genomes": 1}
    # genome_group keeps the rows of a tombstoned genome to route its tombstone (decision 7c).
    assert _rows(catalog, groups) == before
    con = duckdb.connect(str(catalog), read_only=True)
    try:
        for name in ("genome", "contig", "feature", "annotation_hit", "genome_set_member",
                     "tool_version", "typing", "metadata_extra"):  # fmt: skip
            found = con.execute(
                f"SELECT count(*) FROM \"{name}\" WHERE genome_id = 'KPN0003'"
            ).fetchone()
            assert found == (0,), name
        count = con.execute(
            "SELECT genome_count FROM genome_set WHERE set_id = 'kpc-plasmid-carriers'"
        ).fetchone()
        assert count == (2,)
        sentence = con.execute(
            "SELECT summary_sentence FROM genome WHERE genome_id = 'KPN0001'"
        ).fetchone()
        assert sentence and "group of 2 ST11 genomes" in sentence[0]
    finally:
        con.close()


def test_tombstone_reason_vocabulary(small_catalog: Path, tmp_path: Path) -> None:
    catalog = copy_catalog(small_catalog, tmp_path / "c")
    path = tmp_path / "tombstones.csv"
    path.write_text("genome_id,removed_release,reason\nKPN0003,2026-06,mislabelled\n")
    with pytest.raises(IngestError) as info:
        ingest_tombstones(catalog, path)
    assert info.value.issues[0].rule == "tombstone.reason"


def test_groups_refuse_unknown_group(
    small_catalog: Path, tmp_path: Path, small_synth: Path
) -> None:
    catalog = copy_catalog(small_catalog, tmp_path / "c")
    members = tmp_path / "genome_groups.csv"
    members.write_text("genome_id,group_id\nKPN0001,core\nKPN0002,secret\n", encoding="utf-8")
    with pytest.raises(IngestError) as info:
        ingest_groups(catalog, small_synth / "groups.csv", members)
    assert info.value.issues[0].rule == "genome_group.unknown_group"


def test_sets_leave_out_unknown_genomes(small_catalog: Path, tmp_path: Path) -> None:
    catalog = copy_catalog(small_catalog, tmp_path / "c")
    path = tmp_path / "sets.csv"
    path.write_text(
        "set_id,name,description,genome_id\ns1,Set one,,KPN0001\ns1,Set one,,NOPE0001\n",
        encoding="utf-8",
    )
    result = ingest_sets(catalog, path)
    assert result.rows == {"genome_set": 1, "genome_set_member": 1}
    assert [i.rule for i in result.warnings()] == ["side.unknown_genome"]
    assert _rows(catalog, "SELECT set_id, genome_count, description FROM genome_set") == [
        ("s1", 1, None)
    ]


def _side_order(
    tmp_path: Path,
    small_synth: Path,
    small_results: Path,
    order: list[str],
    tombstones: Path | None = None,
) -> tuple[dict[str, list[Any]], list[str]]:
    """A fresh catalog with the side-table commands run in ``order``; its dump and warnings."""
    metadata, catalog = _ingest_copy(tmp_path, small_synth, small_results)
    run_ingest(small_results, metadata, catalog)
    warnings: list[str] = []
    for step in order:
        if step == "groups":
            result = ingest_groups(
                catalog, small_synth / "groups.csv", small_synth / "genome_groups.csv"
            )
        else:
            result = ingest_tombstones(catalog, tombstones or small_synth / "tombstones.csv")
        warnings += [f"{i.rule} {i.genome_id}" for i in result.warnings()]
    return _dump(catalog), warnings


def test_side_table_order_does_not_change_the_catalog(
    tmp_path: Path, small_synth: Path, small_results: Path, small_manifest: Manifest
) -> None:
    """tombstones then groups, and groups then tombstones then groups, give one catalog (7c).

    The synthetic tombstone names a genome that was never ingested, so groups
    ingest keeps its group rows only once the tombstone is in the catalog.
    """
    tomb = small_manifest["plants"]["tombstone"]["genome_id"]
    first, warned = _side_order(
        tmp_path / "a", small_synth, small_results, ["tombstones", "groups"]
    )
    assert warned == []
    again, _ = _side_order(
        tmp_path / "b", small_synth, small_results, ["groups", "tombstones", "groups"]
    )
    assert again == first
    assert [r for r in first["genome_group"] if r[0] == tomb] == [(tomb, "core")]
    # Without the second groups run the row is left out, with a warning; hence the CI order.
    late, warned = _side_order(tmp_path / "c", small_synth, small_results, ["groups", "tombstones"])
    assert warned == [f"side.unknown_genome {tomb}"]
    assert [r for r in late["genome_group"] if r[0] == tomb] == []


def test_side_table_order_for_an_ingested_genome(
    tmp_path: Path, small_synth: Path, small_results: Path
) -> None:
    """For a genome ingested and then tombstoned, a single run of each command commutes."""
    path = tmp_path / "tombstones.csv"
    path.write_text(
        "genome_id,removed_release,reason,replaced_by\nKPN0003,2026-06,duplicate,KPN0002\n",
        encoding="utf-8",
    )
    a, _ = _side_order(tmp_path / "a", small_synth, small_results, ["tombstones", "groups"], path)
    b, _ = _side_order(tmp_path / "b", small_synth, small_results, ["groups", "tombstones"], path)
    assert a == b
    assert [r[1] for r in a["genome_group"] if r[0] == "KPN0003"]
    assert not [r for r in a["genome"] if r[0] == "KPN0003"]


def test_groups_leave_out_unknown_genomes(
    small_catalog: Path, tmp_path: Path, small_synth: Path, small_manifest: Manifest
) -> None:
    catalog = copy_catalog(small_catalog, tmp_path / "c")
    tomb = small_manifest["plants"]["tombstone"]["genome_id"]
    members = tmp_path / "genome_groups.csv"
    members.write_text(
        f"genome_id,group_id\nKPN0001,core\n{tomb},amr-network\nNOPE0001,core\n",
        encoding="utf-8",
    )
    result = ingest_groups(catalog, small_synth / "groups.csv", members)
    assert [(i.rule, i.genome_id) for i in result.warnings()] == [
        ("side.unknown_genome", "NOPE0001")
    ]
    assert _rows(catalog, "SELECT * FROM genome_group ORDER BY 1, 2") == [
        ("KPN0001", "core"),
        (tomb, "amr-network"),
    ]
