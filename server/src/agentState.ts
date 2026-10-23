import { COPILOT_PROVIDER_ID } from './providers/hook/copilot/constants.js';
import type { AgentState } from './types.js';

type RequiredInit = 'id' | 'sessionId' | 'projectDir' | 'isExternal';
export type AgentStateInit = Pick<AgentState, RequiredInit> &
  Partial<Omit<AgentState, RequiredInit>>;

export function createAgentState(init: AgentStateInit): AgentState {
  return {
    providerId: COPILOT_PROVIDER_ID,
    hooksOnly: true,
    connected: false,
    activeToolIds: new Set(),
    activeToolStatuses: new Map(),
    activeToolNames: new Map(),
    isWaiting: false,
    isTurnActive: false,
    permissionSent: false,
    hookDelivered: false,
    lastDataAt: 0,
    ...init,
  };
}
