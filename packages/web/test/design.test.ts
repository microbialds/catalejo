// Requirements §5.4 and §7 (checklist G2, G3): the type and the marks of the
// Instrument design. No component uses the serif face, a weight other than
// 400 and 700, or uppercase labels, and no mark is drawn at an opacity below
// 1, so that every painted color is a palette color as is. The scan covers
// src/ without src/generated/.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { sourceFiles, webRoot } from './files';
import { findDesignInCss, findDesignInScript } from './guards/designRules';
import type { DesignFinding } from './guards/designRules';

function describeFindings(findings: DesignFinding[]): string[] {
  return findings.map((f) => `${f.file}:${String(f.line)} ${f.text}`);
}

describe('design rule detector', () => {
  it('catches serif, medium and semibold weights and uppercase classes', () => {
    const source = [
      '// font-serif uppercase in a comment does not count',
      'export const A = () => (',
      '  <h2 className="font-serif text-panel-title font-semibold">',
      '    <span className={`hover:font-medium ${x} uppercase`} />',
      '    <span className="font-normal font-regular font-bold italic" />',
      '  </h2>',
      ');',
    ].join('\n');
    expect(describeFindings(findDesignInScript(source))).toEqual([
      'input.tsx:3 font-serif',
      'input.tsx:3 font-semibold',
      'input.tsx:4 hover:font-medium',
      'input.tsx:4 uppercase',
      'input.tsx:5 font-normal',
    ]);
  });

  it('catches opacity below 1 on marks, literal or computed', () => {
    const source = [
      'export const A = () => (',
      '  <svg>',
      '    <circle fill={c} fillOpacity={0.6} />',
      '    <rect stroke={c} strokeOpacity="0.5" opacity={1} />',
      '    <span style={{ opacity: step / 6 }} className="bg-ink/50 opacity-40 opacity-100" />',
      '    <g style="fill-opacity: 0.2" />',
      '  </svg>',
      ');',
    ].join('\n');
    expect(describeFindings(findDesignInScript(source))).toEqual([
      'input.tsx:3 fillOpacity: 0.6',
      'input.tsx:4 strokeOpacity: 0.5',
      'input.tsx:5 opacity: computed',
      'input.tsx:5 bg-ink/50',
      'input.tsx:5 opacity-40',
      'input.tsx:6 fill-opacity: 0.2',
    ]);
  });

  it('catches opacity, the serif variable and uppercase in stylesheets, not in comments', () => {
    const css = [
      '/* opacity: 0.5; font-family: var(--font-serif) */',
      'a { opacity: 0.5; }',
      'b { font-family: var(--font-serif); fill-opacity: 1; }',
      'c { text-transform: uppercase; stroke-opacity: 40%; }',
    ].join('\n');
    expect(describeFindings(findDesignInCss(css))).toEqual([
      'input.css:2 opacity: 0.5',
      'input.css:4 stroke-opacity: 40%',
      'input.css:3 var(--font-serif)',
      'input.css:4 text-transform: uppercase',
    ]);
  });
});

describe('sources', () => {
  const files = sourceFiles(['.ts', '.tsx', '.css']);

  it.each(files.map((file) => [path.relative(webRoot, file), file]))(
    '%s follows the type and opacity rules',
    (_name, file) => {
      const source = readFileSync(file, 'utf8');
      const name = path.relative(webRoot, file);
      const findings = file.endsWith('.css')
        ? findDesignInCss(source, name)
        : findDesignInScript(source, name);
      expect(describeFindings(findings)).toEqual([]);
    },
  );
});
