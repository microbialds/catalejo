"""``metadata.csv``: writing it from mgap results and validating it (contract §4.2, §8.1, §9).

``metadata init`` lists the samples of an mgap results directory (a directory
is a sample when it holds a Bakta directory) and writes one row per sample
with the derivable columns filled: ``genome_id`` proposed from the sample name
by ``sample_name_rules`` in ``config/platform.yaml``, ``mgap_sample``, and
``platform`` from the assembly directory. ``species`` is never filled, since a
filled value would always win over the tools (§3.3) and hide conflicts
(milestone 1a plan, decision 6).

With an existing file, manual entries win (§4.2): an existing row is matched
to a sample by its ``mgap_sample``, else by its ``genome_id`` (equal to the
sample name or to the genome_id proposed for it), and every non-empty cell of
it is kept. Unrecognized columns are kept after the recognized ones, and rows
for samples no longer in the results are kept with a warning. Output is
deterministic: rows ordered by ``genome_id``, recognized columns in the order
of ``side_tables.METADATA``, then the extra columns in their existing order.

``validate_metadata`` returns ``Issue`` values, one rule per function, so that
``ingest`` and ``release check`` can repeat the input rules of §9.
"""

from __future__ import annotations

import io
import re
from dataclasses import dataclass, field
from datetime import date
from functools import cache
from importlib import resources
from pathlib import Path

import polars as pl

from ingest import mgap_layout as L
from ingest.config import PlatformConfig, SpeciesRegistry
from ingest.issues import FAILURE, Issue
from ingest.side_tables import METADATA

COLUMNS = METADATA.columns
RECOGNIZED: tuple[str, ...] = COLUMNS.names()
COMMA = ","
TAB = "\t"

# Rule identifiers (contract §9, input rules).
RULE_COLUMNS = "metadata.columns"
RULE_GENOME_ID_MISSING = "genome_id.missing"
RULE_GENOME_ID_PATTERN = "genome_id.pattern"
RULE_GENOME_ID_DUPLICATE = "genome_id.duplicate"
RULE_SAMPLE_ABSENT = "metadata.mgap_sample_absent"
RULE_SAMPLE_DUPLICATE = "metadata.mgap_sample_duplicate"
RULE_DATE = "metadata.isolation_date"
RULE_SOURCE_TYPE = "metadata.source_type"
RULE_PLATFORM = "metadata.platform"
RULE_COUNTRY = "metadata.country"
RULE_SPECIES = "genome.species_unregistered"

_DATE_FORMATS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"^(\d{4})$"), "year"),
    (re.compile(r"^(\d{4})-(\d{2})$"), "month"),
    (re.compile(r"^(\d{4})-(\d{2})-(\d{2})$"), "day"),
)


class MetadataError(Exception):
    """The metadata file or the results directory cannot be read."""


@dataclass
class MetadataFile:
    """The columns and rows of a metadata table, every value as text."""

    columns: list[str]
    rows: list[dict[str, str]]

    def extra_columns(self) -> list[str]:
        return [c for c in self.columns if c not in RECOGNIZED]


# Reading and writing ----------------------------------------------------------------------------


def _separator(path: Path, first_line: str) -> str:
    if path.suffix.lower() == ".tsv":
        return TAB
    return TAB if first_line.count(TAB) > first_line.count(COMMA) else COMMA


def read_metadata(path: Path) -> MetadataFile:
    """A CSV or TSV metadata table (§4.2), values as stripped text."""
    if not path.is_file():
        raise MetadataError(f"no metadata file at {path}")
    text = path.read_text(encoding="utf-8-sig")
    if not text.strip():
        raise MetadataError(f"{path} is empty")
    separator = _separator(path, text.splitlines()[0])
    try:
        frame = pl.read_csv(
            io.BytesIO(text.encode("utf-8")),
            separator=separator,
            infer_schema=False,
            empty_string_is_null=False,
        )
    except pl.exceptions.PolarsError as exc:
        raise MetadataError(f"{path}: {exc}") from exc
    columns = [c.strip() for c in frame.columns]
    rows: list[dict[str, str]] = []
    for raw in frame.iter_rows():
        values = ("" if v is None else str(v).strip() for v in raw)
        rows.append(dict(zip(columns, values, strict=True)))
    return MetadataFile(columns=columns, rows=rows)


def write_metadata(path: Path, table: MetadataFile) -> None:
    """Write ``table`` as CSV with the given column order; empty cells are written empty."""
    data = {c: [row.get(c) or None for row in table.rows] for c in table.columns}
    frame = pl.DataFrame(data, schema={c: pl.String for c in table.columns})
    path.parent.mkdir(parents=True, exist_ok=True)
    frame.write_csv(path, line_terminator="\n", null_value="")


# Samples ----------------------------------------------------------------------------------------


def list_samples(results_dir: Path) -> list[str]:
    """Sample directories of the results: those that hold a Bakta directory, sorted."""
    if not results_dir.is_dir():
        raise MetadataError(f"no mgap results directory at {results_dir}")
    return sorted(
        p.name
        for p in results_dir.iterdir()
        if p.is_dir() and L.BAKTA.directory.resolve(results_dir, p.name).is_dir()
    )


def effective_sample(row: dict[str, str]) -> str:
    """The row's mgap sample: ``mgap_sample``, defaulting to ``genome_id`` (§4.2)."""
    return row.get(COLUMNS.mgap_sample, "") or row.get(COLUMNS.genome_id, "")


# Init -------------------------------------------------------------------------------------------


@dataclass
class InitResult:
    table: MetadataFile
    samples: int
    matched: int
    new: int
    orphans: list[str] = field(default_factory=list[str])  # genome_ids kept without a sample

    def warnings(self) -> list[str]:
        return [
            f"row {gid} kept, but its mgap sample is not in the results" for gid in self.orphans
        ]


def derived_row(results_dir: Path, sample: str, config: PlatformConfig) -> dict[str, str]:
    return {
        COLUMNS.genome_id: config.genome_id_from_sample(sample),
        COLUMNS.mgap_sample: sample,
        COLUMNS.platform: L.detect_platform(results_dir, sample) or "",
    }


def init_metadata(
    results_dir: Path, config: PlatformConfig, existing: MetadataFile | None = None
) -> InitResult:
    """The metadata table for ``results_dir``, merged with ``existing`` (module docstring)."""
    samples = list_samples(results_dir)
    derived = {s: derived_row(results_dir, s, config) for s in samples}
    by_genome_id: dict[str, str] = {}
    for s in samples:
        by_genome_id.setdefault(s, s)
    for s in samples:
        by_genome_id.setdefault(derived[s][COLUMNS.genome_id], s)

    matched: dict[str, dict[str, str]] = {}
    orphans: list[dict[str, str]] = []
    for row in existing.rows if existing else []:
        mgap_sample = row.get(COLUMNS.mgap_sample, "")
        if mgap_sample:
            sample = mgap_sample if mgap_sample in derived else None
        else:
            sample = by_genome_id.get(row.get(COLUMNS.genome_id, ""))
        if sample is None or sample in matched:
            orphans.append(row)
        else:
            matched[sample] = row

    rows: list[dict[str, str]] = []
    for s in samples:
        out = dict(derived[s])
        for column, value in matched.get(s, {}).items():
            if value:
                out[column] = value
        rows.append(out)
    rows += [dict(r) for r in orphans]
    rows.sort(key=lambda r: (r.get(COLUMNS.genome_id, ""), effective_sample(r)))
    extra = existing.extra_columns() if existing else []
    table = MetadataFile(columns=[*RECOGNIZED, *extra], rows=rows)
    return InitResult(
        table=table,
        samples=len(samples),
        matched=len(matched),
        new=len(samples) - len(matched),
        orphans=[r.get(COLUMNS.genome_id, "") for r in orphans],
    )


# Validation -------------------------------------------------------------------------------------


def parse_isolation_date(text: str) -> tuple[date, str]:
    """A date written ``YYYY``, ``YYYY-MM`` or ``YYYY-MM-DD`` and its precision (§4.2).

    Year and month precision give the first day of the period. Raises
    ``ValueError`` for any other form or an impossible date.
    """
    for pattern, precision in _DATE_FORMATS:
        m = pattern.match(text.strip())
        if m is not None:
            parts = [int(x) for x in m.groups()] + [1] * (3 - len(m.groups()))
            return date(parts[0], parts[1], parts[2]), precision
    raise ValueError(f"not YYYY, YYYY-MM or YYYY-MM-DD: {text!r}")


@cache
def country_codes() -> frozenset[str]:
    """ISO 3166-1 alpha-2 codes, from the list shipped with the package."""
    text = resources.files("ingest").joinpath("data", "iso3166_alpha2.txt").read_text("utf-8")
    return frozenset(
        line.strip() for line in text.splitlines() if line.strip() and not line.startswith("#")
    )


def _gid(row: dict[str, str]) -> str | None:
    return row.get(COLUMNS.genome_id) or None


def check_columns(table: MetadataFile) -> list[Issue]:
    if COLUMNS.genome_id not in table.columns:
        return [Issue(RULE_COLUMNS, FAILURE, f"no {COLUMNS.genome_id} column")]
    return []


def check_genome_id_pattern(table: MetadataFile, config: PlatformConfig) -> list[Issue]:
    """Every genome_id is present and matches ``genome_id_pattern`` (§3.1, §9)."""
    out: list[Issue] = []
    regex = config.genome_id_regex
    for n, row in enumerate(table.rows, start=2):
        gid = row.get(COLUMNS.genome_id, "")
        if not gid:
            out.append(Issue(RULE_GENOME_ID_MISSING, FAILURE, f"line {n} has no genome_id"))
        elif not regex.match(gid):
            out.append(
                Issue(
                    RULE_GENOME_ID_PATTERN,
                    FAILURE,
                    f"{gid!r} does not match {config.genome_id_pattern}",
                    gid,
                )
            )
    return out


def check_genome_id_unique(table: MetadataFile) -> list[Issue]:
    """No two genome_ids are equal without regard to case (§3.1, §9)."""
    seen: dict[str, str] = {}
    out: list[Issue] = []
    for row in table.rows:
        gid = row.get(COLUMNS.genome_id, "")
        if not gid:
            continue
        key = gid.casefold()
        if key in seen:
            out.append(
                Issue(
                    RULE_GENOME_ID_DUPLICATE,
                    FAILURE,
                    f"{gid!r} equals {seen[key]!r} without regard to case",
                    gid,
                )
            )
        else:
            seen[key] = gid
    return out


def check_mgap_sample_present(table: MetadataFile, samples: list[str]) -> list[Issue]:
    """Every mgap_sample (default genome_id) is a sample of the results (§9)."""
    present = set(samples)
    return [
        Issue(
            RULE_SAMPLE_ABSENT,
            FAILURE,
            f"mgap sample {effective_sample(row)!r} is not in the results",
            _gid(row),
        )
        for row in table.rows
        if effective_sample(row) and effective_sample(row) not in present
    ]


def check_mgap_sample_unique(table: MetadataFile) -> list[Issue]:
    """No mgap_sample is mapped by two genomes (§9)."""
    owner: dict[str, str] = {}
    out: list[Issue] = []
    for row in table.rows:
        sample = effective_sample(row)
        if not sample:
            continue
        gid = row.get(COLUMNS.genome_id, "")
        if sample in owner:
            out.append(
                Issue(
                    RULE_SAMPLE_DUPLICATE,
                    FAILURE,
                    f"mgap sample {sample!r} is mapped by {owner[sample]!r} and {gid!r}",
                    gid or None,
                )
            )
        else:
            owner[sample] = gid
    return out


def check_isolation_date(table: MetadataFile) -> list[Issue]:
    """Every isolation_date parses at year, month or day precision (§4.2, §9)."""
    out: list[Issue] = []
    for row in table.rows:
        value = row.get(COLUMNS.isolation_date, "")
        if not value:
            continue
        try:
            parse_isolation_date(value)
        except ValueError as exc:
            out.append(Issue(RULE_DATE, FAILURE, str(exc), _gid(row)))
    return out


def _vocabulary(
    table: MetadataFile, column: str, allowed: frozenset[str], rule: str, hint: str
) -> list[Issue]:
    return [
        Issue(rule, FAILURE, f"{column} {row[column]!r} is not {hint}", _gid(row))
        for row in table.rows
        if row.get(column) and row[column] not in allowed
    ]


def check_source_type(table: MetadataFile) -> list[Issue]:
    allowed = frozenset(METADATA.source_types)
    hint = "one of " + ", ".join(METADATA.source_types)
    return _vocabulary(table, COLUMNS.source_type, allowed, RULE_SOURCE_TYPE, hint)


def check_platform(table: MetadataFile) -> list[Issue]:
    allowed = frozenset(METADATA.platforms)
    hint = "one of " + ", ".join(METADATA.platforms)
    return _vocabulary(table, COLUMNS.platform, allowed, RULE_PLATFORM, hint)


def check_country(table: MetadataFile) -> list[Issue]:
    hint = "an ISO 3166-1 alpha-2 code (two upper-case letters)"
    return _vocabulary(table, COLUMNS.country, country_codes(), RULE_COUNTRY, hint)


def check_species(table: MetadataFile, registry: SpeciesRegistry) -> list[Issue]:
    """A metadata species must name a registry species (§3.3, §9)."""
    return [
        Issue(
            RULE_SPECIES,
            FAILURE,
            f"species {row[COLUMNS.species]!r} is not a name or alias in the species registry",
            _gid(row),
        )
        for row in table.rows
        if row.get(COLUMNS.species) and registry.by_name(row[COLUMNS.species]) is None
    ]


def validate_metadata(
    table: MetadataFile,
    config: PlatformConfig,
    registry: SpeciesRegistry,
    results_dir: Path | None = None,
) -> list[Issue]:
    """Every metadata rule of §4.2 and §9; the results rules only when ``results_dir`` is given."""
    issues = check_columns(table)
    if issues:
        return issues
    issues += check_genome_id_pattern(table, config)
    issues += check_genome_id_unique(table)
    issues += check_mgap_sample_unique(table)
    if results_dir is not None:
        issues += check_mgap_sample_present(table, list_samples(results_dir))
    issues += check_isolation_date(table)
    issues += check_source_type(table)
    issues += check_platform(table)
    issues += check_country(table)
    issues += check_species(table, registry)
    return issues
