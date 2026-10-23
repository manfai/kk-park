import { spawn } from 'node:child_process';
import path from 'node:path';

import { expect, test } from '../../fixtures/standalone';
import { expectOverlayCount, expectOverlayVisible } from '../../helpers/office';
import { nameSession } from '../../helpers/sessions';
import { setSettings } from '../../helpers/webview';

test.describe('Standalone / Copilot CLI', () => {
  test.use({
    standaloneOptions: {
      cliArgs: ['--provider', 'copilot'],
      seedConfig: { hooksConsent: { copilot: 'granted' } },
    },
  });

  test('observes enrolled Copilot CLI hooks without tracking native Chat @area:standalone', async ({
    page,
    standalone,
  }) => {
    await setSettings(page, { alwaysShowLabels: true });
    const emit = async (event: string, extra: Record<string, unknown> = {}, enrolled = true) => {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [path.join(standalone.tmpHome, '.pixel-agents/hooks/copilot-hook.js'), event],
          {
            env: {
              ...process.env,
              HOME: standalone.tmpHome,
              USERPROFILE: standalone.tmpHome,
              COPILOT_HOME: path.join(standalone.tmpHome, '.copilot'),
              PIXEL_AGENTS_COPILOT: enrolled ? '1' : '',
              PIXEL_AGENTS_COPILOT_SESSION_ID: '',
            },
            stdio: ['pipe', 'pipe', 'pipe'],
            // The first spawn pays a Node cold-start cost that can spike past
            // the hook's own delivery timeout under CI load; allow for it.
            timeout: 30_000,
          },
        );
        let stderr = '';
        child.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        child.once('error', reject);
        child.once('close', (code) =>
          code === 0 && !stderr ? resolve() : reject(new Error(`Hook failed (${code}): ${stderr}`)),
        );
        child.stdin.end(
          JSON.stringify({
            sessionId: 'copilot-browser-test',
            cwd: standalone.workspaceDir,
            ...extra,
          }),
        );
      });
    };

    // Real bridge subprocesses receive the documented payloads. No real AI
    // request or internal OfficeState mutation is needed for hook ingestion.
    await emit('sessionStart', { source: 'startup' }, false);
    await emit('preToolUse', { toolName: 'view', toolArgs: { path: 'ignored.ts' } }, false);
    await page.waitForTimeout(300);
    await expectOverlayCount(page, 0);

    await emit('sessionStart', { source: 'startup' });
    await expectOverlayCount(page, 0);
    await nameSession(page, 'copilot-browser-test', 'Copilot Reader');
    const tool = { toolName: 'view', toolArgs: { path: 'example.ts' } };
    await emit('preToolUse', tool);
    await expectOverlayCount(page, 1);
    await expectOverlayVisible(page, 'Reading example.ts');

    await page.reload();
    await expectOverlayVisible(page, 'Reading example.ts');
    await emit('notification', { notification_type: 'permission_prompt' });
    await expectOverlayVisible(page, 'Needs approval');
    await page.reload();
    await expectOverlayVisible(page, 'Needs approval');
    await emit('postToolUse', tool);
    await emit('agentStop');
    await expectOverlayVisible(page, 'Idle');

    await emit('userPromptSubmitted', { prompt: 'a text-only turn' });
    await expectOverlayVisible(page, 'Thinking');
    await page.reload();
    await expectOverlayVisible(page, 'Thinking');
    const question = { toolName: 'ask_user', toolArgs: { question: 'Choose an option' } };
    await emit('preToolUse', question);
    await emit('notification', { notification_type: 'elicitation_dialog' });
    await expectOverlayVisible(page, 'Waiting for input');
    await page.reload();
    await expectOverlayVisible(page, 'Waiting for input');
    await emit('postToolUse', question);
    await expectOverlayVisible(page, 'Thinking');
    await emit('agentStop');
    await expectOverlayVisible(page, 'Idle');

    await emit('userPromptSubmitted');
    const command = { toolName: 'bash', toolArgs: { command: 'a private command' } };
    await emit('preToolUse', command);
    await expectOverlayVisible(page, 'Running command');
    await emit('preToolUse', {
      agentId: 'unsupported-child',
      toolName: 'view',
      toolArgs: { path: 'child-only.ts' },
    });
    await expectOverlayCount(page, 1);
    await expectOverlayVisible(page, 'Running command');
    await emit('postToolUseFailure', command);
    await emit('agentStop');
    await expectOverlayVisible(page, 'Idle');
    await emit('sessionEnd', { reason: 'user_exit' });
    await expectOverlayCount(page, 1);
    await expectOverlayVisible(page, 'Idle');

    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByText('Instant Detection (Hooks)', { exact: true })).toBeVisible();
  });
});
