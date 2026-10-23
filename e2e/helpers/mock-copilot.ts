import { type ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { getExternalNarrationLogPath } from './external-monitor';
import { ourHookEvents, waitForHookServer } from './hooks';
import { narrate } from './test-narration';

const DEFAULT_HOLD_OPEN_MS = 30_000;
const SETUP_TIMEOUT_MS = 20_000;
const SCENARIO_SCHEMA_VERSION = 1;

export interface CopilotMockAction {
  kind: 'emitHook' | 'exit';
  atMs: number;
  payload?: Record<string, unknown>;
  code?: number;
}

export interface CopilotMockScenario {
  schemaVersion: number;
  name?: string;
  autoInit: boolean;
  holdOpenMs: number;
  actions: CopilotMockAction[];
}

class TimedScenarioStepBuilder {
  constructor(
    private readonly scenario: CopilotMockScenarioBuilder,
    private readonly atMs: number,
  ) {}

  emitHook(payload: Record<string, unknown>): CopilotMockScenarioBuilder {
    this.scenario.pushAction({ kind: 'emitHook', atMs: this.atMs, payload });
    return this.scenario;
  }
}

export class CopilotMockScenarioBuilder {
  private autoInit = true;
  private holdOpenMs = DEFAULT_HOLD_OPEN_MS;
  private readonly actions: CopilotMockAction[] = [];

  constructor(private readonly name?: string) {}

  withoutAutoInit(): CopilotMockScenarioBuilder {
    this.autoInit = false;
    return this;
  }

  holdOpenFor(ms: number): CopilotMockScenarioBuilder {
    this.holdOpenMs = ms;
    return this;
  }

  at(ms: number): TimedScenarioStepBuilder {
    return new TimedScenarioStepBuilder(this, ms);
  }

  exitAt(ms: number, code = 0): CopilotMockScenarioBuilder {
    this.pushAction({ kind: 'exit', atMs: ms, code });
    return this;
  }

  pushAction(action: CopilotMockAction): void {
    this.actions.push(action);
  }

  build(): CopilotMockScenario {
    return {
      schemaVersion: SCENARIO_SCHEMA_VERSION,
      name: this.name,
      autoInit: this.autoInit,
      holdOpenMs: this.holdOpenMs,
      actions: [...this.actions].sort((a, b) => a.atMs - b.atMs),
    };
  }
}

export function copilotScenario(name?: string): CopilotMockScenarioBuilder {
  return new CopilotMockScenarioBuilder(name);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readTextIfExists(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

export async function waitForCopilotHookSetup(tmpHome: string): Promise<void> {
  await waitForHookServer(tmpHome);
  const hookPath = path.join(tmpHome, '.pixel-agents', 'hooks', 'copilot-hook.js');
  const deadline = Date.now() + SETUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (fs.existsSync(hookPath) && ourHookEvents(tmpHome).includes('sessionStart')) return;
    await sleep(250);
  }
  throw new Error(`Timed out waiting for Copilot hook setup under ${tmpHome}`);
}

export async function arrangeNextCopilotInvocation(
  tmpHome: string,
  scenario: CopilotMockScenario,
): Promise<void> {
  const queuePath = path.join(tmpHome, '.copilot-mock', 'scenario-queue.json');
  const queue = JSON.parse(readTextIfExists(queuePath) || '[]') as CopilotMockScenario[];
  queue.push(scenario);
  fs.mkdirSync(path.dirname(queuePath), { recursive: true });
  fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2));
}

export function applyMockHomeEnv(base: NodeJS.ProcessEnv, tmpHome: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...base,
    HOME: tmpHome,
    USERPROFILE: tmpHome,
    COPILOT_HOME: path.join(tmpHome, '.copilot'),
  };
  delete env.HOMEDRIVE;
  delete env.HOMEPATH;
  return env;
}

const trackedExternalProcesses = new Set<ChildProcess>();

export async function killTrackedExternalProcesses(): Promise<void> {
  await Promise.all(
    [...trackedExternalProcesses].map(
      (child) =>
        new Promise<void>((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) return resolve();
          child.once('exit', () => resolve());
          child.kill('SIGTERM');
        }),
    ),
  );
  trackedExternalProcesses.clear();
}

export async function spawnExternalCopilotScenario(options: {
  tmpHome: string;
  workspaceDir: string;
  mockLogFile: string;
  scenario: CopilotMockScenario;
  sessionId: string;
}): Promise<{ process: ChildProcess; sessionId: string }> {
  narrate.step('spawning an enrolled external mock session for adoption');
  await arrangeNextCopilotInvocation(options.tmpHome, options.scenario);
  const binaryName = process.platform === 'win32' ? 'copilot.cmd' : 'copilot';
  const binDir = fs.existsSync(path.join(options.tmpHome, 'mock-bin'))
    ? path.join(options.tmpHome, 'mock-bin')
    : path.resolve(options.tmpHome, '..', 'bin');
  const narrationLog = getExternalNarrationLogPath(options.tmpHome);
  fs.mkdirSync(path.dirname(narrationLog), { recursive: true });
  const fd = fs.openSync(narrationLog, 'a');
  const child = spawn(path.join(binDir, binaryName), ['--session-id', options.sessionId], {
    cwd: options.workspaceDir,
    env: {
      ...applyMockHomeEnv(process.env, options.tmpHome),
      PIXEL_AGENTS_NODE_BIN: process.execPath,
      PIXEL_AGENTS_COPILOT: '1',
      PIXEL_AGENTS_COPILOT_SESSION_ID: options.sessionId,
    },
    shell: process.platform === 'win32',
    stdio: ['ignore', fd, 'pipe'],
  });
  fs.closeSync(fd);
  trackedExternalProcesses.add(child);
  child.once('exit', () => trackedExternalProcesses.delete(child));
  let stderr = '';
  let spawnError: Error | undefined;
  child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  child.once('error', (error) => (spawnError = error));
  const deadline = Date.now() + SETUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    if (readTextIfExists(options.mockLogFile).includes(`session-id=${options.sessionId}`)) {
      return { process: child, sessionId: options.sessionId };
    }
    if (child.exitCode !== null) throw new Error(`Mock Copilot exited early: ${stderr}`);
    await sleep(100);
  }
  throw new Error(`Timed out waiting for mock Copilot ${options.sessionId}: ${stderr}`);
}
