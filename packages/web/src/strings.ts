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

  // Footer (requirements §5.1). The values arrive with the manifest.
  footerRelease: 'Release',
  footerGenomes: 'genomes',
  footerPipeline: 'pipeline',
  footerMethods: 'Methods',
  separator: ' · ',
  valuePending: '–',

  // Set bar (requirements §5.1, §5.2)
  setBarLabel: 'Current genome set',
  setBarPhrase: 'genomes in the current set',

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
