import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  COPILOT_HOOK_EVENTS,
  COPILOT_HOOK_FILE,
  COPILOT_HOOK_SCRIPT,
  COPILOT_HOOK_TIMEOUT_SECONDS,
} from './constants.js';

function locations() {
  return {
    config: path.join(
      process.env.COPILOT_HOME || path.join(os.homedir(), '.copilot'),
      'hooks',
      COPILOT_HOOK_FILE,
    ),
    script: path.join(os.homedir(), '.pixel-agents', 'hooks', COPILOT_HOOK_SCRIPT),
  };
}

function configuration() {
  return {
    version: 1,
    hooks: Object.fromEntries(
      COPILOT_HOOK_EVENTS.map((event) => [
        event,
        [
          {
            type: 'command',
            // In the VS Code adapter, process.execPath is Electron, not Node.
            exec: 'node',
            args: [locations().script, event],
            timeoutSec: COPILOT_HOOK_TIMEOUT_SECONDS,
          },
        ],
      ]),
    ),
  };
}

function readOwnedConfiguration(): boolean {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(locations().config, 'utf8'));
    return JSON.stringify(value) === JSON.stringify(configuration());
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') return false;
    if (err instanceof SyntaxError)
      throw new Error(`Cannot parse Copilot hook file: ${locations().config}`);
    throw err;
  }
}

export function copyCopilotHookScript(packageRoot: string): void {
  const target = locations().script;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    fs.copyFileSync(path.join(packageRoot, 'dist', 'hooks', COPILOT_HOOK_SCRIPT), temporary);
    fs.chmodSync(temporary, 0o600);
    fs.renameSync(temporary, target);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

export async function installHooks(): Promise<void> {
  const { config, script } = locations();
  if (!fs.existsSync(script))
    throw new Error('Copilot hook script is missing; hooks not installed.');
  fs.mkdirSync(path.dirname(config), { recursive: true });
  const temporary = `${config}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(configuration(), null, 2)}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
    // Publish a complete file without replacing any existing user file.
    fs.linkSync(temporary, config);
  } catch (err) {
    if (!(err instanceof Error && 'code' in err && err.code === 'EEXIST')) throw err;
    if (!readOwnedConfiguration()) {
      throw new Error(`Refusing to overwrite an existing or modified Copilot hook file: ${config}`);
    }
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

export async function uninstallHooks(): Promise<void> {
  if (!fs.existsSync(locations().config)) return;
  if (!readOwnedConfiguration()) {
    throw new Error(`Refusing to remove a modified Copilot hook file: ${locations().config}`);
  }
  fs.unlinkSync(locations().config);
}

export async function areHooksInstalled(): Promise<boolean> {
  try {
    return readOwnedConfiguration() && fs.existsSync(locations().script);
  } catch (err) {
    console.error('[Pixel Agents] Failed to inspect Copilot hooks:', err);
    return false;
  }
}
