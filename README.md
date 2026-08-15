<div align="center">

# Miniscribe 🎙️

**The Lightweight, On-Device Meeting Capture & Transcription App.**

*100% Private · Zero Cloud APIs · Always-On-Top Mini Widget · Dual-Track Audio Capture*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS-brightgreen.svg)]()
[![Electron](https://img.shields.io/badge/Electron-v43-47848F.svg)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-v19-61DAFB.svg)](https://react.dev/)
[![Sponsored by Agentic Flow Studios](https://img.shields.io/badge/Sponsored%20by-Agentic%20Flow%20Studios-ff3b30.svg)](https://agentic-flow.studio)

</div>

---

## 🌟 Overview

**Miniscribe** is an open-source, privacy-first desktop application designed to capture, record, and transcribe meetings in real time. Unlike cloud-dependent meeting bots, **Miniscribe runs 100% on your device** using local ONNX neural networks (`sherpa-onnx`). Your audio and transcripts never leave your machine.

Sponsored with ❤️ by **[Agentic Flow Studios](https://agentic-flow.studio)**.

---

## ✨ Key Features

- 🔒 **100% On-Device Privacy**: All speech-to-text processing occurs locally. Zero cloud subscriptions, zero API fees, and total privacy for sensitive discussions.
- 📌 **Floating Mini Widget**: A compact, always-on-top floating control bar that stays accessible over any app with one-touch recording, delay start timer, and live voice meters.
- 🎙️ **Dual-Track Audio Capture**: Captures your microphone ("You") and system loopback audio ("Them" / Zoom, Teams, Meet, Discord) as separate, synchronized audio tracks.
- 💬 **Live Speaker Diarization**: Separates and attributes speech to different speakers using Pyannote segmentation & TitaNet speaker embeddings.
- ⚡ **Post-Install Model Manager**: Download and switch between **Parakeet TDT 0.6B** (ultra-fast, low-latency ASR) and **OpenAI Whisper ONNX** models on demand.
- 📂 **Full Archive & Player**: Review past meeting recordings with a full-page interactive transcript, timestamp scrubber, and custom speaker labeling.
- 🔄 **Auto-Updates**: Built-in background update system via `electron-updater` and GitHub Releases.

---

## 📥 Installation

### Option 1: Download Pre-Built Installers
Grab the latest release for your operating system from the [Releases](https://github.com/agentic-flow-studios/miniscribe.app/releases) page:
- **Windows**: `Miniscribe-Setup-x.x.x.exe` (1-click installer with desktop & start menu shortcuts).
- **macOS**: `Miniscribe-x.x.x.dmg` or `.zip`.

### Option 2: Build from Source

#### Prerequisites
- [Node.js](https://nodejs.org/) (v18+ recommended)
- `npm` or `pnpm`

#### 1. Clone the repository
```bash
git clone https://github.com/agentic-flow-studios/miniscribe.app.git
cd miniscribe.app
```

#### 2. Install dependencies
```bash
npm install
```

#### 3. Run in development mode
```bash
npm run start
```

#### 4. Build distribution installers
```bash
npm run dist
```
Generates production installers inside the `dist/installers/` directory.

---

## 🛠️ Technology Stack

- **Framework**: [Electron](https://www.electronjs.org/) + [React 19](https://react.dev/)
- **UI & Design System**: [Astryx Core](https://github.com/astryxdesign/core) (`@astryxdesign/core`)
- **Speech Recognition Engine**: [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) (ONNX Runtime N-API)
- **Audio Capture**: Web Audio API & WASAPI Desktop Capturer Loopback
- **Bundler**: [esbuild](https://esbuild.github.io/)
- **Auto-Updater**: [electron-updater](https://www.electron.build/auto-update)

---

## 📖 Documentation & Links

- 🌐 **Website**: [miniscribe.app](https://miniscribe.app) *(Coming Soon)*
- 📚 **Documentation**: [Docs & User Guide](https://docs.miniscribe.app)
- 💻 **Source**: [agentic-flow-studios/miniscribe.app](https://github.com/agentic-flow-studios/miniscribe.app)
- 🐛 **Issue Tracker**: [Report a Bug / Feature Request](https://github.com/agentic-flow-studios/miniscribe.app/issues)
- 🚀 **Release Notes**: [GitHub Releases](https://github.com/agentic-flow-studios/miniscribe.app/releases)

---

## 🤝 Sponsorship & Community

**Miniscribe** is proudly sponsored and maintained by **[Agentic Flow Studios](https://agentic-flow.studio)**.

If you find Miniscribe valuable for your workflow, please consider starring ⭐ the repository and supporting our ongoing open-source development!

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.
