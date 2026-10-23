# Contributor instructions

Pixel Agents represents GitHub Copilot CLI sessions as characters in a pixel-art
office. This fork supports Copilot CLI only, in VS Code terminals and a standalone
browser office. Read [CONTEXT.md](CONTEXT.md) first and use its canonical vocabulary.
See [CONTRIBUTING.md](CONTRIBUTING.md) for the full contribution workflow.

## Architecture

- `core/`: shared contracts and interfaces; no runtime side effects or dependencies
  on other application layers.
- `server/`: Fastify HTTP/WebSocket server, hooks-only `AgentRuntime`,
  `AgentStateStore`, persistence, Copilot provider, and standalone CLI. Depends only
  on `core/` among application layers.
- `webview-ui/`: React and Canvas office, editor, mobile shell, and browser
  terminals. Depends only on `core/` among application layers.
- `adapters/vscode/`: editor terminals and webview bridge; composes `core/` and
  `server/`. The standalone CLI must never import this adapter.

The runtime normalizes and dispatches Copilot hook events directly. There are no
transcript scanners, heuristic activity detection, server teams, child-agent
tracking, or context-usage producers. Generic team/context protocol variants and
UI handlers remain dormant; do not advertise them as Copilot features.

Session identity is immutable and separate from a CLI process or terminal binding.
Unnamed sessions stay archived, including new and running sessions. Only a local
character name makes a session visible; clearing it hides the character without
stopping its process or renaming the Copilot conversation. Keep offline records,
character IDs, appearance, and seats when resuming an exact session. Never focus an
unrelated terminal as a fallback. Names and seats are adapter-local.

Archiving a named character is separate from clearing its name: confirm first,
persist its archive flag, stop only its exact managed CLI, and confine it inside the
nearest reachable empty placed Jail Cage. Reserve one entire cage per character,
including while walking there. Keep its name/history and standing pose behind bars,
including across reloads; hook activity must not unpark it. Unnamed sessions stay
hidden. External terminals are never stopped. Missing or full cages must be explicit
and must prevent Archive. Restore/resume releases the cage.

History discovery reads only initialization metadata from the first record of
Copilot's session files; never import prompts, results, titles, or infer activity
from transcripts. Archived catalogues and all session mutations are privileged.

Hook installation requires consent and owns only
`~/.copilot/hooks/pixel-agents.json` (`COPILOT_HOME` overrides the Copilot directory)
and the bridge `~/.pixel-agents/hooks/copilot-hook.js`. Preserve other hook files
and refuse conflicting owned files. Office launches enroll automatically with
`PIXEL_AGENTS_COPILOT=1`; external CLI processes must opt in. Native Copilot Chat
is not integrated. Do not transmit real prompts, intercept API keys, auto-approve
tools, or widen sandbox permissions.

## Protocol and code changes

- `core/asyncapi.yaml` is the AsyncAPI 3.0 source of truth. Change it and run
  `npm run asyncapi:generate`; never hand-edit `core/src/messages.ts`.
- Run `npm run asyncapi:validate` for contract changes. Commit regenerated bindings
  with the schema; CI rejects generation drift.
- Preserve layering and use typed store mutations and the existing transport
  abstraction rather than adding adapter-specific runtime or UI paths.
- Use `import type` for type-only imports and `.js` relative import extensions in
  server and adapter code. Webview TypeScript forbids enums; use `as const`.
- Centralize constants in the corresponding layer's `constants.ts`; use CSS
  variables for UI colors. Follow the pixel aesthetic: square corners, solid
  borders, hard shadows, and FS Pixel Sans.
- Keep changes focused, preserve generic office/editor/terminal behavior, and add
  focused regression tests for changed behavior.

## Commands

Use Node.js 24 for local development. Install dependencies once at the repository
root; npm workspaces cover `server` and `webview-ui`.

```bash
npm install
npm run build
node dist/cli.js
npm run check-types
npm run lint
npm run test:webview
npm run test:server
npm run test:package-contract
```

`npm run watch` watches esbuild and backend types, not the Vite webview. Use
`npm run dev -w webview-ui` separately for the browser asset preview.
`npx pixel-agents` runs the published package, not unpublished local changes.

## Testing safety

- Never make real AI requests or invoke the real Copilot CLI in automated tests.
  Use the isolated mock Copilot process and fixture-owned settings; never modify
  personal hook files, credentials, or sessions.
- Read [e2e/README.md](e2e/README.md), especially “Mocking model & rules,” before
  authoring end-to-end tests. The mock process executes installed hook entries;
  assert browser-visible outcomes instead of injecting runtime state.
- Build once before end-to-end validation. Prefer the headless standalone suite:
  `npm run e2e -- e2e/tests/standalone --workers=1`.
- **Obtain explicit approval before running VS Code Electron tests locally.**
  They open real windows and steal keyboard focus. Never run them from a subagent.
- After changing the end-to-end inventory, run `npm run e2e:inventory` and commit
  the generated `e2e/README.md` changes.
- Run the smallest relevant checks. Documentation-only changes need no runtime
  tests. Report exact commands and results, including anything not run.
