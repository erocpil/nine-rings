import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/pwa-offline.spec.ts',
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
