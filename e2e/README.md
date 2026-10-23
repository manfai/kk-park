# Pixel Agents e2e tests

Playwright tests for the VS Code extension and standalone browser office.
This README is the source of truth for the E2E mocking model and test inventory.

## What this suite covers

- **Spawn paths (`@area:spawn`)**: the VS Code launch drawer, workspace
  Directories, and user-defined Directories.
- **Cross-cutting checks (`@area:cross-cutting`)**: first-run Intro, hook consent,
  revision of consent, failed installation, safe hook removal, and truthful Settings.
- **Standalone (`@area:standalone`)**: enrolled Copilot CLI hook lifecycle,
  activity, real permission/input waits, reload restoration, close, read-only
  access, tokened consent, Directories, terminal launch, terminal input/output,
  verbatim clipboard copy, asset reload, layout import/export, and reconnection.
  Session-first cases cover hidden unnamed history/running/new sessions, local
  character names, confirmed cage confinement and managed CLI shutdown, same-project session separation,
  exact resume across terminal restarts, and visible open rejection.
- **Layout editor (`@area:editor`)**: selection, furniture movement/copy,
  floor/wall/erase strokes, stroke-scoped undo, and furniture deletion.
- **Areas (`@area:areas`)**: zoning, Directory mappings, seating, and persistence.
- **Carpet (`@area:carpet`)**: placement, paint, erase, and undo.
- **Pets (`@area:pets`)**: loading, placement, toggle, persistence, and heart bubbles.
- **Mobile (`@area:mobile`)**: phone shell, card navigation, terminal launch,
  edge swipes, links, copy/paste, selection, trackpad, and camera gestures.

Canvas-only outcomes use the read-only test hooks installed by the E2E flag.
Agent lifecycle and activity must enter through the process boundary below,
never by mutating OfficeState.

## Mocking model & rules

Terminal-driven tests launch the mock **`copilot` process**, not a real AI CLI.
The isolated PATH contains `e2e/fixtures/mock-copilot` (or its Windows shim),
which runs `mock-copilot-runner.cjs`. It claims a queued scenario, receives the
real launch `--session-id` or `--resume` ID, and executes the **installed real bridge**
`~/.pixel-agents/hooks/copilot-hook.js` using the entries in
`$COPILOT_HOME/hooks/pixel-agents.json`.

Every test uses isolated HOME, USERPROFILE, and COPILOT_HOME directories under
the repository's ignored test-results directory. No real account, network AI
request, or personal hooks configuration is used. There is **no transcript
fallback**, transcript fixture, team simulation, or context-usage simulation.

Rules for a correct test:

1. **Drive terminal behavior through a scenario.** Use `copilotScenario(name)`,
   `.at(milliseconds).emitHook(payload)`, `.holdOpenFor(milliseconds)`, and
   `.build()`, then `arrangeNextCopilotInvocation(home, scenario)` before launching.
   Scenarios automatically emit `sessionStart` with `source: startup` (`resume`
   for resumed sessions) and
   `sessionEnd` with `reason: user_exit`; `.withoutAutoInit()` opts out of startup.
2. **Emit the documented Copilot payload.** The scenario's `hook_event_name`
   selects the bridge argument and is not part of Copilot's stdin payload.
   Payload fields are `sessionId`, `cwd`, `toolName`, and `toolArgs`; optional
   `toolCallId` correlates tools. Event names are `sessionStart`, `sessionEnd`,
   `userPromptSubmitted`, `preToolUse`, `postToolUse`, `postToolUseFailure`,
   `agentStop`, and `notification`. Notifications carry `notification_type:
permission_prompt` or `elicitation_dialog` for actual waits. Child-agent
   events are not supported.
3. **Enrollment is explicit.** Office launches set `PIXEL_AGENTS_COPILOT=1`
   and `PIXEL_AGENTS_COPILOT_SESSION_ID` to the launch UUID. External mock
   scenarios set the same variables. Unenrolled CLI processes and native Chat
   do not report activity.
4. **Assert visible outcomes.** Use overlays, cards, dialogs, xterm output,
   and canvas observability. The mock never decides pass/fail.
5. **Standalone server-level exception.** `helpers/hooks.ts:sendHookEvent`
   may POST normalized events directly for server/WebSocket integration tests.
   Prefer real bridge subprocesses, as in `standalone/copilot.spec.ts`.
   Terminal-driven tests must use the scenario builder, not manual hook POSTs.
6. **Name sessions through the UI.** Every unnamed session stays hidden,
   including running office launches and discovered history. `clickAddAgent`
   uses Sessions to launch, save a local `Agent N` name, and explicitly Open.
   `helpers/sessions.ts` exposes launch-only and naming helpers for tests of
   that boundary. Names do not change Copilot's own title. Archive requires
   confirmation, stops only the associated managed mock CLI, and keeps the named
   character standing inside the nearest reachable empty Jail Cage, one per cage.
   Missing/full cages disable Archive; restore/resume frees the cage. Never delete its
   conversation metadata or stop an unrelated/external process. Seed cages
   through layout fixtures, and assert confinement via read-only character snapshots.
7. **Seed only provider metadata for history.** The mock writes the first
   `session.start` record to isolated
   `$COPILOT_HOME/session-state/<id>/events.jsonl`, with
   `data.context.cwd` set to its absolute working directory.
   `seedSessionMetadata` writes that same fixture format for offline history;
   discovery reads only its first record. Never seed internal agent state.

Example:

```typescript
await arrangeNextCopilotInvocation(
  standalone.tmpHome,
  copilotScenario('read a file')
    .at(1_000)
    .emitHook({
      hook_event_name: 'preToolUse',
      sessionId: '{{sessionId}}',
      cwd: '{{cwd}}',
      toolName: 'view',
      toolArgs: { path: 'example.ts' },
    })
    .holdOpenFor(60_000)
    .build(),
);
await clickAddAgent(page);
await expectOverlayVisible(page, 'Reading example.ts');
```

## Running

```bash
npm run compile
npm run e2e -- e2e/tests/standalone --workers=1  # headless browser only
npx tsc --noEmit -p e2e/tsconfig.json --skipLibCheck
npm run e2e:inventory
npm run test:report
npm run test:report:open
```

**VS Code tests require explicit user approval before execution.** They open
real Electron windows and steal focus. Never run them from a sub-agent.
After approval, run them once at the end of implementation:

```bash
npm run e2e -- e2e/tests/copilot --workers=1
```

The terminal-launch tests skip Windows until PTY execution of the `.cmd` shim
is verified. Non-terminal standalone tests continue to cover Windows.

## What's NOT covered

- Child-agent routing and context usage are not implemented.
- Mobile software-keyboard behavior, long-press reorder, and device gesture feel
  need a real-phone smoke check.
- Multi-window layout sync needs two editor instances.
- Real Copilot CLI compatibility should be smoke-tested before release with
  an explicitly enrolled process; the mock never authenticates or calls a model.
- Firefox and Safari need manual standalone smoke checks.

## Narration

VS Code recordings tail `<isolated HOME>/.copilot-mock/test-narration.log` and
`external-narration.log` into the monitor terminal and mock terminal tabs.
`narrator.step()` and `narrator.check()` are cosmetic only: removing them must
not change assertions, behavior, or timing. Pixel Agents observes hooks, not
terminal narration. Standalone recordings are raw browser artifacts.

## Adding or removing tests

Read the mocking rules above, the applicable fixture, and shared helpers first.
Use an existing `@area:` tag or document a new one here and in
`helpers/allure-labels.ts`. Regenerate the inventory after adding, moving, or
removing tests.

## Test inventory

This section is auto-generated. Do not edit between the markers.

<!-- BEGIN:E2E-INVENTORY -->

90 tests total. Generated by `scripts/generate-e2e-inventory.mjs`. Re-run after adding or removing tests.

### `@area:spawn` (3 tests)

- `e2e/copilot/launch-drawer.spec.ts:40` — hovering + Agent opens a drawer with a badged, read-only row per workspace folder (Launch drawer (multi-root))
- `e2e/copilot/launch-drawer.spec.ts:63` — tapping a drawer row launches an agent labeled with that Directory (Launch drawer (multi-root))
- `e2e/copilot/launch-drawer.spec.ts:80` — a Directory defined in the office joins the drawer, launches, and survives a panel reload (Launch drawer (multi-root))

### `@area:cross-cutting` (10 tests)

- `e2e/copilot/consent.spec.ts:37` — fresh install discloses the Copilot hook file and installs only after consent (Hooks consent gate)
- `e2e/copilot/consent.spec.ts:56` — Not Now leaves the hook file untouched and consent unanswered (Hooks consent gate)
- `e2e/copilot/consent.spec.ts:69` — Don't Ask Again leaves the hook file untouched and persists hooks off (Hooks consent gate)
- `e2e/copilot/consent.spec.ts:79` — closing the Intro sends no consent and does not persist hooks off (Hooks consent gate)
- `e2e/copilot/consent.spec.ts:91` — Back lets Don't Ask Again undo an installed hook file (Hooks consent gate)
- `e2e/copilot/consent.spec.ts:106` — Back after Don't Ask Again lets Not Now restore unanswered consent (Hooks consent gate)
- `e2e/copilot/consent.spec.ts:121` — a stray office click neither answers nor dismisses the Intro (Hooks consent gate)
- `e2e/copilot/consent.spec.ts:134` — failed install preserves the file and Not Now revokes the failed grant (Hooks consent gate › when the hook file cannot be parsed)
- `e2e/copilot/consent.spec.ts:151` — the toggle removes only our hook file and preserves unrelated hook files (Hooks Settings removal)
- `e2e/copilot/consent.spec.ts:164` — refusing removal of a modified hook file does not persist hooks off (Hooks Settings removal)

### `@area:standalone` (31 tests)

- `e2e/copilot/multi-server-hooks.spec.ts:31` — extension and standalone both stay hook-driven without cross-contamination (VS Code and standalone / multi-server hooks)
- `e2e/standalone/copilot.spec.ts:17` — observes enrolled Copilot CLI hooks without tracking native Chat (Standalone / Copilot CLI)
- `e2e/standalone/directory-modal.spec.ts:44` — Enter on Cancel cancels and Enter on an Area toggles it; neither saves (Standalone / Directory modal keyboard)
- `e2e/standalone/directory-modal.spec.ts:78` — Enter in the path field saves (Standalone / Directory modal keyboard)
- `e2e/standalone/directory-modal.spec.ts:99` — an unnamed Directory keeps its Area under the name the host gave it (Standalone / Directory Area mapping)
- `e2e/standalone/hooks.spec.ts:22` — propagates hook-driven lifecycle into the browser UI (Standalone / hooks)
- `e2e/standalone/hooks.spec.ts:137` — the tokened page shows the Intro and Install writes the hooks (Standalone / hooks consent)
- `e2e/standalone/hooks.spec.ts:168` — an untokened spectator page never sees the consent dialog (Standalone / hooks consent)
- `e2e/standalone/hooks.spec.ts:190` — an untokened spectator page shows no toolbar, only a View only label (Standalone / hooks consent)
- `e2e/standalone/hooks.spec.ts:217` — the hooks checkbox reflects install state and its click is the consent grant (Standalone / hooks consent)
- `e2e/standalone/launch-drawer.spec.ts:33` — the server start Directory is read-only and launches a named character with its folder context (Standalone / session launch Directories)
- `e2e/standalone/launch-drawer.spec.ts:53` — a Directory added in the modal launches an agent and is still there after a reload (Standalone / user-defined Directories)
- `e2e/standalone/launch-drawer.spec.ts:75` — deleting a Directory drops its option and leaves its running agent alone (Standalone / user-defined Directories)
- `e2e/standalone/launch-drawer.spec.ts:97` — an invalid path is refused inline and nothing is persisted (Standalone / Directory validation)
- `e2e/standalone/launch-drawer.spec.ts:115` — the start Directory is hidden by default and Show Start Directory lists it (Standalone / host Directory setting)
- `e2e/standalone/launch-drawer.spec.ts:134` — the skip-permissions setting lands on disk and survives a reload (Standalone / permission posture)
- `e2e/standalone/launch-drawer.spec.ts:148` — turning skip-permissions on in one office shows it on in another already open (Standalone / permission posture)
- `e2e/standalone/launch-drawer.spec.ts:183` — the Sessions manager fits the viewport, its Directory selector reaches the last option and + Directory stays reachable (Standalone / long Directory lists)
- `e2e/standalone/sessions.spec.ts:48` — unnamed sessions stay hidden; Archive confirms, preserves named characters and history, and stops the managed CLI (Standalone / session-first office)
- `e2e/standalone/sessions.spec.ts:200` — two named sessions in the same project keep separate characters and resume the exact session across terminal restarts (Standalone / session-first office)
- `e2e/standalone/terminal.spec.ts:37` — browser-launched named agent gets a PTY, and confirmed Archive stops it while retaining its character (Standalone / terminal › Archive parking)
- `e2e/standalone/terminal.spec.ts:102` — Archive explains missing cage and cannot stop the running CLI (Standalone / terminal › Missing cage)
- `e2e/standalone/terminal.spec.ts:124` — every tab takes mouse input, and a narrow window keeps the cards and close reachable (Standalone / terminal)
- `e2e/standalone/terminal.spec.ts:160` — copy preserves line breaks and indentation verbatim (Standalone / terminal)
- `e2e/standalone/terminal.spec.ts:254` — --no-terminal disables new launches but still manages named hook-driven agents (Standalone / terminal disabled)
- `e2e/standalone/ui.spec.ts:32` — Archive confines one character per cage, persists across reload and releases on restore (Standalone / UI › Archive parking)
- `e2e/standalone/ui.spec.ts:133` — Debug View shows hook delivery diagnostics (Standalone / UI)
- `e2e/standalone/ui.spec.ts:161` — adding an external asset directory triggers a live asset reload (Standalone / UI)
- `e2e/standalone/ui.spec.ts:191` — browser Export Layout downloads the layout file (Standalone / UI)
- `e2e/standalone/ui.spec.ts:206` — browser Import Layout applies the chosen file (Standalone / UI)
- `e2e/standalone/ui.spec.ts:241` — ConnectionIndicator appears when the WebSocket connection drops (Standalone / UI)

### `@area:areas` (10 tests)

- `e2e/copilot/areas-multiroot.spec.ts:86` — painting an area labels tiles in the layout (Areas (multi-root))
- `e2e/copilot/areas-multiroot.spec.ts:115` — areas can be added and removed (Areas (multi-root))
- `e2e/copilot/areas-multiroot.spec.ts:148` — a folder can be mapped to an area and the mapping persists (Areas (multi-root))
- `e2e/copilot/areas-multiroot.spec.ts:184` — an agent for the MAPPED folder takes a seat inside its area (Areas (multi-root) › seat preference (alpha → Engineering))
- `e2e/copilot/areas-multiroot.spec.ts:215` — an agent for an UNMAPPED folder is not forced into the area (Areas (multi-root) › seat preference (alpha → Engineering))
- `e2e/copilot/areas-multiroot.spec.ts:259` — a Directory assigned an Area in its modal seats the agent it launches inside that Area (Areas (multi-root) › Area assignment from the Directory modal)
- `e2e/copilot/areas-multiroot.spec.ts:314` — renaming a Directory carries its Area mapping to the new name (Areas (multi-root) › Area assignment from the Directory modal › rename)
- `e2e/copilot/areas.spec.ts:40` — seeded areas + areaTiles load and showAreas is effective (Areas (single-folder) › seeded area data + show-areas state)
- `e2e/copilot/areas.spec.ts:75` — the host-contributed workspace folder makes the Areas tool reachable (Areas (single-folder))
- `e2e/copilot/areas.spec.ts:95` — the Areas tool button is visible with a seeded areas layout (Areas (single-folder) › seeded areas layout (positive gate))

### `@area:carpet` (8 tests)

- `e2e/copilot/carpet.spec.ts:51` — carpet sprites load + broadcast, and the Carpet category renders variants (Carpet)
- `e2e/copilot/carpet.spec.ts:72` — painting a tile records it in the carpet layer (Carpet)
- `e2e/copilot/carpet.spec.ts:89` — autotiling: the junction case reflects neighboring carpet tiles (Carpet)
- `e2e/copilot/carpet.spec.ts:130` — erasing removes a carpet tile (Carpet)
- `e2e/copilot/carpet.spec.ts:156` — the carpet eyedropper copies a tile’s variant (Carpet)
- `e2e/copilot/carpet.spec.ts:184` — a carpet stroke is a single undo entry (Carpet)
- `e2e/copilot/carpet.spec.ts:205` — carpet tiles persist across a save + panel reload (Carpet)
- `e2e/copilot/carpet.spec.ts:302` — a seeded carpet coexists with furniture on the same tile (Carpet surface placement (seeded))

### `@area:editor` (17 tests)

- `e2e/copilot/editor.spec.ts:101` — erasing a tile deletes the furniture it passes through (Layout editor — erase)
- `e2e/copilot/editor.spec.ts:124` — erasing away from an item leaves it in place (Layout editor — erase)
- `e2e/copilot/editor.spec.ts:146` — one undo restores both the tiles and the furniture an erase stroke removed (Layout editor — erase)
- `e2e/copilot/editor.spec.ts:184` — a right-drag erase stroke is a single undo entry (Layout editor — erase)
- `e2e/copilot/editor.spec.ts:223` — a floor paint stroke is a single undo entry (Layout editor — stroke undo)
- `e2e/copilot/editor.spec.ts:261` — a wall paint stroke is a single undo entry (Layout editor — stroke undo)
- `e2e/copilot/editor.spec.ts:297` — separate strokes stay separate undo entries (Layout editor — stroke undo)
- `e2e/copilot/editor.spec.ts:388` — dragging a desk moves the item standing on it (Layout editor — desks carry what stands on them)
- `e2e/copilot/editor.spec.ts:413` — rotating a desk turns the item standing on it (Layout editor — desks carry what stands on them)
- `e2e/copilot/editor.spec.ts:439` — alt-dragging a desk copies it with the item standing on it (Layout editor — desks carry what stands on them)
- `e2e/copilot/editor.spec.ts:471` — an alt-drag copy that overlaps the original is refused (Layout editor — desks carry what stands on them)
- `e2e/copilot/editor.spec.ts:496` — one undo removes the whole copied group (Layout editor — desks carry what stands on them)
- `e2e/copilot/editor.spec.ts:514` — selecting a placed item closes the open tool panel, and R rotates it (Layout editor — desks carry what stands on them)
- `e2e/copilot/editor.spec.ts:565` — a drag that would push the item on the desk off the grid is refused (Layout editor — a desk group fits as a whole or not at all)
- `e2e/copilot/editor.spec.ts:619` — a rotation that would swing the item on the desk into a chair is refused (Layout editor — a rotation fits as a whole or not at all)
- `e2e/copilot/editor.spec.ts:673` — a copy of an uncoloured item stays uncoloured under a Colorize palette (Layout editor — Furniture Copy)
- `e2e/copilot/editor.spec.ts:736` — eyedropping the item on a desk copies its colour, as its own undo entry (Layout editor — colour eyedropper)

### `@area:mobile` (8 tests)

- `e2e/standalone/launch-drawer.spec.ts:200` — the phone Sessions manager fits and keeps its last Directory and + Directory reachable (Standalone / long Directory lists on a phone)
- `e2e/standalone/mobile.spec.ts:170` — phone shell: + card manages a named session and opens its terminal; toggle, card taps and edge swipe navigate (Standalone / mobile shell)
- `e2e/standalone/mobile.spec.ts:216` — tapping a URL in the terminal opens it; a sideways drag from it does not (Standalone / mobile shell)
- `e2e/standalone/mobile.spec.ts:251` — the key bar shows while the software keyboard is up, under both viewport resize policies (Standalone / mobile shell)
- `e2e/standalone/mobile.spec.ts:280` — copy and paste work on a plain-http origin (no Clipboard API) (Standalone / mobile shell)
- `e2e/standalone/mobile.spec.ts:341` — the hooks info modal fits the phone screen (Standalone / mobile shell)
- `e2e/standalone/mobile.spec.ts:366` — a two-finger pan stops the camera following a character; a pure pinch does not (Standalone / mobile shell)
- `e2e/standalone/mobile.spec.ts:406` — the trackpad key follows the finger that pressed it, not touches[0] (Standalone / mobile shell)

### `@area:pets` (3 tests)

- `e2e/copilot/pets.spec.ts:90` — pet sprites load, broadcast, and expose manifest names in the editor (Pets)
- `e2e/copilot/pets.spec.ts:117` — placing a pet toggles it on/off and persists across a panel reload (Pets)
- `e2e/copilot/pets.spec.ts:205` — clicking a pet shows a heart bubble that auto-dismisses and dismisses on re-click (Pets)

<!-- END:E2E-INVENTORY -->
