# Catalejo

Catalejo Genómico is a web platform for a curated collection of microbial genomes. This file holds the standing rules for every Claude Code session in this repository. Read it in full before doing anything.

## Sources of truth

- `docs/data-contract.md` defines every table, file and format the platform reads and writes.
- `docs/requirements.md` defines every page, its behavior, its acceptance items and the non-functional constraints.
- `docs/critic-checklist.md` is the executable form of the acceptance items.
- If `dev/build-plan.md` exists on this machine, read it before planning any milestone. It is not part of the repository.

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
tests/               cross-package tests (Parquet cross-read, release golden test)
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
pnpm --dir packages/web dev                             development server
pnpm --dir packages/web test                            component tests
pnpm --dir packages/web e2e                             Playwright tests against the synthetic release
pnpm --dir packages/web lint && pnpm --dir packages/web typecheck
uv run --project packages/ingest ruff check . && uv run --project packages/ingest pyright
```

Run the relevant tests after every change. A hook runs lint and type checks after edits; treat their failures as your own.

## Toolchain pins

Python 3.13, Node 24, DuckDB Python and `@duckdb/duckdb-wasm` on the same minor version as recorded in `config/versions.yaml`. Do not upgrade pinned versions without the maintainer's approval. Do not add a dependency without stating in the session why it is needed and what it replaces.

## Design

The interface follows the design tokens in `config/design-tokens.yaml` and the rules in `docs/requirements.md` §7. Every user-visible string lives in `packages/web/src/strings.ts`; components contain no literal interface text. Every color comes from `config/palette.yaml`. Species names are italic in the serif face; gene and allele names are italic monospace. No icon-only navigation, rounded cards, shadows, gradients, blue accent or dark sidebar.

## Git

You may create branches, stage, commit, and push to feature branches, and open pull requests with `gh pr create`. You may not push to `main`, force-push, create tags, rebase interactively, reset hard, delete branches, merge pull requests, or change git configuration. The maintainer reviews and merges every pull request and creates every tag.

Commit messages. A subject line in the imperative of at most 72 characters, starting with the area (`ingest:`, `web:`, `docs:`, `config:`, `ci:`), then a blank line, then a body stating what changed and why, referencing the milestone (`Milestone 2`) and the requirement section when relevant. No mention of Claude or of AI assistance in commit messages; the project's AI-assisted development statement lives in the README and the Methods page.

Never commit files under `data/`, `releases/`, `catalog/`, `dev/`, `.env` or `.claude/settings.local.json`.

## Sessions

Each session covers one milestone or one bounded task from `dev/build-plan.md`. Start in plan mode, read the relevant sections of the two documents, propose a plan, and wait for approval. Delegate to the subagents in `.claude/agents/` by scope: `ingest` for Python and data, `web` for the application, `docs` for documentation, `critic` for review. The critic never edits code. A milestone ends when the critic passes its items, tests pass, and the maintainer has reviewed the pull request; do not declare completion yourself.

When you are unsure, ask. When something in the documents is ambiguous, quote the passage and propose two readings with a recommendation.

## Writing style for documentation

Documentation is written in the maintainer's style. No em dashes. No colons in running prose. Sentences with subordinate clauses over strings of short declaratives. No phrases such as "delve", "leverage", "crucial", "robust", "plays a key role", "it is worth noting", "seamlessly", "novel", "unprecedented", "rather than", "not just". US spelling. Interface strings and figure text in English.
