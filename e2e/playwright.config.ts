import { defineConfig } from '@playwright/test';
import path from 'path';

import { namespaceE2EPath } from './run-config';

process.env['ALLURE_LABEL_epic'] ??= 'e2e';

const artifactsDir = namespaceE2EPath(path.join(__dirname, '../test-results/e2e'));
const allureResultsDir = namespaceE2EPath(path.join(__dirname, '../allure-results/e2e'));
const htmlReportDir = namespaceE2EPath(path.join(__dirname, '../playwright-report/e2e'));

export default defineConfig({
  testDir: path.join(__dirname, 'tests'),
  timeout: 120_000,
  globalSetup: path.join(__dirname, 'global-setup.ts'),
  reporter: [
    ['list'],
    [
      'html',
      {
        // Must be outside outputDir to avoid Playwright clearing artifacts
        outputFolder: htmlReportDir,
        open: 'never',
      },
    ],
    [
      'allure-playwright',
      {
        resultsDir: allureResultsDir,
      },
    ],
  ],
  outputDir: artifactsDir,
  // NOTE: browser-context settings here are no-ops for the VS Code tests
  // (they launch Electron directly via electron.launch(); video for them is
  // configured in e2e/helpers/launch.ts and screenshots are taken manually in
  // the fixture teardown). `video` DOES apply to the standalone suite, which
  // uses Playwright's standard browser `page` fixture.
  use: {
    video: 'on',
  },
  // Default to one worker locally; CI can override this with --workers.
  workers: 1,
  // Distribute tests rather than files so large editor specs do not dominate
  // one shard. With fullyParallel, tests are distributed individually.
  // workers=1 still keeps tests sequential within a shard; only the shard
  // assignment strategy changes.
  fullyParallel: true,
  // Retry once for tests that are sensitive to ordering / load (timing-driven
  // assertions about hook delivery and rendering). Tests that pass in isolation
  // but flake under serial load see this; the retry hides true flakes while
  // still surfacing genuinely broken tests.
  retries: 1,
});
