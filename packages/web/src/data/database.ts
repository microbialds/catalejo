// Access to the database for components (data contract §6). The shell does
// not open the database in milestone 0; pages call the context's function
// when they first need a table, which loads ./duckdb.ts and the engine.
import type { AsyncDuckDB } from '@duckdb/duckdb-wasm';
import { createContext } from 'react';

export type OpenDatabase = () => Promise<AsyncDuckDB>;

export const openDatabase: OpenDatabase = async () => {
  const { getDatabase } = await import('./duckdb');
  return getDatabase();
};

export const DatabaseContext = createContext<OpenDatabase>(openDatabase);
