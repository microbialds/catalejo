// Every user-visible string of the application (requirements §3). Components
// never contain literal interface text; test/strings.test.ts enforces it. A
// translation is one more module with the same keys.

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
  footerGenomeCount: (formatted: string, count: number) =>
    count === 1 ? `${formatted} genome` : `${formatted} genomes`,
  footerMethods: 'Methods',
  separator: ' · ',
  listSeparator: ', ',
  valuePending: '–',

  // Set bar (requirements §5.1, §5.2; collection board, top bar)
  setBarLabel: 'Current genome set',
  setBarPhrase: 'genomes in the current set',
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
  chipYearRange: (min: number, max: number) => `year ${String(min)}–${String(max)}`,
  chipYearFrom: (min: number) => `year ≥ ${String(min)}`,
  chipYearTo: (max: number) => `year ≤ ${String(max)}`,
  chipCompleteness: (value: string) => `completeness ≥ ${value}%`,
  chipContamination: (value: string) => `contamination ≤ ${value}%`,
  chipPlasmidContig: 'plasmid contig present',
  chipProphage: 'prophage present',
  chipGenomeIds: (count: string, list: string) => `${count} genomes (${list})`,
  chipGenomeId: (list: string) => `1 genome (${list})`,
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
  searchGenomeCount: (formatted: string, count: number) =>
    count === 1 ? `${formatted} genome` : `${formatted} genomes`,
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
