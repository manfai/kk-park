import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { SESSION_METADATA_HEAD_BYTES } from '../../../constants.js';

export function copilotHome(): string {
  return (
    process.env.COPILOT_HOME || path.join(process.env.XDG_STATE_HOME || os.homedir(), '.copilot')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Parse only initialization metadata, never extract prompts, results, or titles. */
export function discoverSessions(): { sessionId: string; cwd?: string }[] {
  const root = path.join(copilotHome(), 'session-state');
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') return [];
    throw err;
  }
  const sessions: { sessionId: string; cwd?: string }[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(entry.name)) continue;
    const file = path.join(root, entry.name, 'events.jsonl');
    let fd: number | undefined;
    try {
      fd = fs.openSync(file, 'r');
      const buffer = Buffer.alloc(SESSION_METADATA_HEAD_BYTES);
      const length = fs.readSync(fd, buffer, 0, buffer.length, 0);
      const head = buffer.toString('utf8', 0, length);
      const newline = head.indexOf('\n');
      const firstLine = newline >= 0 ? head.slice(0, newline) : head;
      const record: unknown = JSON.parse(firstLine);
      const data =
        isRecord(record) && record.type === 'session.start' && isRecord(record.data)
          ? record.data
          : undefined;
      const context = data && isRecord(data.context) ? data.context : undefined;
      const cwd =
        context && typeof context.cwd === 'string' && path.isAbsolute(context.cwd)
          ? context.cwd
          : undefined;
      sessions.push({ sessionId: entry.name, cwd });
    } catch (err) {
      if (!(err instanceof Error && 'code' in err && err.code === 'ENOENT'))
        console.warn(`[Pixel Agents] Cannot read session metadata for ${entry.name}`);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  }
  return sessions;
}
