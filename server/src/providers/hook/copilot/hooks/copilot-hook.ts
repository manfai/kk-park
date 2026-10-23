import { createHash } from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';

import { SERVER_JSON_DIR, SERVERS_DIR } from '../../../../constants.js';
import { isServerConfig } from '../../../../serverConfig.js';
import {
  COPILOT_DELIVERY_TIMEOUT_MS,
  COPILOT_HOOK_EVENTS,
  COPILOT_HOOK_INPUT_LIMIT_BYTES,
  COPILOT_LAUNCH_SESSION_ENV,
  COPILOT_PROVIDER_ID,
  COPILOT_TRACKING_ENV,
} from '../constants.js';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function observation(
  eventName: string,
  raw: Record<string, unknown>,
): Record<string, unknown> | null {
  if (!(COPILOT_HOOK_EVENTS as readonly string[]).includes(eventName)) return null;
  if (typeof raw.sessionId !== 'string' || !raw.sessionId)
    throw new Error('Missing Copilot sessionId');
  const args = raw.toolArgs;
  const input = args && typeof args === 'object' ? (args as Record<string, unknown>) : {};
  const toolId =
    typeof raw.toolCallId === 'string'
      ? raw.toolCallId
      : createHash('sha256')
          .update(canonical([raw.agentId, raw.toolName, args]))
          .digest('hex');
  return {
    hook_event_name: eventName,
    session_id: raw.sessionId,
    launch_session_id: process.env[COPILOT_LAUNCH_SESSION_ENV],
    cwd: typeof raw.cwd === 'string' ? raw.cwd : undefined,
    source: raw.source,
    reason: raw.reason,
    agentId: raw.agentId,
    tool_name: raw.toolName,
    tool_use_id: toolId,
    tool_input: {
      path: typeof input.path === 'string' ? input.path.split(/[\\/]/).pop() : undefined,
    },
    notification_type: raw.notification_type,
  };
}

async function deliver(body: string): Promise<void> {
  const directory = path.join(os.homedir(), SERVER_JSON_DIR, SERVERS_DIR);
  let files: string[];
  try {
    files = fs.readdirSync(directory).filter((name) => name.endsWith('.json'));
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') return;
    throw err;
  }
  await Promise.all(
    files.map(async (name) => {
      let server: unknown;
      try {
        server = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
      } catch {
        console.error('[Pixel Agents] Copilot hook: unreadable server registration');
        return;
      }
      if (!isServerConfig(server)) throw new Error('Invalid Pixel Agents server registration');
      try {
        process.kill(server.pid, 0);
      } catch {
        return;
      }
      await new Promise<void>((resolve) => {
        const request = http.request(
          {
            hostname: '127.0.0.1',
            port: server.port,
            path: `/api/hooks/${COPILOT_PROVIDER_ID}`,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(body),
              Authorization: `Bearer ${server.token}`,
            },
            timeout: COPILOT_DELIVERY_TIMEOUT_MS,
          },
          (response) => {
            response.resume();
            if (response.statusCode !== 200)
              console.error(`[Pixel Agents] Copilot hook delivery returned ${response.statusCode}`);
            resolve();
          },
        );
        request.on('error', (err) => {
          console.error(`[Pixel Agents] Copilot hook delivery: ${err.message}`);
          resolve();
        });
        request.on('timeout', () => {
          request.destroy(new Error('Delivery timed out'));
        });
        request.end(body);
      });
    }),
  );
}

async function main(): Promise<void> {
  if (process.env[COPILOT_TRACKING_ENV] !== '1') return;
  let input = '';
  for await (const chunk of process.stdin) {
    input += String(chunk);
    if (Buffer.byteLength(input) > COPILOT_HOOK_INPUT_LIMIT_BYTES)
      throw new Error('Copilot hook input exceeds size limit');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(input);
  } catch {
    throw new Error('Invalid Copilot hook JSON');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('Invalid Copilot hook input');
  const event = observation(process.argv[2], raw as Record<string, unknown>);
  if (event) await deliver(JSON.stringify(event));
}

if (require.main === module) {
  // Observation must never deny a Copilot tool. Command preToolUse errors
  // otherwise fail closed, so report delivery failures without a nonzero exit.
  void main()
    .catch((err: unknown) =>
      console.error(
        '[Pixel Agents] Copilot hook:',
        err instanceof Error ? err.message : String(err),
      ),
    )
    .finally(() => process.stdout.write('{}'));
}
