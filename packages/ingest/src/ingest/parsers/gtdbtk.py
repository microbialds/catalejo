"""GTDB-Tk parser (contract §4.1, provisional; feeds ``genome.gtdb_classification``
and ``gtdb_closest_reference``, §5.2, and the second species source of §3.3).

GTDB-Tk classifies every genome of a run in one call, so its summary is a
run-level table keyed by ``user_genome``, the stem of the assembly GTDB-Tk
received. Since that name is not fixed by mgap yet, a genome's row is the
first whose ``user_genome`` equals one of the names the genome goes by, in
the order given (genome_id, mgap sample, file prefix). A species of ``s__``
with no name is unclassified at species level.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

from ingest import mgap_layout as L
from ingest.parsers._io import optional, read_table


@dataclass(frozen=True)
class GtdbTkResult:
    user_genome: str
    classification: str | None
    species: str | None  # the s__ name, without the prefix
    closest_reference: str | None


def species_from_lineage(lineage: str | None) -> str | None:
    if lineage is None:
        return None
    g = L.GTDBTK
    for rank in lineage.split(g.rank_separator):
        rank = rank.strip()
        if rank.startswith(g.species_prefix):
            return optional(rank[len(g.species_prefix) :])
    return None


def parse_gtdbtk_summary(results_dir: Path) -> dict[str, GtdbTkResult]:
    """Every row of the run-level summary by ``user_genome``; empty when it is absent."""
    g = L.GTDBTK
    path = g.summary.resolve(results_dir)
    if not path.is_file():
        return {}
    c = g.columns
    out: dict[str, GtdbTkResult] = {}
    for row in read_table(path, g.table):
        lineage = optional(row[c.classification], g.missing)
        out[row[c.user_genome]] = GtdbTkResult(
            user_genome=row[c.user_genome],
            classification=lineage,
            species=species_from_lineage(lineage),
            closest_reference=optional(row[c.closest_genome_reference], g.missing),
        )
    return out


def gtdbtk_for(summary: dict[str, GtdbTkResult], names: Iterable[str]) -> GtdbTkResult | None:
    """The row of the first of ``names`` present in ``summary``."""
    for name in names:
        if name in summary:
            return summary[name]
    return None


def parse_gtdbtk(
    results_dir: Path, sample: str, prefix: str, genome_id: str | None = None
) -> GtdbTkResult | None:
    """The GTDB-Tk row of ``sample``, or None when it was not classified."""
    names = [n for n in (genome_id, sample, prefix) if n]
    return gtdbtk_for(parse_gtdbtk_summary(results_dir), names)
