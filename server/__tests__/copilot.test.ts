import { spawn } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { launchNewTerminal, restoreAgents } from '../../adapters/vscode/agentManager.js';
import { AgentRuntime } from '../src/agentRuntime.js';
import { createAgentState } from '../src/agentState.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { FileStateAdapter } from '../src/fileStateAdapter.js';
import { COPILOT_HOOK_EVENTS } from '../src/providers/hook/copilot/constants.js';
import { copilotProvider } from '../src/providers/hook/copilot/copilot.js';
import {
  areHooksInstalled,
  copyCopilotHookScript,
  installHooks,
  uninstallHooks,
} from '../src/providers/hook/copilot/copilotHookInstaller.js';
import { observation } from '../src/providers/hook/copilot/hooks/copilot-hook.js';

let home: string;
const editor = vi.hoisted(() => ({
  window: {
    createTerminal: vi.fn(),
    terminals: [] as {
      name: string;
      show: ReturnType<typeof vi.fn>;
      sendText: ReturnType<typeof vi.fn>;
      creationOptions: { env?: Record<string, string | null | undefined> };
    }[],
  },
  workspace: { workspaceFolders: [] },
}));
vi.mock('vscode', () => editor);
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => home };
});

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-copilot-'));
  vi.stubEnv('COPILOT_HOME', '');
  vi.stubEnv('PIXEL_AGENTS_COPILOT_SESSION_ID', '');
  editor.window.terminals.length = 0;
  editor.window.createTerminal.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

function hook(name: string, extra: Record<string, unknown> = {}) {
  const event = observation(name, { sessionId: 'copilot-session', cwd: home, ...extra });
  if (!event) throw new Error('Expected an observation');
  return event;
}

describe('Copilot hooks', () => {
  it('launches and restores an owned VS Code terminal with the same identity and palette', () => {
    const terminal = {
      name: 'Copilot CLI #1',
      show: vi.fn(),
      sendText: vi.fn(),
      creationOptions: { env: {} as Record<string, string | null | undefined> },
    };
    editor.window.createTerminal.mockImplementation((options: typeof terminal.creationOptions) => {
      terminal.creationOptions = options;
      return terminal;
    });
    editor.window.terminals.push(terminal);
    const adapter = new FileStateAdapter({ namespace: 'vscode' });
    const store = new AgentStateStore();
    store.setAdapter(adapter);
    const runtime = new AgentRuntime(store);
    launchNewTerminal(store, runtime, { directoryPath: home, bypassPermissions: true });
    const launched = [...store.values()][0];
    expect(editor.window.createTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: home,
        env: expect.objectContaining({ PIXEL_AGENTS_COPILOT: '1' }),
      }),
    );
    expect(terminal.sendText).toHaveBeenCalledWith(
      `copilot --session-id ${launched.sessionId} --allow-all-tools`,
    );

    const restored = new AgentStateStore();
    restored.setAdapter(adapter);
    const resumedRuntime = new AgentRuntime(restored);
    restoreAgents(adapter, restored, resumedRuntime);
    expect(restored.get(launched.id)).toMatchObject({
      sessionId: launched.sessionId,
      launchSessionId: launched.launchSessionId,
      terminalRef: terminal,
      isExternal: false,
      palette: launched.palette,
    });
    expect(restored.nextAgentId.current).toBe(launched.id + 1);
    resumedRuntime.dispose();
    runtime.dispose();
    restored.dispose();
    store.dispose();
  });
  it('never restores a different terminal merely because its display name matches', () => {
    const adapter = new FileStateAdapter({ namespace: 'vscode' });
    adapter.saveAgents([
      {
        id: 1,
        sessionId: 'original',
        providerId: 'copilot',
        characterName: 'Coder',
        terminalName: 'Copilot CLI #1',
        launchSessionId: 'original-runtime',
        projectDir: home,
      },
    ]);
    const decoy = {
      name: 'Copilot CLI #1',
      show: vi.fn(),
      sendText: vi.fn(),
      creationOptions: {
        env: {
          PIXEL_AGENTS_COPILOT: '1',
          PIXEL_AGENTS_COPILOT_SESSION_ID: 'different-runtime',
        },
      },
    };
    editor.window.terminals.push(decoy);
    const store = new AgentStateStore();
    store.setAdapter(adapter);
    const runtime = new AgentRuntime(store);
    restoreAgents(adapter, store, runtime);
    expect(store.get(1)?.terminalRef).toBeUndefined();
    expect(store.get(1)?.connected).toBe(false);
    expect(decoy.show).not.toHaveBeenCalled();
    runtime.dispose();
    store.dispose();
  });
  it('stops only a verified owned terminal when restoring an archived character', () => {
    const adapter = new FileStateAdapter({ namespace: 'vscode' });
    adapter.saveAgents([
      {
        id: 1,
        sessionId: 'parked',
        providerId: 'copilot',
        characterName: 'Parked',
        archived: true,
        terminalName: 'Copilot CLI #1',
        launchSessionId: 'owned-runtime',
        projectDir: home,
      },
    ]);
    const terminal = {
      name: 'Copilot CLI #1',
      show: vi.fn(),
      sendText: vi.fn(),
      dispose: vi.fn(),
      creationOptions: {
        env: {
          PIXEL_AGENTS_COPILOT: '1',
          PIXEL_AGENTS_COPILOT_SESSION_ID: 'owned-runtime',
        },
      },
    };
    const other = {
      ...terminal,
      dispose: vi.fn(),
      creationOptions: {
        env: {
          PIXEL_AGENTS_COPILOT: '1',
          PIXEL_AGENTS_COPILOT_SESSION_ID: 'another-runtime',
        },
      },
    };
    editor.window.terminals.push(other, terminal);
    const store = new AgentStateStore();
    store.setAdapter(adapter);
    const runtime = new AgentRuntime(store);
    restoreAgents(adapter, store, runtime);
    expect(terminal.dispose).toHaveBeenCalledOnce();
    expect(other.dispose).not.toHaveBeenCalled();
    expect(store.get(1)).toMatchObject({
      archived: true,
      characterName: 'Parked',
      connected: false,
    });
    expect(store.get(1)?.terminalRef).toBeUndefined();
    runtime.dispose();
    store.dispose();
  });
  it('keeps standalone and VS Code agents and seats isolated', () => {
    const standalone = new FileStateAdapter({ namespace: 'standalone' });
    const vscode = new FileStateAdapter({ namespace: 'vscode' });
    standalone.saveSeats({ '1': { palette: 2 } });
    vscode.saveSeats({ '1': { palette: 4 } });
    vscode.saveAgents([]);
    expect(standalone.loadSeats()).toEqual({ '1': { palette: 2 } });
    expect(vscode.loadSeats()).toEqual({ '1': { palette: 4 } });
  });
  it('matches tool starts and successful/failed ends without forwarding private content', () => {
    const raw = {
      toolName: 'edit',
      toolArgs: { path: '/private/project/a.ts', new_str: 'secret replacement' },
      prompt: 'secret prompt',
      toolResult: { textResultForLlm: 'secret result' },
    };
    const start = hook('preToolUse', raw);
    const end = hook('postToolUseFailure', {
      ...raw,
      toolArgs: { new_str: 'secret replacement', path: '/private/project/a.ts' },
    });
    expect(start.tool_use_id).toBe(end.tool_use_id);
    expect(JSON.stringify(start)).not.toContain('secret');
    expect(JSON.stringify(start)).not.toContain('/private/project');
    expect(start.tool_input).toEqual({ path: 'a.ts' });
    expect(copilotProvider.normalizeHookEvent(start)?.event.kind).toBe('toolStart');
    expect(copilotProvider.normalizeHookEvent(end)?.event.kind).toBe('toolEnd');
    expect(hook('preToolUse', { ...raw, toolArgs: { path: 'other.ts' } }).tool_use_id).not.toBe(
      start.tool_use_id,
    );
  });

  it('only treats actual permission prompts as waiting and ignores child activity', () => {
    expect(
      copilotProvider.normalizeHookEvent(
        hook('notification', { notification_type: 'permission_prompt' }),
      )?.event.kind,
    ).toBe('permissionRequest');
    expect(
      copilotProvider.normalizeHookEvent({
        ...hook('notification'),
        hook_event_name: 'permissionRequest',
      }),
    ).toBeNull();
    expect(copilotProvider.normalizeHookEvent(hook('agentStop', { agentId: 'child' }))).toBeNull();
    expect(
      copilotProvider.normalizeHookEvent(
        hook('notification', { notification_type: 'agent_completed' }),
      ),
    ).toBeNull();
  });

  it('installs an isolated user hook file, respects COPILOT_HOME, and preserves other hooks', async () => {
    vi.stubEnv('COPILOT_HOME', path.join(home, 'custom-copilot'));
    const hooksDirectory = path.join(home, 'custom-copilot', 'hooks');
    fs.mkdirSync(hooksDirectory, { recursive: true });
    const other = path.join(hooksDirectory, 'other.json');
    fs.writeFileSync(other, '{"hooks":{"preToolUse":[]}}');
    copyCopilotHookScript(path.join(__dirname, '../..'));
    await installHooks();
    await installHooks();
    expect(await areHooksInstalled()).toBe(true);
    const config = JSON.parse(
      fs.readFileSync(path.join(hooksDirectory, 'pixel-agents.json'), 'utf8'),
    );
    expect(Object.keys(config.hooks)).toEqual([...COPILOT_HOOK_EVENTS]);
    expect(config.hooks.preToolUse[0].args).toEqual([
      path.join(home, '.pixel-agents/hooks/copilot-hook.js'),
      'preToolUse',
    ]);
    await uninstallHooks();
    expect(await areHooksInstalled()).toBe(false);
    expect(fs.readFileSync(other, 'utf8')).toBe('{"hooks":{"preToolUse":[]}}');
  });

  it('refuses to replace or remove an existing modified hook file', async () => {
    copyCopilotHookScript(path.join(__dirname, '../..'));
    await installHooks();
    const file = path.join(home, '.copilot/hooks/pixel-agents.json');
    const content = '{"version":1,"hooks":{"preToolUse":[{"command":"user-command"}]}}';
    fs.writeFileSync(file, content);
    await expect(installHooks()).rejects.toThrow('Refusing to overwrite');
    await expect(uninstallHooks()).rejects.toThrow('Refusing to remove');
    expect(fs.readFileSync(file, 'utf8')).toBe(content);
    fs.writeFileSync(file, 'invalid json');
    await expect(installHooks()).rejects.toThrow();
    await expect(areHooksInstalled()).resolves.toBe(false);
    expect(fs.readFileSync(file, 'utf8')).toBe('invalid json');
  });
});

describe('Copilot runtime', () => {
  let store: AgentStateStore;
  let runtime: AgentRuntime;
  let messages: Record<string, unknown>[];

  beforeEach(() => {
    store = new AgentStateStore();
    runtime = new AgentRuntime(store, copilotProvider);
    runtime.trackWorkingDirectory(home);
    messages = [];
    store.on('broadcast', (message) => messages.push(message));
  });
  afterEach(() => {
    runtime.dispose();
    store.dispose();
  });

  const send = (event: string, extra = {}) =>
    runtime.handleHookEvent('copilot', hook(event, extra));

  it('adopts named in-workspace sessions, handles text-only turns, and retains ended sessions', () => {
    send('sessionStart');
    runtime.nameSession([...store.keys()][0], 'Coder');
    send('userPromptSubmitted', { prompt: 'not forwarded' });
    expect(store.size).toBe(1);
    const agent = [...store.values()][0];
    expect(agent.hooksOnly).toBe(true);
    expect(agent.providerId).toBe('copilot');
    expect(messages.at(-1)).toMatchObject({ type: 'agentStatus', status: 'active' });
    expect(messages.filter((message) => message.status === 'waiting')).toHaveLength(0);
    send('agentStop');
    expect(agent.isWaiting).toBe(true);
    send('userPromptSubmitted');
    expect(agent.isWaiting).toBe(false);
    send('sessionEnd');
    expect(store.size).toBe(1);
    expect(agent.connected).toBe(false);
  });

  it('recognizes a tracked workspace reached through a filesystem alias', () => {
    const alias = path.join(home, 'workspace-alias');
    fs.symlinkSync(home, alias, process.platform === 'win32' ? 'junction' : 'dir');
    send('sessionStart', { cwd: alias });
    send('preToolUse', { cwd: alias, toolName: 'view', toolArgs: { path: 'a.ts' } });
    expect(store.size).toBe(1);
    expect([...store.values()][0].activeToolNames.size).toBe(1);
  });

  it('adopts an already-running session when its startup hook was missed', () => {
    send('preToolUse', { toolName: 'view', toolArgs: { path: 'a.ts' } });
    expect(store.size).toBe(1);
    expect([...store.values()][0].activeToolNames.size).toBe(1);
    send('agentStop');
    expect([...store.values()][0].isWaiting).toBe(true);
  });

  it('stops adopting from a workspace after it is removed', () => {
    runtime.setWorkingDirectories([]);
    send('sessionStart');
    send('preToolUse', { toolName: 'view', toolArgs: { path: 'a.ts' } });
    expect(store.size).toBe(0);
  });

  it('does not adopt other workspaces or the wrong provider and respects dismissal', () => {
    send('sessionStart', { cwd: path.dirname(home) });
    send('userPromptSubmitted', { cwd: path.dirname(home) });
    expect(store.size).toBe(0);
    runtime.handleHookEvent('unsupported', hook('sessionStart'));
    runtime.handleHookEvent('unsupported', hook('userPromptSubmitted'));
    expect(store.size).toBe(0);
    send('sessionStart');
    send('userPromptSubmitted');
    const agent = [...store.values()][0];
    runtime.closeAgent(agent.id);
    send('userPromptSubmitted');
    expect(store.size).toBe(1);
    expect(agent.connected).toBe(false);
  });

  it('keeps concurrent tools separate, groups identical calls, and gives repeated calls fresh UI IDs', () => {
    send('sessionStart');
    const read = { toolName: 'view', toolArgs: { path: 'a.ts' } };
    const edit = { toolName: 'edit', toolArgs: { path: 'b.ts' } };
    send('preToolUse', read);
    send('preToolUse', edit);
    send('preToolUse', read);
    const agent = [...store.values()][0];
    expect(agent.activeToolIds.size).toBe(2);
    send('postToolUse', read);
    expect(agent.activeToolIds.size).toBe(2);
    send('postToolUseFailure', edit);
    expect([...agent.activeToolNames.values()]).toEqual(['view']);
    const originalId = [...agent.activeToolIds][0];
    send('postToolUse', read);
    expect(agent.activeToolIds.size).toBe(0);
    send('preToolUse', read);
    expect([...agent.activeToolIds][0]).not.toBe(originalId);
    send('agentStop');
    expect(agent.activeToolIds.size).toBe(0);
    send('preToolUse', read);
    expect(agent.activeToolIds.size).toBe(1);
  });

  it('clears real permission prompts when execution resumes', () => {
    send('sessionStart');
    runtime.nameSession([...store.keys()][0], 'Coder');
    const tool = { toolName: 'bash', toolArgs: { command: 'echo test' } };
    send('preToolUse', tool);
    send('notification', { notification_type: 'permission_prompt' });
    expect([...store.values()][0].permissionSent).toBe(true);
    send('postToolUse', tool);
    expect([...store.values()][0].permissionSent).toBe(false);
    expect(messages).toContainEqual({ type: 'agentToolPermissionClear', id: 1 });
  });

  it('keeps distinct session identities when one CLI terminal switches sessions', () => {
    store.set(
      1,
      createAgentState({
        id: 1,
        sessionId: 'old-session',
        projectDir: home,
        isExternal: false,
        hooksOnly: true,
        providerId: 'copilot',
        connected: true,
        launchSessionId: 'owned-run',
        terminalAgentId: 7,
        characterName: 'Original',
      }),
    );
    store.nextAgentId.current = 2;
    runtime.registerAgent('old-session', 1);
    runtime.handleHookEvent('copilot', {
      ...hook('sessionStart'),
      launch_session_id: 'owned-run',
    });
    send('userPromptSubmitted');
    expect(store.size).toBe(2);
    expect(store.get(1)?.sessionId).toBe('old-session');
    expect(store.get(1)?.connected).toBe(false);
    expect(store.get(1)?.characterName).toBe('Original');
    expect(store.get(2)?.sessionId).toBe('copilot-session');
    expect(store.get(2)?.terminalAgentId).toBe(7);
    expect(store.get(2)?.characterName).toBeUndefined();
    runtime.handleHookEvent('copilot', {
      ...hook('postToolUse', { toolName: 'view', toolArgs: { path: 'old.ts' } }),
      session_id: 'old-session',
    });
    expect(store.size).toBe(2);
    expect(store.get(1)?.sessionId).toBe('old-session');
    expect(store.get(1)?.connected).toBe(false);
  });
});

describe('bundled Copilot bridge', () => {
  async function run(event: string, input: string, enrolled = true) {
    return new Promise<{ code: number | null; stdout: string; stderr: string }>(
      (resolve, reject) => {
        const child = spawn(
          process.execPath,
          [path.join(__dirname, '../../dist/hooks/copilot-hook.js'), event],
          {
            env: {
              ...process.env,
              HOME: home,
              USERPROFILE: home,
              PIXEL_AGENTS_COPILOT: enrolled ? '1' : '',
            },
            stdio: 'pipe',
            timeout: 5000,
          },
        );
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (data: Buffer) => {
          stdout += data.toString();
        });
        child.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });
        child.once('error', reject);
        child.once('close', (code) => resolve({ code, stdout, stderr }));
        child.stdin.end(input);
      },
    );
  }

  it('delivers an authenticated, redacted observation, not un-enrolled Chat activity', async () => {
    const received: { url: string | undefined; auth: string | undefined; body: string }[] = [];
    const server = http.createServer((request, response) => {
      let body = '';
      request.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      request.on('end', () => {
        received.push({ url: request.url, auth: request.headers.authorization, body });
        response.end('ok');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing test server port');
      const registry = path.join(home, '.pixel-agents/servers');
      fs.mkdirSync(registry, { recursive: true });
      fs.writeFileSync(
        path.join(registry, 'test.json'),
        JSON.stringify({
          port: address.port,
          pid: process.pid,
          token: 'test-only-token',
          startedAt: Date.now(),
          servesSpa: true,
          protocol: 1,
        }),
      );
      const input = JSON.stringify({
        sessionId: 'test-session',
        cwd: home,
        toolName: 'view',
        toolArgs: { path: 'test.ts' },
        prompt: 'private prompt',
      });
      expect((await run('preToolUse', input, false)).code).toBe(0);
      expect(received).toHaveLength(0);
      expect(await run('preToolUse', input)).toMatchObject({ code: 0, stdout: '{}' });
      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({
        url: '/api/hooks/copilot',
        auth: 'Bearer test-only-token',
      });
      expect(received[0].body).not.toContain('private prompt');
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });

  it('reports malformed input without changing permissions or failing a tool', async () => {
    const result = await run('preToolUse', '{"prompt":"private prompt"');
    expect(result).toMatchObject({ code: 0, stdout: '{}' });
    expect(result.stderr).toContain('[Pixel Agents] Copilot hook: Invalid Copilot hook JSON');
    expect(result.stderr).not.toContain('private prompt');
  });
});
