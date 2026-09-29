// The committed files under src/generated/ equal a fresh generation from
// config/palette.yaml and config/design-tokens.yaml (requirements §7), and
// index.html links the Google Fonts URL of the design tokens. CI also runs
// `git diff --exit-code` on src/generated after the tests, because pretest
// regenerates the files before this test reads them.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { googleFontsUrl, renderGenerated, resolvePaletteRef } from '../scripts/generate-lib';
import { strings } from '../src/strings';
import { webRoot } from './files';

describe('generated files', () => {
  it('are fresh', async () => {
    const files = await renderGenerated();
    expect(files.map((file) => file.path)).toEqual([
      'src/generated/palette.ts',
      'src/generated/tokens.ts',
      'src/generated/tokens.css',
    ]);
    for (const file of files) {
      const committed = readFileSync(path.join(webRoot, file.path), 'utf8');
      expect(committed, `${file.path} is stale; run pnpm generate`).toBe(file.content);
      expect(committed).toContain('Do not edit.');
    }
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

  it('has the wordmark as its title and no other text', () => {
    expect(/<title>([^<]*)<\/title>/.exec(html)?.[1]).toBe(strings.wordmark);
    const body = /<body>([\s\S]*)<\/body>/.exec(html)?.[1] ?? '';
    expect(body.replace(/<[^>]*>/g, '').trim()).toBe('');
  });
});
