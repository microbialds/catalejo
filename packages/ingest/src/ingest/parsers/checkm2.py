"""CheckM2 parser (contract §4.1, feeding ``genome.checkm2_completeness`` and
``checkm2_contamination``, §5.2).

The report holds one genome; its ``Name`` comes from the assembly file and is
never keyed on. Both values are percentages as CheckM2 writes them.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from ingest import mgap_layout as L
from ingest.parsers._io import ParseError, read_table, to_float


@dataclass(frozen=True)
class CheckM2Result:
    completeness: float | None
    contamination: float | None


def parse_checkm2(results_dir: Path, sample: str, prefix: str) -> CheckM2Result | None:
    """The CheckM2 result of ``sample``, or None when the report is absent."""
    path = L.CHECKM2.report.resolve(results_dir, sample, prefix)
    if not path.is_file():
        return None
    rows = read_table(path, L.CHECKM2.table)
    if len(rows) != 1:
        raise ParseError(f"{path}: expected one genome, found {len(rows)} rows")
    c = L.CHECKM2.columns
    return CheckM2Result(
        completeness=to_float(rows[0][c.completeness]),
        contamination=to_float(rows[0][c.contamination]),
    )
