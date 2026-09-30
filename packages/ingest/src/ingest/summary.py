"""Denormalized genome counters and the summary sentence (contract §5.2, §7.4).

Both are computed from the catalog tables by ``refresh_summaries`` and stored
in ``genome``: ``catalejo ingest`` runs it after writing the tables and
``tombstones ingest`` runs it again, since removing genomes changes
``cluster_size``. ``release build`` copies the stored values, also for a
group release (milestone 1a plan, decision 5).

Counters.

- ``amr_gene_count``: annotation hits from AMRFinderPlus with
  ``element_type`` ``amr`` whose subtype is not a point mutation subtype, one
  per hit row (two copies of a gene count twice). RGI hits are not counted,
  since they describe the same genes from another database.
- ``amr_mutation_count``: rows of ``mutation`` for the genome.
- ``plasmid_contig_count``: contigs classified ``plasmid``.
- ``prophage_region_count``: regions of type ``prophage``.

The sentence follows ``config/summary_templates.yaml``: templates in order,
the first whose ``requires`` facts are not null and whose ``when``
conditions hold; clauses the same way; conditions compared as numbers when
both sides are numeric, and false when the fact is null; resistance phrase
rules with shell-style patterns (``fnmatchcase``); the article rule on
every standalone article of the rendered text, with the number rule of that
file for words that begin with a digit. Every fact follows the rule written
beside it in that file.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from fnmatch import fnmatchcase

import duckdb

from ingest import mgap_layout as L
from ingest.config import PaletteConfig, PhraseMatch, SummaryTemplatesConfig, TemplateVariant
from ingest.drug_classes import classify

AMR = "amr"
PLASMID = "plasmid"
PROPHAGE = "prophage"
MUTATION_SUBTYPES = L.AMRFINDERPLUS.mutation_subtypes
AMRFINDERPLUS = L.AMRFINDERPLUS.tool
MAX_MUTATIONS = 3
MISSING_ST = "-"

_PLACEHOLDER = re.compile(r"\{([a-z_]+)\}")
_CONDITION = re.compile(r"^([a-z_]+) (==|!=|>=|<=|>|<) (\S+)$")

FactValue = str | int | float | None


@dataclass(frozen=True)
class HitFact:
    source_tool: str
    element_name: str
    element_type: str
    element_subtype: str | None
    drug_class: str | None
    drug_subclass: str | None
    location_class: str
    contig_id: str


@dataclass(frozen=True)
class ContigFact:
    length: int
    classification: str
    replicon_types: tuple[str, ...]


@dataclass(frozen=True)
class GenomeSummaryInput:
    genome_id: str
    species_name: str | None
    st: str | None
    isolation_site: str | None
    isolation_date: date | None
    completeness: float | None
    contamination: float | None
    assembly_status: str
    hits: tuple[HitFact, ...]
    mutations: tuple[tuple[str, str], ...]  # (gene, variant)
    contigs: Mapping[str, ContigFact]
    prophage_region_count: int
    cluster_size: int | None


@dataclass(frozen=True)
class Counters:
    amr_gene_count: int
    amr_mutation_count: int
    plasmid_contig_count: int
    prophage_region_count: int


def is_amr_gene(hit: HitFact) -> bool:
    """The hits counted in ``amr_gene_count`` and eligible as top determinant."""
    return (
        hit.source_tool == AMRFINDERPLUS
        and hit.element_type == AMR
        and hit.element_subtype not in MUTATION_SUBTYPES
    )


def counters(g: GenomeSummaryInput) -> Counters:
    return Counters(
        amr_gene_count=sum(1 for h in g.hits if is_amr_gene(h)),
        amr_mutation_count=len(g.mutations),
        plasmid_contig_count=sum(1 for c in g.contigs.values() if c.classification == PLASMID),
        prophage_region_count=g.prophage_region_count,
    )


# Facts ------------------------------------------------------------------------------------------


def _entry_matches(entry: PhraseMatch, hit: HitFact) -> bool:
    if entry.element_name is not None and not any(
        fnmatchcase(hit.element_name, p) for p in entry.element_name
    ):
        return False
    if entry.source_tool is not None and hit.source_tool != entry.source_tool:
        return False
    if entry.element_subtype is not None and hit.element_subtype != entry.element_subtype:
        return False
    return entry.drug_subclass is None or hit.drug_subclass == entry.drug_subclass


def phrase_rule_index(hit: HitFact, templates: SummaryTemplatesConfig) -> int | None:
    """Index of the first resistance phrase rule that ``hit`` matches."""
    for index, rule in enumerate(templates.resistance_phrase):
        if any(_entry_matches(m, hit) for m in rule.match):
            return index
    return None


def resistance_phrase(hits: Sequence[HitFact], templates: SummaryTemplatesConfig) -> str | None:
    for rule in templates.resistance_phrase:
        if any(_entry_matches(m, h) for m in rule.match for h in hits):
            return rule.phrase
    return None


def top_determinant(
    hits: Sequence[HitFact], templates: SummaryTemplatesConfig, palette: PaletteConfig
) -> HitFact | None:
    """First by phrase rule order, then palette drug class order, then element_name."""
    candidates = [h for h in hits if is_amr_gene(h)]
    if not candidates:
        return None
    n_rules = len(templates.resistance_phrase)

    def key(h: HitFact) -> tuple[int, int, str, str]:
        rule = phrase_rule_index(h, templates)
        drug, _ = classify(h.drug_class, h.drug_subclass, palette)
        return (n_rules if rule is None else rule, drug, h.element_name, h.contig_id)

    return min(candidates, key=key)


def render_st(st: str | None) -> str | None:
    if st is None or st.strip() in ("", MISSING_ST):
        return None
    return f"ST{st}" if st.isdigit() else st


def mutation_list(mutations: Sequence[tuple[str, str]]) -> str | None:
    items = [f"{g} {v}" for g, v in sorted(mutations)][:MAX_MUTATIONS]
    if not items:
        return None
    if len(items) == 1:
        return items[0]
    return ", ".join(items[:-1]) + " and " + items[-1]


def _one_decimal(value: float | None) -> str | None:
    return None if value is None else f"{value:.1f}"


def facts(
    g: GenomeSummaryInput,
    c: Counters,
    templates: SummaryTemplatesConfig,
    palette: PaletteConfig,
) -> dict[str, FactValue]:
    """Every fact of ``config/summary_templates.yaml`` for one genome, null where absent."""
    top = top_determinant(g.hits, templates, palette)
    contig = g.contigs.get(top.contig_id) if top else None
    return {
        "species": g.species_name,
        "resistance_phrase": resistance_phrase(g.hits, templates),
        "st": render_st(g.st),
        "isolation_site": g.isolation_site or None,
        "year": g.isolation_date.year if g.isolation_date else None,
        "completeness": _one_decimal(g.completeness),
        "contamination": _one_decimal(g.contamination),
        "assembly_status": g.assembly_status,
        "top_determinant": top.element_name if top else None,
        "top_location": top.location_class if top else None,
        "plasmid_size": f"{round(contig.length / 1000)} kb" if contig else None,
        "replicon": contig.replicon_types[0] if contig and contig.replicon_types else None,
        "n_genes": c.amr_gene_count,
        "n_other": c.amr_gene_count - 1 if c.amr_gene_count else None,
        "n_mutations": c.amr_mutation_count,
        "mutation_list": mutation_list(g.mutations),
        "plasmid_contig_count": c.plasmid_contig_count,
        "cluster_size": g.cluster_size if render_st(g.st) else None,
    }


# Rendering --------------------------------------------------------------------------------------


def _number(value: FactValue | str) -> float | None:
    if isinstance(value, int | float):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def condition_holds(condition: str, values: Mapping[str, FactValue]) -> bool:
    m = _CONDITION.match(condition)
    if m is None:
        raise ValueError(f"malformed condition {condition!r}")
    name, op, expected = m.groups()
    actual = values.get(name)
    if actual is None:
        return False
    a, b = _number(actual), _number(expected)
    if a is not None and b is not None:
        left: float | str = a
        right: float | str = b
    else:
        left, right = str(actual), expected
    match op:
        case "==":
            return left == right
        case "!=":
            return left != right
        case ">=":
            return left >= right  # type: ignore[operator]
        case "<=":
            return left <= right  # type: ignore[operator]
        case ">":
            return left > right  # type: ignore[operator]
        case _:
            return left < right  # type: ignore[operator]


def applies(variant: TemplateVariant, values: Mapping[str, FactValue]) -> bool:
    return all(values.get(r) is not None for r in variant.requires) and all(
        condition_holds(c, values) for c in variant.when
    )


def _fill(text: str, values: Mapping[str, FactValue]) -> str:
    def value(m: re.Match[str]) -> str:
        v = values.get(m.group(1))
        return "" if v is None else str(v)

    return _PLACEHOLDER.sub(value, text)


# Numbers read with a vowel sound: integer part 11 or 18, or a leading 8 (8, 80, 800 ...).
AN_NUMBERS = ("11", "18")
AN_LEADING_DIGIT = "8"
_INTEGER = re.compile(r"\d+")


def takes_an(word: str, an_before: Sequence[str]) -> bool:
    """Whether ``word`` is read with a vowel sound, by the article rule of contract §7.4.

    A word beginning with a number follows the number rule in
    ``config/summary_templates.yaml``; any other word takes "an" when it
    begins with one of ``an_before`` (case sensitive).
    """
    number = _INTEGER.match(word)
    if number is not None:
        digits = number.group(0)
        return digits in AN_NUMBERS or digits.startswith(AN_LEADING_DIGIT)
    return any(word.startswith(x) for x in an_before)


def apply_article(sentence: str, templates: SummaryTemplatesConfig) -> str:
    """Every standalone article "A" or "a" before a vowel sound becomes "An" or "an".

    The article keeps its case, and the rule reads the rendered text
    (contract §7.4, the Articles paragraph of ``config/summary_templates.yaml``).
    """
    a = templates.article
    forms = {a.default: a.alternative, a.default.lower(): a.alternative.lower()}
    article = re.compile(r"(?<!\S)(" + "|".join(re.escape(f) for f in forms) + r") (?=(\S+))")

    def replace(m: re.Match[str]) -> str:
        if takes_an(m.group(2), a.an_before):
            return forms[m.group(1)] + " "
        return m.group(0)

    return article.sub(replace, sentence)


def render(values: Mapping[str, FactValue], templates: SummaryTemplatesConfig) -> tuple[str, str]:
    """The id of the chosen template and the rendered sentence."""
    template = next(t for t in templates.templates if applies(t, values))

    def clause(m: re.Match[str]) -> str:
        name = m.group(1)
        variants = templates.clauses.get(name)
        if variants is None:
            return m.group(0)
        chosen = next(v for v in variants if applies(v, values))
        return chosen.text

    text = _PLACEHOLDER.sub(clause, template.text)
    return template.id, apply_article(_fill(text, values), templates)


def summarize(
    g: GenomeSummaryInput, templates: SummaryTemplatesConfig, palette: PaletteConfig
) -> tuple[Counters, str, str]:
    """Counters, template id and sentence of one genome."""
    c = counters(g)
    template_id, sentence = render(facts(g, c, templates, palette), templates)
    return c, template_id, sentence


# Catalog ----------------------------------------------------------------------------------------


def load_inputs(con: duckdb.DuckDBPyConnection) -> list[GenomeSummaryInput]:
    """Summary inputs of every genome in the catalog, ordered by genome_id."""
    genomes = con.execute(
        """
        SELECT g.genome_id, s.canonical_name, g.st, g.isolation_site, g.isolation_date,
               g.checkm2_completeness, g.checkm2_contamination, g.assembly_status,
               g.species_code
        FROM genome g LEFT JOIN species_registry s USING (species_code)
        ORDER BY g.genome_id
        """
    ).fetchall()
    hits: dict[str, list[HitFact]] = {}
    for row in con.execute(
        """
        SELECT genome_id, source_tool, element_name, element_type, element_subtype,
               drug_class, drug_subclass, location_class, contig_id
        FROM annotation_hit ORDER BY genome_id, hit_id
        """
    ).fetchall():
        hits.setdefault(row[0], []).append(HitFact(*row[1:]))
    mutations: dict[str, list[tuple[str, str]]] = {}
    for gid, gene, variant in con.execute(
        "SELECT genome_id, gene, variant FROM mutation ORDER BY genome_id, gene, variant"
    ).fetchall():
        mutations.setdefault(gid, []).append((gene, variant))
    contigs: dict[str, dict[str, ContigFact]] = {}
    for gid, cid, length, classification, replicons in con.execute(
        """SELECT genome_id, contig_id, length, classification, replicon_types
        FROM contig ORDER BY genome_id, contig_index"""
    ).fetchall():
        fact = ContigFact(length, classification, tuple(replicons or ()))
        contigs.setdefault(gid, {})[cid] = fact
    prophages = dict(
        con.execute(
            "SELECT genome_id, count(*) FROM region WHERE type = ? GROUP BY genome_id", [PROPHAGE]
        ).fetchall()
    )
    clusters: dict[tuple[str, str], int] = {}
    for g in genomes:
        if render_st(g[2]) and g[8]:
            clusters[(g[8], g[2])] = clusters.get((g[8], g[2]), 0) + 1
    return [
        GenomeSummaryInput(
            genome_id=gid,
            species_name=name,
            st=st,
            isolation_site=site,
            isolation_date=when,
            completeness=completeness,
            contamination=contamination,
            assembly_status=status,
            hits=tuple(hits.get(gid, [])),
            mutations=tuple(mutations.get(gid, [])),
            contigs=contigs.get(gid, {}),
            prophage_region_count=int(prophages.get(gid, 0)),
            cluster_size=clusters.get((code, st)) if code and st else None,
        )
        for gid, name, st, site, when, completeness, contamination, status, code in genomes
    ]


def refresh_summaries(
    con: duckdb.DuckDBPyConnection, templates: SummaryTemplatesConfig, palette: PaletteConfig
) -> dict[str, str]:
    """Recompute the counters and summary sentence of every genome; returns template ids."""
    chosen: dict[str, str] = {}
    rows: list[tuple[str, int, int, int, int, str]] = []
    for g in load_inputs(con):
        c, template_id, sentence = summarize(g, templates, palette)
        chosen[g.genome_id] = template_id
        rows.append(
            (
                g.genome_id,
                c.amr_gene_count,
                c.amr_mutation_count,
                c.plasmid_contig_count,
                c.prophage_region_count,
                sentence,
            )
        )
    con.execute(
        """CREATE OR REPLACE TEMP TABLE _summary (genome_id VARCHAR, a INTEGER, m INTEGER,
        p INTEGER, r INTEGER, s VARCHAR)"""
    )
    if rows:
        con.executemany("INSERT INTO _summary VALUES (?, ?, ?, ?, ?, ?)", rows)
    con.execute(
        """
        UPDATE genome SET amr_gene_count = _summary.a, amr_mutation_count = _summary.m,
               plasmid_contig_count = _summary.p, prophage_region_count = _summary.r,
               summary_sentence = _summary.s
        FROM _summary WHERE genome.genome_id = _summary.genome_id
        """
    )
    con.execute("DROP TABLE _summary")
    return chosen
