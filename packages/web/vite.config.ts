// Vite, Vitest, the /data/ release server and the /assets/ DuckDB server
// (requirements §9, §10).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { duckdbAssets, duckdbWasmVersion } from './vite/duckdbAssets.ts';
import { releaseData } from './vite/releaseData.ts';

// Resolved from this file, not from the working directory.
const webRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(webRoot, '..', '..');

export default defineConfig({
  plugins: [react(), tailwindcss(), releaseData(repoRoot), duckdbAssets(webRoot)],
  define: {
    // The engine files are loaded from /assets/duckdb-wasm/<version>/, which
    // the build does not contain (see src/data/engineAssets.ts).
    __DUCKDB_WASM_VERSION__: JSON.stringify(duckdbWasmVersion(webRoot)),
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
  test: {
    include: ['test/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    environment: 'node',
    testTimeout: 60_000,
  },
});
