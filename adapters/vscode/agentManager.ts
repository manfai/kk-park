import { randomUUID } from 'crypto';
import * as os from 'os';
import * as vscode from 'vscode';

import type { StateAdapter } from '../../core/src/adapter.js';
import { resendAgentActivity } from '../../server/src/agentActivityResend.js';
import type { AgentRuntime } from '../../server/src/agentRuntime.js';
import { createAgentState } from '../../server/src/agentState.js';
import type { AgentStateStore } from '../../server/src/agentStateStore.js';
import { directoryNameForLaunch } from '../../server/src/directories.js';
import { loadLayout } from '../../server/src/layoutPersistence.js';
import { assignPaletteIfNeeded } from '../../server/src/paletteAssigner.js';
import { copilotProvider } from '../../server/src/providers/index.js';
import { workspaceDirectories } from './hostDirectories.js';

export function launchNewTerminal(
  store: AgentStateStore,
  runtime: AgentRuntime,
  options: {
    directoryPath?: string;
    bypassPermissions?: boolean;
    suppressShow?: boolean;
    agentId?: number;
  } = {},
): void {
  const existing = options.agentId !== undefined ? store.get(options.agentId) : undefined;
  if (existing?.connected || existing?.terminalRef)
    throw new Error('Cannot replace a session with a live terminal.');
  const cwd =
    existing?.projectDir ??
    options.directoryPath ??
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ??
    os.homedir();
  const sessionId = existing?.sessionId ?? randomUUID();
  const runtimeId = randomUUID();
  const launch = copilotProvider.buildLaunchCommand(sessionId, cwd, {
    ...options,
    resume: !!existing,
    runtimeId,
  });
  const terminal = vscode.window.createTerminal({
    name: `${copilotProvider.terminalNamePrefix} #${store.nextTerminalIndex.current++}`,
    cwd,
    env: launch.env,
  });
  const id = existing?.id ?? store.nextAgentId.current++;
  const agent =
    existing ??
    createAgentState({
      id,
      sessionId,
      launchSessionId: runtimeId,
      terminalRef: terminal,
      isExternal: false,
      projectDir: cwd,
      directoryName: directoryNameForLaunch(cwd, workspaceDirectories()),
    });
  agent.connected = true;
  agent.isExternal = false;
  agent.terminalRef = terminal;
  agent.launchSessionId = runtimeId;
  assignPaletteIfNeeded(agent, store);
  store.set(id, agent);
  runtime.registerAgent(sessionId, id);
  runtime.activeAgentId.current = id;
  store.persist();
  store.notifySessionsChanged();
  if (!options.suppressShow) terminal.show();
  terminal.sendText([launch.command, ...launch.args].join(' '));
}

export function restoreAgents(
  adapter: StateAdapter,
  store: AgentStateStore,
  runtime: AgentRuntime,
): void {
  for (const saved of adapter.loadAgents()) {
    if (saved.providerId !== copilotProvider.id || !saved.sessionId || saved.isExternal) continue;
    const terminal = vscode.window.terminals.find((candidate) => {
      const options = candidate.creationOptions;
      const env = 'env' in options ? options.env : undefined;
      return (
        !!saved.launchSessionId &&
        env?.PIXEL_AGENTS_COPILOT === '1' &&
        env.PIXEL_AGENTS_COPILOT_SESSION_ID === saved.launchSessionId
      );
    });
    if (!terminal) continue;
    if (saved.archived) {
      terminal.dispose();
      runtime.closeAgent(saved.id);
      continue;
    }
    const agent =
      store.get(saved.id) ??
      createAgentState({
        id: saved.id,
        sessionId: saved.sessionId,
        characterName: saved.characterName,
        launchSessionId: saved.launchSessionId,
        terminalRef: terminal,
        isExternal: false,
        projectDir: saved.projectDir,
        directoryName: saved.directoryName ?? saved.folderName,
        palette: saved.palette,
        hueShift: saved.hueShift,
      });
    agent.terminalRef = terminal;
    agent.connected = true;
    agent.isExternal = false;
    agent.launchSessionId = saved.launchSessionId;
    assignPaletteIfNeeded(agent, store);
    store.set(agent.id, agent);
    runtime.registerAgent(agent.sessionId, agent.id);
    store.nextAgentId.current = Math.max(store.nextAgentId.current, agent.id + 1);
    const index = saved.terminalName.match(/#(\d+)$/);
    if (index)
      store.nextTerminalIndex.current = Math.max(
        store.nextTerminalIndex.current,
        Number(index[1]) + 1,
      );
  }
  store.persist();
}

export function sendExistingAgents(
  agents: AgentStateStore,
  adapter: StateAdapter,
  webview: vscode.Webview | undefined,
): void {
  if (!webview) return;
  const seats = adapter.loadSeats();
  const directoryNames: Record<number, string> = {};
  const externalAgents: Record<number, boolean> = {};
  const agentMeta: Record<
    number,
    { palette?: number; hueShift?: number; seatId?: string; archived?: boolean }
  > = {};
  for (const [id, agent] of agents) {
    if (!agent.characterName) continue;
    if (agent.directoryName) directoryNames[id] = agent.directoryName;
    if (agent.isExternal) externalAgents[id] = true;
    agentMeta[id] = {
      palette: agent.palette,
      archived: agent.archived,
      hueShift: agent.hueShift,
      seatId: seats[String(id)]?.seatId,
    };
  }
  webview.postMessage({
    type: 'existingAgents',
    agents: [...agents.values()]
      .filter((agent) => agent.characterName)
      .map((agent) => agent.id)
      .sort((a, b) => a - b),
    characterNames: Object.fromEntries(
      [...agents.values()]
        .filter((agent) => agent.characterName)
        .map((agent) => [agent.id, agent.characterName]),
    ),
    agentMeta,
    directoryNames,
    externalAgents,
  });
}

export function sendCurrentAgentStatuses(
  agents: AgentStateStore,
  webview: vscode.Webview | undefined,
): void {
  if (webview) resendAgentActivity((message) => webview.postMessage(message), agents);
}

export function sendLayout(
  webview: vscode.Webview | undefined,
  defaultLayout?: Record<string, unknown> | null,
): void {
  const result = loadLayout(defaultLayout);
  webview?.postMessage({
    type: 'layoutLoaded',
    layout: result?.layout ?? null,
    wasReset: result?.wasReset ?? false,
  });
}
