// Requirements §6.1 and data contract §5.9: the Typing column of the genome
// table shows the typing chip keys of config/typing_display.yaml whose
// display group is typing, without the sequence type and the scores, in the
// configured tool and key order, joined with the interface separator
// (src/data/typing.ts).
import { describe, expect, it } from 'vitest';
import {
  TYPING_COLUMN_KEYS,
  readTyping,
  typingColumnKeys,
  typingSql,
  typingValues,
} from '../src/data/typing';
import { strings } from '../src/strings';
import { stubEngine } from './support/engine';
import { tableAggregate } from './support/genomeTable';

describe('typing column keys', () => {
  it('follow the configured tools and chips, without ST and the scores', () => {
    expect(TYPING_COLUMN_KEYS).toEqual([
      { tool: 'kleborate', key: 'K_locus' },
      { tool: 'kleborate', key: 'O_locus' },
      { tool: 'sistr', key: 'serovar' },
      { tool: 'sistr', key: 'cgmlst_ST' },
      { tool: 'sccmec', key: 'type' },
      { tool: 'sccmec', key: 'subtype' },
    ]);
  });

  it('keep the typing group only and drop the key ST of any tool', () => {
    const keys = typingColumnKeys([
      {
        tool: 'b',
        chips: [
          { key: 'ST', displayGroup: 'typing' },
          { key: 'z', displayGroup: 'typing' },
          { key: 'score', displayGroup: 'virulence' },
          { key: 'a', displayGroup: 'typing' },
        ],
      },
      { tool: 'a', chips: [{ key: 'gapA', displayGroup: 'allele' }] },
    ]);
    expect(keys).toEqual([
      { tool: 'b', key: 'z' },
      { tool: 'b', key: 'a' },
    ]);
  });
});

describe('typing values', () => {
  const row = (genome_id: string, source_tool: string, key: string, value: unknown) => ({
    genome_id,
    source_tool,
    key,
    value,
  });

  it('join one genome values in the configured order', () => {
    const values = typingValues([
      row('KPN0001', 'kleborate', 'O_locus', 'O2afg'),
      row('SEN0001', 'sistr', 'cgmlst_ST', '1234'),
      row('KPN0001', 'kleborate', 'K_locus', 'KL64'),
      row('SEN0001', 'sistr', 'serovar', 'Typhimurium'),
    ]);
    expect(values.get('KPN0001')).toBe(['KL64', 'O2afg'].join(strings.separator));
    expect(values.get('SEN0001')).toBe(['Typhimurium', '1234'].join(strings.separator));
    expect(strings.separator).toBe(' · ');
  });

  it('leave out keys that are not chips of the typing group, and empty values', () => {
    const values = typingValues([
      row('KPN0001', 'mlst', 'ST', '147'),
      row('KPN0001', 'kleborate', 'virulence_score', '0'),
      row('KPN0001', 'kleborate', 'resistance_score', '2'),
      row('KPN0001', 'kleborate', 'K_type', 'K64'),
      row('KPN0001', 'sistr', 'K_locus', 'KL1'),
      row('KPN0002', 'kleborate', 'K_locus', ' '),
      row('KPN0002', 'kleborate', 'O_locus', null),
    ]);
    expect(values.size).toBe(0);
  });

  it('are empty without rows', () => {
    expect(typingValues([]).size).toBe(0);
  });
});

describe('typing query', () => {
  it('asks for the page genomes and the column keys only', () => {
    const sql = typingSql("read_parquet('tables/typing.parquet')", ['KPN0001', "O'1"]) ?? '';
    expect(sql).toBe(
      "SELECT genome_id, source_tool, key, value FROM read_parquet('tables/typing.parquet') " +
        "WHERE genome_id IN ('KPN0001', 'O''1') AND (" +
        "(source_tool = 'kleborate' AND key IN ('K_locus', 'O_locus')) OR " +
        "(source_tool = 'sistr' AND key IN ('serovar', 'cgmlst_ST')) OR " +
        "(source_tool = 'sccmec' AND key IN ('type', 'subtype')))",
    );
    expect(typingSql('t', [])).toBeUndefined();
  });

  it('reads the file at low priority through the engine', async () => {
    const asked: string[] = [];
    const priorities: unknown[] = [];
    const aggregate = tableAggregate([], {
      sql: asked,
      rows: [{ genome_id: 'KPN0001', source_tool: 'kleborate', key: 'K_locus', value: 'KL64' }],
    });
    const engine = stubEngine({
      aggregate: (filters, build, priority) => {
        priorities.push(priority);
        return aggregate(filters, build);
      },
    });
    const values = await readTyping(engine, {}, ['KPN0001']);
    expect(values.get('KPN0001')).toBe('KL64');
    expect(asked).toHaveLength(1);
    expect(priorities).toEqual(['low']);
    expect((await readTyping(engine, {}, [])).size).toBe(0);
    expect(asked).toHaveLength(1);
  });
});
