// First run, with no speech model installed.
//
// The failure this exists to catch is the one users actually hit: the app looks
// ready, they record a meeting, and only when the transcription runs does it
// say no model is installed — after the meeting, when it is too late. So the
// transcript panel must offer the install instead of reporting an empty
// transcript, and the offer must lead somewhere.
//
// Deliberately does NOT require ./user-data: an empty models directory is the
// whole point of this test.
//
// Run: npx electron test/electron-onboarding-test.js
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const { registerIpc } = require('../dist/ipc.js');
const { registerUpdater } = require('../dist/updater.js');

const script = `(async () => {
  const button = (name) =>
    [...document.querySelectorAll('button, [role="button"]')].find(
      (b) => ((b.getAttribute('aria-label') || b.textContent || '').trim() === name),
    ) || null;
  const click = (name) => { const el = button(name); if (el) el.click(); return !!el; };
  const settle = (ms) => new Promise((r) => setTimeout(r, ms || 300));
  const text = () => document.body.textContent;

  // The app decides where to open on its own once the model check answers.
  await settle(600);
  const landedOnSettings = text().includes('Speech Recognition Models');

  // A meeting recorded before any model was installed. The audio is kept — the
  // recorder needs no model — so this is a real state a user reaches, and the
  // one where the old build waited until the transcribe button to say why
  // nothing happened.
  await window.api.recorderStart();
  const silence = new Float32Array(2048);
  for (let i = 0; i < 8; i++) window.api.recorderChunk('me', silence);
  await window.api.recorderStop();

  const wentToRecordings = click('Recordings');
  await settle();
  click('Refresh list');
  await settle(400);
  const card = [...document.querySelectorAll('button, [role="button"]')].find((b) =>
    (b.getAttribute('aria-label') || '').startsWith('Open recording from'),
  );
  const opened = !!card;
  if (card) card.click();
  await settle(600);

  const prompted = text().includes('No speech model installed');
  const hasInstallButton = !!button('Install a Model');
  // Neither of the wrong answers: a bare "no lines" that reads as a result, or
  // a failed transcription attempt that had no model to run.
  const showsGenericEmpty = text().includes('No transcript lines');
  const showsAsrError = /No Speech Recognition model installed in/.test(text());

  const installLeadsSomewhere = click('Install a Model');
  await settle();
  const backOnSettings = text().includes('Speech Recognition Models');

  return {
    landedOnSettings,
    wentToRecordings,
    opened,
    prompted,
    hasInstallButton,
    showsGenericEmpty,
    showsAsrError,
    installLeadsSomewhere,
    backOnSettings,
  };
})()`;

try {
  registerIpc();
  registerUpdater();
} catch (e) {
  console.error(`RESULT: FAIL — registration threw before app ready: ${e.message}`);
  process.exit(1);
}

setTimeout(() => {
  console.log('RESULT: FAIL (timed out)');
  app.exit(3);
}, 60000).unref();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 1020,
    height: 740,
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

  const fails = [];

  try {
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    const res = await win.webContents.executeJavaScript(script);
    console.log(`[test] ${JSON.stringify(res)}`);

    if (!res.landedOnSettings) {
      fails.push('a first run with no model did not open on Settings');
    }
    if (!res.wentToRecordings) fails.push('no Recordings nav to reach the list');
    if (!res.opened) fails.push('the recording just made did not appear in the list');
    if (!res.prompted) fails.push('the recording page does not say a model is missing');
    if (!res.hasInstallButton) fails.push('no "Install a Model" button to act on it');
    if (res.showsGenericEmpty) {
      fails.push('the generic "No transcript lines" empty state showed instead of the prompt');
    }
    if (res.showsAsrError) {
      fails.push('opening the recording ran a transcription that had no model, and said so');
    }
    if (!res.backOnSettings) fails.push('"Install a Model" did not lead to the models settings');

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
  }
});
