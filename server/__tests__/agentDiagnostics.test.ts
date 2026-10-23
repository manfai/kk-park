import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildAgentDiagnostics } from '../src/agentDiagnostics.js';
import { createAgentState } from '../src/agentState.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { newTestDirectory } from './testSupport.js';

describe('buildAgentDiagnostics', () => {
  let directory: string;
  let store: AgentStateStore;

  beforeEach(() => {
    directory = newTestDirectory('diagnostics-');
    store = new AgentStateStore();
  });

  afterEach(() => {
    store.dispose();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('reports the exact hooks-only diagnostic shape and working directory existence', () => {
    store.set(
      7,
      createAgentState({
        id: 7,
        sessionId: 'diagnostics-session',
        isExternal: true,
        projectDir: directory,
        lastDataAt: 1_700_000_000_000,
        hookDelivered: true,
      }),
    );
    expect(buildAgentDiagnostics(store)).toEqual([
      {
        id: 7,
        projectDir: directory,
        projectDirExists: true,
        lastDataAt: 1_700_000_000_000,
        hookDelivered: true,
      },
    ]);
  });

  it('preserves the never-received timestamp and reports a missing directory', () => {
    const missing = path.join(directory, 'missing');
    store.set(
      1,
      createAgentState({
        id: 1,
        sessionId: 'never',
        isExternal: false,
        projectDir: missing,
      }),
    );
    expect(buildAgentDiagnostics(store)).toEqual([
      {
        id: 1,
        projectDir: missing,
        projectDirExists: false,
        lastDataAt: 0,
        hookDelivered: false,
      },
    ]);
  });

  it('returns an independent entry for every agent', () => {
    for (const id of [1, 2]) {
      store.set(
        id,
        createAgentState({
          id,
          sessionId: `session-${id}`,
          isExternal: false,
          projectDir: directory,
        }),
      );
    }
    expect(buildAgentDiagnostics(store).map((entry) => entry.id)).toEqual([1, 2]);
  });
});
