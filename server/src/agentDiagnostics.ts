import * as fs from 'node:fs';

import type { AgentStateStore } from './agentStateStore.js';

export interface AgentDiagnosticsEntry {
  id: number;
  projectDir: string;
  projectDirExists: boolean;
  lastDataAt: number;
  hookDelivered: boolean;
}

export function buildAgentDiagnostics(store: AgentStateStore): AgentDiagnosticsEntry[] {
  return [...store.values()].map((agent) => ({
    id: agent.id,
    projectDir: agent.projectDir,
    projectDirExists: fs.existsSync(agent.projectDir),
    lastDataAt: agent.lastDataAt,
    hookDelivered: agent.hookDelivered,
  }));
}
