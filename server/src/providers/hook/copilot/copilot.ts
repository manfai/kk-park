import type { HookProvider } from '../../../../../core/src/provider.js';
import { BASH_COMMAND_DISPLAY_MAX_LENGTH } from '../../../constants.js';
import {
  COPILOT_DISPLAY_NAME,
  COPILOT_LAUNCH_SESSION_ENV,
  COPILOT_PROVIDER_ID,
  COPILOT_TRACKING_ENV,
} from './constants.js';
import { areHooksInstalled, installHooks, uninstallHooks } from './copilotHookInstaller.js';
import { discoverSessions } from './copilotSessions.js';

const readingTools = new Set(['view', 'grep', 'rg', 'glob', 'web_fetch', 'web_search']);

export const copilotProvider: HookProvider = {
  kind: 'hook',
  id: COPILOT_PROVIDER_ID,
  displayName: COPILOT_DISPLAY_NAME,
  protocolVersion: 1,
  installHooks,
  uninstallHooks,
  areHooksInstalled,
  discoverSessions,
  consentDisclosure: () => ({
    headline: 'Show your Copilot CLI agents live?',
    disclosure:
      'Pixel Agents will add its own pixel-agents.json file to your Copilot user hooks directory (~/.copilot/hooks, or $COPILOT_HOME/hooks). Existing hook files are not changed. Restart existing Copilot CLI sessions after installation.\n\n' +
      'A local script reports session IDs, working directories, tool names and short activity labels to Pixel Agents on this machine. Prompt text, tool results and full conversations are not forwarded. These hooks observe only: they do not approve tools or change Copilot permissions.\n\n' +
      'Only CLI processes started with PIXEL_AGENTS_COPILOT=1 report activity. The office sets this when launching Copilot; other CLI sessions can opt in with that environment variable. Native Copilot Chat is not enrolled. Turn off Instant Detection in Settings to remove our hook file. Copilot CLI requires hooks for activity tracking; there is no transcript fallback.',
  }),
  readingTools,
  subagentToolNames: new Set(),
  terminalNamePrefix: COPILOT_DISPLAY_NAME,
  buildLaunchCommand: (sessionId, _cwd, opts) => ({
    command: 'copilot',
    args: [
      opts?.resume ? '--resume' : '--session-id',
      sessionId,
      ...(opts?.bypassPermissions ? ['--allow-all-tools'] : []),
    ],
    env: {
      [COPILOT_TRACKING_ENV]: '1',
      [COPILOT_LAUNCH_SESSION_ENV]: opts?.runtimeId ?? sessionId,
    },
  }),
  formatToolStatus: (name, input) => {
    const args = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
    const file = typeof args.path === 'string' ? args.path.split(/[\\/]/).pop() : '';
    if (name === 'view') return file ? `Reading ${file}` : 'Reading files';
    if (name === 'edit' || name === 'apply_patch' || name === 'create') {
      return file ? `Editing ${file}` : 'Editing files';
    }
    if (name === 'bash' || name === 'powershell') return 'Running command';
    if (readingTools.has(name)) return `Searching: ${name}`;
    if (name === 'ask_user') return 'Waiting for your answer';
    return `Using ${name.slice(0, BASH_COMMAND_DISPLAY_MAX_LENGTH)}`;
  },
  normalizeHookEvent: (raw) => {
    const sessionId = raw.session_id;
    if (typeof sessionId !== 'string' || !sessionId) return null;
    // Subagent hooks share the parent's session ID. Until child routing is
    // supported, they must not finish or overwrite the parent's activity.
    if (raw.agentId || raw.agent_id) return null;
    switch (raw.hook_event_name) {
      case 'sessionStart':
        return {
          sessionId,
          event: {
            kind: 'sessionStart',
            source: typeof raw.source === 'string' ? raw.source : undefined,
            launchSessionId:
              typeof raw.launch_session_id === 'string' ? raw.launch_session_id : undefined,
            cwd: typeof raw.cwd === 'string' ? raw.cwd : undefined,
          },
        };
      case 'sessionEnd':
        return {
          sessionId,
          event: {
            kind: 'sessionEnd',
            reason: typeof raw.reason === 'string' ? raw.reason : undefined,
          },
        };
      case 'userPromptSubmitted':
        return { sessionId, event: { kind: 'turnStart' } };
      case 'preToolUse':
        if (typeof raw.tool_name !== 'string' || typeof raw.tool_use_id !== 'string') return null;
        return {
          sessionId,
          event: {
            kind: 'toolStart',
            toolId: raw.tool_use_id,
            toolName: raw.tool_name,
            input: raw.tool_input,
          },
        };
      case 'postToolUse':
      case 'postToolUseFailure':
        if (typeof raw.tool_use_id !== 'string') return null;
        return {
          sessionId,
          event: {
            kind: 'toolEnd',
            toolId: raw.tool_use_id,
            resumesTurn: raw.tool_name === 'ask_user',
          },
        };
      case 'agentStop':
        return { sessionId, event: { kind: 'turnEnd' } };
      case 'notification':
        if (raw.notification_type === 'permission_prompt')
          return { sessionId, event: { kind: 'permissionRequest' } };
        if (raw.notification_type === 'elicitation_dialog')
          return { sessionId, event: { kind: 'turnEnd', awaitingInput: true } };
        return null;
      default:
        return null;
    }
  },
};
