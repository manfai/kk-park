import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import type { AgentEvent, HookProvider } from '../../core/src/provider.js';
import { resendAgentActivity } from './agentActivityResend.js';
import { createAgentState } from './agentState.js';
import type { AgentStateStore } from './agentStateStore.js';
import { CHARACTER_NAME_MAX_LENGTH } from './constants.js';
import { directoryNameForLaunch } from './directories.js';
import { assignPaletteIfNeeded } from './paletteAssigner.js';
import { toPathKey } from './pathKey.js';
import { copilotProvider } from './providers/index.js';
import { sessionStatus } from './sessionCatalog.js';
import type { AgentState } from './types.js';

export interface RuntimeLifecycleCallbacks {
  onAgentRemoved?: (agentId: number, agent: AgentState) => void;
  directoryNameFor?: (cwd: string) => string | undefined;
}

/** Shared, hooks-only lifecycle for agents launched or adopted by either adapter. */
export class AgentRuntime {
  readonly activeAgentId = { current: null as number | null };
  readonly watchAllSessions = { current: false };
  readonly hooksEnabled = { current: true };
  private readonly sessions = new Map<string, number>();
  private readonly dismissedSessions = new Set<string>();
  private readonly workingDirectories = new Set<string>();
  private callbacks: RuntimeLifecycleCallbacks = {};
  private readonly openingSessions = new Map<number, Promise<void>>();
  private readonly archivingSessions = new Set<number>();

  constructor(
    private readonly store: AgentStateStore,
    readonly provider: HookProvider = copilotProvider,
  ) {
    store.batchSessions(() => {
      for (const saved of store.loadPersistedAgents()) {
        if (
          !saved ||
          saved.providerId !== provider.id ||
          typeof saved.sessionId !== 'string' ||
          !saved.sessionId ||
          !Number.isSafeInteger(saved.id) ||
          saved.id < 1 ||
          store.has(saved.id) ||
          [...store.values()].some((agent) => agent.sessionId === saved.sessionId)
        )
          continue;
        store.set(
          saved.id,
          createAgentState({
            id: saved.id,
            sessionId: saved.sessionId,
            archived: saved.archived === true || undefined,
            projectDir: typeof saved.projectDir === 'string' ? saved.projectDir : '',
            isExternal: true,
            characterName:
              typeof saved.characterName === 'string'
                ? saved.characterName.trim() || undefined
                : undefined,
            directoryName: saved.directoryName ?? saved.folderName,
            palette: saved.palette,
            hueShift: saved.hueShift,
          }),
        );
        this.registerAgent(saved.sessionId, saved.id);
        store.nextAgentId.current = Math.max(store.nextAgentId.current, saved.id + 1);
      }
    });
  }

  refreshSessions(): void {
    this.store.batchSessions(() => {
      for (const session of this.provider.discoverSessions?.() ?? []) {
        const existing = [...this.store.values()].find(
          (agent) => agent.sessionId === session.sessionId,
        );
        if (existing) {
          if (!existing.projectDir && session.cwd) {
            existing.projectDir = session.cwd;
            existing.directoryName =
              this.callbacks.directoryNameFor?.(session.cwd) ?? path.basename(session.cwd);
          }
          continue;
        }
        this.addSession(session.sessionId, session.cwd ?? '');
      }
      this.store.persist();
      this.store.notifySessionsChanged();
    });
  }

  private addSession(sessionId: string, cwd: string): AgentState {
    const id = this.store.nextAgentId.current++;
    const agent = createAgentState({
      id,
      sessionId,
      projectDir: cwd,
      isExternal: true,
      directoryName: cwd
        ? (this.callbacks.directoryNameFor?.(cwd) ??
          directoryNameForLaunch(cwd, []) ??
          path.basename(cwd))
        : undefined,
    });
    assignPaletteIfNeeded(agent, this.store);
    this.store.set(id, agent);
    this.registerAgent(sessionId, id);
    return agent;
  }

  nameSession(id: number, input: unknown): void {
    if (!this.store.has(id)) throw new Error('This session is no longer available.');
    if (
      typeof input !== 'string' ||
      input.trim().length > CHARACTER_NAME_MAX_LENGTH ||
      /[\u0000-\u001f\u007f]/.test(input)
    )
      throw new Error(
        `Use a character name of at most ${CHARACTER_NAME_MAX_LENGTH} characters without control characters.`,
      );
    this.store.setCharacterName(id, input.trim());
    resendAgentActivity((message) => this.store.broadcast(message), this.store, id);
    const agent = this.store.get(id);
    if (agent?.characterName && agent.connected && agent.terminalAgentId !== undefined)
      this.store.broadcast({ type: 'terminalSessionOpened', agentId: id });
  }

  async openSession(id: number, open: (agent: AgentState) => void | Promise<void>): Promise<void> {
    if (this.archivingSessions.has(id))
      throw new Error('Wait for this session to finish archiving.');
    const agent = this.store.get(id);
    if (!agent) throw new Error('This session is no longer available.');
    if (!agent.characterName)
      throw new Error('Give this session a character name before opening it.');
    if (agent.connected && !agent.terminalRef && agent.terminalAgentId === undefined)
      throw new Error(
        'This session is running outside Pixel Agents. Its terminal cannot be controlled here.',
      );
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(agent.sessionId))
      throw new Error('This session ID cannot be safely resumed.');
    if (!agent.connected) {
      if (!path.isAbsolute(agent.projectDir))
        throw new Error('The session working directory is unknown. It cannot be resumed here.');
      let isDirectory = false;
      try {
        isDirectory = fs.statSync(agent.projectDir).isDirectory();
      } catch (err) {
        console.warn('[Pixel Agents] Cannot access session working directory:', err);
      }
      if (!isDirectory) throw new Error('The session working directory is no longer available.');
    }
    const pending = this.openingSessions.get(id);
    if (pending) return pending;
    const opening = Promise.resolve().then(async () => {
      await open(agent);
      if (agent.archived) {
        this.store.setArchived(id, false);
        if (agent.terminalAgentId !== undefined)
          this.store.broadcast({ type: 'terminalSessionOpened', agentId: id });
        resendAgentActivity((message) => this.store.broadcast(message), this.store, id);
      }
    });
    this.openingSessions.set(id, opening);
    try {
      await opening;
    } finally {
      this.openingSessions.delete(id);
    }
  }

  async setSessionArchived(
    id: number,
    archived: unknown,
    stop?: (agent: AgentState) => void | Promise<void>,
  ): Promise<void> {
    const agent = this.store.get(id);
    if (!agent?.characterName) throw new Error('Choose a named character to archive or restore.');
    if (typeof archived !== 'boolean') throw new Error('Choose a valid archive state.');
    if (this.archivingSessions.has(id) || this.openingSessions.has(id))
      throw new Error('Wait for the current session action to finish.');
    if (!!agent.archived === archived) return;
    const managed = !!agent.terminalRef || agent.terminalAgentId !== undefined;
    if (archived && managed && !stop) throw new Error('This terminal cannot be stopped here.');
    this.archivingSessions.add(id);
    try {
      this.store.setArchived(id, archived);
      if (archived && managed && stop) {
        try {
          await stop(agent);
        } catch (error) {
          this.store.setArchived(id, false);
          throw error;
        }
        this.closeAgent(id);
      }
      if (!archived)
        resendAgentActivity((message) => this.store.broadcast(message), this.store, id);
    } finally {
      this.archivingSessions.delete(id);
    }
  }

  disconnectTerminal(terminalAgentId: number): void {
    for (const agent of this.store.values())
      if (agent.terminalAgentId === terminalAgentId) this.closeAgent(agent.id);
  }

  setLifecycleCallbacks(callbacks: RuntimeLifecycleCallbacks): void {
    this.callbacks = callbacks;
  }

  registerAgent(sessionId: string, agentId: number): void {
    this.dismissedSessions.delete(sessionId);
    this.sessions.set(sessionId, agentId);
  }

  unregisterAgent(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  trackWorkingDirectory(directory: string): void {
    try {
      this.workingDirectories.add(toPathKey(fs.realpathSync(directory)));
    } catch (err) {
      console.warn('[Pixel Agents] Cannot track working directory:', err);
    }
  }

  setWorkingDirectories(directories: readonly string[]): void {
    this.workingDirectories.clear();
    for (const directory of directories) this.trackWorkingDirectory(directory);
  }

  isTrackedWorkingDirectory(directory: string): boolean {
    let candidate: string;
    try {
      candidate = toPathKey(fs.realpathSync(directory));
    } catch (err) {
      console.warn('[Pixel Agents] Cannot resolve hook working directory:', err);
      return false;
    }
    return [...this.workingDirectories].some((tracked) => {
      const relative = path.relative(tracked, candidate);
      return (
        relative === '' ||
        (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
      );
    });
  }

  handleHookEvent(providerId: string, raw: Record<string, unknown>): void {
    if (providerId !== this.provider.id || this.provider.protocolVersion !== 1) return;
    const normalized = this.provider.normalizeHookEvent(raw);
    if (!normalized) return;
    const { sessionId, event } = normalized;
    if (event.kind === 'sessionStart') this.dismissedSessions.delete(sessionId);
    else if (this.dismissedSessions.has(sessionId)) return;
    let agent =
      this.store.get(this.sessions.get(sessionId) ?? -1) ??
      [...this.store.values()].find((candidate) => candidate.sessionId === sessionId);
    if (
      event.kind !== 'sessionStart' &&
      agent?.launchSessionId &&
      typeof raw.launch_session_id === 'string' &&
      raw.launch_session_id !== agent.launchSessionId
    )
      return;
    const isNew = !agent;

    if (!agent) {
      if (event.kind === 'sessionEnd' || typeof raw.cwd !== 'string') return;
      const owned =
        event.kind === 'sessionStart' &&
        event.launchSessionId &&
        [...this.store.values()].some(
          (candidate) => candidate.launchSessionId === event.launchSessionId,
        );
      if (!owned && !this.watchAllSessions.current && !this.isTrackedWorkingDirectory(raw.cwd))
        return;
      agent = this.addSession(sessionId, raw.cwd);
    }
    const previousStatus = sessionStatus(agent);
    const cwdChanged = typeof raw.cwd === 'string' && !!raw.cwd && agent.projectDir !== raw.cwd;
    if (event.kind === 'sessionStart' && event.launchSessionId) {
      const owner = [...this.store.values()].find(
        (candidate) =>
          candidate.id !== agent.id &&
          candidate.launchSessionId === event.launchSessionId &&
          (candidate.terminalRef || candidate.terminalAgentId !== undefined),
      );
      if (owner) {
        const { terminalRef, terminalAgentId } = owner;
        this.closeAgent(owner.id);
        agent.terminalRef = terminalRef;
        agent.terminalAgentId = terminalAgentId;
        agent.launchSessionId = event.launchSessionId;
        agent.isExternal = false;
        if (terminalAgentId !== undefined)
          this.store.broadcast({ type: 'terminalSessionOpened', agentId: agent.id });
      }
    }
    this.registerAgent(sessionId, agent.id);
    agent.connected = true;
    if (cwdChanged && typeof raw.cwd === 'string') {
      agent.projectDir = raw.cwd;
      agent.directoryName =
        this.callbacks.directoryNameFor?.(raw.cwd) ??
        directoryNameForLaunch(raw.cwd, []) ??
        path.basename(raw.cwd);
    }
    agent.hookDelivered = true;
    agent.lastDataAt = Date.now();
    this.dispatch(agent, event);
    if (isNew || cwdChanged || event.kind === 'sessionStart') this.store.persist();
    if (isNew || cwdChanged || previousStatus !== sessionStatus(agent))
      this.store.notifySessionsChanged();
  }

  private dispatch(agent: AgentState, event: AgentEvent): void {
    const id = agent.id;
    switch (event.kind) {
      case 'sessionStart':
        return;
      case 'sessionEnd':
        if (agent.terminalRef || agent.terminalAgentId !== undefined) this.markWaiting(agent);
        else this.closeAgent(id);
        return;
      case 'turnStart':
        this.clearTools(agent);
        this.markActive(agent);
        return;
      case 'toolStart': {
        this.clearPermission(agent);
        this.markActive(agent);
        const groups = (agent.hookToolGroups ??= new Map());
        const existing = groups.get(event.toolId);
        if (existing) {
          existing.count++;
          return;
        }
        const toolId = `${event.toolId}:${randomUUID()}`;
        groups.set(event.toolId, { toolId, count: 1 });
        const status = this.provider.formatToolStatus(event.toolName, event.input);
        agent.activeToolIds.add(toolId);
        agent.activeToolStatuses.set(toolId, status);
        agent.activeToolNames.set(toolId, event.toolName);
        this.store.broadcast({
          type: 'agentToolStart',
          id,
          toolId,
          status,
          toolName: event.toolName,
        });
        return;
      }
      case 'toolEnd': {
        this.clearPermission(agent);
        if (event.resumesTurn && agent.awaitingInput) this.markActive(agent);
        const group = agent.hookToolGroups?.get(event.toolId);
        if (!group || --group.count > 0) return;
        agent.hookToolGroups?.delete(event.toolId);
        agent.activeToolIds.delete(group.toolId);
        agent.activeToolStatuses.delete(group.toolId);
        agent.activeToolNames.delete(group.toolId);
        this.store.broadcast({ type: 'agentToolDone', id, toolId: group.toolId });
        return;
      }
      case 'permissionRequest':
        agent.permissionSent = true;
        this.store.broadcast({ type: 'agentToolPermission', id });
        return;
      case 'turnEnd':
        this.markWaiting(agent, event.awaitingInput);
        return;
    }
  }

  private clearTools(agent: AgentState): void {
    agent.activeToolIds.clear();
    agent.activeToolStatuses.clear();
    agent.activeToolNames.clear();
    agent.hookToolGroups?.clear();
    this.store.broadcast({ type: 'agentToolsClear', id: agent.id });
  }

  private clearPermission(agent: AgentState): void {
    agent.permissionSent = false;
    this.store.broadcast({ type: 'agentToolPermissionClear', id: agent.id });
  }

  private markActive(agent: AgentState): void {
    agent.isWaiting = false;
    agent.awaitingInput = false;
    agent.isTurnActive = true;
    agent.permissionSent = false;
    this.store.broadcast({ type: 'agentStatus', id: agent.id, status: 'active' });
  }

  private markWaiting(agent: AgentState, awaitingInput = false): void {
    this.clearTools(agent);
    agent.isWaiting = true;
    agent.awaitingInput = awaitingInput;
    agent.isTurnActive = false;
    agent.permissionSent = false;
    this.store.broadcast({ type: 'agentStatus', id: agent.id, status: 'waiting', awaitingInput });
  }

  removeAgent(id: number): void {
    const agent = this.store.get(id);
    if (!agent) return;
    this.unregisterAgent(agent.sessionId);
    this.callbacks.onAgentRemoved?.(id, agent);
    this.store.delete(id);
    if (this.activeAgentId.current === id) this.activeAgentId.current = null;
    this.store.persist();
  }

  closeAgent(id: number): void {
    const agent = this.store.get(id);
    if (!agent) return;
    this.dismissedSessions.add(agent.sessionId);
    if (this.activeAgentId.current === id) this.activeAgentId.current = null;
    this.markWaiting(agent);
    agent.connected = false;
    agent.terminalRef = undefined;
    agent.terminalAgentId = undefined;
    agent.launchSessionId = undefined;
    this.store.broadcast({ type: 'terminalSessionClosed', agentId: id });
    this.store.persist();
    this.store.notifySessionsChanged();
  }

  dispose(): void {
    this.store.persist();
    this.sessions.clear();
    this.store.clear();
  }
}
