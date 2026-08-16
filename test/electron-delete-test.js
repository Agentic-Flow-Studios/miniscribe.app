// Deleting a recording, through the UI that asks first.
//
// Three things worth a real run:
//   1. The confirmation is not skippable — one click on Delete must leave the
//      recording on disk until the dialog's own action is taken.
//   2. The audio actually goes. On Windows the player holds mix.wav open, and a
//      file with a live handle cannot be unlinked at all, so this is the case
//      that fails on a real machine and passes in any mock.
//   3. The list and the page agree afterwards: no row, and not still sitting on
//      the transcript of a recording that no longer exists.
//
// Run: npx electron test/electron-delete-test.js
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
require('./user-data');
const { registerIpc } = require('../dist/ipc.js');

const CHUNK = 2048;

const script = `(async () => {
  const settle = (ms) => new Promise((r) => setTimeout(r, ms || 300));
  const byName = (n) =>
    [...document.querySelectorAll('button, [role="button"]')].find(
      (b) => ((b.getAttribute('aria-label') || b.textContent || '').trim() === n),
    ) || null;
  const startsWith = (p) =>
    [...document.querySelectorAll('button, [role="button"]')].find((b) =>
      (b.getAttribute('aria-label') || '').startsWith(p),
    ) || null;
  const click = (name) => { const el = byName(name); if (el) el.click(); return !!el; };

  // A recording to delete, written straight through the bridge — the widget
  // cannot open a microphone here.
  const dir = await window.api.recorderStart();
  const silence = new Float32Array(${CHUNK});
  for (let i = 0; i < 8; i++) window.api.recorderChunk('me', silence);
  await window.api.recorderStop();
  const id = dir.split(/[\\\\/]/).filter(Boolean).pop();

  click('Expand to Main Window');
  await settle();
  click('Recordings');
  await settle();
  click('Refresh list');
  await settle(400);

  const rowsBefore = document.querySelectorAll('[aria-label^="Open recording from"]').length;

  // Open it, so the player has the audio file open when the delete lands.
  const card = startsWith('Open recording from');
  if (card) card.click();
  await settle(900);
  const onRecordingPage = !!byName('Delete');

  // Ask to delete, then check nothing has happened yet.
  click('Delete');
  await settle(400);
  const askedFirst = /cannot be undone/i.test(document.body.textContent);

  return { id, dir, rowsBefore, onRecordingPage, askedFirst };
})()`;

const confirmScript = `(async () => {
  const settle = (ms) => new Promise((r) => setTimeout(r, ms || 300));
  const byName = (n) =>
    [...document.querySelectorAll('button, [role="button"]')].find(
      (b) => ((b.getAttribute('aria-label') || b.textContent || '').trim() === n),
    ) || null;
  const confirm = byName('Delete Recording');
  if (confirm) confirm.click();
  await settle(1500);

  const listText = document.body.textContent;
  const out = {
    confirmed: !!confirm,
    rowsAfter: document.querySelectorAll('[aria-label^="Open recording from"]').length,
    // Back on the list rather than reading a transcript with no audio.
    leftThePage: !byName('Delete'),
    // The confirmation belongs where the delete happened.
    listSaysDeleted: /Recording deleted/i.test(listText),
  };

  // ...and nowhere else. The widget is a recorder: a library message there is
  // about something that did not happen in it, and it lingers.
  const toWidget = byName('Mini Widget');
  if (toWidget) toWidget.click();
  await settle(700);
  out.widgetSaysDeleted = /Recording deleted/i.test(document.body.textContent);
  return out;
})()`;

try {
  registerIpc();
} catch (e) {
  console.error(`RESULT: FAIL — registerIpc threw before app ready: ${e.message}`);
  process.exit(1);
}

setTimeout(() => {
  console.log('RESULT: FAIL (timed out)');
  app.exit(3);
}, 90000).unref();

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
  let dir = null;

  try {
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    const asked = await win.webContents.executeJavaScript(script);
    dir = asked.dir;
    console.log(`[test] ${JSON.stringify(asked)}`);

    if (asked.rowsBefore < 1) fails.push('the recording did not reach the list');
    if (!asked.onRecordingPage) fails.push('no Delete button on an open recording');
    if (!asked.askedFirst) fails.push('Delete did not ask for confirmation');
    // The whole point of asking: nothing gone yet.
    if (!fs.existsSync(dir)) fails.push('the recording was deleted before it was confirmed');

    const done = await win.webContents.executeJavaScript(confirmScript);
    console.log(`[test] ${JSON.stringify(done)}`);

    if (!done.confirmed) fails.push('no confirm button in the dialog');
    if (fs.existsSync(dir)) {
      fails.push(`${dir} is still on disk — the audio file was probably still open`);
    }
    if (done.rowsAfter !== asked.rowsBefore - 1) {
      fails.push(`${done.rowsAfter} rows after deleting, expected ${asked.rowsBefore - 1}`);
    }
    if (!done.leftThePage) fails.push('still showing the recording that was just deleted');
    if (!done.listSaysDeleted) fails.push('the recordings list said nothing about the delete');
    if (done.widgetSaysDeleted) {
      fails.push('the delete message leaked into the mini widget, which records rather than deletes');
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
