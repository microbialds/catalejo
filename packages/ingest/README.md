# catalejo-ingest

The ingestion package of Catalejo Genómico. It installs the `catalejo` command, which parses mgap results into the master catalog, builds releases from it, and writes the synthetic data the tests and the critic run against. The data it reads and writes is defined in [docs/data-contract.md](../../docs/data-contract.md).

## Installation

uv installs Python 3.13 on first use, so no system Python is needed. From the repository root, run the following.

```
uv sync --project packages/ingest
uv run --project packages/ingest catalejo --help
```

## Command reference

Every command of contract §8 exists. The commands of the Tier 0 pipeline are implemented as of milestone 1a, and each of the others prints `not implemented until milestone <N>` to standard error and exits with code 2, so that a script calling it fails. An implemented command prints what it did and exits with code 1 on any validation failure. The descriptions below are copied from the command's help.

| Command | Help text | Milestone |
|---|---|---|
| `catalejo synth` | Write a synthetic mgap results directory and its side tables (contract §8.5). | implemented |
| `catalejo metadata init` | Write metadata.csv from mgap results, keeping manual entries (contract §4.2, §8.1). | implemented |
| `catalejo metadata validate` | Validate metadata.csv against contract §4.2 and the input rules of §9. | implemented |
| `catalejo ingest` | Build the master catalog from mgap results and metadata (contract §5, §8.2). | implemented |
| `catalejo groups ingest` | Ingest access groups and their members into the catalog (contract §4.8, §5.17). | implemented |
| `catalejo tombstones ingest` | Ingest tombstones and remove those genomes from the catalog (contract §4.7, §5.16). | implemented |
| `catalejo sets ingest` | Ingest curated genome sets into the catalog (contract §4.6, §5.14). | implemented |
| `catalejo release check` | Validate the catalog against contract §9; exit 1 on any failure. | implemented |
| `catalejo release build` | Build the release layout of contract §6 from the catalog. | implemented |
| `catalejo pangenome ingest` | Ingest a Panaroo pangenome directory. | 4a |
| `catalejo pangenome map` | Map pangenome clusters to the previous release (§3.5). | 4a |
| `catalejo tree ingest` | Ingest a tree directory. | 4a |
| `catalejo release notes` | Generate NOTES.md against the previous release. | 5 |
| `catalejo release publish` | Upload a release to object storage. | 5 |
| `catalejo embeddings ingest` | Ingest an embedding file. | 6 |

The Tier 0 sequence, as CI runs it on the synthetic data, reads as follows.

```
catalejo synth --species 10 --genomes 100 --out data/synth
catalejo metadata init --mgap data/synth/results --existing data/synth/metadata.csv --out data/synth/metadata.csv
catalejo ingest --mgap data/synth/results --metadata data/synth/metadata.csv --catalog data/catalog/synth.duckdb
catalejo groups ingest --groups data/synth/groups.csv --members data/synth/genome_groups.csv --catalog data/catalog/synth.duckdb
catalejo tombstones ingest --file data/synth/tombstones.csv --catalog data/catalog/synth.duckdb
catalejo sets ingest --file data/synth/sets.csv --catalog data/catalog/synth.duckdb
catalejo release check --catalog data/catalog/synth.duckdb --metadata data/synth/metadata.csv --mgap data/synth/results
catalejo release build --catalog data/catalog/synth.duckdb --out releases/synth
catalejo release check --catalog data/catalog/synth.duckdb --release releases/synth
```

On the default synthetic data the sequence takes about 12 seconds after `synth`, of which `ingest` takes 7 and `release build` 2. The catalog is 7.5 MB with 17 MB of per-genome files beside it, and the release is 32 MB in 660 files. `release check` passes with 28 warnings, which are the planted ones (species assigned from the MLST scheme only, one species conflict, mixed Bakta and AMRFinderPlus database versions in *Salmonella enterica*, pangenome-eligible species without a pangenome or tree, and a curated set of one genome).

`catalejo --version` prints the package version. The help of `synth` reads as follows.

```
 Usage: catalejo synth [OPTIONS]

 Write a synthetic mgap results directory and its side tables (contract §8.5).

╭─ Options ──────────────────────────────────────────────────────────────────────────────╮
│ *  --out            <path>              Output directory, replaced if it exists.       │
│                                         [required]                                     │
│    --species        <int range> [x>=1]  Number of species (1 to 10). [default: 3]      │
│    --genomes        <int range> [x>=1]  Number of genomes. [default: 60]               │
│    --seed           <int>               Random seed. [default: 42]                     │
│    --help                               Show this message and exit.                    │
╰────────────────────────────────────────────────────────────────────────────────────────╯
```

## Synthetic data

```
uv run --project packages/ingest catalejo synth --out data/synth
```

With the defaults (10 species, 100 genomes, seed 42) the command writes 100 genomes in about 4,100 files and 101 MB, in about 15 seconds. The counts are deliberately uneven, so that the collection page has small species to group as Other: *Klebsiella pneumoniae* (KPN, 28 genomes), *Salmonella enterica* (SEN, 19), *Staphylococcus aureus* (SAU, 14), *Serratia marcescens* (SMA, 9), *Escherichia coli* (ECO, 8), *Pseudomonas aeruginosa* (PAE, 6), *Acinetobacter baumannii* (ABA, 5), *Enterococcus faecium* (EFM, 4), *Streptococcus pneumoniae* (SPN, 4) and *Enterobacter hormaechei* (EHO, 3). More than eight species and one species without an MLST scheme (*Serratia marcescens*) let checklist items C7 and C8 run on the default data. The first genome of each species is complete and follows the nanopore layout, and the other 90 are Illumina drafts. A smaller run such as `--species 3 --genomes 12` is enough for quick checks. The output directory holds the following.

```
data/synth/
  .catalejo-synth          marker of a synth run
  results/                 the mgap-shaped results directory, passed to later commands as --mgap
    <sample>/                          the genome_id, or ont_KPN0001 with file stems ont_KPN0001_
    <sample>/assemblies/               SPAdes files for drafts, autocycler/ and dnaapler/ for
                                       complete genomes
    <sample>/annotation/<tool>/        amrfinder, bakta, checkm2, genomad, mlst, the optional rgi
                                       and mobsuite, and kleborate, sistr or sccmec by species
    <sample>/qc/quast/
    <sample>/read_processing/<tool>/   kraken2, with fastp and bracken for drafts or fastplong
                                       for complete genomes
    gtdbtk/gtdbtk.bac120.summary.tsv
    pipeline_info/software_versions.yml
  metadata.csv             contract §4.2, with the mgap_sample column
  sets.csv                 contract §4.6
  tombstones.csv           contract §4.7
  groups.csv               contract §4.8
  genome_groups.csv        contract §4.8
  synth_manifest.json      every planted item and the genomes carrying it, for tests
```

The planted content covers the acceptance items of the requirements, among them resistance determinants and point mutations, a carbapenemase plasmid shared across genomes, prophage and plasmid regions, complete and draft genomes, a complete genome whose mgap sample name differs from its genome_id, mixed annotation versions, species conflicts and genomes with RGI and MOB-suite output next to genomes without them.

The same arguments always produce byte-identical files, because every decision draws from a generator seeded by the run seed and the genome identifier and the gzip members carry no timestamp. `--out` must lie inside the repository or the system temporary directory. An existing output directory is replaced only when it is empty or holds the `.catalejo-synth` marker of an earlier run, and any other directory is refused with exit code 2. The marker is written first, so the output of an interrupted run can still be replaced.

## Expected mgap layout

[src/ingest/mgap_layout.py](src/ingest/mgap_layout.py) is the single definition of every mgap path and column name. The parsers in `src/ingest/parsers/` and the synthetic generator both import it, and a test fails if either spells an mgap path or column itself. The layout was derived from two real mgap 2.0.0 runs, an Illumina run with two SPAdes draft genomes and a nanopore run with one complete genome assembled by Autocycler and reoriented by Dnaapler.

Path templates use two placeholders, `{sample}` for the per-genome directory of the results and `{prefix}` for the stem of most tool files, which `resolve_prefix()` discovers from the Bakta summary because a nanopore sample such as `ont_SCL30014` names its files `ont_SCL30014_`. `detect_platform()` tells a nanopore genome from an Illumina one by its assembly directory, and `parse_fna_header()` reads topology and completeness from the Bakta `.fna` headers on both platforms. RGI, MOB-suite and Bracken are optional modules that a run may skip.

Entries that neither run confirms follow the documented output of each tool until an mgap run confirms them. They are GTDB-Tk, SISTR, sccmec and the per-genome AMRFinderPlus versions file, whose paths are marked `provisional=True`, together with the Bakta mappings of CRISPR arrays and the process names of the nanopore modules. `CONTRACT_DIFFERENCES` in the same module records where the two runs disagree with contract §4.1.

The tests that compare the module against the two runs read `data/mgap-example/` and `data/ont_example/`, which exist only on the maintainer's machine, and are skipped elsewhere.

## Metadata, catalog and releases

`metadata init` lists the sample directories of an mgap results directory, proposes a genome_id for each with the `sample_name_rules` of [config/platform.yaml](../../config/platform.yaml) (`ont_SCL30014` becomes SCL30014), and fills `mgap_sample` and `platform`. It never fills `species`, because a filled value would always win over the tools and hide their conflicts. With `--existing` every non-empty cell of the existing file wins, unrecognized columns are kept, and rows for samples no longer in the results are kept with a warning. `metadata validate` applies the rules of contract §4.2 and the input rules of §9, and with `--mgap` it also checks that every `mgap_sample` exists in the results and is mapped by one genome only.

`ingest` validates the metadata, parses every mgap module of contract §4.1 with the parsers in `src/ingest/parsers/`, joins each genome's output into catalog rows (`src/ingest/assemble.py`), assigns the species by the precedence of §3.3 and writes every table of §5 in one transaction into a new file that then replaces `catalog/<release_id>.duckdb`. The release_id is the file stem (`YYYY-MM` with an optional letter, or `synth`). The Bakta GenBank, GFF3, FASTA and protein files of each genome are copied, gzip-compressed, to `<release_id>.files/` beside the catalog, because the release needs them and the catalog holds no sequences. Counters and summary sentences are computed from the catalog by `src/ingest/summary.py` with the templates of `config/summary_templates.yaml`. Re-running `ingest` with the same inputs gives the same catalog, and access groups, tombstones and curated sets already in the catalog are carried over.

`release check` runs one function per rule of contract §9 (`src/ingest/validate.py`), repeats the input rules when given `--metadata` and `--mgap`, and checks the manifest checksums of a built release and of its group releases when given `--release`. `release build` refuses a catalog that fails the check and writes the tables, summaries, per-genome files, CGView maps and manifest of contract §6 and §7 (`src/ingest/release/`). With `--group` it writes the release of one access group under `<out>/<group_id>/`. It replaces its output only when that holds a `.catalejo-release` marker or is empty, and two builds of the same catalog are byte-identical except for the two timestamps of the manifest, which `SOURCE_DATE_EPOCH` fixes.

The genome_id pattern in `config/platform.yaml` is open by default, as contract 0.7 §3.1 states. Any identifier made of letters, digits, dots, underscores and hyphens, starting with a letter or digit and at most 64 characters long, is accepted, so identifiers received with isolates such as `SP10` pass unchanged. A group may tighten the pattern. Identifiers must also be unique without regard to case, which `metadata validate` and `release check` enforce.

Pangenomes and trees arrive with milestone 4a, embeddings with milestone 6, and `release notes` and `release publish` with milestone 5.

## Configuration

The package reads the files in [config/](../../config) through `src/ingest/config.py`, which validates `platform.yaml`, `palette.yaml`, `design-tokens.yaml`, `versions.yaml`, `typing_display.yaml`, `summary_templates.yaml`, `export-presets.yaml` and `species_registry.yaml`, and checks that every color in the design tokens resolves in the palette.

[config/species_registry.yaml](../../config/species_registry.yaml) is the species registry of contract 0.7 §4.9. It gives each species its code, canonical name, GTDB name, NCBI taxid, aliases, MLST schemes and a `color_index` into the species sequence of the palette, and validation refuses a code, color index, name or MLST scheme used by two species and an index outside the palette. The color indices freeze at the first real release, so the maintainer should reorder them before then if the collection's main species differ from the three synthetic defaults at the top. `synth` takes every species code, name and MLST scheme from this file and keeps only its generation parameters in `src/ingest/synth/catalog.py`, so the synthetic genomes and the registry cannot disagree (contract 0.7 §10). At milestone 0 `synth` reads `summary_templates.yaml` to record the expected resistance phrases in `synth_manifest.json`, and the tests load every file. The configuration directory is `config/` at the repository root unless the environment variable `CATALEJO_CONFIG_DIR` points elsewhere.

## DuckDB pin and the cross-read test

DuckDB Python is pinned to 1.4.5, on the same engine minor version (1.4) as the `@duckdb/duckdb-wasm` package the application uses, and [config/versions.yaml](../../config/versions.yaml) records both. The cross-read test writes [tests/fixtures/crossread.parquet](../../tests/fixtures/crossread.parquet) and `crossread.expected.json` beside it with DuckDB Python, one column per type the contract uses, and the web package reads the same file with DuckDB-WASM and compares every value. Both files are committed, and CI fails when the test changes them. In the same way `tests/test_release.py` regenerates [tests/fixtures/cgview.json](../../tests/fixtures/cgview.json), the map of one small synthetic genome, which the web package loads into CGView.js.

## Tests and checks

From the repository root, run the following.

```
uv run --project packages/ingest pytest
uv run --project packages/ingest ruff check .
uv run --project packages/ingest pyright
```

The default-size synthetic run is marked `slow`, and `-m "not slow"` leaves it out.
