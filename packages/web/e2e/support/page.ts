// Page helpers shared by the Playwright specs: the shell's landmarks by their
// accessible names from src/strings.ts, the controls that exist only at
// narrow widths (the "Menu" toggle below 900 px, the "Filters" drawer toggle
// below 1200 px, requirements §5.10), the current set decoded from the URL
// (§5.3), and a recorder of every request the page makes (§9).
import { expect } from '@playwright/test';
import type { BrowserContext, Locator, Page, TestInfo } from '@playwright/test';
import { decodeFilters } from '../../src/set/filters';
import type { GenomeFilters } from '../../src/set/filters';
import { strings } from '../../src/strings';

export const ALLOWED_HOSTS: ReadonlySet<string> = new Set([
  'fonts.googleapis.com',
  'fonts.gstatic.com',
]);

export type Width = 1440 | 1024 | 390;

/** The viewport width of the running project. */
export function widthOf(testInfo: TestInfo): Width {
  const width = testInfo.project.use.viewport?.width;
  if (width === 1440 || width === 1024 || width === 390) return width;
  throw new Error(`unexpected project ${testInfo.project.name}`);
}

export function setBar(page: Page): Locator {
  return page.getByRole('banner', { name: strings.setBarLabel });
}

export function mainArea(page: Page): Locator {
  return page.getByRole('main');
}

export function navigation(page: Page): Locator {
  return page.getByRole('navigation', { name: strings.navigationLabel });
}

export function facetRail(page: Page): Locator {
  return page.getByRole('complementary', { name: strings.facetsLabel });
}

export function counters(page: Page): Locator {
  return mainArea(page).getByLabel(strings.countersLabel);
}

/** The panel of the collection page with this accessible name. */
export function panel(page: Page, name: string | RegExp): Locator {
  return mainArea(page).getByRole('region', { name, exact: typeof name === 'string' });
}

/** The large numeral of the set bar. */
export function setCount(page: Page): Locator {
  return setBar(page).locator('[aria-live="polite"][aria-atomic="true"]');
}

/** Waits until the set bar count is known and returns it. */
export async function settledSetCount(page: Page): Promise<number> {
  const count = setCount(page);
  await expect(count).not.toHaveText(strings.valuePending, { timeout: 30_000 });
  return Number((await count.innerText()).replace(/,/g, ''));
}

/** Waits until the collection page shows its counters and the first table page. */
export async function collectionReady(page: Page): Promise<void> {
  await expect(counters(page).getByRole('definition').first()).not.toHaveText(
    strings.valuePending,
    { timeout: 30_000 },
  );
  await expect(
    mainArea(page).getByRole('table', { name: strings.panelGenomes, exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await settledSetCount(page);
}

/** The genome table, on the collection page or the genome list page. */
export function genomeTable(page: Page): Locator {
  return mainArea(page).getByRole('table', { name: strings.panelGenomes, exact: true });
}

/** The pager of the genome table. */
export function pager(page: Page): Locator {
  return mainArea(page).getByRole('navigation', { name: strings.tablePagerLabel });
}

/** The genome identifiers of the table rows, in order. */
export async function tableIds(page: Page): Promise<string[]> {
  return genomeTable(page)
    .locator('tbody tr')
    .evaluateAll((rows) => rows.map((row) => row.children[1]?.textContent.trim() ?? ''));
}

/** Waits until the genome list page (/genomes) shows its first table page. */
export async function genomesReady(page: Page): Promise<void> {
  await expect(genomeTable(page)).toBeVisible({ timeout: 30_000 });
  await expect(genomeTable(page).locator('tbody tr').first()).toBeVisible({ timeout: 30_000 });
  await settledSetCount(page);
}

/** The five counter values, in order, as numbers. */
export async function counterValues(page: Page): Promise<number[]> {
  const texts = await counters(page).getByRole('definition').allInnerTexts();
  return texts.map((text) => Number(text.replace(/,/g, '')));
}

/** Opens the navigation menu when it is collapsed (below 900 px). */
export async function openMenu(page: Page): Promise<void> {
  const toggle = page.getByRole('button', { name: strings.menuToggle, exact: true });
  if ((await toggle.isVisible()) && (await toggle.getAttribute('aria-expanded')) === 'false') {
    await toggle.click();
  }
  await expect(navigation(page)).toBeVisible();
}

/** Opens the facet drawer when the facet rail is one (below 1200 px). */
export async function openFacets(page: Page): Promise<Locator> {
  const toggle = setBar(page).getByRole('button', { name: strings.drawerToggle, exact: true });
  if ((await toggle.isVisible()) && (await toggle.getAttribute('aria-expanded')) === 'false') {
    await toggle.click();
  }
  const rail = facetRail(page);
  await expect(rail).toBeVisible();
  return rail;
}

/** The facet checkbox of a value, by the value as shown. */
export function facetOption(rail: Locator, value: string): Locator {
  return rail.getByRole('checkbox', {
    name: new RegExp(`^${escapeRegExp(value)}, [\\d,]+ genomes in the set$`),
  });
}

/** The remove control of the chip whose label is `text` (prefix and value). */
export function chipRemove(scope: Locator, text: string): Locator {
  return scope.getByRole('button', { name: strings.removeFilter(text), exact: true });
}

/** The filters of the current URL. */
export function urlFilters(page: Page): GenomeFilters {
  return decodeFilters(new URL(page.url()).search);
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface RequestLog {
  /** Every requested URL other than data: and blob: URLs. */
  urls: string[];
  /** The URLs whose origin is neither the page's nor Google Fonts. */
  foreign(): string[];
}

/** Records every request of a browser context, the page and its workers included. */
export function recordRequests(context: BrowserContext, baseURL: string | undefined): RequestLog {
  const origin = new URL(baseURL ?? '').origin;
  const urls: string[] = [];
  context.on('request', (request) => {
    const url = new URL(request.url());
    if (url.protocol === 'data:' || url.protocol === 'blob:') return;
    urls.push(request.url());
  });
  return {
    urls,
    foreign: () =>
      urls.filter((raw) => {
        const url = new URL(raw);
        return url.origin !== origin && !ALLOWED_HOSTS.has(url.hostname);
      }),
  };
}
