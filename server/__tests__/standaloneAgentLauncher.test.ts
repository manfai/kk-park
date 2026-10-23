import * as fs from 'fs';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HookProvider } from '../../core/src/provider.js';
import { AgentRuntime } from '../src/agentRuntime.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { copilotProvider } from '../src/providers/hook/copilot/copilot.js';
import { observation } from '../src/providers/hook/copilot/hooks/copilot-hook.js';
import type { IPty, PtyModule, PtySpawnOptions } from '../src/terminal/ptyModule.js';
import { PtySessionManager } from '../src/terminal/ptySessionManager.js';
import { launchStandaloneAgent } from '../src/terminal/standaloneAgentLauncher.js';
import { newTestDirectory } from './testSupport.js';

/**
 * launchStandaloneAgent is the standalone counterpart of the VS Code adapter's
 * launchNewTerminal: it must register a store agent, spawn the provider's
 * launch command in a PTY, and clean everything up when that process exits.
 * These tests use a real runtime and store to catch routing regressions, with
 * a fake PTY so they never launch an actual AI process.
 */

class FakePty implements IPty {
  readonly pid = 4242;
  killSignals: Array<string | undefined> = [];
  private exitListener: ((e: { exitCode: number; signal?: number }) => void) | null = null;

  onData(): void {}
  onExit(listener: (e: { exitCode: number; signal?: number }) => void): void {
    this.exitListener = listener;
  }
  write(): void {}
  resize(): void {}
  kill(signal?: string): void {
    this.killSignals.push(signal);
  }

  /** Test driver: simulate the process exiting on its own. */
  exit(exitCode = 0): void {
    this.exitListener?.({ exitCode });
  }
}

interface PtyHarness {
  manager: PtySessionManager;
  spawned: FakePty[];
  spawnArgs: Array<{ file: string; args: string[]; options: PtySpawnOptions }>;
}

function workingPtyManager(): PtyHarness {
  const spawned: FakePty[] = [];
  const spawnArgs: PtyHarness['spawnArgs'] = [];
  const module: PtyModule = {
    spawn: (file, args, options) => {
      spawnArgs.push({ file, args, options });
      const pty = new FakePty();
      spawned.push(pty);
      return pty;
    },
  };
  const manager = new PtySessionManager(() => ({ module, moduleId: 'fake-pty', reason: null }));
  return { manager, spawned, spawnArgs };
}

describe('launchStandaloneAgent', () => {
  let tempDir: string;
  let store: AgentStateStore;
  let runtime: AgentRuntime;
  let broadcasts: Array<Record<string, unknown>>;

  function provider(overrides: Partial<HookProvider> = {}): HookProvider {
    return { ...copilotProvider, ...overrides };
  }

  function launch(harness: PtyHarness, options = {}): number | null {
    return launchStandaloneAgent(
      { store, runtime, ptyManager: harness.manager, provider: provider() },
      options,
    );
  }

  beforeEach(() => {
    tempDir = newTestDirectory('pxl-launcher-test-');
    store = new AgentStateStore();
    runtime = new AgentRuntime(store, copilotProvider);
    broadcasts = [];
    store.on('broadcast', (message) => broadcasts.push(message));
  });

  afterEach(() => {
    vi.useRealTimers();
    runtime.dispose();
    store.dispose();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // ── Successful launch ────────────────────────────────────────

  it('launches Copilot with separate session and runtime identities', () => {
    const harness = workingPtyManager();
    const id = launchStandaloneAgent(
      { store, runtime, ptyManager: harness.manager, provider: copilotProvider },
      { directoryPath: tempDir },
    );
    const agent = store.get(id!);
    expect(harness.spawnArgs[0].file).toBe('copilot');
    expect(harness.spawnArgs[0].args).toEqual(['--session-id', agent?.sessionId]);
    expect(harness.spawnArgs[0].options.env?.PIXEL_AGENTS_COPILOT).toBe('1');
    expect(agent?.hooksOnly).toBe(true);
    expect(harness.spawnArgs[0].options.env?.PIXEL_AGENTS_COPILOT_SESSION_ID).toBe(
      agent?.launchSessionId,
    );
    expect(agent?.launchSessionId).not.toBe(agent?.sessionId);
    harness.spawned[0].exit();
    expect(store.size).toBe(1);
    expect(agent?.connected).toBe(false);
  });

  it('spawns the provider launch command in a PTY and registers the agent', () => {
    const harness = workingPtyManager();
    const cwd = path.join(tempDir, 'workspace');
    fs.mkdirSync(cwd);

    const id = launch(harness, { directoryPath: cwd });

    expect(id).toBe(1);
    const agent = store.get(1);
    expect(agent).toBeDefined();
    expect(agent?.isExternal).toBe(false);
    expect(agent?.projectDir).toBe(cwd);
    expect(agent?.providerId).toBe(copilotProvider.id);
    // Palette is assigned server-side like every other creation path, so the
    // agentCreated broadcast carries it and a reload restores the same look
    // without the webview having to persist a client-side pick.
    expect(agent?.palette).toBeTypeOf('number');
    expect(agent?.hueShift).toBeTypeOf('number');

    // The real copilot launch command, spawned in the requested cwd.

    expect(harness.spawnArgs).toHaveLength(1);
    expect(harness.spawnArgs[0].file).toBe('copilot');
    expect(harness.spawnArgs[0].args).toEqual(['--session-id', agent?.sessionId]);
    expect(harness.spawnArgs[0].options.cwd).toBe(cwd);
    expect(harness.manager.has(1)).toBe(true);

    expect(runtime.activeAgentId.current).toBe(1);

    expect(broadcasts).not.toContainEqual({ type: 'terminalSessionOpened', agentId: 1 });
    runtime.nameSession(id!, 'Coder');
    expect(broadcasts).toContainEqual({ type: 'terminalSessionOpened', agentId: 1 });
  });

  it('passes bypassPermissions through to the launch command', () => {
    const harness = workingPtyManager();

    launch(harness, { bypassPermissions: true });

    expect(harness.spawnArgs[0].args).toContain('--allow-all-tools');
  });

  it('resumes the exact old session in a separate PTY after the original CLI switches sessions', async () => {
    const harness = workingPtyManager();
    const firstId = launch(harness, { directoryPath: tempDir })!;
    const first = store.get(firstId)!;
    const sessionId = first.sessionId;
    const palette = first.palette;
    const originalTerminal = first.terminalAgentId!;
    const originalRuntime = first.launchSessionId;
    runtime.nameSession(firstId, 'First');
    runtime.handleHookEvent('copilot', {
      ...observation('sessionStart', { sessionId: 'switched-session', cwd: tempDir }),
      launch_session_id: originalRuntime,
    });
    const second = [...store.values()].find((agent) => agent.sessionId === 'switched-session')!;
    expect(second.terminalAgentId).toBe(originalTerminal);
    expect(first.connected).toBe(false);
    expect(second.characterName).toBeUndefined();
    runtime.nameSession(second.id, 'Second');
    await runtime.openSession(firstId, () => {
      expect(launch(harness, { agentId: firstId })).toBe(firstId);
    });
    expect(harness.spawnArgs[1].args).toEqual(['--resume', sessionId]);
    expect(first.characterName).toBe('First');
    expect(first.palette).toBe(palette);
    expect(first.terminalAgentId).not.toBe(originalTerminal);
    expect(harness.spawned[0].killSignals).toHaveLength(0);
    runtime.handleHookEvent('copilot', {
      ...observation('userPromptSubmitted', { sessionId, cwd: tempDir }),
      launch_session_id: first.launchSessionId,
    });
    runtime.handleHookEvent('copilot', {
      ...observation('agentStop', { sessionId, cwd: tempDir }),
      launch_session_id: originalRuntime,
    });
    expect(first.isTurnActive).toBe(true);
    harness.spawned[0].exit();
    expect(second.connected).toBe(false);
    expect(first.connected).toBe(true);
    expect(harness.manager.has(first.terminalAgentId!)).toBe(true);
    harness.spawned[1].exit();
  });

  // ── Refusal paths (each must leave the store and id counter untouched) ──

  it('returns null without burning an agent id when the terminal is unavailable', () => {
    const manager = PtySessionManager.disabled('no terminal in this test');

    const id = launchStandaloneAgent({ store, runtime, ptyManager: manager, provider: provider() });

    expect(id).toBeNull();
    expect(store.size).toBe(0);
    expect(store.nextAgentId.current).toBe(1);
    expect(broadcasts).toHaveLength(0);
  });

  it('rolls back the agent id when the PTY spawn throws', () => {
    const module: PtyModule = {
      spawn: () => {
        throw new Error('posix_spawnp failed');
      },
    };
    const manager = new PtySessionManager(() => ({ module, moduleId: 'fake-pty', reason: null }));

    const id = launchStandaloneAgent({ store, runtime, ptyManager: manager, provider: provider() });

    expect(id).toBeNull();
    expect(store.size).toBe(0);
    expect(store.nextAgentId.current).toBe(1);
  });

  // ── Process exit cleanup ─────────────────────────────────────

  it('retains the session offline and announces terminal closure when the process exits', () => {
    const harness = workingPtyManager();
    const id = launch(harness)!;

    harness.spawned[0].exit(3);

    expect(broadcasts).toContainEqual({ type: 'terminalSessionClosed', agentId: id, exitCode: 3 });
    expect(store.has(id)).toBe(true);
    expect(store.get(id)?.connected).toBe(false);
    expect(harness.manager.has(id)).toBe(false);
  });
});
