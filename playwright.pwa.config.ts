import { defineConfig } from '@playwright/test';
import { productionOnlyFiles } from './scripts/e2e-suites.mjs';

export default defineConfig({
  testDir: './e2e',
  testMatch: productionOnlyFiles.map(file => `**/${file}`),
  timeout: 45000,
  use: {
    baseURL: 'http://localhost:8001',
    headless: true,
    viewport: { width: 390, height: 760 },
    serviceWorkers: 'allow',
  },
  webServer: {
    command: 'npx vite preview --host 0.0.0.0 --port 8001',
    port: 8001,
    reuseExistingServer: false,
    timeout: 30000,
  },
});
