// @ts-check
import { defineConfig } from '@playwright/test';
import config from './playwright.config.js';

// Focused source-served journal, panel and workspace checks.
export default defineConfig({
  ...config,
  outputDir: 'test-results/workspace',
  testIgnore: [],
  testMatch: [
    'party-journal.spec.js',
    'journal-pagination.spec.js',
    'panels.spec.js',
    'workspace-controls.spec.js',
    'deferred-previews.spec.js',
    'campaign-preparation.spec.js',
  ],
  reporter: 'list',
  use: { ...config.use, baseURL: 'http://127.0.0.1:4180' },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4180 --strictPort',
    url: 'http://127.0.0.1:4180',
    reuseExistingServer: false,
  },
});
