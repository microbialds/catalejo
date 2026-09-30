"""Kraken2 and Bracken parser (contract §4.1, feeding ``genome.kraken2_top_taxon``
and ``kraken2_top_fraction``, §5.2, and the fourth species source of §3.3).

The top species is the species with the largest estimate: from Bracken when
its report exists (``fraction_total_reads``), else from the Kraken2 report
(the species-rank row with the most clade reads, its percentage divided by
100). ``top_fraction`` is therefore a fraction of all reads, 0 to 1, from
either source, and ``source`` records which one gave it.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from ingest import mgap_layout as L
from ingest.parsers._io import ParseError, read_rows, read_table


@dataclass(frozen=True)
class Kraken2Result:
    top_taxon: str | None
    top_fraction: float | None
    taxid: str | None
    source: str  # L.BRACKEN.tool or L.KRAKEN2.tool


def _from_bracken(path: Path) -> Kraken2Result | None:
    c = L.BRACKEN.columns
    rows = [
        r for r in read_table(path, L.BRACKEN.table) if r[c.taxonomy_lvl] == L.BRACKEN.level_species
    ]
    if not rows:
        return None
    best = max(rows, key=lambda r: (float(r[c.fraction_total_reads]), r[c.name]))
    return Kraken2Result(
        top_taxon=best[c.name].strip(),
        top_fraction=float(best[c.fraction_total_reads]),
        taxid=best[c.taxonomy_id],
        source=L.BRACKEN.tool,
    )


def _from_kraken2(path: Path) -> Kraken2Result:
    k = L.KRAKEN2
    width = len(k.table.columns)
    best: tuple[int, str, float, str] | None = None
    for row in read_rows(path):
        if len(row) < width:
            raise ParseError(f"{path}: expected {width} columns, found {len(row)}")
        percent, clade, _, rank, taxid, name = row[:width]
        if rank != k.rank_species:
            continue
        candidate = (int(clade), name.strip(), float(percent), taxid)
        if best is None or candidate[0] > best[0]:
            best = candidate
    if best is None:
        return Kraken2Result(None, None, None, k.tool)
    return Kraken2Result(best[1], round(best[2] / 100.0, 6), best[3], k.tool)


def parse_kraken2(results_dir: Path, sample: str, prefix: str) -> Kraken2Result | None:
    """The top species of ``sample``, or None when neither report exists."""
    bracken = L.BRACKEN.report.resolve(results_dir, sample, prefix)
    if bracken.is_file():
        result = _from_bracken(bracken)
        if result is not None:
            return result
    report = L.KRAKEN2.report.resolve(results_dir, sample, prefix)
    if not report.is_file():
        return None
    return _from_kraken2(report)
