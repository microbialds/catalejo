"""Typed rows of the master catalog tables (data contract 0.7 §5).

One frozen dataclass per table of ``ingest.schema``, with fields named and
ordered as the table's columns, so the catalog writer can insert
``dataclasses.astuple(row)`` directly. Lists are tuples, ``JSON`` columns
carry their JSON text, and ``None`` is SQL null. A test keeps the field names
equal to the schema's column names.
"""

from __future__ import annotations

from dataclasses import dataclass, fields
from datetime import date
from typing import Any


@dataclass(frozen=True)
class SpeciesRegistryRow:
    """§5.1."""

    species_code: str
    canonical_name: str
    gtdb_name: str | None
    ncbi_taxid: int | None
    aliases: tuple[str, ...]
    mlst_schemes: tuple[str, ...]
    pangenome_eligible: bool
    color: str


@dataclass(frozen=True)
class GenomeRow:
    """§5.2."""

    genome_id: str
    assembly_version: int
    species_code: str | None
    species_source: str | None
    species_conflict: bool
    gtdb_classification: str | None
    gtdb_closest_reference: str | None
    kraken2_top_taxon: str | None
    kraken2_top_fraction: float | None
    mlst_scheme: str | None
    st: str | None
    platform: str | None
    assembler: str | None
    assembler_version: str | None
    assembly_status: str
    genome_size: int
    contig_count: int
    n50: int
    gc_content: float
    cds_count: int | None
    rrna_count: int | None
    trna_count: int | None
    checkm2_completeness: float | None
    checkm2_contamination: float | None
    source_type: str | None
    isolation_date: date | None
    isolation_date_precision: str | None
    country: str | None
    region: str | None
    city: str | None
    site: str | None
    host: str | None
    isolation_site: str | None
    collection_group: str | None
    biosample_accession: str | None
    assembly_accession: str | None
    sra_accession: str | None
    amr_gene_count: int
    amr_mutation_count: int
    plasmid_contig_count: int
    prophage_region_count: int
    summary_sentence: str | None
    added_release: str | None


@dataclass(frozen=True)
class ContigRow:
    """§5.3."""

    genome_id: str
    contig_id: str
    contig_index: int
    length: int
    gc_content: float
    topology: str
    classification: str
    classification_source: str
    mob_cluster_id: str | None
    mob_secondary_cluster_id: str | None
    replicon_types: tuple[str, ...] | None
    relaxase_types: tuple[str, ...] | None
    mobility: str | None
    feature_count: int


@dataclass(frozen=True)
class FeatureRow:
    """§5.4."""

    feature_id: str
    genome_id: str
    contig_id: str
    start: int
    end: int
    strand: str
    type: str
    locus_tag: str | None
    gene: str | None
    product: str | None
    position_index: int
    protein_hash: str | None
    db_xrefs: tuple[str, ...]


@dataclass(frozen=True)
class AnnotationHitRow:
    """§5.5, with the hit coordinates and a null ``feature_id`` when no feature overlaps
    the hit (pending contract edit)."""

    hit_id: str
    feature_id: str | None
    genome_id: str
    contig_id: str
    start: int
    end: int
    strand: str
    source_tool: str
    source_db: str | None
    source_db_version: str | None
    element_name: str
    element_type: str
    element_subtype: str | None
    drug_class: str | None
    drug_subclass: str | None
    aro_accession: str | None
    identity: float | None
    coverage: float | None
    method: str | None
    location_class: str


@dataclass(frozen=True)
class MutationRow:
    """§5.6."""

    mutation_id: str
    genome_id: str
    contig_id: str
    feature_id: str | None
    source_tool: str
    source_db: str | None
    source_db_version: str | None
    gene: str
    variant: str
    variant_type: str
    drug_class: str | None
    start: int | None
    end: int | None
    strand: str | None
    confidence: str | None


@dataclass(frozen=True)
class RegionRow:
    """§5.8. ``attributes`` is JSON text."""

    region_id: str
    genome_id: str
    contig_id: str
    start: int
    end: int
    type: str
    source_tool: str
    source_db_version: str | None
    score: float | None
    attributes: str


@dataclass(frozen=True)
class TypingRow:
    """§5.9."""

    genome_id: str
    source_tool: str
    tool_version: str | None
    key: str
    value: str
    display_group: str


@dataclass(frozen=True)
class ToolVersionRow:
    """§5.15."""

    genome_id: str
    tool: str
    version: str | None
    database: str | None
    database_version: str | None


@dataclass(frozen=True)
class TombstoneRow:
    """§5.16 (§4.7)."""

    genome_id: str
    removed_release: str
    reason: str
    replaced_by: str | None


@dataclass(frozen=True)
class AccessGroupRow:
    """§5.17 (§4.8)."""

    group_id: str
    name: str
    description: str | None


@dataclass(frozen=True)
class GenomeGroupRow:
    """§5.17 (§4.8)."""

    genome_id: str
    group_id: str


@dataclass(frozen=True)
class MetadataExtraRow:
    """§5.18."""

    genome_id: str
    key: str
    value: str


@dataclass(frozen=True)
class GenomeSetRow:
    """§5.14."""

    set_id: str
    name: str
    description: str | None
    kind: str
    genome_count: int
    created_date: date | None


@dataclass(frozen=True)
class GenomeSetMemberRow:
    """§5.14."""

    set_id: str
    genome_id: str


ROW_TYPES: dict[str, type[Any]] = {
    "species_registry": SpeciesRegistryRow,
    "genome": GenomeRow,
    "contig": ContigRow,
    "feature": FeatureRow,
    "annotation_hit": AnnotationHitRow,
    "mutation": MutationRow,
    "region": RegionRow,
    "typing": TypingRow,
    "tool_version": ToolVersionRow,
    "tombstone": TombstoneRow,
    "access_group": AccessGroupRow,
    "genome_group": GenomeGroupRow,
    "metadata_extra": MetadataExtraRow,
    "genome_set": GenomeSetRow,
    "genome_set_member": GenomeSetMemberRow,
}


def field_names(row_type: type[Any]) -> tuple[str, ...]:
    return tuple(f.name for f in fields(row_type))
