import fs from 'node:fs';
import path from 'node:path';

export interface HookServerConfig {
  port: number;
  pid: number;
  token: string;
  startedAt: number;
}

export interface HookEventPayload {
  sessionId: string;
  hook_event_name: string;
  cwd?: string;
  [key: string]: unknown;
}

export const COPILOT_EVENTS = [
  'sessionStart',
  'sessionEnd',
  'preToolUse',
  'postToolUse',
  'postToolUseFailure',
  'userPromptSubmitted',
  'agentStop',
  'notification',
].sort();

export function ourHookEvents(tmpHome: string): string[] {
  try {
    const config = JSON.parse(
      fs.readFileSync(path.join(tmpHome, '.copilot', 'hooks', 'pixel-agents.json'), 'utf8'),
    ) as { hooks?: Record<string, Array<{ args?: string[] }>> };
    const script = path.join(tmpHome, '.pixel-agents', 'hooks', 'copilot-hook.js');
    return Object.entries(config.hooks ?? {})
      .filter(([, hooks]) => hooks.some((hook) => hook.args?.[0] === script))
      .map(([event]) => event)
      .sort();
  } catch {
    return [];
  }
}

export async function waitForHookServer(
  tmpHome: string,
  timeoutMs = 20_000,
): Promise<HookServerConfig> {
  const configPath = path.join(tmpHome, '.pixel-agents', 'server.json');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as HookServerConfig;
      if (
        typeof config.port === 'number' &&
        typeof config.token === 'string' &&
        (await fetch(`http://127.0.0.1:${config.port}/api/health`)).ok
      ) {
        return config;
      }
    } catch {
      // Startup may not have published the registry yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for hook server config at ${configPath}`);
}

/** Direct ingress is reserved for standalone server-level integration tests. */
export async function sendHookEvent(
  config: HookServerConfig,
  event: HookEventPayload,
  provider = 'copilot',
): Promise<void> {
  const response = await fetch(`http://127.0.0.1:${config.port}/api/hooks/${provider}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...event,
      session_id: event.sessionId,
      tool_name: event.toolName,
      tool_input: event.toolArgs,
      tool_use_id: event.toolCallId ?? event.toolName,
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Hook ${event.hook_event_name} failed (${response.status}): ${await response.text()}`,
    );
  }
}

export function sessionStartStartup(sessionId: string, cwd: string): HookEventPayload {
  return { sessionId, cwd, hook_event_name: 'sessionStart', source: 'startup' };
}

export function preToolUseBash(
  sessionId: string,
  command: string,
  cwd = '{{cwd}}',
): HookEventPayload {
  return { sessionId, cwd, hook_event_name: 'preToolUse', toolName: 'bash', toolArgs: { command } };
}

export function sessionEndExit(sessionId: string): HookEventPayload {
  return { sessionId, hook_event_name: 'sessionEnd', reason: 'user_exit' };
}
