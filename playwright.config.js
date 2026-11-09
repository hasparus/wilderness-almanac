// @ts-check
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  outputDir: 'test-results/map',
  testDir: './e2e',
  testIgnore: [
    '**/storage.spec.js',
    '**/account.spec.js',
    '**/journal-pagination.spec.js',
    '**/deferred-previews.spec.js',
    '**/campaign-preparation.spec.js',
  ],
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 15000 },
  globalTimeout: 20 * 60 * 1000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4178',
    // Motion is exercised explicitly by renderer and navigation checks.
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    permissions: ['clipboard-read', 'clipboard-write'],
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4178 --strictPort',
    url: 'http://127.0.0.1:4178',
    reuseExistingServer: false,
  },
});
