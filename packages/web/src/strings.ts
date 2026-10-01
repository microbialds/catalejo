// Every user-visible string of the application (requirements §3). Components
// never contain literal interface text; test/strings.test.ts enforces it. A
// translation is one more module with the same keys.

/** A count and "genome" or "genomes"; `count` undefined (pending) reads as plural. */
function genomeCount(formatted: string, count: number | undefined): string {
  return count === 1 ? `${formatted} genome` : `${formatted} genomes`;
}

export const strings = {
  // Shell (requirements §5.1)
  wordmark: 'Catalejo',
  tagline: 'microbial genome collection',
  navigationLabel: 'Main navigation',
  navGroupExplore: 'Explore',
  navGroupAnalyze: 'Analyze',

  // Pages (CLAUDE.md, Vocabulary; routes in requirements §5.3)
  pageCollection: 'Collection',
  pageGenomeSets: 'Genome sets',
  pageGenomes: 'Genomes',
  pageGenes: 'Genes',
  pagePhylogeny: 'Phylogeny',
  pagePangenome: 'Pangenome',
  pageEmbeddings: 'Embeddings',
  pageSequenceSearch: 'Sequence search',
  pageMethods: 'Methods',
  pageReleases: 'Releases',

  // Shell at narrow widths (requirements §5.10)
  menuToggle: 'Menu',
  drawerToggle: 'Filters',

  // Navigation items for products absent from the release (requirements §5.1,
  // §5.7). The release identifier is interpolated.
  navAbsentPhylogeny: (releaseId: string) => `Release ${releaseId} does not include phylogenies.`,
  navAbsentPangenome: (releaseId: string) => `Release ${releaseId} does not include pangenomes.`,
  navAbsentEmbeddings: (releaseId: string) => `Release ${releaseId} does not include embeddings.`,
  navAbsentSequenceSearch: (releaseId: string) =>
    `Release ${releaseId} does not include sequence search.`,

  // Pages for products absent from the release (requirements §5.7)
  absentPhylogeny: (releaseId: string) => `No phylogeny is included in release ${releaseId}.`,
  absentPangenome: (releaseId: string) => `No pangenome is included in release ${releaseId}.`,
  absentEmbeddings: (releaseId: string) => `No embedding map is included in release ${releaseId}.`,
  absentSequenceSearch: (releaseId: string) =>
    `No sequence search is included in release ${releaseId}.`,
  absentMethodsLink: 'Methods',

  // Footer (requirements §5.1). The values arrive with the manifest.
  footerRelease: 'Release',
  footerGenomeCount: (formatted: string, count: number) => genomeCount(formatted, count),
  footerMethods: 'Methods',
  separator: ' · ',
  listSeparator: ', ',
  valuePending: '–',

  // Set bar (requirements §5.1, §5.2; collection board, top bar)
  setBarLabel: 'Current genome set',
  setBarPhrase: 'genomes in the current set',
  setBarPhraseOne: 'genome in the current set',
  activeFiltersLabel: 'Active filters',
  addFilter: '+ add filter',
  addFilterMenuLabel: 'Add filter',
  removeFilter: (label: string) => `Remove filter ${label}`,
  removeFilterGlyph: '×',
  completeOnly: 'Complete genomes only',
  shareLink: 'Share link',
  linkCopied: 'Link copied',
  linkCopyFailed: 'The link could not be copied',
  saveSet: 'Save set',
  saveSetFailed: 'The set could not be saved',
  savedSetName: 'genome set',
  savedSetFileName: (releaseId: string) => `catalejo-${releaseId}-genome-set.json`,

  // Filter chips (requirements §5.2; contract §7.5). The value follows the
  // field label; species, genes and identifiers are set apart by type.
  chipSt: (st: string) => (/^\d+$/.test(st) ? `ST${st}` : st),
  chipYear: (year: number) => `year ${String(year)}`,
  chipYearRange: (min: number, max: number) => `year ${String(min)}–${String(max)}`,
  chipYearFrom: (min: number) => `year ≥ ${String(min)}`,
  chipYearTo: (max: number) => `year ≤ ${String(max)}`,
  chipCompleteness: (value: string) => `completeness ≥ ${value}%`,
  chipContamination: (value: string) => `contamination ≤ ${value}%`,
  chipPlasmidContig: 'plasmid contig present',
  chipProphage: 'prophage present',
  chipGenomeIds: (formatted: string, count: number, list: string) =>
    `${genomeCount(formatted, count)} (${list})`,
  chipListMore: '…',
  chipPrefixSourceType: 'source',
  chipPrefixCountry: 'country',
  chipPrefixPlatform: 'platform',
  chipPrefixAssemblyStatus: 'assembly',
  chipPrefixDrugClass: 'class',
  chipPrefixMutation: 'mutation',
  chipPrefixReplicon: 'replicon',
  chipPrefixMob: 'MOB cluster',
  chipPrefixCluster: 'cluster',
  chipPrefixSet: 'set',

  // The "add filter" menu, in the order of contract §7.5
  filterFieldSpecies: 'Species',
  filterFieldSt: 'Sequence type',
  filterFieldSourceType: 'Source type',
  filterFieldCountry: 'Country',
  filterFieldYear: 'Year',
  filterFieldPlatform: 'Platform',
  filterFieldAssemblyStatus: 'Assembly status',
  filterFieldCompleteness: 'Completeness (minimum)',
  filterFieldContamination: 'Contamination (maximum)',
  filterFieldPresenceAmr: 'Resistance determinant',
  filterFieldDrugClass: 'Resistance by drug class',
  filterFieldMutation: 'Point mutation',
  filterFieldReplicon: 'Plasmid replicon',
  filterFieldPlasmidContig: 'Plasmid contig present',
  filterFieldPresenceMob: 'MOB cluster',
  filterFieldProphage: 'Prophage present',
  filterFieldCluster: 'Pangenome cluster',
  filterFieldSet: 'Curated set',
  filterFieldGenomeId: 'Genome identifiers',
  filterBack: 'All filters',
  filterApply: 'Apply',
  filterClose: 'Close',
  filterNarrow: 'Type to narrow the list',
  filterNarrowLabel: (field: string) => `Narrow the values of ${field}`,
  filterShownOf: (shown: string, total: string) => `${shown} of ${total} shown; type to narrow`,
  filterLoading: 'Loading values',
  filterLoadFailed: 'The values could not be loaded.',
  filterNoValues: 'No values in this release.',
  filterYearFrom: 'From',
  filterYearTo: 'To',
  filterPercent: 'Percent',
  filterCompletenessHint: 'Genomes with CheckM2 completeness at least this value.',
  filterContaminationHint: 'Genomes with CheckM2 contamination at most this value.',
  filterPlasmidContigHint: 'Genomes with at least one plasmid contig.',
  filterProphageHint: 'Genomes with at least one prophage region.',
  filterGenomeIdsHint: 'Genome identifiers, separated by spaces, commas or new lines.',
  filterClusterHint: 'Pangenome cluster identifiers, as KPN.2026-09.group_1234.',
  filterFieldAbsent: (releaseId: string) =>
    `Release ${releaseId} does not include the data for this filter.`,
  filterOptionCount: (count: string) => count,

  // Empty set (requirements §5.2)
  emptySetStatement: 'No genomes match the current filters.',
  emptySetClearLast: 'Clear the last filter',

  // Global search (requirements §5.8; collection board placeholder)
  searchLabel: 'Search',
  searchPlaceholder: 'Search genome ID, gene, product, ST',
  searchResultsLabel: 'Search results',
  searchLoading: 'Loading the search index',
  searchUnavailable: 'Search is unavailable for this release.',
  searchNoMatches: 'No matches',
  searchGenomeCount: (formatted: string, count: number) => genomeCount(formatted, count),
  searchGroupCount: (formatted: string) => formatted,
  searchKindGenome: 'Genomes',
  searchKindAccession: 'Accessions',
  searchKindGene: 'Gene symbols',
  searchKindElement: 'Elements',
  searchKindCluster: 'Pangenome clusters',
  searchKindProduct: 'Products',
  searchKindSt: 'Sequence types',

  // Annotation version warning (requirements §5.6)
  annotationVersionWarning: (bakta: string, amrfinderplus: string) =>
    `Genomes in this set were annotated with more than one database version (Bakta ${bakta}; AMRFinderPlus ${amrfinderplus}).`,
  annotationVersionMethods: 'Methods',

  // Manifest and schema (data contract §2, §6.4)
  manifestUnavailable: 'The release manifest could not be read, so the collection cannot be shown.',
  schemaMismatch: (found: string, range: string) =>
    `This release uses schema version ${found}, which this application does not support. Supported schema versions: ${range}.`,

  // Not found (requirements §6.11; the page with global search arrives in milestone 2)
  notFoundTitle: 'Page not found',
  notFoundStatement: 'No page exists at this address.',
  notFoundCollectionLink: 'Go to the collection',

  // Main area placeholder (milestone 0)
  placeholderStatement: 'This page arrives in a later milestone.',

  // Collection page (requirements §6.1; collection board)
  facetsLabel: 'Facets',
  facetSpecies: 'Species',
  facetSource: 'Source',
  facetMobile: 'Mobile elements',
  facetPlasmidContig: 'Plasmid contig',
  facetProphage: 'Prophage region',
  facetAmrClass: 'AMR class',
  facetAllClasses: (count: number) => `All ${String(count)} classes`,
  facetFewerClasses: 'Fewer classes',
  facetPlatform: 'Platform',
  facetAssemblyStatus: 'Assembly status',
  facetOptionName: (value: string, formatted: string, count: number | undefined) =>
    `${value}, ${genomeCount(formatted, count)} in the set`,
  countersLabel: 'Counts for the current set',
  counterGenomes: 'genomes in current set',
  counterGenomesOne: 'genome in current set',
  counterSpecies: 'species',
  counterSequenceTypes: 'sequence types',
  counterSequenceTypesOne: 'sequence type',
  counterAmrHits: 'resistance determinant hits',
  counterAmrHitsOne: 'resistance determinant hit',
  counterPlasmidContigs: 'plasmid contigs',
  counterPlasmidContigsOne: 'plasmid contig',
  panelSpecies: 'Species',
  panelSequenceTypes: 'Sequence types',
  panelAmrClass: 'AMR class by species',
  panelAmrClassUnit: '% of genomes',
  panelYear: 'Genomes by year',
  panelYearSubtitle: 'stacked by species',
  panelQc: 'Assembly QC',
  panelGenomes: 'Genomes',
  panelExpand: 'expand',
  panelCollapse: 'collapse',
  panelExpandName: (title: string) => `Expand ${title}`,
  panelCollapseName: (title: string) => `Collapse ${title}`,
  panelLoading: 'Loading',
  panelLoadFailed: 'The counts could not be loaded.',
  chartOther: 'Other',
  speciesBarName: (species: string, formatted: string, count: number) =>
    `${species}, ${genomeCount(formatted, count)}`,
  stOther: 'other',
  stBarName: (st: string, formatted: string, count: number) =>
    `${st}, ${genomeCount(formatted, count)}`,
  stOtherName: (formatted: string, count: number, stCount: string) =>
    `Other sequence types (${stCount}), ${genomeCount(formatted, count)}`,
  stUntyped: (count: string) => `${count} without an ST`,
  stNoScheme: 'No MLST scheme covers this species, so it has no sequence types.',
  heatmapNeedsWidth: 'The resistance class heatmap needs a wider screen.',
  heatmapNoHits: 'No genome in this set carries a resistance determinant.',
  heatmapCellName: (species: string, drugClass: string, percent: string) =>
    `${species}, ${drugClass}: ${percent}% of genomes`,
  heatmapPercent: (percent: string) => percent,
  footnoteMixedAssemblies:
    'This set mixes sequencing platforms or assembly statuses. Short-read assemblies fragment at repeats and undercount mobile elements.',
  yearUndated: (count: string) => `${count} without an isolation date not shown`,
  yearSegmentName: (species: string, year: number, formatted: string, count: number) =>
    `${species}, ${String(year)}: ${genomeCount(formatted, count)}`,
  yearColumnName: (year: number, formatted: string, count: number) =>
    `${String(year)}: ${genomeCount(formatted, count)}`,
  yearNoDates: 'No genome in this set has an isolation date.',
  qcFlagged: (count: string) => `${count} flagged`,
  qcMissing: (count: string) => `${count} without CheckM2 values not shown`,
  qcChartName: 'CheckM2 completeness against contamination for the genomes of the set',
  qcBrushDescription:
    'Drag a rectangle to keep genomes with at least its left completeness and at most its top contamination. Without a pointer, set Completeness and Contamination in the add filter menu.',
  qcAxisCompleteness: 'completeness',
  qcAxisContamination: 'contamination',
  qcTickPercent: (value: string) => `${value}%`,
  qcTickValue: (value: string) => value,
  qcNoPoints: 'No genome in this set has CheckM2 values.',

  // Genome table (requirements §6.1; collection board)
  tableColumnGenome: 'Genome',
  tableColumnSpecies: 'Species',
  tableColumnSt: 'ST',
  tableColumnSource: 'Source',
  tableColumnYear: 'Year',
  tableColumnAmr: 'AMR',
  tableColumnPlasmids: 'Plasmids',
  tableColumnCompleteness: 'Compl.',
  tableColumnCountry: 'Country',
  tableColumnPlatform: 'Platform',
  tableColumnAssemblyStatus: 'Assembly',
  tableColumnContamination: 'Contam.',
  tableColumnGenomeSize: 'Size',
  tableColumnContigs: 'Contigs',
  tableColumnN50: 'N50',
  tableColumnGc: 'GC',
  tableColumns: 'Columns',
  tableColumnsLabel: 'Columns shown in the table',
  tableSortBy: (column: string) => `Sort by ${column}`,
  tableSortedAscending: '▲',
  tableSortedDescending: '▼',
  tableSelectRow: (genomeId: string) => `Select ${genomeId}`,
  tableSelectPage: 'Select all rows on this page',
  tableSelected: (count: string) => `${count} selected`,
  tableClearSelection: 'Clear selection',
  useAsSet: 'Use as set',
  useAsSetConfirm: (formatted: string, count: number) =>
    `The current set becomes these ${genomeCount(formatted, count)}.`,
  useAsSetApply: 'Replace the set',
  useAsSetCancel: 'Cancel',
  tablePrevious: 'Previous',
  tableNext: 'Next',
  tablePageOf: (page: string, pages: string) => `page ${page} of ${pages}`,
  tablePagerLabel: 'Table pages',
  tableLoading: 'Loading genomes',
  tableLoadFailed: 'The genomes could not be loaded.',
  valueMissing: '–',
  valuePercent: (value: string) => `${value}%`,
  valueMegabases: (value: string) => `${value} Mb`,

  // Export menu (requirements §8; config/export-presets.yaml label_key).
  // Exports arrive in milestone 5.
  exportMenuLabel: 'Export',
  exportSingleColumn: 'Single column',
  exportOneAndHalfColumn: 'One and a half column',
  exportDoubleColumn: 'Double column',
  exportSlide: 'Slide',
  exportHighResolution: 'High resolution',
  exportFigureUnavailable: 'Figure export is not yet available in this version.',
  exportCsvShown: 'CSV of the rows shown',
  exportCsvSet: 'CSV of the whole set',
  exportTableUnavailable: 'Table export is not yet available in this version.',

  // Controlled vocabularies (data contract §4.2, §5.2)
  sourceTypeClinical: 'Clinical',
  sourceTypeEnvironmental: 'Environmental',
  sourceTypeFood: 'Food',
  sourceTypeAnimal: 'Animal',
  sourceTypeOther: 'Other',
  platformIllumina: 'Illumina',
  platformOnt: 'Oxford Nanopore',
  platformPacbio: 'PacBio',
  platformHybrid: 'Hybrid',
  assemblyStatusComplete: 'Complete',
  assemblyStatusDraft: 'Draft',

  // Short drug class labels for the heatmap columns (config/palette.yaml order)
  drugClassShortCarbapenem: 'Carbap.',
  drugClassShortBetaLactam: 'β-lact.',
  drugClassShortAminoglycoside: 'Aminog.',
  drugClassShortQuinolone: 'Quinol.',
  drugClassShortColistin: 'Colistin',
  drugClassShortTetracycline: 'Tetrac.',
  drugClassShortSulfonamide: 'Sulfon.',
  drugClassShortTrimethoprim: 'Trimeth.',
  drugClassShortPhenicol: 'Phenicol',
  drugClassShortMacrolide: 'Macrol.',
  drugClassShortFosfomycin: 'Fosfom.',
  drugClassShortGlycopeptide: 'Glycop.',
  drugClassShortRifamycin: 'Rifam.',
  drugClassShortOther: 'Other',

  // Drug classes (config/palette.yaml drug_classes.label_key)
  drugClassCarbapenem: 'Carbapenem',
  drugClassBetaLactam: 'Beta-lactam',
  drugClassAminoglycoside: 'Aminoglycoside',
  drugClassQuinolone: 'Quinolone',
  drugClassColistin: 'Colistin',
  drugClassTetracycline: 'Tetracycline',
  drugClassSulfonamide: 'Sulfonamide',
  drugClassTrimethoprim: 'Trimethoprim',
  drugClassPhenicol: 'Phenicol',
  drugClassMacrolide: 'Macrolide',
  drugClassFosfomycin: 'Fosfomycin',
  drugClassGlycopeptide: 'Glycopeptide',
  drugClassRifamycin: 'Rifamycin',
  drugClassOther: 'Other',
} as const;

export type Strings = typeof strings;
export type StringKey = keyof Strings;
