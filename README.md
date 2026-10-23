<h1 align="center">
  <a href="https://github.com/pixel-agents-hq/pixel-agents/discussions">
    <img src="webview-ui/public/banner.png" alt="Pixel Agents">
  </a>
</h1>

<h2 align="center">The most playful way to orchestrate your agents</h2>

<div align="center">

[![version](https://img.shields.io/endpoint?url=https%3A%2F%2Fgist.githubusercontent.com%2Fpablodelucca%2F3cd28398fa4a2c0a636e1d51d41aee39%2Fraw%2Fversion.json)](https://github.com/pixel-agents-hq/pixel-agents/releases)
[![marketplaces](https://img.shields.io/endpoint?url=https%3A%2F%2Fgist.githubusercontent.com%2Fpablodelucca%2F3cd28398fa4a2c0a636e1d51d41aee39%2Fraw%2Finstalls.json)](https://marketplace.visualstudio.com/items?itemName=pablodelucca.pixel-agents)
[![npm downloads](https://img.shields.io/endpoint?url=https%3A%2F%2Fgist.githubusercontent.com%2Fpablodelucca%2F3cd28398fa4a2c0a636e1d51d41aee39%2Fraw%2Fnpm-downloads.json)](https://www.npmjs.com/package/pixel-agents)
[![stars](https://img.shields.io/github/stars/pixel-agents-hq/pixel-agents?logo=github&color=0183ff&style=flat)](https://github.com/pixel-agents-hq/pixel-agents/stargazers)
[![license](https://img.shields.io/github/license/pixel-agents-hq/pixel-agents?color=0183ff&style=flat)](https://github.com/pixel-agents-hq/pixel-agents/blob/main/LICENSE)
[![discord](https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white&style=flat)](https://discord.gg/Yk7jXebv9H)

</div>

<div align="center">
<a href="https://marketplace.visualstudio.com/items?itemName=pablodelucca.pixel-agents">🛒 VS Code Marketplace</a> • <a href="https://open-vsx.org/extension/pablodelucca/pixel-agents">🛒 Open VSX</a> • <a href="https://www.npmjs.com/package/pixel-agents">📦 npm</a> • <a href="https://discord.gg/Yk7jXebv9H">👾 Discord</a> • <a href="https://github.com/pixel-agents-hq/pixel-agents/discussions">💬 Discussions</a> • <a href="CONTRIBUTING.md">🤝 Contributing</a> • <a href="CHANGELOG.md">📋 Changelog</a>
</div>

<br/>

Pixel Agents turns the AI coding agents running in your terminals into animated pixel-art characters working in a tiny office. They walk to their desks, sit down, type when they're editing files, read when they're searching, and flag you visually when they're stuck waiting for input.

It ships in two forms from the same codebase:

- **VS Code extension** — [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=pablodelucca.pixel-agents) and [Open VSX](https://open-vsx.org/extension/pablodelucca/pixel-agents). Agents launch into VS Code terminals; characters render in the panel area.
- **Standalone CLI** — starts a local server and serves the same office as a browser app, useful for remote and non-VS Code workflows.

This source tree integrates **GitHub Copilot CLI** through a typed `HookProvider` boundary. Follow the local build instructions below to use these changes; published npm packages and Marketplace releases may not contain them yet.

![Pixel Agents screenshot](webview-ui/public/office.png)

## Features

- **One named session, one character** — a local character name brings a Copilot CLI session into the office; unnamed sessions stay archived, even while running
- **Live activity tracking** — characters animate based on what the agent is actually doing (writing, reading, running commands)
- **Office layout editor** — design your office with floors, walls, and furniture using a built-in editor
- **Speech bubbles** — visual indicators when an agent is waiting for input or awaiting permission
- **Sound notifications** — optional chimes when an agent finishes its turn or requests permission
- **Persistent layouts** — your office design is saved and shared across VS Code windows
- **Shared layout and assets** — import/export layouts and load external character, pet, and furniture packs
- **Areas** — paint named areas onto the office, map workspace folders to them, and new agents sit inside the areas mapped to their folder
- **Diverse characters** — 6 diverse characters. These are based on the amazing work of [JIK-A-4, Metro City](https://jik-a-4.itch.io/metrocity-free-topdown-character-pack).

<p align="center">
  <img src="webview-ui/public/characters.png" alt="Pixel Agents characters" width="320" height="72" style="image-rendering: pixelated;">
</p>

## Where This Is Going

The vision is: play a game, build a product. Two goals follow from it: to build a familiar, intuitive interface for running and orchestrating a lot of agents; and to make the hours you spend doing it feel less like administration and more like play.

Roughly three stages get there:

1. **Everywhere, with everything.** Today it's GitHub Copilot CLI in VS Code terminals or the browser. The provider boundary leaves room for more integrations.
2. **Actually a game.** Health bars for rate limits and token budgets. Scores for whatever you care about. Furniture that _does_ things. Offices you open like save files, one per project.
3. **Expand the orchestration frontier.** Orchestrator characters. Form a team by dragging a box around them. Hand work between agents. Point them at a board and let them pick up tasks themselves.

Most of this is still ahead. See [Issues](https://github.com/pixel-agents-hq/pixel-agents/issues) and [Discussions](https://github.com/pixel-agents-hq/pixel-agents/discussions) for what's open, and [CONTRIBUTING.md](CONTRIBUTING.md) to jump in.

## Requirements

- An installed and signed-in [GitHub Copilot CLI](https://docs.github.com/copilot/how-tos/use-copilot-agents/use-copilot-cli), with support for user hooks, `exec` hook commands, and `--session-id`
- **VS Code extension:** VS Code 1.105.0 or later
- Node.js on the CLI's `PATH` for the hook bridge; use Node.js 24 for local builds and tests
- Windows, Linux, or macOS

## Getting Started

### Build and run this source tree

```bash
git clone https://github.com/pixel-agents-hq/pixel-agents.git
cd pixel-agents
npm install
npm run build
node dist/cli.js
```

Run these commands from the checkout containing these changes. Copilot CLI is the only provider and needs no provider setting. `--provider copilot` is accepted for compatibility. `npx pixel-agents` and a global npm install use the published package, not your local build; do not use them to test unpublished changes.

### VS Code extension

1. Build this checkout, open it in VS Code, and press **F5** to launch the Extension Development Host with the local extension.
2. Open the **Pixel Agents** panel beside the terminal.
3. Approve the hooks installation in the Intro. Click **+ Agent** to open the session manager. Find a session under **Archived** and give it a local character name, or launch a new unnamed session in a Directory and then name it. Your workspace folders are listed once you turn on **Settings → Show Workspace Folders**; **+ Directory** adds your own launch locations.

Launched agents run in VS Code terminals, not native Copilot Chat. There is no provider setting to change.

For opted-in external Copilot CLI sessions, turn on **Settings → Watch All Sessions** to include other workspaces. See enrollment below.

### Standalone CLI

Run the locally built entry point. Set the launch Directory in the office:

```bash
node dist/cli.js
```

The CLI chooses a free local port and prints the URL. Approve the hooks installation in the Intro. Click **+ Agent** (the **+** card on a phone) to open the session manager. Name an archived session to show its character, then open it; an offline session resumes with its exact Copilot session ID. You can also launch a new unnamed session in a Directory and name it afterward. **+ Directory** adds launch locations, and **Settings → Show Start Directory** lists the directory the CLI was started from.

### Sessions and character names

The session manager lists known sessions and reads local Copilot initialization metadata to discover history; conversation prompts, results, and titles are not imported. Multiple sessions in the same Directory remain separate agents. Search by session ID, character name, or Directory.

Character names belong only to Pixel Agents and do not rename Copilot conversations. Pressing a character's **×** asks for confirmation before Archive: its managed CLI stops, its name and conversation are kept, and it enters the nearest reachable free cage position, remaining standing behind the bars. Place cages through **Layout → Furniture → Decor** first: **Jail Cage** holds one character; **Large Jail Cage** is five times as wide (10 × 3 tiles) and holds up to five characters in separate positions. Walking characters already reserve their positions. With no suitable free position, Archive is disabled and the CLI stays running. External terminals are never stopped. Unnamed sessions remain hidden rather than occupying cages.

Archived named characters return to available cage positions after reload and are listed under **Archived / unnamed**. Their name/status panels and desktop/mobile cards are hidden, with no floating archive label: the cage itself indicates archival. Choose **Restore to office** to release one without starting a CLI, or click its character to resume its exact session and release it after a successful launch. Releasing a character restores its cards and frees only its own cage position. If cages are removed or unreachable after a layout edit, the character stays inactive with an explicit warning until a suitable cage position is available. Named offline sessions preserve identity and appearance. Names and seats are adapter-local, so VS Code and standalone retain separate mappings.

Clicking a named character activates that exact session: focus its current managed terminal, or launch `copilot --resume <session-id>` if it is offline. A terminal changing sessions does not change the old character's identity. A running CLI observed outside Pixel Agents is observation-only; Pixel Agents reports that its terminal cannot be controlled rather than opening an unrelated terminal.

Use a fixed address or port when needed:

```bash
node dist/cli.js --port 3100
node dist/cli.js --host 127.0.0.1 --port 3100
node dist/cli.js --no-terminal
node dist/cli.js --help
```

The default bind address is `127.0.0.1`. Binding to `0.0.0.0` exposes the UI and WebSocket to the local network; do this only on a trusted network.

Open the URL the CLI prints - it carries a `?token=` for this server. Any browser can watch named characters without it, but installing or removing our Copilot hook file, viewing the session manager, assigning names, launching agents and attaching to their terminals require the token and an allowed host name. A read-only office hides these controls and does not receive the archived session catalogue. Standalone keeps the same token across restarts (in `~/.pixel-agents/standalone-token`, readable only by you), so a bookmarked or home-screen URL keeps working — as long as the port stays the same too, which takes `--port` (the default port is picked fresh on every start).

Treat that URL as a secret: the token is a bearer capability, not proof of being local. Whoever holds it can approve the hook install from anywhere the server is reachable — so don't paste the URL into a shared channel, and note that it also lands in your browser history (the server's own request log redacts it).

Pass `--no-terminal` to disable the embedded terminal — watch agents without launching or attaching to them from the browser.

Copying from the embedded terminal is verbatim: Cmd+C (Mac), Ctrl+C or Ctrl+Shift+C with a selection (Windows, Linux), the browser's Copy, and the **Copy** button on a phone copy exactly what is on screen. On a phone opened over plain `http://` (a LAN address), the paste key asks for the text in a prompt, since the page cannot read the clipboard there.

### Running the extension and standalone together

The extension and standalone CLI can run at the same time. Each server registers under `~/.pixel-agents/servers/`; the hook script sends events to all active registrations. VS Code and standalone keep separate agents, seats, and settings while using the shared office layout.

Stop a standalone server with **Ctrl+C**. It removes only its own registration.

### Copilot hooks and enrollment

Copilot activity tracking requires hooks. There is no transcript-polling fallback: declining installation or disabling hooks leaves live activity tracking unavailable.

Installation creates only `~/.copilot/hooks/pixel-agents.json` (or `$COPILOT_HOME/hooks/pixel-agents.json`), plus the local bridge `~/.pixel-agents/hooks/copilot-hook.js`. Existing hook files are preserved; a conflicting or modified `pixel-agents.json` is refused rather than overwritten or deleted. Disable **Instant Detection (Hooks)** to remove our configuration. Restart existing Copilot CLI sessions after installing hooks.

Hooks need `node` on the CLI's PATH. If Copilot's session sandbox restricts the bridge, its registry reads, or localhost access, adjust your sandbox policy explicitly; Pixel Agents does not widen sandbox permissions.

Only explicitly enrolled CLI processes report activity, so user hooks shared with VS Code do not automatically track native Copilot Chat. Office launches enroll automatically. To opt in a CLI started outside the office:

```bash
# macOS / Linux
PIXEL_AGENTS_COPILOT=1 copilot
```

```powershell
# Windows PowerShell
$env:PIXEL_AGENTS_COPILOT = "1"
copilot
```

External agents must run in the office's workspace, or **Watch All Sessions** must be enabled. Start the office before the CLI; if the office restarts, the next observed activity can re-adopt the session. Both hooks installation and `PIXEL_AGENTS_COPILOT=1` are required.

The initial integration shows session lifecycle, read/write/command activity, text-only turns, real permission prompts, and waiting-for-input notifications. It does not show Copilot child agents, token/context usage, or control native Copilot Chat. Identical concurrent tool calls are displayed as one activity until all matching calls finish. **Skip Permissions** maps to Copilot's `--allow-all-tools`; it does not grant unrestricted paths or URLs.

Pixel Agents does not intercept API keys or transmit real prompt text, and its hooks never auto-approve tools. **Skip Permissions** is an explicit opt-in launch setting, off by default; enable it only if you accept the security implications.

## Customizing the Office

Click **Layout** to edit the office:

- Paint floor patterns and walls, with color and contrast controls.
- Place, rotate, recolor, select, and remove furniture.
- Paint auto-tiling carpets and customize their main and accent colors.
- Add animated pets; click a pet in the office to interact with it.
- Create named **Areas**, paint their tiles, and assign Directories to them (agents launched in a Directory prefer seats in its Areas).
- Undo/redo changes, then import or export the complete layout as JSON.

Layouts can grow to 64×64 tiles by clicking the ghost border outside the current grid.

### Office assets

Bundled furniture, floors, walls, carpets, characters, and pets live under `webview-ui/public/assets/`. Furniture manifests describe sprites, rotation groups, state groups, and animation frames.

Use **Settings → Add Asset Directory** to load external characters, pets, and furniture. See [docs/external-assets.md](docs/external-assets.md) for furniture directory structure and manifest details. The visual asset manager at `scripts/asset-manager.html` helps create furniture manifests.

## How It Works

Enrolled Copilot CLI processes invoke the installed hook bridge. It discovers active Pixel Agents servers and sends authenticated lifecycle and activity events over localhost. Prompt-submission events are represented without their real prompt text.

The Copilot provider normalizes hooks into a shared `AgentEvent` model. `AgentRuntime` updates the central state store, and the active transport sends typed messages to the React webview. The office renders through Canvas 2D with pathfinding and character state machines. History discovery reads only the first initialization record from `session-state/*/events.jsonl`; it does not parse conversation content or infer activity from transcripts.

Pixel Agents does not modify Copilot CLI itself. Its dedicated hook file lives under the Copilot configuration directory; office state, layouts, and the bridge live under `~/.pixel-agents/`.

### Architecture

- **`core/`** — provider, adapter, transport, schema, and AsyncAPI message contracts with no runtime side effects.
- **`server/`** — shared Fastify server, hooks-driven agent runtime, persistence, Copilot provider, and standalone CLI.
- **`adapters/vscode/`** — the VS Code adapter: terminal, persistence, and webview bridge.
- **`webview-ui/`** — React 19, Vite, Canvas 2D, and adapter-specific transports for VS Code and browser WebSocket clients.

The extension and CLI are bundled with esbuild; the webview is built with Vite. Unit tests use Vitest and Node's test runner, and end-to-end coverage uses Playwright against VS Code and standalone.

## Development

```bash
git clone https://github.com/pixel-agents-hq/pixel-agents.git
cd pixel-agents
npm install
npm run build
```

Press **F5** in VS Code to launch the Extension Development Host. To run the standalone bundle built from source:

```bash
node dist/cli.js
```

Common checks:

```bash
npm run check-types
npm run lint
npm test
npm run e2e
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow and [e2e/README.md](e2e/README.md) for the end-to-end suite.

Standalone browser specs run headlessly. VS Code end-to-end specs open real windows
and steal focus; obtain explicit approval before running them locally.

### Hosted Test Reports

Build the combined Allure report locally and stage it for Vercel:

```bash
npm run test
npm run e2e
npm run e2e -- --attach-videos-on-success
npm run vercel:prepare
```

Use `npm run test:report` to build the combined report without preparing the Vercel output, then `npm run test:report:open` to serve it locally.

The staged output serves the combined `e2e`, `server`, and `webview` Allure report at `/reports/allure/`; it does not include a standalone webview preview. GitHub Actions creates a Vercel Preview deployment only for same-repository pull requests targeting `main`. The deploy job expects `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID` secrets and skips fork pull requests.

## Troubleshooting

- **Standalone will not start:** use Node.js 24, omit `--port` to choose a free port, or select another fixed port.
- **An agent is missing:** open **+ Agent → Archived** and assign its session a character name first. For live activity, confirm **Settings → Instant Detection (Hooks)** is on, restart CLI sessions after installing hooks, and check enrollment (`PIXEL_AGENTS_COPILOT=1`) and `node` on the CLI's `PATH`. Enable **Watch All Sessions** for other workspaces. Native Copilot Chat is not tracked.
- **The UI looks disconnected:** open **Settings → Debug View** to inspect whether hooks have arrived, the project path, and the latest agent data. No transcript connection is expected.
- **Extension and standalone are both running:** this is supported. Current versions create separate files under `~/.pixel-agents/servers/`; stopping one does not remove the other.

## Community & Contributing

Join the [Discord](https://discord.gg/Yk7jXebv9H) to chat with other users and follow development. Use [Issues](https://github.com/pixel-agents-hq/pixel-agents/issues) to report bugs or request features, and [Discussions](https://github.com/pixel-agents-hq/pixel-agents/discussions) for questions and ideas.

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request and read our [Code of Conduct](CODE_OF_CONDUCT.md) before participating.

## Supporting the Project

<a href="https://github.com/sponsors/pablodelucca">
  <img src="https://img.shields.io/badge/Sponsor-GitHub-ea4aaa?logo=github" alt="GitHub Sponsors">
</a>
<a href="https://ko-fi.com/pablodelucca">
  <img src="https://img.shields.io/badge/Support-Ko--fi-ff5e5b?logo=ko-fi" alt="Ko-fi">
</a>

## Star History

<a href="https://www.star-history.com/?repos=pixel-agents-hq%2Fpixel-agents&type=date&legend=bottom-right">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=pixel-agents-hq/pixel-agents&type=date&theme=dark&legend=bottom-right&sealed_token=Vn3YGMuZ_HFZAf56zIUQGCBJDYtDq38sOReKlcxWklxR_ilwVLynb7CPraf5uPhnAU7fwHXXoO88tzLkq9tpEYIExl4N8tcXOmu0ehAXPu5DdXNwjixYsxb00LSfeJ25f_jLkcZcTpRKLKYOb9p4_dR1jjAyrWDs7aicdbqejaDtLcVyj-oSoKkBfrS5" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=pixel-agents-hq/pixel-agents&type=date&legend=bottom-right&sealed_token=Vn3YGMuZ_HFZAf56zIUQGCBJDYtDq38sOReKlcxWklxR_ilwVLynb7CPraf5uPhnAU7fwHXXoO88tzLkq9tpEYIExl4N8tcXOmu0ehAXPu5DdXNwjixYsxb00LSfeJ25f_jLkcZcTpRKLKYOb9p4_dR1jjAyrWDs7aicdbqejaDtLcVyj-oSoKkBfrS5" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=pixel-agents-hq/pixel-agents&type=date&legend=bottom-right&sealed_token=Vn3YGMuZ_HFZAf56zIUQGCBJDYtDq38sOReKlcxWklxR_ilwVLynb7CPraf5uPhnAU7fwHXXoO88tzLkq9tpEYIExl4N8tcXOmu0ehAXPu5DdXNwjixYsxb00LSfeJ25f_jLkcZcTpRKLKYOb9p4_dR1jjAyrWDs7aicdbqejaDtLcVyj-oSoKkBfrS5" />
 </picture>
</a>

## License

Pixel Agents is available under the [MIT License](LICENSE).
