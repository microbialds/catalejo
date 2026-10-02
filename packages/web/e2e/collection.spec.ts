// Checklist C1 to C8 (docs/critic-checklist.md; requirements §6.1, §5.2,
// §5.4, §5.10, §8) on the collection page of the synthetic release, at 1440,
// 1024 and 390 px. Expected values are read in Node from the release: the
// manifest, the species summaries, and counts over the genome-grain files
// with DuckDB-WASM's Node build (e2e/support/synth.ts), never from the page.
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { GENOME_COLUMNS } from '../src/collection/genomeTable';
import { formatCount } from '../src/format';
import { exportPresets, platformConfig } from '../src/generated/platform';
import { palette } from '../src/generated/palette';
import { compareText, encodeFilters } from '../src/set/filters';
import type { GenomeFilters } from '../src/set/filters';
import { strings } from '../src/strings';
import {
  chipRemove,
  collectionReady,
  counterValues,
  escapeRegExp,
  facetOption,
  genomeTable,
  mainArea,
  openFacets,
  pager,
  panel,
  setBar,
  setCount,
  settledSetCount,
  tableIds,
  urlFilters,
  widthOf,
} from './support/page';
import { manifest, openSynthDatabase, parquet, species } from './support/synth';
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

function stPanelName(code: string): string {
  return `${strings.panelSequenceTypes} ${species(code).canonical_name}`;
}

/** The counters computed in Node over tables/genome.parquet for a WHERE clause. */
function genomeGrainCounters(where: string): number[] {
  const row = db.numbers(
    `SELECT count(*) AS genomes, count(DISTINCT species_code) AS species, ` +
      `count(DISTINCT species_code || ':' || st) AS sts, ` +
      `coalesce(sum(amr_gene_count), 0) AS amr, ` +
      `coalesce(sum(plasmid_contig_count), 0) AS plasmids FROM ${GENOME} WHERE ${where}`,
  );
  return [row.genomes ?? 0, row.species ?? 0, row.sts ?? 0, row.amr ?? 0, row.plasmids ?? 0];
}

test('C1 counters equal the summaries for the release and genome-grain counts for a set', async ({
  page,
}) => {
  const summary = db.numbers(
    `SELECT sum(genome_count) AS genomes, count(*) FILTER (WHERE genome_count > 0) AS species, ` +
      `sum(st_count) AS sts, sum(amr_hit_count) AS amr, ` +
      `sum(plasmid_contig_count) AS plasmids ` +
      `FROM ${parquet('summaries/counts_by_species.parquet')}`,
  );
  expect(summary.genomes).toBe(manifest.genome_count);
  expect(summary.species).toBe(manifest.species.length);
  await page.goto('/');
  await collectionReady(page);
  expect(await counterValues(page)).toEqual([
    summary.genomes,
    summary.species,
    summary.sts,
    summary.amr,
    summary.plasmids,
  ]);

  const sets: [GenomeFilters, string][] = [
    [
      { species_code: ['KPN'], year: { min: 2018, max: 2022 } },
      `species_code = 'KPN' AND year(isolation_date) BETWEEN 2018 AND 2022`,
    ],
    [{ source_type: ['clinical'] }, `source_type = 'clinical'`],
    [
      { presence_amr: ['blaKPC-2'] },
      `genome_id IN (SELECT genome_id FROM ${parquet('presence_amr.parquet')} WHERE "blaKPC-2")`,
    ],
  ];
  for (const [filters, where] of sets) {
    const expected = genomeGrainCounters(where);
    expect(expected[0], `genomes for ${JSON.stringify(filters)}`).toBeGreaterThan(0);
    expect(expected[0]).toBeLessThan(manifest.genome_count);
    await page.goto(`/${encodeFilters(filters)}`);
    await collectionReady(page);
    await expect.poll(() => counterValues(page), { timeout: 20_000 }).toEqual(expected);
    expect(await settledSetCount(page)).toBe(expected[0]);
  }
});

test.describe('C2 clicking a chart element or a facet value adds its chip', () => {
  test('a species bar', async ({ page }) => {
    const sau = species('SAU');
    await page.goto('/');
    await collectionReady(page);
    await panel(page, strings.panelSpecies)
      .getByRole('button', {
        name: strings.speciesBarName(
          sau.canonical_name,
          formatCount(sau.genome_count),
          sau.genome_count,
        ),
      })
      .click();
    await expect(chipRemove(setBar(page), sau.canonical_name)).toBeVisible();
    expect(urlFilters(page)).toEqual({ species_code: ['SAU'] });
    await expect(setCount(page)).toHaveText(formatCount(sau.genome_count));
  });

  test('a heatmap cell', async ({ page }, testInfo) => {
    test.skip(
      widthOf(testInfo) === 390,
      'below 900 px the heatmap is replaced by the wide-screen note (requirements §5.10)',
    );
    const kpn = species('KPN');
    await page.goto('/');
    await collectionReady(page);
    const heatmap = mainArea(page).getByRole('table', { name: strings.panelAmrClass });
    const cell = heatmap
      .getByRole('button', { name: new RegExp(`^${escapeRegExp(kpn.canonical_name)}, `) })
      .first();
    const name = (await cell.getAttribute('aria-label')) ?? '';
    const label = /^[^,]+, (.+): \d+% of genomes$/.exec(name)?.[1] ?? '';
    const drugClass = palette.drug_classes.find((entry) => strings[entry.label_key] === label);
    expect(drugClass, `drug class of "${name}"`).toBeDefined();
    await cell.click();
    expect(urlFilters(page)).toEqual({
      drug_class: [drugClass?.key],
      species_code: ['KPN'],
    });
    await expect(chipRemove(setBar(page), kpn.canonical_name)).toBeVisible();
    await expect(chipRemove(setBar(page), `${strings.chipPrefixDrugClass} ${label}`)).toBeVisible();
  });

  test('a facet value', async ({ page }) => {
    await page.goto('/');
    await collectionReady(page);
    const rail = await openFacets(page);
    await facetOption(rail, strings.sourceTypeClinical).check();
    await expect(
      chipRemove(setBar(page), `${strings.chipPrefixSourceType} ${strings.sourceTypeClinical}`),
    ).toBeVisible();
    expect(urlFilters(page)).toEqual({ source_type: ['clinical'] });
  });

  test('a year', async ({ page }) => {
    await page.goto('/');
    await collectionReady(page);
    const year = panel(page, strings.panelYear)
      .getByRole('button', { name: /^\d{4}: [\d,]+ genomes?$/ })
      .first();
    const value = Number(((await year.getAttribute('aria-label')) ?? '').slice(0, 4));
    await year.click();
    await expect(chipRemove(setBar(page), strings.chipYear(value))).toBeVisible();
    expect(urlFilters(page)).toEqual({ year: { max: value, min: value } });
    const expected = db.numbers(
      `SELECT count(*) AS n FROM ${GENOME} WHERE year(isolation_date) = ${String(value)}`,
    );
    expect(await settledSetCount(page)).toBe(expected.n);
  });
});

test.describe('C2 a bar, a heatmap cell or a year replaces the values of the fields it names', () => {
  // Requirements §6.1 (0.7): "narrows the set to the clicked element,
  // replacing the values already chosen in the fields it names". The cases
  // are the critic's round 3 reproductions.
  test('a heatmap cell replaces the drug class already chosen', async ({ page }, testInfo) => {
    test.skip(
      widthOf(testInfo) === 390,
      'below 900 px the heatmap is replaced by the wide-screen note (requirements §5.10)',
    );
    const sen = species('SEN');
    await page.goto(`/${encodeFilters({ drug_class: ['aminoglycoside'] })}`);
    await collectionReady(page);
    const heatmap = mainArea(page).getByRole('table', { name: strings.panelAmrClass });
    await heatmap
      .getByRole('button', {
        name: new RegExp(
          `^${escapeRegExp(`${sen.canonical_name}, ${strings.drugClassQuinolone}: `)}`,
        ),
      })
      .click();
    await expect
      .poll(() => urlFilters(page))
      .toEqual({
        drug_class: ['quinolone'],
        species_code: ['SEN'],
      });
    await expect(
      chipRemove(setBar(page), `${strings.chipPrefixDrugClass} ${strings.drugClassAminoglycoside}`),
    ).toHaveCount(0);
    const expected = db.numbers(
      `SELECT count(DISTINCT genome_id) AS n FROM ${parquet('summaries/amr_class_by_genome.parquet')} ` +
        `WHERE species_code = 'SEN' AND drug_class = 'quinolone'`,
    );
    expect(await settledSetCount(page)).toBe(expected.n);
  });

  test('an ST bar replaces the STs already chosen', async ({ page }) => {
    await page.goto(`/${encodeFilters({ species_code: ['KPN'], st: ['147', '258'] })}`);
    await collectionReady(page);
    await panel(page, stPanelName('KPN'))
      .getByRole('button', { name: new RegExp(`^${escapeRegExp(strings.chipSt('258'))}, `) })
      .click();
    await expect.poll(() => urlFilters(page)).toEqual({ species_code: ['KPN'], st: ['258'] });
    const expected = db.numbers(
      `SELECT count(*) AS n FROM ${GENOME} WHERE species_code = 'KPN' AND st = '258'`,
    );
    expect(await settledSetCount(page)).toBe(expected.n);
  });

  test('a year segment sets its species and its year; a year label only the year', async ({
    page,
  }) => {
    const kpn = species('KPN');
    await page.goto(
      `/${encodeFilters({ species_code: ['KPN', 'SEN'], year: { min: 2015, max: 2018 } })}`,
    );
    await collectionReady(page);
    const years = panel(page, strings.panelYear);
    const segment = years
      .getByRole('button', { name: new RegExp(`^${escapeRegExp(kpn.canonical_name)}, \\d{4}: `) })
      .first();
    const name = (await segment.getAttribute('aria-label')) ?? '';
    const value = Number(/, (\d{4}): /.exec(name)?.[1]);
    await segment.click();
    await expect
      .poll(() => urlFilters(page))
      .toEqual({
        species_code: ['KPN'],
        year: { max: value, min: value },
      });

    await page.goto(
      `/${encodeFilters({ species_code: ['KPN', 'SEN'], year: { min: 2015, max: 2018 } })}`,
    );
    await collectionReady(page);
    const label = years.getByRole('button', { name: /^\d{4}: / }).first();
    const labelYear = Number(((await label.getAttribute('aria-label')) ?? '').slice(0, 4));
    await label.click();
    await expect
      .poll(() => urlFilters(page))
      .toEqual({
        species_code: ['KPN', 'SEN'],
        year: { max: labelYear, min: labelYear },
      });
  });

  test('a facet value still adds an alternative', async ({ page }) => {
    await page.goto(`/${encodeFilters({ species_code: ['KPN'] })}`);
    await collectionReady(page);
    const rail = await openFacets(page);
    await facetOption(rail, species('SEN').canonical_name).check();
    await expect.poll(() => urlFilters(page)).toEqual({ species_code: ['KPN', 'SEN'] });
  });
});

test('a press that dismisses the drawer or the Columns popover activates nothing under it', async ({
  page,
}, testInfo) => {
  // Critic round 3, observation 4 (requirements §5.10, §6.1, §9).
  const width = widthOf(testInfo);
  test.skip(
    width === 390,
    'the heatmap is not drawn below 900 px; the menu case is in global.spec.ts',
  );
  await page.goto('/');
  await collectionReady(page);
  const heatmap = mainArea(page).getByRole('table', { name: strings.panelAmrClass });
  const cell = heatmap.getByRole('row').nth(1).getByRole('button').last();
  if (width === 1024) {
    const toggle = setBar(page).getByRole('button', { name: strings.drawerToggle, exact: true });
    await openFacets(page);
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await cell.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(urlFilters(page)).toEqual({});
    expect(new URL(page.url()).search).toBe('');
  }
  // The Columns popover of the genome table, at both widths.
  const columns = mainArea(page).getByRole('button', { name: strings.tableColumns, exact: true });
  await columns.click();
  await expect(columns).toHaveAttribute('aria-expanded', 'true');
  await cell.click();
  await expect(columns).toHaveAttribute('aria-expanded', 'false');
  expect(new URL(page.url()).search).toBe('');
  // With nothing open, the same click applies the cell.
  await cell.click();
  await expect
    .poll(() => Object.keys(urlFilters(page)).sort())
    .toEqual(['drug_class', 'species_code']);
});

/** The chip text of a percent bound, as set/fields.ts formats it. */
function percent(value: number): string {
  return String(Number(value.toFixed(2)));
}

test('C3 brushing the QC scatter adds completeness and contamination filters', async ({ page }) => {
  await page.goto('/');
  await collectionReady(page);
  const plot = panel(page, strings.panelQc).getByRole('img', { name: strings.qcChartName });
  await expect(plot).toBeVisible();
  // Mouse coordinates are in the viewport, so the plot must be in view.
  await plot.scrollIntoViewIfNeeded();
  const box = await plot.boundingBox();
  if (box === null) throw new Error('the QC plot has no box');
  // The plot area inside the axis margins of QcPanel (left 30, right 10, top 4, bottom 16).
  const left = box.x + 30;
  const top = box.y + 4;
  const width = box.width - 40;
  const height = box.height - 20;
  await page.mouse.move(left + width * 0.1, top + height * 0.05);
  await page.mouse.down();
  await page.mouse.move(left + width * 0.6, top + height * 0.5, { steps: 8 });
  await page.mouse.move(left + width * 0.95, top + height * 0.95, { steps: 8 });
  await page.mouse.up();

  await expect.poll(() => urlFilters(page).completeness_min).toBeDefined();
  const filters = urlFilters(page);
  const completeness = filters.completeness_min ?? Number.NaN;
  const contamination = filters.contamination_max ?? Number.NaN;
  expect(Number.isFinite(completeness)).toBe(true);
  expect(Number.isFinite(contamination)).toBe(true);
  expect(Object.keys(filters).sort()).toEqual(['completeness_min', 'contamination_max']);
  const bar = setBar(page);
  await expect(chipRemove(bar, strings.chipCompleteness(percent(completeness)))).toBeVisible();
  await expect(chipRemove(bar, strings.chipContamination(percent(contamination)))).toBeVisible();
  const expected = db.numbers(
    `SELECT count(*) AS n FROM ${GENOME} WHERE checkm2_completeness >= ${String(completeness)} ` +
      `AND checkm2_contamination <= ${String(contamination)}`,
  );
  expect(await settledSetCount(page)).toBe(expected.n);
});

test('C4 facet counts update within 300 ms of a filter change', async ({ page }) => {
  await page.goto('/');
  await collectionReady(page);
  const rail = await openFacets(page);
  // Each step changes the counts of other facets on the synthetic release.
  const steps: [string, boolean][] = [
    [strings.sourceTypeClinical, true],
    [strings.sourceTypeEnvironmental, true],
    [strings.platformIllumina, true],
    [strings.sourceTypeClinical, false],
    [strings.platformIllumina, false],
  ];
  const timings: number[] = [];
  for (const [value, checked] of steps) {
    const option = facetOption(rail, value);
    await expect(option).toBeChecked({ checked: !checked });
    const name = (await option.getAttribute('aria-label')) ?? '';
    // The observer starts in the page before the click and stops at the
    // first change of any count text in the rail.
    const elapsed = await rail.evaluate(
      (root, label) =>
        new Promise<number>((resolve, reject) => {
          const counts = () =>
            [...root.querySelectorAll('label > span:last-child')]
              .map((span) => span.textContent)
              .join('|');
          const input = [...root.querySelectorAll('input[type="checkbox"]')].find(
            (element) => element.getAttribute('aria-label') === label,
          );
          if (!(input instanceof HTMLInputElement)) {
            reject(new Error(`no checkbox ${label}`));
            return;
          }
          const before = counts();
          const timer = window.setTimeout(() => {
            observer.disconnect();
            reject(new Error('the facet counts did not change within 20 s'));
          }, 20_000);
          const observer = new MutationObserver(() => {
            if (counts() === before) return;
            const end = performance.now();
            observer.disconnect();
            window.clearTimeout(timer);
            resolve(end - start);
          });
          observer.observe(root, { subtree: true, childList: true, characterData: true });
          const start = performance.now();
          input.click();
        }),
      name,
    );
    timings.push(elapsed);
    await expect(option).toBeChecked({ checked });
    await settledSetCount(page);
  }
  test.info().annotations.push({
    type: 'C4 timings (ms)',
    description: timings.map((time) => time.toFixed(1)).join(', '),
  });
  const [first, ...later] = timings;
  test.info().annotations.push({
    type: 'C4 first change (ms, may include building the genome tables)',
    description: (first ?? Number.NaN).toFixed(1),
  });
  for (const time of later) expect(time).toBeLessThan(300);
});

test('C5 the table sorts, pages by 50, selects rows and "Use as set" yields them', async ({
  page,
}) => {
  await page.goto('/');
  await collectionReady(page);
  const table = genomeTable(page);
  await expect(table.locator('tbody tr')).toHaveCount(50);
  expect(await tableIds(page)).toEqual(
    ids(`SELECT genome_id FROM ${GENOME} ORDER BY genome_id LIMIT 50`),
  );

  // The column chooser (§6.1) closes on Escape, returning the focus to its
  // button, and on a pointer down outside it (§9), so it never keeps
  // covering the first rows.
  const genomesPanel = panel(page, strings.panelGenomes);
  const columns = genomesPanel.getByRole('button', { name: strings.tableColumns, exact: true });
  const chooser = genomesPanel.getByRole('group', { name: strings.tableColumnsLabel, exact: true });
  await columns.click();
  await expect(chooser).toBeVisible();
  await expect(chooser.getByRole('checkbox')).toHaveCount(GENOME_COLUMNS.length);
  await chooser.getByRole('checkbox').nth(1).focus();
  await page.keyboard.press('Escape');
  await expect(chooser).toBeHidden();
  await expect(columns).toBeFocused();
  await expect(columns).toHaveAttribute('aria-expanded', 'false');
  await columns.click();
  await expect(chooser).toBeVisible();
  await genomesPanel.getByRole('heading', { name: strings.panelGenomes, exact: true }).click();
  await expect(chooser).toBeHidden();
  const firstRow = table.getByRole('checkbox', {
    name: strings.tableSelectRow((await tableIds(page))[0] ?? ''),
    exact: true,
  });
  await firstRow.check();
  await firstRow.uncheck();

  // Sorting: counts sort descending first, then ascending.
  const sortName = strings.tableSortBy(strings.tableColumnAmr);
  const sort = table.getByRole('button', { name: sortName, exact: true });
  const header = table
    .getByRole('columnheader')
    .filter({ has: page.getByRole('button', { name: sortName, exact: true }) });
  await sort.click();
  await expect(header).toHaveAttribute('aria-sort', 'descending');
  const descending = ids(
    `SELECT genome_id FROM ${GENOME} ORDER BY amr_gene_count DESC NULLS LAST, genome_id LIMIT 50`,
  );
  await expect.poll(() => tableIds(page)).toEqual(descending);
  await sort.click();
  await expect(header).toHaveAttribute('aria-sort', 'ascending');
  await expect
    .poll(() => tableIds(page))
    .toEqual(
      ids(
        `SELECT genome_id FROM ${GENOME} ORDER BY amr_gene_count ASC NULLS LAST, genome_id LIMIT 50`,
      ),
    );

  // Paging by 50: page 2 holds rows 51 to 100.
  await page.goto('/');
  await collectionReady(page);
  const pages = Math.ceil(manifest.genome_count / 50);
  await expect(pager(page)).toContainText(strings.tablePageOf('1', formatCount(pages)));
  await pager(page).getByRole('button', { name: strings.tableNext, exact: true }).click();
  await expect(pager(page)).toContainText(strings.tablePageOf('2', formatCount(pages)));
  const second = ids(`SELECT genome_id FROM ${GENOME} ORDER BY genome_id LIMIT 50 OFFSET 50`);
  await expect.poll(() => tableIds(page)).toEqual(second);

  // Selection across pages.
  const pageTwo = second.slice(0, 2);
  for (const id of pageTwo) {
    await table.getByRole('checkbox', { name: strings.tableSelectRow(id), exact: true }).check();
  }
  await pager(page).getByRole('button', { name: strings.tablePrevious, exact: true }).click();
  await expect(pager(page)).toContainText(strings.tablePageOf('1', formatCount(pages)));
  const first = (await tableIds(page))[2] ?? '';
  await table.getByRole('checkbox', { name: strings.tableSelectRow(first), exact: true }).check();
  const selected = [...pageTwo, first].sort(compareText);
  const panelRegion = panel(page, strings.panelGenomes);
  await expect(panelRegion.getByRole('status')).toHaveText(
    strings.tableSelected(formatCount(selected.length)),
  );

  await panelRegion.getByRole('button', { name: strings.useAsSet, exact: true }).click();
  const confirm = panelRegion.getByRole('alertdialog', { name: strings.useAsSet });
  await expect(confirm).toContainText(
    strings.useAsSetConfirm(formatCount(selected.length), selected.length),
  );
  await confirm.getByRole('button', { name: strings.useAsSetApply, exact: true }).click();

  await expect(setCount(page)).toHaveText(formatCount(selected.length));
  const url = new URL(page.url());
  expect(url.searchParams.get('ids')?.split(',')).toEqual(selected);
  expect(url.searchParams.get('q')).toBeNull();
  expect(urlFilters(page)).toEqual({ genome_id: selected });
  await collectionReady(page);
  await expect.poll(() => tableIds(page)).toEqual(selected);
});

/** The narrowest a panel may be beside an expanded one, where the row is wider. */
const MIN_PANEL_WIDTH = 320;

/** The accessible names of heatmap cells whose value is wider than the cell. */
async function overflowingHeatmapCells(page: Page): Promise<string[]> {
  return panel(page, strings.panelAmrClass)
    .getByRole('cell')
    .locator('button')
    .evaluateAll((buttons) =>
      buttons
        .filter((button) => button.scrollWidth > button.clientWidth)
        .map((button) => button.getAttribute('aria-label') ?? ''),
    );
}

/** The widths of the other panels in the panel's row group, and the row's content width. */
async function siblingPanelWidths(region: Locator): Promise<{ row: number; others: number[] }> {
  return region.evaluate((element) => {
    const parent = element.parentElement;
    if (parent === null) return { row: 0, others: [] };
    const style = getComputedStyle(parent);
    const row = parent.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const others = [...parent.children]
      .filter((child) => child !== element && child.tagName === 'SECTION')
      .map((child) => child.getBoundingClientRect().width);
    return { row, others };
  });
}

test('C6 each panel expands to full width with the export menu', async ({ page }, testInfo) => {
  await page.goto('/');
  await collectionReady(page);
  const figure = exportPresets.map((preset) => strings[preset.labelKey]);
  const tableExports = [strings.exportCsvShown, strings.exportCsvSet];
  const largest = [...manifest.species].sort(
    (a, b) => b.genome_count - a.genome_count || compareText(a.species_code, b.species_code),
  )[0];
  const panels: [string, string[]][] = [
    [strings.panelSpecies, figure],
    [stPanelName(largest?.species_code ?? ''), figure],
    [strings.panelAmrClass, figure],
    [strings.panelYear, figure],
    [strings.panelQc, figure],
    [strings.panelGenomes, tableExports],
  ];
  const widths = async (region: Locator) =>
    region.evaluate((element) => {
      // The row is the content box of the panel's container.
      const parent = element.parentElement;
      const style = parent === null ? undefined : getComputedStyle(parent);
      const padding =
        style === undefined ? 0 : parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      return {
        own: element.getBoundingClientRect().width,
        row: (parent?.clientWidth ?? 0) - padding,
      };
    });
  for (const [name, entries] of panels) {
    const region = panel(page, name);
    const exportMenu = region.getByRole('group', { name: strings.exportMenuLabel });
    await expect(exportMenu).toHaveCount(0);
    const before = await widths(region);
    await region.getByRole('button', { name: strings.panelExpandName(name), exact: true }).click();
    const collapse = region.getByRole('button', {
      name: strings.panelCollapseName(name),
      exact: true,
    });
    await expect(collapse).toHaveAttribute('aria-expanded', 'true');
    await expect(exportMenu).toBeVisible();
    await expect(exportMenu.getByRole('button')).toHaveText(entries);
    const expanded = await widths(region);
    expect(Math.abs(expanded.own - expanded.row), `${name} spans its row`).toBeLessThan(1);
    // The other panels of the row group flow below at a usable width (§6.1, §5.10).
    const siblings = await siblingPanelWidths(region);
    for (const other of siblings.others) {
      expect(other, `a panel beside the expanded ${name}`).toBeGreaterThanOrEqual(
        Math.min(MIN_PANEL_WIDTH, siblings.row) - 1,
      );
    }
    expect(await overflowingHeatmapCells(page), `heatmap cells with ${name} expanded`).toEqual([]);
    if (widthOf(testInfo) === 1440 && name !== strings.panelGenomes) {
      expect(before.own, `${name} is narrower than its row before expanding`).toBeLessThan(
        before.row - 1,
      );
    }
    await collapse.click();
    await expect(exportMenu).toHaveCount(0);
    await expect(
      region.getByRole('button', { name: strings.panelExpandName(name), exact: true }),
    ).toHaveAttribute('aria-expanded', 'false');
    const after = await widths(region);
    expect(Math.abs(after.own - before.own)).toBeLessThan(1);
  }
  expect(await overflowingHeatmapCells(page), 'heatmap cells at rest').toEqual([]);
});

test('C6 heatmap values stay inside their cells from 1200 to 1440 px', async ({
  page,
}, testInfo) => {
  // The panel rows keep three columns down to the drawer breakpoint (1200 px),
  // where the heatmap panel is narrowest; the 1440 project covers the range.
  test.skip(widthOf(testInfo) !== 1440, 'the three-column rows exist from 1200 px up');
  await page.goto('/');
  await collectionReady(page);
  const heatmap = panel(page, strings.panelAmrClass);
  await expect(heatmap.getByRole('table', { name: strings.panelAmrClass })).toBeVisible();
  const largest = [...manifest.species].sort(
    (a, b) => b.genome_count - a.genome_count || compareText(a.species_code, b.species_code),
  )[0];
  const panels = [
    strings.panelSpecies,
    stPanelName(largest?.species_code ?? ''),
    strings.panelAmrClass,
    strings.panelYear,
    strings.panelQc,
  ];
  for (const width of [1440, 1360, 1280, 1200]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await overflowingHeatmapCells(page), `at rest at ${String(width)} px`).toEqual([]);
    for (const name of panels) {
      const region = panel(page, name);
      await region
        .getByRole('button', { name: strings.panelExpandName(name), exact: true })
        .click();
      const collapse = region.getByRole('button', {
        name: strings.panelCollapseName(name),
        exact: true,
      });
      await expect(collapse).toHaveAttribute('aria-expanded', 'true');
      expect(
        await overflowingHeatmapCells(page),
        `${name} expanded at ${String(width)} px`,
      ).toEqual([]);
      await collapse.click();
      await expect(collapse).toHaveCount(0);
    }
  }
});

test('C7 the smallest species are "Other" in charts, not in the table, facets or chips', async ({
  page,
}, testInfo) => {
  const ranked = [...manifest.species].sort(
    (a, b) => b.genome_count - a.genome_count || compareText(a.species_code, b.species_code),
  );
  expect(ranked.length).toBeGreaterThan(platformConfig.chartSpeciesMax);
  const other = ranked.slice(platformConfig.chartSpeciesMax);
  expect(other.map((row) => row.species_code).sort()).toEqual(['EHO', 'SPN']);
  const otherCount = other.reduce((total, row) => total + row.genome_count, 0);

  await page.goto('/');
  await collectionReady(page);
  const bars = panel(page, strings.panelSpecies);
  await expect(
    bars.getByRole('button', {
      name: strings.speciesBarName(strings.chartOther, formatCount(otherCount), otherCount),
      exact: true,
    }),
  ).toBeVisible();
  await expect(bars.getByRole('button', { name: /, [\d,]+ genomes$/ })).toHaveCount(
    platformConfig.chartSpeciesMax + 1,
  );
  const years = panel(page, strings.panelYear);
  await expect(
    years.getByRole('button', { name: new RegExp(`^${strings.chartOther}, \\d{4}: `) }).first(),
  ).toBeAttached();
  for (const row of other) {
    const name = new RegExp(`^${escapeRegExp(row.canonical_name)}, `);
    await expect(bars.getByRole('button', { name })).toHaveCount(0);
    await expect(years.getByRole('button', { name })).toHaveCount(0);
  }
  if (widthOf(testInfo) !== 390) {
    const heatmap = mainArea(page).getByRole('table', { name: strings.panelAmrClass });
    await expect(
      heatmap.getByRole('rowheader').filter({ hasText: strings.chartOther }),
    ).toHaveCount(1);
    for (const row of other) {
      await expect(heatmap.locator(`[title="${row.canonical_name}"]`)).toHaveCount(0);
    }
  }

  // The table lists them individually (both pages of the release).
  const tableSpecies = async () =>
    genomeTable(page)
      .locator('tbody tr td:nth-child(3) [title]')
      .evaluateAll((elements) => elements.map((element) => element.getAttribute('title') ?? ''));
  const seen = new Set(await tableSpecies());
  await pager(page).getByRole('button', { name: strings.tableNext, exact: true }).click();
  await expect(pager(page)).toContainText(strings.tablePageOf('2', '2'));
  await expect.poll(async () => (await tableSpecies()).length).toBe(manifest.genome_count - 50);
  for (const name of await tableSpecies()) seen.add(name);
  for (const row of other) expect(seen.has(row.canonical_name), row.canonical_name).toBe(true);

  // The facet lists them individually, and a chip names the species in full.
  const rail = await openFacets(page);
  for (const row of other) {
    await expect(
      rail.getByRole('checkbox', {
        name: strings.facetOptionName(
          row.canonical_name,
          formatCount(row.genome_count),
          row.genome_count,
        ),
        exact: true,
      }),
    ).toBeVisible();
  }
  const spn = species('SPN');
  await facetOption(rail, spn.canonical_name).check();
  await expect(chipRemove(setBar(page), spn.canonical_name)).toBeVisible();
  await expect(
    setBar(page)
      .getByRole('list', { name: strings.activeFiltersLabel })
      .getByText(spn.canonical_name, { exact: true }),
  ).toBeVisible();
  expect(urlFilters(page)).toEqual({ species_code: ['SPN'] });
});

test('C8 a species without an ST scheme shows the statement instead of bars', async ({ page }) => {
  const typed = db.numbers(
    `SELECT count(st) AS typed, count(*) AS genomes FROM ${GENOME} WHERE species_code = 'SMA'`,
  );
  expect(typed).toEqual({ typed: 0, genomes: species('SMA').genome_count });
  await page.goto(`/${encodeFilters({ species_code: ['SMA'] })}`);
  await collectionReady(page);
  const region = panel(page, stPanelName('SMA'));
  await expect(region.getByText(strings.stNoScheme, { exact: true })).toBeVisible();
  await expect(region.getByRole('list')).toHaveCount(0);
  await expect(region.getByRole('button', { name: /, [\d,]+ genomes$/ })).toHaveCount(0);

  // A species with a scheme shows bars, for contrast.
  await page.goto(`/${encodeFilters({ species_code: ['KPN'] })}`);
  await collectionReady(page);
  const kpn = panel(page, stPanelName('KPN'));
  await expect(kpn.getByRole('button', { name: /^ST\d+, [\d,]+ genomes$/ }).first()).toBeVisible();
  await expect(kpn.getByText(strings.stNoScheme)).toHaveCount(0);
});
