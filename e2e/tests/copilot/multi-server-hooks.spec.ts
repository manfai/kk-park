import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from '../../fixtures/pixel-agents';
import { sessionStartStartup } from '../../helpers/hooks';
import {
  copilotScenario,
  spawnExternalCopilotScenario,
  waitForCopilotHookSetup,
} from '../../helpers/mock-copilot';
import { expectNoOverlay, expectOverlayCount, expectOverlayVisible } from '../../helpers/office';
import { launchStandalone } from '../../helpers/standalone';
import { setSettings } from '../../helpers/webview';

function hookDrivenScenario(name: string, command: string) {
  return copilotScenario(name)
    .at(50)
    .emitHook(sessionStartStartup('{{sessionId}}', '{{cwd}}') as Record<string, unknown>)
    .at(100)
    .emitHook({
      sessionId: '{{sessionId}}',
      hook_event_name: 'preToolUse',
      toolName: 'view',
      toolArgs: { path: command },
    })
    .holdOpenFor(60_000)
    .build();
}

test.describe('VS Code and standalone / multi-server hooks', () => {
  test('extension and standalone both stay hook-driven without cross-contamination @area:standalone', async ({
    page,
    pixelAgents,
  }) => {
    const { frame, tmpHome, workspaceDir: extensionWorkspace, mockLogFile } = pixelAgents;

    await setSettings(frame, {
      alwaysShowLabels: true,
      hooksEnabled: true,
      watchAllSessions: false,
      debugView: false,
    });

    const standalone = await launchStandalone(page, { homeDir: tmpHome });
    try {
      await setSettings(page, {
        alwaysShowLabels: true,
        hooksEnabled: true,
        watchAllSessions: false,
        debugView: false,
      });
      await standalone.drainMessages();
      await waitForCopilotHookSetup(tmpHome);

      const registryDir = path.join(tmpHome, '.pixel-agents', 'servers');
      await expect
        .poll(
          () => {
            try {
              return fs.readdirSync(registryDir).filter((file) => file.endsWith('.json')).length;
            } catch {
              return 0;
            }
          },
          { message: 'Expected one embedded and one standalone registry entry' },
        )
        .toBe(2);

      const extensionSessionId = 'multi-server-extension-owned';
      const extensionCommand = 'extension-owned.ts';
      await spawnExternalCopilotScenario({
        tmpHome,
        workspaceDir: extensionWorkspace,
        mockLogFile,
        sessionId: extensionSessionId,
        scenario: hookDrivenScenario('multi-server extension-owned session', extensionCommand),
      });

      await expectOverlayVisible(frame, `Reading ${extensionCommand}`);
      await page.waitForTimeout(500);
      await expectNoOverlay(page, `Reading ${extensionCommand}`);

      const standaloneSessionId = 'multi-server-standalone-owned';
      const standaloneCommand = 'standalone-owned.ts';
      await spawnExternalCopilotScenario({
        tmpHome,
        workspaceDir: standalone.workspaceDir,
        mockLogFile,
        sessionId: standaloneSessionId,
        scenario: hookDrivenScenario('multi-server standalone-owned session', standaloneCommand),
      });

      await expectOverlayVisible(page, `Reading ${standaloneCommand}`);
      await frame.waitForTimeout(500);
      await expectNoOverlay(frame, `Reading ${standaloneCommand}`);

      await expectOverlayCount(frame, 1);
      await expectOverlayCount(page, 1);
    } finally {
      await standalone.cleanup();
    }
  });
});
