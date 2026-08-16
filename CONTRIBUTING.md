# Contributing to Miniscribe 🎙️

Thank you for your interest in contributing to **Miniscribe**! We welcome contributions from developers of all skill levels.

---

## 🛠️ Local Development Setup

### Prerequisites
- **Node.js** v20 or v22 (v22 recommended)
- **npm** (v10+)
- Operating System: **Windows 10/11** or **macOS** (Apple Silicon / Intel)

### 1. Clone the Repository
```bash
git clone https://github.com/agentic-flow-studios/miniscribe.app.git
cd miniscribe.app
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Download Offline ONNX Models
Miniscribe requires local speech recognition models to transcribe audio. Run the model download script to fetch the recommended default models:
```bash
npm run get-model
```

### 4. Start the Application in Development Mode
```bash
npm run start
```

---

## 🧪 Testing & Verification

Before submitting a Pull Request, please ensure all typechecks, builds, and test suites pass:

```bash
# Typecheck TypeScript files
npm run typecheck

# Lint
npm run lint

# Build main, renderer, and worklet bundles
npm run build

# Run all test suites
npm run test:all
```

`npm run lint` and `npm run typecheck` both run in CI (`.github/workflows/ci.yml`) on every PR; the `test:*` suites do not, for the reason given in the Testing section below.

---

## 📜 Coding Guidelines

- **UI & Layout**: Miniscribe uses `@astryxdesign/core` for layout and design components. Follow component-first layout patterns rather than custom inline styles where possible.
- **Privacy & On-Device Rule**: Miniscribe is 100% on-device and privacy-first. **Never add external network calls, analytics telemetry, or cloud transcription APIs** without explicit opt-in governance. This is enforced, not just requested: the renderer runs under a `connect-src 'none'` CSP (`src/renderer/index.html`), so a dependency that tries to fetch something will fail loudly. Web fonts count — self-host anything you add, next to the others in `src/renderer/fonts/`.
- **Cross-Platform Compatibility**: Avoid platform-specific shell commands (`ping`, `cmd.exe`, `bash`). Use native Node.js APIs or cross-platform utilities. When a subprocess is genuinely needed, use `execFileSync`/`execFile` with an argv array rather than `execSync` with an interpolated string — paths here contain the user's home directory.
- **Icons & Assets**: Everything in `assets/` is committed, including the generated `.ico`/`.icns`/`.png` icons. They are produced once from `assets/miniscribe_logo.svg`, not rebuilt during `npm run build` — so `npm install && npm run build` needs nothing but Node.
- **Model Downloads**: Anything fetched at runtime gets a `sha256` in its catalog entry (`src/model-manager.ts`). Run `npm run hash-models` to compute them.

---

## 🔀 Submitting a Pull Request

1. Fork the repository on GitHub.
2. Create a topic branch: `git checkout -b my-feature-branch`.
3. Commit your changes with clear, descriptive commit messages.
4. Push to your fork and submit a Pull Request to the `main` branch.

---

## 📄 License
By contributing to Miniscribe, you agree that your contributions will be licensed under the project's [MIT License](LICENSE).
