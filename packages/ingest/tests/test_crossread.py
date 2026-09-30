"""Parquet cross-read fixture (requirements §13).

This test writes ``tests/fixtures/crossread.parquet`` at the repository root
with DuckDB Python, one column per type the contract uses, and
``crossread.expected.json`` beside it. The web package reads the same file
with @duckdb/duckdb-wasm and asserts the same values, so a version drift
between the two engines fails CI. Both files are committed; CI fails when
this test changes them.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import duckdb
import pyarrow.parquet as pq

from ingest.config import load_versions

PARQUET = "crossread.parquet"
EXPECTED = "crossread.expected.json"

COLUMNS: list[tuple[str, str]] = [
    ("genome_id", "VARCHAR"),
    ("assembly_version", "INTEGER"),
    ("genome_size", "BIGINT"),
    ("gc_content", "FLOAT"),
    ("species_conflict", "BOOLEAN"),
    ("isolation_date", "DATE"),
    ("replicon_types", "VARCHAR[]"),
    ("attributes", "JSON"),
    ("vector", "FLOAT[]"),
    ("note", "VARCHAR"),
    ("st", "VARCHAR"),
]

INSERT = """
INSERT INTO crossread VALUES
    ('KPN0001', 1, 5432109, 0.5703125, true, DATE '2024-03-15', ['IncFIB(K)', 'IncX3'],
     '{"hallmarks":3,"taxonomy":"Caudoviricetes"}', [0.5, -1.25, 3.0], 'Catalejo Genómico',
     'ST258-1LV'),
    ('SEN0002', 2, 9007199254740993, 0.25, false, DATE '1999-12-31', []::VARCHAR[], '{}',
     []::FLOAT[], 'blaKPC-2', 'ST11'),
    ('SAU0003', NULL, NULL, NULL, NULL, NULL, NULL::VARCHAR[], NULL::JSON, NULL::FLOAT[],
     NULL, NULL)
"""

# Expected values in JSON form: BIGINT as decimal strings, DATE as YYYY-MM-DD,
# JSON as its text, FLOAT as numbers, NULL as null, lists as arrays.
EXPECTED_ROWS: list[dict[str, Any]] = [
    {
        "genome_id": "KPN0001",
        "assembly_version": 1,
        "genome_size": "5432109",
        "gc_content": 0.5703125,
        "species_conflict": True,
        "isolation_date": "2024-03-15",
        "replicon_types": ["IncFIB(K)", "IncX3"],
        "attributes": '{"hallmarks":3,"taxonomy":"Caudoviricetes"}',
        "vector": [0.5, -1.25, 3.0],
        "note": "Catalejo Genómico",
        "st": "ST258-1LV",
    },
    {
        "genome_id": "SEN0002",
        "assembly_version": 2,
        "genome_size": "9007199254740993",
        "gc_content": 0.25,
        "species_conflict": False,
        "isolation_date": "1999-12-31",
        "replicon_types": [],
        "attributes": "{}",
        "vector": [],
        "note": "blaKPC-2",
        "st": "ST11",
    },
    {name: None for name, _ in COLUMNS} | {"genome_id": "SAU0003"},
]


def write_fixture(path: Path) -> None:
    con = duckdb.connect()
    try:
        con.execute("SET threads = 1")
        columns = ", ".join(f"{name} {kind}" for name, kind in COLUMNS)
        con.execute(f"CREATE TABLE crossread ({columns})")
        con.execute(INSERT)
        target = str(path).replace("'", "''")
        con.execute(
            f"COPY (SELECT * FROM crossread ORDER BY rowid) TO '{target}' "
            "(FORMAT parquet, COMPRESSION zstd)"
        )
    finally:
        con.close()


def _json_value(value: Any, kind: str) -> Any:
    if value is None:
        return None
    if kind == "BIGINT":
        return str(value)
    if kind == "DATE":
        return value.isoformat()
    return value


def read_rows(path: Path) -> tuple[list[tuple[str, str]], list[dict[str, Any]]]:
    con = duckdb.connect()
    try:
        source = str(path).replace("'", "''")
        described = con.execute(f"DESCRIBE SELECT * FROM read_parquet('{source}')").fetchall()
        types = [(str(row[0]), str(row[1])) for row in described]
        records = con.execute(f"SELECT * FROM read_parquet('{source}')").fetchall()
    finally:
        con.close()
    rows = [
        {
            name: _json_value(value, kind)
            for (name, kind), value in zip(COLUMNS, record, strict=True)
        }
        for record in records
    ]
    return types, rows


def test_crossread_fixture(repo_root: Path, tmp_path: Path) -> None:
    fixtures = repo_root / "tests" / "fixtures"
    fixtures.mkdir(parents=True, exist_ok=True)
    parquet = fixtures / PARQUET
    write_fixture(parquet)

    types, rows = read_rows(parquet)
    assert [name for name, _ in types] == [name for name, _ in COLUMNS]
    assert rows == EXPECTED_ROWS

    expected = {
        "writer": {"duckdb_version": duckdb.__version__},
        "columns": [{"name": name, "duckdb_type": kind} for name, kind in types],
        "rows": EXPECTED_ROWS,
    }
    text = json.dumps(expected, indent=2, sort_keys=False, ensure_ascii=False) + "\n"
    (fixtures / EXPECTED).write_text(text, encoding="utf-8")
    assert json.loads((fixtures / EXPECTED).read_text(encoding="utf-8")) == expected

    metadata = pq.ParquetFile(parquet).metadata
    assert metadata.num_rows == 3
    assert duckdb.__version__ in (metadata.created_by or "")
    compression = {metadata.row_group(0).column(i).compression for i in range(metadata.num_columns)}
    assert compression == {"ZSTD"}

    again = tmp_path / PARQUET
    write_fixture(again)
    assert again.read_bytes() == parquet.read_bytes(), "DuckDB Parquet output is not byte-stable"


def test_duckdb_version_matches_pins() -> None:
    versions = load_versions()
    assert duckdb.__version__ == versions.duckdb_python
    major_minor = ".".join(duckdb.__version__.split(".")[:2])
    assert major_minor == versions.duckdb_engine_minor
