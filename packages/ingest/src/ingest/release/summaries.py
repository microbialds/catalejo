"""Precomputed summaries of a release (contract §6.2; columns per milestone 1a plan, decision 9).

- ``counts_by_species``: species_code, canonical_name, color, genome_count,
  complete_count, st_count (distinct STs), amr_hit_count (sum of
  ``amr_gene_count``), plasmid_contig_count (sum), and (contract 0.10 §6.2)
  plasmid_genome_count and prophage_genome_count, the genomes with
  ``plasmid_contig_count`` and ``prophage_region_count`` above zero.
- ``counts_by_species_year``: species_code, year (null when undated), genome_count.
- ``counts_by_species_st``: species_code, mlst_scheme, st, genome_count.
- ``counts_by_source``: species_code, source_type, country, genome_count.
- ``counts_by_platform``: species_code, platform, assembly_status, genome_count.
- ``amr_class_by_species``: species_code, drug_class (palette key, by the
  palette match lists), genome_count (genomes with a hit in the class),
  fraction (of the species' genomes), hit_count. Hits are those counted in
  ``amr_gene_count`` (``ingest.summary.is_amr_gene``).
- ``amr_class_by_genome`` (contract 0.9 §6.2): genome_id, species_code,
  drug_class, hit_count, one row per genome and class with at least one hit.
  It counts the same hits, classified the same way, as
  ``amr_class_by_species``, so that per class its distinct genomes give
  ``genome_count`` and its sums give ``hit_count`` there, and per genome its
  sum is ``amr_gene_count``.
- ``qc``: genome_id, species_code, completeness, contamination, flag
  (``pass``, ``fail``, ``missing``; thresholds from ``platform.yaml`` qc).
- ``presence_amr``: genome_id, species_code, then one BOOLEAN column per
  element name of the hits counted in ``amr_gene_count``, columns sorted;
  ``presence_mob`` likewise per ``mob_cluster_id``, and ``presence_replicon``
  (contract 0.9 §6.2) per replicon type, the values of
  ``contig.replicon_types`` over all contigs of the genome. Every genome of
  the release has a row in each presence file, all false when it has none.
- ``search_index``: term, kind, target, species_code, count, one row per term,
  kind and species; ``count`` is the number of genomes. Targets use the
  requirements §5.3 routes (decision 9): ``/genomes/<id>`` for genome ids and
  accessions, ``/genes/symbol/<gene>``, ``/genes/element/<name>``,
  ``/?q=<JSON>`` for an ST, ``/genes?search=<product>`` for a product
  (milestone 1a decision 4b), with path segments and query values
  percent-encoded.

Every file is sorted by its leading keys. The pangenome presence files and
the rarefaction curves need a pangenome and are written from milestone 4a.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from urllib.parse import quote

import duckdb
import polars as pl

from ingest.config import PaletteConfig, PlatformConfig
from ingest.drug_classes import classify
from ingest.release.tables import ONE, copy_query
from ingest.summary import HitFact, is_amr_gene, render_st

SUMMARIES = "summaries"
PASS, FAIL, MISSING = "pass", "fail", "missing"


def _write(con: duckdb.DuckDBPyConnection, df: pl.DataFrame, path: Path, order: list[str]) -> None:
    con.register("_summary", df)
    try:
        keys = ", ".join(f'"{c}" NULLS LAST' for c in order)
        copy_query(con, f"SELECT * FROM _summary ORDER BY {keys}", path, ONE)
    finally:
        con.unregister("_summary")


def _sql(con: duckdb.DuckDBPyConnection, query: str, path: Path) -> None:
    copy_query(con, query, path, ONE)


def _amr_hits(con: duckdb.DuckDBPyConnection) -> list[tuple[str, str, HitFact]]:
    rows = con.execute(
        """SELECT h.genome_id, g.species_code, h.source_tool, h.element_name, h.element_type,
                  h.element_subtype, h.drug_class, h.drug_subclass, h.location_class, h.contig_id
        FROM annotation_hit h JOIN genome g USING (genome_id)
        ORDER BY h.genome_id, h.hit_id"""
    ).fetchall()
    out = [(r[0], r[1], HitFact(*r[2:])) for r in rows]
    return [x for x in out if is_amr_gene(x[2])]


def _presence(con: duckdb.DuckDBPyConnection, pairs: set[tuple[str, str]], path: Path) -> None:
    genomes = con.execute("SELECT genome_id, species_code FROM genome ORDER BY 1").fetchall()
    columns = sorted({c for _, c in pairs})
    data: dict[str, Any] = {
        "genome_id": [g for g, _ in genomes],
        "species_code": [s for _, s in genomes],
    }
    for c in columns:
        data[c] = [(g, c) in pairs for g, _ in genomes]
    schema: dict[str, Any] = {"genome_id": pl.String, "species_code": pl.String}
    schema |= {c: pl.Boolean for c in columns}
    _write(con, pl.DataFrame(data, schema=schema), path, ["genome_id"])


def _search_index(con: duckdb.DuckDBPyConnection) -> pl.DataFrame:
    rows: list[tuple[str, str, str, str | None, int]] = []
    for gid, code in con.execute("SELECT genome_id, species_code FROM genome").fetchall():
        rows.append((gid, "genome_id", f"/genomes/{quote(gid, safe='')}", code, 1))
    for gid, code, accession in con.execute(
        """SELECT genome_id, species_code, unnest([biosample_accession, assembly_accession,
        sra_accession]) FROM genome"""
    ).fetchall():
        if accession:
            rows.append((accession, "accession", f"/genomes/{quote(gid, safe='')}", code, 1))
    for gene, code, n in con.execute(
        """SELECT f.gene, g.species_code, count(DISTINCT f.genome_id) FROM feature f
        JOIN genome g USING (genome_id) WHERE f.gene IS NOT NULL GROUP BY 1, 2"""
    ).fetchall():
        rows.append((gene, "gene", f"/genes/symbol/{quote(gene, safe='')}", code, n))
    for element, code, n in con.execute(
        """SELECT h.element_name, g.species_code, count(DISTINCT h.genome_id)
        FROM annotation_hit h JOIN genome g USING (genome_id) GROUP BY 1, 2"""
    ).fetchall():
        rows.append((element, "element", f"/genes/element/{quote(element, safe='')}", code, n))
    for product, code, n in con.execute(
        """SELECT f.product, g.species_code, count(DISTINCT f.genome_id) FROM feature f
        JOIN genome g USING (genome_id) WHERE f.product IS NOT NULL GROUP BY 1, 2"""
    ).fetchall():
        rows.append((product, "product", f"/genes?search={quote(product, safe='')}", code, n))
    for st, code, n in con.execute(
        "SELECT st, species_code, count(*) FROM genome WHERE st IS NOT NULL GROUP BY 1, 2"
    ).fetchall():
        term = render_st(st)
        if term is None:
            continue
        query = json.dumps({"species_code": [code], "st": [st]}, separators=(",", ":"))
        rows.append((term, "st", f"/?q={quote(query, safe='')}", code, n))
    return pl.DataFrame(
        rows,
        schema={
            "term": pl.String,
            "kind": pl.String,
            "target": pl.String,
            "species_code": pl.String,
            "count": pl.Int64,
        },
        orient="row",
    )


def write_summaries(
    con: duckdb.DuckDBPyConnection, root: Path, palette: PaletteConfig, config: PlatformConfig
) -> list[str]:
    """Write every summary of §6.2 that milestone 1a can compute; returns relative paths."""
    out = root / SUMMARIES
    written: list[str] = []

    def done(path: Path) -> None:
        written.append(path.relative_to(root).as_posix())

    path = out / "counts_by_species.parquet"
    _sql(
        con,
        """SELECT g.species_code, s.canonical_name, s.color, count(*)::INTEGER AS genome_count,
               count(*) FILTER (WHERE g.assembly_status = 'complete')::INTEGER AS complete_count,
               count(DISTINCT g.st)::INTEGER AS st_count,
               sum(g.amr_gene_count)::INTEGER AS amr_hit_count,
               sum(g.plasmid_contig_count)::INTEGER AS plasmid_contig_count,
               count(*) FILTER (WHERE g.plasmid_contig_count > 0)::INTEGER
                   AS plasmid_genome_count,
               count(*) FILTER (WHERE g.prophage_region_count > 0)::INTEGER
                   AS prophage_genome_count
        FROM genome g JOIN species_registry s USING (species_code)
        GROUP BY 1, 2, 3 ORDER BY 1""",
        path,
    )
    done(path)
    grouped = {
        "counts_by_species_year": "year(isolation_date)::INTEGER AS year",
        "counts_by_species_st": "mlst_scheme, st",
        "counts_by_source": "source_type, country",
        "counts_by_platform": "platform, assembly_status",
    }
    for name, columns in grouped.items():
        path = out / f"{name}.parquet"
        n = columns.count(",") + 2
        keys = ", ".join(str(i) for i in range(1, n + 1))
        order = ", ".join(f"{i} NULLS LAST" for i in range(1, n + 1))
        _sql(
            con,
            f"""SELECT species_code, {columns}, count(*)::INTEGER AS genome_count FROM genome
            GROUP BY {keys} ORDER BY {order}""",
            path,
        )
        done(path)

    hits = _amr_hits(con)
    species_sizes = dict(
        con.execute("SELECT species_code, count(*) FROM genome GROUP BY 1").fetchall()
    )
    classes: dict[tuple[str, str], tuple[set[str], int]] = {}
    by_genome: dict[tuple[str, str, str], int] = {}
    for gid, code, hit in hits:
        _, entry = classify(hit.drug_class, hit.drug_subclass, palette)
        genomes, count = classes.get((code, entry.key), (set[str](), 0))
        genomes.add(gid)
        classes[(code, entry.key)] = (genomes, count + 1)
        by_genome[(gid, code, entry.key)] = by_genome.get((gid, code, entry.key), 0) + 1
    rows = [
        (code, key, len(g), len(g) / species_sizes[code], n)
        for (code, key), (g, n) in classes.items()
    ]
    path = out / "amr_class_by_species.parquet"
    _write(
        con,
        pl.DataFrame(
            rows,
            schema={
                "species_code": pl.String,
                "drug_class": pl.String,
                "genome_count": pl.Int32,
                "fraction": pl.Float64,
                "hit_count": pl.Int32,
            },
            orient="row",
        ),
        path,
        ["species_code", "drug_class"],
    )
    done(path)

    path = out / "amr_class_by_genome.parquet"
    _write(
        con,
        pl.DataFrame(
            [(gid, code, key, n) for (gid, code, key), n in by_genome.items()],
            schema={
                "genome_id": pl.String,
                "species_code": pl.String,
                "drug_class": pl.String,
                "hit_count": pl.Int32,
            },
            orient="row",
        ),
        path,
        ["genome_id", "species_code", "drug_class"],
    )
    done(path)

    path = out / "qc.parquet"
    qc = config.qc
    _sql(
        con,
        f"""SELECT genome_id, species_code, checkm2_completeness AS completeness,
               checkm2_contamination AS contamination,
               CASE WHEN checkm2_completeness IS NULL OR checkm2_contamination IS NULL
                    THEN '{MISSING}'
                    WHEN checkm2_completeness >= {qc.completeness_min}
                         AND checkm2_contamination <= {qc.contamination_max} THEN '{PASS}'
                    ELSE '{FAIL}' END AS flag
        FROM genome ORDER BY genome_id""",
        path,
    )
    done(path)

    path = root / "presence_amr.parquet"
    _presence(con, {(gid, hit.element_name) for gid, _, hit in hits}, path)
    done(path)
    path = root / "presence_mob.parquet"
    mob = con.execute(
        "SELECT DISTINCT genome_id, mob_cluster_id FROM contig WHERE mob_cluster_id IS NOT NULL"
    ).fetchall()
    _presence(con, {(g, c) for g, c in mob}, path)
    done(path)
    path = root / "presence_replicon.parquet"
    replicons = con.execute(
        """SELECT DISTINCT genome_id, unnest(replicon_types) FROM contig
        WHERE replicon_types IS NOT NULL"""
    ).fetchall()
    _presence(con, {(g, r) for g, r in replicons if r is not None}, path)
    done(path)

    path = out / "search_index.parquet"
    _write(con, _search_index(con), path, ["term", "kind", "species_code", "target"])
    done(path)
    return written
