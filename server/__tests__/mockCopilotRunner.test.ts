import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newTestDirectory } from './testSupport.js';

const RUNNER = path.resolve(__dirname, '../../e2e/fixtures/mock-copilot-runner.cjs');

describe('mock Copilot runner', () => {
  let home: string;

  beforeEach(() => {
    home = newTestDirectory('mock-copilot-');
    fs.mkdirSync(path.join(home, '.copilot-mock'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  function queue(actions: unknown[], autoInit = true): void {
    fs.writeFileSync(
      path.join(home, '.copilot-mock', 'scenario-queue.json'),
      JSON.stringify([{ schemaVersion: 1, autoInit, holdOpenMs: 50, actions }]),
    );
  }

  function run(): Promise<{ code: number | null; stderr: string; stdout: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [RUNNER, '--session-id', 'launch-id'], {
        cwd: home,
        env: {
          ...process.env,
          HOME: home,
          USERPROFILE: home,
          COPILOT_HOME: path.join(home, 'custom-copilot'),
          PIXEL_AGENTS_COPILOT: '1',
          PIXEL_AGENTS_COPILOT_SESSION_ID: 'launch-id',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5000,
      });
      let stderr = '';
      let stdout = '';
      child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
      child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
      child.once('error', reject);
      child.once('close', (code) => resolve({ code, stderr, stdout }));
    });
  }

  function installRecordingBridge(): string {
    const script = path.join(home, '.pixel-agents', 'hooks', 'copilot-hook.js');
    const log = path.join(home, 'bridge.log');
    fs.mkdirSync(path.dirname(script), { recursive: true });
    fs.writeFileSync(
      script,
      `
const fs = require('node:fs');
let input = '';
process.stdin.on('data', (chunk) => input += chunk);
process.stdin.on('end', () => {
  fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({
    event: process.argv[2],
    payload: JSON.parse(input),
    enrollment: process.env.PIXEL_AGENTS_COPILOT,
    launchSession: process.env.PIXEL_AGENTS_COPILOT_SESSION_ID,
  }) + '\\n');
});
`,
    );
    const config = path.join(home, 'custom-copilot', 'hooks', 'pixel-agents.json');
    fs.mkdirSync(path.dirname(config), { recursive: true });
    const foreign = path.join(home, 'foreign-hook.js');
    fs.writeFileSync(foreign, 'throw new Error("must not run unrelated hooks");');
    fs.writeFileSync(
      config,
      JSON.stringify({
        version: 1,
        hooks: Object.fromEntries(
          ['sessionStart', 'preToolUse', 'sessionEnd'].map((event) => [
            event,
            [
              { type: 'command', exec: 'node', args: [foreign, event] },
              { type: 'command', exec: 'node', args: [script, event] },
            ],
          ]),
        ),
      }),
    );
    return log;
  }

  it('executes only the installed bridge, honoring COPILOT_HOME and documented payloads', async () => {
    const log = installRecordingBridge();
    queue([
      {
        kind: 'emitHook',
        atMs: 0,
        payload: {
          hook_event_name: 'preToolUse',
          sessionId: '{{sessionId}}',
          cwd: '{{cwd}}',
          toolName: 'view',
          toolArgs: { path: 'example.ts' },
        },
      },
    ]);
    const result = await run();
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('mock copilot session launch-id');
    const records = fs
      .readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(records).toEqual([
      {
        event: 'sessionStart',
        payload: { sessionId: 'launch-id', cwd: fs.realpathSync(home), source: 'startup' },
        enrollment: '1',
        launchSession: 'launch-id',
      },
      {
        event: 'preToolUse',
        payload: {
          sessionId: 'launch-id',
          cwd: fs.realpathSync(home),
          toolName: 'view',
          toolArgs: { path: 'example.ts' },
        },
        enrollment: '1',
        launchSession: 'launch-id',
      },
      {
        event: 'sessionEnd',
        payload: { sessionId: 'launch-id', cwd: fs.realpathSync(home), reason: 'user_exit' },
        enrollment: '1',
        launchSession: 'launch-id',
      },
    ]);
    expect(
      JSON.parse(fs.readFileSync(path.join(home, '.copilot-mock', 'scenario-queue.json'), 'utf8')),
    ).toEqual([]);
  });

  it('runs harmlessly without an installed hook file', async () => {
    queue([]);
    expect(await run()).toMatchObject({ code: 0, stderr: '' });
    expect(fs.existsSync(path.join(home, '.copilot', 'hooks'))).toBe(false);
  });

  it('reports a bridge failure instead of silently succeeding', async () => {
    installRecordingBridge();
    fs.writeFileSync(
      path.join(home, '.pixel-agents', 'hooks', 'copilot-hook.js'),
      'process.exit(2);',
    );
    queue([]);
    const result = await run();
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Hook sessionStart failed (2)');
  });
});
