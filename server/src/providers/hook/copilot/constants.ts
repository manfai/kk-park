export const COPILOT_PROVIDER_ID = 'copilot';
export const COPILOT_DISPLAY_NAME = 'GitHub Copilot CLI';
export const COPILOT_HOOK_FILE = 'pixel-agents.json';
export const COPILOT_HOOK_SCRIPT = 'copilot-hook.js';
export const COPILOT_HOOK_TIMEOUT_SECONDS = 5;
export const COPILOT_DELIVERY_TIMEOUT_MS = 1000;
export const COPILOT_HOOK_INPUT_LIMIT_BYTES = 10 * 1024 * 1024;
export const COPILOT_TRACKING_ENV = 'PIXEL_AGENTS_COPILOT';
export const COPILOT_LAUNCH_SESSION_ENV = 'PIXEL_AGENTS_COPILOT_SESSION_ID';
export const COPILOT_HOOK_EVENTS = [
  'sessionStart',
  'sessionEnd',
  'userPromptSubmitted',
  'preToolUse',
  'postToolUse',
  'postToolUseFailure',
  'agentStop',
  'notification',
] as const;
