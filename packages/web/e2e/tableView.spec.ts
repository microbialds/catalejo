// The genome table's view in the URL (requirements §5.3, §6.1; checklist C5)
// on the synthetic release: `sort=`, `page=` and `cols=` follow the set
// parameters, survive a reload and a route change between / and /genomes,
// each change is a history entry, and a change of set returns to the first
// page while keeping the sort and the columns. Expected rows are read in
// Node from tables/genome.parquet (e2e/support/synth.ts).
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { DEFAULT_COLUMN_IDS } from '../src/collection/genomeTable';
import { formatCount } from '../src/format';
import { strings } from '../src/strings';
import {
  collectionReady,
  expectBarChip,
  facetOption,
  genomeTable,
  genomesReady,
  navigation,
  openFacets,
  openMenu,
  pager,
  panel,
  tableIds,
  urlFilters,
} from './support/page';
import { manifest, openSynthDatabase, parquet } from './support/synth';
import type { SynthDatabase } from './support/synth';

let db: SynthDatabase;

test.beforeAll(async () => {
  // A cold DuckDB-WASM instance loads the parquet extension from the local repository.
  test.setTimeout(120_000);
  db = await openSynthDatabase();
});

test.afterAll(async () => {
  await db.close();
});

const GENOME = parquet('tables/genome.parquet');

function ids(sql: string): string[] {
  return db.rows(sql).map((row) => String(row.genome_id));
}

function params(page: Page): URLSearchParams {
  return new URL(page.url()).searchParams;
}

function amrHeader(page: Page) {
  const sortName = strings.tableSortBy(strings.tableColumnAmr);
  return genomeTable(page)
    .getByRole('columnheader')
    .filter({ has: page.getByRole('button', { name: sortName, exact: true }) });
}

function n50Header(page: Page) {
  return genomeTable(page).getByRole('columnheader', {
    name: strings.tableSortBy(strings.tableColumnN50),
  });
}

const BY_AMR = 'ORDER BY amr_gene_count DESC NULLS LAST, genome_id';
const WITH_N50 = [...DEFAULT_COLUMN_IDS, 'n50'];

/** On the collection page: sort by AMR descending, go to page 2, add N50. */
async function setUpView(page: Page): Promise<void> {
  await page.goto('/');
  await collectionReady(page);
  await genomeTable(page)
    .getByRole('button', { name: strings.tableSortBy(strings.tableColumnAmr), exact: true })
    .click();
  await expect(amrHeader(page)).toHaveAttribute('aria-sort', 'descending');
  expect(params(page).get('sort')).toBe('amr_gene_count:desc');
  await pager(page).getByRole('button', { name: strings.tableNext, exact: true }).click();
  await expect.poll(() => params(page).get('page')).toBe('2');
  const genomesPanel = panel(page, strings.panelGenomes);
  await genomesPanel.getByRole('button', { name: strings.tableColumns, exact: true }).click();
  await genomesPanel
    .getByRole('group', { name: strings.tableColumnsLabel, exact: true })
    .getByRole('checkbox', { name: strings.tableColumnN50, exact: true })
    .check();
  await expect.poll(() => params(page).get('cols')).toBe(WITH_N50.join(','));
  await page.keyboard.press('Escape');
}

test('the sort, the page and the columns survive a reload, and a new set returns to page 1', async ({
  page,
}) => {
  await setUpView(page);
  const pages = Math.ceil(manifest.genome_count / 50);
  expect(new URL(page.url()).search).toBe(
    `?sort=amr_gene_count:desc&page=2&cols=${WITH_N50.join(',')}`,
  );

  await page.reload();
  await collectionReady(page);
  await expect(amrHeader(page)).toHaveAttribute('aria-sort', 'descending');
  await expect(pager(page)).toContainText(strings.tablePageOf('2', formatCount(pages)));
  await expect(n50Header(page)).toBeVisible();
  await expect
    .poll(() => tableIds(page))
    .toEqual(ids(`SELECT genome_id FROM ${GENOME} ${BY_AMR} LIMIT 50 OFFSET 50`));

  // A filter is a new set: back to the first page, same sort and columns.
  const rail = await openFacets(page);
  await facetOption(rail, strings.sourceTypeClinical).check();
  await expectBarChip(page, `${strings.chipPrefixSourceType} ${strings.sourceTypeClinical}`);
  expect(urlFilters(page)).toEqual({ source_type: ['clinical'] });
  expect(params(page).get('page')).toBeNull();
  expect(params(page).get('sort')).toBe('amr_gene_count:desc');
  expect(params(page).get('cols')).toBe(WITH_N50.join(','));
  // The set parameters come first.
  expect(new URL(page.url()).search.startsWith('?q=')).toBe(true);
  await collectionReady(page);
  const clinical =
    db.numbers(`SELECT count(*) AS n FROM ${GENOME} WHERE source_type = 'clinical'`).n ?? 0;
  await expect(pager(page)).toContainText(
    strings.tablePageOf('1', formatCount(Math.max(1, Math.ceil(clinical / 50)))),
  );
  await expect(amrHeader(page)).toHaveAttribute('aria-sort', 'descending');
  await expect(n50Header(page)).toBeVisible();
  await expect
    .poll(() => tableIds(page))
    .toEqual(
      ids(`SELECT genome_id FROM ${GENOME} WHERE source_type = 'clinical' ${BY_AMR} LIMIT 50`),
    );

  // Back returns to the whole release on page 2.
  await page.goBack();
  await expect.poll(() => params(page).get('page')).toBe('2');
  expect(urlFilters(page)).toEqual({});
  await expect(pager(page)).toContainText(strings.tablePageOf('2', formatCount(pages)));
});

test('each change of the view is a history entry', async ({ page }) => {
  await setUpView(page);
  await page.goBack();
  await expect.poll(() => params(page).get('cols')).toBeNull();
  await expect(n50Header(page)).toHaveCount(0);
  expect(params(page).get('page')).toBe('2');
  await page.goBack();
  await expect.poll(() => params(page).get('page')).toBeNull();
  expect(params(page).get('sort')).toBe('amr_gene_count:desc');
  await page.goBack();
  await expect.poll(() => params(page).get('sort')).toBeNull();
  await expect(amrHeader(page)).not.toHaveAttribute('aria-sort', /./);
});

test('the view carries over to /genomes and applies there', async ({ page }) => {
  await setUpView(page);
  await openMenu(page);
  await navigation(page).getByRole('link', { name: strings.pageGenomes, exact: true }).click();
  await expect(page).toHaveURL(/\/genomes\?/);
  await genomesReady(page);
  expect(params(page).get('sort')).toBe('amr_gene_count:desc');
  expect(params(page).get('page')).toBe('2');
  await expect(amrHeader(page)).toHaveAttribute('aria-sort', 'descending');
  await expect(n50Header(page)).toBeVisible();
  await expect
    .poll(() => tableIds(page))
    .toEqual(ids(`SELECT genome_id FROM ${GENOME} ${BY_AMR} LIMIT 50 OFFSET 50`));
});

test('bad view parameters are ignored', async ({ page }) => {
  await page.goto('/genomes?sort=typing:desc&page=zero&cols=nonsense');
  await genomesReady(page);
  await expect(genomeTable(page).locator('[aria-sort]')).toHaveCount(0);
  await expect(pager(page)).toContainText(
    strings.tablePageOf('1', formatCount(Math.ceil(manifest.genome_count / 50))),
  );
  await expect(
    genomeTable(page).getByRole('columnheader', { name: strings.tableColumnTyping }),
  ).toBeVisible();
  expect(await tableIds(page)).toEqual(
    ids(`SELECT genome_id FROM ${GENOME} ORDER BY genome_id LIMIT 50`),
  );
});
