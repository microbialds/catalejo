# Data contract

Version 0.8, 2026-09-30. Status: draft for review.

This document is the interface between the ingestion package (`packages/ingest`, Python) and the web application (`packages/web`, TypeScript). Both are built against it. Anything the web application reads is defined here; anything the ingestion package writes is defined here. A change to this document is a schema change and bumps `schema_version`.

Contents

1. Vocabulary
2. Versioning and compatibility
3. Identifiers
4. Inputs to ingestion
5. Master catalog tables
6. Release layout
7. Precomputed products
8. Ingestion commands
9. Validation rules
10. Open items

---

## 1. Vocabulary

The platform serves an academic audience in microbial genomics and infectious disease. Terms below are used consistently in the interface, the code, the URLs and the documentation. Where a term has a clinical or epidemiological meaning that differs from the intended one, it is avoided.

| Term | Meaning | Avoid |
|---|---|---|
| Genome | One assembled and annotated genome from one isolate. The unit of the collection. | sample, strain (unless referring to the biological strain) |
| Isolate | The biological source of a genome. One isolate has exactly one genome in the collection at any time; a re-sequenced isolate replaces its genome (see §3.1). | |
| Collection | All genomes in a release. | database (in the interface) |
| Release | An immutable, versioned snapshot of the collection and its derived products, identified by `release_id`. | version (ambiguous with app version) |
| Genome set | Any subset of the collection defined by filters or by an explicit list of genome IDs. The object every page operates on. | cohort (a clinical and epidemiological term) |
| Curated set | A genome set shipped inside a release by the maintaining group, with a name and description. | |
| Feature | An annotated element on a contig with coordinates and a strand: CDS, rRNA, tRNA, ncRNA, CRISPR array and so on, as annotated by Bakta. | gene (reserved for the gene symbol) |
| Annotation hit | A match between a feature and an external database entry (AMRFinderPlus, RGI/CARD, VFDB and others), with identity, coverage and the source tool. | |
| Resistance determinant | An annotation hit or a point mutation associated with antimicrobial resistance. | AMR gene (when mutations are included) |
| Point mutation | A resistance-associated substitution reported against a reference allele, linked to a feature when coordinates allow. | SNP (reserved for tree alignments) |
| Region | An interval on a contig produced by a region-calling tool (geNomad prophage or plasmid region, later integrons or others). | island (imprecise) |
| Typing result | A key and value produced by a species-specific typing tool (Kleborate, SISTR, sccmec) or by MLST. | |
| Pangenome cluster | A cluster of homologous features across genomes of one species, produced by Panaroo. | orthogroup, gene family (unless referring to the method) |
| Neighborhood | The features within a fixed number of positions upstream and downstream of a focal feature on the same contig. | context (used only in prose) |
| Embedding map | The two-dimensional projection of genome embeddings, shown on the Embeddings page. | atlas |
| Species | The canonical species name assigned to a genome by the precedence in §3.3. | taxon (used only for lineage strings) |

Interface strings follow this vocabulary. Pages are named Collection, Genome sets, Genomes, Genes, Phylogeny, Pangenome, Embeddings and Sequence search. The platform is named Catalejo Genómico (a genomic spyglass) in prose, documents and citations, and Catalejo in the interface; the repository, the ingestion package and its command are `catalejo`, without the accent. The Methods page states the name and its reading. The bar at the top of every page reads "N genomes in the current set". Actions are "Save set", "Load set" and "Use as set".

---

## 2. Versioning and compatibility

Three things are versioned independently.

| Object | Identifier | Changes when |
|---|---|---|
| Schema | `schema_version`, semantic version, in this document and in every manifest | Any table, column, file layout or precomputed product changes |
| Data release | `release_id`, `YYYY-MM` with an optional letter suffix for corrections (`2026-09`, `2026-09b`) | New genomes, re-annotation, new pangenomes, trees or embeddings |
| Application | `app_version`, semantic version of `packages/web` | Any change to the web application |

The application declares the range of `schema_version` it supports. On load it reads `manifest.json`, and if the release's `schema_version` is outside the range it displays the mismatch and stops. A data release and an application deployment are therefore separate events with separate CI workflows (§8.4), and either can be rolled back without the other.

Within a major schema version, columns may be added but never removed or retyped. A removal or retype is a major version change and requires a migration note in `docs/schema-changes.md`.

Before the first release, changes to this document do not bump schema_version; the first release carries 0.1.0.

---

## 3. Identifiers

### 3.1 Genome and isolate

`genome_id` is the identifier assigned by the maintaining group or received with the isolate (for example `SCL0421`). Collections take identifiers from many origins, so any form is accepted within a character set that is safe in paths and URLs. The default pattern, `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`, lives in `config/platform.yaml`, where a group may tighten it, and is validated at ingestion. The mgap sample name may differ from `genome_id` (for example a platform prefix such as `ont_SCL30014` for `SCL30014`); the metadata table maps one to the other (§4.2).

Rules.

- A `genome_id` is unique in the collection, compared without regard to case because release files are stored on file systems that may ignore case.
- A `genome_id` is never reused. A genome removed from the collection leaves a tombstone (§5.16).
- One isolate has one genome. If an isolate is re-sequenced or re-assembled, the new assembly keeps the same `genome_id`, `assembly_version` increments, and the previous assembly is retired. Everything derived from the genome is recomputed at the next release. The feature mapping in §3.4 links old and new feature IDs where coordinates allow; across a re-assembly most features will not map, which is expected.
- `biosample_accession` and `assembly_accession` are optional and can be added at any release without changing `genome_id`.

### 3.2 Contig

`contig_id` is the contig name in the Bakta nucleotide FASTA (`.fna`) for that genome, unique within the genome. Every annotation module reads that FASTA and reports the same names; where a module reports assembler names instead (RGI runs on the SPAdes scaffolds), they are mapped to Bakta names by sequence. A hit on an assembler contig that Bakta dropped (shorter than 200 bp) has no Bakta name and is left out with a warning. Contig names are stable across re-annotation because re-annotation does not touch the assembly. Across a re-assembly they change, which is covered by `assembly_version`.

### 3.3 Species

Species is assigned once per genome at ingestion by the first source available in this order, and the source is recorded.

1. `species` column in the metadata table (manual or curated)
2. GTDB-Tk classification, when run
3. MLST scheme name, mapped through the species registry
4. Kraken2/Bracken majority species from the mgap contamination step

The assigned name must exist in `species_registry` (§5.1), loaded from `config/species_registry.yaml` (§4.9), which maps aliases and scheme names to one canonical binomial and a short `species_code` used in partition paths. A genome whose assigned name is absent from the registry fails validation. When two sources disagree, the higher-precedence source wins and `species_conflict` is set to true so the genome page can show a note. Because several MLST schemes cover a species complex (the *Klebsiella* scheme, for instance), a scheme may map to the complex's canonical name in the registry, and GTDB-Tk remains the way to resolve members of a complex when that distinction matters.

### 3.4 Feature

`feature_id` is a positional hash, the first 16 hexadecimal characters of SHA-1 over the string `genome_id|contig_id|start|end|strand`, with `start` and `end` as 1-based inclusive integers and `strand` as Bakta writes it (`+`, `-`, or `?` and `.` for origins and assembly gaps), entered in the hash unchanged. Re-annotation that predicts the same feature at the same coordinates yields the same identifier without any lookup.

When coordinates change between releases, `release build` writes `feature_mapping` (§5.7) by reciprocal overlap on the same contig and strand. The overlap fraction is the length shared by the old and the new feature divided by the length of the shorter one; it is a coordinate measure, unrelated to sequence identity. A fraction of 1.0 means one feature lies entirely within the other, and the default threshold of 0.9 accepts a start-codon shift or a few codons of difference while rejecting a feature that was split or replaced. Unmapped features are recorded with a null target so the application can explain a stale link. The threshold is a parameter in `config/platform.yaml` and should be reviewed after the first re-annotation, by inspecting how many features fall between 0.5 and 0.9.

The other hashed identifiers, `hit_id` (§5.5), `mutation_id` (§5.6) and `region_id` (§5.8), take the same form, the first 16 hexadecimal characters of SHA-1 over the `|`-joined string.

### 3.5 Pangenome cluster

`cluster_id` is the Panaroo cluster name prefixed with the species code and release, `KPN.2026-09.group_1234`, because Panaroo names are stable only within one run. `cluster_mapping` (§5.11) links clusters across releases by shared membership. For each new cluster, the previous cluster that shares the largest number of member features (matched by `feature_id`, or by `feature_mapping` when coordinates moved) is the candidate, and the shared fraction is the number of shared members divided by the size of the smaller cluster. The default threshold of 0.5 declares the clusters the same when at least half of the smaller one carries over; below it the new cluster is recorded as `new`, `split` or `merged` depending on how many previous clusters contribute. The threshold is a parameter in `config/platform.yaml`.

### 3.6 Three gene namespaces

A gene can be referred to by its Bakta gene symbol (`feature.gene`), by the allele or element name from a resistance database (`annotation_hit.element_name`), or by its pangenome cluster (`cluster_membership.cluster_id`). The three are stored as separate columns and never merged. The Genes page resolves a query against all three and shows which namespace matched.

---

## 4. Inputs to ingestion

### 4.1 mgap results directory

The ingestion package reads an mgap output directory (gene2dis/mgap, `--outdir`). Paths below are relative to that directory and reflect mgap 2.0.0 as observed on an Illumina run and a nanopore run. Each genome has one directory named by its mgap sample (`<s>`, §3.1), and most files inside it are named by a file prefix (`<p>`), which is discovered from the Bakta output and usually equals `<s>`. Every path and column name is defined once in `packages/ingest/src/ingest/mgap_layout.py`, which the parsers (`packages/ingest/src/ingest/parsers/<module>.py`) and the synthetic generator import, so a change in mgap output touches one file. Entries marked provisional have not yet been seen in an mgap run and follow the tool's documented output.

| Module | Files read | Feeds |
|---|---|---|
| Assembly, Illumina (SPAdes) | `<s>/assemblies/<p>.scaffolds.fa.gz`, `<p>.contigs.fa.gz`, `<p>.assembly.gfa.gz` | `genome` (`assembler`, `platform`) |
| Assembly, nanopore (Autocycler, Dnaapler) | `<s>/assemblies/autocycler/<p>.fasta` and `<p>.gfa`, `<s>/assemblies/dnaapler/<p>.fasta` (uncompressed) | `genome` (`assembler`, `platform`) |
| Bakta | `<s>/annotation/bakta/<p>.tsv`, `.gff3`, `.gbff`, `.faa`, `.ffn`, `.fna`, `.txt` | `contig` (names, lengths, and `topology` and completeness from the `.fna` header tags), `feature`, per-genome files, Bakta database version |
| CheckM2 | `<s>/annotation/checkm2/<s>_checkm2_report.tsv` | `genome` (QC columns) |
| QUAST | `<s>/qc/quast/<p>.tsv` | `genome` (assembly statistics, cross-check) |
| Kraken2 / Bracken | `<s>/read_processing/kraken2/<p>.kraken2.report.txt`; `<s>/read_processing/bracken/<p>.tsv` when Bracken ran | `genome` (`kraken2_top_taxon`, `kraken2_top_fraction`) |
| MLST | `<s>/annotation/mlst/<p>.tsv` (one line, no header) | `genome` (`mlst_scheme`, `st`), `typing` (alleles) |
| GTDB-Tk (provisional) | `gtdbtk/gtdbtk.bac120.summary.tsv` | `genome` (`gtdb_classification`, `gtdb_closest_reference`) |
| AMRFinderPlus | `<s>/annotation/amrfinder/<p>.tsv` and `<p>-mutations.tsv` (nucleotide input, so contig coordinates are present) | `annotation_hit` (rows other than point mutations), `mutation` (rows of subtype POINT or POINT_DISRUPT, §5.6) |
| RGI (optional) | `<s>/annotation/rgi/<p>.txt` | `annotation_hit` |
| geNomad | `<s>/annotation/genomad/<s>_summary/<s>_virus_summary.tsv`, `<s>_plasmid_summary.tsv` | `region`, contig classification without MOB-suite (§10) |
| MOB-suite (optional) | `<s>/annotation/mobsuite/contig_report.txt`, `mobtyper_results.txt` (the second only when a plasmid is found) | `contig` (plasmid columns) |
| Kleborate | `<s>/annotation/kleborate/klebsiella_pneumo_complex_output.txt` | `typing` |
| SISTR, sccmec (provisional) | `<s>/annotation/sistr/<p>.tab`, `<s>/annotation/sccmec/<p>.tsv` | `typing` |
| Pipeline info | `pipeline_info/software_versions.yml` (nf-core convention) | `tool_version` |

Names written inside the reports (the CheckM2 `Name`, the MLST file column, the Kleborate `strain`) come from the assembly file and differ between platforms; parsers never key on them, since each per-genome report holds one genome.

Tool and database versions are attached to each genome (`tool_version`), so that prevalence plots can warn when a genome set mixes annotation versions. They are read from per-genome sources first (the Bakta database from the Bakta `.txt` summary, a per-genome `versions.yml` where mgap writes one) and otherwise from the run's `pipeline_info/software_versions.yml`, whose `Workflow` entry also gives the pipeline version. A version absent from every source is null.

### 4.2 Metadata table

A CSV or TSV named `metadata.csv`, one row per genome. Only `genome_id` is mandatory. Recognized columns are typed; unrecognized columns are stored in `metadata_extra` as key-value pairs and shown on the genome page under "Additional metadata".

| Column | Type | Vocabulary or format |
|---|---|---|
| `genome_id` | string | pattern from `config/platform.yaml` |
| `mgap_sample` | string | sample directory name in the mgap results; defaults to `genome_id`. `metadata init` proposes `genome_id` from it with `sample_name_rules` in `config/platform.yaml` |
| `species` | string | canonical name or alias in `species_registry`; overrides tool assignment |
| `source_type` | string | controlled: `clinical`, `environmental`, `food`, `animal`, `other` |
| `isolation_date` | date | ISO 8601, `YYYY`, `YYYY-MM` or `YYYY-MM-DD`; precision is preserved in `isolation_date_precision` |
| `country` | string | ISO 3166-1 alpha-2 |
| `region` | string | free text (administrative region) |
| `city` | string | free text |
| `site` | string | free text (hospital, farm, river; whatever the group uses) |
| `host` | string | free text, scientific name preferred |
| `isolation_site` | string | free text (blood, urine, sputum, soil, water) |
| `collection_group` | string | free text label for the study or surveillance program |
| `platform` | string | controlled: `illumina`, `ont`, `pacbio`, `hybrid`; overrides mgap detection |
| `biosample_accession`, `assembly_accession`, `sra_accession` | string | NCBI or ENA accessions |
| `notes` | string | free text |

`metadata init` (§8.1) writes this file from an mgap directory with every derivable column filled and the rest empty. Manual entries take precedence over derived ones on every subsequent run.

### 4.3 Pangenome inputs

One directory per species per release, produced outside the platform (Panaroo initially).

| File | Required | Content |
|---|---|---|
| `gene_presence_absence.csv` | yes | Panaroo matrix, genome columns named by `genome_id` |
| `gene_data.csv` | yes | Panaroo feature to cluster assignments, used to join to `feature_id` through Bakta locus tags |
| `summary_statistics.txt` | yes | core, soft core, shell, cloud counts |
| `core_gene_alignment.aln` | no | used only to record provenance for the tree |
| `pangenome.yaml` | yes | `species_code`, `tool`, `tool_version`, `parameters` (clean mode, identity threshold), `genome_count`, `date` |

Cluster IDs across releases are mapped by `pangenome map` (§8.2) using shared feature membership, and the mapping is written to `cluster_mapping`.

### 4.4 Tree inputs

One directory per tree, produced outside the platform.

| File | Required | Content |
|---|---|---|
| `tree.nwk` | yes | Newick, tip labels equal to `genome_id` |
| `tree.yaml` | yes | `tree_id`, `species_code`, `alignment_type` (`core_genome` or `reference_snp`), `reference_accession` (when SNP), `alignment_tool`, `tree_tool`, `tool_version`, `model`, `genome_count`, `date`, `rooting` (`midpoint`, `outgroup`, `unrooted`) |

A species may have more than one tree in a release (for example a core-genome tree for all genomes and a reference-SNP tree for one lineage). The phylogeny page lists them and the caption is generated from `tree.yaml`.

### 4.5 Embedding inputs

Embeddings are produced outside the platform by a separate tool and delivered as a Parquet file with one row per genome. The platform never computes embeddings.

| Column | Type | Required |
|---|---|---|
| `genome_id` | string | yes |
| `model` | string (`bacformer`, later others) | yes |
| `model_version` | string | yes |
| `dim` | integer | yes |
| `vector` | list of float32, length `dim` | yes |
| `umap_x`, `umap_y`, `umap_params` | float32, float32, string (JSON) | no; accepted as an override |

The two-dimensional projection is computed by `release build` (UMAP, with `n_neighbors`, `min_dist` and `seed` from `config/platform.yaml`) and written to the `embedding` table together with the parameters, which also appear in the manifest and on the Embeddings page. When the file provides projection columns, they are used as given and `umap_params` is recorded as supplied. Multiple models may coexist; the Embeddings page offers one selector per model. Genomes without an embedding are shown as absent from the map with a count.

### 4.6 Curated sets

`sets.csv` with columns `set_id`, `name`, `description`, `genome_id`. One row per member. Sets are shipped with the release and appear on the Genome sets page.

### 4.7 Tombstones

`tombstones.csv` with columns `genome_id`, `removed_release`, `reason` (controlled: `contamination`, `duplicate`, `withdrawn`, `other`), `replaced_by` (optional `genome_id`). A tombstoned genome is excluded from every table except `tombstone` and `genome_group`, and its former URL resolves to a page that shows the record. Its `genome_group` rows are kept only to route the tombstone to the group releases that included the genome (§6), and the full release holds every tombstone.

### 4.8 Access groups

`groups.csv` with columns `group_id`, `name`, `description`, and `genome_groups.csv` with columns `genome_id`, `group_id`. A genome may belong to several groups. Every genome must belong to at least one group; `release build --group` filters on this table. `genome_groups.csv` may also list tombstoned genomes, so that their tombstones reach the group releases that included them.

### 4.9 Species registry

`config/species_registry.yaml`, checked into the repository and kept across releases, with one entry per species.

| Field | Content |
|---|---|
| `species_code` | 3 to 5 uppercase letters (§5.1) |
| `canonical_name` | binomial |
| `gtdb_name` | name as GTDB writes it, optional |
| `ncbi_taxid` | optional |
| `aliases` | alternative spellings and subspecies names |
| `mlst_schemes` | MLST scheme names that map to this species |
| `pangenome_eligible` | whether a pangenome and tree are expected |
| `color_index` | position in the species sequence of `config/palette.yaml`, set once when the species is added and never changed; null for species beyond the eighth, which take the palette's `other` color |

`ingest` loads the file into `species_registry` and resolves `color` from the palette. Adding a species is a change to this file.

---

## 5. Master catalog tables

The master catalog is one DuckDB file, `catalog/<release_id>.duckdb`, together with its per-genome file directory `catalog/<release_id>.files/<genome_id>/`, which holds the Bakta GenBank, GFF3, nucleotide FASTA and protein FASTA of each genome compressed with gzip. The directory exists because the per-genome files of §6.3 and the GC tracks of §7.1 need sequences that the tables do not hold, and `release build` refuses a catalog whose directory is missing. Both are kept by the maintaining group and backed up together outside Cloudflare. Types are DuckDB types. Every table has `release_id` as an implicit attribute of the file and it is not repeated as a column except where noted. The `release_id` is the stem of the catalog file name, `YYYY-MM` with an optional letter (§2), or the literal `synth` for the synthetic release (§8.5).

### 5.1 `species_registry`

| Column | Type | Notes |
|---|---|---|
| `species_code` | VARCHAR, primary key | 3 to 5 uppercase letters, used in paths and IDs (`KPN`, `ECO`, `MTB`) |
| `canonical_name` | VARCHAR | binomial, italicized in the interface |
| `gtdb_name` | VARCHAR | name as GTDB writes it, nullable |
| `ncbi_taxid` | INTEGER | nullable |
| `aliases` | VARCHAR[] | alternative spellings and subspecies names that map here |
| `mlst_schemes` | VARCHAR[] | scheme names that map here |
| `pangenome_eligible` | BOOLEAN | whether a pangenome and tree are expected |
| `color` | VARCHAR | hex color from the species palette, resolved at ingestion from `color_index` (§4.9), so it is stable across releases |

### 5.2 `genome`

| Column | Type | Notes |
|---|---|---|
| `genome_id` | VARCHAR, primary key | §3.1 |
| `assembly_version` | INTEGER | starts at 1 |
| `species_code` | VARCHAR, foreign key | |
| `species_source` | VARCHAR | `metadata`, `gtdbtk`, `kraken2`, `mlst` |
| `species_conflict` | BOOLEAN | true when another available source names a different species, including a name absent from `species_registry` |
| `gtdb_classification` | VARCHAR | full lineage string, nullable |
| `gtdb_closest_reference` | VARCHAR | nullable |
| `kraken2_top_taxon`, `kraken2_top_fraction` | VARCHAR, FLOAT | top species from Bracken when it ran, else from Kraken2; fraction of reads from 0 to 1 |
| `mlst_scheme`, `st` | VARCHAR, VARCHAR | `st` as text to allow `ST258-1LV` style values |
| `platform` | VARCHAR | `illumina`, `ont`, `pacbio`, `hybrid` |
| `assembler`, `assembler_version` | VARCHAR | |
| `assembly_status` | VARCHAR | `complete` when every classified replicon is circular, else `draft`; circularity from the Bakta `.fna` header tags |
| `genome_size`, `contig_count`, `n50`, `gc_content` | BIGINT, INTEGER, BIGINT, FLOAT | from the Bakta summary, over the contigs Bakta kept; `gc_content` in percent |
| `cds_count`, `rrna_count`, `trna_count` | INTEGER | from Bakta summary |
| `checkm2_completeness`, `checkm2_contamination` | FLOAT | |
| `source_type`, `isolation_date`, `isolation_date_precision`, `country`, `region`, `city`, `site`, `host`, `isolation_site`, `collection_group` | see §4.2 | `isolation_date` is a DATE holding the first day of the period, and `isolation_date_precision` is `year`, `month` or `day` |
| `biosample_accession`, `assembly_accession`, `sra_accession` | VARCHAR | nullable |
| `amr_gene_count`, `amr_mutation_count`, `plasmid_contig_count`, `prophage_region_count` | INTEGER | denormalized counters computed at ingestion and copied by release build; `amr_gene_count` counts the AMRFinderPlus hits of `element_type` `amr` that are not point mutations, one per row |
| `summary_sentence` | VARCHAR | generated by template (§7.4) at ingestion; a group release regenerates it over its own genomes (§6) |
| `added_release` | VARCHAR | first release that included this genome |

### 5.3 `contig`

| Column | Type | Notes |
|---|---|---|
| `genome_id`, `contig_id` | VARCHAR, VARCHAR, composite key | |
| `contig_index` | INTEGER | order in the Bakta `.fna`, starting at 1 |
| `length` | BIGINT | |
| `gc_content` | FLOAT | percent |
| `topology` | VARCHAR | `circular`, `linear`, `unknown`, from the Bakta `.fna` header tags |
| `classification` | VARCHAR | `chromosome`, `plasmid`, `unclassified` from MOB-suite when run, else derived from geNomad (§10) |
| `classification_source` | VARCHAR | `mobsuite` or `genomad` |
| `mob_cluster_id` | VARCHAR | MOB-suite primary cluster, nullable; enables "same plasmid in N genomes" |
| `mob_secondary_cluster_id` | VARCHAR | nullable |
| `replicon_types` | VARCHAR[] | from MOB-typer |
| `relaxase_types` | VARCHAR[] | |
| `mobility` | VARCHAR | `conjugative`, `mobilizable`, `non-mobilizable`, nullable |
| `feature_count` | INTEGER | |

### 5.4 `feature`

| Column | Type | Notes |
|---|---|---|
| `feature_id` | VARCHAR, primary key | §3.4 |
| `genome_id`, `contig_id` | VARCHAR | |
| `start`, `end` | BIGINT | 1-based inclusive |
| `strand` | VARCHAR | `+`, `-`, `?` or `.` as Bakta writes them |
| `type` | VARCHAR | Bakta feature type as the Bakta `.tsv` names it (`cds`, `rRNA`, `tRNA`, `tmRNA`, `ncRNA`, `ncRNA-region`, `crispr`, `crispr-repeat`, `crispr-spacer`, `sorf`, `assembly_gap`, `oriC`, `oriV`, `oriT`) |
| `locus_tag` | VARCHAR | Bakta locus tag, informative only |
| `gene` | VARCHAR | gene symbol, nullable |
| `product` | VARCHAR | |
| `position_index` | INTEGER | rank of the feature on its contig by `start`, starting at 1, with ties broken by `end`, `strand` and `type`; used for neighborhoods |
| `protein_hash` | VARCHAR | first 16 hex characters of SHA-1 over the amino acid sequence for CDS, nullable; used to find identical proteins across genomes |
| `db_xrefs` | VARCHAR[] | Bakta cross-references (UniRef, COG, GO, EC, KEGG) |

Sequences are not stored in this table. Protein and nucleotide sequences are in the per-genome files (§6.3) and, for Tier 2, in the search service.

### 5.5 `annotation_hit`

| Column | Type | Notes |
|---|---|---|
| `hit_id` | VARCHAR, primary key | hash of `feature_id|source_tool|element_name`, or of `genome_id|contig_id|start|end|source_tool|element_name` when `feature_id` is null |
| `feature_id` | VARCHAR, foreign key | the feature the hit belongs to (by locus tag, else by largest overlap on the same contig); null when no feature overlaps the hit |
| `genome_id`, `contig_id` | VARCHAR | denormalized for filtering |
| `start`, `end`, `strand` | BIGINT, BIGINT, VARCHAR | hit coordinates on the contig as the tool reports them, 1-based inclusive |
| `source_tool` | VARCHAR | `amrfinderplus`, `rgi`, `vfdb`, `bakta` |
| `source_db`, `source_db_version` | VARCHAR | |
| `element_name` | VARCHAR | allele or element symbol as the tool reports it (`blaKPC-2`) |
| `element_type` | VARCHAR | `amr`, `stress`, `virulence`, `other` (AMRFinderPlus element type) |
| `element_subtype` | VARCHAR | AMRFinderPlus subtype, nullable |
| `drug_class` | VARCHAR | AMRFinderPlus class or CARD drug class, nullable |
| `drug_subclass` | VARCHAR | nullable |
| `aro_accession` | VARCHAR | CARD ARO term when known, nullable |
| `identity`, `coverage` | FLOAT | percent |
| `method` | VARCHAR | tool method string (`EXACTX`, `BLASTX`, `PARTIALX` and so on) |
| `location_class` | VARCHAR | `chromosome`, `plasmid`, `unclassified`, copied from the contig at release build, with `predicted` in the interface for draft genomes |

### 5.6 `mutation`

| Column | Type | Notes |
|---|---|---|
| `mutation_id` | VARCHAR, primary key | hash of `genome_id|source_tool|gene|variant` |
| `genome_id`, `contig_id` | VARCHAR | |
| `feature_id` | VARCHAR | the feature with the largest overlap with the mutation's coordinates on the same contig; null when none overlaps |
| `source_tool`, `source_db`, `source_db_version` | VARCHAR | `amrfinderplus`, `tbprofiler`, others |
| `gene` | VARCHAR | reference gene symbol; for AMRFinderPlus, the element symbol before its last underscore (`gyrA` in `gyrA_S83I`) |
| `variant` | VARCHAR | as reported (`S83I`, `c.-32T>C`); for AMRFinderPlus, the part of the element symbol after its last underscore (`S83I`, `C-112T`) |
| `variant_type` | VARCHAR | `substitution`, `deletion`, `insertion`, `promoter`, `other`; a variant naming `ins` or `del` is an insertion or deletion, else a variant `<reference><position><alternative>` with a negative position is `promoter`, a longer or shorter alternative is `insertion` or `deletion`, equal lengths are `substitution`, and anything else is `other` |
| `drug_class` | VARCHAR | nullable |
| `start`, `end`, `strand` | BIGINT, BIGINT, VARCHAR | hit coordinates when reported, nullable |
| `confidence` | VARCHAR | tool-specific, nullable |

Point mutations from AMRFinderPlus come from its rows of subtype POINT or POINT_DISRUPT (a mutation that disrupts the gene, such as `ompK35_E24insTer26`). The mutations report also lists wild-type and unknown positions, which are not mutations and are not ingested.

### 5.7 `feature_mapping`

Written only when a previous release exists.

| Column | Type | Notes |
|---|---|---|
| `previous_release` | VARCHAR | |
| `previous_feature_id`, `feature_id` | VARCHAR | `feature_id` null when unmapped |
| `overlap_fraction` | FLOAT | |
| `reason` | VARCHAR | `identical`, `shifted`, `split`, `merged`, `unmapped`, `reassembled` |

### 5.8 `region`

| Column | Type | Notes |
|---|---|---|
| `region_id` | VARCHAR, primary key | hash of `genome_id|contig_id|start|end|source_tool|type` |
| `genome_id`, `contig_id` | VARCHAR | |
| `start`, `end` | BIGINT | |
| `type` | VARCHAR | `prophage`, `plasmid_region`, later `integron`, `ice` |
| `source_tool`, `source_db_version` | VARCHAR | |
| `score` | FLOAT | tool score, nullable |
| `attributes` | JSON | tool-specific fields (taxonomy of the virus, number of hallmark genes) |

### 5.9 `typing`

| Column | Type | Notes |
|---|---|---|
| `genome_id` | VARCHAR | |
| `source_tool`, `tool_version` | VARCHAR | `mlst`, `kleborate`, `sistr`, `sccmec` |
| `key` | VARCHAR | column name as the tool names it (`K_locus`, `serovar`, `type`, `gapA`) |
| `value` | VARCHAR | |
| `display_group` | VARCHAR | `typing`, `virulence`, `resistance_score`, `allele`, used to decide which keys appear as chips on the genome page |

A configuration file `config/typing_display.yaml` lists, per tool, which keys are shown as chips and in which order. Values the tool writes as its missing marker (`-`) are not stored.

### 5.10 `pangenome_species` and `pangenome_cluster`

`pangenome_species`

| Column | Type |
|---|---|
| `species_code` | VARCHAR, primary key |
| `tool`, `tool_version`, `parameters` | VARCHAR, VARCHAR, JSON |
| `genome_count`, `core_count`, `soft_core_count`, `shell_count`, `cloud_count` | INTEGER |
| `computed_date` | DATE |

`pangenome_cluster`

| Column | Type | Notes |
|---|---|---|
| `cluster_id` | VARCHAR, primary key | §3.5 |
| `species_code` | VARCHAR | |
| `cluster_name` | VARCHAR | Panaroo name |
| `annotation` | VARCHAR | Panaroo consensus annotation |
| `genome_count` | INTEGER | |
| `frequency` | FLOAT | fraction of species genomes |
| `class` | VARCHAR | `core`, `soft_core`, `shell`, `cloud` with the Panaroo thresholds |
| `representative_feature_id` | VARCHAR | one member chosen as representative, used by Tier 2 |

### 5.11 `cluster_membership` and `cluster_mapping`

`cluster_membership`: `cluster_id`, `feature_id`, `genome_id`. One row per member feature.

`cluster_mapping`: `previous_release`, `previous_cluster_id`, `cluster_id`, `shared_feature_fraction`, `reason` (`same`, `split`, `merged`, `new`, `retired`).

### 5.12 `tree` and `tree_tip`

`tree`

| Column | Type |
|---|---|
| `tree_id` | VARCHAR, primary key |
| `species_code` | VARCHAR |
| `name`, `description` | VARCHAR |
| `alignment_type` | VARCHAR (`core_genome`, `reference_snp`) |
| `reference_accession` | VARCHAR, nullable |
| `alignment_tool`, `tree_tool`, `tool_version`, `model` | VARCHAR |
| `rooting` | VARCHAR |
| `genome_count` | INTEGER |
| `newick` | VARCHAR |
| `computed_date` | DATE |

`tree_tip`: `tree_id`, `genome_id`. One row per tip, so the phylogeny page can prune to a genome set without parsing the Newick.

### 5.13 `embedding`

As §4.5 with the projection columns always filled (computed at release build or supplied), plus `species_code` denormalized and `projection_source` (`release_build` or `supplied`).

### 5.14 `genome_set` and `genome_set_member`

`genome_set`: `set_id`, `name`, `description`, `kind` (`curated`), `genome_count`, `created_date`. `created_date` is null while `sets.csv` carries no date.

`genome_set_member`: `set_id`, `genome_id`.

User-defined sets are never stored in the catalog; they exist as URL state or as an exported JSON file (§7.5).

### 5.15 `tool_version`

`genome_id`, `tool`, `version`, `database`, `database_version`. One row per tool per genome, read as §4.1 states; the pipeline itself is recorded as tool `mgap`, and a version absent from every source is null. `database` names the database as the tool reports it (for example `Bakta database (full)`) and `database_version` holds its version. There is one row per tool whose output exists for the genome, plus `mgap`. `release build` also writes the distinct set of versions in the manifest so the Methods page can render it without scanning.

### 5.16 `tombstone`

As §4.7.

### 5.17 `access_group` and `genome_group`

As §4.8. `genome_group` may also hold rows for tombstoned genomes (§4.7).

### 5.18 `metadata_extra`

`genome_id`, `key`, `value`. Unrecognized metadata columns.

---

## 6. Release layout

A release is a directory tree on object storage under `releases/<release_id>/`, served to the application through the Pages Function proxy on the same hostname as the application (see the requirements document, hosting section). Per-group releases are the same tree filtered by `genome_group` and written under a group prefix, `releases/<release_id>/<group_id>/`, with the group's manifest. `release build --out releases/<release_id>/ --group <group_id>` writes that prefix, and a full rebuild of `releases/<release_id>/` keeps its group prefixes. A group release holds the genomes of the group, the tombstones whose `genome_group` rows name the group, and the curated sets with members in the group, counted over those members. Its summaries and summary sentences are computed over its own genomes.

### 6.1 Parquet files

| Path | Partitioning | Sort | Row group |
|---|---|---|---|
| `tables/species_registry.parquet` | none | `species_code` | one |
| `tables/genome.parquet` | none | `species_code`, `genome_id` | 50k rows |
| `tables/contig/<species_code>.parquet` | by species | `genome_id`, `contig_index` | 100k rows |
| `tables/feature/<species_code>.parquet` | by species | `genome_id`, `contig_id`, `start` | 100k rows |
| `tables/annotation_hit/<species_code>.parquet` | by species | `genome_id` | 100k rows |
| `tables/mutation.parquet` | none | `genome_id` | 50k rows |
| `tables/region/<species_code>.parquet` | by species | `genome_id` | 100k rows |
| `tables/typing.parquet` | none | `genome_id` | 100k rows |
| `tables/pangenome_species.parquet`, `tables/pangenome_cluster/<species_code>.parquet`, `tables/cluster_membership/<species_code>.parquet` | by species | `cluster_id` | 100k rows |
| `tables/cluster_mapping.parquet`, `tables/feature_mapping.parquet` | none | | |
| `tables/tree.parquet`, `tables/tree_tip.parquet` | none | | |
| `tables/embedding/<model>.parquet` | by model | `genome_id` | one |
| `tables/genome_set.parquet`, `tables/genome_set_member.parquet` | none | | |
| `tables/tool_version.parquet`, `tables/tombstone.parquet`, `tables/metadata_extra.parquet` | none | | |

All files use Zstandard compression and Parquet page statistics so that DuckDB-WASM can prune row groups by `genome_id` and `species_code` from range requests. Nothing in the application scans `feature` across species.

### 6.2 Precomputed summaries

Small Parquet files that every collection-page view reads instead of aggregating.

| Path | Grain |
|---|---|
| `summaries/counts_by_species.parquet` | species |
| `summaries/counts_by_species_year.parquet` | species × isolation year |
| `summaries/counts_by_species_st.parquet` | species × ST |
| `summaries/counts_by_source.parquet` | species × source type × country |
| `summaries/counts_by_platform.parquet` | species × platform × assembly status |
| `summaries/amr_class_by_species.parquet` | species × drug class, count and fraction of genomes with at least one hit |
| `summaries/qc.parquet` | genome_id, completeness, contamination, flag (one row per genome; small) |
| `presence/<species_code>.parquet` | genome_id × cluster_id, wide, boolean columns, one file per species |
| `presence_amr.parquet` | genome_id × element_name, wide, boolean, across all species |
| `presence_mob.parquet` | genome_id × mob_cluster_id, wide, boolean |
| `summaries/search_index.parquet` | one row per searchable term: `term`, `kind` (`genome_id`, `accession`, `gene`, `element`, `cluster`, `product`, `st`), `target` (route), `species_code`, `count`; feeds the global search box |
| `summaries/rarefaction/<species_code>.parquet` | genomes sampled × core and pan cluster counts (mean and interval over permutations), precomputed at release build for the pangenome page |

The wide presence files answer "all genomes carrying X" as a column read. Column count in `presence_amr.parquet` is the number of distinct elements in the collection, in the low thousands, which Parquet handles.

Columns of the summary files. Counts are INTEGER, and each file is sorted by its leading columns.

| Path | Columns |
|---|---|
| `summaries/counts_by_species.parquet` | `species_code`, `canonical_name`, `color`, `genome_count`, `complete_count` (genomes with `assembly_status` complete), `st_count` (distinct STs), `amr_hit_count` (sum of `genome.amr_gene_count`), `plasmid_contig_count` |
| `summaries/counts_by_species_year.parquet` | `species_code`, `year` (INTEGER, null when the genome has no isolation date), `genome_count` |
| `summaries/counts_by_species_st.parquet` | `species_code`, `mlst_scheme`, `st`, `genome_count` |
| `summaries/counts_by_source.parquet` | `species_code`, `source_type`, `country`, `genome_count` |
| `summaries/counts_by_platform.parquet` | `species_code`, `platform`, `assembly_status`, `genome_count` |
| `summaries/amr_class_by_species.parquet` | `species_code`, `drug_class`, `genome_count` (genomes of the species with at least one hit in the class), `fraction` (DOUBLE, `genome_count` over the species' genomes), `hit_count` |
| `summaries/qc.parquet` | `genome_id`, `species_code`, `completeness`, `contamination`, `flag` |
| `presence_amr.parquet`, `presence_mob.parquet` | `genome_id`, `species_code`, then one BOOLEAN column per `element_name` or `mob_cluster_id`, sorted by name |
| `summaries/search_index.parquet` | `term`, `kind`, `target`, `species_code`, `count` |

`drug_class` in `amr_class_by_species` is the key of a drug class in `config/palette.yaml`, reached through the palette's match lists (a tool class such as `LINCOSAMIDE/MACROLIDE` is split on `/`), and `other` when no list matches. The resistance hits counted there, in `amr_hit_count` and in `presence_amr` are those of `genome.amr_gene_count`. `flag` in `qc` is `pass` when completeness is at least `qc.completeness_min` and contamination at most `qc.contamination_max` in `config/platform.yaml`, `fail` otherwise, and `missing` for a genome without CheckM2 values.

The search index has one row per term and species, and `count` is the number of genomes of that species carrying the term. Targets are routes of the requirements document (§5.3), with path segments and query values percent-encoded.

| `kind` | `term` | `target` |
|---|---|---|
| `genome_id` | the genome identifier | `/genomes/<genome_id>` |
| `accession` | a BioSample or assembly accession | `/genomes/<genome_id>` |
| `gene` | a Bakta gene symbol | `/genes/symbol/<gene>` |
| `element` | an `annotation_hit.element_name` | `/genes/element/<element_name>` |
| `st` | `ST` followed by the value when it is all digits, else the value as given (`ST258-1LV`) | `/?q=<filter JSON>` with `species_code` and the raw `genome.st`, as `{"species_code":["KPN"],"st":["258"]}` |
| `product` | a Bakta product | `/genes?search=<product>` |
| `cluster` | a pangenome cluster name (from milestone 4) | `/genes/cluster/<cluster_id>` |

### 6.3 Per-genome files

Under `genomes/<species_code>/<genome_id>/`.

| File | Content |
|---|---|
| `cgview.json` | CGView.js map JSON with all tracks (§7.1), one map per contig plus one multi-contig map |
| `genome.gbff.gz` | Bakta GenBank |
| `genome.gff3.gz` | Bakta GFF3 |
| `genome.fna.gz` | assembly |
| `proteins.faa.gz` | Bakta proteins |
| `features.parquet` | this genome's rows of `feature`, `annotation_hit`, `mutation`, `region` joined for the genome page, so the page opens with one small read |

The compressed files are written with gzip without a timestamp or a file name, so a rebuild gives the same bytes.

`features.parquet` is one table in which each row carries a `record` column (`feature`, `annotation_hit`, `mutation` or `region`) followed by the union of the four tables' columns, null where the row's table has no such column. Columns shared by name hold the value of the row's own table, so `type` is the feature type on a feature row and the region type on a region row, and `gene` is the Bakta symbol on a feature row and the reference gene on a mutation row. Rows are sorted by `record`, `contig_id` and `start`.

`cgview.json` is one object, `{"format": "catalejo-cgview", "format_version": 1, "genome": <map>, "contigs": {"<contig_id>": <map>, ...}}`, where `genome` is the multi-contig map and each entry of `contigs` is the map of one contig. Every map is a document the pinned CGView.js loads with `io.loadJSON`, `{"cgview": {...}}` (§7.1). Object keys are written sorted, so the contig order is that of `genome.cgview.sequence.contigs`.

### 6.4 Manifest

`manifest.json` at the release root and at each group prefix.

```json
{
  "schema_version": "0.1.0",
  "release_id": "2026-09",
  "group_id": null,
  "created": "2026-09-25T18:00:00Z",
  "platform_name": "Catalejo",
  "pipeline": {"name": "gene2dis/mgap", "versions": ["2.0.0"]},
  "genome_count": 4812,
  "species": [{"species_code": "KPN", "canonical_name": "Klebsiella pneumoniae", "genome_count": 1638, "has_pangenome": true, "tree_ids": ["KPN-core-2026-09"]}],
  "tool_versions": [{"tool": "bakta", "versions": ["1.11.0"], "database_versions": ["5.1"]}],
  "embedding_models": [{"model": "bacformer", "model_version": "1.0", "dim": 1024, "genome_count": 4812}],
  "curated_sets": [{"set_id": "carbapenemase-2024", "name": "Carbapenemase carriers 2024", "genome_count": 612}],
  "files": [{"path": "tables/genome.parquet", "bytes": 1234567, "sha256": "..."}],
  "previous_release": "2026-06",
  "release_notes": "releases/2026-09/NOTES.md",
  "checks": {"validated": true, "validated_at": "2026-09-25T17:40:00Z", "warnings": 3}
}
```

`pipeline` names the workflow that produced the genomes and the distinct versions recorded for them in `tool_version` (tool `mgap`), for the release footer and the Methods page; `versions` is empty when no run recorded one.

The application reads only the manifest at startup and opens tables on demand.

---

## 7. Precomputed products

### 7.1 CGView JSON

Generated per contig and as one multi-contig map with dividers. Tracks, in order from the outside in, with their colors from `config/palette.yaml`.

1. CDS forward, CDS reverse (gray tones)
2. Other features (rRNA, tRNA, CRISPR)
3. Resistance determinants, colored by drug class
4. Virulence factors
5. Regions (prophage, plasmid region)
6. GC content
7. GC skew

Each feature carries `feature_id` in its metadata so a click resolves to the feature table; a resistance hit or region that overlaps no feature carries `hit_id`, `mutation_id` or `region_id` instead. Map JSON is validated against the CGView.js schema version pinned in `packages/web`, by a test that loads every map of a fixture in that version.

Maps declare contigs by name and length, without sequence. GC content (the fraction of G and C, with the genome's mean as baseline) and GC skew ((G - C) / (G + C), with baseline 0) are precomputed in windows of 1,000 bases, at positions counted along the whole map. Every color, including the background, the backbone, the rules between tracks and the text, comes from `config/palette.yaml`, and in the multi-contig map the backbone alternates two shades so that each contig boundary is visible. Legend items for drug classes are named by the palette key and labeled by the application from its strings.

### 7.2 Neighborhoods

Computed on the fly by the application from `position_index` in `feature`, with a default window of eight features on each side. No precomputation.

### 7.3 Cross-genome neighborhood comparison

The Genes page aligns neighborhoods across a genome set by matching flanking features through `cluster_id` within a species and through `protein_hash` across species. Computed in the browser for sets up to a configured size (default 200 genomes), above which the page asks the user to narrow the set.

### 7.4 Summary sentence

`genome.summary_sentence` is generated at release build from a template set in `config/summary_templates.yaml`, chosen by which facts exist. Templates reference columns only; no free text is generated. Example for the full case.

> A {resistance_phrase} {st} isolate from {isolation_site}, collected in {year}, with {completeness}% completeness and {contamination}% contamination. It carries {top_determinant} on a {plasmid_size} {replicon} plasmid together with {n_other} other resistance determinants{mutation_clause}, and belongs to a group of {cluster_size} {st} genomes in this release.

Fallback templates cover genomes with no plasmid, no resistance determinants, no ST, or a draft assembly. `resistance_phrase` is derived from rules in the same file (for example, any carbapenemase element yields "carbapenem-resistant"), and those rules are shown on the Methods page. Every standalone article "A" or "a" in the sentence takes "An" or "an" when the next word begins with a vowel sound (ESBL, ST, or a number read with a vowel sound such as 8, 11 or 18 kb); the rule lives in `config/summary_templates.yaml` with the templates.

### 7.5 Genome set exchange format

A user-defined set is exported as JSON.

```json
{"format": "genome-set", "format_version": 1, "release_id": "2026-09", "name": "my set", "filters": {"species_code": ["KPN"], "st": ["ST258"], "presence_amr": ["blaKPC-2"]}, "genome_ids": ["SCL0421", "SCL0433"]}
```

Both `filters` and `genome_ids` are present. On load in a later release the application applies `filters` and reports how many of `genome_ids` are still present, so the user can see what changed.

---

## 8. Ingestion commands

The package installs one command, `catalejo`. All commands read `config/platform.yaml` and `config/species_registry.yaml`.

### 8.1 Metadata

```
catalejo metadata init --mgap results/ --out metadata.csv [--existing metadata.csv]
catalejo metadata validate metadata.csv [--mgap results/]
```

`metadata init` lists every sample directory that holds a Bakta directory and fills `genome_id` (from `sample_name_rules`), `mgap_sample` and `platform`. It never fills `species`, which would then always win over the tool assignment of §3.3. With `--existing`, every non-empty cell of the existing file wins, rows are matched by `mgap_sample` (else `genome_id`), and unrecognized columns and rows of samples no longer present are kept. With `--mgap`, `metadata validate` also checks that every `mgap_sample` exists in the results.

### 8.2 Ingestion and external products

```
catalejo ingest --mgap results/ --metadata metadata.csv --catalog catalog/2026-09.duckdb
catalejo pangenome ingest --dir pangenomes/KPN/ --catalog ...
catalejo pangenome map --previous catalog/2026-06.duckdb --catalog ...
catalejo tree ingest --dir trees/KPN-core/ --catalog ...
catalejo embeddings ingest --file embeddings/bacformer.parquet --catalog ...
catalejo sets ingest --file sets.csv --catalog ...
catalejo tombstones ingest --file tombstones.csv --catalog ...
catalejo groups ingest --groups groups.csv --members genome_groups.csv --catalog ...
```

`ingest` is idempotent per genome; re-running with the same inputs produces the same catalog. It refuses to write a catalog when the metadata table or the mgap results break a rule of §9. `tombstones ingest` runs before `groups ingest`, so that the group rows of a tombstoned genome are kept, and `sets ingest` runs at any point after `ingest`.

### 8.3 Release

```
catalejo release check --catalog ... [--metadata metadata.csv --mgap results/] [--release releases/2026-09/]   # validation, §9
catalejo release build --catalog ... --out releases/2026-09/ [--group <group_id>]
catalejo release notes --catalog ... --previous catalog/2026-06.duckdb   # generated NOTES.md, edited by hand afterwards
catalejo release publish --dir releases/2026-09/ --bucket <bucket> [--group <group_id>]
```

### 8.4 Two workflows

Data releases and application deployments are separate GitHub Actions workflows.

- `release.yml`, triggered manually with `release_id` and optional group, runs `release check`, `release build` and `release publish`, then updates the pointer file `releases/current.json` per group.
- `deploy.yml`, triggered on a tag of `packages/web`, builds the application and deploys each Pages project. The application declares its supported `schema_version` range; the workflow reads the current manifest for each project and fails the deployment if the range excludes it.

### 8.5 Synthetic release

```
catalejo synth --species 10 --genomes 100 --out data/synth
```

Produces an mgap-shaped results directory with planted resistance determinants, plasmids, prophages and mutations, at least one species without an MLST scheme, the side tables of §4.6 to §4.8 beside it, and, once the corresponding milestones exist, a pangenome directory and a tree per species and an embedding file. It replaces an existing output directory. The application's tests and the critic agent run against a release built from it.

---

## 9. Validation rules

`release check` fails on any of the following and reports warnings for the rest. Rules on the metadata table and the mgap results are enforced by `metadata validate` and `ingest`, and `release check` repeats them when given `--metadata` and `--mgap`. The manifest checksum rule runs when it is given `--release`, for the release and its group prefixes.

Failures

- A `genome_id` that does not match the configured pattern, that equals another `genome_id` without regard to case, or that appears in both `genome` and `tombstone`.
- A metadata `mgap_sample` absent from the mgap results, or one `mgap_sample` mapped by two genomes.
- A species in `species_registry` whose `color_index` is shared with another species or lies outside the palette's species sequence.
- A genome whose species is absent from `species_registry`.
- A genome with no access group.
- A feature with `end` beyond the contig length, or `start` greater than `end`.
- An `annotation_hit`, `mutation`, `region` or `cluster_membership` row referencing a `feature_id` or `genome_id` that does not exist. A null `feature_id` in `annotation_hit` or `mutation` is not a reference.
- A tree tip that is not a `genome_id` in the release.
- A pangenome directory whose genome columns include a `genome_id` not in the release.
- A manifest file entry whose checksum does not match.
- A metadata date that does not parse, or a `source_type`, `platform` or `country` outside its vocabulary.

Warnings

- Species assigned from MLST scheme only.
- `species_conflict` true.
- Genome set mixes more than one Bakta or AMRFinderPlus database version (reported per species).
- A species marked `pangenome_eligible` with no pangenome or tree in the release.
- Genomes with no embedding when an embedding model is present.
- A curated set with fewer than two members.
- A `genome_group` row naming a genome that is in neither `genome` nor `tombstone`.

---

## 10. Open items

- Whether VFDB hits come from Bakta cross-references or from a dedicated run; the `annotation_hit` table accepts either.
- Tier 2 tables (protein index, vector index over cluster representatives) will be added as §5.19 onward without changing existing tables.
- The synthetic generator (§8.5) takes species identities from `config/species_registry.yaml`, so synthetic genomes and the registry cannot disagree.

### Contig classification without MOB-suite

MOB-suite is optional in mgap. When it was not run, `contig.classification` is derived from geNomad: a contig is `plasmid` when geNomad plasmid regions cover more than half of its length, `chromosome` when it is the longest contig of a complete assembly and carries no such region, and `unclassified` otherwise. `mob_cluster_id`, `replicon_types`, `relaxase_types` and `mobility` are null, `contig.classification_source` records `genomad`, and the interface shows "predicted by geNomad" next to the location.