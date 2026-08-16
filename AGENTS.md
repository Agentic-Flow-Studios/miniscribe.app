# AGENTS.md

Project-specific guidance for AI coding agents. See also README.md (install,
features) and CONTRIBUTING.md (local setup, coding rules).

## What this is

Miniscribe is an Electron + React desktop app: local, on-device meeting
transcription with a floating always-on-top mini widget. Everything runs on
the user's machine — speech recognition is `sherpa-onnx-node` running ONNX
models the user downloads once, not a cloud API. That constraint is load-
bearing, not aspirational: the renderer ships a `connect-src 'none'` CSP
(`src/renderer/index.html`), so a network call from that process fails
outright rather than merely being against policy. See CONTRIBUTING.md.

## Process shape

Four surfaces, each with a narrow job:

- **`src/main.ts`** — window/tray lifecycle only. Owns the always-on-top mini
  widget vs. resizable main window distinction (`window-position.ts`,
  `window-sizes.ts`).
- **`src/ipc.ts`** — every `ipcMain.handle`, in one file. Recordings, models,
  transcript export, window controls. The load-bearing invariant here: the
  renderer almost never names a filesystem path. Every recording is addressed
  by `id`, resolved to a directory under `recordingsRoot()` by
  `recordingDir(id)`, which throws on anything that isn't a real, direct child
  of that root. `transcribe-files` is the one exception (a path-based
  fallback for when a session id couldn't be read back) and it re-validates
  the path is under `recordingsRoot()` itself rather than trusting the
  renderer. Keep new handlers on the id side of that line.
- **`src/asr-worker.ts`** — a `utilityProcess`, not a thread. Runs
  `transcription.ts`'s VAD + ASR loop so a slow decode never blocks IPC or the
  meter UI. Talks to main over `postMessage` only (`WorkerIn`/`WorkerOut` in
  `asr-worker.ts`). It caches its own recognizer independently of main's —
  see the note below.
- **`src/renderer/`** — React 19, sandboxed (`sandbox: true` in
  `BrowserWindow`), `contextIsolation: true`, `nodeIntegration: false`. Talks
  to main only through the bridge `src/preload.ts` exposes as `window.api`.
  UI is built from `@astryxdesign/core` components (Astryx block below);
  `src/renderer/use-session.ts` is the one big stateful hook the recording
  pages hang off.

## Two recognizers, one model

`transcription.ts`'s recognizer is a module-level singleton, and it exists
**twice at runtime** — once loaded lazily in main (batch re-transcription,
`transcribeFiles`) and once in the ASR worker (live transcription). Changing
the active model, downloading one, or deleting one has to reach both:
`resetRecognizer()` drops main's copy; the worker only picks up a change
because `ipc.ts`'s `models:*` handlers restart the worker process afterward
(`restartAsr()`) — there is no in-process way to make it forget its cached
recognizer. If you add a new way to change models, route it through
`restartAsr()`, not just `resetRecognizer()`, or live transcription will keep
using whatever model was loaded at app start.

## Build & test

`npm run build` needs nothing but Node — no Python, no asset generation step.
Icons and fonts are committed under `assets/` and `src/renderer/fonts/`, not
built. See CONTRIBUTING.md for the full command list; the one worth knowing
up front is that `test/` suites launch a real Electron instance against local
ONNX models (`npm run get-model`, ~700MB) and are deliberately **not** run in
CI (`.github/workflows/ci.yml`) for that reason — `npm run typecheck && npm
run build` is what CI actually gates on.

<!-- ASTRYX:START -->
Astryx v0.3.0 · 155 components
CLI: run every command as `npx astryx <cmd>` (shown below as `astryx ...`).

SETUP (once, in your app entry e.g. main.tsx) — without these, components render unstyled:
  import "@astryxdesign/core/reset.css";
  import "@astryxdesign/core/astryx.css";

WORKFLOW — discover, don't guess. Before writing UI:
1. `astryx build "<idea>"` — START HERE: returns a kit (closest [page] + [block]s + [component]s). No args = full playbook.
2. `astryx template <name> [--skeleton]` — scaffold the [page]/[block]s it named, or study their layout. Templates are reference code.
3. `astryx component <Name>` — props + examples for every component you use.

RULES:
- No <div> — components do all layout/spacing. Full page → AppShell; sidebar nav → SideNav.
- Frame first: pick the shell (AppShell / Layout+LayoutPanel) and budget regions in px BEFORE writing content (`astryx docs layout`).
- Dense data = rows (Table, List/Item) edge-to-edge — never Card-wrapped list items. Card = dashboard widgets, galleries, settings groups only.
- Status → StatusDot/Token; Badge only for counts and enumerated states, never decoration.
- Custom styling: component props first; else style/className with tokens — var(--color-*|--spacing-*|--radius-*). No raw hex/px. (No StyleX/Tailwind compiler here — don't use xstyle/utility classes.)
- Tokens for every value (`astryx docs tokens`). Brand/accent via `astryx theme` — never override --color-* in :root.
- SELF-CHECK before you finish: re-read the file and replace any raw <div>/<span> layout, imported .css/@apply, or hardcoded value (#hex, 16px) with the component or a token (var(--color-*|--spacing-*|…)). If unsure a component/prop exists, run `astryx component <Name>` / `astryx search "<thing>"`; don't hand-roll CSS.

MORE CLI:
  search "<query>"   find any component / hook / doc / template / block
  component --list   155 components by category
  template --list    page + block recipes
  docs <topic>       color, elevation, icons, illustrations, internationalization, layout, migration, motion, principles, shape, spacing, styling, theme, tokens, typography
  swizzle <Name>     eject component source for deep customization
  upgrade --apply    run after any @astryxdesign/core bump
<!-- ASTRYX:END -->
