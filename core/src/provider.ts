/** Semantic events supplied by the Copilot CLI hooks integration. */
export type AgentEvent =
  | { kind: 'turnStart' }
  | { kind: 'toolStart'; toolId: string; toolName: string; input?: unknown }
  | { kind: 'toolEnd'; toolId: string; resumesTurn?: boolean }
  | { kind: 'turnEnd'; awaitingInput?: boolean }
  | { kind: 'permissionRequest' }
  | { kind: 'sessionStart'; source?: string; launchSessionId?: string; cwd?: string }
  | { kind: 'sessionEnd'; reason?: string };

export interface HookProvider {
  readonly kind: 'hook';
  readonly id: string;
  readonly displayName: string;
  readonly protocolVersion: number;
  normalizeHookEvent(raw: Record<string, unknown>): {
    sessionId: string;
    event: AgentEvent;
  } | null;
  installHooks(serverUrl: string, authToken: string): Promise<void>;
  uninstallHooks(): Promise<void>;
  areHooksInstalled(): Promise<boolean>;
  consentDisclosure(): { headline: string; disclosure: string };
  formatToolStatus(toolName: string, input?: unknown): string;
  readonly readingTools: ReadonlySet<string>;
  readonly subagentToolNames: ReadonlySet<string>;
  readonly terminalNamePrefix?: string;
  discoverSessions?(): readonly { sessionId: string; cwd?: string }[];
  buildLaunchCommand(
    sessionId: string,
    cwd: string,
    opts?: { bypassPermissions?: boolean; resume?: boolean; runtimeId?: string },
  ): {
    command: string;
    args: string[];
    env?: Record<string, string>;
  };
}
