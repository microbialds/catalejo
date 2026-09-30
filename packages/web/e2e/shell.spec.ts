// Requirements §5.1, §7, §9: the placeholder shell renders both navigation
// groups in order, marks Collection at / with the accent rule, sets the
// wordmark in Source Serif 4, and requests nothing outside the origin except
// Google Fonts.
import { expect, test } from '@playwright/test';
import { strings } from '../src/strings';
import { tokens } from '../src/generated/tokens';

const ALLOWED_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);

test('shell navigation, wordmark font and same-origin requests', async ({ page, baseURL }) => {
  const origin = new URL(baseURL ?? '').origin;
  const foreign: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.protocol === 'data:' || url.protocol === 'blob:') return;
    if (url.origin !== origin && !ALLOWED_HOSTS.has(url.hostname)) foreign.push(request.url());
  });

  await page.goto('/');
  await expect(page).toHaveTitle(strings.wordmark);

  const nav = page.getByRole('navigation', { name: strings.navigationLabel });
  const groups = nav.getByRole('group');
  await expect(groups).toHaveCount(2);
  await expect(groups.nth(0)).toHaveAccessibleName(strings.navGroupExplore);
  await expect(groups.nth(1)).toHaveAccessibleName(strings.navGroupAnalyze);
  await expect(groups.nth(0).getByRole('link')).toHaveText([
    strings.pageCollection,
    strings.pageGenomeSets,
    strings.pageGenomes,
    strings.pageGenes,
  ]);
  await expect(groups.nth(1).getByRole('link')).toHaveText([
    strings.pagePhylogeny,
    strings.pagePangenome,
    strings.pageEmbeddings,
    strings.pageSequenceSearch,
  ]);

  const active = nav.locator('a[aria-current="page"]');
  await expect(active).toHaveCount(1);
  await expect(active).toHaveText(strings.pageCollection);
  const rule = await active.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      width: style.borderLeftWidth,
      style: style.borderLeftStyle,
      color: style.borderLeftColor,
      weight: style.fontWeight,
    };
  });
  const accent = await page.evaluate((hex) => {
    const probe = document.createElement('span');
    probe.style.color = hex;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, tokens.color.accent);
  expect(rule).toEqual({ width: '3px', style: 'solid', color: accent, weight: '600' });

  const wordmark = page.getByText(strings.wordmark, { exact: true });
  const family = await wordmark.evaluate((element) => getComputedStyle(element).fontFamily);
  expect(family.replace(/["']/g, '').split(',')[0]?.trim()).toBe('Source Serif 4');

  await page.waitForLoadState('networkidle').catch(() => undefined);
  expect(foreign).toEqual([]);
});
