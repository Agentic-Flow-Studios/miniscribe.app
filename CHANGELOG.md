# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

Pre-launch hardening pass, ahead of the first tagged release.

### Added
- `sha256` verification on every downloaded model, checked before extraction.
- Content-Security-Policy on the renderer (`connect-src 'none'`): the on-device
  privacy claim is now enforced, not just documented.
- `sandbox: true` on the renderer's `BrowserWindow`.
- The tray icon now actually reflects recording state — it had the assets for
  this but nothing ever told it a recording had started.
- A "Speech Models" nav item in the main window; previously that modal was
  only reachable from the mini widget's menu.
- `npm run lint` (ESLint + typescript-eslint + react-hooks), wired into CI.
- `npm run hash-models` to compute the sha256s above.

### Changed
- All four UI fonts are now self-hosted (`src/renderer/fonts/`) instead of
  loaded from Google Fonts at runtime.
- Icons moved from a build-time Python/Pillow/PyQt5 generation step into
  `assets/`, committed directly. `npm run build` now needs only Node.
- `electron-builder` 25 → 26, `esbuild` 0.23 → 0.28 (13 audit vulnerabilities,
  1 critical, → 0).
- Packaged installer 446MB → 97MB: the output directory used to sit inside the
  glob that collects app files, so every build packaged the previous build's
  installer into itself; bundled renderer dependencies (React, the design
  system, icons) were also being shipped a second time as raw `node_modules`
  alongside the bundle that already inlines them; Chromium's ~50 locale
  files were being shipped for a UI that only ever speaks English.
- Switching, downloading, or deleting a speech model now actually reaches live
  transcription (it restarts the ASR worker process) instead of only taking
  effect after the next app launch.
- Downloads stream through a backpressured pipeline instead of an unbounded
  chunk queue, so a 600MB model can no longer sit entirely in memory.

### Fixed
- `transcribe-files` (the one IPC handler that takes a path instead of a
  recording id) now validates the path resolves under the recordings root.
- Mix-track playback no longer decodes a WAV one `readInt16LE` call per
  sample; a 45-minute meeting was ~43M of them on first play.
- Model archive extraction now shells out via `execFile` (argv array) instead
  of an interpolated `exec` string.

## [0.0.1] — unreleased

First tracked version. No prior tagged releases exist to compare against.
