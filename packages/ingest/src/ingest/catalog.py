"""``catalejo ingest``: mgap results and metadata into the master catalog (contract §5, §8.2).

The catalog is ``<dir>/<release_id>.duckdb`` (§5); ``release_id`` is the file
stem and must read ``YYYY-MM`` with an optional letter, or ``synth`` for the
synthetic catalog (milestone 1a plan, decision 1).

Steps, each refusing to write on any failure:

1. The metadata table is validated with the mgap results (§4.2, §9 input
   rules; decision 3).
2. Every genome of the metadata table is parsed and assembled
   (``ingest.assemble``) from its mgap sample, and its species assigned
   (``ingest.species``, §3.3). A genome whose species is not in the registry
   fails here, since no release can place it.
3. ``genome`` rows merge the tool facts with the metadata; a metadata
   ``platform`` overrides the detected one (§4.2). Unrecognized metadata
   columns become ``metadata_extra`` rows. ``added_release`` is kept from the
   existing catalog for genomes it already holds, else it is this release.
4. All tables are written in one transaction into a new file beside the
   catalog, which then replaces it, so a failed run leaves the old catalog.
   The side tables of an existing catalog (access groups, tombstones, curated
   sets) are carried over and tombstoned genomes removed again, so a re-run
   with the same inputs yields the same catalog.
5. Counters and summary sentences are computed (``ingest.summary``).

Per-genome files. The release carries each genome's Bakta GenBank, GFF3,
nucleotide FASTA and proteins (§6.3), and its map needs the sequence for GC
plots (§7.1); none of these is a catalog table. ``ingest`` therefore copies
them, gzip-compressed, into ``<dir>/<release_id>.files/<genome_id>/`` beside
the catalog, which ``release build`` reads (open point, milestone 1a).
"""

from __future__ import annotations

import os
import re
import shutil
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import duckdb

from ingest import mgap_layout as L
from ingest import schema
from ingest.assemble import AssembledGenome, assemble_genome, parse_sample
from ingest.config import (
    load_palette,
    load_species_registry,
    load_summary_templates,
    load_typing_display,
    platform,
)
from ingest.issues import FAILURE, WARNING, Issue, failures
from ingest.metadata import (
    COLUMNS,
    MetadataFile,
    effective_sample,
    list_samples,
    parse_isolation_date,
    read_metadata,
    validate_metadata,
)
from ingest.parsers.gtdbtk import parse_gtdbtk_summary
from ingest.parsers.pipeline_info import parse_pipeline_info
from ingest.rows import GenomeRow, MetadataExtraRow
from ingest.species import SpeciesEvidence, assign_species, registry_rows
from ingest.store import insert, open_db, table_exists, write_gzip
from ingest.summary import refresh_summaries

RELEASE_ID_RE = re.compile(r"^\d{4}-\d{2}[a-z]?$")
SYNTH_RELEASE_ID = "synth"
ASSEMBLY_VERSION = 1
FILES_SUFFIX = ".files"
TMP_SUFFIX = ".tmp"

# Names of the per-genome files (contract §6.3), as release build publishes them.
GBFF = "genome.gbff.gz"
GFF3 = "genome.gff3.gz"
FNA = "genome.fna.gz"
FAA = "proteins.faa.gz"

RULE_SPECIES = "genome.species_unregistered"
RULE_RELEASE_ID = "catalog.release_id"
RULE_SAMPLE_NOT_IN_METADATA = "results.sample_without_metadata"

# Tables carried over from an existing catalog (§4.6 to §4.8).
SIDE_TABLES = ("access_group", "genome_group", "tombstone", "genome_set", "genome_set_member")


class IngestError(Exception):
    """Ingestion refused; ``issues`` holds the failures."""

    def __init__(self, message: str, issues: Sequence[Issue] = ()) -> None:
        super().__init__(message)
        self.issues = list(issues)


@dataclass
class IngestResult:
    catalog: Path
    release_id: str
    genomes: int
    species: list[str]
    rows: dict[str, int]
    unmapped_hits: int
    issues: list[Issue] = field(default_factory=list[Issue])

    def lines(self) -> list[str]:
        r = self.rows
        return [
            f"catalejo ingest: wrote {self.genomes} genomes of {len(self.species)} species "
            f"({', '.join(self.species)}) to {self.catalog} (release {self.release_id})",
            f"  contigs {r.get('contig', 0)}, features {r.get('feature', 0)}, annotation hits "
            f"{r.get('annotation_hit', 0)} ({self.unmapped_hits} without a feature), mutations "
            f"{r.get('mutation', 0)}, regions {r.get('region', 0)}, typing {r.get('typing', 0)}",
            f"  {len(self.issues)} warnings",
        ]


def release_id_from_catalog(catalog: Path) -> str:
    """The release_id of ``catalog/<release_id>.duckdb`` (§5; decision 1)."""
    stem = catalog.name.removesuffix(".duckdb")
    if stem == catalog.name:
        raise IngestError(f"the catalog must be a .duckdb file: {catalog}")
    if not (RELEASE_ID_RE.match(stem) or stem == SYNTH_RELEASE_ID):
        raise IngestError(
            f"catalog file {catalog.name}: its stem must be a release_id (YYYY-MM with an "
            f"optional letter, or {SYNTH_RELEASE_ID})",
            [Issue(RULE_RELEASE_ID, FAILURE, f"invalid release_id {stem!r}")],
        )
    return stem


def files_dir(catalog: Path) -> Path:
    """The per-genome file directory beside the catalog."""
    return catalog.with_name(catalog.name.removesuffix(".duckdb") + FILES_SUFFIX)


def connect(catalog: Path, read_only: bool = False) -> duckdb.DuckDBPyConnection:
    if not catalog.is_file():
        raise IngestError(f"no catalog at {catalog}")
    return open_db(catalog, read_only=read_only)


# Genome rows ------------------------------------------------------------------------------------


def _value(row: dict[str, str], column: str) -> str | None:
    return row.get(column) or None


def genome_row(
    a: AssembledGenome,
    meta: dict[str, str],
    species_code: str,
    species_source: str,
    conflict: bool,
    added_release: str,
) -> GenomeRow:
    f = a.facts
    when = _value(meta, COLUMNS.isolation_date)
    isolation_date, precision = parse_isolation_date(when) if when else (None, None)
    return GenomeRow(
        genome_id=a.genome_id,
        assembly_version=ASSEMBLY_VERSION,
        species_code=species_code,
        species_source=species_source,
        species_conflict=conflict,
        gtdb_classification=f.gtdb_classification,
        gtdb_closest_reference=f.gtdb_closest_reference,
        kraken2_top_taxon=f.kraken2_top_taxon,
        kraken2_top_fraction=f.kraken2_top_fraction,
        mlst_scheme=f.mlst_scheme,
        st=f.st,
        platform=_value(meta, COLUMNS.platform) or f.platform,
        assembler=f.assembler,
        assembler_version=f.assembler_version,
        assembly_status=f.assembly_status,
        genome_size=f.genome_size,
        contig_count=f.contig_count,
        n50=f.n50,
        gc_content=f.gc_content,
        cds_count=f.cds_count,
        rrna_count=f.rrna_count,
        trna_count=f.trna_count,
        checkm2_completeness=f.checkm2_completeness,
        checkm2_contamination=f.checkm2_contamination,
        source_type=_value(meta, COLUMNS.source_type),
        isolation_date=isolation_date,
        isolation_date_precision=precision,
        country=_value(meta, COLUMNS.country),
        region=_value(meta, COLUMNS.region),
        city=_value(meta, COLUMNS.city),
        site=_value(meta, COLUMNS.site),
        host=_value(meta, COLUMNS.host),
        isolation_site=_value(meta, COLUMNS.isolation_site),
        collection_group=_value(meta, COLUMNS.collection_group),
        biosample_accession=_value(meta, COLUMNS.biosample_accession),
        assembly_accession=_value(meta, COLUMNS.assembly_accession),
        sra_accession=_value(meta, COLUMNS.sra_accession),
        amr_gene_count=0,
        amr_mutation_count=0,
        plasmid_contig_count=0,
        prophage_region_count=0,
        summary_sentence=None,
        added_release=added_release,
    )


def extra_rows(table: MetadataFile, genome_ids: set[str]) -> list[MetadataExtraRow]:
    extra = table.extra_columns()
    out: list[MetadataExtraRow] = []
    for row in table.rows:
        gid = row.get(COLUMNS.genome_id, "")
        if gid not in genome_ids:
            continue
        for key in extra:
            if row.get(key):
                out.append(MetadataExtraRow(gid, key, row[key]))
    return sorted(out, key=lambda r: (r.genome_id, r.key))


# Existing catalog -------------------------------------------------------------------------------


def _previous(catalog: Path) -> tuple[dict[str, str], dict[str, list[tuple[Any, ...]]]]:
    """``added_release`` by genome and the side table rows of an existing catalog."""
    if not catalog.is_file():
        return {}, {}
    con = open_db(catalog, read_only=True)
    try:
        added: dict[str, str] = {}
        if table_exists(con, "genome"):
            added = {
                gid: rel
                for gid, rel in con.execute(
                    "SELECT genome_id, added_release FROM genome"
                ).fetchall()
                if rel
            }
        side: dict[str, list[tuple[Any, ...]]] = {}
        for name in SIDE_TABLES:
            if table_exists(con, name):
                spec = schema.table(name)
                order = ", ".join(f'"{c}"' for c in spec.column_names)
                side[name] = con.execute(f'SELECT * FROM "{name}" ORDER BY {order}').fetchall()
        return added, side
    finally:
        con.close()


# Per-genome files -------------------------------------------------------------------------------


def write_genome_files(results_dir: Path, sample: str, target: Path) -> None:
    """Copy one genome's Bakta files, gzip-compressed without timestamps, to ``target``."""
    prefix = L.resolve_prefix(results_dir, sample)
    b = L.BAKTA
    for source, name in ((b.gbff, GBFF), (b.gff3, GFF3), (b.fna, FNA), (b.faa, FAA)):
        path = source.resolve(results_dir, sample, prefix)
        if path.is_file():
            write_gzip(target / name, path.read_bytes())


# Ingest -----------------------------------------------------------------------------------------


def run_ingest(results_dir: Path, metadata_path: Path, catalog: Path) -> IngestResult:
    release_id = release_id_from_catalog(catalog)
    config = platform()
    registry = load_species_registry()
    palette = load_palette()
    display = load_typing_display()
    templates = load_summary_templates()

    table = read_metadata(metadata_path)
    issues = validate_metadata(table, config, registry, results_dir)
    if failures(issues):
        raise IngestError(f"{metadata_path} does not validate", failures(issues))
    warnings: list[Issue] = [i for i in issues if i.severity == WARNING]

    listed = {effective_sample(r) for r in table.rows}
    for sample in list_samples(results_dir):
        if sample not in listed:
            warnings.append(
                Issue(
                    RULE_SAMPLE_NOT_IN_METADATA,
                    WARNING,
                    f"mgap sample {sample} has no metadata row and is not ingested",
                )
            )

    pipeline = parse_pipeline_info(results_dir)
    gtdbtk = parse_gtdbtk_summary(results_dir)
    added, side = _previous(catalog)
    rows = sorted(table.rows, key=lambda r: r[COLUMNS.genome_id])

    genomes: list[GenomeRow] = []
    assembled: list[AssembledGenome] = []
    problems: list[Issue] = []
    for meta in rows:
        gid = meta[COLUMNS.genome_id]
        sample = effective_sample(meta)
        a = assemble_genome(gid, parse_sample(results_dir, sample, gid, gtdbtk), display, pipeline)
        problems += failures(a.issues)
        warnings += [i for i in a.issues if i.severity == WARNING]
        f = a.facts
        evidence = SpeciesEvidence(
            metadata=_value(meta, COLUMNS.species),
            gtdbtk=f.gtdb_species,
            mlst_scheme=f.mlst_scheme,
            kraken2=f.kraken2_top_taxon,
        )
        species = assign_species(evidence, registry, config.species_precedence)
        if species.species_code is None or species.species_source is None:
            problems.append(
                Issue(
                    RULE_SPECIES,
                    FAILURE,
                    f"species {species.name!r} (from {species.species_source}) is not in the "
                    "species registry"
                    if species.name
                    else "no source names a species",
                    gid,
                )
            )
            continue
        genomes.append(
            genome_row(
                a,
                meta,
                species.species_code,
                species.species_source,
                species.species_conflict,
                added.get(gid, release_id),
            )
        )
        assembled.append(a)
    if problems:
        raise IngestError("the mgap results do not ingest", problems)

    tables: dict[str, list[Any]] = {
        "species_registry": registry_rows(registry, palette),
        "genome": genomes,
        "contig": [r for a in assembled for r in a.contigs],
        "feature": [r for a in assembled for r in a.features],
        "annotation_hit": [r for a in assembled for r in a.hits],
        "mutation": [r for a in assembled for r in a.mutations],
        "region": [r for a in assembled for r in a.regions],
        "typing": [r for a in assembled for r in a.typing],
        "tool_version": [r for a in assembled for r in a.tool_versions],
        "metadata_extra": extra_rows(table, {g.genome_id for g in genomes}),
    }

    catalog.parent.mkdir(parents=True, exist_ok=True)
    tmp = catalog.with_name(catalog.name + TMP_SUFFIX)
    tmp.unlink(missing_ok=True)
    counts: dict[str, int] = {}
    con = open_db(tmp)
    try:
        con.execute("BEGIN TRANSACTION")
        schema.create_tables(con)
        for spec in schema.TABLES:
            if spec.name in tables:
                counts[spec.name] = insert(con, spec, tables[spec.name])
            elif spec.name in side and side[spec.name]:
                counts[spec.name] = insert(con, spec, side[spec.name])
        if side.get("tombstone"):
            from ingest.side import apply_tombstones

            apply_tombstones(con)
        refresh_summaries(con, templates, palette)
        for spec in schema.TABLES:
            found = con.execute(f'SELECT count(*) FROM "{spec.name}"').fetchone()
            counts[spec.name] = int(found[0]) if found else 0
        con.execute("COMMIT")
    except BaseException:
        con.close()
        tmp.unlink(missing_ok=True)
        raise
    con.close()

    files = files_dir(catalog)
    staging = files.with_name(files.name + TMP_SUFFIX)
    if staging.exists():
        shutil.rmtree(staging)
    by_id = {r[COLUMNS.genome_id]: r for r in rows}
    for g in genomes:
        write_genome_files(results_dir, effective_sample(by_id[g.genome_id]), staging / g.genome_id)
    os.replace(tmp, catalog)
    if files.exists():
        shutil.rmtree(files)
    staging.mkdir(parents=True, exist_ok=True)
    os.replace(staging, files)

    return IngestResult(
        catalog=catalog,
        release_id=release_id,
        genomes=len(genomes),
        species=sorted({g.species_code for g in genomes if g.species_code}),
        rows=counts,
        unmapped_hits=sum(a.unmapped_hit_count for a in assembled),
        issues=warnings,
    )
