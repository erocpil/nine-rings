import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testIgnore: '**/pwa-offline.spec.ts',
  timeout: 30000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://localhost:8000',
    headless: true,
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: 'npx vite --host 0.0.0.0 --port 8000',
    port: 8000,
    reuseExistingServer: true,
    timeout: 30000,
  },
});
