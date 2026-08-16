// Every test that decodes audio needs a models directory, and both the main
// process and the ASR worker now resolve it from ONE place: Electron's userData
// (main asks `app`, the worker is told in its environment — see USER_DATA_ENV).
//
// Under `electron test/...` that path is %APPDATA%/Electron, which is empty on
// every machine, so a run would fail with "No Speech Recognition model
// installed" while the models sit in the checkout. Point userData at a
// throwaway directory instead, with the repo's `models/` linked in.
//
// Deliberately NOT the repo root: userData is also where recordings are
// written, and a test that dies mid-run would leave session directories in the
// working tree.
//
// Must be required BEFORE app ready — userData is fixed once paths resolve.
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const repo = path.join(__dirname, '..');
const userData = path.join(repo, '.test-userdata');

fs.mkdirSync(userData, { recursive: true });

// A link, not a copy: the models are ~600MB.
const link = path.join(userData, 'models');
if (!fs.existsSync(link)) {
  // 'junction' is the Windows form that needs no elevation; elsewhere the type
  // argument is ignored and this is an ordinary directory symlink.
  try {
    fs.symlinkSync(path.join(repo, 'models'), link, 'junction');
  } catch (err) {
    console.warn(`[test] could not link models into ${userData}:`, err.message);
  }
}

app.setPath('userData', userData);

module.exports = { userData };
