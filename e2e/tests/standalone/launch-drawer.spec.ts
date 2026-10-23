import fs from 'node:fs';
import path from 'node:path';

import type { Locator, Page } from '@playwright/test';

import { expect, test } from '../../fixtures/standalone';
import { preToolUseBash } from '../../helpers/hooks';
import {
  arrangeNextCopilotInvocation,
  copilotScenario,
  waitForCopilotHookSetup,
} from '../../helpers/mock-copilot';
import { expectOverlayCount, expectOverlayVisibleWithTexts } from '../../helpers/office';
import {
  closeSessionsManager,
  launchNamedSession,
  openSessionsManager,
} from '../../helpers/sessions';
import {
  addDirectory,
  getDirectoryModal,
  getSettingChecked,
  openDirectoryModal,
  setSettings,
  SHOW_START_DIRECTORY_LABEL,
  SKIP_PERMISSIONS_LABEL,
  submitDirectoryModal,
} from '../../helpers/webview';

async function arrangeWorkingSession(home: string, name: string): Promise<void> {
  await waitForCopilotHookSetup(home);
  await arrangeNextCopilotInvocation(
    home,
    copilotScenario(name)
      .at(1_000)
      .emitHook(preToolUseBash('{{sessionId}}', 'npm test') as Record<string, unknown>)
      .holdOpenFor(60_000)
      .build(),
  );
}

test.describe('Standalone / session launch Directories', () => {
  test.skip(process.platform === 'win32', 'PTY spawn of the .cmd mock shim is untested on Windows');
  test.use({ standaloneOptions: { mockCopilot: true } });

  test('the server start Directory is read-only and launches a named character with its folder context @area:standalone', async ({
    page,
    standalone,
  }) => {
    await setSettings(page, { alwaysShowLabels: true });
    await arrangeWorkingSession(standalone.tmpHome, 'host Directory launch');
    await page.getByRole('button', { name: '+ Agent', exact: true }).click();
    const manager = await openSessionsManager(page);
    await expectOverlayCount(page, 0);
    const directoryName = path.basename(standalone.workspaceDir);
    await expect(manager.getByRole('combobox', { name: 'New session Directory' })).toHaveValue(
      standalone.workspaceDir,
    );
    await expect(manager.getByText('Host Directory · read-only', { exact: true })).toBeVisible();
    await expect(manager.getByRole('button', { name: 'Edit Directory', exact: true })).toHaveCount(
      0,
    );
    await launchNamedSession(page);
    await expectOverlayCount(page, 1);
    await expectOverlayVisibleWithTexts(page, ['Agent 1', 'Running command', directoryName]);
  });
});

test.describe('Standalone / user-defined Directories', () => {
  test.skip(process.platform === 'win32', 'PTY spawn of the .cmd mock shim is untested on Windows');
  test.use({ standaloneOptions: { mockCopilot: true } });

  test('a Directory added in the modal launches an agent and is still there after a reload @area:standalone', async ({
    page,
    standalone,
  }) => {
    await setSettings(page, { alwaysShowLabels: true });
    const target = path.join(standalone.workspaceDir, 'side-project');
    fs.mkdirSync(target, { recursive: true });
    await addDirectory(page, { name: 'Side Project', path: target });
    await arrangeWorkingSession(standalone.tmpHome, 'user Directory launch');
    const manager = await openSessionsManager(page);
    await manager.getByRole('combobox').selectOption(target);
    await expect(manager.getByText('Host Directory · read-only', { exact: true })).toHaveCount(0);
    await expect(
      manager.getByRole('button', { name: 'Edit Directory', exact: true }),
    ).toBeVisible();
    await launchNamedSession(page, { directoryPath: target });
    await expectOverlayCount(page, 1);
    await expectOverlayVisibleWithTexts(page, ['Running command', 'Side Project']);
    const configPath = path.join(standalone.tmpHome, '.pixel-agents', 'config.json');
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8')) as {
      directories?: Array<{ name: string; path: string }>;
    };
    expect(cfg.directories).toEqual([{ name: 'Side Project', path: target }]);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible({
      timeout: 30_000,
    });
    const reloaded = await openSessionsManager(page);
    await expect(
      reloaded.getByRole('option', { name: `Side Project — ${target}`, exact: true }),
    ).toHaveCount(1);
  });

  test('deleting a Directory drops its option and leaves its running agent alone @area:standalone', async ({
    page,
    standalone,
  }) => {
    await setSettings(page, { alwaysShowLabels: true });
    const target = path.join(standalone.workspaceDir, 'doomed-project');
    fs.mkdirSync(target, { recursive: true });
    await addDirectory(page, { name: 'Doomed Project', path: target });
    await arrangeWorkingSession(standalone.tmpHome, 'deleted Directory launch');
    await launchNamedSession(page, { directoryPath: target });
    await expectOverlayVisibleWithTexts(page, ['Running command', 'Doomed Project']);
    const manager = await openSessionsManager(page);
    await manager.getByRole('combobox').selectOption(target);
    await manager.getByRole('button', { name: 'Edit Directory', exact: true }).click();
    const modal = getDirectoryModal(page);
    await modal.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(modal).toBeHidden();
    await expect(
      manager.getByRole('option', { name: `Doomed Project — ${target}`, exact: true }),
    ).toHaveCount(0);
    await closeSessionsManager(page);
    await expectOverlayCount(page, 1);
    await expectOverlayVisibleWithTexts(page, ['Running command', 'Doomed Project']);
  });
});

test.describe('Standalone / Directory validation', () => {
  test('an invalid path is refused inline and nothing is persisted @area:standalone', async ({
    page,
    standalone,
  }) => {
    const missing = path.join(standalone.workspaceDir, 'does-not-exist');
    const modal = await openDirectoryModal(page);
    await submitDirectoryModal(modal, { name: 'Ghost', path: missing });
    await expect(modal).toBeVisible();
    await expect(modal.getByRole('alert')).toContainText(missing);
    const configPath = path.join(standalone.tmpHome, '.pixel-agents', 'config.json');
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8')) as {
      directories?: Array<{ name: string }>;
    };
    expect(cfg.directories ?? []).toEqual([]);
    await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
    const manager = await openSessionsManager(page);
    await expect(
      manager.getByRole('option', { name: `Ghost — ${missing}`, exact: true }),
    ).toHaveCount(0);
  });
});

test.describe('Standalone / host Directory setting', () => {
  test.use({ standaloneOptions: { seedConfig: { standalone: { showHostDirectories: false } } } });

  test('the start Directory is hidden by default and Show Start Directory lists it @area:standalone', async ({
    page,
    standalone,
  }) => {
    const optionName = `${path.basename(standalone.workspaceDir)} — ${standalone.workspaceDir}`;
    expect(await getSettingChecked(page, SHOW_START_DIRECTORY_LABEL)).toBe(false);
    let manager = await openSessionsManager(page);
    await expect(manager.getByRole('button', { name: '+ Directory', exact: true })).toBeVisible();
    await expect(manager.getByRole('option', { name: optionName, exact: true })).toHaveCount(0);
    await closeSessionsManager(page);
    await setSettings(page, { showStartDirectory: true });
    manager = await openSessionsManager(page);
    await expect(manager.getByRole('option', { name: optionName, exact: true })).toHaveCount(1);
    await expect(manager.getByText('Host Directory · read-only', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible({
      timeout: 30_000,
    });
    manager = await openSessionsManager(page);
    await expect(manager.getByRole('option', { name: optionName, exact: true })).toHaveCount(1);
  });
});

test.describe('Standalone / permission posture', () => {
  test('the skip-permissions setting lands on disk and survives a reload @area:standalone', async ({
    page,
    standalone,
  }) => {
    expect(await getSettingChecked(page, SKIP_PERMISSIONS_LABEL)).toBe(false);
    await expect(page.getByText('Skip permissions mode')).toHaveCount(0);
    await setSettings(page, { bypassPermissions: true });
    const configPath = path.join(standalone.tmpHome, '.pixel-agents', 'config.json');
    await expect
      .poll(
        () => {
          const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8')) as {
            standalone?: { bypassPermissions?: boolean };
          };
          return cfg.standalone?.bypassPermissions ?? false;
        },
        { timeout: 10_000 },
      )
      .toBe(true);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible({
      timeout: 30_000,
    });
    expect(await getSettingChecked(page, SKIP_PERMISSIONS_LABEL)).toBe(true);
  });

  test('turning skip-permissions on in one office shows it on in another already open @area:standalone', async ({
    page,
    standalone: _standalone,
  }) => {
    const other = await page.context().newPage();
    await other.goto(page.url());
    await expect(other.getByRole('button', { name: 'Settings', exact: true })).toBeVisible({
      timeout: 30_000,
    });
    expect(await getSettingChecked(other, SKIP_PERMISSIONS_LABEL)).toBe(false);
    await setSettings(page, { bypassPermissions: true });
    await expect
      .poll(() => getSettingChecked(other, SKIP_PERMISSIONS_LABEL), { timeout: 10_000 })
      .toBe(true);
    await other.close();
  });
});

const MANY_DIRECTORIES = Array.from({ length: 33 }, (_, i) => ({
  name: `Project ${String(i + 1).padStart(2, '0')}`,
  path: `/pixel-agents-e2e/project-${i + 1}`,
}));

async function expectManagerFits(page: Page, manager: Locator): Promise<void> {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('no viewport');
  const box = await manager.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
  const directories = manager.getByRole('combobox');
  await directories.selectOption(MANY_DIRECTORIES[32].path);
  await expect(directories).toHaveValue(MANY_DIRECTORIES[32].path);
  const add = manager.getByRole('button', { name: '+ Directory', exact: true });
  await add.scrollIntoViewIfNeeded();
  await expect(add).toBeInViewport({ ratio: 1 });
  await expect(manager.getByRole('button', { name: 'x', exact: true })).toBeInViewport({
    ratio: 1,
  });
}

test.describe('Standalone / long Directory lists', () => {
  test.use({ standaloneOptions: { seedConfig: { directories: MANY_DIRECTORIES } } });

  test('the Sessions manager fits the viewport, its Directory selector reaches the last option and + Directory stays reachable @area:standalone', async ({
    page,
    standalone: _standalone,
  }) => {
    for (const size of [
      { width: 1280, height: 800 },
      { width: 1280, height: 360 },
    ]) {
      await page.setViewportSize(size);
      const manager = await openSessionsManager(page);
      await expectManagerFits(page, manager);
      await manager.getByRole('button', { name: '+ Directory', exact: true }).click();
      await expect(getDirectoryModal(page)).toBeVisible();
      await getDirectoryModal(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    }
  });
});

test.describe('Standalone / long Directory lists on a phone', () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    standaloneOptions: {
      viewport: { width: 390, height: 844 },
      seedConfig: { directories: MANY_DIRECTORIES },
    },
  });

  test('the phone Sessions manager fits and keeps its last Directory and + Directory reachable @area:mobile', async ({
    page,
    standalone: _standalone,
  }) => {
    const manager = await openSessionsManager(page);
    await expectManagerFits(page, manager);
    await manager.getByRole('button', { name: '+ Directory', exact: true }).tap();
    await expect(getDirectoryModal(page)).toBeVisible();
  });
});
