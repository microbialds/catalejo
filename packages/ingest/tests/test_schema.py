"""Catalog DDL (data contract 0.7 §5) and the row types that feed it."""

from __future__ import annotations

from dataclasses import astuple
from datetime import date

import duckdb
import pytest

from ingest import schema
from ingest.rows import (
    ROW_TYPES,
    ContigRow,
    FeatureRow,
    GenomeSetRow,
    RegionRow,
    SpeciesRegistryRow,
    field_names,
)

TIER0 = (
    "species_registry", "genome", "contig", "feature", "annotation_hit", "mutation", "region",
    "typing", "tool_version", "tombstone", "access_group", "genome_group", "metadata_extra",
    "genome_set", "genome_set_member",
)  # fmt: skip


def test_tables_in_contract_order() -> None:
    assert tuple(t.name for t in schema.TABLES) == TIER0


def test_ddl_creates_in_duckdb() -> None:
    con = duckdb.connect()
    schema.create_tables(con)
    for spec in schema.TABLES:
        described = con.execute(f'DESCRIBE "{spec.name}"').fetchall()
        assert [r[0] for r in described] == list(spec.column_names)
        assert [r[1] for r in described] == [c.type for c in spec.columns]


@pytest.mark.parametrize("name", TIER0)
def test_row_type_matches_columns(name: str) -> None:
    assert field_names(ROW_TYPES[name]) == schema.table(name).column_names


def test_selected_contract_columns() -> None:
    assert schema.GENOME.column_names[:5] == (
        "genome_id", "assembly_version", "species_code", "species_source", "species_conflict",
    )  # fmt: skip
    assert schema.FEATURE.column_names[3:5] == ("start", "end")
    assert dict((c.name, c.type) for c in schema.CONTIG.columns)["replicon_types"] == "VARCHAR[]"
    assert dict((c.name, c.type) for c in schema.REGION.columns)["attributes"] == "JSON"
    assert schema.CONTIG.primary_key == ("genome_id", "contig_id")


def test_rows_insert_as_tuples() -> None:
    con = duckdb.connect()
    schema.create_tables(con)
    rows: list[object] = [
        SpeciesRegistryRow("KPN", "Klebsiella pneumoniae", None, 573, ("a",), ("klebsiella",), True,
                           "#000000"),
        ContigRow("G1", "contig_1", 1, 100, 50.0, "linear", "plasmid", "mobsuite", "AA1", None,
                  ("IncFII",), None, "conjugative", 2),
        FeatureRow("f1", "G1", "contig_1", 1, 90, "+", "cds", "L_1", None, "p", 1, "h", ("SO:1",)),
        RegionRow("r1", "G1", "contig_1", 1, 50, "prophage", "genomad", None, 0.9, '{"n_genes":3}'),
        GenomeSetRow("s", "S", None, "curated", 2, date(2026, 9, 1)),
    ]  # fmt: skip
    for row in rows:
        spec = next(s for s, t in ROW_TYPES.items() if isinstance(row, t))
        values = astuple(row)  # type: ignore[arg-type]
        marks = ", ".join("?" for _ in values)
        con.execute(f'INSERT INTO "{spec}" VALUES ({marks})', list(values))
    assert con.execute('SELECT "end", db_xrefs FROM feature').fetchone() == (90, ["SO:1"])
    assert con.execute("SELECT attributes->>'n_genes' FROM region").fetchone() == ("3",)
    with pytest.raises(duckdb.ConstraintException):
        con.execute("INSERT INTO feature (feature_id) VALUES ('f1')")
