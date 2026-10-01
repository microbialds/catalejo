// The query order of the browser release source (data/release.ts;
// requirements §6.1, §9; checklist C4). DuckDB-WASM runs one statement at a
// time: queries wait in a high and a low queue, the next one comes from the
// high queue while it holds any, and each queue keeps its order, so that a
// statement creating a table runs before the queries issued after it.
import type { AsyncDuckDB } from '@duckdb/duckdb-wasm';
import { describe, expect, it } from 'vitest';
import type { Manifest } from '../src/data/manifest';
import { createBrowserSource } from '../src/data/release';

interface Pending {
  sql: string;
  finish: (error?: Error) => void;
}

/** A database whose statements finish when the test says so. */
function fakeDatabase() {
  const started: Pending[] = [];
  const connection = {
    query: (sql: string) =>
      new Promise((resolve, reject) => {
        started.push({
          sql,
          finish: (error) => {
            if (error === undefined) resolve({ toArray: () => [{ toJSON: () => ({ sql }) }] });
            else reject(error);
          },
        });
      }),
  };
  const db = { connect: () => Promise.resolve(connection) } as unknown as AsyncDuckDB;
  return { db, started };
}

const manifest = { files: [] } as unknown as Manifest;

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

describe('browser release source queue', () => {
  it('runs one statement at a time, high before queued low, each queue in order', async () => {
    const { db, started } = fakeDatabase();
    const source = createBrowserSource(db, manifest);
    const done: string[] = [];
    const track = (promise: Promise<unknown>, name: string) =>
      promise.then(() => {
        done.push(name);
      });
    const all = [
      track(source.query('low 1', 'low'), 'low 1'),
      track(source.query('low 2', 'low'), 'low 2'),
    ];
    await settle();
    expect(started.map((statement) => statement.sql)).toEqual(['low 1']);
    all.push(track(source.query('high 1'), 'high 1'), track(source.query('high 2'), 'high 2'));
    for (let i = 0; i < 4; i += 1) {
      await settle();
      started[i]?.finish();
    }
    await Promise.all(all);
    expect(started.map((statement) => statement.sql)).toEqual([
      'low 1',
      'high 1',
      'high 2',
      'low 2',
    ]);
    expect(done).toEqual(['low 1', 'high 1', 'high 2', 'low 2']);
  });

  it('rejects a failing statement and goes on with the next', async () => {
    const { db, started } = fakeDatabase();
    const source = createBrowserSource(db, manifest);
    const failing = source.query('bad');
    const next = source.query('good');
    await settle();
    started[0]?.finish(new Error('syntax'));
    await expect(failing).rejects.toThrow('syntax');
    await settle();
    started[1]?.finish();
    await expect(next).resolves.toEqual([{ sql: 'good' }]);
  });
});
