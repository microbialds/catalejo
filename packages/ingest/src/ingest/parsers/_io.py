"""Reading helpers shared by the parsers (contract §4.1).

Tables are read with Polars as text (no type inference, no quoting, empty
fields kept as empty strings) and checked against the columns declared in
``ingest.mgap_layout``: every declared column must be present, and extra
columns are ignored so that a tool adding a column does not break ingestion.
Every value is returned as text; the parsers convert what they use.
"""

from __future__ import annotations

import gzip
import io
from pathlib import Path
from typing import Any, cast

import polars as pl
import yaml

from ingest import mgap_layout as L
from ingest.parsers._fasta import fasta_records

__all__ = ["ParseError", "fasta_records"]

TAB = "\t"


class ParseError(Exception):
    """An mgap file does not have the declared shape."""


def _text(path: Path) -> str:
    if path.suffix == ".gz":
        with gzip.open(path, "rt", encoding="utf-8") as fh:
            return fh.read()
    return path.read_text(encoding="utf-8")


def _frame(text: str, separator: str, path: Path) -> list[dict[str, str]]:
    if not text.strip():
        return []
    try:
        frame = pl.read_csv(
            io.BytesIO(text.encode("utf-8")),
            separator=separator,
            infer_schema=False,
            quote_char=None,
            empty_string_is_null=False,
        )
    except pl.exceptions.PolarsError as exc:
        raise ParseError(f"{path}: {exc}") from exc
    out: list[dict[str, str]] = []
    for row in frame.iter_rows(named=True):
        typed: dict[str, Any] = row
        out.append({str(k): "" if v is None else str(v) for k, v in typed.items()})
    return out


def _check(path: Path, table: L.Table, header: list[str]) -> None:
    missing = [c for c in table.columns if c not in header]
    if missing:
        raise ParseError(f"{path}: missing columns {missing}")


def read_table(path: Path, table: L.Table) -> list[dict[str, str]]:
    """Rows of a headed table (``FIRST_LINE`` or ``AFTER_COMMENTS``) as dictionaries."""
    text = _text(path)
    match table.header:
        case L.HeaderStyle.FIRST_LINE:
            pass
        case L.HeaderStyle.AFTER_COMMENTS:
            marker = table.header_prefix + table.columns[0]
            lines = text.splitlines(keepends=True)
            start = next((i for i, x in enumerate(lines) if x.startswith(marker)), None)
            if start is None:
                raise ParseError(f"{path}: no header line starting with {marker!r}")
            text = "".join(lines[start:])[len(table.header_prefix) :]
        case _:
            raise ValueError(f"read_table cannot read {table.header} tables")
    first = text.splitlines()[0] if text.strip() else ""
    _check(path, table, first.split(table.separator))
    return _frame(text, table.separator, path)


def read_rows(path: Path, separator: str = TAB) -> list[list[str]]:
    """Rows of a headerless table (``HeaderStyle.NONE``), ragged rows allowed."""
    return [line.split(separator) for line in _text(path).splitlines() if line.strip()]


def read_labels(path: Path, table: L.Table) -> dict[str, str]:
    """A transposed table (``HeaderStyle.ROW_LABELS``) as label to value."""
    out: dict[str, str] = {}
    for row in read_rows(path, table.separator):
        out[row[0]] = row[1] if len(row) > 1 else ""
    _check(path, table, list(out))
    return out


def read_versions_yml(path: Path) -> dict[str, dict[str, str]]:
    """An nf-core ``versions.yml``: process name to tool name to version, all as text.

    Loaded with the base loader so versions stay text (``2.10`` is not the
    number 2.1); an empty version (``rgi:``) is the empty string.
    """
    data: Any = yaml.load(_text(path), Loader=yaml.BaseLoader)  # noqa: S506
    if not isinstance(data, dict):
        raise ParseError(f"{path}: not a mapping of processes")
    out: dict[str, dict[str, str]] = {}
    mapping = cast(dict[Any, Any], data)
    for process, tools in mapping.items():
        if not isinstance(tools, dict):
            raise ParseError(f"{path}: {process!r} is not a mapping of tools")
        entries = cast(dict[Any, Any], tools)
        out[str(process)] = {str(k): str(v) for k, v in entries.items()}
    return out


def first_line(path: Path) -> str:
    """The first line of a (possibly gzip) text file."""
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", encoding="utf-8") as fh:
        return fh.readline().rstrip("\n")


def optional(value: str, *missing: str) -> str | None:
    """``value`` stripped, or None when it is empty or one of the ``missing`` markers."""
    text = value.strip()
    if not text or text in missing:
        return None
    return text


def to_int(value: str, *missing: str) -> int | None:
    text = optional(value, *missing)
    return None if text is None else int(text)


def to_float(value: str, *missing: str) -> float | None:
    text = optional(value, *missing)
    return None if text is None else float(text)


def split_list(value: str, separator: str, *missing: str) -> tuple[str, ...]:
    """A separated list, empty for a missing value; items are stripped and kept in order."""
    text = optional(value, *missing)
    if text is None:
        return ()
    return tuple(item.strip() for item in text.split(separator) if item.strip())
