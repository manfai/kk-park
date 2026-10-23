import * as fs from 'node:fs';
import * as path from 'node:path';

import { vi } from 'vitest';

import {
  COPILOT_HOOK_EVENTS,
  COPILOT_HOOK_TIMEOUT_SECONDS,
} from '../src/providers/hook/copilot/constants.js';

export function newTestDirectory(prefix: string): string {
  const root = path.resolve(__dirname, '../../test-results/server/isolated');
  fs.mkdirSync(root, { recursive: true });
  return fs.mkdtempSync(path.join(root, prefix));
}

export function isolateHome(home: string): void {
  vi.stubEnv('HOME', home);
  vi.stubEnv('USERPROFILE', home);
  vi.stubEnv('COPILOT_HOME', path.join(home, '.copilot'));
}

/** Materialize the same owned hook configuration as the real installer. */
export function seedCopilotHooks(home: string): void {
  const script = path.join(home, '.pixel-agents', 'hooks', 'copilot-hook.js');
  const config = path.join(home, '.copilot', 'hooks', 'pixel-agents.json');
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.writeFileSync(script, '', { mode: 0o600 });
  fs.mkdirSync(path.dirname(config), { recursive: true });
  fs.writeFileSync(
    config,
    JSON.stringify({
      version: 1,
      hooks: Object.fromEntries(
        COPILOT_HOOK_EVENTS.map((event) => [
          event,
          [
            {
              type: 'command',
              exec: 'node',
              args: [script, event],
              timeoutSec: COPILOT_HOOK_TIMEOUT_SECONDS,
            },
          ],
        ]),
      ),
    }),
  );
}
