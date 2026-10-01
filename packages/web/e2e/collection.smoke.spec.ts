// Smoke test of the collection page (requirements §6.1) on the synthetic
// release: the counters equal the species summaries for the whole release,
// the panels and the table render, the "Other" group holds the two smallest
// species, a species bar adds its chip, and the ST panel of Serratia
// marcescens states that it has no scheme. The full C1 to C8 suite follows.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { strings } from '../src/strings';

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  readFileSync(path.join(here, '..', '..', '..', 'releases', 'synth', 'manifest.json'), 'utf8'),
) as { genome_count: number; species: { species_code: string; genome_count: number }[] };

test('collection page renders on the synthetic release', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto('/');
  const main = page.getByRole('main');
  const counters = main.getByLabel(strings.countersLabel);
  await expect(counters.getByRole('definition').first()).toHaveText(String(manifest.genome_count), {
    timeout: 30_000,
  });
  await expect(counters.getByRole('definition').nth(1)).toHaveText(String(manifest.species.length));

  for (const name of [
    strings.panelSpecies,
    strings.panelAmrClass,
    strings.panelYear,
    strings.panelQc,
  ]) {
    await expect(main.getByRole('region', { name, exact: true })).toBeVisible();
  }
  await expect(
    main.getByRole('region', { name: /^Sequence types Klebsiella pneumoniae/ }),
  ).toBeVisible();
  await expect(
    main.getByRole('table', { name: strings.panelGenomes }).getByRole('row'),
  ).toHaveCount(51);

  const species = main.getByRole('region', { name: strings.panelSpecies, exact: true });
  await expect(
    species.getByRole('button', { name: strings.speciesBarName(strings.chartOther, '7', 7) }),
  ).toBeVisible();

  await species
    .getByRole('button', { name: strings.speciesBarName('Serratia marcescens', '9', 9) })
    .click();
  const bar = page.getByRole('banner', { name: strings.setBarLabel });
  await expect(bar.getByText('Serratia marcescens', { exact: true })).toBeVisible();
  await expect(main.getByText(strings.stNoScheme)).toBeVisible({ timeout: 20_000 });
  expect(errors).toEqual([]);
});
