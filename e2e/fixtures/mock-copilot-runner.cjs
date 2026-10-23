#!/usr/bin/env node

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_HOLD_OPEN_MS = 30_000;
const home = os.homedir();
const mockRoot = path.join(home, '.copilot-mock');
const queuePath = path.join(mockRoot, 'scenario-queue.json');
const args = process.argv.slice(2);
const sessionOption = args.includes('--resume') ? '--resume' : '--session-id';
const sessionId = args[args.indexOf(sessionOption) + 1];
const cwd = process.cwd();
const startedAt = Date.now();
let ending = false;

function log(file, line) {
  fs.mkdirSync(mockRoot, { recursive: true });
  fs.appendFileSync(path.join(mockRoot, file), `${line}\n`);
}

function resolveValue(value) {
  if (typeof value === 'string') {
    return value.replace(
      /\{\{(sessionId|cwd|home)\}\}/g,
      (_, key) => ({ sessionId, cwd, home })[key],
    );
  }
  if (Array.isArray(value)) return value.map(resolveValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, resolveValue(nested)]),
    );
  }
  return value;
}

async function emitHook(payload) {
  const { hook_event_name: event, ...data } = resolveValue(payload);
  const hookFile = path.join(
    process.env.COPILOT_HOME || path.join(home, '.copilot'),
    'hooks',
    'pixel-agents.json',
  );
  if (!fs.existsSync(hookFile)) return;
  const config = JSON.parse(fs.readFileSync(hookFile, 'utf8'));
  for (const hook of config.hooks?.[event] || []) {
    // Only invoke the installed bridge, never unrelated hooks or a real CLI.
    const hookArgs = hook.args;
    const script = path.join(home, '.pixel-agents', 'hooks', 'copilot-hook.js');
    if (hook.type !== 'command' || !Array.isArray(hookArgs) || hookArgs[0] !== script) continue;
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, hookArgs, {
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        // First hook spawn pays a Node cold-start cost that can spike under CI
        // load; the bridge itself enforces its own delivery timeout.
        timeout: 30_000,
      });
      let stderr = '';
      child.stderr.on('data', (chunk) => (stderr += chunk.toString()));
      child.once('error', reject);
      child.once('close', (code) =>
        code === 0 && !stderr
          ? resolve()
          : reject(new Error(`Hook ${event} failed (${code}): ${stderr}`)),
      );
      child.stdin.end(JSON.stringify({ sessionId, cwd, ...data }));
    });
  }
  log('actions.log', `${Date.now() - startedAt} ${event}`);
  process.stdout.write(`[mock-copilot] ${event}\n`);
}

async function finish(code = 0) {
  if (ending) return;
  ending = true;
  await emitHook({ hook_event_name: 'sessionEnd', reason: 'user_exit' });
  process.exit(code);
}

async function main() {
  if (!args.includes(sessionOption) || !sessionId) throw new Error('Mock requires --session-id or --resume');
  const stateDirectory = path.join(process.env.COPILOT_HOME || path.join(home, '.copilot'), 'session-state', sessionId);
  fs.mkdirSync(stateDirectory, { recursive: true });
  const eventsPath = path.join(stateDirectory, 'events.jsonl');
  if (!fs.existsSync(eventsPath)) {
    fs.writeFileSync(eventsPath, `${JSON.stringify({ type: 'session.start', data: { context: { cwd } } })}\n`);
  }
  let queue = [];
  if (fs.existsSync(queuePath)) queue = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
  const scenario = queue.shift() || { schemaVersion: 1, autoInit: true, actions: [] };
  if (scenario.schemaVersion !== 1) throw new Error('Unsupported mock scenario version');
  fs.mkdirSync(mockRoot, { recursive: true });
  fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2));
  log(
    'invocations.log',
    `${new Date().toISOString()} session-id=${sessionId} cwd=${cwd} pid=${process.pid} args=${args.join(' ')}`,
  );
  process.stdout.write(`mock copilot session ${sessionId}\n`);
  process.on('SIGTERM', () => void finish());
  process.on('SIGINT', () => void finish());
  if (scenario.autoInit !== false) {
    await emitHook({ hook_event_name: 'sessionStart', source: sessionOption === '--resume' ? 'resume' : 'startup' });
  }
  for (const action of scenario.actions || []) {
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, action.atMs - (Date.now() - startedAt))),
    );
    if (ending) return;
    if (action.kind === 'emitHook') await emitHook(action.payload);
    else if (action.kind === 'exit') return finish(action.code || 0);
    else throw new Error(`Unsupported mock action: ${action.kind}`);
  }
  const remaining = Math.max(
    0,
    (scenario.holdOpenMs ?? DEFAULT_HOLD_OPEN_MS) - (Date.now() - startedAt),
  );
  await new Promise((resolve) => setTimeout(resolve, remaining));
  await finish();
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exit(1);
});
