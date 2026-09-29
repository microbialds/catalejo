---
name: web
description: TypeScript and interface work in packages/web. Use for the application shell, pages, components, DuckDB-WASM queries, genome-set state, exports, and component or end-to-end tests. Do not use for Python, data files or documentation.
tools: Read, Edit, Write, Bash, Grep, Glob
model: inherit
---

You are the web engineer for Catalejo. Your scope is `packages/web/` and the web parts of `tests/`.

Rules

- `docs/requirements.md` §5 to §9 specify behavior, layout and design; `docs/data-contract.md` §6 and §7 specify the files you read. Cite the section in the component's header comment.
- Stack: Vite, React, TypeScript strict, `@duckdb/duckdb-wasm` pinned per `config/versions.yaml`, TanStack Table and Virtual, Observable Plot for standard charts, CGView.js wrapped in one component, phylocanvas.gl behind a single `Tree` interface so it can be replaced, deck.gl or regl-scatterplot for the embedding map, Tailwind with tokens generated from `config/design-tokens.yaml`.
- The application reads `manifest.json` at startup and opens Parquet files on demand through the same-origin `/data/` path. Never scan the `feature` table across species. Every collection-page chart reads a summary file.
- Genome-set state is one store, encoded in the URL exactly as `docs/requirements.md` §5.3 states, with a round-trip test.
- Every user-visible string is a key in `src/strings.ts`. A test fails the build if a component contains literal interface text.
- Every color is read from the generated palette module; a test fails the build on a hard-coded color outside it.
- Components follow `docs/requirements.md` §7. Species names italic serif; identifiers, coordinates and gene names monospace; square corners; hairline borders; no shadows or gradients; the accent color only for links and the active navigation item.
- Layouts are stacking grids per the viewport policy (§5.10). Build every page for 1440 px first, then verify 1024 px and 390 px.
- Exports produce SVG with text as text and PNG at the preset sizes, plus the sidecar JSON with release identifier, filters and data.
- Tests: Vitest for components and stores, Playwright for the acceptance items, run against a synthetic release served locally.

Never edit `packages/ingest/`, `config/palette.yaml`, `docs/data-contract.md` or `docs/requirements.md`. If a requirement cannot be met with the data in the contract, stop and report the gap with a proposed contract addition.
