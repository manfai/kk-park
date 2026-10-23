import { describe, expect, it } from 'vitest';

import { resendAgentActivity } from '../src/agentActivityResend.js';
import { createAgentState } from '../src/agentState.js';
import { AgentStateStore } from '../src/agentStateStore.js';

describe('resendAgentActivity', () => {
  it('replays live tools before the active status and pending permission', () => {
    const store = new AgentStateStore();
    store.set(
      1,
      createAgentState({
        id: 1,
        sessionId: 'live',
        characterName: 'Live character',
        projectDir: '/project',
        isExternal: false,
        activeToolStatuses: new Map([['tool', 'Reading file.ts']]),
        activeToolNames: new Map([['tool', 'view']]),
        isTurnActive: true,
        permissionSent: true,
      }),
    );
    const sent: Record<string, unknown>[] = [];
    resendAgentActivity((message) => sent.push(message), store);
    expect(sent).toEqual([
      {
        type: 'agentToolStart',
        id: 1,
        toolId: 'tool',
        status: 'Reading file.ts',
        toolName: 'view',
        permissionActive: true,
      },
      { type: 'agentStatus', id: 1, status: 'active' },
      { type: 'agentToolPermission', id: 1 },
    ]);
  });

  it('preserves a human-input pause across an office reconnect', () => {
    const store = new AgentStateStore();
    store.set(
      1,
      createAgentState({
        id: 1,
        sessionId: 'paused',
        characterName: 'Paused character',
        projectDir: '/project',
        isExternal: false,
        isWaiting: true,
        awaitingInput: true,
      }),
    );
    const sent: Record<string, unknown>[] = [];
    resendAgentActivity((message) => sent.push(message), store);
    expect(sent).toEqual([{ type: 'agentStatus', id: 1, status: 'waiting', awaitingInput: true }]);
  });

  it('does not invent activity for a newly launched terminal', () => {
    const store = new AgentStateStore();
    store.set(
      1,
      createAgentState({
        id: 1,
        sessionId: 'new',
        projectDir: '/project',
        isExternal: false,
      }),
    );
    const sent: Record<string, unknown>[] = [];
    resendAgentActivity((message) => sent.push(message), store);
    expect(sent).toEqual([]);
  });
});
