import type * as vscode from 'vscode';

export type { PersistedAgent } from '../../core/src/schemas.js';

export interface AgentState {
  id: number;
  sessionId: string;
  characterName?: string;
  archived?: boolean;
  connected: boolean;
  terminalAgentId?: number;
  launchSessionId?: string;
  terminalRef?: vscode.Terminal;
  isExternal: boolean;
  projectDir: string;
  providerId: string;
  hooksOnly: boolean;
  directoryName?: string;
  activeToolIds: Set<string>;
  activeToolStatuses: Map<string, string>;
  activeToolNames: Map<string, string>;
  hookToolGroups?: Map<string, { toolId: string; count: number }>;
  isWaiting: boolean;
  isTurnActive: boolean;
  awaitingInput?: boolean;
  permissionSent: boolean;
  hookDelivered: boolean;
  lastDataAt: number;
  palette?: number;
  hueShift?: number;
}
