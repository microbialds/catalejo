// The committed files under src/generated/ and public/favicon.svg equal a
// fresh generation from config/palette.yaml, config/design-tokens.yaml,
// config/platform.yaml, config/export-presets.yaml and
// config/typing_display.yaml (requirements §6.1, §7, §8), and index.html
// links the Google Fonts URL of the design tokens and the generated favicon.
// CI also runs `git diff --exit-code` on src/generated after the tests,
// because pretest regenerates the files before this test reads them.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { googleFontsUrl, renderGenerated, resolvePaletteRef } from '../scripts/generate-lib';
import { palette } from '../src/generated/palette';
import { strings } from '../src/strings';
import { webRoot } from './files';

describe('generated files', () => {
  it('are fresh', async () => {
    const files = await renderGenerated();
    expect(files.map((file) => file.path)).toEqual([
      'src/generated/palette.ts',
      'src/generated/tokens.ts',
      'src/generated/tokens.css',
      'src/generated/platform.ts',
      'src/generated/typingDisplay.ts',
      'public/favicon.svg',
    ]);
    for (const file of files) {
      const committed = readFileSync(path.join(webRoot, file.path), 'utf8');
      expect(committed, `${file.path} is stale; run pnpm generate`).toBe(file.content);
      expect(committed).toContain('Do not edit.');
    }
  });

  it('emit the line heights as the only leading utilities', async () => {
    const files = await renderGenerated();
    const css = files.find((file) => file.path === 'src/generated/tokens.css')?.content ?? '';
    expect(css).toContain('--leading-*: initial;');
    const leading = [...css.matchAll(/^\s*--leading-([a-z-]+):\s*([^;]+);/gm)].map((match) => [
      match[1],
      match[2],
    ]);
    expect(leading).toEqual([
      ['tight', '1.1'],
      ['body', '1.5'],
    ]);
  });

  it('draw the favicon from the chrome ink and on-ink colors, without text', async () => {
    const files = await renderGenerated();
    const svg = files.find((file) => file.path === 'public/favicon.svg')?.content ?? '';
    const fills = [...svg.matchAll(/fill="([^"]+)"/g)].map((match) => match[1]);
    expect(fills).toEqual([palette.chrome.ink, palette.chrome.on_ink, palette.chrome.on_ink]);
    expect(svg).not.toMatch(/<text|<tspan|rx=|<image/);
  });

  it('list the typing chip keys in configured order with their groups', async () => {
    const files = await renderGenerated();
    const module = files.find((file) => file.path === 'src/generated/typingDisplay.ts');
    expect(module?.content).toContain("tool: 'kleborate'");
    const { typingDisplay } = await import('../src/generated/typingDisplay');
    expect(typingDisplay.map((tool) => tool.tool)).toEqual([
      'mlst',
      'kleborate',
      'sistr',
      'sccmec',
    ]);
    expect(typingDisplay[1].chips.map((chip) => [chip.key, chip.displayGroup])).toEqual([
      ['K_locus', 'typing'],
      ['O_locus', 'typing'],
      ['virulence_score', 'virulence'],
      ['resistance_score', 'resistance_score'],
    ]);
  });

  it('resolve palette references', () => {
    const palette = { chrome: { paper: '#f6f5f1' }, species: { sequence: ['#0072B2'] } };
    expect(resolvePaletteRef(palette, 'palette:chrome.paper')).toBe('#f6f5f1');
    expect(resolvePaletteRef(palette, 'palette:species.sequence.0')).toBe('#0072B2');
    expect(() => resolvePaletteRef(palette, 'palette:chrome.missing')).toThrow(/unresolved/);
  });
});

describe('index.html', () => {
  const html = readFileSync(path.join(webRoot, 'index.html'), 'utf8');

  it('links the Google Fonts stylesheet of the design tokens', () => {
    const hrefs = [...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map(
      (match) => (match[1] ?? '').replace(/&amp;/g, '&'),
    );
    expect(hrefs).toEqual([googleFontsUrl()]);
  });

  it('links the generated favicon and no data: icon', () => {
    const icons = [...html.matchAll(/<link[^>]*rel="icon"[^>]*>/g)].map((match) => match[0]);
    expect(icons).toEqual(['<link rel="icon" type="image/svg+xml" href="/favicon.svg" />']);
  });

  it('has the wordmark as its title and no other text', () => {
    expect(/<title>([^<]*)<\/title>/.exec(html)?.[1]).toBe(strings.wordmark);
    const body = /<body>([\s\S]*)<\/body>/.exec(html)?.[1] ?? '';
    expect(body.replace(/<[^>]*>/g, '').trim()).toBe('');
  });
});
