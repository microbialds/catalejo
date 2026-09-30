"""sccmec parser (contract §4.1, provisional; feeds §5.9 ``typing``).

One genome per report; every column with a value becomes a key, filtered at
assembly by ``config/typing_display.yaml``.
"""

from __future__ import annotations

from pathlib import Path

from ingest import mgap_layout as L
from ingest.parsers._typing import TypingResult, read_typing


def parse_sccmec(results_dir: Path, sample: str, prefix: str) -> TypingResult | None:
    """sccmec typing of ``sample``, or None when sccmec did not run for it."""
    s = L.SCCMEC
    return read_typing(s.report.resolve(results_dir, sample, prefix), s.table, s.tool, s.missing)
