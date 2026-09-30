"""AMRFinderPlus parser (contract §4.1, feeding §5.5 ``annotation_hit`` and §5.6 ``mutation``).

Rows of the main report whose subtype is a mutation subtype
(``AmrFinderLayout.mutation_subtypes``: POINT per contract §5.6, and
POINT_DISRUPT by maintainer decision, pending contract edit) are point
mutations; every other row is an annotation hit. The mutations report
(``-mutations.tsv``, ``--mutation_all``) is read the same way for its
mutation rows, and a mutation already in the main report (same contig,
coordinates, strand and element symbol) is kept once.

Mutation rows whose element name ends in `` [WILDTYPE]`` or `` [UNKNOWN]``
are screened positions, not mutations, and are skipped (§5.6). The element
symbol splits at its last underscore into ``gene`` and ``variant``
(``gyrA_S83I`` gives ``gyrA`` and ``S83I``; ``blaSHV_C-112T`` gives
``blaSHV`` and ``C-112T``).

``variant_type`` is not derived by the contract; the rule here is: a variant
naming ``ins`` or ``del`` is an ``insertion`` or ``deletion``; otherwise a
variant ``<reference><position><alternative>`` with a negative position is a
``promoter`` variant, one whose alternative is longer or shorter than its
reference is an ``insertion`` or ``deletion`` (``D135DGD`` is an insertion),
one of equal lengths is a ``substitution`` (``S83I``, ``VM678EA``), and
anything else is ``other``.

The per-genome ``versions.yml`` (provisional) gives the tool and database
versions when it exists.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from ingest import mgap_layout as L
from ingest.parsers._io import ParseError, optional, read_table, read_versions_yml, to_float

VARIANT_RE = re.compile(r"^(?P<ref>[A-Za-z*]+)(?P<position>-?\d+)(?P<alt>[A-Za-z*]+)$")
INSERTION_MARK = "ins"
DELETION_MARK = "del"

SUBSTITUTION = "substitution"
DELETION = "deletion"
INSERTION = "insertion"
PROMOTER = "promoter"
OTHER = "other"


def variant_type(variant: str) -> str:
    """The §5.6 ``variant_type`` of an AMRFinderPlus variant (rule in the module docstring)."""
    lowered = variant.lower()
    if INSERTION_MARK in lowered:
        return INSERTION
    if DELETION_MARK in lowered:
        return DELETION
    m = VARIANT_RE.match(variant)
    if m is None:
        return OTHER
    if int(m.group("position")) < 0:
        return PROMOTER
    ref, alt = m.group("ref"), m.group("alt")
    if len(alt) > len(ref):
        return INSERTION
    if len(alt) < len(ref):
        return DELETION
    return SUBSTITUTION


def split_symbol(symbol: str) -> tuple[str, str]:
    """``gene`` and ``variant`` of a point mutation symbol, split at the last underscore."""
    m = L.AMRFINDERPLUS.point_symbol_re.match(symbol)
    if m is None:
        raise ValueError(f"point mutation symbol without an underscore: {symbol!r}")
    return m.group("gene"), m.group("variant")


@dataclass(frozen=True)
class AmrFinderHit:
    protein_id: str | None  # Bakta locus tag, None for nucleotide hits
    contig_id: str
    start: int
    end: int
    strand: str
    element_symbol: str
    element_name: str
    scope: str
    type: str
    subtype: str | None
    drug_class: str | None
    drug_subclass: str | None
    method: str
    coverage: float | None
    identity: float | None
    closest_accession: str | None


@dataclass(frozen=True)
class AmrFinderMutation:
    protein_id: str | None
    contig_id: str
    start: int
    end: int
    strand: str
    element_symbol: str
    gene: str
    variant: str
    variant_type: str
    drug_class: str | None
    drug_subclass: str | None
    method: str


@dataclass(frozen=True)
class AmrFinderResult:
    hits: tuple[AmrFinderHit, ...]
    mutations: tuple[AmrFinderMutation, ...]
    version: str | None  # from the per-genome versions.yml, when present
    database_version: str | None


def _hit(row: dict[str, str]) -> AmrFinderHit:
    a = L.AMRFINDERPLUS
    c = a.columns
    return AmrFinderHit(
        protein_id=optional(row[c.protein_id], a.missing),
        contig_id=row[c.contig_id],
        start=int(row[c.start]),
        end=int(row[c.stop]),
        strand=row[c.strand],
        element_symbol=row[c.element_symbol],
        element_name=row[c.element_name],
        scope=row[c.scope],
        type=row[c.type],
        subtype=optional(row[c.subtype], a.missing),
        drug_class=optional(row[c.element_class], a.missing),
        drug_subclass=optional(row[c.subclass], a.missing),
        method=row[c.method],
        coverage=to_float(row[c.coverage], a.missing),
        identity=to_float(row[c.identity], a.missing),
        closest_accession=optional(row[c.closest_accession], a.missing),
    )


def _is_mutation(hit: AmrFinderHit) -> bool:
    return hit.subtype in L.AMRFINDERPLUS.mutation_subtypes


def _is_screened_position(hit: AmrFinderHit) -> bool:
    a = L.AMRFINDERPLUS
    return hit.element_name.endswith((a.wildtype_suffix, a.unknown_suffix))


def _mutation(hit: AmrFinderHit) -> AmrFinderMutation:
    gene, variant = split_symbol(hit.element_symbol)
    return AmrFinderMutation(
        protein_id=hit.protein_id,
        contig_id=hit.contig_id,
        start=hit.start,
        end=hit.end,
        strand=hit.strand,
        element_symbol=hit.element_symbol,
        gene=gene,
        variant=variant,
        variant_type=variant_type(variant),
        drug_class=hit.drug_class,
        drug_subclass=hit.drug_subclass,
        method=hit.method,
    )


def _key(m: AmrFinderMutation) -> tuple[str, int, int, str, str]:
    return (m.contig_id, m.start, m.end, m.strand, m.element_symbol)


def parse_versions(path: Path) -> tuple[str | None, str | None]:
    """Tool and database versions from a per-genome ``versions.yml``."""
    a = L.AMRFINDERPLUS
    if not path.is_file():
        return None, None
    entries = read_versions_yml(path).get(a.process, {})
    return optional(entries.get(a.tool, "")), optional(entries.get(a.database_key, ""))


def parse_amrfinder(results_dir: Path, sample: str, prefix: str) -> AmrFinderResult | None:
    """Hits and point mutations of ``sample``, or None when the main report is absent."""
    a = L.AMRFINDERPLUS
    report = a.report.resolve(results_dir, sample, prefix)
    if not report.is_file():
        return None
    hits: list[AmrFinderHit] = []
    mutations: dict[tuple[str, int, int, str, str], AmrFinderMutation] = {}
    for row in read_table(report, a.report_table):
        hit = _hit(row)
        if not _is_mutation(hit):
            hits.append(hit)
        elif not _is_screened_position(hit):
            m = _mutation(hit)
            mutations.setdefault(_key(m), m)
    extra = a.mutations.resolve(results_dir, sample, prefix)
    if extra.is_file():
        for row in read_table(extra, a.mutations_table):
            hit = _hit(row)
            if _is_mutation(hit) and not _is_screened_position(hit):
                m = _mutation(hit)
                mutations.setdefault(_key(m), m)
    for m in mutations.values():
        if m.contig_id == "":
            raise ParseError(f"{report}: mutation {m.element_symbol} without a contig")
    version, database = parse_versions(a.versions.resolve(results_dir, sample, prefix))
    return AmrFinderResult(
        hits=tuple(hits),
        mutations=tuple(mutations.values()),
        version=version,
        database_version=database,
    )
