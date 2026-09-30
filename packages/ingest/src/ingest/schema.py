"""DuckDB DDL of the master catalog tables (data contract 0.7 §5).

Columns and types are those of contract §5, in the contract's order, so a
table can be read with ``SELECT *`` in the documented shape. The tables of the
Tier 0 pipeline (milestone 1a) are declared here; the pangenome, tree,
embedding and mapping tables (§5.7, §5.10 to §5.13) arrive with their
milestones.

Keys. Primary keys are declared where the contract names one (§5.1 to §5.8)
and on the composite key of ``contig`` (§5.3). Foreign keys are not declared:
the contract lists a dangling reference as a validation failure (§9), which
``release check`` reports by rule, and a declared constraint would abort the
load instead of producing that report.

``annotation_hit`` carries ``start``, ``end`` and ``strand`` after
``contig_id``, the hit coordinates as reported, and its ``feature_id`` is null
when no feature overlaps the hit (maintainer decision, milestone 1a; pending
contract edit of §5.5).

Readings where the contract gives no type:

- ``genome.isolation_date`` is ``DATE``, the first day of the period for dates
  written at year or month precision, with ``isolation_date_precision``
  (``year``, ``month``, ``day``) holding the precision (contract §4.2).
- ``tool_version``, ``tombstone``, ``access_group``, ``genome_group``,
  ``metadata_extra``, ``genome_set`` and ``genome_set_member`` list their
  columns without types (§4.7, §4.8, §5.14 to §5.18); they are ``VARCHAR``
  except ``genome_set.genome_count`` (``INTEGER``) and
  ``genome_set.created_date`` (``DATE``).
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass

import duckdb


@dataclass(frozen=True)
class Column:
    name: str
    type: str


@dataclass(frozen=True)
class TableSpec:
    name: str
    columns: tuple[Column, ...]
    primary_key: tuple[str, ...] = ()

    @property
    def column_names(self) -> tuple[str, ...]:
        return tuple(c.name for c in self.columns)

    def ddl(self) -> str:
        parts = [f'    "{c.name}" {c.type}' for c in self.columns]
        if self.primary_key:
            keys = ", ".join(f'"{k}"' for k in self.primary_key)
            parts.append(f"    PRIMARY KEY ({keys})")
        return f'CREATE TABLE "{self.name}" (\n' + ",\n".join(parts) + "\n)"


V = "VARCHAR"
VL = "VARCHAR[]"
I = "INTEGER"  # noqa: E741
B = "BIGINT"
F = "FLOAT"
BOOL = "BOOLEAN"
DATE = "DATE"
JSON = "JSON"


def _cols(*pairs: tuple[str, str]) -> tuple[Column, ...]:
    return tuple(Column(n, t) for n, t in pairs)


SPECIES_REGISTRY = TableSpec(
    "species_registry",
    _cols(
        ("species_code", V),
        ("canonical_name", V),
        ("gtdb_name", V),
        ("ncbi_taxid", I),
        ("aliases", VL),
        ("mlst_schemes", VL),
        ("pangenome_eligible", BOOL),
        ("color", V),
    ),
    primary_key=("species_code",),
)

GENOME = TableSpec(
    "genome",
    _cols(
        ("genome_id", V),
        ("assembly_version", I),
        ("species_code", V),
        ("species_source", V),
        ("species_conflict", BOOL),
        ("gtdb_classification", V),
        ("gtdb_closest_reference", V),
        ("kraken2_top_taxon", V),
        ("kraken2_top_fraction", F),
        ("mlst_scheme", V),
        ("st", V),
        ("platform", V),
        ("assembler", V),
        ("assembler_version", V),
        ("assembly_status", V),
        ("genome_size", B),
        ("contig_count", I),
        ("n50", B),
        ("gc_content", F),
        ("cds_count", I),
        ("rrna_count", I),
        ("trna_count", I),
        ("checkm2_completeness", F),
        ("checkm2_contamination", F),
        ("source_type", V),
        ("isolation_date", DATE),
        ("isolation_date_precision", V),
        ("country", V),
        ("region", V),
        ("city", V),
        ("site", V),
        ("host", V),
        ("isolation_site", V),
        ("collection_group", V),
        ("biosample_accession", V),
        ("assembly_accession", V),
        ("sra_accession", V),
        ("amr_gene_count", I),
        ("amr_mutation_count", I),
        ("plasmid_contig_count", I),
        ("prophage_region_count", I),
        ("summary_sentence", V),
        ("added_release", V),
    ),
    primary_key=("genome_id",),
)

CONTIG = TableSpec(
    "contig",
    _cols(
        ("genome_id", V),
        ("contig_id", V),
        ("contig_index", I),
        ("length", B),
        ("gc_content", F),
        ("topology", V),
        ("classification", V),
        ("classification_source", V),
        ("mob_cluster_id", V),
        ("mob_secondary_cluster_id", V),
        ("replicon_types", VL),
        ("relaxase_types", VL),
        ("mobility", V),
        ("feature_count", I),
    ),
    primary_key=("genome_id", "contig_id"),
)

FEATURE = TableSpec(
    "feature",
    _cols(
        ("feature_id", V),
        ("genome_id", V),
        ("contig_id", V),
        ("start", B),
        ("end", B),
        ("strand", V),
        ("type", V),
        ("locus_tag", V),
        ("gene", V),
        ("product", V),
        ("position_index", I),
        ("protein_hash", V),
        ("db_xrefs", VL),
    ),
    primary_key=("feature_id",),
)

ANNOTATION_HIT = TableSpec(
    "annotation_hit",
    _cols(
        ("hit_id", V),
        ("feature_id", V),
        ("genome_id", V),
        ("contig_id", V),
        ("start", B),
        ("end", B),
        ("strand", V),
        ("source_tool", V),
        ("source_db", V),
        ("source_db_version", V),
        ("element_name", V),
        ("element_type", V),
        ("element_subtype", V),
        ("drug_class", V),
        ("drug_subclass", V),
        ("aro_accession", V),
        ("identity", F),
        ("coverage", F),
        ("method", V),
        ("location_class", V),
    ),
    primary_key=("hit_id",),
)

MUTATION = TableSpec(
    "mutation",
    _cols(
        ("mutation_id", V),
        ("genome_id", V),
        ("contig_id", V),
        ("feature_id", V),
        ("source_tool", V),
        ("source_db", V),
        ("source_db_version", V),
        ("gene", V),
        ("variant", V),
        ("variant_type", V),
        ("drug_class", V),
        ("start", B),
        ("end", B),
        ("strand", V),
        ("confidence", V),
    ),
    primary_key=("mutation_id",),
)

REGION = TableSpec(
    "region",
    _cols(
        ("region_id", V),
        ("genome_id", V),
        ("contig_id", V),
        ("start", B),
        ("end", B),
        ("type", V),
        ("source_tool", V),
        ("source_db_version", V),
        ("score", F),
        ("attributes", JSON),
    ),
    primary_key=("region_id",),
)

TYPING = TableSpec(
    "typing",
    _cols(
        ("genome_id", V),
        ("source_tool", V),
        ("tool_version", V),
        ("key", V),
        ("value", V),
        ("display_group", V),
    ),
)

TOOL_VERSION = TableSpec(
    "tool_version",
    _cols(
        ("genome_id", V),
        ("tool", V),
        ("version", V),
        ("database", V),
        ("database_version", V),
    ),
)

TOMBSTONE = TableSpec(
    "tombstone",
    _cols(
        ("genome_id", V),
        ("removed_release", V),
        ("reason", V),
        ("replaced_by", V),
    ),
)

ACCESS_GROUP = TableSpec(
    "access_group",
    _cols(
        ("group_id", V),
        ("name", V),
        ("description", V),
    ),
)

GENOME_GROUP = TableSpec(
    "genome_group",
    _cols(
        ("genome_id", V),
        ("group_id", V),
    ),
)

METADATA_EXTRA = TableSpec(
    "metadata_extra",
    _cols(
        ("genome_id", V),
        ("key", V),
        ("value", V),
    ),
)

GENOME_SET = TableSpec(
    "genome_set",
    _cols(
        ("set_id", V),
        ("name", V),
        ("description", V),
        ("kind", V),
        ("genome_count", I),
        ("created_date", DATE),
    ),
)

GENOME_SET_MEMBER = TableSpec(
    "genome_set_member",
    _cols(
        ("set_id", V),
        ("genome_id", V),
    ),
)

TABLES: tuple[TableSpec, ...] = (
    SPECIES_REGISTRY,
    GENOME,
    CONTIG,
    FEATURE,
    ANNOTATION_HIT,
    MUTATION,
    REGION,
    TYPING,
    TOOL_VERSION,
    TOMBSTONE,
    ACCESS_GROUP,
    GENOME_GROUP,
    METADATA_EXTRA,
    GENOME_SET,
    GENOME_SET_MEMBER,
)


def table(name: str) -> TableSpec:
    for spec in TABLES:
        if spec.name == name:
            return spec
    raise KeyError(name)


def create_tables(con: duckdb.DuckDBPyConnection, tables: Iterable[TableSpec] = TABLES) -> None:
    """Create every catalog table on ``con`` (which must not hold them yet)."""
    for spec in tables:
        con.execute(spec.ddl())
