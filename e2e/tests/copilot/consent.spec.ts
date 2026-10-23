import fs from 'node:fs';
import path from 'node:path';

import type { Frame, Locator } from '@playwright/test';

import { expect, test } from '../../fixtures/pixel-agents';
import { COPILOT_EVENTS, ourHookEvents } from '../../helpers/hooks';
import { advanceIntroToConsentStep, finishIntro } from '../../helpers/intro';
import { getSettingChecked, setSettings } from '../../helpers/webview';

const NO_CONSENT_CONFIG = {
  vscode: { alwaysShowLabels: true, showHostDirectories: true },
  standalone: { alwaysShowLabels: true, showHostDirectories: true },
};

function hookFile(tmpHome: string): string {
  return path.join(tmpHome, '.copilot', 'hooks', 'pixel-agents.json');
}

function readConfig(tmpHome: string): {
  hooksConsent?: Record<string, string>;
  hooksEnabled?: Record<string, boolean>;
} {
  return JSON.parse(fs.readFileSync(path.join(tmpHome, '.pixel-agents', 'config.json'), 'utf8'));
}

async function consentStep(frame: Frame): Promise<Locator> {
  const dialog = frame.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await advanceIntroToConsentStep(dialog);
  return dialog;
}

test.describe('Hooks consent gate', () => {
  test.use({ seedConfig: NO_CONSENT_CONFIG });

  test('fresh install discloses the Copilot hook file and installs only after consent @area:cross-cutting', async ({
    pixelAgents: { frame, tmpHome },
  }) => {
    const dialog = await consentStep(frame);
    await expect(dialog).toContainText('~/.copilot/hooks');
    await expect(dialog).toContainText('Existing hook files are not changed');
    await expect(dialog).toContainText(
      'Prompt text, tool results and full conversations are not forwarded',
    );
    await expect(dialog).toContainText('PIXEL_AGENTS_COPILOT=1');
    expect(fs.existsSync(hookFile(tmpHome))).toBe(false);

    await dialog.getByRole('button', { name: 'Install Hooks' }).click();
    await expect.poll(() => ourHookEvents(tmpHome), { timeout: 15_000 }).toEqual(COPILOT_EVENTS);
    expect(readConfig(tmpHome).hooksConsent?.copilot).toBe('granted');
    await finishIntro(dialog);
    expect(await getSettingChecked(frame, 'Instant Detection (Hooks)')).toBe(true);
  });

  test('Not Now leaves the hook file untouched and consent unanswered @area:cross-cutting', async ({
    pixelAgents: { frame, tmpHome },
  }) => {
    const dialog = await consentStep(frame);
    await dialog.getByRole('button', { name: 'Not Now' }).click();
    await finishIntro(dialog);
    await frame.page().waitForTimeout(1_000);
    expect(fs.existsSync(hookFile(tmpHome))).toBe(false);
    expect(readConfig(tmpHome).hooksConsent?.copilot).toBeUndefined();
    expect(readConfig(tmpHome).hooksEnabled?.copilot).not.toBe(false);
    expect(await getSettingChecked(frame, 'Instant Detection (Hooks)')).toBe(false);
  });

  test("Don't Ask Again leaves the hook file untouched and persists hooks off @area:cross-cutting", async ({
    pixelAgents: { frame, tmpHome },
  }) => {
    const dialog = await consentStep(frame);
    await dialog.getByRole('button', { name: "Don't Ask Again" }).click();
    await finishIntro(dialog);
    await expect.poll(() => readConfig(tmpHome).hooksEnabled?.copilot).toBe(false);
    expect(fs.existsSync(hookFile(tmpHome))).toBe(false);
  });

  test('closing the Intro sends no consent and does not persist hooks off @area:cross-cutting', async ({
    pixelAgents: { frame, tmpHome },
  }) => {
    const dialog = await consentStep(frame);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).toBeHidden();
    await frame.page().waitForTimeout(1_000);
    expect(fs.existsSync(hookFile(tmpHome))).toBe(false);
    expect(readConfig(tmpHome).hooksConsent?.copilot).toBeUndefined();
    expect(readConfig(tmpHome).hooksEnabled?.copilot).not.toBe(false);
  });

  test("Back lets Don't Ask Again undo an installed hook file @area:cross-cutting", async ({
    pixelAgents: { frame, tmpHome },
  }) => {
    const dialog = await consentStep(frame);
    await dialog.getByRole('button', { name: 'Install Hooks' }).click();
    await expect.poll(() => ourHookEvents(tmpHome)).toEqual(COPILOT_EVENTS);
    await expect(dialog).toContainText("You're all set!");
    await dialog.getByRole('button', { name: 'Back', exact: true }).click();
    await dialog.getByRole('button', { name: "Don't Ask Again" }).click();
    await expect.poll(() => ourHookEvents(tmpHome)).toEqual([]);
    await expect.poll(() => readConfig(tmpHome).hooksEnabled?.copilot).toBe(false);
    await finishIntro(dialog);
    expect(await getSettingChecked(frame, 'Instant Detection (Hooks)')).toBe(false);
  });

  test("Back after Don't Ask Again lets Not Now restore unanswered consent @area:cross-cutting", async ({
    pixelAgents: { frame, tmpHome },
  }) => {
    const dialog = await consentStep(frame);
    await dialog.getByRole('button', { name: "Don't Ask Again" }).click();
    await expect.poll(() => readConfig(tmpHome).hooksEnabled?.copilot).toBe(false);
    await expect(dialog).toContainText("You're all set!");
    await dialog.getByRole('button', { name: 'Back', exact: true }).click();
    await dialog.getByRole('button', { name: 'Not Now' }).click();
    await finishIntro(dialog);
    await expect.poll(() => readConfig(tmpHome).hooksEnabled?.copilot).not.toBe(false);
    expect(readConfig(tmpHome).hooksConsent?.copilot).toBeUndefined();
    expect(ourHookEvents(tmpHome)).toEqual([]);
  });

  test('a stray office click neither answers nor dismisses the Intro @area:cross-cutting', async ({
    pixelAgents: { frame, tmpHome },
  }) => {
    const dialog = await consentStep(frame);
    await frame.locator('canvas').click({ position: { x: 8, y: 8 }, force: true });
    await expect(dialog).toBeVisible();
    expect(fs.existsSync(hookFile(tmpHome))).toBe(false);
    expect(readConfig(tmpHome).hooksConsent?.copilot).toBeUndefined();
  });

  test.describe('when the hook file cannot be parsed', () => {
    test.use({ seedCopilotHooks: '{ "version": 1, "hooks":' });

    test('failed install preserves the file and Not Now revokes the failed grant @area:cross-cutting', async ({
      pixelAgents: { frame, tmpHome },
    }) => {
      const dialog = await consentStep(frame);
      await dialog.getByRole('button', { name: 'Install Hooks' }).click();
      await expect(dialog).toContainText("Hooks couldn't be installed", { timeout: 15_000 });
      expect(fs.readFileSync(hookFile(tmpHome), 'utf8')).toBe('{ "version": 1, "hooks":');
      await dialog.getByRole('button', { name: 'Back', exact: true }).click();
      await dialog.getByRole('button', { name: 'Not Now' }).click();
      await finishIntro(dialog);
      await expect.poll(() => readConfig(tmpHome).hooksConsent?.copilot).toBeUndefined();
      expect(readConfig(tmpHome).hooksEnabled?.copilot).not.toBe(false);
    });
  });
});

test.describe('Hooks Settings removal', () => {
  test('the toggle removes only our hook file and preserves unrelated hook files @area:cross-cutting', async ({
    pixelAgents: { frame, tmpHome },
  }) => {
    await expect.poll(() => ourHookEvents(tmpHome), { timeout: 30_000 }).toEqual(COPILOT_EVENTS);
    const other = path.join(tmpHome, '.copilot', 'hooks', 'other-tool.json');
    const contents = JSON.stringify({ version: 1, hooks: { sessionStart: [] } });
    fs.writeFileSync(other, contents);
    await setSettings(frame, { hooksEnabled: false });
    await expect.poll(() => fs.existsSync(hookFile(tmpHome))).toBe(false);
    expect(fs.readFileSync(other, 'utf8')).toBe(contents);
    await expect.poll(() => readConfig(tmpHome).hooksEnabled?.copilot).toBe(false);
  });

  test('refusing removal of a modified hook file does not persist hooks off @area:cross-cutting', async ({
    pixelAgents: { frame, tmpHome },
  }) => {
    await expect.poll(() => ourHookEvents(tmpHome), { timeout: 30_000 }).toEqual(COPILOT_EVENTS);
    const modified = {
      ...JSON.parse(fs.readFileSync(hookFile(tmpHome), 'utf8')),
      userModified: true,
    };
    fs.writeFileSync(hookFile(tmpHome), JSON.stringify(modified));
    await setSettings(frame, { hooksEnabled: false });
    await frame.page().waitForTimeout(1_000);
    expect(JSON.parse(fs.readFileSync(hookFile(tmpHome), 'utf8'))).toEqual(modified);
    expect(readConfig(tmpHome).hooksEnabled?.copilot).not.toBe(false);
  });
});
