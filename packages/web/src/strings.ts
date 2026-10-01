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

  // Set bar (requirements §5.1, §5.2)
  setBarLabel: 'Current genome set',
  setBarPhrase: 'genomes in the current set',

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
