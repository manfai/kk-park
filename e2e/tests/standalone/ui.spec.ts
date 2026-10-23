import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from '../../fixtures/standalone';
import type { TestHooksWindow } from '../../helpers/editor';
import { sendHookEvent, sessionStartStartup } from '../../helpers/hooks';
import { buildSeedLayout } from '../../helpers/layout-seed';
import {
  closeAgentFromOverlay,
  expectOverlayCount,
  expectOverlayVisible,
} from '../../helpers/office';
import {
  closeSessionsManager,
  nameSession,
  sessionRow,
  showAllSessions,
} from '../../helpers/sessions';
import { openSettingsModal, setSettings } from '../../helpers/webview';

// onReloadAssets does its filesystem work after the externalAssetDirectoriesUpdated
// reply, so the re-broadcast lands slightly later than the dir-list update.
const ASSET_RELOAD_TIMEOUT_MS = 15_000;
// WebSocketTransport reconnects with capped exponential backoff (up to 4s);
// allow a couple of retry cycles for the state to settle both ways.
const CONNECTION_STATE_TIMEOUT_MS = 15_000;

test.describe('Standalone / UI', () => {
  test.describe('Archive parking', () => {
    test.use({
      standaloneOptions: {
        seedLayout: buildSeedLayout({
          furniture: [{ uid: 'archive-cage', type: 'JAIL_CAGE', col: 5, row: 5 }],
        }),
      },
    });
    test('Archive confines one character per cage, persists across reload and releases on restore @area:standalone', async ({
      page,
      standalone,
    }) => {
      await setSettings(page, {
        alwaysShowLabels: true,
        hooksEnabled: true,
        watchAllSessions: true,
        debugView: false,
      });
      await standalone.drainMessages();

      const sessionId = 'standalone-close-agent-session';
      const filePath = path.join(standalone.workspaceDir, 'close-agent.ts');

      await sendHookEvent(
        standalone.hookServerConfig,
        sessionStartStartup(sessionId, standalone.workspaceDir),
      );
      await nameSession(page, sessionId, 'Archive Me');
      await sendHookEvent(standalone.hookServerConfig, {
        sessionId: sessionId,
        cwd: standalone.workspaceDir,
        hook_event_name: 'preToolUse',
        toolName: 'view',
        toolArgs: { path: filePath },
      });

      await expectOverlayCount(page, 1);
      await expectOverlayVisible(page, 'Reading close-agent.ts');
      await standalone.drainMessages();

      await closeAgentFromOverlay(page, { text: 'Reading close-agent.ts' });

      const confirmation = page.getByTestId('archive-confirmation');
      await expect(confirmation).toBeVisible();
      await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expectOverlayVisible(page, 'Reading close-agent.ts');
      await closeAgentFromOverlay(page, { text: 'Reading close-agent.ts' });
      await confirmation.getByRole('button', { name: 'Archive character', exact: true }).click();
      await expectOverlayCount(page, 1);
      await expectOverlayVisible(page, 'ARCHIVED');
      await expect(page.getByTitle('Archive Me', { exact: true })).toHaveCount(0);
      await expect(page.getByTestId('agent-overlay')).toHaveText('ARCHIVED');
      await expect(page.getByTestId('archived-label')).toHaveCSS('font-size', '44px');
      const parkedCharacter = () =>
        page.evaluate(() =>
          (window as TestHooksWindow).__pixelAgentsTestHooks
            ?.getCharacters?.()
            .find((character) => character.isArchived),
        );
      await expect.poll(async () => (await parkedCharacter())?.state).toBe('idle');
      const parked = await parkedCharacter();
      expect(parked).toBeTruthy();
      expect(parked).toMatchObject({
        archiveCageId: 'archive-cage',
        tileCol: 5,
        tileRow: 7,
        x: 96,
        y: 120,
      });
      await sendHookEvent(standalone.hookServerConfig, {
        sessionId,
        cwd: standalone.workspaceDir,
        hook_event_name: 'userPromptSubmitted',
      });
      await expect.poll(parkedCharacter).toEqual(parked);
      await setSettings(page, { alwaysShowLabels: false });
      await page.reload();
      await expectOverlayVisible(page, 'ARCHIVED');
      await expect(page.getByTestId('agent-overlay')).toHaveText('ARCHIVED');
      await expect(page.getByTitle('Archive Me', { exact: true })).toHaveCount(0);
      await expect.poll(async () => (await parkedCharacter())?.state).toBe('idle');
      expect((await parkedCharacter())?.id).toBe(parked!.id);
      await expect.poll(async () => (await parkedCharacter())?.archiveCageId).toBe('archive-cage');
      await page.screenshot({ path: test.info().outputPath('archived-inside-cage.png') });
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.getByTitle('Archive Me', { exact: true })).toHaveCount(0);
      await expect(page.getByTestId('archived-label')).toBeVisible();
      await page.screenshot({ path: test.info().outputPath('archived-mobile.png') });
      await page.setViewportSize({ width: 1280, height: 800 });
      await setSettings(page, { alwaysShowLabels: true });

      const secondId = 'second-cage-session';
      await sendHookEvent(
        standalone.hookServerConfig,
        sessionStartStartup(secondId, standalone.workspaceDir),
      );
      await nameSession(page, secondId, 'Waiting for Cage');
      await closeAgentFromOverlay(page, { text: 'Waiting for Cage' });
      await expect(confirmation.getByRole('alert')).toContainText('No reachable free Jail Cage');
      await expect(
        confirmation.getByRole('button', { name: 'Archive character', exact: true }),
      ).toBeDisabled();
      await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
      await showAllSessions(page);
      await sessionRow(page, sessionId)
        .getByRole('button', { name: 'Restore to office', exact: true })
        .click();
      await expect(sessionRow(page, sessionId)).not.toContainText('Archived');
      await closeSessionsManager(page);
      await expect(page.getByTitle('Archive Me', { exact: true })).toBeVisible();
      await closeAgentFromOverlay(page, { text: 'Waiting for Cage' });
      await confirmation.getByRole('button', { name: 'Archive character', exact: true }).click();
      await expect.poll(async () => (await parkedCharacter())?.state).toBe('idle');
      expect((await parkedCharacter())?.id).not.toBe(parked!.id);
      expect((await parkedCharacter())?.archiveCageId).toBe('archive-cage');
      const messages = await standalone.drainMessages();
      expect(messages.some((message) => message.type === 'agentClosed')).toBe(false);
    });
  });

  test('Debug View shows hook delivery diagnostics @area:standalone', async ({
    page,
    standalone,
  }) => {
    await setSettings(page, {
      debugView: true,
      alwaysShowLabels: true,
      watchAllSessions: true,
    });
    const sessionId = 'standalone-debug-view-session';
    await sendHookEvent(
      standalone.hookServerConfig,
      sessionStartStartup(sessionId, standalone.workspaceDir),
    );
    await nameSession(page, sessionId, 'Debug Reader');
    await sendHookEvent(standalone.hookServerConfig, {
      sessionId,
      cwd: standalone.workspaceDir,
      hook_event_name: 'preToolUse',
      toolName: 'view',
      toolArgs: { path: 'debug-view.ts' },
    });
    await expect(page.getByText('Hooks received', { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/Last data:/)).toBeVisible();
  });

  test('adding an external asset directory triggers a live asset reload @area:standalone', async ({
    page,
    standalone,
  }) => {
    const modal = await openSettingsModal(page);
    await standalone.drainMessages();

    await modal
      .locator('input[placeholder="Absolute asset directory path"]')
      .fill(standalone.workspaceDir);
    await modal.locator('button', { hasText: 'Add' }).click();

    // getByTitle matches the title attribute literally; a raw CSS
    // [title="..."] selector would mis-parse the backslashes in a Windows path
    // as CSS escapes and never match its own title.
    await expect(modal.getByTitle(standalone.workspaceDir, { exact: true })).toBeVisible();

    // Light depth: prove the onReloadAssets re-broadcast fired, not a
    // character-count delta (no fixture PNGs staged in workspaceDir).
    await expect
      .poll(
        async () => {
          const messages = await standalone.drainMessages();
          return messages.some((message) => message.type === 'characterSpritesLoaded');
        },
        { timeout: ASSET_RELOAD_TIMEOUT_MS },
      )
      .toBe(true);
  });

  test('browser Export Layout downloads the layout file @area:standalone', async ({
    page,
    standalone,
  }) => {
    await standalone.drainMessages();
    const modal = await openSettingsModal(page);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      modal.locator('button', { hasText: 'Export Layout' }).click(),
    ]);

    expect(download.suggestedFilename()).toBe('pixel-agents-layout.json');
  });

  test('browser Import Layout applies the chosen file @area:standalone', async ({
    page,
    standalone,
  }) => {
    await standalone.drainMessages();

    const uniqueLabel = `Imported Area ${Date.now().toString()}`;
    const layout = buildSeedLayout({
      areas: [{ label: uniqueLabel, color: '#4287f5' }],
      areaTiles: [{ col: 1, row: 1, label: uniqueLabel }],
    });
    const tmpFile = path.join(standalone.workspaceDir, 'import-layout.json');
    fs.writeFileSync(tmpFile, JSON.stringify(layout));

    try {
      const modal = await openSettingsModal(page);
      // Set the hidden import input directly rather than clicking "Import
      // Layout" (which would open the OS file dialog Playwright can't drive).
      await page.setInputFiles('input[type="file"]', tmpFile);
      await expect(modal).toBeHidden();

      // saveLayout is client→server and unrecorded by drainMessages (Seam A),
      // so assert the applied OfficeState instead of the wire message.
      await expect
        .poll(() =>
          page.evaluate(
            () => (globalThis.window as TestHooksWindow).__pixelAgentsTestHooks?.getAreas?.() ?? [],
          ),
        )
        .toContainEqual({ label: uniqueLabel, color: '#4287f5' });
    } finally {
      fs.rmSync(tmpFile, { force: true });
    }
  });

  test('ConnectionIndicator appears when the WebSocket connection drops @area:standalone', async ({
    page,
    standalone,
  }) => {
    await standalone.drainMessages();

    // Settle wait before the negative assertion (office.ts wait-strategy
    // convention): give the runtime a chance to render the indicator wrongly
    // before checking absence.
    await page.waitForTimeout(500);
    await expect(page.getByText(/Reconnecting|Disconnected/)).toHaveCount(0);

    // Fallback for assumption A1: `page.context().setOffline(true)` does not
    // reliably close an already-open WebSocket on this Chromium build (verified
    // empirically — the indicator never appeared). Stopping the real host
    // process closes the socket from the server side instead.
    await standalone.stopHost();
    await expect(page.getByText(/Reconnecting|Disconnected/)).toBeVisible({
      timeout: CONNECTION_STATE_TIMEOUT_MS,
    });

    await standalone.startHost();
    await expect(page.getByText(/Reconnecting|Disconnected/)).toHaveCount(0, {
      timeout: CONNECTION_STATE_TIMEOUT_MS,
    });
  });
});
