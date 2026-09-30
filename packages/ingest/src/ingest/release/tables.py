"""Release tables as Parquet (contract §6.1).

Every table is written by DuckDB ``COPY`` with Zstandard compression, the
row group size of §6.1 and DuckDB's default page statistics, from a query
ordered by the §6.1 sort key followed by the table's key columns so that the
order, and with one thread the bytes, are the same on every build. "One" row
group is written as a row group larger than any table. Tables partitioned by
species get one file per species present in the release, also when empty.
Tables without a sort key in §6.1 are sorted by their key columns.

The queries read the views that ``build`` defines over the catalog, already
restricted to the genomes of the release.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import duckdb

ONE = 1_000_000_000
K50 = 50_000
K100 = 100_000
TABLES_DIR = "tables"


@dataclass(frozen=True)
class TableOut:
    name: str
    order: tuple[str, ...]
    row_group: int
    by_species: bool = False

    def path(self, species_code: str | None = None) -> str:
        if self.by_species:
            return f"{TABLES_DIR}/{self.name}/{species_code}.parquet"
        return f"{TABLES_DIR}/{self.name}.parquet"


TABLES: tuple[TableOut, ...] = (
    TableOut("species_registry", ("species_code",), ONE),
    TableOut("genome", ("species_code", "genome_id"), K50),
    TableOut("contig", ("genome_id", "contig_index"), K100, by_species=True),
    TableOut("feature", ("genome_id", "contig_id", "start", "end", "feature_id"), K100, True),
    TableOut("annotation_hit", ("genome_id", "contig_id", "start", "end", "hit_id"), K100, True),
    TableOut("mutation", ("genome_id", "mutation_id"), K50),
    TableOut("region", ("genome_id", "contig_id", "start", "region_id"), K100, by_species=True),
    TableOut("typing", ("genome_id", "source_tool", "key"), K100),
    TableOut("genome_set", ("set_id",), ONE),
    TableOut("genome_set_member", ("set_id", "genome_id"), ONE),
    TableOut("tool_version", ("genome_id", "tool"), ONE),
    TableOut("tombstone", ("genome_id",), ONE),
    TableOut("metadata_extra", ("genome_id", "key"), ONE),
)


def sql_string(value: str) -> str:
    """A SQL string literal (COPY takes no parameters)."""
    return "'" + value.replace("'", "''") + "'"


def copy_query(con: duckdb.DuckDBPyConnection, query: str, path: Path, row_group: int) -> None:
    """Write the result of ``query`` to ``path`` as Zstandard Parquet."""
    path.parent.mkdir(parents=True, exist_ok=True)
    con.execute(
        f"COPY ({query}) TO {sql_string(path.as_posix())} "
        f"(FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE {row_group})"
    )


def _order(columns: tuple[str, ...]) -> str:
    return ", ".join(f'"{c}" NULLS LAST' for c in columns)


def write_tables(con: duckdb.DuckDBPyConnection, root: Path, species: list[str]) -> list[str]:
    """Write every §6.1 table of the release; returns the relative paths written."""
    written: list[str] = []
    for t in TABLES:
        order = _order(t.order)
        if not t.by_species:
            query = f'SELECT * FROM "{t.name}" ORDER BY {order}'
            copy_query(con, query, root / t.path(), t.row_group)
            written.append(t.path())
            continue
        for code in species:
            query = (
                f'SELECT * FROM "{t.name}" WHERE genome_id IN '
                f"(SELECT genome_id FROM genome WHERE species_code = {sql_string(code)}) "
                f"ORDER BY {order}"
            )
            copy_query(con, query, root / t.path(code), t.row_group)
            written.append(t.path(code))
    return written
