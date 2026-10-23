import type { Frame } from '@playwright/test';
import { expect } from '@playwright/test';
import fs from 'node:fs';

import { narrate } from './test-narration';

const INTERNAL_AGENT_TIMEOUT_MS = 20_000;

/** Launch into a named Directory and wait for the mock process invocation. */
export async function addAgentForDirectory(
  frame: Frame,
  directoryName: string,
  _tmpHome: string,
  mockLogFile: string,
): Promise<{ sessionId: string; invocationLog: string }> {
  const readLog = (): string => {
    try {
      return fs.readFileSync(mockLogFile, 'utf8');
    } catch {
      return '';
    }
  };
  const count = (): number => [...readLog().matchAll(/session-id=/g)].length;
  const before = count();
  narrate.step(`launching an agent in "${directoryName}"`);
  await frame.getByRole('button', { name: '+ Agent', exact: true }).click();
  await frame.getByRole('button', { name: directoryName, exact: true }).click();
  await expect.poll(count, { timeout: INTERNAL_AGENT_TIMEOUT_MS }).toBeGreaterThan(before);
  const invocationLog = readLog();
  const sessionId = [...invocationLog.matchAll(/session-id=([^\s]+)/g)].at(-1)?.[1];
  if (!sessionId) throw new Error(`No session ID in ${mockLogFile}`);
  narrate.check('mock Copilot launched with a fresh --session-id');
  return { sessionId, invocationLog };
}
