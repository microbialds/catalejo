// The Typing column of the genome table (requirements §6.1; data contract
// §5.9, §6.1). The column shows the typing chip keys of
// config/typing_display.yaml (src/generated/typingDisplay.ts) whose display
// group is `typing`, without the sequence type, which has its own column, and
// without the scores, whose groups are virulence and resistance_score. The
// values of one genome follow the configured order of tools and keys and are
// joined with the interface separator.
//
// The values are read from tables/typing.parquet for the genome identifiers
// of one table page only, at the table's low priority; the file is sorted by
// genome_id, so DuckDB-WASM reads the row groups that hold them.
import { typingDisplay } from '../generated/typingDisplay';
import type { GenomeFilters } from '../set/filters';
import { strings } from '../strings';
import { sqlString } from './release';
import type { Row } from './release';
import type { SetEngine } from './setEngine';
import { sqlList } from './setEngine';

export const TYPING_FILE = 'tables/typing.parquet';

export interface TypingColumnKey {
  tool: string;
  key: string;
}

interface DisplayTool {
  tool: string;
  chips: readonly { key: string; displayGroup: string }[];
}

/** The sequence type, shown in the ST column. */
const ST_KEY = 'ST';

/** The keys of the Typing column, in configured tool and key order. */
export function typingColumnKeys(tools: readonly DisplayTool[] = typingDisplay): TypingColumnKey[] {
  return tools.flatMap((tool) =>
    tool.chips
      .filter((chip) => chip.displayGroup === 'typing' && chip.key !== ST_KEY)
      .map((chip) => ({ tool: tool.tool, key: chip.key })),
  );
}

export const TYPING_COLUMN_KEYS: readonly TypingColumnKey[] = typingColumnKeys();

/** The query for the column's values of some genomes, or undefined when there is nothing to ask. */
export function typingSql(
  relation: string,
  genomeIds: readonly string[],
  keys: readonly TypingColumnKey[] = TYPING_COLUMN_KEYS,
): string | undefined {
  if (genomeIds.length === 0 || keys.length === 0) return undefined;
  const byTool = new Map<string, string[]>();
  for (const { tool, key } of keys) byTool.set(tool, [...(byTool.get(tool) ?? []), key]);
  const pairs = [...byTool]
    .map(
      ([tool, toolKeys]) => `(source_tool = ${sqlString(tool)} AND key IN (${sqlList(toolKeys)}))`,
    )
    .join(' OR ');
  return (
    `SELECT genome_id, source_tool, key, value FROM ${relation} ` +
    `WHERE genome_id IN (${sqlList(genomeIds)}) AND (${pairs})`
  );
}

function text(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  return null;
}

/** Per genome, the column's text; genomes without a value are absent. */
export function typingValues(
  rows: readonly Row[],
  keys: readonly TypingColumnKey[] = TYPING_COLUMN_KEYS,
): Map<string, string> {
  const rank = new Map(keys.map(({ tool, key }, i) => [`${tool}\u0000${key}`, i]));
  const found = new Map<string, { rank: number; value: string }[]>();
  for (const row of rows) {
    const genomeId = text(row.genome_id);
    const value = text(row.value)?.trim() ?? '';
    const order = rank.get(`${text(row.source_tool) ?? ''}\u0000${text(row.key) ?? ''}`);
    if (genomeId === null || value === '' || order === undefined) continue;
    found.set(genomeId, [...(found.get(genomeId) ?? []), { rank: order, value }]);
  }
  const out = new Map<string, string>();
  for (const [genomeId, values] of found) {
    const sorted = values.sort(
      (a, b) => a.rank - b.rank || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0),
    );
    out.set(genomeId, sorted.map((entry) => entry.value).join(strings.separator));
  }
  return out;
}

/** The column's values for the genomes of one table page, at low priority. */
export async function readTyping(
  engine: SetEngine,
  filters: GenomeFilters,
  genomeIds: readonly string[],
): Promise<Map<string, string>> {
  if (genomeIds.length === 0 || TYPING_COLUMN_KEYS.length === 0) return new Map();
  const rows = await engine.aggregate(
    filters,
    async (context) => typingSql(await context.relation(TYPING_FILE), genomeIds) ?? '',
    'low',
  );
  return typingValues(rows);
}
