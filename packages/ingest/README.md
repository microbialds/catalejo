# catalejo-ingest

The ingestion package of Catalejo Genómico. It installs the `catalejo` command, which will parse mgap results into the master catalog and build releases, and which at milestone 0 writes the synthetic data the tests and the critic run against. The data it reads and writes is defined in [docs/data-contract.md](../../docs/data-contract.md).

## Installation

uv installs Python 3.13 on first use, so no system Python is needed. From the repository root, run the following.

```
uv sync --project packages/ingest
uv run --project packages/ingest catalejo --help
```

## Command reference

Every command of contract §8 exists. Only `synth` is implemented at milestone 0, and each of the others prints `not implemented until milestone <N>` to standard error and exits with code 2, so that a script calling it fails. The descriptions below are copied from the command's help, with the closing sentence "Not implemented until milestone N." of each stub moved to the last column.

| Command | Help text | Milestone |
|---|---|---|
| `catalejo synth` | Write a synthetic mgap results directory and its side tables (contract §8.5). | implemented |
| `catalejo metadata init` | Write metadata.csv from mgap results. | 1a |
| `catalejo metadata validate` | Validate metadata.csv against contract §4.2. | 1a |
| `catalejo ingest` | Build the master catalog from mgap results. | 1a |
| `catalejo sets ingest` | Ingest curated genome sets. | 1a |
| `catalejo groups ingest` | Ingest access groups and their members. | 1a |
| `catalejo tombstones ingest` | Ingest tombstones. | 1a |
| `catalejo release check` | Validate the catalog against contract §9. | 1a |
| `catalejo release build` | Build the release layout of contract §6. | 1a |
| `catalejo pangenome ingest` | Ingest a Panaroo pangenome directory. | 4a |
| `catalejo pangenome map` | Map pangenome clusters to the previous release (§3.5). | 4a |
| `catalejo tree ingest` | Ingest a tree directory. | 4a |
| `catalejo release notes` | Generate NOTES.md against the previous release. | 5 |
| `catalejo release publish` | Upload a release to object storage. | 5 |
| `catalejo embeddings ingest` | Ingest an embedding file. | 6 |

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

The stubs already accept the options of contract §8, as the help of `release build` shows.

```
 Usage: catalejo release build [OPTIONS]

 Build the release layout of contract §6. Not implemented until milestone 1a.

╭─ Options ──────────────────────────────────────────────────────────────────────────────╮
│ *  --catalog        <path>  Master catalog DuckDB file. [required]                     │
│ *  --out            <path>  Release directory to write. [required]                     │
│    --group          <str>   Build the release of one access group.                     │
│    --help                   Show this message and exit.                                │
╰────────────────────────────────────────────────────────────────────────────────────────╯
```

## Synthetic data

```
uv run --project packages/ingest catalejo synth --out data/synth
```

With the defaults (3 species, 60 genomes, seed 42) the command writes 60 genomes of *Klebsiella pneumoniae* (KPN, 28 genomes), *Salmonella enterica* (SEN, 18) and *Staphylococcus aureus* (SAU, 14), in about 1,500 files and 45 MB. The output directory holds the following.

```
data/synth/
  .catalejo-synth          marker of a synth run
  results/                 the mgap-shaped results directory, passed to later commands as --mgap
    <genome_id>/assemblies/            SPAdes drafts, or Flye and Dnaapler for complete genomes
    <genome_id>/annotation/<tool>/     amrfinder, bakta, checkm2, genomad, mlst, rgi, mobsuite,
                                       and kleborate, sistr or sccmec according to species
    <genome_id>/qc/quast/
    <genome_id>/read_processing/       bracken, kraken2
    gtdbtk/gtdbtk.bac120.summary.tsv
    pipeline_info/software_versions.yml
  metadata.csv             contract §4.2
  sets.csv                 contract §4.6
  tombstones.csv           contract §4.7
  groups.csv               contract §4.8
  genome_groups.csv        contract §4.8
  synth_manifest.json      every planted item and the genomes carrying it, for tests
```

The planted content covers the acceptance items of the requirements, among them resistance determinants and point mutations, a carbapenemase plasmid shared across genomes, prophage and plasmid regions, complete and draft genomes, mixed annotation versions, species conflicts and genomes with MOB-suite output next to genomes without it.

The same arguments always produce byte-identical files, because every decision draws from a generator seeded by the run seed and the genome identifier and the gzip members carry no timestamp. `--out` must lie inside the repository or the system temporary directory. An existing output directory is replaced only when it is empty or holds the `.catalejo-synth` marker of an earlier run, and any other directory is refused with exit code 2. The marker is written first, so the output of an interrupted run can still be replaced.

## Expected mgap layout

[src/ingest/mgap_layout.py](src/ingest/mgap_layout.py) is the single definition of every mgap path and column name. The parsers (milestone 1a, in `src/ingest/parsers/`) and the synthetic generator both import it, and a test fails if either spells an mgap path or column itself. The layout was derived from a real mgap 2.0.0 results directory with two Illumina SPAdes draft genomes. Entries for tools absent from that example, such as the long-read assemblers, SISTR, sccmec and GTDB-Tk, are marked `provisional=True` and follow the documented output names of each tool until an mgap run confirms them. `CONTRACT_DIFFERENCES` in the same module records where the example disagrees with contract §4.1.

The tests that compare the module against the example read `data/mgap-example/`, which exists only on the maintainer's machine, and are skipped elsewhere.

## Metadata, external inputs and releases

The metadata table and the `metadata` commands arrive in milestone 1a, as defined in [contract §4.2 and §8.1](../../docs/data-contract.md#42-metadata-table).

The external inputs of [contract §4.3 to §4.8](../../docs/data-contract.md#43-pangenome-inputs) arrive with milestones 1a for curated sets, tombstones and access groups, 4a for pangenomes and trees, and 6 for embeddings.

The release procedure of [contract §8.3](../../docs/data-contract.md#83-release) arrives in milestone 1a for `release check` and `release build` and in milestone 5 for `release notes` and `release publish`.

## Configuration

The package reads the files in [config/](../../config) through `src/ingest/config.py`, which validates `platform.yaml`, `palette.yaml`, `design-tokens.yaml`, `versions.yaml`, `typing_display.yaml`, `summary_templates.yaml` and `export-presets.yaml`, and checks that every color in the design tokens resolves in the palette. At milestone 0 `synth` reads `summary_templates.yaml` to record the expected resistance phrases in `synth_manifest.json`, and the tests load every file. The configuration directory is `config/` at the repository root unless the environment variable `CATALEJO_CONFIG_DIR` points elsewhere.

## DuckDB pin and the cross-read test

DuckDB Python is pinned to 1.4.5, on the same engine minor version (1.4) as the `@duckdb/duckdb-wasm` package the application uses, and [config/versions.yaml](../../config/versions.yaml) records both. The cross-read test writes [tests/fixtures/crossread.parquet](../../tests/fixtures/crossread.parquet) and `crossread.expected.json` beside it with DuckDB Python, one column per type the contract uses, and the web package reads the same file with DuckDB-WASM and compares every value. Both files are committed, and CI fails when the test changes them.

## Tests and checks

From the repository root, run the following.

```
uv run --project packages/ingest pytest
uv run --project packages/ingest ruff check .
uv run --project packages/ingest pyright
```

The default-size synthetic run is marked `slow`, and `-m "not slow"` leaves it out.
