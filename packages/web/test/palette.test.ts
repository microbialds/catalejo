// Requirements §5.4 and §7: every color comes from config/palette.yaml through
// the generated module; no color literal appears anywhere else in src/ or in
// index.html.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { repoRoot, sourceFiles, webRoot } from './files';
import {
  findColorsInCss,
  findColorsInHtml,
  findColorsInScript,
  type ColorFinding,
} from './guards/colorLiterals';

function describeFindings(findings: ColorFinding[]): string[] {
  return findings.map((f) => `${f.file}:${String(f.line)} ${f.text}`);
}

function findColors(file: string): ColorFinding[] {
  const source = readFileSync(file, 'utf8');
  const name = path.relative(webRoot, file);
  if (file.endsWith('.css')) return findColorsInCss(source, name);
  if (file.endsWith('.html')) return findColorsInHtml(source, name);
  return findColorsInScript(source, name);
}

describe('color literal detector', () => {
  it('catches hex, functions, named colors and color utilities in scripts', () => {
    const source = [
      'export const A = () => (',
      "  <div style={{ color: '#8a2f22', background: 'rgb(1, 2, 3)', borderColor: 'white' }}",
      '    className="bg-red-500 hover:text-[navy] fill-[#abc]" />',
      ');',
      "const css = 'border: 1px solid gray;';",
      'const hsl = `hsla(0 0% 0% / 0.5)`;',
      "const short = '#FFFA';",
    ].join('\n');
    expect(describeFindings(findColorsInScript(source))).toEqual([
      'input.tsx:2 #8a2f22',
      'input.tsx:2 rgb(',
      'input.tsx:2 white',
      'input.tsx:3 #abc',
      'input.tsx:3 hover: navy',
      'input.tsx:3 bg-red-500',
      'input.tsx:3 hover:text-[navy]',
      'input.tsx:5 border: gray',
      'input.tsx:6 hsla(',
      'input.tsx:7 #FFFA',
    ]);
  });

  it('catches colors in stylesheets and pages but not in comments', () => {
    const css =
      '/* #ffffff red */\na { color: black; }\nb { fill: #123456; outline: 1px solid hsl(0 0% 0%); }';
    expect(describeFindings(findColorsInCss(css))).toEqual([
      'input.css:3 #123456',
      'input.css:3 hsl(',
      'input.css:2 color: black',
    ]);
    const html =
      '<body style="background: teal"><p>&#123;</p><!-- #fff --><svg fill="orange"></svg></body>';
    expect(describeFindings(findColorsInHtml(html))).toEqual([
      'index.html:1 background: teal',
      'index.html:1 orange',
    ]);
  });

  it('passes token classes, CSS variables, transparent and currentColor', () => {
    const source = [
      'export const A = () => (',
      '  <a href="#main" className="border-l-(length:--shape-active-rule) border-accent bg-background text-ink white-space" />',
      ');',
      "const style = { color: 'var(--color-ink)', fill: 'currentColor', background: 'transparent' };",
      "const id = document.getElementById('root');",
    ].join('\n');
    expect(findColorsInScript(source)).toEqual([]);
    expect(findColorsInCss('a { color: var(--color-accent); white-space: nowrap; }')).toEqual([]);
  });
});

describe('sources', () => {
  const files = [...sourceFiles(['.ts', '.tsx', '.css']), path.join(webRoot, 'index.html')];

  it.each(files.map((file) => [path.relative(webRoot, file), file]))(
    '%s contains no color literal',
    (_name, file) => {
      expect(describeFindings(findColors(file))).toEqual([]);
    },
  );
});

describe('generated modules', () => {
  const paletteYaml = readFileSync(path.join(repoRoot, 'config', 'palette.yaml'), 'utf8');
  const allowed = new Set<string>();
  const collect = (value: unknown): void => {
    if (typeof value === 'string' && value.startsWith('#')) allowed.add(value.toLowerCase());
    else if (Array.isArray(value)) value.forEach(collect);
    else if (typeof value === 'object' && value !== null) Object.values(value).forEach(collect);
  };
  collect(parse(paletteYaml));

  it.each(['src/generated/palette.ts', 'src/generated/tokens.ts', 'src/generated/tokens.css'])(
    'every color in %s is defined in config/palette.yaml',
    (relative) => {
      const text = readFileSync(path.join(webRoot, relative), 'utf8');
      const colors = [...text.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0].toLowerCase());
      expect(colors.length).toBeGreaterThan(0);
      expect(colors.filter((color) => !allowed.has(color))).toEqual([]);
      expect(text).not.toMatch(/\b(?:rgba?|hsla?)\(/);
    },
  );
});
