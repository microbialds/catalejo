"""mgap outputs the platform does not read, written so the tree matches real runs.

Bakta EMBL and hypotheticals, the geNomad intermediate and gene tables, the
Kleborate hAMRonization export, and the fastp or fastplong read reports. The
content is small and consistent with the genome, not a model of the tools.
Paths and column names come from ``ingest.mgap_layout``.
"""

from __future__ import annotations

import json
import random

from ingest import mgap_layout as L
from ingest.synth.build import CODING_TYPES, Feature, Genome
from ingest.synth.catalog import DETERMINANTS, VIRUS_TAXONOMY
from ingest.synth.genbank import embl_text
from ingest.synth.output import Output, fasta, kleborate_strain, rel, tsv
from ingest.synth.sequences import gc_fraction

HYPOTHETICAL = "hypothetical protein"
VIRUS_TAXID = "1246"


def _score(high: bool, rng: random.Random) -> tuple[str, str]:
    top = rng.uniform(0.9, 1.0) if high else rng.uniform(0.0, 0.05)
    return f"{top:.4f}", f"{1 - top:.4f}"


def write_bakta_extras(out: Output, g: Genome, rng: random.Random) -> None:
    b = L.BAKTA
    plan = g.plan
    out.text(rel(b.embl, g), embl_text(g, plan.bakta_version, plan.bakta_db))
    hypotheticals = [
        (c, f)
        for c in g.contigs
        for f in c.features
        if f.type == L.BAKTA.feature_types.cds and f.product == HYPOTHETICAL
    ]
    header = [
        line.format(software=plan.bakta_version, database=plan.bakta_db)
        for line in b.hypotheticals_comment_lines
    ]
    columns = [b.tsv_header_prefix + b.hypotheticals_columns[0], *b.hypotheticals_columns[1:]]
    rows = [
        [
            c.bakta_id,
            str(f.start),
            str(f.end),
            f.strand,
            str(f.locus_tag),
            f"{len(f.protein or '') * 0.11:.1f}",
            f"{rng.uniform(4.5, 10.5):.1f}",
            "",
            ", ".join(f.dbxrefs),
        ]
        for c, f in hypotheticals
    ]
    out.text(rel(b.hypotheticals_tsv, g), "\n".join(header) + "\n" + tsv(columns, rows))
    out.text(
        rel(b.hypotheticals_faa, g),
        fasta(
            ((f"{f.locus_tag} {f.product}", f.protein or "") for _, f in hypotheticals), width=None
        ),
    )


def _prodigal_header(name: str, f: Feature, k: int, contig_index: int) -> str:
    strand = "1" if f.strand == "+" else "-1"
    return f"{name} # {f.start} # {f.end} # {strand} # ID={contig_index}_{k};partial=00"


def _gene_row(name: str, f: Feature) -> list[str]:
    strand = "1" if f.strand == "+" else "-1"
    return [
        name,
        str(f.start),
        str(f.end),
        str(f.end - f.start + 1),
        strand,
        f"{gc_fraction(f.seq):.3f}",
        str(L.BAKTA.gcode),
        "None",
        "NA",
        "NA",
        "NA",
        "0",
        "1" if f.category == "plasmid" else "0",
        "1" if f.prophage is not None else "0",
        "1",
        "NA",
        "NA",
        "NA",
        "NA",
        "NA",
    ]


def write_genomad_extras(out: Output, g: Genome, rng: random.Random) -> None:
    gn = L.GENOMAD
    classification: list[list[str]] = []
    markers: list[list[str]] = []
    taxonomy: list[list[str]] = []
    proviruses: list[list[str]] = []
    provirus_scores: list[list[str]] = []
    virus_genes: list[list[str]] = []
    plasmid_genes: list[list[str]] = []
    virus_fna: list[tuple[str, str]] = []
    plasmid_fna: list[tuple[str, str]] = []
    virus_faa: list[tuple[str, str]] = []
    plasmid_faa: list[tuple[str, str]] = []
    for c in g.contigs:
        plasmid = c.plasmid is not None
        p_score, rest = _score(plasmid, rng)
        classification.append(
            [c.bakta_id, rest if plasmid else p_score, p_score if plasmid else rest, "0.0000"]
        )
        markers.append(list(classification[-1]))
        viral = bool(c.regions)
        taxonomy.append(
            [
                c.bakta_id,
                str(len(c.regions) * 3),
                "1.0000" if viral else "NA",
                VIRUS_TAXID if viral else "1",
                VIRUS_TAXONOMY if viral else "Unclassified",
            ]
        )
        coding = [f for f in c.features if f.type in CODING_TYPES]
        for region in c.regions:
            name = gn.provirus_name.format(contig=c.bakta_id, start=region.start, end=region.end)
            genes = [f for f in coding if region.start <= f.start and f.end <= region.end]
            integrases = [
                f"{name}_{k}" for k, f in enumerate(genes, start=1) if (f.gene or "") == "int"
            ]
            proviruses.append(
                [
                    name,
                    c.bakta_id,
                    str(region.start),
                    str(region.end),
                    str(region.end - region.start + 1),
                    str(len(genes)),
                    f"{rng.uniform(20, 90):.4f}",
                    "False",
                    ";".join(integrases) or "NA",
                ]
            )
            score = f"{rng.uniform(0.99, 1.0):.4f}"
            provirus_scores.append([name, "0.0001", "0.0003", score])
            virus_fna.append((name, c.seq[region.start - 1 : region.end]))
            for k, f in enumerate(genes, start=1):
                gene = f"{name}_{k}"
                virus_genes.append(_gene_row(gene, f))
                virus_faa.append((_prodigal_header(gene, f, k, c.index), f.protein or ""))
        if plasmid:
            plasmid_fna.append((c.bakta_id, c.seq))
            for k, f in enumerate(coding, start=1):
                gene = f"{c.bakta_id}_{k}"
                plasmid_genes.append(_gene_row(gene, f))
                plasmid_faa.append((_prodigal_header(gene, f, k, c.index), f.protein or ""))
    out.text(rel(gn.aggregated, g), tsv(gn.classification_columns, classification))
    out.text(rel(gn.provirus_aggregated, g), tsv(gn.classification_columns, provirus_scores))
    out.text(rel(gn.marker, g), tsv(gn.classification_columns, markers))
    out.text(rel(gn.provirus_marker, g), tsv(gn.classification_columns, provirus_scores))
    out.text(rel(gn.taxonomy, g), tsv(gn.taxonomy_columns, taxonomy))
    out.text(rel(gn.provirus, g), tsv(gn.provirus_columns, proviruses))
    out.text(rel(gn.virus_genes, g), tsv(gn.genes_columns, virus_genes))
    out.text(rel(gn.plasmid_genes, g), tsv(gn.genes_columns, plasmid_genes))
    out.gzip(rel(gn.virus_fna, g), fasta(virus_fna) if virus_fna else "")
    out.gzip(rel(gn.plasmid_fna, g), fasta(plasmid_fna) if plasmid_fna else "")
    out.gzip(rel(gn.virus_proteins, g), fasta(virus_faa) if virus_faa else "")
    out.gzip(rel(gn.plasmid_proteins, g), fasta(plasmid_faa) if plasmid_faa else "")


def write_hamronization(out: Output, g: Genome, version: str) -> None:
    kl = L.KLEBORATE
    plan = g.plan
    strain = kleborate_strain(plan)
    rows: list[list[str]] = []
    for c in g.contigs:
        for f in c.features:
            d = DETERMINANTS.get(f.determinant or "")
            if d is None or d.type != L.AMRFINDERPLUS.type_amr:
                continue
            drug = d.rgi.drug_class if d.rgi else d.drug_class.lower()
            aro = f"ARO:{d.rgi.aro}" if d.rgi else kl.missing
            length = str(f.end - f.start + 1)
            rows.append(
                [
                    strain,
                    d.symbol,
                    kl.missing,
                    kl.hamronization_presence,
                    drug,
                    c.bakta_id,
                    str(c.length),
                    str(f.start),
                    str(f.end),
                    length,
                    "0",
                    length,
                    "100.00%",
                    "100.00%",
                    aro,
                    f.strand,
                    kl.hamronization_software,
                    version,
                    "CARD",
                    "3.2.9",
                ]
                + [kl.missing] * 12
            )
    out.text(rel(kl.hamronization, g), tsv(kl.hamronization_table.columns, rows))


def _read_stats(keys: tuple[str, ...], reads: int, length: int, gc: float) -> dict[str, float]:
    bases = reads * length
    values: dict[str, float] = {}
    for key in keys:
        if key == "total_reads":
            values[key] = reads
        elif key == "total_bases":
            values[key] = bases
        elif key == "q20_bases":
            values[key] = int(bases * 0.93)
        elif key == "q30_bases":
            values[key] = int(bases * 0.86)
        elif key == "q20_rate":
            values[key] = 0.93
        elif key == "q30_rate":
            values[key] = 0.86
        elif key == "gc_content":
            values[key] = round(gc, 6)
        else:
            values[key] = length
    return values


def write_read_reports(out: Output, g: Genome, rng: random.Random) -> None:
    gc = round(gc_fraction("".join(c.seq for c in g.contigs)), 6)
    if g.plan.complete:
        fl = L.FASTPLONG
        before = rng.randint(400_000, 700_000)
        after = int(before * rng.uniform(0.75, 0.9))
        report = {
            fl.key_summary: {
                fl.key_version: "0.3.0",
                fl.key_before: _read_stats(fl.summary_keys, before, 3600, gc),
                fl.key_after: _read_stats(fl.summary_keys, after, 4200, gc),
            },
            fl.key_filtering: dict(
                zip(fl.filtering_keys, [after, 0, 0, before - after, 0], strict=True)
            ),
            fl.key_command: "fastplong --length_required 1000 --qualified_quality_phred 15",
        }
        out.text(rel(fl.json, g), json.dumps(report, indent="\t") + "\n")
        out.text(
            rel(fl.log, g),
            f"Before filtering:\ntotal reads: {before}\n\nAfter filtering:\n"
            f"total reads: {after}\n\nfastplong v0.3.0\n",
        )
        return
    fp = L.FASTP
    before = rng.randint(1_500_000, 3_500_000)
    after = int(before * rng.uniform(0.88, 0.97))
    report = {
        fp.key_summary: {
            fp.key_version: "1.0.1",
            fp.key_sequencing: "paired end (151 cycles + 151 cycles)",
            fp.key_before: _read_stats(fp.summary_keys, before, 151, gc),
            fp.key_after: _read_stats(fp.summary_keys, after, 146, gc),
        },
        fp.key_filtering: dict(
            zip(fp.filtering_keys, [after, 0, 0, before - after, 0], strict=True)
        ),
        fp.key_command: "fastp --detect_adapter_for_pe --thread 6",
    }
    out.text(rel(fp.json, g), json.dumps(report, indent="\t") + "\n")


def write_extras(out: Output, g: Genome, rng: random.Random, kleborate_version: str) -> None:
    write_bakta_extras(out, g, rng)
    write_genomad_extras(out, g, rng)
    if g.plan.has_typing and g.plan.species.typing_tool == L.KLEBORATE.tool:
        write_hamronization(out, g, kleborate_version)
    write_read_reports(out, g, rng)
