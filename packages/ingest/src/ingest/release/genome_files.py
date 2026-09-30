"""Per-genome files of a release (contract §6.3).

Under ``genomes/<species_code>/<genome_id>/``:

- ``genome.gbff.gz``, ``genome.gff3.gz``, ``genome.fna.gz`` and
  ``proteins.faa.gz``, copied from the per-genome file directory that
  ``catalejo ingest`` writes beside the catalog (already gzip-compressed
  without timestamp or name);
- ``cgview.json``, the genome's maps (``release.cgview``), written as sorted
  compact JSON;
- ``features.parquet``, the genome's rows of ``feature``, ``annotation_hit``,
  ``mutation`` and ``region`` in one table (milestone 1a plan, decision 11): a
  ``record`` column naming the source table, then the union of the four
  tables' columns, null where a table has no such column, sorted by
  ``record``, ``contig_id``, ``start`` and the row's identifier.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import duckdb

from ingest.catalog import FAA, FNA, GBFF, GFF3
from ingest.config import PaletteConfig
from ingest.parsers._fasta import fasta_records
from ingest.release.cgview import (
    AMRFINDERPLUS,
    GenomeMapInput,
    MapContig,
    feature_items,
    genome_map,
    hit_items,
    mutation_items,
    region_items,
)
from ingest.release.tables import ONE, copy_query, sql_string

GENOMES_DIR = "genomes"
CGVIEW = "cgview.json"
FEATURES = "features.parquet"
COPIED = (GBFF, GFF3, FNA, FAA)
CIRCULAR = "circular"


def _sequences(path: Path) -> dict[str, str]:
    if not path.is_file():
        return {}
    return {name: seq for name, _, seq in fasta_records(path)}


def map_input(
    con: duckdb.DuckDBPyConnection, genome_id: str, files: Path, palette: PaletteConfig
) -> GenomeMapInput:
    gid = [genome_id]
    sequences = _sequences(files / FNA)
    contigs = [
        MapContig(cid, length, topology == CIRCULAR, sequences.get(cid, ""))
        for cid, length, topology in con.execute(
            """SELECT contig_id, length, topology FROM contig WHERE genome_id = ?
            ORDER BY contig_index""",
            gid,
        ).fetchall()
    ]
    features = feature_items(
        con.execute(
            """SELECT feature_id, contig_id, start, "end", strand, type, locus_tag, gene, product
            FROM feature WHERE genome_id = ? ORDER BY contig_id, start, "end", feature_id""",
            gid,
        ).fetchall()
    )
    hits = con.execute(
        """SELECT hit_id, feature_id, contig_id, start, "end", strand, element_name,
                  element_type, drug_class, drug_subclass
        FROM annotation_hit WHERE genome_id = ? AND source_tool = ?
        ORDER BY contig_id, start, hit_id""",
        [genome_id, AMRFINDERPLUS],
    ).fetchall()
    mutations = con.execute(
        """SELECT mutation_id, feature_id, contig_id, start, "end", strand, gene, variant,
                  drug_class
        FROM mutation WHERE genome_id = ? ORDER BY contig_id, start, mutation_id""",
        gid,
    ).fetchall()
    regions = con.execute(
        """SELECT region_id, contig_id, start, "end", type FROM region WHERE genome_id = ?
        ORDER BY contig_id, start, region_id""",
        gid,
    ).fetchall()
    return GenomeMapInput(
        genome_id,
        contigs,
        features
        + hit_items(hits, palette)
        + mutation_items(mutations, palette)
        + region_items(regions),
    )


def cgview_bytes(
    con: duckdb.DuckDBPyConnection, genome_id: str, files: Path, palette: PaletteConfig
) -> bytes:
    """The genome's map container as sorted compact JSON."""
    doc = genome_map(map_input(con, genome_id, files, palette), palette)
    text = json.dumps(doc, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return (text + "\n").encode("utf-8")


def _features_query(genome_id: str) -> str:
    gid = sql_string(genome_id)
    parts = [
        f"SELECT 'feature' AS record, * FROM feature WHERE genome_id = {gid}",
        f"SELECT 'annotation_hit' AS record, * FROM annotation_hit WHERE genome_id = {gid}",
        f"SELECT 'mutation' AS record, * FROM mutation WHERE genome_id = {gid}",
        f"SELECT 'region' AS record, * FROM region WHERE genome_id = {gid}",
    ]
    union = " UNION ALL BY NAME ".join(f"({p})" for p in parts)
    return (
        f"SELECT * FROM ({union}) ORDER BY record, contig_id, start NULLS LAST, "
        '"end" NULLS LAST, feature_id NULLS LAST, hit_id NULLS LAST, mutation_id NULLS LAST, '
        "region_id NULLS LAST"
    )


def write_genome(
    con: duckdb.DuckDBPyConnection,
    root: Path,
    species_code: str,
    genome_id: str,
    files: Path,
    palette: PaletteConfig,
) -> list[str]:
    """Write one genome's directory; returns the relative paths written."""
    target = root / GENOMES_DIR / species_code / genome_id
    target.mkdir(parents=True, exist_ok=True)
    written: list[str] = []
    source = files / genome_id
    for name in COPIED:
        if (source / name).is_file():
            shutil.copyfile(source / name, target / name)
            written.append(name)
    (target / CGVIEW).write_bytes(cgview_bytes(con, genome_id, source, palette))
    written.append(CGVIEW)
    copy_query(con, _features_query(genome_id), target / FEATURES, ONE)
    written.append(FEATURES)
    return [f"{GENOMES_DIR}/{species_code}/{genome_id}/{n}" for n in sorted(written)]
