# Standalone terminal

The standalone adapter launches GitHub Copilot CLI in a server-side PTY and
streams it to an xterm pane in the browser. VS Code uses its own terminals.
Both adapters use the same hooks-driven runtime and office protocol.

## Launch and activity

The Directory drawer sends `launchAgent` with a Directory path. The standalone
launcher prepares the session ID, launches the provider's command through the PTY
manager, and enrolls it with `PIXEL_AGENTS_COPILOT=1`. The VS Code adapter
launches the same CLI in an editor terminal. No provider setting is needed.

Copilot user hooks report lifecycle, tool activity, permission requests, and
waiting-for-input notifications. There is no transcript scanner or heuristic
fallback. Child agents, teams, and token/context usage are not currently tracked.

Hook installation requires consent and writes the dedicated
`~/.copilot/hooks/pixel-agents.json` file (`COPILOT_HOME` overrides the Copilot
directory), plus `~/.pixel-agents/hooks/copilot-hook.js`. Other hook files are
preserved. The bridge needs `node` on the CLI's `PATH`. It does not intercept API
keys, transmit real prompt text, or auto-approve tools.

## Transport and access

Office messages use `/ws`; PTY input, output, resize, reconnect, and replay use
`/terminal/:agentId`. Both sockets apply the same standalone authorization
predicate: the bearer token and an allowed host name are required for control.
An unprivileged browser can only view the office, not launch agents or attach to
their terminals.

The CLI prints the token-bearing URL. Treat it as a secret. The token persists
across restarts so bookmarks can work; use a fixed `--port` for a stable address.
`--rotate-token` revokes old URLs. `--no-terminal` disables browser terminals and
launching. The loopback bind is the default; exposing a port requires a trusted
network or an explicitly configured secure proxy.

## Desktop and mobile

Desktop uses a right-docked drawer with agent cards as tabs. Every agent's pane
stays mounted so switching tabs does not discard terminal state.

Mobile keeps the office and terminal pages laid out in a sliding track. A shared
pane model manages the active agent and socket status. The keyboard viewport
logic distinguishes keyboard visibility from whether the shell needs clamping.
The key bar provides escape, shift+tab, slash, an arrow-key trackpad, and paste.

Touch scrolling, flicks, taps, long-press selection, and draggable selection
handles are pure state-machine decisions with thin DOM adapters. Detached-target
listeners preserve gestures when terminal rows repaint.

## Clipboard

All copies are verbatim: Cmd+C, Windows/Linux Ctrl+C or Ctrl+Shift+C, the browser's
Copy, and the mobile Copy pill. Ctrl+C with no selection remains an interrupt.
OSC 52 writes from the active pane use the browser clipboard without exposing
clipboard reads to the PTY.

Clipboard operations use `terminal/clipboard.ts`. Secure origins use the
Clipboard API; plain HTTP uses a copy-event fallback for writes and a native
prompt for paste.

## Validation

Use the standalone Playwright specs for browser-visible launch, terminal,
reconnect, clipboard, mobile, and read-only behavior. Tests use a mock Copilot
process and installed hooks, not real AI requests. Unit tests cover the pure
gesture, selection, clipboard, viewport, and card-order rules.

Build and run this checkout with `npm run build` then `node dist/cli.js`.
`npx pixel-agents` resolves a published package and does not test unpublished
local changes.
