# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] — 2026-08-28

### Added
- Optional on-device transcript cleanup powered by **S1-mini by Superwhisper**.
  After speech recognition completes, it removes filler words and false starts,
  resolves self-corrections, and applies readable punctuation, capitalization,
  and written forms for numbers, dates, times, currency, and email addresses.
- A Settings download and enable control for the 484 MB S1-mini model. It is
  intentionally separate from speech-recognition models, so users can opt in
  to cleanup without changing live transcription or recording behavior.
- Local llama.cpp-backed inference for transcript cleanup. Raw audio and text
  remain on the device; cleanup is a post-ASR stage, not a cloud service.

### Changed
- Saved recordings and explicit re-transcription runs now receive the same
  cleanup pass when S1-mini is enabled. Speaker identity and segment timing are
  preserved; word-level timings are omitted from rewritten text because they no
  longer reliably correspond to the normalized wording.

## [0.1.1] — 2026-08-18

### Added
- Speaker diarization support for offline post-recording speaker separation.
- Enhanced Audio Input picker with level meters, device selection, and test monitor.
- Rich Speech Models management and configuration in Settings.

### Fixed
- Fixed model switching and recognizer reset between main process and ASR worker.
- Fixed recording timing issues and audio worklet ring buffer synchronization.
- Resolved draft release race condition during parallel asset upload in GitHub Actions.
- Fixed updater type compatibility and error handling.
- Restored macOS leg to CI workflow.

## [0.1.0] — 2026-08-17

Pre-launch hardening pass, and the first tagged release.

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
- GitHub Actions: a CI gate (typecheck, lint, build) and a tag-driven release
  workflow that builds on Windows and macOS and publishes a draft release,
  including the `latest.yml` manifests `electron-updater` reads.
- macOS code signing (Developer ID Application) and notarization, with hardened
  runtime entitlements for V8, the native ASR addons, and microphone access.
- `NSMicrophoneUsageDescription`, without which macOS terminates the app on
  first microphone access rather than prompting.
- MIT `LICENSE`, and `repository` / `license` fields in `package.json` —
  electron-builder infers the publish target from the former.

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
- macOS builds target Apple Silicon (arm64) only; there is no Intel build.

### Fixed
- `transcribe-files` (the one IPC handler that takes a path instead of a
  recording id) now validates the path resolves under the recordings root.
- Mix-track playback no longer decodes a WAV one `readInt16LE` call per
  sample; a 45-minute meeting was ~43M of them on first play.
- Model archive extraction now shells out via `execFile` (argv array) instead
  of an interpolated `exec` string.

## [0.0.1] — unreleased

First tracked version. No prior tagged releases exist to compare against.
