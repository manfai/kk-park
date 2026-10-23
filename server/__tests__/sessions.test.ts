import * as fs from 'fs';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentRuntime } from '../src/agentRuntime.js';
import { createAgentState } from '../src/agentState.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { handleClientMessage } from '../src/clientMessageHandler.js';
import { FileStateAdapter } from '../src/fileStateAdapter.js';
import { discoverSessions } from '../src/providers/hook/copilot/copilotSessions.js';
import { observation } from '../src/providers/hook/copilot/hooks/copilot-hook.js';
import { handleSessionMessage } from '../src/sessionActions.js';
import { sessionCatalogue } from '../src/sessionCatalog.js';
import { isolateHome, newTestDirectory } from './testSupport.js';

describe('named session catalogue', () => {
  let home: string;
  let store: AgentStateStore;
  let runtime: AgentRuntime;
  let adapter: FileStateAdapter;

  beforeEach(() => {
    home = newTestDirectory('pxl-sessions-');
    isolateHome(home);
    store = new AgentStateStore();
    adapter = new FileStateAdapter({ namespace: 'standalone' });
    store.setAdapter(adapter);
    runtime = new AgentRuntime(store);
    runtime.trackWorkingDirectory(home);
  });

  afterEach(() => {
    runtime.dispose();
    store.dispose();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(home, { recursive: true, force: true });
  });

  function history(id: string, cwd = home, root = process.env.COPILOT_HOME!): string {
    const file = path.join(root, 'session-state', id, 'events.jsonl');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      [
        JSON.stringify({ type: 'session.start', data: { context: { cwd } } }),
        JSON.stringify({ type: 'user.message', data: { content: 'private conversation content' } }),
        JSON.stringify({ type: 'session.info', data: { title: 'private conversation title' } }),
      ].join('\n') + '\n',
    );
    return file;
  }

  it('archives history by default, preserves separate sessions in one Directory, and persists local names only', () => {
    const file = history('session-a');
    history('session-b');
    const original = fs.readFileSync(file, 'utf8');
    const added = vi.fn();
    store.on('agentAdded', added);
    runtime.refreshSessions();
    expect(added).not.toHaveBeenCalled();
    const sessions = sessionCatalogue(store).sessions;
    expect(sessions).toHaveLength(2);
    expect(
      sessions.every((session) => !session.characterName && session.status === 'offline'),
    ).toBe(true);
    const first = sessions.find((session) => session.sessionId === 'session-a')!;
    const palette = store.get(first.id)?.palette;
    runtime.nameSession(first.id, 'Ada');
    expect(added).toHaveBeenCalledOnce();
    expect(fs.readFileSync(file, 'utf8')).toBe(original);
    expect(JSON.stringify(sessionCatalogue(store))).not.toContain('private conversation');
    expect(JSON.stringify(adapter.loadAgents())).not.toContain('private conversation');

    const restored = new AgentStateStore();
    restored.setAdapter(adapter);
    const restoredRuntime = new AgentRuntime(restored);
    expect(restored.get(first.id)).toMatchObject({
      sessionId: 'session-a',
      characterName: 'Ada',
      palette,
      connected: false,
    });
    expect(restored.size).toBe(2);
    expect([...restored.values()].filter((agent) => agent.characterName)).toHaveLength(1);
    restoredRuntime.dispose();
    restored.dispose();
  });

  it('hides new and active sessions until named, and archives without disconnecting them', () => {
    const added = vi.fn();
    const removed = vi.fn();
    const broadcast = vi.fn();
    store.on('agentAdded', added).on('agentRemoved', removed).on('broadcast', broadcast);
    for (const event of ['sessionStart', 'userPromptSubmitted']) {
      runtime.handleHookEvent('copilot', observation(event, { sessionId: 'running', cwd: home })!);
    }
    const agent = [...store.values()][0];
    expect(agent.connected).toBe(true);
    expect(sessionCatalogue(store).sessions[0].status).toBe('active');
    expect(added).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
    runtime.nameSession(agent.id, 'Builder');
    expect(added).toHaveBeenCalledOnce();
    expect(broadcast).toHaveBeenCalledWith({ type: 'agentStatus', id: agent.id, status: 'active' });
    runtime.nameSession(agent.id, '');
    expect(removed).toHaveBeenCalledWith(agent.id);
    expect(agent.connected).toBe(true);
    expect(agent.characterName).toBeUndefined();
    expect(store.has(agent.id)).toBe(true);
    expect(adapter.loadAgents()[0].characterName).toBeUndefined();
  });

  it('rolls back an unsaved name and never announces it as a character', () => {
    history('session-a');
    runtime.refreshSessions();
    const agent = [...store.values()][0];
    const added = vi.fn();
    store.on('agentAdded', added);
    vi.spyOn(adapter, 'saveAgents').mockImplementation(() => {});
    expect(() => runtime.nameSession(agent.id, 'Unsaved')).toThrow('Could not save');
    expect(agent.characterName).toBeUndefined();
    expect(added).not.toHaveBeenCalled();
  });

  it('waits for a shared opener and reports failure to every pending activation', async () => {
    const agent = createAgentState({
      id: 1,
      sessionId: 'session-a',
      projectDir: home,
      isExternal: true,
      characterName: 'Coder',
    });
    store.set(agent.id, agent);
    let fail!: (error: Error) => void;
    const pending = new Promise<void>((_resolve, reject) => {
      fail = reject;
    });
    const open = vi.fn(() => pending);
    const send = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    handleSessionMessage({ type: 'openSession', id: agent.id }, send, store, runtime, open);
    handleSessionMessage({ type: 'openSession', id: agent.id }, send, store, runtime, open);
    await Promise.resolve();
    expect(open).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
    fail(new Error('Launch failed'));
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls.every(([message]) => message.type === 'sessionActionRejected')).toBe(
      true,
    );
  });

  it('refuses to control a running external session rather than activating another terminal', async () => {
    const agent = createAgentState({
      id: 1,
      sessionId: 'external',
      projectDir: home,
      isExternal: true,
      characterName: 'External',
      connected: true,
    });
    store.set(agent.id, agent);
    const open = vi.fn();
    expect(sessionCatalogue(store).sessions[0].canOpen).toBe(false);
    await expect(runtime.openSession(agent.id, open)).rejects.toThrow(
      'running outside Pixel Agents',
    );
    expect(open).not.toHaveBeenCalled();
  });

  it('does not expose archived history or change names for read-only clients', () => {
    history('session-a');
    const send = vi.fn();
    const context = { store, runtime, cache: null, privileged: false };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    handleClientMessage({ type: 'requestSessions' }, send, context);
    expect(store.size).toBe(0);
    store.set(
      1,
      createAgentState({
        id: 1,
        sessionId: 'session-a',
        projectDir: home,
        isExternal: true,
      }),
    );
    handleClientMessage(
      { type: 'setSessionCharacterName', id: 1, name: 'Forbidden' },
      send,
      context,
    );
    handleClientMessage({ type: 'openSession', id: 1 }, send, context);
    handleClientMessage({ type: 'setSessionArchived', id: 1, archived: true }, send, context);
    expect(store.get(1)?.characterName).toBeUndefined();
    expect(store.get(1)?.archived).toBeUndefined();
    expect(
      send.mock.calls.every(
        ([message]) => message.type !== 'sessionsLoaded' && message.type !== 'sessionOpened',
      ),
    ).toBe(true);
  });

  it('archives a named character without removing it and stops its exact managed terminal', async () => {
    const agent = createAgentState({
      id: 1,
      sessionId: 'owned',
      projectDir: home,
      isExternal: false,
      characterName: 'Keeper',
      connected: true,
      terminalAgentId: 7,
      palette: 2,
    });
    store.set(agent.id, agent);
    const stop = vi.fn((current) => expect(current.terminalAgentId).toBe(7));
    const removed = vi.fn();
    const broadcast = vi.fn();
    store.on('agentRemoved', removed).on('broadcast', broadcast);
    await runtime.setSessionArchived(agent.id, true, stop);
    expect(stop).toHaveBeenCalledOnce();
    expect(agent).toMatchObject({
      sessionId: 'owned',
      characterName: 'Keeper',
      archived: true,
      connected: false,
      palette: 2,
    });
    expect(agent.terminalAgentId).toBeUndefined();
    expect(removed).not.toHaveBeenCalled();
    expect(broadcast.mock.calls.some(([message]) => message.type === 'agentStatus')).toBe(false);
    const restored = new AgentStateStore();
    restored.setAdapter(adapter);
    const restoredRuntime = new AgentRuntime(restored);
    expect(restored.get(1)).toMatchObject({ characterName: 'Keeper', archived: true, palette: 2 });
    restoredRuntime.dispose();
    restored.dispose();
  });

  it('does not stop a terminal when archive state cannot be saved', async () => {
    store.set(
      1,
      createAgentState({
        id: 1,
        sessionId: 'owned',
        projectDir: home,
        isExternal: false,
        characterName: 'Keeper',
        connected: true,
        terminalAgentId: 7,
      }),
    );
    store.persist();
    vi.spyOn(adapter, 'saveAgents').mockImplementation(() => {});
    const stop = vi.fn();
    await expect(runtime.setSessionArchived(1, true, stop)).rejects.toThrow('Could not save');
    expect(stop).not.toHaveBeenCalled();
    expect(store.get(1)?.archived).toBeUndefined();
    expect(store.get(1)?.connected).toBe(true);
  });

  it('only restores an archived character after successful exact-session activation', async () => {
    const agent = createAgentState({
      id: 1,
      sessionId: 'owned',
      projectDir: home,
      isExternal: true,
      characterName: 'Keeper',
      archived: true,
    });
    store.set(1, agent);
    await expect(
      runtime.openSession(1, () => {
        throw new Error('No terminal');
      }),
    ).rejects.toThrow('No terminal');
    expect(agent.archived).toBe(true);
    await runtime.openSession(1, (current) => {
      expect(current.sessionId).toBe('owned');
    });
    expect(agent.archived).toBeUndefined();
    expect(agent.characterName).toBe('Keeper');
  });

  it('uses the configured session home and never treats later conversation records as initialization', () => {
    history('custom-session');
    const xdg = path.join(home, 'xdg');
    const xdgCopilot = path.join(xdg, '.copilot');
    history('xdg-session', home, xdgCopilot);
    vi.stubEnv('XDG_STATE_HOME', xdg);
    expect(discoverSessions().map((session) => session.sessionId)).toEqual(['custom-session']);
    vi.stubEnv('COPILOT_HOME', '');
    expect(discoverSessions()).toEqual([{ sessionId: 'xdg-session', cwd: home }]);
    const file = history('no-initialization', home, xdgCopilot);
    fs.writeFileSync(
      file,
      JSON.stringify({
        type: 'user.message',
        data: { context: { cwd: home }, content: 'private content' },
      }) + '\n',
    );
    expect(
      discoverSessions().find((session) => session.sessionId === 'no-initialization')?.cwd,
    ).toBeUndefined();
  });
});
