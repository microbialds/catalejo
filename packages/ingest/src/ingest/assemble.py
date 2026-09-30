"""Join one genome's parser output into catalog rows (data contract 0.7 §4.1, §5 and §10).

``parse_sample`` runs every parser on one mgap sample; ``assemble_genome``
turns the result into the rows of ``contig``, ``feature``,
``annotation_hit``, ``mutation``, ``region``, ``typing`` and
``tool_version``, and the tool-derived columns of ``genome``
(``GenomeFacts``). Metadata, species assignment (``ingest.species``),
counters and the summary sentence are added when the catalog is written.

Rules applied here, with their sources.

- Features (§3.4, §5.4). ``feature_id`` is the positional hash of
  ``ingest.identifiers``. ``position_index`` is the 1-based rank of the
  feature on its contig ordered by start, with end, strand and type breaking
  ties (a CRISPR array and its first repeat share a start). ``protein_hash``
  is set for every feature whose locus tag has a record in the ``.faa``
  (CDS and sORF).
- Annotation hits (§5.5). An AMRFinderPlus hit maps to the feature with its
  ``Protein id`` as locus tag; otherwise, like RGI hits, to the feature on the
  same contig with the largest coordinate overlap, preferring coding features
  (CDS, sORF) and falling back to any feature type, ties broken by the
  smallest start, end, strand and type. ``annotation_hit.feature_id`` is a
  required foreign key, so a hit that overlaps no feature is not a row: it is
  returned in ``unmapped_hits`` with an issue, never dropped silently.
- RGI contigs (§3.2). RGI reports assembler names; each is mapped to the Bakta
  contig with the identical sequence (Bakta drops contigs under 200 bp and
  renames the rest), and the hit keeps its coordinates, since the sequences
  are identical.
- Mutations (§5.6). ``feature_id`` by locus tag, else by the same overlap
  rule, else null.
- Contig classification (§5.3, §10). From MOB-suite when it ran
  (``molecule_type``; a contig missing from its report is unclassified),
  with the cluster from the contig report and the replicon types, relaxase
  types and mobility of the MOB-typer plasmid of that cluster, falling back to
  the contig report's own columns; lists are deduplicated in order and empty
  lists are null. Without MOB-suite, from geNomad: ``plasmid`` when plasmid
  regions cover more than half the contig, ``chromosome`` for the longest
  contig of a complete assembly without such a region, ``unclassified``
  otherwise. For this rule an assembly is complete when every contig is
  circular in the ``.fna`` tags.
- Assembly status (§5.2). ``complete`` when at least one contig is
  classified and every classified contig is circular, else ``draft``.
- ``location_class`` (§5.5) is the classification of the hit's contig.
- Genome statistics (§5.2). Size, contig count, N50 and GC (percent) come
  from the Bakta contigs, so they agree with the ``contig`` table; CDS, rRNA
  and tRNA counts from the Bakta summary.
- Tool versions (§4.1, §5.15). One row per tool whose output exists for the
  genome, plus the pipeline as tool ``mgap``. Per-genome sources first (the
  Bakta summary for Bakta and its database, the AMRFinderPlus
  ``versions.yml``, the SPAdes graph), then ``pipeline_info``; null when
  absent.
- Typing (§5.9). MLST gives ``ST`` and one key per allele; Kleborate, SISTR
  and sccmec give one key per column with a value. Keys listed in ``exclude``
  of ``config/typing_display.yaml`` are not stored, and ``display_group``
  comes from the same file.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from pathlib import Path

from ingest import identifiers as ids
from ingest import mgap_layout as L
from ingest.config import TypingDisplayConfig
from ingest.issues import FAILURE, WARNING, Issue
from ingest.parsers._typing import TypingResult
from ingest.parsers.amrfinder import AmrFinderHit, AmrFinderResult, parse_amrfinder
from ingest.parsers.assembly import AssemblyInfo, parse_assembly
from ingest.parsers.bakta import BaktaAnnotation, BaktaContig, BaktaFeature, gc_percent, parse_bakta
from ingest.parsers.checkm2 import CheckM2Result, parse_checkm2
from ingest.parsers.genomad import PLASMID_REGION, GenomadRegion, parse_genomad
from ingest.parsers.gtdbtk import GtdbTkResult, gtdbtk_for, parse_gtdbtk_summary
from ingest.parsers.kleborate import parse_kleborate
from ingest.parsers.kraken2 import Kraken2Result, parse_kraken2
from ingest.parsers.mlst import MlstResult, parse_mlst
from ingest.parsers.mobsuite import MobSuiteResult, parse_mobsuite
from ingest.parsers.pipeline_info import EMPTY, PipelineVersions
from ingest.parsers.quast import QuastResult, parse_quast
from ingest.parsers.rgi import RgiHit, parse_rgi
from ingest.parsers.sccmec import parse_sccmec
from ingest.parsers.sistr import parse_sistr
from ingest.rows import (
    AnnotationHitRow,
    ContigRow,
    FeatureRow,
    MutationRow,
    RegionRow,
    ToolVersionRow,
    TypingRow,
)

# Catalog vocabularies (contract §5.2, §5.3, §5.5, §5.15).
CHROMOSOME = "chromosome"
PLASMID = "plasmid"
UNCLASSIFIED = "unclassified"
SOURCE_MOBSUITE = L.MOBSUITE.tool
SOURCE_GENOMAD = L.GENOMAD.tool
COMPLETE = "complete"
DRAFT = "draft"
PIPELINE_TOOL = "mgap"
ELEMENT_TYPES = {
    L.AMRFINDERPLUS.type_amr: "amr",
    L.AMRFINDERPLUS.type_stress: "stress",
    L.AMRFINDERPLUS.type_virulence: "virulence",
}
ELEMENT_TYPE_OTHER = "other"
ELEMENT_TYPE_RGI = "amr"
CODING_TYPES = (L.BAKTA.feature_types.cds, L.BAKTA.feature_types.sorf)
MLST_ST_KEY = L.MLST.columns.st
DEFAULT_DISPLAY_GROUP = "typing"
PLASMID_COVER_FRACTION = 0.5

# Rule identifiers of the issues raised here.
RULE_UNMAPPED_HIT = "annotation_hit.unmapped_feature"
RULE_DUPLICATE_FEATURE = "feature.duplicate_id"
RULE_DUPLICATE_HIT = "annotation_hit.duplicate_id"
RULE_DUPLICATE_MUTATION = "mutation.duplicate_id"
RULE_DUPLICATE_REGION = "region.duplicate_id"
RULE_UNKNOWN_CONTIG = "results.unknown_contig"


# Parsing one sample -------------------------------------------------------------------------------


@dataclass(frozen=True)
class ParsedGenome:
    """Every parser's output for one mgap sample."""

    sample: str
    prefix: str
    assembly: AssemblyInfo
    bakta: BaktaAnnotation
    checkm2: CheckM2Result | None
    quast: QuastResult | None
    kraken2: Kraken2Result | None
    mlst: MlstResult | None
    gtdbtk: GtdbTkResult | None
    amrfinder: AmrFinderResult | None
    rgi: tuple[RgiHit, ...] | None
    genomad: tuple[GenomadRegion, ...] | None
    mobsuite: MobSuiteResult | None
    typing: tuple[TypingResult, ...]
    tools: tuple[str, ...]  # tools whose output exists for this sample, sorted


def _tools_present(
    results_dir: Path, sample: str, prefix: str, parsed: dict[str, bool]
) -> tuple[str, ...]:
    present = {tool for tool, ran in parsed.items() if ran}
    if L.KRAKEN2.report.resolve(results_dir, sample, prefix).is_file():
        present.add(L.KRAKEN2.tool)
    if L.BRACKEN.report.resolve(results_dir, sample, prefix).is_file():
        present.add(L.BRACKEN.tool)
    if L.LONG_READ.dnaapler_dir.resolve(results_dir, sample, prefix).is_dir():
        present.add(L.LONG_READ.dnaapler_tool)
    return tuple(sorted(present))


def parse_sample(
    results_dir: Path,
    sample: str,
    genome_id: str | None = None,
    gtdbtk_summary: dict[str, GtdbTkResult] | None = None,
) -> ParsedGenome:
    """Run every parser of contract §4.1 on ``sample``.

    ``gtdbtk_summary`` is the run-level GTDB-Tk table, read once per run by
    the caller; it is read here when not given.
    """
    prefix = L.resolve_prefix(results_dir, sample)
    summary = gtdbtk_summary if gtdbtk_summary is not None else parse_gtdbtk_summary(results_dir)
    names = [n for n in (genome_id, sample, prefix) if n]
    assembly = parse_assembly(results_dir, sample, prefix)
    checkm2 = parse_checkm2(results_dir, sample, prefix)
    quast = parse_quast(results_dir, sample, prefix)
    mlst = parse_mlst(results_dir, sample, prefix)
    gtdbtk = gtdbtk_for(summary, names)
    amrfinder = parse_amrfinder(results_dir, sample, prefix)
    rgi = parse_rgi(results_dir, sample, prefix)
    genomad = parse_genomad(results_dir, sample, prefix)
    mobsuite = parse_mobsuite(results_dir, sample, prefix)
    typing = tuple(
        t
        for t in (
            parse_kleborate(results_dir, sample, prefix),
            parse_sistr(results_dir, sample, prefix),
            parse_sccmec(results_dir, sample, prefix),
        )
        if t is not None
    )
    tools = _tools_present(
        results_dir,
        sample,
        prefix,
        {
            L.BAKTA.tool: True,
            **({assembly.assembler: True} if assembly.assembler else {}),
            L.CHECKM2.tool: checkm2 is not None,
            L.QUAST.tool: quast is not None,
            L.MLST.tool: mlst is not None,
            L.GTDBTK.tool: gtdbtk is not None,
            L.AMRFINDERPLUS.tool: amrfinder is not None,
            L.RGI.tool: rgi is not None,
            L.GENOMAD.tool: genomad is not None,
            L.MOBSUITE.tool: mobsuite is not None,
            **{t.tool: True for t in typing},
        },
    )
    return ParsedGenome(
        sample=sample,
        prefix=prefix,
        assembly=assembly,
        bakta=parse_bakta(results_dir, sample, prefix),
        checkm2=checkm2,
        quast=quast,
        kraken2=parse_kraken2(results_dir, sample, prefix),
        mlst=mlst,
        gtdbtk=gtdbtk,
        amrfinder=amrfinder,
        rgi=rgi,
        genomad=genomad,
        mobsuite=mobsuite,
        typing=typing,
        tools=tools,
    )


# Assembled rows -----------------------------------------------------------------------------------


@dataclass(frozen=True)
class GenomeFacts:
    """The ``genome`` columns (§5.2) that come from the mgap results."""

    platform: str | None  # detected from the assembly directory
    assembler: str | None
    assembler_version: str | None
    assembly_status: str
    genome_size: int
    contig_count: int
    n50: int
    gc_content: float  # percent
    cds_count: int | None
    rrna_count: int | None
    trna_count: int | None
    checkm2_completeness: float | None
    checkm2_contamination: float | None
    gtdb_classification: str | None
    gtdb_closest_reference: str | None
    gtdb_species: str | None
    kraken2_top_taxon: str | None
    kraken2_top_fraction: float | None
    mlst_scheme: str | None
    st: str | None


@dataclass(frozen=True)
class UnmappedHit:
    """An annotation hit with no feature to attach to (§5.5 requires one)."""

    source_tool: str
    element_name: str
    contig_id: str | None  # Bakta contig, None when the assembler contig has none
    reported_contig: str  # as the tool wrote it
    start: int
    end: int
    strand: str
    method: str | None
    reason: str


@dataclass(frozen=True)
class AssembledGenome:
    genome_id: str
    sample: str
    facts: GenomeFacts
    contigs: tuple[ContigRow, ...]
    features: tuple[FeatureRow, ...]
    hits: tuple[AnnotationHitRow, ...]
    mutations: tuple[MutationRow, ...]
    regions: tuple[RegionRow, ...]
    typing: tuple[TypingRow, ...]
    tool_versions: tuple[ToolVersionRow, ...]
    unmapped_hits: tuple[UnmappedHit, ...] = ()
    issues: tuple[Issue, ...] = field(default=())


# Versions -------------------------------------------------------------------------------------


@dataclass(frozen=True)
class ResolvedVersion:
    version: str | None
    database: str | None
    database_version: str | None


def resolve_versions(
    parsed: ParsedGenome, pipeline: PipelineVersions
) -> dict[str, ResolvedVersion]:
    """Version of every tool that ran for the genome, and of the pipeline (§4.1, §5.15)."""
    out: dict[str, ResolvedVersion] = {}
    b = L.BAKTA
    for tool in parsed.tools:
        version = pipeline.version(tool)
        database: str | None = None
        database_version: str | None = None
        if tool == b.tool:
            summary = parsed.bakta.summary
            version = summary.software_version or version
            database_version = summary.database_version
            if summary.database_type:
                database = f"{b.database_name} ({summary.database_type})"
            elif database_version:
                database = b.database_name
        elif tool == L.AMRFINDERPLUS.tool and parsed.amrfinder is not None:
            version = parsed.amrfinder.version or version
            database_version = parsed.amrfinder.database_version or pipeline.databases.get(tool)
            database = L.AMRFINDERPLUS.database_name if database_version else None
        elif tool == L.SPADES.tool and parsed.assembly.assembler_version:
            version = parsed.assembly.assembler_version
        out[tool] = ResolvedVersion(version, database, database_version)
    out[PIPELINE_TOOL] = ResolvedVersion(pipeline.pipeline_version, None, None)
    return out


# Features and mapping -------------------------------------------------------------------------


def _feature_order(f: BaktaFeature) -> tuple[int, int, str, str]:
    return (f.start, f.end, f.strand, f.type)


def _overlap(a_start: int, a_end: int, b_start: int, b_end: int) -> int:
    return max(0, min(a_end, b_end) - max(a_start, b_start) + 1)


@dataclass
class _FeatureIndex:
    rows: dict[str, list[FeatureRow]] = field(default_factory=dict[str, list[FeatureRow]])
    by_locus: dict[str, FeatureRow] = field(default_factory=dict[str, FeatureRow])

    def best_overlap(self, contig: str, start: int, end: int) -> FeatureRow | None:
        lo, hi = min(start, end), max(start, end)
        candidates = [
            (f, _overlap(lo, hi, f.start, f.end))
            for f in self.rows.get(contig, [])
            if f.start <= hi and f.end >= lo
        ]
        if not candidates:
            return None
        coding = [c for c in candidates if c[0].type in CODING_TYPES]
        pool = coding or candidates
        return min(pool, key=lambda c: (-c[1], c[0].start, c[0].end, c[0].strand, c[0].type))[0]

    def resolve(
        self, locus_tag: str | None, contig: str, start: int, end: int
    ) -> FeatureRow | None:
        if locus_tag is not None:
            f = self.by_locus.get(locus_tag)
            if f is not None:
                return f
        return self.best_overlap(contig, start, end)


def _features(genome_id: str, bakta: BaktaAnnotation, issues: list[Issue]) -> list[FeatureRow]:
    by_contig: dict[str, list[BaktaFeature]] = {}
    for f in bakta.features:
        by_contig.setdefault(f.contig_id, []).append(f)
    order = {c.contig_id: c.index for c in bakta.contigs}
    rows: list[FeatureRow] = []
    seen: set[str] = set()
    for contig in sorted(by_contig, key=lambda c: (order.get(c, len(order) + 1), c)):
        if contig not in order:
            issues.append(
                Issue(
                    RULE_UNKNOWN_CONTIG,
                    FAILURE,
                    f"Bakta feature on {contig}, absent from .fna",
                    genome_id,
                )
            )
        for rank, f in enumerate(sorted(by_contig[contig], key=_feature_order), start=1):
            fid = ids.feature_id(genome_id, f.contig_id, f.start, f.end, f.strand)
            if fid in seen:
                issues.append(
                    Issue(
                        RULE_DUPLICATE_FEATURE,
                        FAILURE,
                        f"two features at {f.contig_id}:{f.start}-{f.end} ({f.strand}) share "
                        f"feature_id {fid}; the {f.type} is kept out",
                        genome_id,
                    )
                )
                continue
            seen.add(fid)
            rows.append(
                FeatureRow(
                    feature_id=fid,
                    genome_id=genome_id,
                    contig_id=f.contig_id,
                    start=f.start,
                    end=f.end,
                    strand=f.strand,
                    type=f.type,
                    locus_tag=f.locus_tag,
                    gene=f.gene,
                    product=f.product,
                    position_index=rank,
                    protein_hash=bakta.protein_hashes.get(f.locus_tag) if f.locus_tag else None,
                    db_xrefs=f.db_xrefs,
                )
            )
    return rows


# Contigs --------------------------------------------------------------------------------------


def _dedupe(items: Iterable[str]) -> tuple[str, ...] | None:
    out = tuple(dict.fromkeys(items))
    return out or None


def _covered(intervals: Sequence[tuple[int, int]]) -> int:
    total = 0
    last = 0
    for start, end in sorted(intervals):
        start = max(start, last + 1)
        if end >= start:
            total += end - start + 1
            last = end
    return total


def classify_contigs(
    contigs: Sequence[BaktaContig],
    mobsuite: MobSuiteResult | None,
    genomad: Sequence[GenomadRegion] | None,
) -> dict[str, tuple[str, str]]:
    """Contig id to (classification, classification_source) by the rules of §5.3 and §10."""
    if mobsuite is not None:
        types = {c.contig_id: c.molecule_type for c in mobsuite.contigs}
        m = L.MOBSUITE
        out: dict[str, tuple[str, str]] = {}
        for c in contigs:
            kind = types.get(c.contig_id)
            if kind == m.molecule_chromosome:
                out[c.contig_id] = (CHROMOSOME, SOURCE_MOBSUITE)
            elif kind == m.molecule_plasmid:
                out[c.contig_id] = (PLASMID, SOURCE_MOBSUITE)
            else:
                out[c.contig_id] = (UNCLASSIFIED, SOURCE_MOBSUITE)
        return out
    plasmid_cover: dict[str, list[tuple[int, int]]] = {}
    for r in genomad or ():
        if r.type == PLASMID_REGION:
            plasmid_cover.setdefault(r.contig_id, []).append((r.start, r.end))
    is_plasmid = {
        c.contig_id: _covered(plasmid_cover.get(c.contig_id, []))
        > PLASMID_COVER_FRACTION * c.length
        for c in contigs
    }
    complete = bool(contigs) and all(c.circular for c in contigs)
    longest = min(contigs, key=lambda c: (-c.length, c.index)).contig_id if contigs else None
    out = {}
    for c in contigs:
        if is_plasmid[c.contig_id]:
            kind = PLASMID
        elif complete and c.contig_id == longest:
            kind = CHROMOSOME
        else:
            kind = UNCLASSIFIED
        out[c.contig_id] = (kind, SOURCE_GENOMAD)
    return out


def assembly_status(contigs: Sequence[BaktaContig], classes: dict[str, tuple[str, str]]) -> str:
    classified = [c for c in contigs if classes[c.contig_id][0] != UNCLASSIFIED]
    return COMPLETE if classified and all(c.circular for c in classified) else DRAFT


def _contig_rows(
    genome_id: str,
    contigs: Sequence[BaktaContig],
    classes: dict[str, tuple[str, str]],
    mobsuite: MobSuiteResult | None,
    features: Sequence[FeatureRow],
) -> list[ContigRow]:
    counts: dict[str, int] = {}
    for f in features:
        counts[f.contig_id] = counts.get(f.contig_id, 0) + 1
    mob = {c.contig_id: c for c in mobsuite.contigs} if mobsuite is not None else {}
    rows: list[ContigRow] = []
    for c in contigs:
        classification, source = classes[c.contig_id]
        entry = mob.get(c.contig_id)
        cluster = secondary = mobility = None
        replicons: tuple[str, ...] | None = None
        relaxases: tuple[str, ...] | None = None
        if entry is not None and mobsuite is not None:
            plasmid = mobsuite.plasmid(entry.primary_cluster_id)
            cluster = entry.primary_cluster_id
            secondary = entry.secondary_cluster_id
            if plasmid is not None:
                replicons = _dedupe(plasmid.replicon_types or entry.replicon_types)
                relaxases = _dedupe(plasmid.relaxase_types or entry.relaxase_types)
                mobility = plasmid.mobility or entry.mobility
            else:
                replicons = _dedupe(entry.replicon_types)
                relaxases = _dedupe(entry.relaxase_types)
                mobility = entry.mobility
        rows.append(
            ContigRow(
                genome_id=genome_id,
                contig_id=c.contig_id,
                contig_index=c.index,
                length=c.length,
                gc_content=c.gc_content,
                topology=c.topology,
                classification=classification,
                classification_source=source,
                mob_cluster_id=cluster,
                mob_secondary_cluster_id=secondary,
                replicon_types=replicons,
                relaxase_types=relaxases,
                mobility=mobility,
                feature_count=counts.get(c.contig_id, 0),
            )
        )
    return rows


# Hits, mutations, regions ---------------------------------------------------------------------


def _amr_hit_row(
    genome_id: str, hit: AmrFinderHit, feature: FeatureRow, location: str, db_version: str | None
) -> AnnotationHitRow:
    a = L.AMRFINDERPLUS
    return AnnotationHitRow(
        hit_id=ids.hit_id(feature.feature_id, a.tool, hit.element_symbol),
        feature_id=feature.feature_id,
        genome_id=genome_id,
        contig_id=hit.contig_id,
        source_tool=a.tool,
        source_db=a.database_name,
        source_db_version=db_version,
        element_name=hit.element_symbol,
        element_type=ELEMENT_TYPES.get(hit.type, ELEMENT_TYPE_OTHER),
        element_subtype=hit.subtype,
        drug_class=hit.drug_class,
        drug_subclass=hit.drug_subclass,
        aro_accession=None,
        identity=hit.identity,
        coverage=hit.coverage,
        method=hit.method,
        location_class=location,
    )


def _rgi_hit_row(
    genome_id: str, hit: RgiHit, contig: str, feature: FeatureRow, location: str
) -> AnnotationHitRow:
    r = L.RGI
    return AnnotationHitRow(
        hit_id=ids.hit_id(feature.feature_id, r.tool, hit.best_hit_aro),
        feature_id=feature.feature_id,
        genome_id=genome_id,
        contig_id=contig,
        source_tool=r.tool,
        source_db=r.database_name,
        source_db_version=None,
        element_name=hit.best_hit_aro,
        element_type=ELEMENT_TYPE_RGI,
        element_subtype=None,
        drug_class=hit.drug_class,
        drug_subclass=None,
        aro_accession=hit.aro,
        identity=hit.identity,
        coverage=hit.coverage,
        method=hit.cut_off,
        location_class=location,
    )


def _region_rows(
    genome_id: str,
    regions: Sequence[GenomadRegion],
    known: set[str],
    version: str | None,
    issues: list[Issue],
) -> list[RegionRow]:
    rows: dict[str, RegionRow] = {}
    tool = L.GENOMAD.tool
    for r in regions:
        if r.contig_id not in known:
            issues.append(
                Issue(
                    RULE_UNKNOWN_CONTIG,
                    FAILURE,
                    f"geNomad region on unknown contig {r.contig_id}",
                    genome_id,
                )
            )
            continue
        rid = ids.region_id(genome_id, r.contig_id, r.start, r.end, tool, r.type)
        if rid in rows:
            issues.append(
                Issue(RULE_DUPLICATE_REGION, WARNING, f"repeated region {rid}", genome_id)
            )
            continue
        rows[rid] = RegionRow(
            region_id=rid,
            genome_id=genome_id,
            contig_id=r.contig_id,
            start=r.start,
            end=r.end,
            type=r.type,
            source_tool=tool,
            source_db_version=version,
            score=r.score,
            attributes=json.dumps(
                r.attributes, sort_keys=True, ensure_ascii=False, separators=(",", ":")
            ),
        )
    return sorted(rows.values(), key=lambda x: (x.contig_id, x.start, x.end, x.type))


# Typing ---------------------------------------------------------------------------------------


def _typing_rows(
    genome_id: str,
    parsed: ParsedGenome,
    display: TypingDisplayConfig,
    versions: dict[str, ResolvedVersion],
) -> list[TypingRow]:
    results: list[TypingResult] = []
    if parsed.mlst is not None:
        pairs: list[tuple[str, str]] = []
        if parsed.mlst.st is not None:
            pairs.append((MLST_ST_KEY, parsed.mlst.st))
        pairs += list(parsed.mlst.alleles)
        results.append(TypingResult(L.MLST.tool, tuple(pairs)))
    results += parsed.typing
    rows: list[TypingRow] = []
    for result in results:
        tool_display = next((v for k, v in display.tools.items() if k == result.tool), None)
        exclude = set(tool_display.exclude) if tool_display else set[str]()
        resolved = versions.get(result.tool)
        seen: set[str] = set()
        for key, value in result.values:
            if key in exclude or key in seen:
                continue
            seen.add(key)
            group = tool_display.display_group(key) if tool_display else DEFAULT_DISPLAY_GROUP
            rows.append(
                TypingRow(
                    genome_id=genome_id,
                    source_tool=result.tool,
                    tool_version=resolved.version if resolved else None,
                    key=key,
                    value=value,
                    display_group=group,
                )
            )
    return rows


# Genome ---------------------------------------------------------------------------------------


def n50(lengths: Iterable[int]) -> int:
    ordered = sorted(lengths, reverse=True)
    total = sum(ordered)
    cumulative = 0
    for length in ordered:
        cumulative += length
        if 2 * cumulative >= total:
            return length
    return 0


def assemble_genome(
    genome_id: str,
    parsed: ParsedGenome,
    typing_display: TypingDisplayConfig,
    pipeline: PipelineVersions | None = None,
) -> AssembledGenome:
    """The catalog rows of one genome from its parsed mgap results."""
    pipeline = pipeline or EMPTY
    issues: list[Issue] = []
    bakta = parsed.bakta
    contigs = bakta.contigs
    known = {c.contig_id for c in contigs}
    versions = resolve_versions(parsed, pipeline)

    features = _features(genome_id, bakta, issues)
    index = _FeatureIndex()
    for f in features:
        index.rows.setdefault(f.contig_id, []).append(f)
        if f.locus_tag:
            index.by_locus[f.locus_tag] = f

    classes = classify_contigs(contigs, parsed.mobsuite, parsed.genomad)
    status = assembly_status(contigs, classes)
    contig_rows = _contig_rows(genome_id, contigs, classes, parsed.mobsuite, features)

    hits: dict[str, AnnotationHitRow] = {}
    unmapped: list[UnmappedHit] = []

    def keep(row: AnnotationHitRow) -> None:
        if row.hit_id in hits:
            issues.append(
                Issue(
                    RULE_DUPLICATE_HIT,
                    WARNING,
                    f"{row.source_tool} {row.element_name} twice on feature {row.feature_id}; "
                    "the first is kept",
                    genome_id,
                )
            )
            return
        hits[row.hit_id] = row

    def lost(item: UnmappedHit) -> None:
        unmapped.append(item)
        issues.append(
            Issue(
                RULE_UNMAPPED_HIT,
                FAILURE,
                f"{item.source_tool} {item.element_name} at {item.reported_contig}:"
                f"{item.start}-{item.end} ({item.strand}, {item.method}) maps to no feature: "
                f"{item.reason}",
                genome_id,
            )
        )

    amr = parsed.amrfinder
    amr_db = versions.get(L.AMRFINDERPLUS.tool)
    amr_db_version = amr_db.database_version if amr_db else None
    if amr is not None:
        for hit in amr.hits:
            if hit.contig_id not in known:
                lost(
                    UnmappedHit(
                        L.AMRFINDERPLUS.tool, hit.element_symbol, None, hit.contig_id,
                        hit.start, hit.end, hit.strand, hit.method, "contig absent from Bakta",
                    )
                )  # fmt: skip
                continue
            feature = index.resolve(hit.protein_id, hit.contig_id, hit.start, hit.end)
            if feature is None:
                lost(
                    UnmappedHit(
                        L.AMRFINDERPLUS.tool, hit.element_symbol, hit.contig_id, hit.contig_id,
                        hit.start, hit.end, hit.strand, hit.method, "no Bakta feature overlaps it",
                    )
                )  # fmt: skip
                continue
            keep(_amr_hit_row(genome_id, hit, feature, classes[hit.contig_id][0], amr_db_version))

    if parsed.rgi:
        to_bakta = {c.digest: c.contig_id for c in contigs}
        names = {s.name: to_bakta.get(s.digest) for s in parsed.assembly.sequences}
        for hit in parsed.rgi:
            contig = names.get(hit.assembler_contig)
            if contig is None:
                lost(
                    UnmappedHit(
                        L.RGI.tool, hit.best_hit_aro, None, hit.assembler_contig, hit.start,
                        hit.end, hit.strand, hit.cut_off, "assembler contig has no Bakta contig",
                    )
                )  # fmt: skip
                continue
            feature = index.best_overlap(contig, hit.start, hit.end)
            if feature is None:
                lost(
                    UnmappedHit(
                        L.RGI.tool, hit.best_hit_aro, contig, hit.assembler_contig, hit.start,
                        hit.end, hit.strand, hit.cut_off, "no Bakta feature overlaps it",
                    )
                )  # fmt: skip
                continue
            keep(_rgi_hit_row(genome_id, hit, contig, feature, classes[contig][0]))

    mutations: dict[str, MutationRow] = {}
    if amr is not None:
        a = L.AMRFINDERPLUS
        for m in amr.mutations:
            if m.contig_id not in known:
                issues.append(
                    Issue(
                        RULE_UNKNOWN_CONTIG,
                        FAILURE,
                        f"mutation {m.element_symbol} on unknown contig {m.contig_id}",
                        genome_id,
                    )
                )
                continue
            feature = index.resolve(m.protein_id, m.contig_id, m.start, m.end)
            mid = ids.mutation_id(genome_id, a.tool, m.gene, m.variant)
            if mid in mutations:
                issues.append(
                    Issue(
                        RULE_DUPLICATE_MUTATION,
                        WARNING,
                        f"{m.element_symbol} reported twice ({m.contig_id}:{m.start}); "
                        "the first is kept",
                        genome_id,
                    )
                )
                continue
            mutations[mid] = MutationRow(
                mutation_id=mid,
                genome_id=genome_id,
                contig_id=m.contig_id,
                feature_id=feature.feature_id if feature else None,
                source_tool=a.tool,
                source_db=a.database_name,
                source_db_version=amr_db_version,
                gene=m.gene,
                variant=m.variant,
                variant_type=m.variant_type,
                drug_class=m.drug_class,
                start=m.start,
                end=m.end,
                strand=m.strand,
                confidence=None,
            )

    genomad_version = versions.get(L.GENOMAD.tool)
    regions = _region_rows(
        genome_id,
        parsed.genomad or (),
        known,
        genomad_version.database_version if genomad_version else None,
        issues,
    )

    gc = sum(c.gc_bases for c in contigs)
    acgt = sum(c.acgt_bases for c in contigs)
    assembler = versions.get(parsed.assembly.assembler or "")
    facts = GenomeFacts(
        platform=parsed.assembly.platform,
        assembler=parsed.assembly.assembler,
        assembler_version=parsed.assembly.assembler_version
        or (assembler.version if assembler else None),
        assembly_status=status,
        genome_size=sum(c.length for c in contigs),
        contig_count=len(contigs),
        n50=n50(c.length for c in contigs),
        gc_content=gc_percent(gc, acgt),
        cds_count=bakta.summary.cds_count,
        rrna_count=bakta.summary.rrna_count,
        trna_count=bakta.summary.trna_count,
        checkm2_completeness=parsed.checkm2.completeness if parsed.checkm2 else None,
        checkm2_contamination=parsed.checkm2.contamination if parsed.checkm2 else None,
        gtdb_classification=parsed.gtdbtk.classification if parsed.gtdbtk else None,
        gtdb_closest_reference=parsed.gtdbtk.closest_reference if parsed.gtdbtk else None,
        gtdb_species=parsed.gtdbtk.species if parsed.gtdbtk else None,
        kraken2_top_taxon=parsed.kraken2.top_taxon if parsed.kraken2 else None,
        kraken2_top_fraction=parsed.kraken2.top_fraction if parsed.kraken2 else None,
        mlst_scheme=parsed.mlst.scheme if parsed.mlst else None,
        st=parsed.mlst.st if parsed.mlst else None,
    )

    tool_versions = tuple(
        ToolVersionRow(genome_id, tool, v.version, v.database, v.database_version)
        for tool, v in sorted(versions.items())
    )
    return AssembledGenome(
        genome_id=genome_id,
        sample=parsed.sample,
        facts=facts,
        contigs=tuple(contig_rows),
        features=tuple(features),
        hits=tuple(
            sorted(
                hits.values(),
                key=lambda h: (h.contig_id, h.feature_id, h.source_tool, h.element_name),
            )
        ),
        mutations=tuple(
            sorted(mutations.values(), key=lambda m: (m.contig_id, m.start or 0, m.gene, m.variant))
        ),
        regions=tuple(regions),
        typing=tuple(_typing_rows(genome_id, parsed, typing_display, versions)),
        tool_versions=tool_versions,
        unmapped_hits=tuple(unmapped),
        issues=tuple(issues),
    )
