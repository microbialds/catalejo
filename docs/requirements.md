# Requirements

Catalejo Genómico. Version 0.5, 2026-09-30. Status: draft for review.

This document states what the platform does, page by page, and the constraints it is built under. It is the companion of `docs/data-contract.md`, which defines the data the platform reads; where the two disagree, the contract wins and this document is corrected. The critic checklist (`docs/critic-checklist.md`) is derived from the acceptance items at the end of each page section, and the build plan takes its milestones from §14.

Contents

1. Purpose, users and scope
2. Tiers
3. Vocabulary and language
4. Access model
5. Global behavior
6. Pages
7. Design system
8. Exports
9. Non-functional requirements
10. Hosting and deployment
11. Release and deployment workflows
12. Documentation
13. Testing and quality
14. Milestones
15. Open items

---

## 1. Purpose, users and scope

Catalejo is a web platform for looking at a curated collection of microbial genomes produced by the mgap pipeline, with their annotation, resistance determinants, mobile elements, typing results, pangenomes, phylogenies and, later, embeddings. It answers three kinds of question. What is in the collection and how is it distributed. What does one genome look like, in structure and in content. Which genomes share a property, and what do they have in common.

Users are researchers in microbial genomics and antimicrobial resistance, clinical microbiologists and infectious disease specialists, and students. They read the collection; they do not write to it. One maintaining group produces releases with the `catalejo` command.

In scope. Reading a release, filtering and composing genome sets, visualizing genomes, genes, trees, pangenomes and embeddings, exporting figures and data, and documenting the methods behind a release.

Out of scope. Running annotation or pangenome pipelines, uploading genomes through the interface, editing data, user accounts beyond the login gate, sharing sets between users on a server, and any collection of usage data.

## 2. Tiers

| Tier | Content | Server needed |
|---|---|---|
| 0 | All pages except Embeddings and Sequence search, on data from mgap, pangenomes and trees | No |
| 1 | Embeddings page and "similar genomes" on the genome page, from genome-level embeddings shipped in the release | No |
| 2 | Sequence search (alignment over cluster representatives, then protein-level vector search with query-time embedding) | Yes, one service operated by the maintaining group |

Tiers add pages and data; they do not change the shell, the contract's existing tables, or the release layout. A release declares what it contains in its manifest, and the application shows only what is declared (§5.7).

## 3. Vocabulary and language

The vocabulary in the data contract §1 is binding for interface strings, code identifiers, URLs, commit messages and documentation. In particular, a subset of genomes is a genome set, never a cohort; a gene or mutation linked to resistance is a resistance determinant; the two-dimensional projection is the embedding map on the Embeddings page.

The interface is in English. Every user-visible string lives in one module, `packages/web/src/strings.ts`, keyed by identifier, and components never contain literal interface text, so that a Spanish translation later is one additional file. Species names are rendered in italics wherever they appear. Gene symbols and allele names are rendered in italics in a monospace face.

## 4. Access model

Each collaborator group receives its own instance, a Cloudflare Pages project with its own hostname, serving a release filtered to that group's genomes and protected by a Cloudflare Access policy that lists the group's email addresses. The maintaining group's instance holds the full collection. A future public instance is the same application with no Access policy.

No instance stores user data. There are no accounts, profiles, saved objects or analytics. Login exists only to gate access to the data.

## 5. Global behavior

### 5.1 Shell

Every page shares the shell shown on the final canvas boards. A 200 px left column holds the wordmark (Catalejo, with the tagline "microbial genome collection"), the navigation in two groups, Explore (Collection, Genome sets, Genomes, Genes) and Analyze (Phylogeny, Pangenome, Embeddings, Sequence search), and a footer with the release identifier (a link to the Releases page), the genome count, the pipeline name and version from the manifest (contract §6.4), and a link to the Methods page. The active page is marked by a left rule in the accent color.

A 56 px bar spans the top of every page and shows the current genome set (the count as a large numeral, the phrase "genomes in the current set", the active filters as chips, an "add filter" link), a search field on pages where search applies, and the actions "Share link" and "Save set".

Navigation items whose data is absent from the release (per the manifest) are shown disabled with a tooltip stating that the release does not include that product.

### 5.2 Genome sets

The current set is the subset of the release selected by filters, or an explicit list of genome identifiers, or a curated set from the release. It is global state, shared by every page, and it is fully encoded in the URL (§5.3) so that a link reproduces it.

Filters are conjunctive across fields and disjunctive within a field. Supported fields, in the order they appear in the "add filter" menu: species, sequence type, source type, country, year (range), platform, assembly status, completeness (minimum), contamination (maximum), resistance determinant present (by element name or drug class), point mutation present, plasmid replicon present, plasmid contig present, MOB cluster present, prophage present, pangenome cluster present (within one species), curated set membership, and explicit genome identifiers. The key and value of each field are listed in the contract §7.5.

Actions. "Save set" downloads the exchange file defined in the contract §7.5. "Load set" (on the Genome sets page) accepts that file, applies its filters and reports how many listed identifiers are present in the current release. "Share link" copies the current URL. "Use as set" appears wherever a selection can become a set (a tree clade, an embedding lasso, a table selection, a gene's carriers) and replaces the current set after a confirmation that states the new count.

Empty set. When filters select zero genomes, every page shows the same message with the active filters and a link to clear the last one; nothing else renders.

### 5.3 URL scheme

Routes are stable and are part of what users cite. Query parameters encode the set.

| Route | Page |
|---|---|
| `/` | Collection |
| `/sets` | Genome sets |
| `/genomes` | Genome list (the collection table, full page) |
| `/genomes/<genome_id>` | Genome page |
| `/genomes/<genome_id>/contigs/<contig_id>` | Genome page with a contig selected |
| `/genes` | Genes page, search state |
| `/genes/<namespace>/<name>` | Genes page for one gene; namespace is `symbol`, `element` or `cluster` |
| `/trees` and `/trees/<tree_id>` | Phylogeny |
| `/pangenome` | Pangenome, species chooser listing the species with a pangenome in the release, each opening `/pangenome/<species_code>` |
| `/pangenome/<species_code>` | Pangenome |
| `/embeddings` | Embeddings |
| `/search` | Sequence search |
| `/methods` | Methods |
| `/releases` | Current release and release notes |

Set state is carried in the query string as `q=` with a compact JSON encoding of the filter object from the contract §7.5, plus `ids=` for explicit lists and `set=` for a curated set. A missing query means the whole release. Route changes preserve the query. Any URL that names a genome absent from the release resolves to the tombstone page if a tombstone exists, else to a not-found page that offers a search.

### 5.4 Color vocabulary

All colors come from `config/palette.yaml`, read by the Python exports and the TypeScript components.

- Species colors are assigned once in `species_registry.color` from an Okabe-Ito based sequence of eight, with "Other" in gray, and never change between releases. When more than eight species are present, the collection page groups the smallest into "Other" for charts and keeps individual colors in tables and chips.
- Drug classes have a fixed palette of fourteen distinguishable colors on white, listed in the palette file, with a stated order.
- Contig types are fixed. Chromosome dark gray, plasmid purple, prophage lavender, unclassified light gray, none of which appears in the species sequence. The AMR track and determinant highlight is vermillion; virulence is reddish purple; GC skew is bluish green.
- The embedding map uses a dark background and a lifted variant of the species palette, also listed in the palette file, so the mapping from species to hue is preserved.
- Interface chrome uses no saturated color other than the accent (dark brick red) for links and the active navigation item, so that data colors are the only saturated colors on a page.

### 5.5 Draft and complete genomes

A genome is complete when every classified replicon is circular (contract §5.2). The genome page opens complete genomes in the circular view and draft genomes in the linear view, with contigs ordered by length and separated by dividers; the circular view is offered for a draft only when a single circular chromosome contig exists. For draft genomes, every statement about location reads "plasmid-associated contig (predicted)" or "chromosome (predicted)" and the resistance panel carries a note. Prevalence charts that mix platforms or assembly statuses show a footnote explaining that short-read assemblies fragment at repeats and undercount mobile elements. Platform and assembly status are facets on the collection page and the set bar offers a "complete genomes only" toggle.

### 5.6 Annotation versions

When the current set contains genomes annotated with more than one version of the Bakta database or the AMRFinderPlus database, every prevalence chart and the resistance heatmap show a warning with the versions involved and a link to the Methods page. The check reads the annotation versions per species in the manifest (contract §6.4) and never scans `tool_version`; the warning shows when the species of the set together carry more than one version of either database.

### 5.7 Presence of optional products

The manifest declares which species have pangenomes and trees, which embedding models exist, and which curated sets exist. Pages read the manifest and render absence as a short statement ("No pangenome is included for this species in release 2026-09") with the Methods link, never as an error or an empty chart.

### 5.8 Global search

The search field accepts a genome identifier, a BioSample or assembly accession, a gene symbol, an element name, a pangenome cluster name, a product substring, or a sequence type. Results are grouped by kind with counts and open the matching page; a single exact match on a genome identifier navigates directly. Search reads a small index shipped in the release (`summaries/search_index.parquet`, contract §6.2) and completes within 200 ms after the index is loaded.

### 5.9 Linking

Every species name links to the collection filtered by that species. Every genome identifier links to its genome page. Every gene symbol, element name or cluster links to the Genes page. Every sequence type links to the collection filtered by species and ST. Every contig with a MOB cluster links to the collection filtered by that cluster. Every tree identifier links to the phylogeny page. Links preserve the current set except where the link is itself a filter.

### 5.10 Viewport policy

The platform is designed for desktop widths (the boards are drawn at 1440 px) and degrades without breaking on narrower screens. Every page is built on a stacking grid. Between about 900 and 1,200 px the facet rail becomes a drawer opened from the set bar and multi-column panel rows stack vertically. Below about 900 px the navigation collapses into a menu, tables scroll horizontally inside their panel, and the visualizations that need width (the genome map, heatmaps, the neighborhood comparison, trees and the embedding map) are replaced by a short note that they need a wider screen, while headers, counters, the summary sentence, determinant pills, tables and downloads remain usable. No feature exists only for small screens. The critic checks each page at 1440 px and 1024 px, and the genome and collection pages additionally at 390 px.

## 6. Pages

Each page section gives purpose, layout, data, controls and interactions, states, and acceptance items. Layouts refer to the final boards on the design canvas; measurements there are for a 1440 px viewport. Narrower widths follow the viewport policy in §5.10.

### 6.1 Collection

Purpose. Show what the current set contains and let the user narrow it.

Layout. Facet rail (232 px) on the left with species, source, mobile elements, AMR class, platform and assembly status, each facet showing counts for the current set. Main area with a ruled strip of five counters (genomes, species, sequence types, resistance determinant hits, plasmid contigs), a row of three panels (species bars, sequence types for the selected or largest species, resistance class by species heatmap), a row of two panels (genomes by year stacked by species, assembly QC scatter with thresholds), and the genome table.

Data. The species-grain summaries (`summaries/counts_by_*` and `amr_class_by_species`) for every chart and counter when the set is the whole release, which is also the first render. For any other set, the same counts aggregated in the browser over the genome-grain files (`genome.parquet`, `summaries/qc.parquet`, `summaries/amr_class_by_genome.parquet`, the presence files, `mutation.parquet` and `genome_set_member.parquet`), never over the per-species tables. `genome.parquet` for the table, paged.

Controls and interactions. Clicking a bar, a heatmap cell, a facet value or a year adds the corresponding filter. The QC scatter supports brushing, which adds a completeness and contamination filter. The table supports sorting, column selection, paging by 50, and row selection, with "Use as set" for the selection. Each panel has an expand control that opens it full-width with the export menu.

States. Empty set as §5.2. Fewer than eight species collapses "Other". A species with no ST scheme shows the ST panel with a statement instead of bars.

Acceptance.
- Counters equal the counts in the summaries for the whole release, and the same counts computed over the genome-grain files for any other set.
- Every chart element is clickable and the resulting filter appears as a chip.
- Facet counts update within 300 ms of a filter change on the synthetic release.
- The table shows italic species names, monospace identifiers, and links on identifiers, species and STs.
- The annotation version warning appears when the synthetic release's mixed-version species is in the set.

### 6.2 Genome sets

Purpose. Compose, inspect, save and load sets, and open curated sets.

Layout. A builder at the top with chips for the active filters and an "add filter" menu with the fields of §5.2, a live count, and the actions. Below, three linked views of the current set. A presence and absence heatmap (rows genomes, columns resistance determinants by default, switchable to pangenome clusters within one species, hierarchical clustering on both axes, capped at 2,000 genomes with a message above that). The species tree pruned to the set when the set is within one species with a tree, with metadata columns selectable from the genome table. The genome table as in §6.1. A curated sets panel lists the release's curated sets with name, description and count, and a "Load set" control accepts the exchange file.

Data. `presence_amr.parquet`, `presence/<species>.parquet`, `tree`, `tree_tip`, `genome.parquet`, `genome_set*.parquet`.

Acceptance.
- A set built from two filters yields the same count on this page and on the collection page.
- Loading an exchange file from another release reports present and missing identifiers.
- The heatmap and the tree highlight the same genome when hovered in either.
- Curated sets open with their description shown in the set bar.

### 6.3 Genome

Purpose. Everything about one genome, in the layout of the final genome board.

Layout. Header with the species name (italic serif), ST chip, species source note, the generated summary sentence with linked determinants, typing chips per `config/typing_display.yaml`, and six counters (size and contigs, CDS and GC, assembly status and platform, resistance determinants and mutations, plasmids, prophage regions). Middle row with the contig list and track toggles (190 px), the genome map (CGView.js), and a right column holding "Resistance determinants by location" as pills grouped by replicon and, below it, the full feature table with search. Bottom, the gene neighborhood strip for the selected feature with the link to compare across the current set.

Data. `genomes/<species>/<genome_id>/features.parquet` and `cgview.json`; the genome row from `genome.parquet`; `contig` rows.

Controls and interactions. Contig selection redraws the map and filters the table. Track toggles show or hide tracks. Clicking a feature on the map or in the table selects it, scrolls the table, highlights it on the map and fills the neighborhood strip. Clicking a determinant pill selects that feature. The neighborhood strip shows eight features on each side, colored by category (resistance, transposase or IS, plasmid replication or transfer, other), with hover details, and the header states the coordinates. "Compare across the current set" opens the Genes page for that feature's cluster or element with the current set. "Similar genomes" (Tier 1) opens the Embeddings page with this genome selected. Downloads offer GBFF, GFF3, FASTA and proteins. "Add to set" adds the genome identifier to an explicit list.

States. Draft genome behavior as §5.5. A genome without resistance determinants shows the pill panel with a statement. A tombstoned genome renders the tombstone page. Missing typing tools show no chips.

Acceptance.
- The summary sentence is generated from the template and every gene in it links to the Genes page.
- Selecting a feature in the table highlights it on the map and vice versa.
- For a draft genome the page opens in the linear view and the location labels carry "(predicted)".
- The resistance pills group determinants by replicon with the same colors as the contig list.
- Every download produces the file for the current genome and nothing else.

### 6.4 Genes

Purpose. One gene, element or cluster across the current set.

Layout. A search field with autocomplete over the three namespaces and the matched namespace shown. Header with the name in all three namespaces where known, the drug class, and the number of carriers in the current set and in the release. A row of three panels. Prevalence by species and by ST (bars, with the annotation warning when applicable). Genomic location as a stacked bar (chromosome, plasmid, prophage, unclassified, with "(predicted)" for draft carriers). Variant table for point mutations of the same gene, when the gene has any. Below, the neighborhood comparison. Carriers listed as rows, each row a neighborhood strip aligned on the focal feature, flanking features colored by pangenome cluster within a species and by `protein_hash` across species, so identical flanks share a color, with links between adjacent rows drawn for shared clusters, sortable by species, ST or plasmid cluster, capped at 200 genomes with a message above that. A "carriers" table with "Use as set".

Data. `presence_amr.parquet`, `presence/<species>.parquet`, `annotation_hit`, `mutation`, `feature` for the carriers' neighborhoods, `cluster_membership`.

Acceptance.
- Searching an element name, a Bakta symbol and a cluster name each resolves and shows which namespace matched.
- Carrier counts equal the column sums in the presence files for the current set.
- The location bar shows the "(predicted)" qualifier only for draft carriers.
- The neighborhood comparison aligns the focal feature in every row and colors identical flanks identically.

### 6.5 Phylogeny

Purpose. Trees per species with metadata, linked to the set.

Layout. A tree selector (species and tree, with alignment type and reference shown), the tree in the main area, a metadata column selector, and a caption generated from the tree record (tools, model, alignment type, reference, genome count, date). Tips in the current set are shown in color, others grayed; a toggle prunes to the set.

Controls and interactions. Clade selection, with "Use as set". Tip click opens the genome page. Coloring by any categorical column and up to four metadata columns as strips. Export as SVG and Newick.

States. A species without a tree shows the absence statement. A tree whose tips include genomes outside the current instance's group is exported with those tips pruned at release build (contract obligation), so the page never sees them.

Acceptance.
- The caption states alignment type and reference for a reference-SNP tree.
- Selecting a clade and using it as a set yields exactly the clade's tips.
- Pruning to the set keeps topology among the remaining tips.

### 6.6 Pangenome

Purpose. The pangenome of one species and its clusters.

Layout. Species selector. Summary counters (genomes, core, soft core, shell, cloud). Rarefaction and accumulation curves from `summaries/rarefaction/<species_code>.parquet` (contract §6.2). Cluster table with name, annotation, frequency, class, carriers in the current set, and a link to the Genes page. Cluster mapping from the previous release shown in a side panel when present (same, split, merged, new, retired counts, with a link to the release notes).

Acceptance.
- Counters equal the `pangenome_species` row.
- Clicking a cluster opens the Genes page in the cluster namespace.
- The mapping panel appears only when a previous release exists.

### 6.7 Embeddings (Tier 1)

Purpose. Explore the collection as a map of genome embeddings.

Layout. As the final embedding board. A dark panel with the map, a toolbar (model selector when several, color-by selector over species, ST, source, platform, year and any curated set, lasso, reset view), a legend, and the projection parameters in a corner. A right column with the selection count and actions (use as set, open in table, export identifiers), composition of the selection by species, resistance class prevalence in the selection against the current set as paired bars, and the nearest genomes to the hovered or selected genome with distances.

Data and provenance. Embeddings arrive as an external file of identifiers and vectors (contract §4.5); the two-dimensional projection is computed by `catalejo release build` with parameters recorded in the manifest and displayed in the panel corner, so the map is reproducible from the release alone. Nearest genomes use the vectors, not the projection.

Controls and interactions. Hover shows a card with identifier, species, ST, source, year and determinant count and a link. Lasso selects. Clicking a point selects it and fills the nearest list. Points outside the current set are dimmed. Rendering uses WebGL through deck.gl or regl-scatterplot and stays interactive at 100,000 points.

Acceptance.
- Lasso selection count matches the "use as set" result.
- Coloring by platform shows the expected separation on the synthetic release, where fragmented assemblies are planted.
- Nearest genomes are ordered by distance from the embedding vectors, computed in the browser.

### 6.8 Sequence search (Tier 2)

Purpose. Find genomes by sequence.

Behavior. A text area for a protein or nucleotide sequence, a mode selector, submission to the search service, and results as a table with identity, coverage, alignment length, the matched representative, the number of member genomes, and "Use as set" for the member genomes. When the vector index exists, results show the vector-retrieved candidates before alignment with a note that alignment confirms them. The page states plainly when the service is unavailable and the rest of the application is unaffected. Detailed requirements are deferred to the Tier 2 revision of this document.

### 6.9 Methods

Purpose. Reproducibility and citation.

Content, generated from the manifest and the configuration files. The release identifier and date, genome and species counts, the pipeline and every tool with its version and database version, the species assignment precedence, the QC thresholds, the summary sentence rules, the pangenome and tree methods per species, the embedding model and projection parameters, the color vocabulary, the export presets, a citation block for the platform and for the release, the AI-assisted development statement (§12.5), and the origin of the name.

### 6.10 Releases

The current release (identifier, date, genome and species counts, schema version) and its release notes, followed by the notes of previous releases for the record. Users always see the current release; there is no switching between releases, and links carry no release identifier.

### 6.11 Tombstone and not found

A tombstoned genome shows its identifier, the release it was removed in, the reason and the replacement if any, with links. An unknown route shows a not-found page with the global search.

## 7. Design system

The system is fixed by the final boards and by these tokens, all of which live in `config/design-tokens.yaml` and are compiled into CSS variables.

Typography. Source Serif 4 for the wordmark, panel titles, large numerals and species names (italic). Source Sans 3 for interface text. Source Code Pro for identifiers, coordinates, counts in tables, gene and allele names (italic). Base size 13 px, panel titles 15 px, counters 24 px, headline on the genome page 28 px. No other families.

Color. Paper background `#f6f5f1`, panel white, borders `#dcdad3` and `#d9d7cf`, ink `#1c1c1a`, secondary text `#6b6a64`, accent `#8a2f22`. Data colors from `config/palette.yaml`.

Shape and spacing. Square corners (2 px on buttons and chips), hairline borders, no shadows, no gradients. Panels have a 6 px bottom rule under the title. Counters are set in a ruled strip with a heavy top rule. Tables have a heavy top rule, light row rules, uppercase letterspaced column headers. Vertical rhythm on a 4 px grid, panel padding 12 px 14 px, panel gap 14 px.

Components. Panel, counter strip, facet group, chip (filter, typing, gene pill), button (primary ink, secondary outlined), underlined search field, table, contig list, track toggle, set bar, navigation. Each is one component with variants, and no page defines its own.

What not to do. No icon-only navigation, no rounded cards, no colored headers, no blue accent, no dark sidebar, no emoji, no gradient, no drop shadow, no sans-serif species names, no color used for meaning outside the palette file.

## 8. Exports

Every chart, map, tree and heatmap has an export menu with the presets below, and every table exports CSV of the rows currently shown or of the whole set.

| Preset | Width | Format |
|---|---|---|
| Single column | 89 mm | SVG, PNG 300 dpi |
| One and a half column | 120 mm | SVG, PNG 300 dpi |
| Double column | 183 mm | SVG, PNG 300 dpi |
| Slide | 1920 × 1080 px | PNG 2×, SVG; light or dark background |
| High resolution | any preset | PNG 600 dpi |

Rules. Height follows content and is shown before download. SVG keeps text as text with the Source families declared and an option to outline to paths. Minimum 7 pt type and 0.5 pt lines at final size, enforced by the export scaling. Palette on white unless the slide dark option is chosen. No interface chrome; legend included; title optional; transparent background optional. Every export is accompanied by a sidecar JSON with the release identifier, the page, the filter expression, the export preset and the underlying data as CSV, so a figure can be regenerated from the release. Journal widths are defaults in `config/export-presets.yaml` and editable.

## 9. Non-functional requirements

Performance. First meaningful render of the collection page within 2 s on a mid-range laptop over a 50 Mbit/s connection for a 10,000-genome release; page transitions within 500 ms; filter changes update counters and facets within 300 ms; the genome page opens within 1 s after its `features.parquet` is fetched. The browser tab stays under 1 GB of memory on a 100,000-genome release, achieved by partition pruning, the precomputed summaries, and never scanning `feature` across species. A test in CI measures memory on the synthetic release scaled to 100,000 genomes with a generated feature table.

Browsers. Current Chrome, Firefox, Safari and Edge, on desktop and tablet; phones per the viewport policy in §5.10.

Accessibility. Keyboard reachable controls, visible focus, text contrast at WCAG AA on chrome, colorblind-safe palettes, chart data available as tables through the export menu.

Privacy. No analytics, no error reporting to third parties, no cookies other than those set by Cloudflare Access.

Security. No secrets in the client; the search service (Tier 2) accepts only sequences and enforces size limits; the Functions proxy serves only the release prefix for its instance.

Determinism. Two builds of the same catalog produce byte-identical releases except for the manifest timestamp. The synthetic generator is seeded.

Scale. Designed for 10,000 genomes at launch and 100,000 within the same design; beyond that the release layout is revisited.

## 10. Hosting and deployment

One Cloudflare Pages project per instance, on its `pages.dev` hostname until a custom domain is chosen. The application is static; a Pages Function bound to the R2 bucket forwards range requests for `releases/<release_id>/<group_id>/...` to the bucket, so the application and the data share one hostname and one Access policy. Cloudflare Access protects the hostname with an email allow-list per group. R2 holds the releases under `releases/<release_id>/` and `releases/<release_id>/<group_id>/`, with a pointer file `releases/current.json` per group naming the current release. Cache headers mark release files immutable (they never change under one `release_id`) and the pointer file short-lived. The DuckDB-WASM engine files exceed the Pages per-file limit and the Parquet extension would otherwise be fetched from the internet, so both are served from the bucket through a second Function at `/assets/`, uploaded by the deploy workflow; the application makes no request outside its origin.

Tier 2 service. The sequence search service runs on a server operated by the maintaining group and is connected to Cloudflare through a tunnel on a hostname of the project's domain, protected by an Access service token. Instances reach it only through a Pages Function at `/api/search/*`, so the browser never contacts the service's hostname and the service accepts requests from the Functions alone. When the service is unreachable the Function answers 503 and the Sequence search page shows the unavailable state.

Cost expectations. Pages free tier; R2 within the free storage tier for the first releases; Functions requests within the free daily quota for a handful of users, with the paid Workers plan as the fallback. A billing alert is set in the account before the first collaborator deployment. The internal setup document (`dev/cloudflare-setup.md`) gives the steps.

## 11. Release and deployment workflows

Two GitHub Actions workflows, never one.

`release.yml`, manual trigger with inputs `release_id` and optional `group_id`. Runs `catalejo release check`, `catalejo release build`, uploads to R2, updates the pointer file, and posts the release notes as a workflow summary. Requires the master catalog as an artifact or a mounted path (procedure in `dev/backup.md`).

`deploy.yml`, triggered by a tag `web-vX.Y.Z`. Builds `packages/web`, reads each instance's current manifest, fails if the manifest's schema version is outside the application's supported range, and deploys to each Pages project.

Both run the test suite first and use secrets stored in the repository settings. No workflow writes to git.

## 12. Documentation

12.1 Root `README.md`. What Catalejo is, a screenshot of the collection page, the tiers, links to the contract and the requirements, how to run the synthetic release locally, the license, the citation, and the AI-assisted development statement.

12.2 `packages/ingest/README.md`. Installation, the command reference, the expected mgap layout, the metadata table, the external inputs, and the release procedure.

12.3 `packages/web/README.md`. Development server, configuration, the strings module, the design tokens, and how pages read the manifest.

12.4 `docs/onboarding.md`. For collaborators, in English and Spanish. Logging in, reading the collection page, building a set, opening a genome, exporting a figure, and where the Methods page is.

12.5 AI-assisted development statement, in the README and the Methods page. "Catalejo was developed with the assistance of Claude (Anthropic) models under the direction of the maintaining group. Model versions used in each development milestone are recorded in an internal development log, available on request." Wording may be edited by the maintainer; the statement itself is required.

12.6 `CHANGELOG.md` for the application, and generated `NOTES.md` per data release, edited by hand.

## 13. Testing and quality

Ingest. Unit tests per parser on fixtures from the synthetic generator; a golden test that builds a release from the synthetic results and compares checksums; a validation test that every rule in the contract §9 fires on a deliberately broken fixture; the Parquet cross-read test that writes with DuckDB Python and reads with `@duckdb/duckdb-wasm` in Node.

Web. Component tests for the strings module (no literal text in components), the set encoding (round trip through the URL), the palette (every color from the file), and the summary sentence renderer. End-to-end tests with Playwright against the synthetic release for each acceptance item in §6, which is the executable form of the critic checklist.

Critic. A subagent that opens the running application with a browser, walks `docs/critic-checklist.md` for the pages in scope, records each item as pass, fail or not applicable with a screenshot, and never edits code. A milestone is complete when the critic passes all its items, the tests pass in CI, and the maintainer has reviewed the pull request.

Continuous integration. Lint, type check and tests on every pull request; the release and deploy workflows as §11.

## 14. Milestones

| Milestone | Deliverable | Done when |
|---|---|---|
| 0 | Repository bootstrap, toolchain, configuration files, CI skeleton, synthetic generator | Synthetic release builds and validates in CI |
| 1 | Ingest parsers for all mgap modules, metadata commands, release build, Parquet cross-read test; application shell and collection page | Collection page passes its acceptance items on the synthetic release, deployed to a `pages.dev` instance behind Access |
| 2 | Genome page, tombstone and not-found pages | Genome page acceptance items pass |
| 3 | Genome sets and Genes pages | Acceptance items pass; set round trip through URL and file |
| 4 | Phylogeny and Pangenome pages, pangenome and tree ingestion, cluster mapping | Acceptance items pass |
| 5 | Methods and Releases pages, exports with presets, onboarding guide, READMEs, first real release from an mgap run, first collaborator instance | A collaborator opens their instance |
| 6 | Embeddings page and similar genomes (Tier 1); projection computed at release build | Acceptance items pass on an embedding file of identifiers and vectors |
| 7 | Sequence search (Tier 2), requirements revision first | Deferred |

## 15. Open items

- The exact Playwright configuration for the critic (headless Chromium, viewport 1440 × 900) is stated in the build plan and may change with the Claude Code version.
