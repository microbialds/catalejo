// Checklist G1 to G14 (docs/critic-checklist.md; requirements §3, §5.1 to
// §5.10, §7, §9) against the synthetic release served by the development
// server, at 1440, 1024 and 390 px. Interface text comes from src/strings.ts
// and expected values from releases/synth/manifest.json; the search terms of
// G10 are values of the synthetic release's search index. Parts that apply at
// one width only skip the other projects by name.
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { formatCount, formatPipeline } from '../src/format';
import { palette } from '../src/generated/palette';
import { tokens } from '../src/generated/tokens';
import {
  absentProductStatement,
  absentProductTooltip,
  navigation as navigationModel,
  pageTitle,
} from '../src/navigation';
import type { Product } from '../src/navigation';
import { decodeFilters, encodeFilters } from '../src/set/filters';
import type { GenomeFilters } from '../src/set/filters';
import { shortSpeciesName } from '../src/set/fields';
import { strings } from '../src/strings';
import {
  chipRemove,
  collectionReady,
  counters,
  escapeRegExp,
  facetOption,
  facetRail,
  mainArea,
  navigation,
  openFacets,
  openMenu,
  panel,
  recordRequests,
  setBar,
  setCount,
  settledSetCount,
  urlFilters,
  widthOf,
} from './support/page';
import { manifest, species } from './support/synth';

const ROUTES = [
  '/',
  '/sets',
  '/genomes',
  '/genes',
  '/trees',
  '/pangenome',
  '/embeddings',
  '/search',
  '/methods',
  '/releases',
] as const;

const PRODUCT_ROUTES: readonly [string, Product][] = [
  ['/trees', 'trees'],
  ['/pangenome', 'pangenome'],
  ['/embeddings', 'embeddings'],
  ['/search', 'search'],
];

const SPECIES_NAMES = manifest.species.flatMap((row) => [
  row.canonical_name,
  shortSpeciesName(row.canonical_name),
]);

function firstFamily(family: string): string {
  return family.replace(/["']/g, '').split(',')[0]?.trim() ?? '';
}

const SANS = firstFamily(tokens.typography.families.sans);
const MONO = firstFamily(tokens.typography.families.mono);

/** The four faces the interface uses (requirements §7): both families, roman and italic. */
const FONT_FACES = [
  { family: SANS, style: 'normal' },
  { family: SANS, style: 'italic' },
  { family: MONO, style: 'normal' },
  { family: MONO, style: 'italic' },
] as const;

/** The font shorthand of a face at the base size, for the FontFaceSet API. */
function fontSpec(face: (typeof FONT_FACES)[number]): string {
  return `${face.style === 'italic' ? 'italic ' : ''}${tokens.typography.sizes.base} '${face.family}'`;
}

/** Errors thrown in the page, collected for the "never an error" checks. */
function pageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  return errors;
}

/**
 * Waits until the shell has the manifest: the footer links the release. The
 * footer may sit in the collapsed menu, so this waits for it to exist.
 */
async function shellReady(page: Page): Promise<void> {
  await expect(page.locator('footer a', { hasText: manifest.release_id })).toBeAttached({
    timeout: 30_000,
  });
}

interface TextStyle {
  text: string;
  fontStyle: string;
  family: string;
  /** Inside a link, a button, a facet label or a search option. */
  interactive: boolean;
  /** Inside the set bar's filter chips. */
  inChip: boolean;
}

/** Style of every visible text node under `scope` whose text is one of `texts`. */
async function textStyles(scope: Locator, texts: readonly string[]): Promise<TextStyle[]> {
  return scope.evaluate(
    (root, { texts, chipsLabel }) => {
      const wanted = new Set(texts);
      const found: {
        text: string;
        fontStyle: string;
        family: string;
        interactive: boolean;
        inChip: boolean;
      }[] = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const text = node.textContent?.trim() ?? '';
        const parent = node.parentElement;
        if (!wanted.has(text) || parent === null) continue;
        if (!parent.checkVisibility({ visibilityProperty: true })) continue;
        const style = getComputedStyle(parent);
        found.push({
          text,
          fontStyle: style.fontStyle,
          family: style.fontFamily,
          interactive: parent.closest('a, button, label, [role="option"]') !== null,
          inChip: parent.closest(`ul[aria-label="${chipsLabel}"]`) !== null,
        });
      }
      return found;
    },
    { texts: [...texts], chipsLabel: strings.activeFiltersLabel },
  );
}

test('G1 vocabulary: no "cohort" and no "atlas"; Embeddings and embedding map', async ({
  page,
}) => {
  for (const route of ROUTES) {
    await page.goto(route);
    await shellReady(page);
    if (route === '/') await collectionReady(page);
    const text = await page.evaluate(() => {
      const attributes = [...document.querySelectorAll('[title], [aria-label], [placeholder]')]
        .flatMap((element) => [
          element.getAttribute('title'),
          element.getAttribute('aria-label'),
          element.getAttribute('placeholder'),
        ])
        .filter((value) => value !== null);
      return [document.title, document.body.innerText, ...attributes].join('\n');
    });
    expect(text, route).not.toMatch(/cohort/i);
    expect(text, route).not.toMatch(/atlas/i);
  }

  await page.goto('/embeddings');
  await openMenu(page);
  await expect(
    navigation(page).locator('li > [aria-disabled="true"]', { hasText: strings.pageEmbeddings }),
  ).toHaveText(strings.pageEmbeddings);
  await expect(mainArea(page).getByRole('heading', { level: 1 })).toHaveText(
    strings.pageEmbeddings,
  );
  await expect(mainArea(page)).toContainText(
    absentProductStatement('embeddings', manifest.release_id),
  );
  expect(absentProductStatement('embeddings', manifest.release_id)).toContain('embedding map');
});

test('G2 typography of species, identifiers, counts and genes', async ({ page }, testInfo) => {
  await page.goto('/');
  await collectionReady(page);

  // B612 and B612 Mono, roman and italic, load from Google Fonts (the link
  // of index.html). Each face is rendered in a probe so the browser fetches
  // it, then loaded through the FontFaceSet. document.fonts.check() alone
  // would also pass with a synthesized italic or with no face at all, so the
  // loaded faces are listed by family and style as well.
  const fonts = await page.evaluate(
    async (faces) => {
      const probes = faces.map(({ family, style, spec }) => {
        const probe = document.createElement('span');
        probe.textContent = 'Kpn 0123';
        probe.style.fontFamily = `'${family}'`;
        probe.style.fontStyle = style;
        document.body.append(probe);
        return { probe, spec };
      });
      document.body.getBoundingClientRect();
      await Promise.all(probes.map(({ spec }) => document.fonts.load(spec)));
      await document.fonts.ready;
      const checks = probes.map(({ spec }) => [spec, document.fonts.check(spec)] as const);
      for (const { probe } of probes) probe.remove();
      const loaded = [...document.fonts]
        .filter((face) => face.status === 'loaded')
        .map((face) => `${face.family.replace(/["']/g, '')} ${face.style}`);
      return { checks, loaded: [...new Set(loaded)].sort() };
    },
    FONT_FACES.map((face) => ({ ...face, spec: fontSpec(face) })),
  );
  expect(fonts.checks).toEqual(FONT_FACES.map((face) => [fontSpec(face), true]));
  expect(fonts.loaded).toEqual(
    expect.arrayContaining(FONT_FACES.map((face) => `${face.family} ${face.style}`)),
  );

  const rail = await openFacets(page);
  const main = mainArea(page);

  const scopes: [string, Locator][] = [
    ['facets', rail],
    ['species bars', panel(page, strings.panelSpecies)],
    ['table', main.getByRole('table', { name: strings.panelGenomes, exact: true })],
  ];
  if (widthOf(testInfo) !== 390) {
    scopes.push(['heatmap rows', main.getByRole('table', { name: strings.panelAmrClass })]);
  }
  for (const [where, scope] of scopes) {
    const styles = await textStyles(scope, SPECIES_NAMES);
    expect(styles.length, `species names in the ${where}`).toBeGreaterThan(0);
  }
  // Wherever they appear on the page.
  const everywhere = await textStyles(page.locator('body'), SPECIES_NAMES);
  expect(everywhere.length).toBeGreaterThan(0);
  for (const style of everywhere) {
    expect([style.text, style.fontStyle, firstFamily(style.family)]).toEqual([
      style.text,
      'italic',
      SANS,
    ]);
  }

  // Genome identifiers and counts in the table are monospace.
  const table = main.getByRole('table', { name: strings.panelGenomes, exact: true });
  const cells = await table.evaluate(
    (element, headers) => {
      const heads = [...element.querySelectorAll('thead th')].map((th) => th.textContent.trim());
      const wanted = headers.map((header) => heads.findIndex((head) => head.startsWith(header)));
      return [...element.querySelectorAll('tbody tr')].flatMap((row) =>
        wanted.map((index, column) => {
          const cell = row.children[index];
          const inner = cell?.querySelector('a, span') ?? cell;
          return {
            header: headers[column] ?? '',
            text: inner?.textContent ?? '',
            family: inner === undefined ? '' : getComputedStyle(inner).fontFamily,
          };
        }),
      );
    },
    [strings.tableColumnGenome, strings.tableColumnAmr, strings.tableColumnPlasmids],
  );
  expect(cells.length).toBeGreaterThan(0);
  for (const cell of cells) {
    expect([cell.header, cell.text, firstFamily(cell.family)]).toEqual([
      cell.header,
      cell.text,
      MONO,
    ]);
  }

  // Counters are monospace numerals.
  const counterFamilies = await counters(page)
    .getByRole('definition')
    .evaluateAll((values) => values.map((value) => getComputedStyle(value).fontFamily));
  expect(counterFamilies.length).toBe(5);
  expect(counterFamilies.map(firstFamily)).toEqual(counterFamilies.map(() => MONO));

  // Gene and element names are italic monospace: a resistance determinant chip.
  await page.goto(`/${encodeFilters({ presence_amr: ['blaKPC-2'] })}`);
  await settledSetCount(page);
  const chip = setBar(page)
    .getByRole('list', { name: strings.activeFiltersLabel })
    .getByText('blaKPC-2', { exact: true });
  await expect(chip).toBeVisible();
  const chipStyle = await chip.evaluate((element) => {
    const style = getComputedStyle(element);
    return { fontStyle: style.fontStyle, family: style.fontFamily };
  });
  expect({ ...chipStyle, family: firstFamily(chipStyle.family) }).toEqual({
    fontStyle: 'italic',
    family: MONO,
  });
});

/** Every hex color of the generated palette and the chrome tokens. */
function allowedHexes(): string[] {
  const hexes = new Set<string>();
  const add = (hex: string) => {
    hexes.add(hex.toLowerCase());
  };
  visitHexes(palette, add);
  visitHexes(tokens.color, add);
  return [...hexes];
}

function visitHexes(value: unknown, add: (hex: string) => void): void {
  if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) add(value);
  else if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
    for (const item of Object.values(value)) visitHexes(item, add);
  }
}

/**
 * The data colors: every palette color outside the chrome and the heatmap
 * scale (whose steps repeat the chrome grays), less any that is also a chrome
 * color.
 */
function dataHexes(): string[] {
  const chrome = new Set<string>();
  const add = (hex: string) => {
    chrome.add(hex.toLowerCase());
  };
  visitHexes(palette.chrome, add);
  visitHexes(palette.sequential, add);
  visitHexes(tokens.color, add);
  const data = new Set<string>();
  for (const [section, value] of Object.entries(palette)) {
    if (section === 'chrome' || section === 'sequential') continue;
    visitHexes(value, (hex) => {
      if (!chrome.has(hex.toLowerCase())) data.add(hex.toLowerCase());
    });
  }
  return [...data];
}

interface ColorFinding {
  element: string;
  property: string;
  value: string;
}

/**
 * Colors outside the palette and the chrome tokens (any translucent color
 * counts, since nothing is drawn at an opacity), and data colors used by the
 * chrome: as text, border, outline or underline color anywhere, or as a fill
 * of anything but a data mark (an element whose own style or SVG paint sets
 * the color, as collection/species.ts markStyle does).
 */
async function colorAudit(
  page: Page,
): Promise<{ outside: ColorFinding[]; dataInChrome: ColorFinding[]; dataMarks: number }> {
  return page.evaluate(
    ({ hexes, dataColors }) => {
      const probe = document.createElement('span');
      document.body.append(probe);
      const normalize = (color: string) => {
        probe.style.color = '';
        probe.style.color = color;
        return getComputedStyle(probe).color;
      };
      const allowed = new Set(hexes.map(normalize));
      const data = new Set(dataColors.map(normalize));
      probe.remove();
      const transparent = /^rgba\(\d+, \d+, \d+, 0\)$/;
      const ok = (value: string) => allowed.has(value) || transparent.test(value);
      const describe = (element: Element) => {
        const id = element.id === '' ? '' : `#${element.id}`;
        const label = element.getAttribute('aria-label') ?? element.textContent.trim().slice(0, 40);
        return `${element.tagName.toLowerCase()}${id} "${label}"`;
      };
      const isMark = (element: Element, property: string) => {
        if (element instanceof SVGElement) return property === 'fill' || property === 'stroke';
        if (property !== 'background-color') return false;
        return element instanceof HTMLElement && element.style.backgroundColor !== '';
      };
      const outside: { element: string; property: string; value: string }[] = [];
      const dataInChrome: { element: string; property: string; value: string }[] = [];
      let dataMarks = 0;
      for (const element of document.body.querySelectorAll('*')) {
        if (['SCRIPT', 'STYLE', 'TEMPLATE'].includes(element.tagName)) continue;
        if (!element.checkVisibility({ visibilityProperty: true })) continue;
        const style = getComputedStyle(element);
        const values: [string, string][] = [
          ['color', style.color],
          ['background-color', style.backgroundColor],
        ];
        for (const side of ['top', 'right', 'bottom', 'left']) {
          const width = parseFloat(style.getPropertyValue(`border-${side}-width`));
          const line = style.getPropertyValue(`border-${side}-style`);
          if (width > 0 && line !== 'none') {
            values.push([`border-${side}-color`, style.getPropertyValue(`border-${side}-color`)]);
          }
        }
        if (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) {
          values.push(['outline-color', style.outlineColor]);
        }
        if (style.textDecorationLine !== 'none') {
          values.push(['text-decoration-color', style.textDecorationColor]);
        }
        // Paint applies to shapes and text; containers and lines have no fill.
        if (element instanceof SVGGeometryElement || element instanceof SVGTextContentElement) {
          if (style.fill !== 'none' && !(element instanceof SVGLineElement)) {
            values.push(['fill', style.fill]);
          }
          if (style.stroke !== 'none') values.push(['stroke', style.stroke]);
        }
        for (const [property, value] of values) {
          if (!ok(value)) outside.push({ element: describe(element), property, value });
          if (data.has(value)) {
            if (isMark(element, property)) dataMarks += 1;
            else dataInChrome.push({ element: describe(element), property, value });
          }
        }
      }
      return { outside, dataInChrome, dataMarks };
    },
    { hexes: allowedHexes(), dataColors: dataHexes() },
  );
}

/** The computed underline of an element, and whether it shows keyboard focus. */
async function underline(link: Locator): Promise<{ underlined: boolean; focusVisible: boolean }> {
  return link.evaluate((element) => ({
    underlined: getComputedStyle(element).textDecorationLine.split(' ').includes('underline'),
    focusVisible: element.matches(':focus-visible'),
  }));
}

/** Moves the pointer off every link (the top left corner is the shell's padding). */
async function pointerAway(page: Page): Promise<void> {
  await page.mouse.move(1, 1);
}

/**
 * A quiet-tier link (requirements §5.4): no underline at rest, the underline
 * on hover and on keyboard focus.
 */
async function expectQuietLink(page: Page, link: Locator, where: string): Promise<void> {
  await link.scrollIntoViewIfNeeded();
  await pointerAway(page);
  expect(await underline(link), `${where} at rest`).toEqual({
    underlined: false,
    focusVisible: false,
  });
  await link.hover();
  expect((await underline(link)).underlined, `${where} on hover`).toBe(true);
  await pointerAway(page);
  // Keyboard focus: from the control before it, Tab lands on the link.
  await link.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(link).toBeFocused();
  expect(await underline(link), `${where} on keyboard focus`).toEqual({
    underlined: true,
    focusVisible: true,
  });
  await link.blur();
}

test('G3 colors come from the palette and the chrome tokens; the chrome is achromatic', async ({
  page,
}) => {
  // The accent is ink (requirements §5.4, §7), in the palette and the tokens.
  expect(palette.chrome.accent).toBe(palette.chrome.ink);
  expect(tokens.color.accent).toBe(tokens.color.ink);

  const pages: [string, GenomeFilters][] = [
    ['/', {}],
    ['/', { species_code: ['SEN'] }],
    ['/', { presence_amr: ['blaKPC-2'] }],
    ['/trees', {}],
  ];
  for (const [route, filters] of pages) {
    await page.goto(`${route}${encodeFilters(filters)}`);
    await shellReady(page);
    if (route === '/') {
      await collectionReady(page);
      await openFacets(page);
    }
    await openMenu(page);
    const audit = await colorAudit(page);
    expect(audit.outside, `colors outside the palette on ${page.url()}`).toEqual([]);
    expect(audit.dataInChrome, `data colors in the chrome on ${page.url()}`).toEqual([]);
    // The audit sees the data marks (species swatches and bars) where there are any.
    if (route === '/') expect(audit.dataMarks, `data marks on ${page.url()}`).toBeGreaterThan(0);
  }
});

test('G3 links: underlined at rest in running text, on hover and focus in tables, chips and the facet rail', async ({
  page,
}) => {
  // Running text: the absence statement's Methods link, and the annotation
  // version note under the heatmap (requirements §5.6).
  await page.goto('/trees');
  await shellReady(page);
  await pointerAway(page);
  const absent = mainArea(page).getByRole('link', { name: strings.absentMethodsLink, exact: true });
  expect((await underline(absent)).underlined, 'absence statement Methods link').toBe(true);

  await page.goto(`/${encodeFilters({ species_code: ['SEN'] })}`);
  await collectionReady(page);
  await pointerAway(page);
  const noteLink = panel(page, strings.panelAmrClass)
    .getByRole('note')
    .getByRole('link', { name: strings.annotationVersionMethods, exact: true });
  expect((await underline(noteLink)).underlined, 'heatmap note Methods link').toBe(true);

  // The facet rail: the same note inside the AMR class group is quiet.
  const rail = await openFacets(page);
  await expectQuietLink(
    page,
    rail
      .getByRole('group', { name: strings.facetAmrClass })
      .getByRole('link', { name: strings.annotationVersionMethods, exact: true }),
    'facet rail Methods link',
  );

  // Tables: the genome identifier, species and ST links of the genome table,
  // and a species row header of the heatmap where it is drawn.
  await page.goto('/');
  await collectionReady(page);
  const table = mainArea(page).getByRole('table', { name: strings.panelGenomes, exact: true });
  const row = table
    .locator('tbody tr')
    .filter({ has: page.locator('td:nth-child(4) a') })
    .first();
  await expectQuietLink(page, row.locator('td:nth-child(2) a'), 'genome identifier link');
  await expectQuietLink(page, row.locator('td:nth-child(3) a'), 'species link');
  await expectQuietLink(page, row.locator('td:nth-child(4) a'), 'ST link');
  const heatmap = mainArea(page).getByRole('table', { name: strings.panelAmrClass });
  if (await heatmap.isVisible()) {
    await expectQuietLink(
      page,
      heatmap.getByRole('rowheader').getByRole('link').first(),
      'heatmap species link',
    );
  }

  // Chips: a resistance determinant chip links to its Genes page.
  await page.goto(`/${encodeFilters({ presence_amr: ['blaKPC-2'] })}`);
  await settledSetCount(page);
  await expectQuietLink(
    page,
    setBar(page)
      .getByRole('list', { name: strings.activeFiltersLabel })
      .getByRole('link', { name: 'blaKPC-2', exact: true }),
    'chip link',
  );

  test.info().annotations.push({
    type: 'not applicable',
    description:
      'Pills and links in the counter strip: the collection page of milestone 1b has neither; ' +
      'the genome page brings the resistance pills in milestone 2.',
  });
});

test('G4 square corners, hairlines, no shadows or gradients, text navigation, light sidebar', async ({
  page,
}) => {
  await page.goto('/');
  await collectionReady(page);
  await openFacets(page);
  await openMenu(page);
  const findings = await page.evaluate(() => {
    const out: string[] = [];
    const describe = (element: Element) =>
      `${element.tagName.toLowerCase()} "${(element.getAttribute('aria-label') ?? element.textContent.trim()).slice(0, 40)}"`;
    for (const element of document.body.querySelectorAll('*')) {
      if (!element.checkVisibility({ visibilityProperty: true })) continue;
      const style = getComputedStyle(element);
      const radii = [
        style.borderTopLeftRadius,
        style.borderTopRightRadius,
        style.borderBottomRightRadius,
        style.borderBottomLeftRadius,
      ].map((value) => Math.max(...value.split(' ').map((part) => parseFloat(part) || 0)));
      const radius = Math.max(...radii);
      const control = ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName);
      const bordered = ['top', 'right', 'bottom', 'left'].some(
        (side) => parseFloat(style.getPropertyValue(`border-${side}-width`)) > 0,
      );
      if (radius > 2) out.push(`radius ${String(radius)}px on ${describe(element)}`);
      else if (radius > 0 && !control && !bordered) {
        out.push(`radius ${String(radius)}px on a non-control ${describe(element)}`);
      }
      if (style.boxShadow !== 'none') out.push(`box-shadow on ${describe(element)}`);
      if (style.textShadow !== 'none') out.push(`text-shadow on ${describe(element)}`);
      if (style.backgroundImage.includes('gradient')) out.push(`gradient on ${describe(element)}`);
      if (style.filter.includes('drop-shadow')) out.push(`drop-shadow on ${describe(element)}`);
      for (const side of ['top', 'right', 'bottom', 'left']) {
        const width = parseFloat(style.getPropertyValue(`border-${side}-width`));
        if (style.getPropertyValue(`border-${side}-style`) === 'none' || width <= 1) continue;
        // The one heavier rule is the active navigation item's accent rule.
        if (side === 'left' && element.getAttribute('aria-current') === 'page') continue;
        out.push(`border-${side} ${String(width)}px on ${describe(element)}`);
      }
    }
    return out;
  });
  expect(findings).toEqual([]);

  // Navigation items are text labels, never icons alone.
  const items = navigation(page).getByRole('listitem');
  const count = await items.count();
  expect(count).toBe(navigationModel.reduce((total, group) => total + group.items.length, 0));
  for (let index = 0; index < count; index += 1) {
    const item = items.nth(index);
    await expect(item).not.toHaveText('');
    await expect(item.locator('svg, img')).toHaveCount(0);
  }

  // The sidebar is the light sidebar token, not a dark one.
  const sidebar = await navigation(page).evaluate((element) => {
    for (let node: Element | null = element; node !== null; node = node.parentElement) {
      const color = getComputedStyle(node).backgroundColor;
      if (color !== 'rgba(0, 0, 0, 0)') return color;
    }
    return '';
  });
  const expected = await page.evaluate((hex) => {
    const probe = document.createElement('span');
    probe.style.color = hex;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, tokens.color.sidebar);
  expect(sidebar).toBe(expected);
});

async function accentRgb(page: Page): Promise<string> {
  return page.evaluate((hex) => {
    const probe = document.createElement('span');
    probe.style.color = hex;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, tokens.color.accent);
}

test('G5 shell: wordmark, tagline, navigation groups, release footer, ink accent rule', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page).toHaveTitle(strings.wordmark);
  const wordmark = page.getByText(strings.wordmark, { exact: true });
  await expect(wordmark).toBeVisible();
  expect(
    await wordmark.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        family: style.fontFamily.replace(/["']/g, '').split(',')[0],
        weight: style.fontWeight,
      };
    }),
  ).toEqual({ family: SANS, weight: String(tokens.typography.weights.bold) });
  await expect(page.getByText(strings.tagline, { exact: true })).toBeVisible();

  await openMenu(page);
  const groups = navigation(page).getByRole('group');
  await expect(groups).toHaveCount(2);
  await expect(groups.nth(0)).toHaveAccessibleName(strings.navGroupExplore);
  await expect(groups.nth(1)).toHaveAccessibleName(strings.navGroupAnalyze);
  await expect(groups.nth(0).getByRole('listitem')).toHaveText([
    strings.pageCollection,
    strings.pageGenomeSets,
    strings.pageGenomes,
    strings.pageGenes,
  ]);
  await expect(groups.nth(1).getByRole('listitem').locator('> :first-child')).toHaveText([
    strings.pagePhylogeny,
    strings.pagePangenome,
    strings.pageEmbeddings,
    strings.pageSequenceSearch,
  ]);

  const footer = page.getByRole('contentinfo');
  const release = footer.getByRole('link', { name: manifest.release_id, exact: true });
  await expect(release).toHaveAttribute('href', '/releases');
  await expect(footer).toContainText(
    strings.footerGenomeCount(formatCount(manifest.genome_count), manifest.genome_count),
  );
  await expect(footer).toContainText(formatPipeline(manifest.pipeline));
  await expect(
    footer.getByRole('link', { name: strings.footerMethods, exact: true }),
  ).toHaveAttribute('href', '/methods');

  // The accent is ink (requirements §5.1, §7).
  expect(tokens.color.accent).toBe(tokens.color.ink);
  const accent = await accentRgb(page);
  for (const [route, label] of [
    ['/', strings.pageCollection],
    ['/genes', strings.pageGenes],
  ] as const) {
    await page.goto(route);
    await openMenu(page);
    const active = navigation(page).locator('[aria-current="page"]');
    await expect(active).toHaveCount(1);
    await expect(active).toHaveText(label);
    const rule = await active.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        width: style.borderLeftWidth,
        style: style.borderLeftStyle,
        color: style.borderLeftColor,
        weight: style.fontWeight,
      };
    });
    expect(rule).toEqual({
      width: '3px',
      style: 'solid',
      color: accent,
      weight: String(tokens.typography.weights.bold),
    });
  }
});

test('G6 set bar: large numeral, phrase, chips, add filter, Share link, Save set', async ({
  page,
}) => {
  await page.goto('/');
  await collectionReady(page);
  const bar = setBar(page);
  const count = setCount(page);
  await expect(count).toHaveText(formatCount(manifest.genome_count));
  const numeral = await count.evaluate((element) => {
    const style = getComputedStyle(element);
    return { family: style.fontFamily, size: style.fontSize };
  });
  expect(firstFamily(numeral.family)).toBe(MONO);
  expect(numeral.size).toBe(tokens.typography.sizes.set_count);
  await expect(bar.getByText(strings.setBarPhrase, { exact: true })).toBeVisible();
  await expect(bar.getByRole('button', { name: strings.addFilter, exact: true })).toBeVisible();
  await expect(bar.getByRole('button', { name: strings.shareLink, exact: true })).toBeVisible();
  await expect(bar.getByRole('button', { name: strings.saveSet, exact: true })).toBeVisible();

  const kpn = species('KPN');
  await panel(page, strings.panelSpecies)
    .getByRole('button', {
      name: strings.speciesBarName(
        kpn.canonical_name,
        formatCount(kpn.genome_count),
        kpn.genome_count,
      ),
    })
    .click();
  const chips = bar.getByRole('list', { name: strings.activeFiltersLabel });
  await expect(chips.getByRole('listitem')).toHaveCount(1);
  await expect(chipRemove(chips, kpn.canonical_name)).toBeVisible();
  await expect(count).toHaveText(formatCount(kpn.genome_count));
});

test('disabled navigation items are reached by Tab and show their tooltip on focus', async ({
  page,
}) => {
  // Requirements §9 (keyboard reachable controls) and §5.1 (the tooltip).
  await page.goto('/');
  await shellReady(page);
  await openMenu(page);
  const nav = navigation(page);
  const explore = nav.getByRole('group', { name: strings.navGroupExplore });
  const analyze = nav.getByRole('group', { name: strings.navGroupAnalyze });
  // Start on the last Explore link; the Analyze items follow it in the tab order.
  await explore.getByRole('link').last().focus();
  for (const [route, product] of PRODUCT_ROUTES) {
    const tip = absentProductTooltip(product, manifest.release_id);
    const item = analyze.locator('[aria-disabled="true"]', { hasText: pageTitle(route) ?? '' });
    await page.keyboard.press('Tab');
    await expect(item).toBeFocused();
    await expect(page.getByRole('tooltip', { name: tip })).toBeVisible();
  }
});

test('G7 absent products: disabled navigation with tooltip, absence statement', async ({
  page,
}) => {
  const errors = pageErrors(page);
  await page.goto('/');
  await shellReady(page);
  await openMenu(page);
  const analyze = navigation(page).getByRole('group', { name: strings.navGroupAnalyze });
  await expect(analyze.getByRole('link')).toHaveCount(0);
  for (const [route, product] of PRODUCT_ROUTES) {
    const label = pageTitle(route) ?? '';
    const tip = absentProductTooltip(product, manifest.release_id);
    const item = analyze.locator('[aria-disabled="true"]', { hasText: label });
    await expect(item).toHaveText(label);
    await expect(item).toHaveAttribute('title', tip);
    await expect(item).toHaveAccessibleDescription(tip);
    await item.hover();
    await expect(page.getByRole('tooltip', { name: tip })).toBeVisible();
  }

  for (const [route, product] of PRODUCT_ROUTES) {
    await page.goto(route);
    await shellReady(page);
    const main = mainArea(page);
    await expect(main.getByRole('heading', { level: 1 })).toHaveText(pageTitle(route) ?? '');
    await expect(
      main.getByText(absentProductStatement(product, manifest.release_id)),
    ).toBeVisible();
    await expect(
      main.getByRole('link', { name: strings.absentMethodsLink, exact: true }),
    ).toHaveAttribute('href', '/methods');
    await expect(main.getByRole('alert')).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test('G8 empty set: message, active filters and "Clear the last filter" on every page', async ({
  page,
}) => {
  const sma = species('SMA');
  const empty: GenomeFilters = { species_code: ['SMA'], st: ['258'] };
  for (const route of ROUTES) {
    await page.goto(`${route}${encodeFilters(empty)}`);
    const main = mainArea(page);
    const message = main.getByRole('region', { name: strings.emptySetStatement });
    await expect(message.getByText(strings.emptySetStatement)).toBeVisible({ timeout: 30_000 });
    const chips = message.getByRole('list', { name: strings.activeFiltersLabel });
    await expect(chipRemove(chips, sma.canonical_name)).toBeVisible();
    await expect(chipRemove(chips, strings.chipSt('258'))).toBeVisible();
    const clear = message.getByRole('link', { name: strings.emptySetClearLast, exact: true });
    await expect(clear).toBeVisible();
    // Nothing else renders in the main area.
    await expect(main.locator(':scope > *')).toHaveCount(1);
    await expect(setCount(page)).toHaveText('0');
  }

  await page.goto(`/${encodeFilters(empty)}`);
  await mainArea(page).getByRole('link', { name: strings.emptySetClearLast, exact: true }).click();
  expect(urlFilters(page)).toEqual({ species_code: ['SMA'] });
  await collectionReady(page);
  await expect(setCount(page)).toHaveText(formatCount(sma.genome_count));
  await expect(mainArea(page).getByText(strings.emptySetStatement)).toHaveCount(0);
});

test('G9 reload reproduces the set; route changes keep the query', async ({ page }) => {
  const kpn = species('KPN');
  await page.goto('/');
  await collectionReady(page);
  const rail = await openFacets(page);
  await facetOption(rail, kpn.canonical_name).check();
  await expect(chipRemove(setBar(page), kpn.canonical_name)).toBeVisible();
  await facetOption(rail, strings.sourceTypeClinical).check();
  await expect(
    chipRemove(setBar(page), `${strings.chipPrefixSourceType} ${strings.sourceTypeClinical}`),
  ).toBeVisible();
  expect(urlFilters(page)).toEqual({ source_type: ['clinical'], species_code: ['KPN'] });
  const count = await settledSetCount(page);
  await expect(counters(page).getByRole('definition').first()).toHaveText(formatCount(count));
  const chips = setBar(page).getByRole('list', { name: strings.activeFiltersLabel });
  const chipTexts = await chips.getByRole('listitem').allTextContents();
  const search = new URL(page.url()).search;
  const shown = await counters(page).getByRole('definition').allInnerTexts();

  await page.reload();
  await collectionReady(page);
  expect(new URL(page.url()).search).toBe(search);
  expect(await settledSetCount(page)).toBe(count);
  await expect(chips.getByRole('listitem')).toHaveText(chipTexts);
  await expect(counters(page).getByRole('definition')).toHaveText(shown);

  await openMenu(page);
  await navigation(page).getByRole('link', { name: strings.pageGenes, exact: true }).click();
  await expect(page).toHaveURL((url) => url.pathname === '/genes' && url.search === search);
  expect(await settledSetCount(page)).toBe(count);
  await expect(chips.getByRole('listitem')).toHaveText(chipTexts);

  await page.reload();
  expect(await settledSetCount(page)).toBe(count);
  await expect(chips.getByRole('listitem')).toHaveText(chipTexts);

  await openMenu(page);
  await navigation(page).getByRole('link', { name: strings.pageCollection, exact: true }).click();
  await expect(page).toHaveURL((url) => url.pathname === '/' && url.search === search);
  await collectionReady(page);
  await expect(counters(page).getByRole('definition')).toHaveText(shown);
});

/** The search field of the set bar. */
function searchField(page: Page): Locator {
  return setBar(page).getByRole('combobox');
}

function resultGroup(page: Page, kindLabel: string): Locator {
  return page
    .getByRole('listbox', { name: strings.searchResultsLabel })
    .getByRole('group', { name: new RegExp(`^${escapeRegExp(kindLabel)}`) });
}

test('G10 global search resolves each kind, groups results, opens an exact genome', async ({
  page,
}) => {
  await page.goto('/');
  await collectionReady(page);
  const table = mainArea(page).getByRole('table', { name: strings.panelGenomes, exact: true });
  const genomeId = (
    await table.locator('tbody tr').first().locator('a').first().innerText()
  ).trim();
  const search = searchField(page);

  // A single exact genome identifier opens the genome page directly.
  await search.fill(genomeId);
  await expect(
    resultGroup(page, strings.searchKindGenome).getByRole('option', { name: new RegExp(genomeId) }),
  ).toBeVisible({ timeout: 20_000 });
  await search.press('Enter');
  await expect(page).toHaveURL((url) => url.pathname === `/genomes/${genomeId}`);

  // Results are grouped by kind, in the order of requirements §5.8.
  await page.goto('/');
  await search.fill('dna');
  const listbox = page.getByRole('listbox', { name: strings.searchResultsLabel });
  await expect(listbox.getByRole('group').first()).toBeVisible({ timeout: 20_000 });
  const names = await listbox.getByRole('group').evaluateAll((groups) =>
    groups.map((group) => {
      const id = group.getAttribute('aria-labelledby') ?? '';
      return document.getElementById(id)?.firstElementChild?.textContent ?? '';
    }),
  );
  expect(names).toEqual([strings.searchKindGene, strings.searchKindProduct]);

  const cases: [string, string, RegExp, string][] = [
    ['dnaA', strings.searchKindGene, /^dnaA/, '/genes/symbol/dnaA'],
    ['blaKPC-2', strings.searchKindElement, /^blaKPC-2/, '/genes/element/blaKPC-2'],
    ['gyrase', strings.searchKindProduct, /gyrase/i, '/genes'],
  ];
  for (const [query, kind, option, path] of cases) {
    await page.goto('/');
    await search.fill(query);
    const result = resultGroup(page, kind).getByRole('option', { name: option }).first();
    await expect(result).toBeVisible({ timeout: 20_000 });
    await result.click();
    await expect(page).toHaveURL((url) => url.pathname === path);
  }

  // A sequence type result filters the collection by species and ST.
  await page.goto('/');
  await search.fill('ST258');
  const kpn = species('KPN');
  const st = resultGroup(page, strings.searchKindSt).getByRole('option', {
    name: new RegExp(`^ST258\\s*${escapeRegExp(kpn.canonical_name)}`),
  });
  await expect(st).toBeVisible({ timeout: 20_000 });
  const expectedCount = /([\d,]+) genomes?$/.exec(await st.innerText())?.[1] ?? '';
  await st.click();
  await expect(page).toHaveURL((url) => url.pathname === '/');
  expect(urlFilters(page)).toEqual({ species_code: ['KPN'], st: ['258'] });
  await expect(chipRemove(setBar(page), kpn.canonical_name)).toBeVisible();
  await expect(chipRemove(setBar(page), strings.chipSt('258'))).toBeVisible();
  await expect(setCount(page)).toHaveText(expectedCount);
});

test('G11 species, genome identifiers, STs and gene names are links', async ({ page }) => {
  await page.goto('/');
  await collectionReady(page);
  const table = mainArea(page).getByRole('table', { name: strings.panelGenomes, exact: true });
  const rows = await table.locator('tbody tr').evaluateAll((elements) =>
    elements.map((row) => {
      const cells = [...row.children];
      const link = (index: number) => cells[index]?.querySelector('a');
      return {
        genome: link(1)?.textContent ?? '',
        genomeHref: link(1)?.getAttribute('href') ?? '',
        species: link(2)?.querySelector('[title]')?.getAttribute('title') ?? '',
        speciesHref: link(2)?.getAttribute('href') ?? '',
        st: link(3)?.textContent ?? null,
        stHref: link(3)?.getAttribute('href') ?? null,
      };
    }),
  );
  expect(rows.length).toBeGreaterThan(0);
  const decode = (href: string) => decodeFilters(new URL(href, 'http://localhost').search);
  let withSt: (typeof rows)[number] | undefined;
  for (const row of rows) {
    expect(row.genomeHref).toBe(`/genomes/${row.genome}`);
    const code = manifest.species.find(
      (entry) => entry.canonical_name === row.species,
    )?.species_code;
    expect(code, `species of ${row.genome}`).toBeDefined();
    expect(new URL(row.speciesHref, 'http://x').pathname).toBe('/');
    expect(decode(row.speciesHref)).toEqual({ species_code: [code] });
    if (row.st !== null && row.stHref !== null) {
      expect(decode(row.stHref)).toEqual({
        species_code: [code],
        st: [row.st.replace(/^ST/, '')],
      });
      withSt ??= row;
    }
  }

  // Every species name on the page is a link or a control that filters by it.
  const names = await textStyles(page.locator('body'), SPECIES_NAMES);
  expect(names.filter((name) => !name.interactive && !name.inChip)).toEqual([]);

  // Following the links.
  const first = rows[0];
  if (first === undefined) throw new Error('no rows');
  await table.getByRole('link', { name: first.genome, exact: true }).click();
  await expect(page).toHaveURL((url) => url.pathname === `/genomes/${first.genome}`);
  if (withSt?.st != null) {
    const target = withSt;
    await page.goto('/');
    await collectionReady(page);
    await table
      .locator('tbody tr', { has: page.getByRole('link', { name: target.genome, exact: true }) })
      .getByRole('link', { name: target.st ?? '', exact: true })
      .click();
    expect(urlFilters(page)).toEqual(decode(target.stHref ?? ''));
    await collectionReady(page);
  }

  // Gene and element names: the chip of a resistance determinant filter and
  // the search results open the Genes page, keeping the set.
  const filters: GenomeFilters = { presence_amr: ['blaKPC-2'] };
  await page.goto(`/${encodeFilters(filters)}`);
  await settledSetCount(page);
  const chip = setBar(page)
    .getByRole('list', { name: strings.activeFiltersLabel })
    .getByRole('link', { name: 'blaKPC-2', exact: true });
  await expect(chip).toHaveAttribute('href', `/genes/element/blaKPC-2${encodeFilters(filters)}`);
  await chip.click();
  await expect(page).toHaveURL((url) => url.pathname === '/genes/element/blaKPC-2');
  expect(urlFilters(page)).toEqual(filters);

  await searchField(page).fill('dnaA');
  const option = resultGroup(page, strings.searchKindGene).getByRole('option', { name: /^dnaA/ });
  await option.click({ timeout: 20_000 });
  await expect(page).toHaveURL((url) => url.pathname === '/genes/symbol/dnaA');
  expect(urlFilters(page)).toEqual(filters);

  test.info().annotations.push({
    type: 'not applicable',
    description:
      'MOB cluster and tree identifier links: the collection page of milestone 1b shows neither; ' +
      'they are exercised from milestone 2 (genome page contigs) and milestone 4 (phylogeny).',
  });
});

test('G12 viewport: drawer and stacked rows at 1024; menu, scrolling table, notes at 390', async ({
  page,
}, testInfo) => {
  const width = widthOf(testInfo);
  test.skip(width === 1440, 'G12 checks the 1024 and 390 px layouts (requirements §5.10)');
  await page.goto('/');
  await collectionReady(page);

  // The facet rail is a drawer opened from the set bar (both widths are below 1200 px).
  const rail = facetRail(page);
  await expect(rail).toBeHidden();
  const toggle = setBar(page).getByRole('button', { name: strings.drawerToggle, exact: true });
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(rail).toBeVisible();
  await toggle.click();
  await expect(rail).toBeHidden();

  if (width === 1024) {
    await expect(navigation(page)).toBeVisible();
    await expect(page.getByRole('button', { name: strings.menuToggle, exact: true })).toBeHidden();
    const rows = [
      [strings.panelSpecies, /^Sequence types /, strings.panelAmrClass],
      [strings.panelYear, strings.panelQc],
    ];
    for (const row of rows) {
      const boxes = [];
      for (const name of row) {
        const box = await panel(page, name).boundingBox();
        if (box === null) throw new Error(`panel ${String(name)} has no box`);
        boxes.push(box);
      }
      for (let index = 1; index < boxes.length; index += 1) {
        const previous = boxes[index - 1];
        const current = boxes[index];
        if (previous === undefined || current === undefined) continue;
        expect(Math.abs(current.x - previous.x)).toBeLessThan(1);
        expect(current.y).toBeGreaterThanOrEqual(previous.y + previous.height);
      }
    }
    return;
  }

  // 390 px: the navigation collapses behind the menu.
  const menu = page.getByRole('button', { name: strings.menuToggle, exact: true });
  await expect(navigation(page)).toBeHidden();
  await expect(menu).toBeVisible();
  await menu.click();
  await expect(navigation(page)).toBeVisible();
  await menu.click();
  await expect(navigation(page)).toBeHidden();

  // The table scrolls inside its panel and the page does not scroll sideways.
  const table = mainArea(page).getByRole('table', { name: strings.panelGenomes, exact: true });
  const scroll = await table.evaluate((element) => {
    const container = element.parentElement;
    return {
      scrollWidth: container?.scrollWidth ?? 0,
      clientWidth: container?.clientWidth ?? 0,
      overflowX: container === null ? '' : getComputedStyle(container).overflowX,
    };
  });
  expect(scroll.scrollWidth).toBeGreaterThan(scroll.clientWidth);
  expect(scroll.overflowX).toBe('auto');
  const pageWidth = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(pageWidth.scrollWidth).toBeLessThanOrEqual(pageWidth.innerWidth);

  // The heatmap gives way to the note.
  const heatmap = panel(page, strings.panelAmrClass);
  await expect(heatmap.getByText(strings.heatmapNeedsWidth)).toBeVisible();
  await expect(heatmap.getByRole('table', { name: strings.panelAmrClass })).toBeHidden();

  // Counters, the set count and the downloads remain usable.
  for (const value of await counters(page).getByRole('definition').all()) {
    await expect(value).toBeVisible();
  }
  for (const label of [
    strings.counterGenomes,
    strings.counterSpecies,
    strings.counterSequenceTypes,
    strings.counterAmrHits,
    strings.counterPlasmidContigs,
  ]) {
    await expect(counters(page).getByText(label, { exact: true })).toBeVisible();
  }
  await expect(setCount(page)).toBeVisible();
  await expect(setBar(page).getByText(strings.setBarPhrase, { exact: true })).toBeVisible();
  const species = panel(page, strings.panelSpecies);
  await species
    .getByRole('button', { name: strings.panelExpandName(strings.panelSpecies) })
    .click();
  await expect(species.getByRole('group', { name: strings.exportMenuLabel })).toBeVisible();
  const after = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(after).toBeLessThanOrEqual(pageWidth.innerWidth);
});

test('G13 annotation version warning for the mixed-version species', async ({ page }) => {
  const mixed = manifest.species.filter(
    (row) =>
      (row.annotation_versions?.bakta?.length ?? 0) > 1 ||
      (row.annotation_versions?.amrfinderplus?.length ?? 0) > 1,
  );
  expect(mixed.map((row) => row.species_code)).toEqual(['SEN']);
  const sen = species('SEN');
  const bakta = [...(sen.annotation_versions?.bakta ?? [])].sort();
  const amrfinderplus = [...(sen.annotation_versions?.amrfinderplus ?? [])].sort();
  const warning = strings.annotationVersionWarning(
    bakta.join(strings.listSeparator),
    amrfinderplus.join(strings.listSeparator),
  );

  await page.goto(`/${encodeFilters({ species_code: ['SEN'] })}`);
  await collectionReady(page);
  const rail = await openFacets(page);
  const places = [
    panel(page, strings.panelAmrClass),
    rail.getByRole('group', { name: strings.facetAmrClass }),
  ];
  for (const place of places) {
    const note = place.getByRole('note');
    await expect(note).toHaveCount(1);
    await expect(note).toContainText(warning);
    for (const version of [...bakta, ...amrfinderplus]) await expect(note).toContainText(version);
    await expect(
      note.getByRole('link', { name: strings.annotationVersionMethods, exact: true }),
    ).toHaveAttribute('href', `/methods${encodeFilters({ species_code: ['SEN'] })}`);
  }

  await page.goto(`/${encodeFilters({ species_code: ['KPN'] })}`);
  await collectionReady(page);
  const kpnRail = await openFacets(page);
  await expect(panel(page, strings.panelAmrClass).getByRole('note')).toHaveCount(0);
  await expect(kpnRail.getByRole('note')).toHaveCount(0);
});

test('G14 a collection session requests nothing outside the origin but Google Fonts', async ({
  page,
  context,
  baseURL,
}) => {
  const log = recordRequests(context, baseURL);
  await page.goto('/');
  await collectionReady(page);

  const rail = await openFacets(page);
  await facetOption(rail, strings.sourceTypeClinical).check();
  await expect(
    chipRemove(setBar(page), `${strings.chipPrefixSourceType} ${strings.sourceTypeClinical}`),
  ).toBeVisible();
  await settledSetCount(page);

  await searchField(page).fill('blaKPC');
  await expect(page.getByRole('option').first()).toBeVisible({ timeout: 20_000 });
  await searchField(page).press('Escape');

  await page.goto('/');
  await collectionReady(page);
  const pager = mainArea(page).getByRole('navigation', { name: strings.tablePagerLabel });
  await pager.getByRole('button', { name: strings.tableNext, exact: true }).click();
  await expect(pager).toContainText(strings.tablePageOf('2', '2'));
  await page.waitForLoadState('networkidle');

  expect(log.urls.length).toBeGreaterThan(0);
  expect(log.foreign()).toEqual([]);
  expect(await page.evaluate(() => document.cookie)).toBe('');
  expect(await context.cookies()).toEqual([]);
});

test('G14 no request leaves the origin when a Parquet file is opened', async ({
  page,
  context,
  baseURL,
}) => {
  const log = recordRequests(context, baseURL);
  const origin = new URL(baseURL ?? '').origin;
  const parquet = context.waitForEvent('response', {
    predicate: (response) => {
      const url = new URL(response.url());
      return url.pathname.startsWith('/data/') && url.pathname.endsWith('.parquet');
    },
    timeout: 30_000,
  });
  await page.goto('/');
  const response = await parquet;
  expect(new URL(response.url()).origin).toBe(origin);
  expect([200, 206]).toContain(response.status());
  await collectionReady(page);
  await page.waitForLoadState('networkidle');
  expect(log.urls.some((url) => new URL(url).pathname.endsWith('.parquet'))).toBe(true);
  expect(log.foreign()).toEqual([]);
});
