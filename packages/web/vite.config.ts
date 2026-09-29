// Vite, Vitest and the /data/ release server (requirements §9, §10).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { releaseData } from './vite/releaseData.ts';

// Resolved from this file, not from the working directory.
const webRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(webRoot, '..', '..');

export default defineConfig({
  plugins: [react(), tailwindcss(), releaseData(repoRoot)],
  server: {
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
  build: {
    // DuckDB-WASM binaries are emitted as files, never inlined.
    assetsInlineLimit: 0,
  },
  test: {
    include: ['test/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    environment: 'node',
    testTimeout: 60_000,
  },
});
