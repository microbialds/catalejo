"""QUAST parser (contract §4.1, assembly statistics kept as a cross-check).

The report is transposed, one statistic per row. The catalog takes genome
size, contig count, N50 and GC from the Bakta contigs so that they agree with
the ``contig`` table; QUAST counts only contigs of at least 500 bp in its
unqualified rows, and its values are kept for comparison.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from ingest import mgap_layout as L
from ingest.parsers._io import read_labels, to_float, to_int


@dataclass(frozen=True)
class QuastResult:
    contigs_all: int | None  # contigs of any length
    total_length_all: int | None
    contigs: int | None  # contigs of at least QuastLayout.min_contig
    total_length: int | None
    largest_contig: int | None
    n50: int | None
    gc_percent: float | None


def parse_quast(results_dir: Path, sample: str, prefix: str) -> QuastResult | None:
    """The QUAST statistics of ``sample``, or None when the report is absent."""
    path = L.QUAST.report.resolve(results_dir, sample, prefix)
    if not path.is_file():
        return None
    values = read_labels(path, L.QUAST.table)
    r = L.QUAST.rows
    return QuastResult(
        contigs_all=to_int(values[r.contigs_0]),
        total_length_all=to_int(values[r.length_0]),
        contigs=to_int(values[r.contigs]),
        total_length=to_int(values[r.total_length]),
        largest_contig=to_int(values[r.largest_contig]),
        n50=to_int(values[r.n50]),
        gc_percent=to_float(values[r.gc_percent]),
    )
