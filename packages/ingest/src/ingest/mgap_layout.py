"""Every mgap file path and column name, defined once (contract §4.1).

This module is the single place that knows the layout of an mgap results
directory (gene2dis/mgap ``--outdir``). The parsers (``ingest.parsers``,
milestone 1a) and the synthetic generator (``ingest.synth``) both import it
and never spell a path or a column name themselves; a test enforces this.

The layout was derived from ``data/mgap-example/`` (mgap 2.0.0, two Illumina
SPAdes draft genomes, SCL29833 and SP10). Entries marked ``provisional=True``
are not confirmed by that example; they follow the documented output names of
the tools and must be checked against the first mgap run that produces them.
``CONTRACT_DIFFERENCES`` lists where the example disagrees with contract §4.1.

Conventions seen in the example, which the parsers rely on.

- Per-genome files live under ``<genome_id>/`` and run-level files under
  ``pipeline_info/``. Templates below use ``{genome_id}``.
- The Bakta nucleotide FASTA (``.fna``) is the assembly every annotation tool
  reads. Bakta renames contigs to ``contig_<k>`` in the order of the SPAdes
  scaffolds after dropping those shorter than ``MIN_CONTIG_LENGTH``, and its
  headers carry `` [gcode=11] [topology=linear]``. AMRFinderPlus, geNomad,
  MOB-suite and Kleborate report ``contig_<k>`` names (MOB-suite with the
  bracketed suffix), while the SPAdes FASTA files and RGI use the SPAdes names
  ``NODE_<k>_length_<L>_cov_<C>``.
- CheckM2, QUAST and MLST name the assembly ``<genome_id>.scaffolds``.
- ``-`` means "none" in MLST, MOB-suite and Kleborate; ``NA`` in
  AMRFinderPlus and geNomad.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, fields
from enum import StrEnum
from pathlib import Path
from typing import Any

GENOME_ID = "{genome_id}"

# Bakta keeps contigs of at least this length; SCL29833 has 255 scaffolds and
# 137 Bakta contigs, the shortest exactly 200 bp.
MIN_CONTIG_LENGTH = 200


@dataclass(frozen=True)
class MgapPath:
    """A path relative to the mgap results directory.

    ``optional`` marks files that may be absent for a genome on which the
    module ran (for example ``mobtyper_results.txt`` when no plasmid was
    found, or a species-specific typing tool).
    """

    template: str
    provisional: bool = False
    optional: bool = False

    @property
    def per_genome(self) -> bool:
        return GENOME_ID in self.template

    def relative(self, genome_id: str | None = None) -> str:
        if self.per_genome:
            if genome_id is None:
                raise ValueError(f"{self.template} needs a genome_id")
            return self.template.replace(GENOME_ID, genome_id)
        return self.template

    def resolve(self, results_dir: Path, genome_id: str | None = None) -> Path:
        return results_dir / self.relative(genome_id)


class HeaderStyle(StrEnum):
    """How a tabular file carries its column names."""

    FIRST_LINE = "first_line"  # first line is the tab-separated header
    AFTER_COMMENTS = "after_comments"  # comment lines, then a prefixed header line
    NONE = "none"  # no header; columns are positional
    ROW_LABELS = "row_labels"  # transposed; the first field of each row is the label


def _columns(obj: Any) -> tuple[str, ...]:
    return tuple(str(getattr(obj, f.name)) for f in fields(obj))


@dataclass(frozen=True)
class Table:
    """A tabular file and its columns in header order."""

    path: MgapPath
    columns: tuple[str, ...]
    header: HeaderStyle = HeaderStyle.FIRST_LINE
    header_prefix: str = ""
    comment_prefix: str = ""
    separator: str = "\t"


# Assembly ----------------------------------------------------------------------------------------


@dataclass(frozen=True)
class SpadesLayout:
    """Illumina assembly by SPAdes (mgap ILLUMINA:SPADES)."""

    tool: str = "spades"
    process: str = "GENE2DIS_MGAP:MGAP:ILLUMINA:SPADES"
    contigs: MgapPath = MgapPath("{genome_id}/assemblies/{genome_id}.contigs.fa.gz")
    scaffolds: MgapPath = MgapPath("{genome_id}/assemblies/{genome_id}.scaffolds.fa.gz")
    graph: MgapPath = MgapPath("{genome_id}/assemblies/{genome_id}.assembly.gfa.gz")
    log: MgapPath = MgapPath("{genome_id}/assemblies/{genome_id}.spades.log")
    # SPAdes sequence names; k is the rank by length, L the length, C the coverage.
    node_name: str = "NODE_{index}_length_{length}_cov_{coverage}"
    node_name_re: re.Pattern[str] = re.compile(
        r"^NODE_(?P<index>\d+)_length_(?P<length>\d+)_cov_(?P<coverage>[0-9.]+)$"
    )
    # GFA 1.2 header line; the assembler version is in the sp tag.
    gfa_header: str = "H\tVN:Z:1.2\tsp:Z:SPAdes-{version}"
    gfa_version_re: re.Pattern[str] = re.compile(r"sp:Z:SPAdes-(?P<version>\S+)")
    # Name CheckM2, QUAST and MLST give the assembly.
    assembly_name: str = "{genome_id}.scaffolds"
    # The scaffolds file stem CheckM2 and QUAST report and the file MLST names.
    assembly_file: str = "{genome_id}.scaffolds.fa.gz"


@dataclass(frozen=True)
class FlyeInfoColumns:
    seq_name: str = "#seq_name"
    length: str = "length"
    coverage: str = "cov."
    circular: str = "circ."
    repeat: str = "repeat"
    multiplicity: str = "mult."
    alt_group: str = "alt_group"
    graph_path: str = "graph_path"


@dataclass(frozen=True)
class LongReadLayout:
    """Long-read assembly for complete genomes (Flye, Autocycler) and Dnaapler.

    Provisional. data/mgap-example holds only Illumina SPAdes drafts, so these
    names follow the tools' documented outputs (Flye assembly.fasta and
    assembly_info.txt, Autocycler consensus_assembly.fasta, Dnaapler
    <prefix>_reoriented.fasta) placed where mgap publishes SPAdes output.
    """

    flye_tool: str = "flye"
    flye_process: str = "GENE2DIS_MGAP:MGAP:NANOPORE:FLYE"
    flye_fasta: MgapPath = MgapPath(
        "{genome_id}/assemblies/{genome_id}.assembly.fasta.gz", provisional=True
    )
    flye_info: MgapPath = MgapPath(
        "{genome_id}/assemblies/{genome_id}.assembly_info.txt", provisional=True
    )
    flye_info_columns: FlyeInfoColumns = FlyeInfoColumns()
    flye_circular_yes: str = "Y"
    flye_circular_no: str = "N"
    flye_contig_name: str = "contig_{index}"
    # Name CheckM2, QUAST and MLST give a reoriented complete assembly.
    assembly_name: str = "{genome_id}_reoriented"
    assembly_file: str = "{genome_id}_reoriented.fasta.gz"
    autocycler_tool: str = "autocycler"
    autocycler_process: str = "GENE2DIS_MGAP:MGAP:NANOPORE:AUTOCYCLER"
    autocycler_fasta: MgapPath = MgapPath(
        "{genome_id}/assemblies/{genome_id}.autocycler.fasta.gz", provisional=True
    )
    # Autocycler writes the circularity in the FASTA description.
    autocycler_circular_tag: str = "circular=true"
    dnaapler_tool: str = "dnaapler"
    dnaapler_process: str = "GENE2DIS_MGAP:MGAP:DNAAPLER"
    dnaapler_fasta: MgapPath = MgapPath(
        "{genome_id}/assemblies/{genome_id}_reoriented.fasta.gz", provisional=True
    )

    @property
    def flye_info_table(self) -> Table:
        return Table(self.flye_info, _columns(self.flye_info_columns))


# Quality -----------------------------------------------------------------------------------------


@dataclass(frozen=True)
class CheckM2Columns:
    name: str = "Name"
    completeness: str = "Completeness"
    contamination: str = "Contamination"
    completeness_model: str = "Completeness_Model_Used"
    translation_table: str = "Translation_Table_Used"
    coding_density: str = "Coding_Density"
    contig_n50: str = "Contig_N50"
    average_gene_length: str = "Average_Gene_Length"
    genome_size: str = "Genome_Size"
    gc_content: str = "GC_Content"
    total_coding_sequences: str = "Total_Coding_Sequences"
    total_contigs: str = "Total_Contigs"
    max_contig_length: str = "Max_Contig_Length"
    additional_notes: str = "Additional_Notes"


@dataclass(frozen=True)
class CheckM2Layout:
    tool: str = "checkm2"
    process: str = "GENE2DIS_MGAP:MGAP:CHECKM2"
    report: MgapPath = MgapPath("{genome_id}/annotation/checkm2/{genome_id}_checkm2_report.tsv")
    columns: CheckM2Columns = CheckM2Columns()
    # Name column value: the assembly name (SpadesLayout.assembly_name).
    model_specific: str = "Neural Network (Specific Model)"
    notes_none: str = "None"

    @property
    def table(self) -> Table:
        return Table(self.report, _columns(self.columns))


@dataclass(frozen=True)
class QuastRows:
    """QUAST ``report.tsv`` is transposed; these are its row labels in order."""

    assembly: str = "Assembly"
    contigs_0: str = "# contigs (>= 0 bp)"
    contigs_1000: str = "# contigs (>= 1000 bp)"
    contigs_5000: str = "# contigs (>= 5000 bp)"
    contigs_10000: str = "# contigs (>= 10000 bp)"
    contigs_25000: str = "# contigs (>= 25000 bp)"
    contigs_50000: str = "# contigs (>= 50000 bp)"
    length_0: str = "Total length (>= 0 bp)"
    length_1000: str = "Total length (>= 1000 bp)"
    length_5000: str = "Total length (>= 5000 bp)"
    length_10000: str = "Total length (>= 10000 bp)"
    length_25000: str = "Total length (>= 25000 bp)"
    length_50000: str = "Total length (>= 50000 bp)"
    contigs: str = "# contigs"
    largest_contig: str = "Largest contig"
    total_length: str = "Total length"
    gc_percent: str = "GC (%)"
    n50: str = "N50"
    n90: str = "N90"
    aun: str = "auN"
    l50: str = "L50"
    l90: str = "L90"
    ns_per_100kbp: str = "# N's per 100 kbp"


@dataclass(frozen=True)
class QuastLayout:
    """QUAST, not listed in contract §4.1 but present in mgap."""

    tool: str = "quast"
    process: str = "GENE2DIS_MGAP:MGAP:QUAST"
    report: MgapPath = MgapPath("{genome_id}/qc/quast/{genome_id}.tsv")
    rows: QuastRows = QuastRows()
    # Thresholds of the "(>= N bp)" rows. The unqualified rows count contigs of
    # at least 500 bp, QUAST's default --min-contig.
    thresholds: tuple[int, ...] = (0, 1000, 5000, 10000, 25000, 50000)
    min_contig: int = 500

    @property
    def table(self) -> Table:
        return Table(self.report, _columns(self.rows), header=HeaderStyle.ROW_LABELS)


# Read-level taxonomy -----------------------------------------------------------------------------


@dataclass(frozen=True)
class Kraken2ReportColumns:
    """Positional columns of the Kraken2 report (no header)."""

    percent: str = "percent"
    clade_reads: str = "clade_reads"
    taxon_reads: str = "taxon_reads"
    rank: str = "rank"
    taxid: str = "taxid"
    name: str = "name"


@dataclass(frozen=True)
class Kraken2Layout:
    tool: str = "kraken2"
    process: str = "GENE2DIS_MGAP:MGAP:ILLUMINA:KRAKEN2"
    report: MgapPath = MgapPath(
        "{genome_id}/read_processing/kraken2/{genome_id}.kraken2.report.txt"
    )
    columns: Kraken2ReportColumns = Kraken2ReportColumns()
    # Percent is right-aligned to width 6 with two decimals; the name is
    # indented by two spaces per level below root.
    percent_format: str = "{:6.2f}"
    indent: str = "  "
    rank_species: str = "S"
    rank_unclassified: str = "U"

    @property
    def table(self) -> Table:
        return Table(self.report, _columns(self.columns), header=HeaderStyle.NONE)


@dataclass(frozen=True)
class BrackenColumns:
    name: str = "name"
    taxonomy_id: str = "taxonomy_id"
    taxonomy_lvl: str = "taxonomy_lvl"
    kraken_assigned_reads: str = "kraken_assigned_reads"
    added_reads: str = "added_reads"
    new_est_reads: str = "new_est_reads"
    fraction_total_reads: str = "fraction_total_reads"


@dataclass(frozen=True)
class BrackenLayout:
    tool: str = "bracken"
    process: str = "GENE2DIS_MGAP:MGAP:ILLUMINA:BRACKEN"
    report: MgapPath = MgapPath("{genome_id}/read_processing/bracken/{genome_id}.tsv")
    columns: BrackenColumns = BrackenColumns()
    level_species: str = "S"

    @property
    def table(self) -> Table:
        return Table(self.report, _columns(self.columns))


# Typing ------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class MlstColumns:
    """Positional columns of the mlst output (no header); alleles follow."""

    file: str = "FILE"
    scheme: str = "SCHEME"
    st: str = "ST"


@dataclass(frozen=True)
class MlstLayout:
    tool: str = "mlst"
    process: str = "GENE2DIS_MGAP:MGAP:MLST"
    report: MgapPath = MgapPath("{genome_id}/annotation/mlst/{genome_id}.tsv")
    columns: MlstColumns = MlstColumns()
    # Allele columns follow ST, written gene(allele), for example gapA(2).
    allele: str = "{gene}({allele})"
    allele_re: re.Pattern[str] = re.compile(r"^(?P<gene>[^()]+)\((?P<allele>[^()]*)\)$")
    # Scheme and ST are "-" when no scheme matches or the ST is unknown.
    missing: str = "-"

    @property
    def table(self) -> Table:
        return Table(self.report, _columns(self.columns), header=HeaderStyle.NONE)


KLEBORATE_COLUMNS: tuple[str, ...] = (
    "strain", "species", "species_match", "contig_count", "N50", "largest_contig",
    "total_size", "ambiguous_bases", "QC_warnings", "ST", "gapA", "infB", "mdh", "pgi",
    "phoE", "rpoB", "tonB", "YbST", "Yersiniabactin", "ybtS", "ybtX", "ybtQ", "ybtP",
    "ybtA", "irp2", "irp1", "ybtU", "ybtT", "ybtE", "fyuA", "spurious_ybt_hits", "CbST",
    "Colibactin", "clbA", "clbB", "clbC", "clbD", "clbE", "clbF", "clbG", "clbH", "clbI",
    "clbL", "clbM", "clbN", "clbO", "clbP", "clbQ", "spurious_clb_hits", "AbST",
    "Aerobactin", "iucA", "iucB", "iucC", "iucD", "iutA", "spurious_abst_hits", "SmST",
    "Salmochelin", "iroB", "iroC", "iroD", "iroN", "spurious_smst_hits", "RmST", "RmpADC",
    "rmpA", "rmpD", "rmpC", "spurious_rmst_hits", "virulence_score",
    "spurious_virulence_hits", "rmpA2", "AGly_acquired", "Col_acquired", "Fcyn_acquired",
    "Flq_acquired", "Gly_acquired", "MLS_acquired", "Phe_acquired", "Rif_acquired",
    "Sul_acquired", "Tet_acquired", "Tgc_acquired", "Tmt_acquired", "Bla_acquired",
    "Bla_inhR_acquired", "Bla_ESBL_acquired", "Bla_ESBL_inhR_acquired", "Bla_Carb_acquired",
    "Bla_chr", "SHV_mutations", "Omp_mutations", "Col_mutations", "Flq_mutations",
    "truncated_resistance_hits", "spurious_resistance_hits", "resistance_score",
    "num_resistance_classes", "num_resistance_genes", "Ciprofloxacin_prediction",
    "Ciprofloxacin_profile_support", "Ciprofloxacin_profile", "Ciprofloxacin_MIC_prediction",
    "wzi", "K_locus", "K_type", "K_locus_confidence", "K_locus_problems", "K_locus_identity",
    "K_Missing_expected_genes", "O_locus", "O_type", "O_locus_confidence", "O_locus_problems",
    "O_locus_identity", "O_Missing_expected_genes",
)  # fmt: skip


@dataclass(frozen=True)
class KleborateColumns:
    """Named access to the Kleborate columns the platform uses."""

    all: tuple[str, ...] = KLEBORATE_COLUMNS
    strain: str = "strain"
    species: str = "species"
    species_match: str = "species_match"
    contig_count: str = "contig_count"
    n50: str = "N50"
    largest_contig: str = "largest_contig"
    total_size: str = "total_size"
    ambiguous_bases: str = "ambiguous_bases"
    st: str = "ST"
    mlst_alleles: tuple[str, ...] = ("gapA", "infB", "mdh", "pgi", "phoE", "rpoB", "tonB")
    ybst: str = "YbST"
    yersiniabactin: str = "Yersiniabactin"
    cbst: str = "CbST"
    colibactin: str = "Colibactin"
    abst: str = "AbST"
    aerobactin: str = "Aerobactin"
    smst: str = "SmST"
    salmochelin: str = "Salmochelin"
    rmst: str = "RmST"
    rmpadc: str = "RmpADC"
    virulence_score: str = "virulence_score"
    resistance_score: str = "resistance_score"
    num_resistance_classes: str = "num_resistance_classes"
    num_resistance_genes: str = "num_resistance_genes"
    bla_esbl_acquired: str = "Bla_ESBL_acquired"
    bla_carb_acquired: str = "Bla_Carb_acquired"
    bla_chr: str = "Bla_chr"
    flq_mutations: str = "Flq_mutations"
    wzi: str = "wzi"
    k_locus: str = "K_locus"
    k_type: str = "K_type"
    k_locus_confidence: str = "K_locus_confidence"
    o_locus: str = "O_locus"
    o_type: str = "O_type"
    o_locus_confidence: str = "O_locus_confidence"


@dataclass(frozen=True)
class KleborateLayout:
    """Kleborate 3 with trimmed headers; the file name is the preset, not the genome."""

    tool: str = "kleborate"
    process: str = "GENE2DIS_MGAP:MGAP:KLEBSIELLA:KLEBORATE"
    report: MgapPath = MgapPath(
        "{genome_id}/annotation/kleborate/klebsiella_pneumo_complex_output.txt", optional=True
    )
    columns: KleborateColumns = KleborateColumns()
    missing: str = "-"

    @property
    def table(self) -> Table:
        return Table(self.report, self.columns.all)


@dataclass(frozen=True)
class SistrColumns:
    """sistr_cmd tabular output, columns in the documented (alphabetical) order."""

    cgmlst_st: str = "cgmlst_ST"
    cgmlst_distance: str = "cgmlst_distance"
    cgmlst_found_loci: str = "cgmlst_found_loci"
    cgmlst_genome_match: str = "cgmlst_genome_match"
    cgmlst_matching_alleles: str = "cgmlst_matching_alleles"
    cgmlst_subspecies: str = "cgmlst_subspecies"
    fasta_filepath: str = "fasta_filepath"
    genome: str = "genome"
    h1: str = "h1"
    h2: str = "h2"
    o_antigen: str = "o_antigen"
    qc_messages: str = "qc_messages"
    qc_status: str = "qc_status"
    serogroup: str = "serogroup"
    serovar: str = "serovar"
    serovar_antigen: str = "serovar_antigen"
    serovar_cgmlst: str = "serovar_cgmlst"


@dataclass(frozen=True)
class SistrLayout:
    """SISTR for Salmonella. Provisional: absent from data/mgap-example."""

    tool: str = "sistr"
    process: str = "GENE2DIS_MGAP:MGAP:SALMONELLA:SISTR"
    report: MgapPath = MgapPath(
        "{genome_id}/annotation/sistr/{genome_id}.tab", provisional=True, optional=True
    )
    columns: SistrColumns = SistrColumns()

    @property
    def table(self) -> Table:
        return Table(self.report, _columns(self.columns))


@dataclass(frozen=True)
class SccmecColumns:
    """sccmec (rpetit3/sccmec, camlhmp schema) output columns."""

    sample: str = "sample"
    type: str = "type"
    subtype: str = "subtype"
    mecA: str = "mecA"
    targets: str = "targets"
    regions: str = "regions"
    target_schema: str = "target_schema"
    target_schema_version: str = "target_schema_version"
    region_schema: str = "region_schema"
    region_schema_version: str = "region_schema_version"
    camlhmp_version: str = "camlhmp_version"
    params: str = "params"
    target_comment: str = "target_comment"
    region_comment: str = "region_comment"


@dataclass(frozen=True)
class SccmecLayout:
    """sccmec for Staphylococcus aureus. Provisional: absent from data/mgap-example."""

    tool: str = "sccmec"
    process: str = "GENE2DIS_MGAP:MGAP:STAPHYLOCOCCUS:SCCMEC"
    report: MgapPath = MgapPath(
        "{genome_id}/annotation/sccmec/{genome_id}.tsv", provisional=True, optional=True
    )
    columns: SccmecColumns = SccmecColumns()

    @property
    def table(self) -> Table:
        return Table(self.report, _columns(self.columns))


@dataclass(frozen=True)
class GtdbTkColumns:
    """GTDB-Tk 2.x summary columns."""

    user_genome: str = "user_genome"
    classification: str = "classification"
    closest_genome_reference: str = "closest_genome_reference"
    closest_genome_reference_radius: str = "closest_genome_reference_radius"
    closest_genome_taxonomy: str = "closest_genome_taxonomy"
    closest_genome_ani: str = "closest_genome_ani"
    closest_genome_af: str = "closest_genome_af"
    closest_placement_reference: str = "closest_placement_reference"
    closest_placement_radius: str = "closest_placement_radius"
    closest_placement_taxonomy: str = "closest_placement_taxonomy"
    closest_placement_ani: str = "closest_placement_ani"
    closest_placement_af: str = "closest_placement_af"
    pplacer_taxonomy: str = "pplacer_taxonomy"
    classification_method: str = "classification_method"
    note: str = "note"
    other_related_references: str = "other_related_references(genome_id,species_name,radius,ANI,AF)"
    msa_percent: str = "msa_percent"
    translation_table: str = "translation_table"
    red_value: str = "red_value"
    warnings: str = "warnings"


@dataclass(frozen=True)
class GtdbTkLayout:
    """GTDB-Tk classify_wf, run-level. Provisional: absent from data/mgap-example.

    GTDB-Tk classifies every genome of a run in one call, so its summary is a
    run-level table with one row per genome (user_genome). Genomes absent from
    the table were not classified.
    """

    tool: str = "gtdbtk"
    process: str = "GENE2DIS_MGAP:MGAP:GTDBTK_CLASSIFYWF"
    summary: MgapPath = MgapPath(
        "gtdbtk/gtdbtk.bac120.summary.tsv", provisional=True, optional=True
    )
    columns: GtdbTkColumns = GtdbTkColumns()
    # Classification is a GTDB lineage, d__Bacteria;p__...;s__Genus species.
    species_prefix: str = "s__"
    rank_separator: str = ";"
    missing: str = "N/A"

    @property
    def table(self) -> Table:
        return Table(self.summary, _columns(self.columns))


# Annotation --------------------------------------------------------------------------------------


@dataclass(frozen=True)
class BaktaTsvColumns:
    sequence_id: str = "Sequence Id"
    type: str = "Type"
    start: str = "Start"
    stop: str = "Stop"
    strand: str = "Strand"
    locus_tag: str = "Locus Tag"
    gene: str = "Gene"
    product: str = "Product"
    dbxrefs: str = "DbXrefs"


@dataclass(frozen=True)
class BaktaFeatureTypes:
    """Feature types as the Bakta ``.tsv`` writes them (contract §5.4 ``type``)."""

    cds: str = "cds"
    sorf: str = "sorf"
    trna: str = "tRNA"
    tmrna: str = "tmRNA"
    rrna: str = "rRNA"
    ncrna: str = "ncRNA"
    ncrna_region: str = "ncRNA-region"
    crispr: str = "crispr"
    gap: str = "assembly_gap"
    oric: str = "oriC"
    oriv: str = "oriV"
    orit: str = "oriT"


@dataclass(frozen=True)
class BaktaSummaryKeys:
    """Keys of the Bakta ``.txt`` summary, in file order within their sections."""

    section_sequences: str = "Sequence(s):"
    length: str = "Length"
    count: str = "Count"
    gc: str = "GC"
    n50: str = "N50"
    n90: str = "N90"
    n_ratio: str = "N ratio"
    coding_density: str = "coding density"
    section_annotation: str = "Annotation:"
    trnas: str = "tRNAs"
    tmrnas: str = "tmRNAs"
    rrnas: str = "rRNAs"
    ncrnas: str = "ncRNAs"
    ncrna_regions: str = "ncRNA regions"
    crispr_arrays: str = "CRISPR arrays"
    cdss: str = "CDSs"
    pseudogenes: str = "pseudogenes"
    hypotheticals: str = "hypotheticals"
    sorfs: str = "sORFs"
    gaps: str = "gaps"
    orics: str = "oriCs"
    orivs: str = "oriVs"
    orits: str = "oriTs"
    section_bakta: str = "Bakta:"
    software: str = "Software"
    database: str = "Database"
    doi: str = "DOI"
    url: str = "URL"


@dataclass(frozen=True)
class BaktaLayout:
    """Bakta annotation. The database version is recorded per genome in ``.txt``,
    ``.tsv``, ``.gff3`` and ``.gbff`` as ``Database: v6.0, full``."""

    tool: str = "bakta"
    process: str = "GENE2DIS_MGAP:MGAP:BAKTA"
    tsv: MgapPath = MgapPath("{genome_id}/annotation/bakta/{genome_id}.tsv")
    gff3: MgapPath = MgapPath("{genome_id}/annotation/bakta/{genome_id}.gff3")
    gbff: MgapPath = MgapPath("{genome_id}/annotation/bakta/{genome_id}.gbff")
    faa: MgapPath = MgapPath("{genome_id}/annotation/bakta/{genome_id}.faa")
    ffn: MgapPath = MgapPath("{genome_id}/annotation/bakta/{genome_id}.ffn")
    fna: MgapPath = MgapPath("{genome_id}/annotation/bakta/{genome_id}.fna")
    summary: MgapPath = MgapPath("{genome_id}/annotation/bakta/{genome_id}.txt")
    versions: MgapPath = MgapPath("{genome_id}/annotation/bakta/versions.yml")
    tsv_columns: BaktaTsvColumns = BaktaTsvColumns()
    feature_types: BaktaFeatureTypes = BaktaFeatureTypes()
    summary_keys: BaktaSummaryKeys = BaktaSummaryKeys()
    # The .tsv starts with these comment lines, then the "#"-prefixed header.
    tsv_comment_lines: tuple[str, ...] = (
        "# Annotated with Bakta",
        "# Software: v{software}",
        "# Database: v{database}, {database_type}",
        "# DOI: {doi}",
        "# URL: {url}",
    )
    doi: str = "10.1099/mgen.0.000685"
    url: str = "github.com/oschwengers/bakta"
    tsv_header_prefix: str = "#"
    database_type: str = "full"
    database_re: re.Pattern[str] = re.compile(r"v(?P<version>[0-9.]+), (?P<type>\w+)")
    software_re: re.Pattern[str] = re.compile(r"v(?P<version>[0-9.]+)")
    # Contig names Bakta assigns, and the description of each .fna record.
    contig_name: str = "contig_{index}"
    fna_description: str = "[gcode={gcode}] [topology={topology}]"
    fna_description_re: re.Pattern[str] = re.compile(
        r"\[gcode=(?P<gcode>\d+)\] \[topology=(?P<topology>\w+)\]"
    )
    topology_linear: str = "linear"
    topology_circular: str = "circular"
    gcode: int = 11
    # Strands in the .tsv: "+", "-", "?" (oriC, oriT) and "." (assembly gaps).
    strands: tuple[str, ...] = ("+", "-", "?", ".")
    # .faa and .ffn record descriptions are "<locus_tag> <product>".
    # The .gff3 ends with a FASTA section after this line.
    gff3_fasta_marker: str = "##FASTA"
    gff3_header_lines: tuple[str, ...] = (
        "##gff-version 3",
        "##feature-ontology https://github.com/The-Sequence-Ontology/SO-Ontologies/blob/v3.1/so.obo",
    )
    gff3_sequence_region: str = "##sequence-region {contig} 1 {length}"
    # .tsv type -> (.gff3 type, .gff3 source). crispr is not confirmed by the
    # example (it has no CRISPR arrays).
    gff3_types: tuple[tuple[str, str, str], ...] = (
        ("cds", "CDS", "Pyrodigal"),
        ("sorf", "CDS", "Bakta"),
        ("tRNA", "tRNA", "tRNAscan-SE"),
        ("tmRNA", "tmRNA", "Aragorn"),
        ("rRNA", "rRNA", "Infernal"),
        ("ncRNA", "ncRNA", "Infernal"),
        ("ncRNA-region", "regulatory_region", "Infernal"),
        ("crispr", "CRISPR", "PILER-CR"),
        ("assembly_gap", "gap", "Bakta"),
        ("oriC", "oriC", "BLAST+"),
        ("oriV", "oriV", "BLAST+"),
        ("oriT", "oriT", "BLAST+"),
    )
    # .tsv type -> .gbff feature key. crispr is not confirmed by the example.
    gbff_types: tuple[tuple[str, str], ...] = (
        ("cds", "CDS"),
        ("sorf", "CDS"),
        ("tRNA", "tRNA"),
        ("tmRNA", "tmRNA"),
        ("rRNA", "rRNA"),
        ("ncRNA", "ncRNA"),
        ("ncRNA-region", "regulatory"),
        ("crispr", "repeat_region"),
        ("assembly_gap", "gap"),
        ("oriC", "rep_origin"),
        ("oriV", "rep_origin"),
        ("oriT", "oriT"),
    )
    gff3_region_type: str = "region"
    gff3_region_source: str = "Bakta"
    # Protein identifiers in the .gbff.
    gbff_protein_id: str = "gnl|Bakta|{locus_tag}"

    @property
    def tsv_table(self) -> Table:
        return Table(
            self.tsv,
            _columns(self.tsv_columns),
            header=HeaderStyle.AFTER_COMMENTS,
            header_prefix=self.tsv_header_prefix,
            comment_prefix="# ",
        )


@dataclass(frozen=True)
class AmrFinderColumns:
    protein_id: str = "Protein id"
    contig_id: str = "Contig id"
    start: str = "Start"
    stop: str = "Stop"
    strand: str = "Strand"
    element_symbol: str = "Element symbol"
    element_name: str = "Element name"
    scope: str = "Scope"
    type: str = "Type"
    subtype: str = "Subtype"
    element_class: str = "Class"
    subclass: str = "Subclass"
    method: str = "Method"
    target_length: str = "Target length"
    reference_length: str = "Reference sequence length"
    coverage: str = "% Coverage of reference"
    identity: str = "% Identity to reference"
    alignment_length: str = "Alignment length"
    closest_accession: str = "Closest reference accession"
    closest_name: str = "Closest reference name"
    hmm_accession: str = "HMM accession"
    hmm_description: str = "HMM description"


@dataclass(frozen=True)
class AmrFinderLayout:
    """AMRFinderPlus with protein, nucleotide and GFF input.

    ``<genome_id>.tsv`` is the main report; point mutations appear in it with
    Subtype POINT and an element symbol ``<gene>_<variant>``.
    ``<genome_id>-mutations.tsv`` (``--mutation_all``) has the same columns and
    lists every screened position, including wild type ones whose element name
    ends in `` [WILDTYPE]`` and unclassified ones ending in `` [UNKNOWN]``.
    Protein id is the Bakta locus tag, or NA for nucleotide hits.
    """

    tool: str = "amrfinderplus"
    process: str = "GENE2DIS_MGAP:MGAP:AMRFINDERPLUS_RUN"
    database_key: str = "amrfinderplus-database"
    report: MgapPath = MgapPath("{genome_id}/annotation/amrfinder/{genome_id}.tsv")
    mutations: MgapPath = MgapPath("{genome_id}/annotation/amrfinder/{genome_id}-mutations.tsv")
    # Provisional. mgap records the AMRFinderPlus database version only in the
    # run-level software_versions.yml; this per-genome file (nf-core
    # versions.yml format, like the Bakta one) is how the synthetic generator
    # represents genomes annotated with different database versions. See
    # README "Annotation versions" and the milestone 0 report.
    versions: MgapPath = MgapPath(
        "{genome_id}/annotation/amrfinder/versions.yml", provisional=True, optional=True
    )
    columns: AmrFinderColumns = AmrFinderColumns()
    missing: str = "NA"
    type_amr: str = "AMR"
    type_stress: str = "STRESS"
    type_virulence: str = "VIRULENCE"
    subtype_amr: str = "AMR"
    subtype_point: str = "POINT"
    subtype_metal: str = "METAL"
    subtype_biocide: str = "BIOCIDE"
    subtype_virulence: str = "VIRULENCE"
    scope_core: str = "core"
    scope_plus: str = "plus"
    point_methods: tuple[str, ...] = ("POINTP", "POINTN", "POINTX")
    gene_methods: tuple[str, ...] = (
        "EXACTP", "EXACTX", "ALLELEP", "ALLELEX", "BLASTP", "BLASTX",
        "PARTIALP", "PARTIALX", "PARTIAL_CONTIG_ENDP", "PARTIAL_CONTIG_ENDX", "HMM",
    )  # fmt: skip
    # A point mutation's element symbol is <gene>_<variant>; promoter
    # variants use a negative position (blaSHV_C-112T).
    point_symbol: str = "{gene}_{variant}"
    point_symbol_re: re.Pattern[str] = re.compile(r"^(?P<gene>.+)_(?P<variant>[^_]+)$")
    wildtype_suffix: str = " [WILDTYPE]"
    unknown_suffix: str = " [UNKNOWN]"

    @property
    def report_table(self) -> Table:
        return Table(self.report, _columns(self.columns))

    @property
    def mutations_table(self) -> Table:
        return Table(self.mutations, _columns(self.columns))


@dataclass(frozen=True)
class RgiColumns:
    orf_id: str = "ORF_ID"
    contig: str = "Contig"
    start: str = "Start"
    stop: str = "Stop"
    orientation: str = "Orientation"
    cut_off: str = "Cut_Off"
    pass_bitscore: str = "Pass_Bitscore"
    best_hit_bitscore: str = "Best_Hit_Bitscore"
    best_hit_aro: str = "Best_Hit_ARO"
    best_identities: str = "Best_Identities"
    aro: str = "ARO"
    model_type: str = "Model_type"
    snps_in_best_hit_aro: str = "SNPs_in_Best_Hit_ARO"
    other_snps: str = "Other_SNPs"
    drug_class: str = "Drug Class"
    resistance_mechanism: str = "Resistance Mechanism"
    amr_gene_family: str = "AMR Gene Family"
    predicted_dna: str = "Predicted_DNA"
    predicted_protein: str = "Predicted_Protein"
    card_protein_sequence: str = "CARD_Protein_Sequence"
    percentage_length: str = "Percentage Length of Reference Sequence"
    id: str = "ID"
    model_id: str = "Model_ID"
    nudged: str = "Nudged"
    note: str = "Note"
    hit_start: str = "Hit_Start"
    hit_end: str = "Hit_End"
    antibiotic: str = "Antibiotic"


@dataclass(frozen=True)
class RgiLayout:
    """RGI main on the SPAdes scaffolds with its own Prodigal ORFs.

    Contig names are SPAdes names, not Bakta ``contig_<k>`` names; the parser
    maps them through the scaffold order or sequence identity. The Contig
    column holds the ORF name ``<spades contig>_<orf number>``.
    """

    tool: str = "rgi"
    process: str = "GENE2DIS_MGAP:MGAP:RGI_MAIN"
    report: MgapPath = MgapPath("{genome_id}/annotation/rgi/{genome_id}.txt")
    json: MgapPath = MgapPath("{genome_id}/annotation/rgi/{genome_id}.json")
    columns: RgiColumns = RgiColumns()
    orf_name: str = "{contig}_{orf}"
    orf_id: str = (
        "{contig}_{orf} # {start} # {stop} # {strand} # ID={contig_index}_{orf};partial=00;"
        "start_type=ATG;rbs_motif=GGAG/GAGG;rbs_spacer=5-10bp;gc_cont={gc:.3f}"
    )
    orf_id_re: re.Pattern[str] = re.compile(
        r"^(?P<orf>\S+) # (?P<start>\d+) # (?P<stop>\d+) # (?P<strand>-?1) # "
    )
    cut_off_strict: str = "Strict"
    cut_off_perfect: str = "Perfect"
    model_protein_homolog: str = "protein homolog model"
    model_protein_variant: str = "protein variant model"
    list_separator: str = "; "
    missing: str = "n/a"

    @property
    def table(self) -> Table:
        return Table(self.report, _columns(self.columns))


# Mobile elements ---------------------------------------------------------------------------------


@dataclass(frozen=True)
class GenomadVirusColumns:
    seq_name: str = "seq_name"
    length: str = "length"
    topology: str = "topology"
    coordinates: str = "coordinates"
    n_genes: str = "n_genes"
    genetic_code: str = "genetic_code"
    virus_score: str = "virus_score"
    fdr: str = "fdr"
    n_hallmarks: str = "n_hallmarks"
    marker_enrichment: str = "marker_enrichment"
    taxonomy: str = "taxonomy"


@dataclass(frozen=True)
class GenomadPlasmidColumns:
    seq_name: str = "seq_name"
    length: str = "length"
    topology: str = "topology"
    n_genes: str = "n_genes"
    genetic_code: str = "genetic_code"
    plasmid_score: str = "plasmid_score"
    fdr: str = "fdr"
    n_hallmarks: str = "n_hallmarks"
    marker_enrichment: str = "marker_enrichment"
    conjugation_genes: str = "conjugation_genes"
    amr_genes: str = "amr_genes"


@dataclass(frozen=True)
class GenomadLayout:
    """geNomad end-to-end on the Bakta contigs; names are ``contig_<k>``."""

    tool: str = "genomad"
    process: str = "GENE2DIS_MGAP:MGAP:GENOMAD"
    virus_summary: MgapPath = MgapPath(
        "{genome_id}/annotation/genomad/{genome_id}_summary/{genome_id}_virus_summary.tsv"
    )
    plasmid_summary: MgapPath = MgapPath(
        "{genome_id}/annotation/genomad/{genome_id}_summary/{genome_id}_plasmid_summary.tsv"
    )
    virus_columns: GenomadVirusColumns = GenomadVirusColumns()
    plasmid_columns: GenomadPlasmidColumns = GenomadPlasmidColumns()
    # A provirus is named <contig>|provirus_<start>_<end> with coordinates
    # "<start>-<end>" (1-based, inclusive); a whole-contig virus is named by
    # its contig with coordinates NA.
    provirus_name: str = "{contig}|provirus_{start}_{end}"
    provirus_name_re: re.Pattern[str] = re.compile(
        r"^(?P<contig>.+)\|provirus_(?P<start>\d+)_(?P<end>\d+)$"
    )
    coordinates: str = "{start}-{end}"
    topology_provirus: str = "Provirus"
    topology_no_repeats: str = "No terminal repeats"
    topology_dtr: str = "DTR"
    topology_itr: str = "ITR"
    list_separator: str = ";"
    missing: str = "NA"

    @property
    def virus_table(self) -> Table:
        return Table(self.virus_summary, _columns(self.virus_columns))

    @property
    def plasmid_table(self) -> Table:
        return Table(self.plasmid_summary, _columns(self.plasmid_columns))


@dataclass(frozen=True)
class MobContigReportColumns:
    sample_id: str = "sample_id"
    molecule_type: str = "molecule_type"
    primary_cluster_id: str = "primary_cluster_id"
    secondary_cluster_id: str = "secondary_cluster_id"
    contig_id: str = "contig_id"
    size: str = "size"
    gc: str = "gc"
    md5: str = "md5"
    circularity_status: str = "circularity_status"
    rep_types: str = "rep_type(s)"
    rep_type_accessions: str = "rep_type_accession(s)"
    relaxase_types: str = "relaxase_type(s)"
    relaxase_type_accessions: str = "relaxase_type_accession(s)"
    mpf_type: str = "mpf_type"
    mpf_type_accessions: str = "mpf_type_accession(s)"
    orit_types: str = "orit_type(s)"
    orit_accessions: str = "orit_accession(s)"
    predicted_mobility: str = "predicted_mobility"
    mash_nearest_neighbor: str = "mash_nearest_neighbor"
    mash_neighbor_distance: str = "mash_neighbor_distance"
    mash_neighbor_identification: str = "mash_neighbor_identification"
    repetitive_dna_id: str = "repetitive_dna_id"
    repetitive_dna_type: str = "repetitive_dna_type"
    filtering_reason: str = "filtering_reason"


@dataclass(frozen=True)
class MobTyperColumns:
    sample_id: str = "sample_id"
    num_contigs: str = "num_contigs"
    size: str = "size"
    gc: str = "gc"
    md5: str = "md5"
    rep_types: str = "rep_type(s)"
    rep_type_accessions: str = "rep_type_accession(s)"
    relaxase_types: str = "relaxase_type(s)"
    relaxase_type_accessions: str = "relaxase_type_accession(s)"
    mpf_type: str = "mpf_type"
    mpf_type_accessions: str = "mpf_type_accession(s)"
    orit_types: str = "orit_type(s)"
    orit_accessions: str = "orit_accession(s)"
    predicted_mobility: str = "predicted_mobility"
    mash_nearest_neighbor: str = "mash_nearest_neighbor"
    mash_neighbor_distance: str = "mash_neighbor_distance"
    mash_neighbor_identification: str = "mash_neighbor_identification"
    primary_cluster_id: str = "primary_cluster_id"
    secondary_cluster_id: str = "secondary_cluster_id"
    predicted_host_range_overall_rank: str = "predicted_host_range_overall_rank"
    predicted_host_range_overall_name: str = "predicted_host_range_overall_name"
    observed_host_range_ncbi_rank: str = "observed_host_range_ncbi_rank"
    observed_host_range_ncbi_name: str = "observed_host_range_ncbi_name"
    reported_host_range_lit_rank: str = "reported_host_range_lit_rank"
    reported_host_range_lit_name: str = "reported_host_range_lit_name"
    associated_pmids: str = "associated_pmid(s)"


@dataclass(frozen=True)
class MobSuiteLayout:
    """MOB-suite recon on the Bakta contigs. Optional in mgap (contract §10).

    ``contig_report.txt`` has one row per contig; ``contig_id`` carries the
    Bakta description suffix. ``mobtyper_results.txt`` has one row per
    reconstructed plasmid, named ``<genome_id>:<primary_cluster_id>``, and
    exists only when a plasmid was reconstructed.
    """

    tool: str = "mobsuite"
    process: str = "GENE2DIS_MGAP:MGAP:MOBSUITE_RECON"
    directory: MgapPath = MgapPath("{genome_id}/annotation/mobsuite", optional=True)
    contig_report: MgapPath = MgapPath(
        "{genome_id}/annotation/mobsuite/contig_report.txt", optional=True
    )
    mobtyper_results: MgapPath = MgapPath(
        "{genome_id}/annotation/mobsuite/mobtyper_results.txt", optional=True
    )
    contig_report_columns: MobContigReportColumns = MobContigReportColumns()
    mobtyper_columns: MobTyperColumns = MobTyperColumns()
    molecule_chromosome: str = "chromosome"
    molecule_plasmid: str = "plasmid"
    circularity_not_tested: str = "not tested"
    mobility_values: tuple[str, ...] = ("conjugative", "mobilizable", "non-mobilizable")
    mobtyper_sample_id: str = "{genome_id}:{cluster}"
    list_separator: str = ","
    missing: str = "-"

    @property
    def contig_report_table(self) -> Table:
        return Table(self.contig_report, _columns(self.contig_report_columns))

    @property
    def mobtyper_table(self) -> Table:
        return Table(self.mobtyper_results, _columns(self.mobtyper_columns))


# Pipeline information ----------------------------------------------------------------------------


@dataclass(frozen=True)
class PipelineInfoLayout:
    """Run-level tool versions in the nf-core ``software_versions.yml`` format.

    Top-level keys are Nextflow process names (quoted), each mapping tool
    names to versions. The key ``Workflow`` holds the pipeline and Nextflow
    versions. The file is written once per run, so a results directory
    assembled from several runs keeps the last run's file.
    """

    software_versions: MgapPath = MgapPath("pipeline_info/software_versions.yml")
    workflow_key: str = "Workflow"
    pipeline_key: str = "gene2dis/mgap"
    nextflow_key: str = "Nextflow"
    # Tools whose version the example leaves empty ("rgi: ").
    empty_version_seen: tuple[str, ...] = ("rgi",)


# Module instances --------------------------------------------------------------------------------

SPADES = SpadesLayout()
LONG_READ = LongReadLayout()
CHECKM2 = CheckM2Layout()
QUAST = QuastLayout()
KRAKEN2 = Kraken2Layout()
BRACKEN = BrackenLayout()
MLST = MlstLayout()
KLEBORATE = KleborateLayout()
SISTR = SistrLayout()
SCCMEC = SccmecLayout()
GTDBTK = GtdbTkLayout()
BAKTA = BaktaLayout()
AMRFINDERPLUS = AmrFinderLayout()
RGI = RgiLayout()
GENOMAD = GenomadLayout()
MOBSUITE = MobSuiteLayout()
PIPELINE_INFO = PipelineInfoLayout()

MODULES: tuple[object, ...] = (
    SPADES, LONG_READ, CHECKM2, QUAST, KRAKEN2, BRACKEN, MLST, KLEBORATE, SISTR, SCCMEC,
    GTDBTK, BAKTA, AMRFINDERPLUS, RGI, GENOMAD, MOBSUITE, PIPELINE_INFO,
)  # fmt: skip


def all_paths() -> dict[str, MgapPath]:
    """Every declared path, keyed ``<ModuleClass>.<field>``."""
    out: dict[str, MgapPath] = {}
    for module in MODULES:
        for name, value in vars(module).items():
            if isinstance(value, MgapPath):
                out[f"{module.__class__.__name__}.{name}"] = value
    return out


def all_tables() -> dict[str, Table]:
    """Every declared table, keyed ``<ModuleClass>.<property>``."""
    out: dict[str, Table] = {}
    for module in MODULES:
        cls = module.__class__
        for name in dir(cls):
            if isinstance(getattr(cls, name, None), property):
                value = getattr(module, name)
                if isinstance(value, Table):
                    out[f"{cls.__name__}.{name}"] = value
    return out


def software_version_keys() -> dict[str, str]:
    """Process name to tool key for every module that records a version."""
    out: dict[str, str] = {}
    for module in MODULES:
        process = getattr(module, "process", None)
        tool = getattr(module, "tool", None)
        if isinstance(process, str) and isinstance(tool, str):
            out[process] = tool
    return out


# Differences from contract §4.1 ------------------------------------------------------------------


@dataclass(frozen=True)
class ContractDifference:
    module: str
    contract: str
    example: str


CONTRACT_DIFFERENCES: tuple[ContractDifference, ...] = (
    ContractDifference(
        "All modules",
        "paths relative to the results directory, module files named by tool",
        "per-genome files under <genome_id>/annotation/<tool>/, <genome_id>/assemblies/, "
        "<genome_id>/read_processing/<tool>/ and <genome_id>/qc/quast/",
    ),
    ContractDifference(
        "Assembly",
        "assembly FASTA; assembler info or GFA for circularity; contig_id as in the assembly "
        "FASTA and in Bakta (§3.2)",
        "SPAdes <id>.contigs.fa.gz, <id>.scaffolds.fa.gz, <id>.assembly.gfa.gz (no "
        "circularity in the GFA); FASTA names are NODE_k_length_L_cov_C while Bakta renames "
        "contigs to contig_k and drops those under 200 bp, so the two names differ; Bakta "
        ".fna headers carry [topology=linear|circular]",
    ),
    ContractDifference(
        "CheckM2",
        "quality_report.tsv",
        "<id>/annotation/checkm2/<id>_checkm2_report.tsv; Name is <id>.scaffolds",
    ),
    ContractDifference(
        "Kraken2 / Bracken",
        "report files",
        "<id>/read_processing/kraken2/<id>.kraken2.report.txt (no header) and "
        "<id>/read_processing/bracken/<id>.tsv (species-level estimates)",
    ),
    ContractDifference(
        "MLST",
        "mlst.tsv",
        "<id>/annotation/mlst/<id>.tsv, one line, no header; FILE is <id>.scaffolds.fa.gz",
    ),
    ContractDifference(
        "GTDB-Tk",
        "gtdbtk.bac120.summary.tsv",
        "absent from the example (layout provisional, run-level gtdbtk/)",
    ),
    ContractDifference(
        "Bakta",
        "<id>.tsv, .gff3, .gbff, .faa, .ffn, .txt",
        "as stated, under <id>/annotation/bakta/, plus .fna, .embl, .hypotheticals.* and a "
        "per-genome versions.yml (software version only); the database version is in the "
        ".txt and .tsv headers; .tsv types include assembly_gap (not gap) and sorf; strands "
        "include ? (oriC, oriT) and . (gaps)",
    ),
    ContractDifference(
        "AMRFinderPlus",
        "<id>.amrfinder.tsv, rows of type gene and point mutation",
        "<id>/annotation/amrfinder/<id>.tsv (Subtype POINT rows, element symbol "
        "<gene>_<variant>) and <id>-mutations.tsv (--mutation_all, same columns, including "
        "[WILDTYPE] and [UNKNOWN] rows); Protein id is the Bakta locus tag or NA",
    ),
    ContractDifference(
        "RGI",
        "<id>.rgi.txt",
        "<id>/annotation/rgi/<id>.txt and <id>.json, run on the SPAdes scaffolds with SPAdes "
        "contig names and RGI's own ORFs, not on Bakta contigs",
    ),
    ContractDifference(
        "geNomad",
        "<id>_summary/*_virus_summary.tsv, *_plasmid_summary.tsv",
        "as stated, under <id>/annotation/genomad/",
    ),
    ContractDifference(
        "MOB-suite",
        "contig_report.txt, mobtyper_results.txt",
        "under <id>/annotation/mobsuite/; contig_id carries ' [gcode=11] [topology=linear]'; "
        "mobtyper_results.txt only when a plasmid is reconstructed; molecule_type is "
        "chromosome or plasmid only (no unclassified)",
    ),
    ContractDifference(
        "Kleborate, sccmec, SISTR",
        "tool-specific TSV",
        "Kleborate 3 at <id>/annotation/kleborate/klebsiella_pneumo_complex_output.txt "
        "(117 trimmed columns); sccmec and SISTR absent from the example",
    ),
    ContractDifference(
        "QUAST",
        "not listed",
        "<id>/qc/quast/<id>.tsv (transposed report)",
    ),
    ContractDifference(
        "Pipeline info",
        "pipeline_info/software_versions.yml, versions attached to each genome",
        "run-level only; AMRFinderPlus database version present, Bakta database version "
        "absent (per genome in Bakta .txt), no database versions for CheckM2, geNomad, "
        "Kraken2, MOB-suite or RGI; rgi version empty",
    ),
)


# Contract §4.1 row names the layout covers, for the test that every row is modeled.
CONTRACT_MODULE_ROWS: tuple[str, ...] = tuple(
    d.module for d in CONTRACT_DIFFERENCES if d.module not in {"All modules", "QUAST"}
)
