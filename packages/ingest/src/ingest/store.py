"""Reading and writing catalog tables with DuckDB (contract §5).

Rows are inserted through Arrow in one statement per table, in the order
given, so a table's physical order is the caller's sort order. Deterministic
bytes (gzip without timestamp or name) are written by ``gzip_bytes``.
"""

from __future__ import annotations

import gzip
import io
from collections.abc import Iterable, Sequence
from dataclasses import astuple
from pathlib import Path
from typing import Any, cast

import duckdb
import polars as pl

from ingest.schema import TableSpec

_TYPES: dict[str, Any] = {
    "VARCHAR": pl.String,
    "VARCHAR[]": pl.List(pl.String),
    "INTEGER": pl.Int32,
    "BIGINT": pl.Int64,
    "FLOAT": pl.Float64,
    "BOOLEAN": pl.Boolean,
    "DATE": pl.Date,
    "JSON": pl.String,
}


def frame(spec: TableSpec, rows: Iterable[Any]) -> pl.DataFrame:
    """A Polars frame of dataclass rows with the table's column names and types."""
    lists = {i for i, c in enumerate(spec.columns) if c.type.endswith("[]")}
    data: list[tuple[Any, ...]] = []
    for row in rows:
        values: tuple[Any, ...] = cast(
            tuple[Any, ...], row if isinstance(row, tuple) else astuple(row)
        )
        if lists:
            values = tuple(
                list(cast(Iterable[Any], v)) if i in lists and v is not None else v
                for i, v in enumerate(values)
            )
        data.append(values)
    schema = {c.name: _TYPES[c.type] for c in spec.columns}
    return pl.DataFrame(data, schema=schema, orient="row")


def open_db(
    path: Path | str, read_only: bool = False, threads: int | None = None
) -> duckdb.DuckDBPyConnection:
    """A DuckDB connection without the progress bar, insertion order preserved."""
    config: dict[str, Any] = {"preserve_insertion_order": True}
    if threads is not None:
        config["threads"] = threads
    con = duckdb.connect(str(path), read_only=read_only, config=config)
    con.execute("SET enable_progress_bar = false")
    return con


def insert(con: duckdb.DuckDBPyConnection, spec: TableSpec, rows: Sequence[Any]) -> int:
    """Append ``rows`` to the table of ``spec`` in the given order; returns the count."""
    if not rows:
        return 0
    con.register("_rows", frame(spec, rows))
    try:
        con.execute(f'INSERT INTO "{spec.name}" SELECT * FROM _rows')
    finally:
        con.unregister("_rows")
    return len(rows)


def table_exists(con: duckdb.DuckDBPyConnection, name: str) -> bool:
    found = con.execute(
        "SELECT count(*) FROM information_schema.tables WHERE table_name = ?", [name]
    ).fetchone()
    return bool(found and found[0])


def gzip_bytes(data: bytes) -> bytes:
    """Gzip with mtime 0 and no file name, so equal input gives equal bytes."""
    buffer = io.BytesIO()
    with gzip.GzipFile(filename="", mode="wb", fileobj=buffer, mtime=0, compresslevel=6) as fh:
        fh.write(data)
    return buffer.getvalue()


def write_gzip(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(gzip_bytes(data))
