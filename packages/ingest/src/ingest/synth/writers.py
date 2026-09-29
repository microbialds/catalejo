"""Write the mgap-shaped files of a synthetic genome (contract §4.1).

Every path and column name comes from ``ingest.mgap_layout``; formats mirror
``data/mgap-example``. Statistics written into reports (sizes, N50, GC,
feature counts) are computed from the generated sequences, so a parser can be
checked against the FASTA files. Output is deterministic: no timestamps,
gzip members with mtime 0 and no file name, and a fixed order for every list.
"""

from __future__ import annotations

import gzip
import io
import random
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path

from ingest import mgap_layout as L
from ingest.synth.build import CODING_TYPES, GAP_LENGTH, Contig, Feature, Genome
from ingest.synth.catalog import DETERMINANTS, PLASMIDS, VIRUS_TAXONOMY, SpeciesSpec
from ingest.synth.genbank import gbff_text
from ingest.synth.plan import (
    AMRFINDER_DB,
    AMRFINDER_VERSION,
    BAKTA_VERSION,
    GenomePlan,
    RunPlan,
)
from ingest.synth.sequences import gc_fraction, md5_hex, sub_rng, wrap

T = L.BAKTA.feature_types

# Tool versions written to pipeline_info/software_versions.yml. Values not in
# data/mgap-example (Flye, Dnaapler, GTDB-Tk, SISTR, sccmec, RGI) are plausible
# current releases.
TOOL_VERSIONS: dict[str, str] = {
    L.CHECKM2.tool: "1.1.0",
    L.GENOMAD.tool: "1.11.2",
    L.BRACKEN.tool: "3.0.1",
    L.KRAKEN2.tool: "2.1.6",
    L.SPADES.tool: "4.1.0",
    L.KLEBORATE.tool: "3.2.4",
    L.MLST.tool: "2.25.0",
    L.MOBSUITE.tool: "3.1.9",
    L.QUAST.tool: "5.3.0",
    L.RGI.tool: "6.0.5",
    L.LONG_READ.flye_tool: "2.9.6",
    L.LONG_READ.dnaapler_tool: "1.2.0",
    L.GTDBTK.tool: "2.4.1",
    L.SISTR.tool: "1.1.3",
    L.SCCMEC.tool: "1.2.0",
}
PIPELINE_VERSION = "2.0.0"
NEXTFLOW_VERSION = "26.04.4"
KRAKEN2_PIGZ = ("pigz", "2.8")


# Low-level output --------------------------------------------------------------------------------


@dataclass
class Output:
    """Writes files under a results directory and counts them."""

    root: Path
    files: int = 0
    bytes: int = 0

    def text(self, relative: str, content: str) -> None:
        self._bytes(relative, content.encode("utf-8"))

    def gzip(self, relative: str, content: str) -> None:
        buffer = io.BytesIO()
        with gzip.GzipFile(filename="", mode="wb", fileobj=buffer, mtime=0) as fh:
            fh.write(content.encode("utf-8"))
        self._bytes(relative, buffer.getvalue())

    def _bytes(self, relative: str, data: bytes) -> None:
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        self.files += 1
        self.bytes += len(data)


def tsv(header: Sequence[str] | None, rows: Iterable[Sequence[str]]) -> str:
    lines = ["\t".join(header)] if header is not None else []
    lines += ["\t".join(row) for row in rows]
    return "\n".join(lines) + "\n"


def fasta(records: Iterable[tuple[str, str]], width: int | None = 60) -> str:
    out: list[str] = []
    for header, seq in records:
        out.append(f">{header}")
        out.append(wrap(seq, width) if width else seq)
    return "\n".join(out) + "\n"


def versions_yml(entries: Sequence[tuple[str, Sequence[tuple[str, str]]]]) -> str:
    """nf-core versions.yml: quoted process names mapping tools to versions."""
    lines: list[str] = []
    for process, tools in entries:
        lines.append(f'"{process}":')
        lines += [f"    {tool}: {version}" for tool, version in tools]
    return "\n".join(lines) + "\n"


@dataclass(frozen=True)
class Stats:
    total: int
    count: int
    n50: int
    n90: int
    l50: int
    l90: int
    aun: float
    largest: int


def stats(lengths: Sequence[int]) -> Stats:
    ordered = sorted(lengths, reverse=True)
    total = sum(ordered)
    n50 = n90 = l50 = l90 = 0
    cumulative = 0
    for i, length in enumerate(ordered, start=1):
        cumulative += length
        if not n50 and cumulative >= total * 0.5:
            n50, l50 = length, i
        if not n90 and cumulative >= total * 0.9:
            n90, l90 = length, i
    aun = sum(x * x for x in ordered) / total if total else 0.0
    return Stats(total, len(ordered), n50, n90, l50, l90, aun, ordered[0] if ordered else 0)


def _f2(x: float) -> str:
    return f"{x:.2f}"


# Assembly ----------------------------------------------------------------------------------------


def assembly_name(plan: GenomePlan) -> str:
    template = L.LONG_READ.assembly_name if plan.complete else L.SPADES.assembly_name
    return template.replace(L.GENOME_ID, plan.genome_id)


def assembly_file(plan: GenomePlan) -> str:
    template = L.LONG_READ.assembly_file if plan.complete else L.SPADES.assembly_file
    return template.replace(L.GENOME_ID, plan.genome_id)


def write_assembly(out: Output, g: Genome) -> None:
    gid = g.genome_id
    records = [(c.assembly_name, c.seq) for c in g.contigs]
    if g.plan.complete:
        lr = L.LONG_READ
        out.gzip(lr.flye_fasta.relative(gid), fasta(records))
        rows = [
            [
                c.assembly_name,
                str(c.length),
                str(round(c.coverage)),
                lr.flye_circular_yes if c.circular else lr.flye_circular_no,
                "N",
                "1",
                "*",
                str(c.index),
            ]
            for c in g.contigs
        ]
        out.text(lr.flye_info.relative(gid), tsv(lr.flye_info_table.columns, rows))
        out.gzip(lr.dnaapler_fasta.relative(gid), fasta(records))
        return
    sp = L.SPADES
    out.gzip(sp.scaffolds.relative(gid), fasta(records))
    out.gzip(sp.contigs.relative(gid), fasta(g.spades_contigs))
    lines = [sp.gfa_header.format(version=TOOL_VERSIONS[sp.tool])]
    segment = 0
    paths: list[str] = []
    for c in g.contigs:
        ids: list[str] = []
        for part in c.seq.split("N" * GAP_LENGTH):
            if not part:
                continue
            segment += 1
            ids.append(f"{segment}+")
            lines.append(f"S\t{segment}\t*\tLN:i:{len(part)}")
        paths.append(f"P\t{c.assembly_name}\t{','.join(ids)}\t*")
    out.gzip(sp.graph.relative(gid), "\n".join(lines + paths) + "\n")
    out.text(
        sp.log.relative(gid),
        f"SPAdes version: {TOOL_VERSIONS[sp.tool]}\n\n======= SPAdes pipeline finished.\n",
    )


# Bakta -------------------------------------------------------------------------------------------


def _bakta_header(plan: GenomePlan) -> list[str]:
    b = L.BAKTA
    return [
        line.format(
            software=plan.bakta_version,
            database=plan.bakta_db,
            database_type=b.database_type,
            doi=b.doi,
            url=b.url,
        )
        for line in b.tsv_comment_lines
    ]


def _fna_header(c: Contig) -> str:
    topology = L.BAKTA.topology_circular if c.circular else L.BAKTA.topology_linear
    return f"{c.bakta_id} " + L.BAKTA.fna_description.format(gcode=L.BAKTA.gcode, topology=topology)


def _gff_escape(value: str) -> str:
    for char, code in (("%", "%25"), (";", "%3B"), ("=", "%3D"), ("&", "%26"), (",", "%2C")):
        value = value.replace(char, code)
    return value


def write_bakta(out: Output, g: Genome) -> None:
    b = L.BAKTA
    gid = g.genome_id
    plan = g.plan
    header = _bakta_header(plan)

    out.text(b.fna.relative(gid), fasta((_fna_header(c), c.seq) for c in g.contigs))

    rows: list[list[str]] = []
    for c in g.contigs:
        for f in c.features:
            rows.append(
                [
                    c.bakta_id,
                    f.type,
                    str(f.start),
                    str(f.end),
                    f.strand,
                    f.locus_tag or "",
                    f.gene or "",
                    f.product,
                    ", ".join(f.dbxrefs),
                ]
            )
    columns = b.tsv_table.columns
    out.text(
        b.tsv.relative(gid),
        "\n".join(header) + "\n" + tsv([b.tsv_header_prefix + columns[0], *columns[1:]], rows),
    )

    coding = [f for f in g.features if f.type in CODING_TYPES]
    out.text(
        b.faa.relative(gid),
        fasta(((f"{f.locus_tag} {f.product}", f.protein or "") for f in coding), width=None),
    )
    out.text(
        b.ffn.relative(gid),
        fasta(
            ((f"{f.ident} {f.product}", f.seq) for f in g.features if f.type != T.gap), width=None
        ),
    )

    gff_kind = {t: (kind, source) for t, kind, source in b.gff3_types}
    gff: list[str] = [*b.gff3_header_lines, *header]
    for c in g.contigs:
        gff.append(b.gff3_sequence_region.format(contig=c.bakta_id, length=c.length))
        region = f"ID={c.bakta_id};Name={c.bakta_id}"
        if c.circular:
            region += ";Is_circular=true"
        gff.append(
            "\t".join(
                [
                    c.bakta_id,
                    b.gff3_region_source,
                    b.gff3_region_type,
                    "1",
                    str(c.length),
                    ".",
                    "+",
                    ".",
                    region,
                ]
            )
        )
        for f in c.features:
            kind, source = gff_kind[f.type]
            attributes = [f"ID={f.ident}", f"Name={_gff_escape(f.product)}"]
            if f.locus_tag:
                attributes.append(f"locus_tag={f.locus_tag}")
            attributes.append(f"product={_gff_escape(f.product)}")
            if f.dbxrefs:
                attributes.append("Dbxref=" + ",".join(f.dbxrefs))
            if f.gene:
                attributes.append(f"gene={_gff_escape(f.gene)}")
            phase = "0" if kind == "CDS" else "."
            gff.append(
                "\t".join(
                    [
                        c.bakta_id,
                        source,
                        kind,
                        str(f.start),
                        str(f.end),
                        ".",
                        f.strand,
                        phase,
                        ";".join(attributes),
                    ]
                )
            )
    gff.append(b.gff3_fasta_marker)
    out.text(
        b.gff3.relative(gid), "\n".join(gff) + "\n" + fasta((c.bakta_id, c.seq) for c in g.contigs)
    )

    out.text(b.gbff.relative(gid), gbff_text(g, plan.bakta_version, plan.bakta_db))
    out.text(b.summary.relative(gid), _bakta_summary(g))
    out.text(b.versions.relative(gid), versions_yml([(b.process, [(b.tool, plan.bakta_version)])]))


def _bakta_summary(g: Genome) -> str:
    k = L.BAKTA.summary_keys
    b = L.BAKTA
    s = stats([c.length for c in g.contigs])
    seq = "".join(c.seq for c in g.contigs)
    n = seq.count("N")
    feats = g.features
    count = {t: sum(1 for f in feats if f.type == t) for t in vars(T).values()}
    coding_bp = sum(f.end - f.start + 1 for f in feats if f.type in CODING_TYPES)
    hypothetical = sum(1 for f in feats if f.type == T.cds and f.product == "hypothetical protein")
    lines = [
        k.section_sequences,
        f"{k.length}: {s.total}",
        f"{k.count}: {s.count}",
        f"{k.gc}: {100 * gc_fraction(seq):.1f}",
        f"{k.n50}: {s.n50}",
        f"{k.n90}: {s.n90}",
        f"{k.n_ratio}: {100 * n / s.total:.1f}",
        f"{k.coding_density}: {100 * coding_bp / s.total:.1f}",
        "",
        k.section_annotation,
        f"{k.trnas}: {count[T.trna]}",
        f"{k.tmrnas}: {count[T.tmrna]}",
        f"{k.rrnas}: {count[T.rrna]}",
        f"{k.ncrnas}: {count[T.ncrna]}",
        f"{k.ncrna_regions}: {count[T.ncrna_region]}",
        f"{k.crispr_arrays}: {count[T.crispr]}",
        f"{k.cdss}: {count[T.cds]}",
        f"{k.pseudogenes}: 0",
        f"{k.hypotheticals}: {hypothetical}",
        f"{k.sorfs}: {count[T.sorf]}",
        f"{k.gaps}: {count[T.gap]}",
        f"{k.orics}: {count[T.oric]}",
        f"{k.orivs}: {count[T.oriv]}",
        f"{k.orits}: {count[T.orit]}",
        "",
        k.section_bakta,
        f"{k.software}: v{g.plan.bakta_version}",
        f"{k.database}: v{g.plan.bakta_db}, {b.database_type}",
        f"{k.doi}: {b.doi}",
        f"{k.url}: {b.url}",
    ]
    return "\n".join(lines) + "\n"


# AMRFinderPlus -----------------------------------------------------------------------------------


def _closest_name(f: Feature) -> str:
    gene = f.gene or ""
    return f"{f.product} {gene[:1].upper()}{gene[1:]}".strip()


def amrfinder_rows(g: Genome, rng: random.Random) -> tuple[list[list[str]], list[list[str]]]:
    """Rows of the main report and of the mutation report."""
    a = L.AMRFINDERPLUS
    report: list[tuple[str, int, str, list[str]]] = []
    mutations: list[tuple[str, int, str, list[str]]] = []
    spec = g.plan.species
    for c in g.contigs:
        for f in c.features:
            if f.determinant:
                d = DETERMINANTS[f.determinant]
                nucleotide = d.method.endswith("X")
                aa = d.aa_length
                identity = (
                    "100.00"
                    if d.method.startswith(("EXACT", "ALLELE"))
                    else _f2(rng.uniform(96.0, 99.9))
                )
                coverage, aligned = "100.00", aa
                if d.method.startswith("PARTIAL"):
                    aligned = int(aa * rng.uniform(0.6, 0.85))
                    coverage = _f2(100 * aligned / aa)
                row = [
                    a.missing if nucleotide else str(f.locus_tag),
                    c.bakta_id,
                    str(f.start),
                    str(f.end),
                    f.strand,
                    d.symbol,
                    d.name,
                    d.scope,
                    d.type,
                    d.subtype,
                    d.drug_class,
                    d.subclass,
                    d.method,
                    str(aa),
                    str(aa),
                    coverage,
                    identity,
                    str(aligned),
                    d.accession,
                    d.name,
                    a.missing,
                    a.missing,
                ]
                report.append((c.bakta_id, f.start, d.symbol, row))
            if g.plan.clean:
                continue
            if f.mutation_gene:
                for m in spec.point_mutations:
                    if m.gene != f.mutation_gene or m.is_promoter:
                        continue
                    aa = len(f.protein or "")
                    carried = m.symbol in g.plan.mutations
                    closest = _closest_name(f)
                    symbol = m.symbol if carried else f"{m.gene}_{m.wildtype}"
                    name = m.element_name if carried else f"{closest}{a.wildtype_suffix}"
                    row = [
                        str(f.locus_tag),
                        c.bakta_id,
                        str(f.start),
                        str(f.end),
                        f.strand,
                        symbol,
                        name,
                        a.scope_core,
                        a.type_amr,
                        a.subtype_point,
                        m.drug_class,
                        m.subclass,
                        "POINTP",
                        str(aa),
                        str(aa),
                        "100.00",
                        _f2(rng.uniform(98.5, 99.9)),
                        str(aa),
                        m.accession,
                        closest,
                        a.missing,
                        a.missing,
                    ]
                    mutations.append((c.bakta_id, f.start, symbol, row))
                    if carried:
                        report.append((c.bakta_id, f.start, symbol, row))
                aa = len(f.protein or "")
                unknown = f"{f.mutation_gene}_E{aa - 4}D"
                mutations.append(
                    (
                        c.bakta_id,
                        f.start,
                        unknown,
                        [
                            str(f.locus_tag),
                            c.bakta_id,
                            str(f.start),
                            str(f.end),
                            f.strand,
                            unknown,
                            f"{_closest_name(f)}{a.unknown_suffix}",
                            a.scope_core,
                            a.type_amr,
                            a.subtype_point,
                            a.missing,
                            a.missing,
                            "POINTP",
                            str(aa),
                            str(aa),
                            "100.00",
                            "99.10",
                            str(aa),
                            "WP_000000000.1",
                            _closest_name(f),
                            a.missing,
                            a.missing,
                        ],
                    )
                )
            if f.determinant:
                for m in spec.point_mutations:
                    if not (m.is_promoter and f.determinant.startswith(m.gene)):
                        continue
                    carried = m.symbol in g.plan.mutations
                    start, end = f.start - 199, f.start + 100
                    symbol = m.symbol if carried else f"{m.gene}_{m.wildtype}"
                    region = f"{m.gene} promoter region"
                    name = m.element_name if carried else f"{m.element_name}{a.wildtype_suffix}"
                    row = [
                        a.missing,
                        c.bakta_id,
                        str(start),
                        str(end),
                        "+",
                        symbol,
                        name,
                        a.scope_core,
                        a.type_amr,
                        a.subtype_point,
                        m.drug_class,
                        m.subclass,
                        "POINTN",
                        "300",
                        "300",
                        "100.00",
                        "99.67",
                        "300",
                        m.accession,
                        region,
                        a.missing,
                        a.missing,
                    ]
                    mutations.append((c.bakta_id, start, symbol, row))
                    if carried:
                        report.append((c.bakta_id, start, symbol, row))
    report.sort(key=lambda item: item[:3])
    mutations.sort(key=lambda item: item[:3])
    return [item[3] for item in report], [item[3] for item in mutations]


def write_amrfinder(out: Output, g: Genome, rng: random.Random) -> None:
    a = L.AMRFINDERPLUS
    gid = g.genome_id
    report, mutations = amrfinder_rows(g, rng)
    out.text(a.report.relative(gid), tsv(a.report_table.columns, report))
    out.text(a.mutations.relative(gid), tsv(a.mutations_table.columns, mutations))
    entries = [(a.tool, g.plan.amrfinder_version), (a.database_key, g.plan.amrfinder_db)]
    out.text(a.versions.relative(gid), versions_yml([(a.process, entries)]))


# RGI ---------------------------------------------------------------------------------------------


def write_rgi(out: Output, g: Genome, rng: random.Random) -> None:
    r = L.RGI
    rows: list[list[str]] = []
    hit = 0
    for c in g.contigs:
        orf = 0
        for f in c.features:
            if f.type not in CODING_TYPES:
                continue
            orf += 1
            d = DETERMINANTS.get(f.determinant or "")
            if d is None or d.rgi is None or d.type != L.AMRFINDERPLUS.type_amr:
                continue
            hit += 1
            identity = (
                100.0
                if d.method.startswith(("EXACT", "ALLELE"))
                else round(rng.uniform(95.0, 99.9), 2)
            )
            strand = "1" if f.strand == "+" else "-1"
            orf_id = r.orf_id.format(
                contig=c.assembly_name,
                orf=orf,
                start=f.start,
                stop=f.end,
                strand=strand,
                contig_index=c.index,
                gc=gc_fraction(f.seq),
            )
            protein = f.protein or ""
            rows.append(
                [
                    orf_id,
                    r.orf_name.format(contig=c.assembly_name, orf=orf),
                    str(f.start),
                    str(f.end),
                    f.strand,
                    r.cut_off_perfect if identity == 100.0 else r.cut_off_strict,
                    str(int(len(protein) * 1.6)),
                    f"{len(protein) * 1.9:.1f}",
                    d.rgi.best_hit_aro,
                    f"{identity}",
                    d.rgi.aro,
                    d.rgi.model_type,
                    r.missing,
                    r.missing,
                    d.rgi.drug_class,
                    d.rgi.mechanism,
                    d.rgi.family,
                    f.seq,
                    protein,
                    protein,
                    "100.00",
                    f"gnl|BL_ORD_ID|{1000 + hit}|hsp_num:0",
                    str(3000 + hit),
                    "",
                    "",
                    "0",
                    str(len(f.seq) - 3),
                    d.rgi.antibiotic,
                ]
            )
    out.text(r.report.relative(g.genome_id), tsv(r.table.columns, rows))


# geNomad -----------------------------------------------------------------------------------------


def write_genomad(out: Output, g: Genome, rng: random.Random) -> None:
    gn = L.GENOMAD
    gid = g.genome_id
    virus: list[list[str]] = []
    plasmid: list[list[str]] = []
    for c in g.contigs:
        for region in c.regions:
            virus.append(
                [
                    gn.provirus_name.format(contig=c.bakta_id, start=region.start, end=region.end),
                    str(region.end - region.start + 1),
                    gn.topology_provirus,
                    gn.coordinates.format(start=region.start, end=region.end),
                    str(region.n_genes),
                    str(L.BAKTA.gcode),
                    f"{rng.uniform(0.95, 0.9999):.4f}",
                    gn.missing,
                    str(rng.randint(2, 18)),
                    f"{rng.uniform(15, 95):.4f}",
                    VIRUS_TAXONOMY,
                ]
            )
        spec = c.plasmid
        if spec is not None:
            genes = [f for f in c.features if f.type in CODING_TYPES]
            hallmarks = sum(1 for f in genes if f.category == "plasmid")
            plasmid.append(
                [
                    c.bakta_id,
                    str(c.length),
                    gn.topology_dtr if c.circular else gn.topology_no_repeats,
                    str(len(genes)),
                    str(L.BAKTA.gcode),
                    f"{rng.uniform(0.93, 1.0):.4f}",
                    gn.missing,
                    str(hallmarks),
                    f"{rng.uniform(2, 70):.4f}",
                    gn.list_separator.join(spec.conjugation_genes) or gn.missing,
                    gn.missing,
                ]
            )
    out.text(gn.virus_summary.relative(gid), tsv(gn.virus_table.columns, virus))
    out.text(gn.plasmid_summary.relative(gid), tsv(gn.plasmid_table.columns, plasmid))


# MOB-suite ---------------------------------------------------------------------------------------


def write_mobsuite(out: Output, g: Genome) -> None:
    m = L.MOBSUITE
    gid = g.genome_id
    rows: list[tuple[str, list[str]]] = []
    for c in g.contigs:
        spec = c.plasmid
        roles = {f.plasmid_role for f in c.features}
        contig_id = _fna_header(c)
        dash = m.missing
        if spec is None:
            row = [
                gid,
                m.molecule_chromosome,
                dash,
                dash,
                contig_id,
                str(c.length),
                repr(c.gc),
                md5_hex(c.seq),
                m.circularity_not_tested,
            ] + [dash] * 15
        else:
            has_rep = "rep" in roles
            has_relaxase = "relaxase" in roles and bool(spec.relaxases)
            n_mpf = sum(1 for f in c.features if f.plasmid_role == "mpf")
            row = [
                gid,
                m.molecule_plasmid,
                spec.primary_cluster,
                spec.secondary_cluster,
                contig_id,
                str(c.length),
                repr(c.gc),
                md5_hex(c.seq),
                m.circularity_not_tested,
                m.list_separator.join(spec.replicons) if has_rep else dash,
                m.list_separator.join(spec.rep_accessions) if has_rep else dash,
                m.list_separator.join(spec.relaxases) if has_relaxase else dash,
                m.list_separator.join(spec.relaxase_accessions) if has_relaxase else dash,
                m.list_separator.join([spec.mpf] * n_mpf) if spec.mpf and n_mpf else dash,
                m.list_separator.join(f"NC_0143{k:02d}_001" for k in range(n_mpf))
                if spec.mpf and n_mpf
                else dash,
                dash,
                dash,
                dash,
                spec.mash_neighbor,
                str(spec.mash_distance),
                spec.mash_identification,
                dash,
                dash,
                dash,
            ]
        rows.append((contig_id, row))
    rows.sort(key=lambda item: item[0])
    out.text(
        m.contig_report.relative(gid), tsv(m.contig_report_table.columns, [r for _, r in rows])
    )
    if not g.plan.plasmids:
        return
    typer_rows: list[list[str]] = []
    for key in g.plan.plasmids:
        spec = PLASMIDS[key]
        contigs = [c for c in g.contigs if c.replicon == key]
        seq = "".join(c.seq for c in contigs)
        rank, name = spec.host_range
        typer_rows.append(
            [
                m.mobtyper_sample_id.format(genome_id=gid, cluster=spec.primary_cluster),
                str(len(contigs)),
                str(len(seq)),
                repr(gc_fraction(seq)),
                md5_hex(seq),
                m.list_separator.join(spec.replicons) or m.missing,
                m.list_separator.join(spec.rep_accessions) or m.missing,
                m.list_separator.join(spec.relaxases) or m.missing,
                m.list_separator.join(spec.relaxase_accessions) or m.missing,
                spec.mpf or m.missing,
                m.missing,
                m.missing,
                m.missing,
                spec.mobility,
                spec.mash_neighbor,
                str(spec.mash_distance),
                spec.mash_identification,
                spec.primary_cluster,
                spec.secondary_cluster,
                rank,
                name,
                rank,
                name,
                rank,
                name,
                m.missing,
            ]
        )
    out.text(m.mobtyper_results.relative(gid), tsv(m.mobtyper_table.columns, typer_rows))


# Quality and taxonomy ----------------------------------------------------------------------------


def write_checkm2(out: Output, g: Genome) -> None:
    c2 = L.CHECKM2
    s = stats([c.length for c in g.contigs])
    coding = [f for f in g.features if f.type in CODING_TYPES]
    coding_bp = sum(f.end - f.start + 1 for f in coding)
    row = [
        assembly_name(g.plan),
        f"{g.plan.completeness}",
        f"{g.plan.contamination}",
        c2.model_specific,
        str(L.BAKTA.gcode),
        f"{coding_bp / s.total:.3f}",
        str(s.n50),
        repr(coding_bp / 3 / len(coding)),
        str(s.total),
        f"{gc_fraction(''.join(c.seq for c in g.contigs)):.2f}",
        str(len(coding)),
        str(s.count),
        str(s.largest),
        c2.notes_none,
    ]
    out.text(c2.report.relative(g.genome_id), tsv(c2.table.columns, [row]))


def write_quast(out: Output, g: Genome) -> None:
    q = L.QUAST
    lengths = [c.length for c in g.contigs]
    kept = [x for x in lengths if x >= q.min_contig]
    s = stats(kept)
    seq = "".join(c.seq for c in g.contigs if c.length >= q.min_contig)
    ns = seq.count("N")
    values = [assembly_name(g.plan)]
    values += [str(sum(1 for x in lengths if x >= t)) for t in q.thresholds]
    values += [str(sum(x for x in lengths if x >= t)) for t in q.thresholds]
    values += [
        str(s.count),
        str(s.largest),
        str(s.total),
        f"{100 * gc_fraction(seq):.2f}",
        str(s.n50),
        str(s.n90),
        f"{s.aun:.1f}",
        str(s.l50),
        str(s.l90),
        f"{100000 * ns / s.total:.2f}",
    ]
    rows = [[label, value] for label, value in zip(q.table.columns, values, strict=True)]
    out.text(q.report.relative(g.genome_id), tsv(None, rows))


def _kraken_species(plan: GenomePlan) -> tuple[tuple[int, str], tuple[int, str]]:
    spec = plan.species
    own = (spec.taxid, spec.name)
    relative = (spec.relative.taxid, spec.relative.name)
    return (relative, own) if plan.conflict_species else (own, relative)


def write_kraken(out: Output, g: Genome, rng: random.Random) -> None:
    k2, br = L.KRAKEN2, L.BRACKEN
    spec = g.plan.species
    total = rng.randint(800_000, 1_600_000)
    unclassified = int(total * rng.uniform(0.01, 0.03))
    classified = total - unclassified
    (top_id, top_name), (rel_id, rel_name) = _kraken_species(g.plan)
    top = int(classified * rng.uniform(0.12, 0.2))
    rel = int(classified * rng.uniform(0.001, 0.004))
    # Reads assigned at each level of the lineage (the rest go to the genus and above).
    genus_reads = int(classified * rng.uniform(0.6, 0.75))
    above = classified - top - rel - genus_reads
    levels: list[tuple[str, int, str, int]] = [
        ("R", 1, "root", above // 3),
        ("R1", 131567, "cellular organisms", 25),
        ("D", 2, "Bacteria", above // 6),
    ]
    remaining = above - above // 3 - 25 - above // 6
    for i, t in enumerate(spec.lineage[:-1]):
        share = remaining // (len(spec.lineage) - 1 - i)
        levels.append((t.rank, t.taxid, t.name, share))
        remaining -= share
    genus = spec.lineage[-1]
    levels.append((genus.rank, genus.taxid, genus.name, genus_reads + remaining))
    species = sorted([(top, top_id, top_name), (rel, rel_id, rel_name)], reverse=True)
    rows: list[list[str]] = [
        [
            k2.percent_format.format(100 * unclassified / total),
            str(unclassified),
            str(unclassified),
            k2.rank_unclassified,
            "0",
            "unclassified",
        ],
    ]
    clade = classified
    for depth, (rank, taxid, name, own) in enumerate(levels):
        rows.append(
            [
                k2.percent_format.format(100 * clade / total),
                str(clade),
                str(own),
                rank,
                str(taxid),
                k2.indent * depth + name,
            ]
        )
        clade -= own
    for reads, taxid, name in species:
        rows.append(
            [
                k2.percent_format.format(100 * reads / total),
                str(reads),
                str(reads),
                k2.rank_species,
                str(taxid),
                k2.indent * len(levels) + name,
            ]
        )
    out.text(k2.report.relative(g.genome_id), tsv(None, rows))

    est_top = int(classified * rng.uniform(0.95, 0.985))
    est_rel = int(classified * rng.uniform(0.002, 0.006))
    b_rows = [
        [
            top_name,
            str(top_id),
            br.level_species,
            str(top),
            str(est_top - top),
            str(est_top),
            f"{est_top / classified:.5f}",
        ],
        [
            rel_name,
            str(rel_id),
            br.level_species,
            str(rel),
            str(est_rel - rel),
            str(est_rel),
            f"{est_rel / classified:.5f}",
        ],
    ]
    out.text(br.report.relative(g.genome_id), tsv(br.table.columns, b_rows))


# Typing ------------------------------------------------------------------------------------------


def st_value(plan: GenomePlan) -> str:
    if plan.profile is None or plan.novel_st:
        return L.MLST.missing
    return plan.profile.st


def write_mlst(out: Output, g: Genome) -> None:
    ml = L.MLST
    plan = g.plan
    spec = plan.species
    row = [assembly_file(plan), spec.mlst_scheme or ml.missing, st_value(plan)]
    if plan.profile is not None:
        for j, (gene, allele) in enumerate(zip(spec.mlst_genes, plan.profile.alleles, strict=True)):
            value = f"~{allele}" if plan.novel_st and j == 0 else str(allele)
            row.append(ml.allele.format(gene=gene, allele=value))
    out.text(ml.report.relative(g.genome_id), tsv(None, [row]))


def _typing(plan: GenomePlan) -> dict[str, str]:
    return dict(plan.profile.typing) if plan.profile else {}


def _acquired(g: Genome) -> set[str]:
    return {f.determinant for f in g.features if f.determinant}


def write_kleborate(out: Output, g: Genome, rng: random.Random) -> None:
    kl = L.KLEBORATE
    k = kl.columns
    plan = g.plan
    carried = _acquired(g)
    row = dict.fromkeys(k.all, kl.missing)
    s = stats([c.length for c in g.contigs])
    typing = _typing(plan)
    row.update(
        {
            k.strain: plan.genome_id,
            k.species: plan.conflict_species or plan.species.name,
            k.species_match: "strong",
            k.contig_count: str(s.count),
            k.n50: str(s.n50),
            k.largest_contig: str(s.largest),
            k.total_size: str(s.total),
            k.ambiguous_bases: "no",
            k.st: f"ST{st_value(plan)}",
            k.ybst: "0",
            k.cbst: "0",
            k.abst: "0",
            k.smst: "0",
            k.rmst: "0",
            k.wzi: f"wzi{rng.randint(1, 200)}",
            k.k_locus_confidence: "Typeable",
            k.o_locus_confidence: "Typeable",
        }
    )
    if plan.profile is not None:
        for gene, allele in zip(k.mlst_alleles, plan.profile.alleles, strict=True):
            row[gene] = str(allele)
    for key in (k.k_locus, k.k_type, k.o_locus, k.o_type):
        row[key] = typing.get(key, kl.missing)
    virulence = 0
    if "ybtP" in carried:
        row[k.ybst] = str(rng.randint(10, 400))
        row[k.yersiniabactin] = "ybt 9; ICEKp3"
        virulence = 1
    if "iucA" in carried:
        row[k.abst] = "1"
        row[k.aerobactin] = "iuc 1"
        virulence = 4 if virulence else 3
    row[k.virulence_score] = str(virulence)
    if "blaKPC-2" in carried:
        row[k.bla_carb_acquired] = "KPC-2"
    if "blaCTX-M-15" in carried:
        row[k.bla_esbl_acquired] = "CTX-M-15"
    if "blaSHV-11" in carried:
        row[k.bla_chr] = "SHV-11"
    flq = [m for m in plan.mutations if m.startswith(("gyrA", "parC"))]
    if flq:
        row[k.flq_mutations] = ";".join(
            f"{m.split('_')[0][:1].upper()}{m.split('_')[0][1:]}:p.{m.split('_')[1]}" for m in flq
        )
    resistance = 2 if "blaKPC-2" in carried else 1 if "blaCTX-M-15" in carried else 0
    row[k.resistance_score] = str(resistance)
    amr = [s for s in carried if DETERMINANTS[s].type == L.AMRFINDERPLUS.type_amr]
    row[k.num_resistance_genes] = str(len(amr))
    row[k.num_resistance_classes] = str(len({DETERMINANTS[s].drug_class for s in amr}))
    out.text(kl.report.relative(plan.genome_id), tsv(k.all, [[row[c] for c in k.all]]))


def write_sistr(out: Output, g: Genome, rng: random.Random) -> None:
    si = L.SISTR
    c = si.columns
    plan = g.plan
    typing = _typing(plan)
    serovar = typing.get(c.serovar, "-")
    values = {
        c.cgmlst_st: str(rng.randrange(10**8, 10**10)),
        c.cgmlst_distance: f"{rng.uniform(0.0, 0.03):.4f}",
        c.cgmlst_found_loci: str(rng.randint(325, 330)),
        c.cgmlst_genome_match: f"SAL_{rng.choice('ABCDEFGH')}{rng.choice('ABCDEFGH')}"
        f"{rng.randint(1000, 9999)}AA",
        c.cgmlst_matching_alleles: str(rng.randint(310, 330)),
        c.cgmlst_subspecies: "enterica",
        c.fasta_filepath: assembly_file(plan),
        c.genome: plan.genome_id,
        c.h1: typing.get(c.h1, "-"),
        c.h2: typing.get(c.h2, "-"),
        c.o_antigen: typing.get(c.o_antigen, "-"),
        c.qc_messages: "",
        c.qc_status: "PASS",
        c.serogroup: typing.get(c.serogroup, "-"),
        c.serovar: serovar,
        c.serovar_antigen: serovar,
        c.serovar_cgmlst: serovar,
    }
    columns = si.table.columns
    out.text(si.report.relative(plan.genome_id), tsv(columns, [[values[x] for x in columns]]))


def write_sccmec(out: Output, g: Genome) -> None:
    sc = L.SCCMEC
    c = sc.columns
    plan = g.plan
    mec = "mecA" in _acquired(g)
    typing = _typing(plan)
    sccmec_type = typing.get(c.type, "-") if mec else "-"
    subtype = typing.get(c.subtype, "-") if mec else "-"
    values = {
        c.sample: plan.genome_id,
        c.type: sccmec_type,
        c.subtype: subtype,
        c.mecA: "True" if mec else "False",
        c.targets: "mecA,ccrA2,ccrB2" if mec else "-",
        c.regions: subtype,
        c.target_schema: "sccmec_targets",
        c.target_schema_version: "1.2.0",
        c.region_schema: "sccmec_regions",
        c.region_schema_version: "1.2.0",
        c.camlhmp_version: "1.1.0",
        c.params: "min-coverage=50;min-pident=85",
        c.target_comment: "",
        c.region_comment: "",
    }
    columns = sc.table.columns
    out.text(sc.report.relative(plan.genome_id), tsv(columns, [[values[x] for x in columns]]))


def write_typing(out: Output, g: Genome, rng: random.Random) -> None:
    plan = g.plan
    if not plan.has_typing:
        return
    tool = plan.species.typing_tool
    if tool == L.KLEBORATE.tool:
        write_kleborate(out, g, rng)
    elif tool == L.SISTR.tool:
        write_sistr(out, g, rng)
    elif tool == L.SCCMEC.tool:
        write_sccmec(out, g)


# Genome and run ----------------------------------------------------------------------------------


def write_genome(out: Output, g: Genome, seed: int) -> None:
    rng = sub_rng(seed, "tools", g.genome_id)
    write_assembly(out, g)
    write_bakta(out, g)
    write_amrfinder(out, g, rng)
    write_rgi(out, g, rng)
    write_genomad(out, g, rng)
    if g.plan.has_mobsuite:
        write_mobsuite(out, g)
    write_checkm2(out, g)
    write_quast(out, g)
    write_kraken(out, g, rng)
    write_mlst(out, g)
    write_typing(out, g, rng)


def write_gtdbtk(out: Output, run: RunPlan) -> None:
    gt = L.GTDBTK
    c = gt.columns
    rows: list[list[str]] = []
    for plan in sorted(run.genomes, key=lambda p: p.genome_id):
        if not plan.in_gtdbtk:
            continue
        lineage = plan.species.gtdb_lineage
        reference = plan.species.gtdb_reference
        if plan.conflict_species:
            genus = lineage.rsplit(gt.rank_separator, 1)[0]
            lineage = f"{genus}{gt.rank_separator}{gt.species_prefix}{plan.conflict_species}"
            reference = "GCF_000019565.1"
        rng = sub_rng(run.seed, L.GTDBTK.tool, plan.genome_id)
        ani = f"{rng.uniform(98.2, 99.8):.2f}"
        values = {
            c.user_genome: plan.genome_id,
            c.classification: lineage,
            c.closest_genome_reference: reference,
            c.closest_genome_reference_radius: "95.0",
            c.closest_genome_taxonomy: lineage,
            c.closest_genome_ani: ani,
            c.closest_genome_af: f"{rng.uniform(0.85, 0.97):.3f}",
            c.closest_placement_reference: reference,
            c.closest_placement_radius: "95.0",
            c.closest_placement_taxonomy: lineage,
            c.closest_placement_ani: ani,
            c.closest_placement_af: f"{rng.uniform(0.85, 0.97):.3f}",
            c.pplacer_taxonomy: lineage.rsplit(gt.rank_separator, 1)[0]
            + gt.rank_separator
            + gt.species_prefix,
            c.classification_method: "taxonomic classification defined by topology and ANI",
            c.note: "topological placement and ANI have congruent species assignments",
            c.other_related_references: gt.missing,
            c.msa_percent: f"{rng.uniform(90, 99):.2f}",
            c.translation_table: str(L.BAKTA.gcode),
            c.red_value: gt.missing,
            c.warnings: gt.missing,
        }
        rows.append([values[x] for x in gt.table.columns])
    if rows:
        out.text(gt.summary.relative(), tsv(gt.table.columns, rows))


def write_software_versions(out: Output, run: RunPlan) -> None:
    """Run-level versions; the current AMRFinderPlus database is the run's."""
    genomes = run.genomes
    species = {s.typing_tool for s in run.species}
    entries: list[tuple[str, list[tuple[str, str]]]] = [
        (
            L.AMRFINDERPLUS.process,
            [
                (L.AMRFINDERPLUS.tool, AMRFINDER_VERSION),
                (L.AMRFINDERPLUS.database_key, AMRFINDER_DB),
            ],
        ),
        (L.BAKTA.process, [(L.BAKTA.tool, BAKTA_VERSION)]),
    ]
    modules: list[tuple[str, str, bool]] = [
        (L.CHECKM2.process, L.CHECKM2.tool, True),
        (L.GENOMAD.process, L.GENOMAD.tool, True),
        (L.BRACKEN.process, L.BRACKEN.tool, True),
        (L.SPADES.process, L.SPADES.tool, any(not g.complete for g in genomes)),
        (L.LONG_READ.flye_process, L.LONG_READ.flye_tool, any(g.complete for g in genomes)),
        (L.LONG_READ.dnaapler_process, L.LONG_READ.dnaapler_tool, any(g.complete for g in genomes)),
        (L.KLEBORATE.process, L.KLEBORATE.tool, L.KLEBORATE.tool in species),
        (L.SISTR.process, L.SISTR.tool, L.SISTR.tool in species),
        (L.SCCMEC.process, L.SCCMEC.tool, L.SCCMEC.tool in species),
        (L.MLST.process, L.MLST.tool, True),
        (L.MOBSUITE.process, L.MOBSUITE.tool, any(g.has_mobsuite for g in genomes)),
        (L.QUAST.process, L.QUAST.tool, True),
        (L.RGI.process, L.RGI.tool, True),
        (L.GTDBTK.process, L.GTDBTK.tool, any(g.in_gtdbtk for g in genomes)),
    ]
    for process, tool, present in modules:
        if present:
            entries.append((process, [(tool, TOOL_VERSIONS[tool])]))
    entries.append(
        (L.KRAKEN2.process, [(L.KRAKEN2.tool, TOOL_VERSIONS[L.KRAKEN2.tool]), KRAKEN2_PIGZ])
    )
    entries.sort(key=lambda e: e[0])
    pi = L.PIPELINE_INFO
    entries.append(
        (
            pi.workflow_key,
            [(pi.pipeline_key, PIPELINE_VERSION), (pi.nextflow_key, NEXTFLOW_VERSION)],
        )
    )
    out.text(pi.software_versions.relative(), versions_yml(entries))


def species_of(run: RunPlan, code: str) -> SpeciesSpec:
    return next(s for s in run.species if s.code == code)
