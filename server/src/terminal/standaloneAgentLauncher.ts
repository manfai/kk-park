import { randomUUID } from 'crypto';

import type { HookProvider } from '../../../core/src/provider.js';
import type { AgentRuntime } from '../agentRuntime.js';
import { createAgentState } from '../agentState.js';
import type { AgentStateStore } from '../agentStateStore.js';
import { directoryNameForLaunch } from '../directories.js';
import { directoryNameFor, hostDirectory } from '../hostDirectory.js';
import { assignPaletteIfNeeded } from '../paletteAssigner.js';
import type { PtySessionManager } from './ptySessionManager.js';

export interface LaunchStandaloneAgentDeps {
  store: AgentStateStore;
  runtime: AgentRuntime;
  ptyManager: PtySessionManager;
  provider: HookProvider;
}

export interface LaunchStandaloneAgentOptions {
  directoryPath?: string;
  bypassPermissions?: boolean;
  cols?: number;
  rows?: number;
  agentId?: number;
}

export function launchStandaloneAgent(
  { store, runtime, ptyManager, provider }: LaunchStandaloneAgentDeps,
  options: LaunchStandaloneAgentOptions = {},
): number | null {
  if (!ptyManager.isAvailable()) {
    console.error(`[Pixel Agents] Terminal: cannot launch -- ${ptyManager.unavailableReason()}`);
    return null;
  }
  const existing = options.agentId !== undefined ? store.get(options.agentId) : undefined;
  if (existing?.connected || existing?.terminalAgentId !== undefined) {
    console.error('[Pixel Agents] Cannot replace a session with a live terminal.');
    return null;
  }
  const cwd = existing?.projectDir ?? options.directoryPath ?? process.cwd();
  const sessionId = existing?.sessionId ?? randomUUID();
  const runtimeId = randomUUID();
  const launch = provider.buildLaunchCommand(sessionId, cwd, {
    bypassPermissions: options.bypassPermissions,
    resume: !!existing,
    runtimeId,
  });
  const id = existing?.id ?? store.nextAgentId.current;
  const terminalId = store.nextTerminalIndex.current++;
  let session;
  try {
    session = ptyManager.create({
      agentId: terminalId,
      command: launch.command,
      args: launch.args,
      cwd,
      env: launch.env,
      cols: options.cols,
      rows: options.rows,
    });
  } catch (err) {
    console.error(`[Pixel Agents] Terminal: spawn failed: ${String(err)}`);
    return null;
  }
  const agent =
    existing ??
    createAgentState({
      id,
      sessionId,
      projectDir: cwd,
      isExternal: false,
      directoryName: directoryNameForLaunch(cwd, [hostDirectory()]) ?? directoryNameFor(cwd),
    });
  if (!existing) store.nextAgentId.current++;
  agent.connected = true;
  agent.isExternal = false;
  agent.terminalAgentId = terminalId;
  agent.launchSessionId = runtimeId;
  assignPaletteIfNeeded(agent, store);
  store.set(id, agent);
  runtime.activeAgentId.current = id;
  runtime.registerAgent(sessionId, id);
  store.persist();
  store.notifySessionsChanged();
  store.broadcast({ type: 'terminalSessionOpened', agentId: id });
  console.log(`[Pixel Agents] Terminal: Agent ${id} - spawned ${launch.command} in ${cwd}`);
  session.onExit((exit) => {
    const current = [...store.values()].find((entry) => entry.terminalAgentId === terminalId);
    if (current)
      store.broadcast({
        type: 'terminalSessionClosed',
        agentId: current.id,
        exitCode: exit.exitCode,
      });
    runtime.disconnectTerminal(terminalId);
  });
  return id;
}
