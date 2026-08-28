// Headless test for the renderer -> main recording path, through the REAL
// preload bridge and the REAL ipc handlers.
//
// Two things only this test can catch:
//   1. Float32Array surviving contextBridge + IPC. If the structured clone
//      mangles it, capture writes silence and nothing anywhere reports an error.
//   2. Ordering between recorderChunk (send, fire-and-forget) and recorderStop
//      (invoke). If invoke can overtake queued sends, the tail of every
//      recording is dropped on the floor. Deliberately NO sleep before stop —
//      the point is to probe that race, not to paper over it.
//
// Run: npx electron test/electron-ipc-test.js
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
// Points userData at a throwaway dir with the repo's models linked in. Must come
// before anything reads a model path — see the file for why.
require('./user-data');
const sherpa = require('sherpa-onnx-node');
const { registerIpc } = require('../dist/ipc.js');
const { registerUpdater } = require('../dist/updater.js');

const CHUNK = 2048;
const CHUNKS = 8;
const SAMPLE_RATE = 16000;

const script = `(async () => {
  const dir = await window.api.recorderStart();
  for (let c = 0; c < ${CHUNKS}; c++) {
    const s = new Float32Array(${CHUNK});
    for (let i = 0; i < ${CHUNK}; i++) {
      s[i] = Math.sin(2 * Math.PI * 440 * ((c * ${CHUNK} + i) / ${SAMPLE_RATE}));
    }
    window.api.recorderChunk('me', s);
  }
  const out = await window.api.recorderStop();
  // The updater in a dev run: it must answer, and answer that it cannot check,
  // rather than throwing at whoever opens Settings.
  const updater = await window.api.updaterState();
  const afterCheck = await window.api.updaterCheck();
  return { dir, out, updater, afterCheck, apiKeys: Object.keys(window.api).sort() };
})()`;

// The whole bridge surface, sorted. A key that vanishes from preload without
// its callers vanishing too is a renderer that throws on a click, which no
// other test in this suite would notice.
const EXPECTED_API = [
  'exportTranscript',
  'modelsCatalog',
  'modelsDelete',
  'modelsDownload',
  'modelsList',
  'modelsSetActive',
  'onLiveActivity',
  'onLiveError',
  'onLiveUtterance',
  'onModelProgress',
  'onTextNormalizerProgress',
  'onTranscribeProgress',
  'onUpdaterChanged',
  'onWindowModeChanged',
  'recorderChunk',
  'recorderStart',
  'recorderStop',
  'recordingsAudio',
  'recordingsCleanTranscript',
  'recordingsDelete',
  'recordingsLabels',
  'recordingsList',
  'recordingsSetLabels',
  'recordingsTranscribe',
  'recordingsTranscript',
  'systemGetPermissionStatus',
  'systemOpenPrivacySettings',
  'textNormalizerDelete',
  'textNormalizerDownload',
  'textNormalizerSetEnabled',
  'textNormalizerStatus',
  'transcribeFiles',
  'updaterCheck',
  'updaterDownload',
  'updaterInstall',
  'updaterState',
  'windowClose',
  'windowMinimize',
  'windowSetAlwaysOnTop',
  'windowSetMode',
  'windowSetPopoverOpen',
];

// Called at module load, BEFORE app ready — exactly as main.ts does it. Calling
// it inside whenReady instead would hide a whole class of too-early bug, which
// is how `utilityProcess cannot be created before app is ready` reached a run.
// The try/catch matters: a throw here happens before any app.exit() path exists,
// so without it the test hangs instead of failing.
try {
  registerIpc();
  registerUpdater();
} catch (e) {
  console.error(`RESULT: FAIL — registration threw before app ready: ${e.message}`);
  process.exit(1);
}

// Nothing here should take a minute. Fail loudly rather than hanging a CI run.
setTimeout(() => {
  console.log('RESULT: FAIL (timed out)');
  app.exit(3);
}, 120000).unref();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'dist', 'preload.js'),
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      // Matches the app (see src/main.ts): the renderer this exercises is a
      // sandboxed one, so the preload bridge is tested as it actually ships.
      sandbox: true,
    },
  });

  let dir = null;
  const fails = [];

  try {
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    const res = await win.webContents.executeJavaScript(script);
    dir = res.dir;

    if (res.apiKeys.join(',') !== EXPECTED_API.join(',')) {
      fails.push(`bridge exposes [${res.apiKeys}], expected [${EXPECTED_API}]`);
    }
    if (res.out.length !== 1 || res.out[0].kind !== 'me') {
      fails.push(`recorderStop returned ${JSON.stringify(res.out)}`);
    }

    console.log(
      `[test] updater: ${res.updater.stage} v${res.updater.currentVersion} ` +
        `-> after check: ${res.afterCheck.stage}`,
    );
    if (!res.updater.currentVersion) fails.push('updater reports no current version');
    // An unpacked run has no feed to ask; saying so is the correct answer, and
    // the one the Settings panel renders instead of a broken check.
    if (res.updater.stage !== 'unsupported') {
      fails.push(`updater stage is "${res.updater.stage}" in a dev run, expected "unsupported"`);
    }
    if (res.afterCheck.stage !== 'unsupported') {
      fails.push(`checking in a dev run left stage "${res.afterCheck.stage}"`);
    }

    if (res.out.length > 0) {
      const wave = sherpa.readWave(res.out[0].path, false);
      const expected = CHUNK * CHUNKS;
      let peak = 0;
      for (let i = 0; i < wave.samples.length; i++) {
        const a = Math.abs(wave.samples[i]);
        if (a > peak) peak = a;
      }
      console.log(
        `[test] ${wave.samples.length} samples on disk, ` +
          `${res.out[0].seconds.toFixed(3)}s, peak ${peak.toFixed(4)}`,
      );

      if (wave.samples.length !== expected) {
        fails.push(
          `${wave.samples.length} samples, expected ${expected} — ` +
            `${expected - wave.samples.length} lost between renderer and disk`,
        );
      }
      // Silence here means the Float32Array crossed the bridge as zeros/garbage.
      if (Math.abs(peak - 1) > 0.001) fails.push(`peak ${peak.toFixed(4)}, expected ~1.0`);
    }

    if (fails.length === 0) {
      console.log('RESULT: PASS');
      app.exit(0);
    } else {
      fails.forEach((f) => console.log(`  FAIL: ${f}`));
      console.log('RESULT: FAIL');
      app.exit(2);
    }
  } catch (e) {
    console.error('RESULT: FAIL', e);
    app.exit(1);
  } finally {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});
