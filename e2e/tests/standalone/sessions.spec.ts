import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from '../../fixtures/standalone';
import { buildSeedLayout } from '../../helpers/layout-seed';
import {
  arrangeNextCopilotInvocation,
  copilotScenario,
  killTrackedExternalProcesses,
  spawnExternalCopilotScenario,
  waitForCopilotHookSetup,
} from '../../helpers/mock-copilot';
import {
  expectOverlayCount,
  expectOverlayVisibleWithTexts,
  getOverlayByText,
} from '../../helpers/office';
import {
  closeSessionsManager,
  getSessionsManager,
  launchUnnamedSession,
  nameSession,
  openSessionsManager,
  seedSessionMetadata,
  sessionRow,
  showAllSessions,
} from '../../helpers/sessions';
import { setSettings } from '../../helpers/webview';

function invocationLines(file: string, sessionId: string): string[] {
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.includes(`session-id=${sessionId} `));
}

test.describe('Standalone / session-first office', () => {
  test.skip(process.platform === 'win32', 'PTY spawn of the .cmd mock shim is untested on Windows');
  test.use({
    standaloneOptions: {
      mockCopilot: true,
      seedLayout: buildSeedLayout({
        furniture: [{ uid: 'archive-cage', type: 'JAIL_CAGE', col: 5, row: 0 }],
      }),
    },
  });

  test('unnamed sessions stay hidden; Archive confirms, preserves named characters and history, and stops the managed CLI @area:standalone', async ({
    page,
    standalone,
  }) => {
    await setSettings(page, { alwaysShowLabels: true, watchAllSessions: true });
    await waitForCopilotHookSetup(standalone.tmpHome);
    const historyId = 'history-unnamed-session';
    const externalId = 'external-unnamed-session';
    const historyFile = seedSessionMetadata(standalone.tmpHome, historyId, standalone.workspaceDir);
    // Discovery must use the first session.start context, never later JSONL records.
    fs.appendFileSync(
      historyFile,
      `${JSON.stringify({ type: 'session.info', data: { context: { cwd: '/not-the-session-directory' } } })}\n`,
    );
    const originalHistory = fs.readFileSync(historyFile, 'utf8');
    try {
      await spawnExternalCopilotScenario({
        ...standalone,
        sessionId: externalId,
        scenario: copilotScenario('unnamed external')
          .at(500)
          .emitHook({
            hook_event_name: 'preToolUse',
            toolName: 'view',
            toolArgs: { path: 'external.ts' },
          })
          .holdOpenFor(120_000)
          .build(),
      });
      let manager = await showAllSessions(page);
      await expect(sessionRow(page, historyId)).toContainText(standalone.workspaceDir);
      await expect(sessionRow(page, historyId)).not.toContainText('/not-the-session-directory');
      await expect(sessionRow(page, externalId)).toContainText('Connected');
      await manager.getByRole('button', { name: 'Named', exact: true }).click();
      await expect(manager.getByTestId('session-row')).toHaveCount(0);
      await manager.getByRole('button', { name: 'Archived / unnamed', exact: true }).click();
      await expect(manager.getByTestId('session-row')).toHaveCount(2);
      await manager.getByRole('textbox', { name: 'Search sessions', exact: true }).fill(historyId);
      await expect(manager.getByTestId('session-row')).toHaveCount(1);
      await expect(sessionRow(page, historyId)).toBeVisible();
      await manager.getByRole('textbox', { name: 'Search sessions', exact: true }).fill('');
      await expect(manager.getByTestId('session-row')).toHaveCount(2);
      await expect(
        sessionRow(page, historyId).getByRole('button', { name: 'Resume', exact: true }),
      ).toBeDisabled();
      await closeSessionsManager(page);
      await expectOverlayCount(page, 0);
      await expect(page.locator('.xterm')).toHaveCount(0);
      await expect(page.getByTitle(/^Agent \d+$/)).toHaveCount(0);

      await arrangeNextCopilotInvocation(
        standalone.tmpHome,
        copilotScenario('unnamed new launch')
          .at(500)
          .emitHook({
            hook_event_name: 'preToolUse',
            toolName: 'view',
            toolArgs: { path: 'new.ts' },
          })
          .holdOpenFor(120_000)
          .build(),
      );
      const newId = await launchUnnamedSession(page);
      await expect(sessionRow(page, newId)).toContainText('Connected');
      await expect(
        sessionRow(page, newId).getByRole('button', { name: 'Open', exact: true }),
      ).toBeDisabled();
      await closeSessionsManager(page);
      await expectOverlayCount(page, 0);
      await expect(page.locator('.xterm')).toHaveCount(0);
      await expect(page.getByTitle(/^Agent \d+$/)).toHaveCount(0);

      await nameSession(page, historyId, 'Historical Reader');
      await nameSession(page, newId, 'New Reader', { close: false });
      await sessionRow(page, newId).getByRole('button', { name: 'Open', exact: true }).click();
      await expect(page.getByTestId('sessions-manager')).toHaveCount(0);
      await expectOverlayCount(page, 2);
      await expectOverlayVisibleWithTexts(page, ['New Reader', 'Reading new.ts']);
      await expect(page.getByTitle('Historical Reader', { exact: true })).toBeVisible();
      await expect(page.getByTitle('New Reader', { exact: true })).toBeVisible();
      await expect(page.locator('.xterm:visible')).toContainText(`mock copilot session ${newId}`);
      expect(fs.readFileSync(historyFile, 'utf8')).toBe(originalHistory);
      const newFile = path.join(
        standalone.tmpHome,
        '.copilot',
        'session-state',
        newId,
        'events.jsonl',
      );
      const originalNewMetadata = fs.readFileSync(newFile, 'utf8');
      const pid = Number(
        invocationLines(standalone.mockLogFile, newId)[0]?.match(/\bpid=(\d+)/)?.[1],
      );
      expect(Number.isSafeInteger(pid) && pid > 0).toBe(true);

      manager = await showAllSessions(page);
      await sessionRow(page, newId).getByRole('button', { name: 'Archive', exact: true }).click();
      const confirmation = page.getByTestId('archive-confirmation');
      await expect(confirmation).toBeVisible();
      await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(sessionRow(page, newId)).toContainText('Connected');
      expect(() => process.kill(pid, 0)).not.toThrow();
      await sessionRow(page, newId).getByRole('button', { name: 'Archive', exact: true }).click();
      await confirmation.getByRole('button', { name: 'Archive character', exact: true }).click();
      await expect(confirmation).toBeHidden();
      await expect(sessionRow(page, newId).locator('strong')).toHaveText('New Reader');
      await expect(sessionRow(page, newId)).toContainText('Archived');
      await expect(sessionRow(page, newId)).toContainText('Disconnected');
      await closeSessionsManager(page);
      await expect(page.getByTitle('New Reader', { exact: true })).toHaveCount(0);
      await expectOverlayCount(page, 1);
      await expect(page.locator('.xterm')).toHaveCount(0);
      await expect
        .poll(() => {
          try {
            process.kill(pid, 0);
            return false;
          } catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return true;
            throw error;
          }
        })
        .toBe(true);
      expect(fs.readFileSync(newFile, 'utf8')).toBe(originalNewMetadata);
      expect(fs.readFileSync(historyFile, 'utf8')).toBe(originalHistory);

      await arrangeNextCopilotInvocation(
        standalone.tmpHome,
        copilotScenario('resume archived reader').holdOpenFor(120_000).build(),
      );
      await nameSession(page, newId, 'Returned Reader', { close: false });
      await sessionRow(page, newId).getByRole('button', { name: 'Resume', exact: true }).click();
      await expect(page.getByTestId('sessions-manager')).toHaveCount(0);
      await expect(page.locator('.xterm:visible')).toContainText(`mock copilot session ${newId}`);
      expect(invocationLines(standalone.mockLogFile, newId)).toHaveLength(2);
      expect(invocationLines(standalone.mockLogFile, newId)[1]).toContain(`args=--resume ${newId}`);
      await expectOverlayCount(page, 2);

      // A role click on an unmanaged external terminal must surface rejection,
      // not silently show another character's managed terminal as a success.
      await nameSession(page, externalId, 'External Reader');
      await page.getByTitle('External Reader', { exact: true }).click();
      manager = getSessionsManager(page);
      await expect(manager).toBeVisible();
      await expect(manager.getByRole('alert')).toContainText('running outside Pixel Agents');
      await expect(sessionRow(page, externalId).locator('strong')).toHaveText('External Reader');
      expect(invocationLines(standalone.mockLogFile, externalId)).toHaveLength(1);
    } finally {
      await killTrackedExternalProcesses();
    }
  });

  test('two named sessions in the same project keep separate characters and resume the exact session across terminal restarts @area:standalone', async ({
    page,
    standalone,
  }) => {
    await setSettings(page, { alwaysShowLabels: true });
    const alphaId = 'history-alpha-session';
    const betaId = 'history-beta-session';
    const alphaFile = seedSessionMetadata(standalone.tmpHome, alphaId, standalone.workspaceDir);
    const betaFile = seedSessionMetadata(standalone.tmpHome, betaId, standalone.workspaceDir);
    const metadata = [fs.readFileSync(alphaFile, 'utf8'), fs.readFileSync(betaFile, 'utf8')];
    await nameSession(page, alphaId, 'Alpha');
    await nameSession(page, betaId, 'Beta');
    await expectOverlayCount(page, 2);
    const alphaRole = await getOverlayByText(page, 'Alpha').getAttribute('data-agent-id');
    const betaRole = await getOverlayByText(page, 'Beta').getAttribute('data-agent-id');
    expect(alphaRole).not.toBe(betaRole);

    await arrangeNextCopilotInvocation(
      standalone.tmpHome,
      copilotScenario('resume Alpha').holdOpenFor(120_000).build(),
    );
    let manager = await openSessionsManager(page);
    await sessionRow(page, alphaId).getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(manager).toBeHidden();
    await expect(page.locator('.xterm:visible')).toContainText(`mock copilot session ${alphaId}`);

    await arrangeNextCopilotInvocation(
      standalone.tmpHome,
      copilotScenario('resume Beta once').exitAt(6_000).build(),
    );
    manager = await openSessionsManager(page);
    await sessionRow(page, betaId).getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(manager).toBeHidden();
    await expect(page.locator('.xterm:visible')).toContainText(`mock copilot session ${betaId}`);
    expect(invocationLines(standalone.mockLogFile, alphaId)[0]).toContain(
      `args=--resume ${alphaId}`,
    );
    expect(invocationLines(standalone.mockLogFile, betaId)[0]).toContain(`args=--resume ${betaId}`);
    await expect(page.locator('.xterm:visible')).toHaveCount(0, { timeout: 15_000 });
    // Alpha is still managed, but losing Beta's terminal must not fall back to it.
    await expect(page.getByTitle('Alpha', { exact: true })).toBeVisible();
    await expectOverlayCount(page, 2);
    await expect(getOverlayByText(page, 'Beta')).toHaveAttribute('data-agent-id', betaRole!);
    manager = await openSessionsManager(page);
    await expect(sessionRow(page, betaId)).toContainText('Disconnected');
    await expect(sessionRow(page, alphaId)).toContainText('Connected');
    await closeSessionsManager(page);

    await arrangeNextCopilotInvocation(
      standalone.tmpHome,
      copilotScenario('resume Beta twice').holdOpenFor(120_000).build(),
    );
    await page.getByTitle('Beta', { exact: true }).click();
    await expect(page.locator('.xterm:visible')).toContainText(`mock copilot session ${betaId}`);
    await expectOverlayCount(page, 2);
    await expect(getOverlayByText(page, 'Alpha')).toHaveAttribute('data-agent-id', alphaRole!);
    await expect(getOverlayByText(page, 'Beta')).toHaveAttribute('data-agent-id', betaRole!);
    expect(invocationLines(standalone.mockLogFile, betaId)).toHaveLength(2);
    expect(
      invocationLines(standalone.mockLogFile, betaId).every((line) =>
        line.includes(`args=--resume ${betaId}`),
      ),
    ).toBe(true);
    // Repeated ACKs for the same ID must reopen the collapsed exact pane.
    for (let i = 0; i < 2; i++) {
      await page.getByTitle('Close terminal', { exact: true }).click();
      await expect(page.locator('.xterm:visible')).toHaveCount(0);
      await page.getByTitle('Beta', { exact: true }).click();
      await expect(page.locator('.xterm:visible')).toContainText(`mock copilot session ${betaId}`);
    }
    expect(invocationLines(standalone.mockLogFile, betaId)).toHaveLength(2);
    expect(fs.readFileSync(alphaFile, 'utf8')).toBe(metadata[0]);
    expect(fs.readFileSync(betaFile, 'utf8')).toBe(metadata[1]);
  });
});
