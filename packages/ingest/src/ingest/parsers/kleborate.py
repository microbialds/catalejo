"""Kleborate parser (contract §4.1, feeding §5.9 ``typing``).

The report is the ``klebsiella_pneumo_complex`` preset output, one genome per
file; its ``strain`` column comes from the input file and is never keyed on.
Every column with a value becomes a key; ``config/typing_display.yaml``
decides at assembly which keys are stored and how they are grouped.
"""

from __future__ import annotations

from pathlib import Path

from ingest import mgap_layout as L
from ingest.parsers._typing import TypingResult, read_typing


def parse_kleborate(results_dir: Path, sample: str, prefix: str) -> TypingResult | None:
    """Kleborate typing of ``sample``, or None when Kleborate did not run for it."""
    k = L.KLEBORATE
    return read_typing(k.report.resolve(results_dir, sample, prefix), k.table, k.tool, k.missing)
