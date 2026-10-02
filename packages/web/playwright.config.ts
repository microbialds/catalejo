// Playwright against the synthetic release served at /data/ (requirements
// §13): in CI against the production build in `vite preview`, so the tests
// see the bundle that is deployed, and locally against the development
// server. Both serve /data/ and /assets/ through the plugins in vite/, and
// the preview takes the development port so that baseURL is the same. Chromium at the two desktop widths the
// critic checks for every page, and at 390 px for the specs of the pages the
// critic also checks there, the shell and the collection page (requirements
// §5.10). A test that applies to one width only skips the others by name.
import { defineConfig, devices } from '@playwright/test';

const port = 5173;
const ci = !!process.env.CI;

export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${String(port)}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium-1440',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'chromium-1024',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1024, height: 768 } },
    },
    {
      name: 'chromium-390',
      testMatch: ['**/global.spec.ts', '**/collection.spec.ts', '**/genomes.spec.ts'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: {
    command: ci ? `pnpm build && pnpm preview --port ${String(port)} --strictPort` : 'pnpm dev',
    url: `http://localhost:${String(port)}`,
    reuseExistingServer: !ci,
    // The build (type check, bundle, check-dist) runs before the preview.
    timeout: ci ? 360_000 : 120_000,
  },
});
