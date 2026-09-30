"""Shared reader of the one-genome typing reports (Kleborate, SISTR, sccmec; contract §5.9)."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from ingest import mgap_layout as L
from ingest.parsers._io import ParseError, optional, read_table


@dataclass(frozen=True)
class TypingResult:
    """Key and value pairs of one typing tool for one genome, in column order.

    Keys are the column names as the tool writes them; empty values and the
    tool's missing marker are left out.
    """

    tool: str
    values: tuple[tuple[str, str], ...]

    def get(self, key: str) -> str | None:
        for k, v in self.values:
            if k == key:
                return v
        return None


def read_typing(path: Path, table: L.Table, tool: str, missing: str) -> TypingResult | None:
    if not path.is_file():
        return None
    rows = read_table(path, table)
    if not rows:
        return None
    if len(rows) != 1:
        raise ParseError(f"{path}: expected one genome, found {len(rows)} rows")
    values = tuple(
        (key, text) for key, value in rows[0].items() if (text := optional(value, missing))
    )
    return TypingResult(tool=tool, values=values)
