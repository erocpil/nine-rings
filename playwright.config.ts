import { defineConfig } from '@playwright/test';
import { productionOnlyFiles } from './scripts/e2e-suites.mjs';

export default defineConfig({
  testDir: './e2e',
  testIgnore: productionOnlyFiles.map(file => `**/${file}`),
  timeout: 30000,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 4,
  use: {
    baseURL: 'http://localhost:8000',
    headless: true,
    // Keep navigation, network and DOM evidence for intermittent context loss.
    trace: 'retain-on-failure',
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: 'npx vite --host 0.0.0.0 --port 8000',
    port: 8000,
    // Preserve Vite reload/dependency diagnostics when a page context disappears.
    stdout: 'pipe',
    reuseExistingServer: true,
    timeout: 30000,
  },
});
