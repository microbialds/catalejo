# Catalejo

Catalejo Genómico is a web platform for looking at a curated collection of microbial genomes produced by the mgap pipeline, with their annotation, resistance determinants, mobile elements, typing results, pangenomes, phylogenies and, later, embeddings. The name means a genomic spyglass. The platform is called Catalejo Genómico in prose and citations and Catalejo in the interface, while the repository, the ingestion package and its command are `catalejo`, without the accent.

Researchers, clinical microbiologists and students read the collection through a static application that opens each release directly in the browser, and a single maintaining group produces the releases with the `catalejo` command.

A screenshot of the Collection page will be added with milestone 1b, when that page first exists.

## Tiers

| Tier | Content | Server needed |
|---|---|---|
| 0 | All pages except Embeddings and Sequence search, on data from mgap, pangenomes and trees | No |
| 1 | Embeddings page and "similar genomes" on the genome page, from genome-level embeddings shipped in the release | No |
| 2 | Sequence search (alignment over cluster representatives, then protein-level vector search with query-time embedding) | Yes, one service operated by the maintaining group |

Tiers add pages and data without changing the shell, the existing tables or the release layout, and a release declares in its manifest which of them it contains.

## Documents

The data contract in [docs/data-contract.md](docs/data-contract.md) defines every table, file and format the platform reads and writes, and the requirements in [docs/requirements.md](docs/requirements.md) define every page, its behavior and its acceptance items. When the code and these two documents disagree, the documents win. [docs/setup.md](docs/setup.md) describes the toolchain and how a development session runs.

## Repository layout

```
packages/ingest/     Python 3.13 and uv; the catalejo command (see packages/ingest/README.md)
packages/web/        TypeScript, Node 24, pnpm, Vite and React; the static application (see packages/web/README.md)
config/              platform, palette, design tokens, typing display, summary templates, export presets, version pins
docs/                data contract, requirements, critic checklist, setup
tests/fixtures/      files shared by both packages, such as the Parquet cross-read fixture
.github/workflows/   ci.yml, release.yml, deploy.yml
```

Data, catalogs and releases are written under `data/`, `catalog/` and `releases/`, which git ignores.

## Running the synthetic data locally

The repository is at milestone 0, so the synthetic generator and the application shell exist while the release build does not yet. The prerequisites are uv, Node 24 and pnpm, as listed in [docs/setup.md](docs/setup.md).

```
uv sync --project packages/ingest
uv run --project packages/ingest catalejo synth --out data/synth
```

The second command writes an mgap-shaped results directory to `data/synth/results/` and the side tables (`metadata.csv`, `groups.csv`, `genome_groups.csv`, `sets.csv`, `tombstones.csv`) beside it, with 60 genomes of three species by default. The release build that turns these files into `releases/synth` arrives in milestone 1a.

```
pnpm --dir packages/web install
pnpm --dir packages/web dev
```

The development server shows the application shell at `http://localhost:5173` and serves `releases/synth` under `/data/`. Until milestone 1a writes that directory, requests under `/data/` answer 404 and the shell still runs.

## License

MIT, see [LICENSE](LICENSE).

## Citation

If you use Catalejo Genómico, please cite it with the metadata in [CITATION.cff](CITATION.cff).

## AI-assisted development

Catalejo was developed with the assistance of Claude (Anthropic) models under the direction of the maintaining group. Model versions used in each development milestone are recorded in an internal development log, available on request.
