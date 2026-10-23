import type { SessionEntry, SessionsLoaded } from '../../core/src/messages.js';
import type { AgentStateStore } from './agentStateStore.js';
import type { AgentState } from './types.js';

export function sessionStatus(agent: AgentState): SessionEntry['status'] {
  return !agent.connected
    ? 'offline'
    : agent.permissionSent || agent.awaitingInput
      ? 'needs-input'
      : agent.isTurnActive
        ? 'active'
        : agent.isWaiting
          ? 'waiting'
          : 'idle';
}

export function sessionCatalogue(store: AgentStateStore): SessionsLoaded {
  return {
    type: 'sessionsLoaded',
    sessions: [...store.values()].map((agent) => ({
      id: agent.id,
      sessionId: agent.sessionId,
      characterName: agent.characterName,
      archived: agent.archived,
      projectDir: agent.projectDir,
      directoryName: agent.directoryName,
      connected: agent.connected,
      canOpen: agent.connected
        ? !!agent.terminalRef || agent.terminalAgentId !== undefined
        : !!agent.projectDir,
      status: sessionStatus(agent),
    })),
  };
}
