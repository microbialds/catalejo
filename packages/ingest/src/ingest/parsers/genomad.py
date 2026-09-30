"""geNomad parser (contract §4.1, feeding §5.8 ``region`` and the contig
classification of §10 when MOB-suite did not run).

- Virus summary. A provirus is named ``<contig>|provirus_<start>_<end>`` and
  becomes a ``prophage`` region at those coordinates (1-based, inclusive). A
  virus reported for a whole contig is named by the contig, with coordinates
  ``NA``, and becomes a ``prophage`` region spanning the contig
  (``1..length``).
- Plasmid summary. Every row names a whole contig and becomes a
  ``plasmid_region`` spanning it.

``score`` is the virus or plasmid score. ``attributes`` holds the remaining
fields the platform shows: topology, gene and hallmark counts, marker
enrichment, FDR, and the virus taxonomy or the plasmid conjugation and AMR
genes (lists split on ``;``), with ``NA`` as null.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from ingest import mgap_layout as L
from ingest.parsers._io import ParseError, optional, read_table, split_list, to_float, to_int

PROPHAGE = "prophage"
PLASMID_REGION = "plasmid_region"


@dataclass(frozen=True)
class GenomadRegion:
    contig_id: str
    start: int
    end: int
    type: str  # PROPHAGE or PLASMID_REGION
    score: float | None
    attributes: dict[str, str | int | float | list[str] | None]


def _virus(row: dict[str, str]) -> GenomadRegion:
    g = L.GENOMAD
    c = g.virus_columns
    name = row[c.seq_name]
    length = int(row[c.length])
    m = g.provirus_name_re.match(name)
    if m is not None:
        contig, start, end = m.group("contig"), int(m.group("start")), int(m.group("end"))
        if end - start + 1 != length:
            raise ParseError(f"provirus {name} length {length} disagrees with its coordinates")
    else:
        contig, start, end = name, 1, length
    taxonomy = optional(row[c.taxonomy], g.missing)
    return GenomadRegion(
        contig_id=contig,
        start=start,
        end=end,
        type=PROPHAGE,
        score=to_float(row[c.virus_score], g.missing),
        attributes={
            c.topology: optional(row[c.topology], g.missing),
            c.n_genes: to_int(row[c.n_genes], g.missing),
            c.n_hallmarks: to_int(row[c.n_hallmarks], g.missing),
            c.marker_enrichment: to_float(row[c.marker_enrichment], g.missing),
            c.fdr: to_float(row[c.fdr], g.missing),
            c.taxonomy: taxonomy,
        },
    )


def _plasmid(row: dict[str, str]) -> GenomadRegion:
    g = L.GENOMAD
    c = g.plasmid_columns
    return GenomadRegion(
        contig_id=row[c.seq_name],
        start=1,
        end=int(row[c.length]),
        type=PLASMID_REGION,
        score=to_float(row[c.plasmid_score], g.missing),
        attributes={
            c.topology: optional(row[c.topology], g.missing),
            c.n_genes: to_int(row[c.n_genes], g.missing),
            c.n_hallmarks: to_int(row[c.n_hallmarks], g.missing),
            c.marker_enrichment: to_float(row[c.marker_enrichment], g.missing),
            c.fdr: to_float(row[c.fdr], g.missing),
            c.conjugation_genes: list(
                split_list(row[c.conjugation_genes], g.list_separator, g.missing)
            ),
            c.amr_genes: list(split_list(row[c.amr_genes], g.list_separator, g.missing)),
        },
    )


def parse_genomad(results_dir: Path, sample: str, prefix: str) -> tuple[GenomadRegion, ...] | None:
    """Prophage and plasmid regions of ``sample``, or None when geNomad did not run."""
    g = L.GENOMAD
    virus = g.virus_summary.resolve(results_dir, sample, prefix)
    plasmid = g.plasmid_summary.resolve(results_dir, sample, prefix)
    if not virus.is_file() and not plasmid.is_file():
        return None
    out: list[GenomadRegion] = []
    if virus.is_file():
        out += [_virus(row) for row in read_table(virus, g.virus_table)]
    if plasmid.is_file():
        out += [_plasmid(row) for row in read_table(plasmid, g.plasmid_table)]
    return tuple(out)
