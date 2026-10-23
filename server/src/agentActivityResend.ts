import type { AgentStateStore } from './agentStateStore.js';

export function resendAgentActivity(
  send: (message: Record<string, unknown>) => void,
  store: AgentStateStore,
  agentId?: number,
): void {
  for (const [id, agent] of store) {
    if (!agent.characterName || agent.archived) continue;
    if (agentId !== undefined && id !== agentId) continue;
    for (const [toolId, status] of agent.activeToolStatuses) {
      send({
        type: 'agentToolStart',
        id,
        toolId,
        status,
        toolName: agent.activeToolNames.get(toolId),
        permissionActive: agent.permissionSent || undefined,
      });
    }
    if (agent.isWaiting) {
      send({
        type: 'agentStatus',
        id,
        status: 'waiting',
        awaitingInput: agent.awaitingInput || undefined,
      });
    } else if (agent.isTurnActive) {
      send({ type: 'agentStatus', id, status: 'active' });
    }
    if (agent.permissionSent) send({ type: 'agentToolPermission', id });
  }
}
