# Catalejo

Catalejo Genómico is a web platform for a curated collection of microbial genomes. This file holds the standing rules for every Claude Code session in this repository. Read it in full before doing anything.

## Sources of truth

- `docs/data-contract.md` defines every table, file and format the platform reads and writes.
- `docs/requirements.md` defines every page, its behavior, its acceptance items and the non-functional constraints.
- `docs/critic-checklist.md` is the executable form of the acceptance items.
- If `dev/build-plan.md` exists on this machine, read it before planning any milestone. It is not part of the repository.
- If `dev/design/` exists, its HTML files are the layout references for the Collection, Genome and Embeddings pages (see `dev/design/README.md`); the documents win where they disagree.

When code and these documents disagree, the documents win. When a document appears wrong, stop, state the problem and the proposed change in prose, and wait for the maintainer to approve an edit to the document before writing code that depends on it. Never change `docs/data-contract.md` or `docs/requirements.md` on your own initiative.

## Vocabulary

Use the vocabulary in `docs/data-contract.md` §1 in code identifiers, interface strings, URLs, documentation and commit messages. In particular:

- A subset of genomes is a **genome set** (in code `GenomeSet`, `set`). The word "cohort" never appears anywhere; a hook rejects it.
- A gene or mutation associated with resistance is a **resistance determinant**.
- The projection on the Embeddings page is the **embedding map**; the word "atlas" is not used.
- Pages are Collection, Genome sets, Genomes, Genes, Phylogeny, Pangenome, Embeddings, Sequence search, Methods, Releases.

The platform is named Catalejo in the interface, Catalejo Genómico in prose, and `catalejo` in code.

## Repository layout

```
packages/ingest/     Python 3.13, uv, the `catalejo` command (parsers, catalog, release build)
packages/web/        TypeScript, Node 24, pnpm, Vite, React; the static application
config/              platform.yaml, palette.yaml, design-tokens.yaml, typing_display.yaml,
                     summary_templates.yaml, export-presets.yaml, versions.yaml
docs/                data-contract.md, requirements.md, critic-checklist.md, setup.md, onboarding.md
tests/fixtures/      shared fixtures (the Parquet cross-read file); package tests live inside each package
.github/workflows/   ci.yml, release.yml, deploy.yml
dev/                 ignored by git; build plan, prompts, internal documents (present only on the maintainer's machine)
```

Work only inside this repository. Do not read or write files outside it, except package caches created by the toolchain.

## Commands

```
uv sync --project packages/ingest                       install ingest dependencies
uv run --project packages/ingest pytest                 ingest tests
uv run --project packages/ingest catalejo --help        the command
uv run --project packages/ingest catalejo synth --out data/synth   synthetic mgap results (data/ is ignored)
pnpm --dir packages/web install                         install web dependencies
pnpm --dir packages/web dev                             development server, serves releases/synth at /data/ by default
pnpm --dir packages/web test                            component tests
pnpm --dir packages/web e2e                             Playwright tests against the synthetic release
pnpm --dir packages/web exec playwright install chromium   Chromium for the e2e tests (add --with-deps on Linux)
pnpm --dir packages/web build                           production build into packages/web/dist, then check-dist
pnpm --dir packages/web lint && pnpm --dir packages/web typecheck
uv run --project packages/ingest ruff check . && uv run --project packages/ingest pyright
```

The synthetic release (`releases/synth`), built from the repository root exactly as `.github/workflows/ci.yml` does in its "Synthetic release" step:

```
catalejo() { uv run --project packages/ingest catalejo "$@"; }
catalejo synth --species 10 --genomes 100 --out data/synth
catalejo metadata init --mgap data/synth/results --existing data/synth/metadata.csv --out data/synth/metadata.csv
catalejo ingest --mgap data/synth/results --metadata data/synth/metadata.csv --catalog data/catalog/synth.duckdb
catalejo tombstones ingest --file data/synth/tombstones.csv --catalog data/catalog/synth.duckdb
catalejo groups ingest --groups data/synth/groups.csv --members data/synth/genome_groups.csv --catalog data/catalog/synth.duckdb
catalejo sets ingest --file data/synth/sets.csv --catalog data/catalog/synth.duckdb
catalejo release check --catalog data/catalog/synth.duckdb --metadata data/synth/metadata.csv --mgap data/synth/results
catalejo release build --catalog data/catalog/synth.duckdb --out releases/synth
catalejo release check --catalog data/catalog/synth.duckdb --release releases/synth
```

Run the relevant tests after every change. A hook runs the linter after edits; treat its failures as your own. Type checks run with the tests.

## Toolchain pins

Python 3.13, Node 24, DuckDB Python and `@duckdb/duckdb-wasm` on the same minor version as recorded in `config/versions.yaml`. Do not upgrade pinned versions without the maintainer's approval. Do not add a dependency without stating in the session why it is needed and what it replaces.

## Design

The interface follows the design tokens in `config/design-tokens.yaml` and the rules in `docs/requirements.md` §7. Every user-visible string lives in `packages/web/src/strings.ts`; components contain no literal interface text. Every color comes from `config/palette.yaml`. Species names are italic; identifiers, counts and counters are monospace; gene and allele names are italic monospace. The chrome is achromatic and the accent is ink. No icon-only navigation, rounded cards, shadows, gradients, serif face, uppercase labels, colored accent or dark sidebar.

## Git

You may create branches, stage, commit, and push to feature branches, and open pull requests with `gh pr create`. You may not push to `main`, force-push, create tags, rebase interactively, reset hard, delete branches, merge pull requests, or change git configuration. The maintainer reviews and merges every pull request and creates every tag.

Commit messages. A subject line in the imperative of at most 72 characters, starting with the area (`ingest:`, `web:`, `docs:`, `config:`, `ci:`), then a blank line, then a body stating what changed and why, referencing the milestone (`Milestone 2`) and the requirement section when relevant. No mention of Claude or of AI assistance in commit messages; the project's AI-assisted development statement lives in the README and the Methods page.

Never commit files under `data/`, `releases/`, `catalog/`, `dev/`, `.env` or `.claude/settings.local.json`. Never edit anything under `.claude/`; the maintainer owns that directory.

## Autonomy and escalation

Resolve on your own, without asking: failing tests, lint and type errors, critic failures where the requirement is clear and the page does not meet it, layout at the three checked widths, missing links, wrong or literal strings, and any other implementation defect against the documents. Fixes change the code. They never change a test's expectation, the critic checklist, or the reading of a requirement to make a failure pass; a failure you disagree with is reported, not resolved.

Stop and ask the maintainer before: editing `docs/data-contract.md`, `docs/requirements.md` or `docs/critic-checklist.md` (a hook blocks these; use the contract-change procedure in `dev/build-plan.md`); adding or upgrading a dependency; changing a route, a vocabulary term, a palette color or a design token; anything the permission rules deny; and any critic failure that survives three fix rounds or that you believe reflects a wrong requirement. Put unresolved points in the pull request description under "Open points".

## Sessions

Each session covers one milestone or one bounded task from `dev/build-plan.md`. Start in plan mode, read the relevant sections of the two documents, propose a plan, and wait for approval. Delegate to the subagents in `.claude/agents/` by scope: `ingest` for Python and data, `web` for the application, `docs` for documentation, `critic` for review. The critic never edits code.

Before stopping at the end of any session, if `dev/development-log.md` exists, append one row to its table with: the date; the session label from the build plan (0, 1a, 1b, ...); the milestone; the model the session ran on as you understand it (the alias in the session header, with "fallback?" appended if you saw a model-switch notice) and the subagents' model if different; the advisor model if one was configured; the outcome (pull request number and state, or what was completed); and notes (decisions taken, open points, anything the next session must know). Do not edit earlier rows.

A milestone that touches the web application runs its own review loop: build the synthetic release if it is missing, start the development server in the background, run the critic on the pages in scope with the server's URL, fix every reported failure, run the tests, run the critic again, up to three rounds, then stop the server. Then open the pull request with the final critic report attached and stop.

If you must stop before a milestone is complete (context degrading, a blocking question), write `dev/handoff.md` with what is done, what remains and where to resume, open the pull request as a draft, and stop. A milestone ends when the critic passes its items, tests pass in CI, and the maintainer has reviewed the pull request; do not declare completion yourself.

When you are unsure, ask. When something in the documents is ambiguous, quote the passage and propose two readings with a recommendation.

## Writing style for documentation

Documentation is written in the maintainer's style. No em dashes. No colons in running prose. Sentences with subordinate clauses over strings of short declaratives. No phrases such as "delve", "leverage", "crucial", "robust", "plays a key role", "it is worth noting", "seamlessly", "novel", "unprecedented", "rather than", "not just". US spelling. Interface strings and figure text in English.