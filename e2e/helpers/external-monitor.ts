import path from 'path';

/**
 * External mock-copilot sessions are detached processes Pixel Agents ADOPTS
 * (never launches), so unlike internal agents they have no terminal of their
 * own. Their stdout (magenta `[external·tag]` narration) is appended to a
 * per-test log by spawnExternalCopilotScenario (see helpers/mock-copilot.ts).
 *
 * That log is surfaced by the always-on "e2e monitor" terminal the fixture
 * opens (see helpers/test-narration.ts → openMonitorTerminal), which tails both
 * this external log and the test-narration log. There is no longer a separate,
 * lazily-opened external-monitor terminal — this module now only owns the log
 * path both sides agree on.
 */
export function getExternalNarrationLogPath(tmpHome: string): string {
  return path.join(tmpHome, '.copilot-mock', 'external-narration.log');
}
