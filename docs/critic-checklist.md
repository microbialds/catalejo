# Critic checklist

Derived from `docs/requirements.md`. Each item has an identifier, the requirement section it comes from, the milestone in which it first applies, and the check. The critic agent walks the items in scope for a run and reports pass, fail or not applicable with evidence. Items are added when requirements are added; identifiers are never renumbered.

## G. Global (every run, from milestone 1)

| Id | Ref | Check |
|---|---|---|
| G1 | §3 | No rendered page contains the word "cohort"; the embedding page and its links use "Embeddings" and "embedding map", never "atlas" |
| G2 | §3, §7 | Species names are italic wherever they appear; genome identifiers, coordinates, counts in tables, counters and gene names are monospace; gene and allele names are italic |
| G3 | §5.4, §7 | No color on the page is outside `config/palette.yaml` and the chrome tokens; the chrome is achromatic; links in running text are underlined at rest, and links in tables, chips, pills, the facet rail, navigation, footer, panel titles and controls are underlined on hover and focus |
| G4 | §7 | Square corners, hairline borders, no shadows, no gradients, no icon-only navigation, no dark sidebar |
| G5 | §5.1 | The shell shows the wordmark and tagline, the two navigation groups in the stated order, the release footer with the Methods link, and the active page marked by the accent rule |
| G6 | §5.1 | The set bar shows the count as a large numeral, "genomes in the current set", filter chips, "add filter", "Share link" and "Save set" |
| G7 | §5.1, §5.7 | Navigation items for products absent from the manifest are disabled with the tooltip; pages for absent products show the absence statement, never an error |
| G8 | §5.2 | With filters selecting zero genomes, every page shows the empty-set message with the active filters and a link to clear the last one |
| G9 | §5.3 | Reloading any page with its query string reproduces the same set and view; route changes preserve the query |
| G10 | §5.8 | The global search resolves a genome identifier, a gene symbol, an element name, a product substring and an ST, groups results by kind, and navigates directly on a single exact genome match |
| G11 | §5.9 | Species names, genome identifiers, gene names, STs, MOB clusters and tree identifiers are links to the stated targets |
| G12 | §5.10 | At 1024 px the facet rail is a drawer and panel rows stack; at 390 px (collection and genome pages) navigation collapses, tables scroll inside their panel, width-dependent visualizations show the note, and headers, counters, summary sentence, pills and downloads remain usable |
| G13 | §5.6 | With the synthetic mixed-version species in the set, prevalence charts and the resistance heatmap show the annotation version warning with the versions and the Methods link |
| G14 | §9 | No network request leaves the application's origin other than to Google Fonts; no cookies other than Cloudflare Access when deployed |

## C. Collection (milestone 1)

| Id | Ref | Check |
|---|---|---|
| C1 | §6.1 | The five counters equal the summary counts for the whole release, and the counts computed over the genome-grain files for a filtered set |
| C2 | §6.1 | Clicking a species bar, a heatmap cell, a facet value and a year each adds the corresponding filter chip |
| C3 | §6.1 | Brushing the QC scatter adds completeness and contamination filters |
| C4 | §6.1 | Facet counts update within 300 ms of a filter change on the synthetic release |
| C5 | §6.1 | The table sorts, pages by 50, selects rows, and "Use as set" on a selection yields the selected identifiers |
| C6 | §6.1 | Each panel expands full-width and shows the export menu |
| C7 | §6.1 | With more than eight species, the smallest are grouped as "Other" in charts but not in tables or chips |
| C8 | §6.1 | A species with no ST scheme shows the ST panel statement instead of bars |

## S. Genome sets (milestone 3)

| Id | Ref | Check |
|---|---|---|
| S1 | §6.2 | A set built from two filters shows the same count on this page and on the collection page |
| S2 | §6.2 | "Save set" downloads the exchange file; "Load set" with a file from another release reports present and missing identifiers and applies the filters |
| S3 | §6.2 | The heatmap and the tree highlight the same genome when hovered in either |
| S4 | §6.2 | The heatmap switches between resistance determinants and pangenome clusters (within one species) and clusters both axes |
| S5 | §6.2 | Above 2,000 genomes the heatmap shows the cap message |
| S6 | §6.2 | Curated sets open with name and description in the set bar |

## N. Genome (milestone 2)

| Id | Ref | Check |
|---|---|---|
| N1 | §6.3 | The header shows the italic species name, the ST chip, the species source note, the summary sentence with linked determinants, typing chips per `config/typing_display.yaml`, and the six counters |
| N2 | §6.3, §7.4 | The summary sentence matches the template for the genome's facts; every gene in it links to the Genes page; a genome with no determinants and no plasmid uses the fallback template |
| N3 | §6.3 | Selecting a feature in the table highlights it on the map and scrolls the table; selecting on the map does the same in reverse; the neighborhood strip fills |
| N4 | §6.3 | Contig selection redraws the map and filters the table; track toggles hide and show tracks |
| N5 | §6.3, §5.5 | A complete genome opens in the circular view; a draft genome opens in the linear view with contigs by length and dividers, and location labels carry "(predicted)" |
| N6 | §6.3 | Resistance pills are grouped by replicon with the contig type colors; clicking a pill selects the feature; a genome without determinants shows the statement |
| N7 | §6.3 | Point mutations appear in the pills and in the table with the variant string |
| N8 | §6.3 | The neighborhood strip shows eight features each side, colored by category, with hover details and coordinates in the header; "Compare across the current set" opens the Genes page with the set |
| N9 | §6.3 | Downloads (GBFF, GFF3, FASTA, proteins) produce the files for this genome only |
| N10 | §6.3, §6.11 | A tombstoned identifier renders the tombstone page with reason and replacement; an unknown identifier renders the not-found page with search |
| N11 | §6.3 | "Add to set" adds the identifier to an explicit list and the set bar count increments |

## E. Genes (milestone 3)

| Id | Ref | Check |
|---|---|---|
| E1 | §6.4 | Searching an element name, a Bakta symbol and a cluster name each resolves and shows the matched namespace; the header shows all three names where known |
| E2 | §6.4 | Carrier counts equal the presence file column sums for the current set and for the release |
| E3 | §6.4 | The location bar shows chromosome, plasmid, prophage and unclassified, with "(predicted)" only for draft carriers |
| E4 | §6.4 | The variant table appears for a gene with point mutations and lists them by genome |
| E5 | §6.4 | The neighborhood comparison aligns the focal feature in every row, colors identical flanks identically, draws links for shared clusters, sorts by species, ST and plasmid cluster, and shows the cap message above 200 genomes |
| E6 | §6.4 | The carriers table offers "Use as set" |

## P. Phylogeny (milestone 4)

| Id | Ref | Check |
|---|---|---|
| P1 | §6.5 | The selector lists trees per species with alignment type and reference; the caption states tools, model, alignment type, reference, genome count and date |
| P2 | §6.5 | Tips in the current set are colored, others grayed; the prune toggle keeps topology among remaining tips |
| P3 | §6.5 | Clade selection with "Use as set" yields exactly the clade's tips |
| P4 | §6.5 | Tip click opens the genome page; coloring by a categorical column and up to four metadata strips work |
| P5 | §6.5, §8 | Export produces SVG and Newick |

## A. Pangenome (milestone 4)

| Id | Ref | Check |
|---|---|---|
| A1 | §6.6 | Counters equal the `pangenome_species` row; rarefaction and accumulation curves render from the summary |
| A2 | §6.6 | Clicking a cluster opens the Genes page in the cluster namespace |
| A3 | §6.6 | The mapping panel appears only when a previous release exists and shows the mapping counts |

## M. Methods, Releases, exports, documentation (milestone 5)

| Id | Ref | Check |
|---|---|---|
| M1 | §6.9 | The Methods page lists every item in §6.9 from the manifest and configuration, including the AI-assisted development statement and the origin of the name |
| M2 | §6.10 | The Releases page shows the current release and its notes with previous notes below; no switching control exists |
| M3 | §8 | Every chart, map, tree and heatmap has the export menu with the five presets; SVG keeps text as text; PNG sizes match the preset; the sidecar carries release identifier, page, filters, preset and data |
| M4 | §8 | Table exports produce CSV of the shown rows and of the whole set |
| M5 | §12 | README, package READMEs and the onboarding guide exist, commands in them run, and the onboarding guide has English and Spanish sections |

## B. Embeddings (milestone 6)

| Id | Ref | Check |
|---|---|---|
| B1 | §6.7 | The map renders on the dark panel with the lifted palette, the toolbar (model when several, color by, lasso, reset), the legend and the projection parameters |
| B2 | §6.7 | Lasso selection count equals the "Use as set" result; points outside the current set are dimmed |
| B3 | §6.7 | Hover shows the card with the stated fields and a link; click fills the nearest list ordered by vector distance |
| B4 | §6.7 | The right column shows composition by species, resistance class prevalence as paired bars against the current set, and the nearest genomes |
| B5 | §6.7 | Coloring by platform separates the planted fragmented assemblies on the synthetic release |
| B6 | §6.7 | "Similar genomes" on the genome page opens the map with that genome selected |

## Q. Sequence search (milestone 7, after requirements revision)

Items to be written with the Tier 2 requirements.
