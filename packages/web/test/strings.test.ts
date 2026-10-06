// Requirements §3: every user-visible string lives in src/strings.ts and
// components contain no literal interface text.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { palette } from '../src/generated/palette';
import { chipLabel } from '../src/set/fields';
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

describe('counts of genomes', () => {
  it('uses the singular for one genome and the plural otherwise', () => {
    expect(strings.facetOptionName('Animal', '1', 1)).toBe('Animal, 1 genome in the set');
    expect(strings.facetOptionName('Animal', '2', 2)).toBe('Animal, 2 genomes in the set');
    expect(strings.facetOptionName('Animal', '0', 0)).toBe('Animal, 0 genomes in the set');
    expect(strings.speciesBarName('Serratia marcescens', '1', 1)).toBe(
      'Serratia marcescens, 1 genome',
    );
    expect(strings.stBarName('ST258', '1', 1)).toBe('ST258, 1 genome');
    expect(strings.stOtherName('1', 1, '1')).toBe('Other sequence types (1), 1 genome');
    expect(strings.yearSegmentName('Klebsiella pneumoniae', 2019, '1', 1)).toBe(
      'Klebsiella pneumoniae, 2019: 1 genome',
    );
    expect(strings.yearColumnName(2019, '1', 1)).toBe('2019: 1 genome');
    expect(strings.yearColumnName(2019, '9', 9)).toBe('2019: 9 genomes');
    expect(strings.chipGenomeIds('1', 1, 'KPN0001')).toBe('1 genome (KPN0001)');
    expect(strings.chipGenomeIds('2', 2, 'KPN0001, KPN0002')).toBe('2 genomes (KPN0001, KPN0002)');
    expect(strings.useAsSetConfirm('1', 1)).toBe('The current set becomes these 1 genome.');
    expect(strings.setBarPhraseOne).toBe('genome in the current set');
    expect(strings.counterGenomesOne).toBe('genome in current set');
  });

  it('reads a pending count as plural', () => {
    expect(strings.facetOptionName('Animal', strings.valuePending, undefined)).toBe(
      `Animal, ${strings.valuePending} genomes in the set`,
    );
  });
});

describe('year chip', () => {
  it('names a single year once and a range by its bounds', () => {
    expect(chipLabel({ key: 'year', value: { min: 2019, max: 2019 } }, undefined).text).toBe(
      'year 2019',
    );
    expect(chipLabel({ key: 'year', value: { min: 2018, max: 2020 } }, undefined).text).toBe(
      'year 2018–2020',
    );
    expect(chipLabel({ key: 'year', value: { min: 2018 } }, undefined).text).toBe('year ≥ 2018');
  });
});
