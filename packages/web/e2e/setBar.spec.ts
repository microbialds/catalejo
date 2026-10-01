// Requirements §5.1, §5.2, §5.8 against the synthetic release with the real
// engine: a filtered set is counted in the browser over the genome-grain
// files, an empty set replaces the main area, the add filter menu offers the
// release's values, the global search opens a genome, and nothing is
// requested outside the origin except Google Fonts.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { encodeFilters } from '../src/set/filters';
import { strings } from '../src/strings';

const ALLOWED_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);
const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  readFileSync(path.join(here, '..', '..', '..', 'releases', 'synth', 'manifest.json'), 'utf8'),
) as { species: { species_code: string; genome_count: number }[] };

test('set bar with the synthetic release', async ({ page, baseURL }) => {
  const origin = new URL(baseURL ?? '').origin;
  const foreign: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.protocol === 'data:' || url.protocol === 'blob:') return;
    if (url.origin !== origin && !ALLOWED_HOSTS.has(url.hostname)) foreign.push(request.url());
  });

  const kpn = manifest.species.find((species) => species.species_code === 'KPN');
  await page.goto(`/${encodeFilters({ species_code: ['KPN'] })}`);
  const bar = page.getByRole('banner', { name: strings.setBarLabel });
  await expect(bar.getByText(String(kpn?.genome_count), { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(bar.getByText('Klebsiella pneumoniae', { exact: true })).toBeVisible();

  await bar.getByRole('button', { name: strings.addFilter }).click();
  await page.getByRole('button', { name: strings.filterFieldSt }).click();
  await expect(page.getByRole('dialog').getByText('ST258', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.goto(`/genes${encodeFilters({ species_code: ['KPN'], country: ['ZZ'] })}`);
  const main = page.getByRole('main');
  await expect(main.getByText(strings.emptySetStatement)).toBeVisible({ timeout: 20_000 });
  await expect(main.getByRole('link', { name: strings.emptySetClearLast })).toBeVisible();

  await page.goto(`/${encodeFilters({ country: ['CL'] })}`);
  const search = bar.getByRole('combobox');
  await search.fill('KPN0002');
  await page.getByRole('option', { name: /KPN0002/ }).click({ timeout: 20_000 });
  await expect(page).toHaveURL(/\/genomes\/KPN0002\?q=/);

  await page.goto('/');
  await search.fill('KPN0001');
  await expect(page.getByRole('option', { name: /KPN0001/ })).toBeVisible({ timeout: 20_000 });
  await search.press('Enter');
  await expect(page).toHaveURL(/\/genomes\/KPN0001$/);

  expect(foreign).toEqual([]);
});
