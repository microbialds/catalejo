"""File names, columns and vocabularies of the ingestion side tables.

These are the inputs beside the mgap results directory (contract §4.2 and
§4.6 to §4.8). Like ``mgap_layout``, this module is the one place that spells
them, so the synthetic generator and the ingestion commands agree.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class MetadataColumns:
    """Recognized columns of ``metadata.csv`` (contract §4.2), in file order."""

    genome_id: str = "genome_id"
    species: str = "species"
    source_type: str = "source_type"
    isolation_date: str = "isolation_date"
    country: str = "country"
    region: str = "region"
    city: str = "city"
    site: str = "site"
    host: str = "host"
    isolation_site: str = "isolation_site"
    collection_group: str = "collection_group"
    platform: str = "platform"
    biosample_accession: str = "biosample_accession"
    assembly_accession: str = "assembly_accession"
    sra_accession: str = "sra_accession"
    notes: str = "notes"

    def names(self) -> tuple[str, ...]:
        return tuple(vars(self).values())


@dataclass(frozen=True)
class MetadataTable:
    file_name: str = "metadata.csv"
    columns: MetadataColumns = MetadataColumns()
    source_types: tuple[str, ...] = ("clinical", "environmental", "food", "animal", "other")
    platforms: tuple[str, ...] = ("illumina", "ont", "pacbio", "hybrid")
    date_precisions: tuple[str, ...] = ("year", "month", "day")


@dataclass(frozen=True)
class SetsTable:
    """Curated sets, one row per member (contract §4.6)."""

    file_name: str = "sets.csv"
    columns: tuple[str, ...] = ("set_id", "name", "description", "genome_id")


@dataclass(frozen=True)
class TombstonesTable:
    """Removed genomes (contract §4.7)."""

    file_name: str = "tombstones.csv"
    columns: tuple[str, ...] = ("genome_id", "removed_release", "reason", "replaced_by")
    reasons: tuple[str, ...] = ("contamination", "duplicate", "withdrawn", "other")


@dataclass(frozen=True)
class GroupsTable:
    """Access groups (contract §4.8)."""

    file_name: str = "groups.csv"
    columns: tuple[str, ...] = ("group_id", "name", "description")


@dataclass(frozen=True)
class GenomeGroupsTable:
    """Access group membership (contract §4.8)."""

    file_name: str = "genome_groups.csv"
    columns: tuple[str, ...] = ("genome_id", "group_id")


METADATA = MetadataTable()
SETS = SetsTable()
TOMBSTONES = TombstonesTable()
GROUPS = GroupsTable()
GENOME_GROUPS = GenomeGroupsTable()
