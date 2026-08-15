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

# Build main, renderer, and worklet bundles
npm run build

# Run all test suites
npm run test:all
```

---

## 📜 Coding Guidelines

- **UI & Layout**: Miniscribe uses `@astryxdesign/core` for layout and design components. Follow component-first layout patterns rather than custom inline styles where possible.
- **Privacy & On-Device Rule**: Miniscribe is 100% on-device and privacy-first. **Never add external network calls, analytics telemetry, or cloud transcription APIs** without explicit opt-in governance.
- **Cross-Platform Compatibility**: Avoid platform-specific shell commands (`ping`, `cmd.exe`, `bash`). Use native Node.js APIs or cross-platform utilities.

---

## 🔀 Submitting a Pull Request

1. Fork the repository on GitHub.
2. Create a topic branch: `git checkout -b my-feature-branch`.
3. Commit your changes with clear, descriptive commit messages.
4. Push to your fork and submit a Pull Request to the `main` branch.

---

## 📄 License
By contributing to Miniscribe, you agree that your contributions will be licensed under the project's [MIT License](LICENSE).
