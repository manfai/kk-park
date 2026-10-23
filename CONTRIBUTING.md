# Contributing to Pixel Agents

Thanks for your interest in contributing to Pixel Agents! All contributions are welcome — features, bug fixes, documentation improvements, refactors, and more.

This project is licensed under the [MIT License](LICENSE), so your contributions will be too. No CLA or DCO is required.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 24 for local builds and tests
- [VS Code](https://code.visualstudio.com/) (v1.105.0 or later)

### Setup

```bash
git clone https://github.com/pixel-agents-hq/pixel-agents.git
cd pixel-agents
npm install
npm run build
```

Then press **F5** in VS Code to launch the Extension Development Host.

To run the standalone office from this checkout instead:

```bash
node dist/cli.js
```

This fork supports GitHub Copilot CLI only. `npx pixel-agents` uses the published
package, not unpublished changes in your checkout. No provider setting is needed.
Read [AGENTS.md](AGENTS.md) for contributor instructions and
[CONTEXT.md](CONTEXT.md) for the canonical project vocabulary.

### Build and install the packaged extension locally

If you want to test the extension the same way end users install it, build a `.vsix` package and install it through the VS Code CLI:

```bash
npx @vscode/vsce package --allow-star-activation --out pixel-agents-local.vsix
code --install-extension ./pixel-agents-local.vsix --force
```

`--force` updates the existing local install with your freshly built package.

If you are using Remote SSH, WSL, or a dev container, `code --install-extension` installs the extension into that current VS Code target.

After installing the `.vsix`, run **Developer: Reload Window** in VS Code to load the updated extension.

### Verify the npm package locally

The npm artifact has its own gate because source-level tests cannot detect a missing tarball file or a package-relative path bug:

```bash
npm run test:package-contract
npm run verify:npm-package
```

The verifier runs the production `prepack` build, creates a tarball outside the repository, installs that exact tarball into an isolated project, and exercises CLI help, the health endpoint, the standalone SPA, bundled assets, and consent-gated Copilot hook setup. Its files and child server are removed automatically; it never publishes to npm or invokes real AI requests.

### Maintainer release checklist

A published GitHub Release coordinates publishing to the VS Code Marketplace, Open VSX, and npm through [`.github/workflows/publish-extension.yml`](.github/workflows/publish-extension.yml). Publishing is release-driven, not triggered by a push to `main` alone.

One-time npm setup: configure the `pixel-agents` package's GitHub Actions [trusted publisher](https://docs.npmjs.com/trusted-publishers/) for `pixel-agents-hq/pixel-agents`, workflow `publish-extension.yml`, no environment, and allow `npm publish`.
The GitHub-hosted workflow enforces Node >=22.14.0 and npm >=11.5.1 and uses OIDC (`id-token: write`); do not configure a long-lived publish token, and revoke any unused one.

For each release:

1. Update `CHANGELOG.md`, then set the same new version in the root `package.json` and both root-version fields in `package-lock.json`. The private workspace manifests are not released and do not receive the extension version.
2. Run `npm ci`, `npm test`, and `npm run verify:npm-package`. Inspect the generated package if needed by manually dispatching **Publish Extension** in dry-run mode and downloading its `npm-package-*` artifact; manual dispatch never publishes to npm.
3. Merge the release changes into `main` and wait for CI to pass.
4. Create and publish a GitHub Release whose tag is exactly `v<package.json version>` and points to that commit on `main` (for example, `v1.4.0`). The npm job rejects a mismatched tag, ref, package identity, non-incrementing version, or changed tarball integrity.
5. Confirm the Marketplace, Open VSX, and npm jobs succeeded, and verify the new npm version with `npm view pixel-agents version`.

## Development Workflow

For development with live rebuilds, run:

```bash
npm run watch
```

This starts parallel watchers for both the extension backend (esbuild) and TypeScript type-checking.

> **Note:** The webview (Vite) is not included in `watch` — after changing webview code, run `npm run build:webview` or the full `npm run build`.

## Running the Mocked Pixel Agent

You can run the mocked Pixel Agent web app either from the CLI or from VS Code tasks.

### Option 1: CLI

From the repository root:

```bash
npm run dev -w webview-ui
```

Vite will print a local URL (typically `http://localhost:5173`) where the mocked app is available.

### Option 2: VS Code Run Task

1. Open the command palette and run **Tasks: Run Task**.
2. Select **Mocked Pixel Agent Dev Server**.
3. Open the local URL shown in the task terminal output (typically `http://localhost:5173`).

### Project Structure

Pixel Agents uses a layered codebase. `core/` depends on nothing; `server/` and `webview-ui/` depend only on `core/`; `adapters/vscode/` depends on `core/` and `server/`.

- **`core/`**: AsyncAPI 3.0 protocol, provider, transport, and adapter contracts.
  Zero runtime side effects.
- **`server/`**: hooks-only `AgentRuntime`, `AgentStateStore`, Fastify HTTP/WS
  server, persistence, Copilot provider and installer, standalone CLI, and Vitest
  tests.
- **`adapters/vscode/`**: VS Code terminals, webview bridge, and state migration.
  Composes `core/` and `server/`.
- **`webview-ui/`**: React 19 + Canvas office, layout editor, mobile shell, and
  terminal panes. Depends only on `core/`.
- **`webview-ui/public/assets/`**: bundled sprites, furniture catalog, default
  layout, and fonts.
- **`scripts/`**: protocol generation, build/CI, test reports, inventory generation,
  and asset tooling.
- **`e2e/`**: Playwright fixtures, mock Copilot process, VS Code specs, and headless
  standalone browser specs.
- **`eslint-rules/`**: custom pixel-style rules enforced project-wide.

The repo uses **npm workspaces** (`server`, `webview-ui` declared in the root `package.json`). A single `npm install` at the root installs dependencies for all workspaces; no nested `cd ... && npm install` is needed.

## Copilot Hook Integration

The runtime normalizes and dispatches Copilot CLI hooks directly into the shared
state store. There is no transcript scanning or heuristic fallback. Copilot child
agents, teams, and context usage are not tracked; generic protocol/UI support for
those concepts remains dormant.

Installation requires consent and creates the dedicated
`~/.copilot/hooks/pixel-agents.json` file (`COPILOT_HOME` is honored) and the bridge
`~/.pixel-agents/hooks/copilot-hook.js`. Existing hook files must be preserved.
The bridge needs `node` on the CLI's `PATH`.

Office launches set `PIXEL_AGENTS_COPILOT=1` automatically. External CLI processes
must opt in with that environment variable, and other workspaces require **Watch
All Sessions**. Native Copilot Chat is not integrated. Hooks do not transmit real
prompt text, intercept API keys, or auto-approve tools.

For automated validation, use fixture-owned hooks and the mock Copilot process.
Never make real AI requests or change personal settings, hook files, or sessions.

## Code Guidelines

### Constants

**No unused locals or parameters** (`noUnusedLocals` and `noUnusedParameters` are enabled). All magic numbers and strings are centralized — don't add inline constants to source files:

- **Shared backend constants:** `server/src/constants.ts` (imported by `adapters/vscode/` too)
- **VS Code-only IDs / command names:** `adapters/vscode/constants.ts`
- **Protocol-level constants:** `core/src/constants.ts`
- **Webview:** `webview-ui/src/constants.ts` (grid, animation, rendering, camera, zoom, editor, canvas overlay rgba strings)
- **CSS variables:** `webview-ui/src/index.css` `:root` block (`--pixel-*` properties for React inline styles and CSS)

### UI Styling

The project uses a pixel art aesthetic. All overlays should use:

- Sharp corners (`border-radius: 0`)
- Solid backgrounds and `2px solid` borders
- Hard offset shadows (`2px 2px 0px`, no blur) — use `var(--pixel-shadow)`
- The FS Pixel Sans font (loaded in `index.css`)

These conventions are enforced by custom ESLint rules (`eslint-rules/pixel-agents-rules.mjs`):

| Rule               | Scope               | What it checks                                              |
| ------------------ | ------------------- | ----------------------------------------------------------- |
| `no-inline-colors` | Extension + Webview | No hex/rgb/rgba/hsl/hsla literals outside `constants.ts`    |
| `pixel-shadow`     | Webview only        | Box shadows must use `var(--pixel-shadow)` or `2px 2px 0px` |
| `pixel-font`       | Webview only        | Font family must reference FS Pixel Sans                    |

These rules are set to `error` and will block your PR if violated.

## Unit & Integration Tests

```bash
# Run all tests (webview + server)
npm test

# Run only server tests (Vitest)
npm run test:server

# Run only webview tests
npm run test:webview
```

Server tests cover hook-driven lifecycle and activity, typed state mutations,
namespaced persistence, consent and hook-file ownership, the Copilot provider and
bridge, HTTP/WebSocket authorization, standalone launches, and VS Code adapter
behavior. Webview tests cover pure office, editor, gesture, selection, clipboard,
viewport, and card-order behavior.

Spawned bridge tests need `dist/hooks/copilot-hook.js`; run `npm run build` first
when validating hook bundle changes. `npm test` runs tests but does not build.

## End-to-End Tests

The `e2e/` directory contains Playwright tests against a standalone browser office
and a real VS Code Electron instance with the development extension.

**Get explicit approval before running VS Code Electron tests locally.** They open
real windows and steal keyboard focus. Never run them from a subagent. Use
headless standalone specs for unattended validation.

### Running e2e tests locally

```bash
# Build the extension first (tests load the compiled output)
npm run build

# Headless standalone browser tests (no real editor windows)
npm run e2e -- e2e/tests/standalone --workers=1

# Full suite: run only after explicit approval for VS Code Electron windows
npm run e2e -- --workers=1

# Step-by-step debug mode
npm run e2e:debug

# Keep and attach videos even for successful tests
npm run e2e -- --attach-videos-on-success

# Combine debugger + success-case videos
npm run e2e:debug -- --attach-videos-on-success
```

On the first run, `@vscode/test-electron` will download a stable VS Code release into `.vscode-test/` (≈200 MB). Subsequent runs reuse the cache.

### Artifacts

All test artifacts are written to `test-results/e2e/`:

| Path                                   | Contents                                                                    |
| -------------------------------------- | --------------------------------------------------------------------------- |
| `test-results/e2e/videos/<test-name>/` | `.webm` screen recording for failed tests, or all tests with the debug flag |
| `playwright-report/e2e/`               | Playwright HTML report (`npx playwright show-report playwright-report/e2e`) |
| `test-results/e2e/*.png`               | Final screenshots saved on failure                                          |

By default, successful tests discard their videos after teardown. Pass `--attach-videos-on-success` when you need success-case recordings attached to the report for debugging.

### Mock Copilot

Tests never invoke the real Copilot CLI or make AI requests. The mock Copilot
wrapper runs in an isolated `bin/` directory on the fixture's `PATH`. Its scenario
runner simulates lifecycle, tool, permission, and waiting events by executing the
installed `COPILOT_HOME/hooks/pixel-agents.json` entries with documented camelCase
payloads. This exercises the real bridge and hook ingress instead of bypassing
them with UI state injection. No transcript files are involved.

Each test runs with an isolated `HOME`, workspace directory, VS Code `--user-data-dir`, and mock log file — no state leaks between runs or into your real VS Code profile.

For the normative process-boundary model, installed-hook rules, visible-outcome
assertions, and standalone-server exception, read
[`e2e/README.md` → "Mocking model & rules"](e2e/README.md#mocking-model--rules)
before authoring tests.

### E2E test naming

Tests use behavioral sentences with `@area:<tag>` tags for grouping. Use the
current inventory in `e2e/README.md` for supported areas. Example:

```typescript
test('a launched agent becomes active when its tool starts', { tag: '@area:standalone' }, ...);
```

The auto-generated test inventory in `e2e/README.md` groups tests by `@area:` tag. After adding or removing tests, run `npm run e2e:inventory` to regenerate — CI fails if it drifts.

## Submitting a Pull Request

1. Fork the repo and create a feature branch from `main`
2. Make your changes
3. Verify everything passes locally:
   ```bash
   npm run lint                         # core + server + adapters + webview lint
   npm run check-types                  # TypeScript strict check across all packages
   npm run asyncapi:validate            # AsyncAPI spec validation
   npm run asyncapi:generate            # Regen core/src/messages.ts (must produce no git diff)
   npm run e2e:inventory                # Regen e2e/README.md (must produce no git diff)
   npm run build                        # esbuild (extension + CLI + hooks) + Vite (webview)
   npm test                             # Server vitest + webview vitest
   npm run e2e -- e2e/tests/standalone --workers=1 # Headless browser specs
   ```
   Run the full `npm run e2e -- --workers=1` suite locally only with explicit
   approval for VS Code Electron windows. CI runs the full checks automatically.
   The AsyncAPI and e2e inventory drift checks fail on generated differences —
   regenerate and commit results when changing their sources.
4. Open a pull request against `main` with:
   - A **conventional commit PR title** (e.g. `feat: add zoom controls`, `fix: character freezing on terminal close`, `refactor: extract pathfinding module`). CI enforces this format — see [Conventional Commits](https://www.conventionalcommits.org/).
   - A clear description of what changed and why
   - How you tested the changes (steps to reproduce / verify)
   - **Screenshots or GIFs for any UI changes**

> **Note:** PRs are merged using **squash and merge** — all commits in your PR are combined into a single commit on `main`. Your PR title becomes the commit message, which is why the conventional commit format matters.

## Reporting Bugs

[Open a bug report](https://github.com/pixel-agents-hq/pixel-agents/issues/new?template=bug_report.yml) — the form will guide you through providing the details we need.

## Feature Requests

Have an idea? [Open a feature request](https://github.com/pixel-agents-hq/pixel-agents/issues/new?template=feature_request.yml) — the form will guide you through describing the problem and your proposed solution. You can also browse and join ongoing conversations in [Discussions](https://github.com/pixel-agents-hq/pixel-agents/discussions).

## Security Issues

Please report security vulnerabilities privately — see [SECURITY.md](SECURITY.md) for details.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.
