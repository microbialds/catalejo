// Requirements §3: every user-visible string lives in src/strings.ts and
// components contain no literal interface text.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { palette } from '../src/generated/palette';
import { strings } from '../src/strings';
import { sourceFiles, webRoot } from './files';
import { findLiteralText } from './guards/literalText';

describe('literal text detector', () => {
  it('catches JSX text, literal children and visible attributes', () => {
    const source = [
      'export const A = () => (',
      '  <div title="Hover text" aria-label={`Label`}>',
      '    Hello',
      "    {'child text'}",
      '    <img alt={cond ? "x" : strings.alt} />',
      '    <select><option value="Choice">{strings.choice}</option></select>',
      '    <input placeholder={"Type here"} />',
      '  </div>',
      ');',
    ].join('\n');
    const findings = findLiteralText(source);
    expect(findings.map((f) => f.text)).toEqual([
      'title=Hover text',
      'aria-label=Label',
      'Hello',
      'child text',
      'alt=x',
      'value=Choice',
      'placeholder=Type here',
    ]);
    expect(findings[2]).toMatchObject({ kind: 'jsx-text', line: 3 });
  });

  it('passes components that read from the strings module', () => {
    const source = [
      "import { strings } from '../strings';",
      'export const A = ({ n }: { n: number }) => (',
      '  <nav aria-label={strings.navigationLabel} className="flex gap-2" id={`nav-${n}`}>',
      '    <a href="/sets" title={strings.pageGenomeSets}>{strings.pageGenomeSets}</a>',
      '    {strings.footerRelease} <span>{n}</span>',
      '    <option value={code}>{strings.pageGenes}</option>',
      '  </nav>',
      ');',
    ].join('\n');
    expect(findLiteralText(source)).toEqual([]);
  });
});

describe('components', () => {
  const files = sourceFiles(['.tsx']);

  it('finds the component sources', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((file) => [path.relative(webRoot, file), file]))(
    '%s contains no literal interface text',
    (_name, file) => {
      const findings = findLiteralText(readFileSync(file, 'utf8'), path.relative(webRoot, file));
      expect(findings.map((f) => `${f.file}:${String(f.line)} ${f.kind} ${f.text}`)).toEqual([]);
    },
  );
});

describe('strings module', () => {
  it('has a label for every drug class in config/palette.yaml', () => {
    const keys = Object.keys(strings);
    for (const drugClass of palette.drug_classes) {
      expect(keys, `strings.${drugClass.label_key}`).toContain(drugClass.label_key);
    }
  });

  it('holds the shell vocabulary of requirements §5.1', () => {
    expect(strings.wordmark).toBe('Catalejo');
    expect(strings.tagline).toBe('microbial genome collection');
    expect(strings.setBarPhrase).toBe('genomes in the current set');
  });
});
