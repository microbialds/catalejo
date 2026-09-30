"""MLST parser (contract §4.1, feeding ``genome.mlst_scheme`` and ``st``, §5.2, the
third species source of §3.3, and ``typing`` rows, §5.9).

The report is one line without a header: the assembly file (never keyed on),
the scheme, the sequence type and one ``gene(allele)`` column per locus. A
scheme or ST of ``-`` is missing and becomes None; alleles are kept as written
(``~2`` for a novel allele, ``2?`` for a partial match).
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from ingest import mgap_layout as L
from ingest.parsers._io import ParseError, optional, read_rows


@dataclass(frozen=True)
class MlstResult:
    scheme: str | None
    st: str | None
    alleles: tuple[tuple[str, str], ...]  # (gene, allele) in file order


def parse_mlst(results_dir: Path, sample: str, prefix: str) -> MlstResult | None:
    """The MLST result of ``sample``, or None when the report is absent or empty."""
    ml = L.MLST
    path = ml.report.resolve(results_dir, sample, prefix)
    if not path.is_file():
        return None
    rows = read_rows(path)
    if not rows:
        return None
    row = rows[0]
    width = len(ml.table.columns)
    if len(row) < width:
        raise ParseError(f"{path}: expected at least {width} columns, found {len(row)}")
    alleles: list[tuple[str, str]] = []
    for cell in row[width:]:
        m = ml.allele_re.match(cell.strip())
        if m is None:
            raise ParseError(f"{path}: allele column {cell!r} is not gene(allele)")
        alleles.append((m.group("gene"), m.group("allele")))
    return MlstResult(
        scheme=optional(row[1], ml.missing),
        st=optional(row[2], ml.missing),
        alleles=tuple(alleles),
    )
