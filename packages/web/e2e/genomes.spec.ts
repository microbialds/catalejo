// The genome list page, /genomes (requirements §5.3 "the collection table,
// full page", §6.1 Controls, §5.1, §5.10; checklist C5, G5, G12) on the
// synthetic release: the table alone, without the facet rail or its drawer,
// with the Genomes navigation item active; 50 rows a page in identifier
// order, sorting by a count column, and "Use as set" replacing the set with
// the selected identifiers after the confirmation. Expected rows are read in
// Node from tables/genome.parquet (e2e/support/synth.ts). The layout checks
// hold at 1440, 1024 and 390 px; the 390 project runs this file only when
// playwright.config.ts lists it.
import { expect, test } from '@playwright/test';
import { formatCount } from '../src/format';
import { compareText } from '../src/set/filters';
import { strings } from '../src/strings';
import {
  facetRail,
  genomeTable,
  genomesReady,
  mainArea,
  navigation,
  openMenu,
  pager,
  panel,
  setBar,
  setCount,
  tableIds,
  urlFilters,
  widthOf,
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

test('the genome list shows the table alone with the Genomes item active', async ({
  page,
}, testInfo) => {
  await page.goto('/genomes');
  await genomesReady(page);
  await expect(page.getByRole('heading', { level: 1, name: strings.pageGenomes })).toBeAttached();
  await expect(facetRail(page)).toHaveCount(0);
  await expect(
    setBar(page).getByRole('button', { name: strings.drawerToggle, exact: true }),
  ).toHaveCount(0);
  await expect(mainArea(page).getByLabel(strings.countersLabel)).toHaveCount(0);
  const region = panel(page, strings.panelGenomes);
  await expect(region.getByRole('button', { name: /^Expand / })).toHaveCount(0);
  await expect(
    region.getByRole('group', { name: strings.exportMenuLabel }).getByRole('button'),
  ).toHaveText([strings.exportCsvShown, strings.exportCsvSet]);

  // The navigation marks Genomes (behind the menu below 900 px).
  if (widthOf(testInfo) === 390) await openMenu(page);
  const item = navigation(page).getByRole('link', { name: strings.pageGenomes, exact: true });
  await expect(item).toHaveAttribute('aria-current', 'page');
  await expect(navigation(page).locator('[aria-current="page"]')).toHaveCount(1);

  // The page never scrolls sideways; a table wider than its panel scrolls inside it.
  const pageWidth = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(pageWidth.scrollWidth).toBeLessThanOrEqual(pageWidth.innerWidth);
  const overflowX = await genomeTable(page).evaluate((element) =>
    element.parentElement === null ? '' : getComputedStyle(element.parentElement).overflowX,
  );
  expect(overflowX).toBe('auto');
});

test('the genome list pages by 50 and sorts', async ({ page }) => {
  await page.goto('/genomes');
  await genomesReady(page);
  const table = genomeTable(page);
  await expect(table.locator('tbody tr')).toHaveCount(50);
  expect(await tableIds(page)).toEqual(
    ids(`SELECT genome_id FROM ${GENOME} ORDER BY genome_id LIMIT 50`),
  );

  const pages = Math.ceil(manifest.genome_count / 50);
  await expect(pager(page)).toContainText(strings.tablePageOf('1', formatCount(pages)));
  await pager(page).getByRole('button', { name: strings.tableNext, exact: true }).click();
  await expect(pager(page)).toContainText(strings.tablePageOf('2', formatCount(pages)));
  await expect
    .poll(() => tableIds(page))
    .toEqual(ids(`SELECT genome_id FROM ${GENOME} ORDER BY genome_id LIMIT 50 OFFSET 50`));

  // Sorting returns to the first page; counts sort descending first.
  const sortName = strings.tableSortBy(strings.tableColumnAmr);
  const header = table
    .getByRole('columnheader')
    .filter({ has: page.getByRole('button', { name: sortName, exact: true }) });
  await table.getByRole('button', { name: sortName, exact: true }).click();
  await expect(header).toHaveAttribute('aria-sort', 'descending');
  await expect(pager(page)).toContainText(strings.tablePageOf('1', formatCount(pages)));
  await expect
    .poll(() => tableIds(page))
    .toEqual(
      ids(
        `SELECT genome_id FROM ${GENOME} ORDER BY amr_gene_count DESC NULLS LAST, genome_id LIMIT 50`,
      ),
    );
  expect(new URL(page.url()).pathname).toBe('/genomes');
});

test('"Use as set" on the genome list replaces the set with the selection', async ({ page }) => {
  await page.goto('/genomes');
  await genomesReady(page);
  const table = genomeTable(page);
  const shown = await tableIds(page);
  const chosen = [shown[4] ?? '', shown[1] ?? ''];
  for (const id of chosen) {
    await table.getByRole('checkbox', { name: strings.tableSelectRow(id), exact: true }).check();
  }
  const region = panel(page, strings.panelGenomes);
  await expect(region.getByRole('status')).toHaveText(strings.tableSelected('2'));
  await region.getByRole('button', { name: strings.useAsSet, exact: true }).click();
  const confirm = region.getByRole('alertdialog', { name: strings.useAsSet });
  await expect(confirm).toContainText(strings.useAsSetConfirm('2', 2));
  await confirm.getByRole('button', { name: strings.useAsSetApply, exact: true }).click();

  const selected = [...chosen].sort(compareText);
  await expect(setCount(page)).toHaveText('2');
  expect(new URL(page.url()).pathname).toBe('/genomes');
  expect(urlFilters(page)).toEqual({ genome_id: selected });
  await expect.poll(() => tableIds(page)).toEqual(selected);
});
