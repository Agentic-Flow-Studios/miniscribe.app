// The reading canvas, measured in a real window.
//
// Following the audio scrolls the transcript by moving one element's scrollTop.
// That is only ever "the transcript scrolls" if nothing ABOVE the transcript can
// scroll too — when the page canvas could, every auto-scroll dragged the player,
// the insights panel and the toolbar up off the top with it. So the invariant
// this test pins is structural: exactly one scroll box in the reading canvas,
// and it is the one holding the lines.
//
// It also walks the route a user takes to get there — record, back to the list,
// reopen — which is the path that loads a saved transcript instead of decoding
// the audio again.
//
// Run: npx electron test/electron-layout-test.js
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
// Points userData at a throwaway dir with the repo's models linked in. Must come
// before anything reads a model path — see the file for why.
require('./user-data');
const sherpa = require('sherpa-onnx-node');
const { registerIpc } = require('../dist/ipc.js');

const CHUNK = 2048;
// One pass yields two utterances; enough passes to overflow the window, so the
// transcript has something to scroll and the measurement means something.
const PASSES = 8;
const wavPath = path.join(
  __dirname,
  '..',
  'models',
  'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8',
  'test_wavs',
  '0.wav',
);

function encode(samples) {
  const buf = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(s * 32767), i * 2);
  }
  return buf.toString('base64');
}

const script = (b64) => `(async () => {
  const bin = atob('${b64}');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const view = new DataView(bytes.buffer);
  const n = bytes.length / 2;
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) samples[i] = view.getInt16(i * 2, true) / 32767;

  // Buttons are found by the name a screen reader would announce — the part of
  // a design system that is a contract, unlike its class names.
  const button = (name) =>
    [...document.querySelectorAll('button, [role="button"]')].find(
      (b) => ((b.getAttribute('aria-label') || b.textContent || '').trim() === name),
    ) || null;
  const click = (name) => { const el = button(name); if (el) el.click(); return !!el; };
  const settle = (ms) => new Promise((r) => setTimeout(r, ms || 200));

  const scrolls = (el) => {
    const overflowY = getComputedStyle(el).overflowY;
    return (
      (overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1
    );
  };
  const name = (el) =>
    el.tagName.toLowerCase() +
    (el.getAttribute('data-testid') ? '[' + el.getAttribute('data-testid') + ']' : '') +
    (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).join('.') : '');

  const trace = [];
  trace.push('expand:' + click('Expand to Main Window'));
  await settle();

  await window.api.recorderStart();
  for (let pass = 0; pass < ${PASSES}; pass++) {
    for (let i = 0; i < samples.length; i += ${CHUNK}) {
      window.api.recorderChunk('them', samples.slice(i, i + ${CHUNK}));
    }
  }
  await window.api.recorderStop();
  await settle(400);

  // Back to the list and in again — the reopen path, which reads the transcript
  // saved beside the audio rather than transcribing it a second time.
  trace.push('linesWhileLive:' + document.querySelectorAll('[data-testid^="line-"]').length);
  trace.push('recordings:' + click('Recordings'));
  await settle();
  // The list is loaded when the app mounts and after a recording stops through
  // the UI. This one was driven straight at the bridge, so ask for it.
  trace.push('refresh:' + click('Refresh list'));
  await settle(400);
  const card = [...document.querySelectorAll('button, [role="button"]')].find((b) =>
    (b.getAttribute('aria-label') || '').startsWith('Open recording from'),
  );
  trace.push('card:' + !!card);
  if (card) card.click();
  await settle(1500);

  // Opening a saved recording is a library action, so it reports itself as a
  // notice on this page — not as session status, which the widget would show.
  const saidSaved = /from the saved transcript/i.test(document.body.textContent);

  const line = document.querySelector('[data-testid="line-them"], [data-testid="line-me"]');
  if (!line) {
    return {
      error: 'no transcript lines on screen after reopening',
      trace,
      text: document.body.textContent.slice(0, 400),
    };
  }

  let box = line.parentElement;
  while (box && !scrolls(box)) box = box.parentElement;
  if (!box) return { error: 'the transcript is not in a scroll box of its own' };

  // Anything above it that also scrolls is what used to carry the player away.
  const above = [];
  for (let p = box.parentElement; p; p = p.parentElement) {
    if (scrolls(p)) above.push(name(p));
  }
  const doc = document.scrollingElement;

  // Collapsed content keeps its DOM and is hidden with display:none, so "gone"
  // has to be measured as "takes up no space", not "not in the document".
  const onScreen = (el) => !!el && el.getClientRects().length > 0;
  const transportShown = () => onScreen(button('Play recording')) || onScreen(button('Pause'));

  // The trigger is identified by what it controls, not by its text: several
  // things on this page carry aria-expanded (the export menu among them), and
  // only one of them owns the transport.
  const playButton = button('Play recording') || button('Pause');
  const trigger = playButton
    ? [...document.querySelectorAll('button[aria-expanded]')].find((el) => {
        const content = document.getElementById(el.getAttribute('aria-controls') || '');
        return content && content.contains(playButton);
      })
    : null;

  let folded = null;
  let hadTransport = false;
  if (trigger) {
    // Start from open whichever way the stored preference left it.
    if (trigger.getAttribute('aria-expanded') !== 'true') {
      trigger.click();
      await settle(400);
    }
    hadTransport = transportShown();
    const openHeight = box.clientHeight;

    trigger.click();
    await settle(400);
    folded = {
      transportGone: !transportShown(),
      grew: box.clientHeight - openHeight,
    };
  }

  return {
    saidSaved,
    boxName: name(box),
    linesInBox: box.querySelectorAll('[data-testid^="line-"]').length,
    overflow: box.scrollHeight - box.clientHeight,
    above,
    docScrolls: doc ? doc.scrollHeight > doc.clientHeight + 1 : false,
    hadTransport,
    hadTrigger: !!trigger,
    folded,
  };
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
}, 180000).unref();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    // The main window's real size. A tall test window would hide exactly the
    // overflow this test is about.
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
  let recordingsDir = null;

  try {
    const wave = sherpa.readWave(wavPath, false);
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));

    // Layout preferences persist in this partition, so a previous run's clicks
    // would decide what this one starts from. Clear them and remount.
    await win.webContents.executeJavaScript(
      `localStorage.removeItem('miniscribe.playerPanelOpen');` +
        `localStorage.removeItem('miniscribe.transcriptView');`,
    );
    const reloaded = new Promise((r) => win.webContents.once('did-finish-load', r));
    win.webContents.reload();
    await reloaded;

    const res = await win.webContents.executeJavaScript(script(encode(wave.samples)));

    if (res.error) {
      if (res.trace) console.log(`[test] trace: ${res.trace.join(' ')}`);
      if (res.text) console.log(`[test] page: ${res.text.replace(/\s+/g, ' ')}`);
      console.log(`RESULT: FAIL — ${res.error}`);
      app.exit(2);
      return;
    }

    console.log(
      `[test] scroll box ${res.boxName}: ${res.linesInBox} lines, ` +
        `${res.overflow}px of overflow`,
    );
    console.log(`[test] scrollable ancestors above it: ${res.above.length ? res.above : 'none'}`);
    console.log(`[test] folded: ${JSON.stringify(res.folded)}`);

    if (!res.saidSaved) fails.push('opening a saved recording reported nothing on the page');
    if (res.linesInBox === 0) fails.push('the scroll box found holds no transcript lines');
    if (res.overflow <= 0) fails.push('the transcript does not overflow — nothing was measured');
    if (res.above.length > 0) {
      fails.push(
        `${res.above.length} scrollable ancestor(s) above the transcript: ${res.above.join(', ')} ` +
          '— following the audio would scroll the player and insights too',
      );
    }
    if (res.docScrolls) fails.push('the document itself scrolls');
    if (!res.hadTransport) fails.push('no transport on a reopened recording — nothing to collapse');
    if (!res.hadTrigger) fails.push('the player panel has no collapsible trigger');
    if (res.folded && !res.folded.transportGone) fails.push('collapsing left the transport on screen');
    if (res.folded && res.folded.grew <= 0) {
      fails.push(`collapsing gave the transcript ${res.folded.grew}px, expected it to grow`);
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
    // Every session this test recorded, and nothing else: the userData root is
    // the throwaway one from ./user-data.
    recordingsDir = path.join(app.getPath('userData'), 'recordings');
    fs.rmSync(recordingsDir, { recursive: true, force: true });
  }
});
