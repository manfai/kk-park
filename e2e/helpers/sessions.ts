import fs from 'node:fs';
import path from 'node:path';

import type { Frame, Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';

type Surface = Frame | Page;

export function getSessionsManager(surface: Surface): Locator {
  return surface.getByTestId('sessions-manager').locator('..');
}

export async function openSessionsManager(surface: Surface): Promise<Locator> {
  const manager = getSessionsManager(surface);
  if (!(await manager.isVisible())) {
    await surface.getByTitle('Manage sessions and characters', { exact: true }).click();
  }
  await expect(manager).toBeVisible();
  await expect(manager.getByText('Loading sessions…', { exact: true })).toHaveCount(0);
  return manager;
}

export async function closeSessionsManager(surface: Surface): Promise<void> {
  const manager = getSessionsManager(surface);
  if (await manager.isVisible()) {
    await manager.getByRole('button', { name: 'x', exact: true }).click();
    await expect(manager).toBeHidden();
  }
}

export function sessionRow(surface: Surface, sessionId: string): Locator {
  return surface.getByTestId('session-row').filter({
    has: surface.getByLabel(`Local character name for ${sessionId}`, { exact: true }),
  });
}

export async function showAllSessions(surface: Surface): Promise<Locator> {
  const manager = await openSessionsManager(surface);
  await manager.getByRole('button', { name: 'All', exact: true }).click();
  await manager.getByRole('textbox', { name: 'Search sessions', exact: true }).fill('');
  return manager;
}

export async function nameSession(
  surface: Surface,
  sessionId: string,
  name: string,
  options: { close?: boolean } = {},
): Promise<void> {
  await showAllSessions(surface);
  const row = sessionRow(surface, sessionId);
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.getByRole('textbox').fill(name);
  await row.getByRole('button', { name: 'Save name', exact: true }).click();
  await expect(row.locator('strong')).toHaveText(name);
  await expect(row.getByRole('button', { name: 'Saving…', exact: true })).toHaveCount(0);
  if (options.close !== false) await closeSessionsManager(surface);
}

/** Launch only: the server snapshot must reveal the new, still-unnamed session. */
export async function launchUnnamedSession(
  surface: Surface,
  directoryPath?: string,
): Promise<string> {
  const manager = await showAllSessions(surface);
  const before = new Set(
    await manager
      .getByTestId('session-row')
      .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-session-id'))),
  );
  if (directoryPath)
    await manager
      .getByRole('combobox', { name: 'New session Directory' })
      .selectOption(directoryPath);
  await manager.getByRole('button', { name: 'New session', exact: true }).click();
  let sessionId = '';
  await expect
    .poll(
      async () => {
        const ids = await manager
          .getByTestId('session-row')
          .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-session-id')));
        sessionId = ids.find((id): id is string => Boolean(id) && !before.has(id)) ?? '';
        return sessionId;
      },
      { timeout: 15_000 },
    )
    .not.toBe('');
  await expect(sessionRow(surface, sessionId).locator('strong')).toHaveText('Unnamed session');
  return sessionId;
}

export async function launchNamedSession(
  surface: Surface,
  options: { directoryPath?: string; name?: string; open?: boolean } = {},
): Promise<{ sessionId: string; name: string }> {
  const manager = await showAllSessions(surface);
  const names = await manager.getByTestId('session-row').locator('strong').allTextContents();
  let index = 1;
  while (names.includes(`Agent ${index}`)) index++;
  const name = options.name ?? `Agent ${index}`;
  const sessionId = await launchUnnamedSession(surface, options.directoryPath);
  await nameSession(surface, sessionId, name, { close: false });
  if (options.open !== false) {
    await sessionRow(surface, sessionId).getByRole('button', { name: 'Open', exact: true }).click();
    await expect(manager).toBeHidden({ timeout: 15_000 });
  } else {
    await closeSessionsManager(surface);
  }
  return { sessionId, name };
}

/** Only the isolated mock CLI's metadata, never a transcript or runtime injection. */
export function seedSessionMetadata(home: string, sessionId: string, cwd: string): string {
  const directory = path.join(home, '.copilot', 'session-state', sessionId);
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'events.jsonl');
  fs.writeFileSync(
    file,
    `${JSON.stringify({
      type: 'session.start',
      data: { context: { cwd }, title: 'Original Copilot title' },
    })}\n`,
  );
  return file;
}
