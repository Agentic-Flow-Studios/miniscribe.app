// Full live loop, end to end, with real speech:
//
//   renderer chunks -> preload -> main -> ASR utilityProcess
//                                      -> live:utterance -> preload -> DOM
//
// Every other test covers one leg. This is the only one that proves an utterance
// decoded in the worker actually reaches a column in the UI — and it asserts on
// the real renderer bundle and the real index.html, not a stand-in. The failure
// it exists to catch is a live transcript that stays empty while recording
// visibly works.
//
// Run: npx electron test/electron-live-e2e-test.js
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
// Points userData at a throwaway dir with the repo's models linked in. Must come
// before anything reads a model path — see the file for why.
require('./user-data');
const sherpa = require('sherpa-onnx-node');
const { registerIpc } = require('../dist/ipc.js');

const CHUNK = 2048;
const wavPath = path.join(
  __dirname,
  '..',
  'models',
  'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8',
  'test_wavs',
  '0.wav',
);

// The renderer has no filesystem access, so the audio rides in as base64 int16
// and is rebuilt there — the same shape the capture layer would hand it.
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

  // The app opens as the floating mini widget, and the transcript columns live
  // on the recording page of the main window — so get there the way a user
  // does, by their accessible names. Names, not class names or DOM shape: they
  // are what a screen reader announces, so they are the part of the UI this
  // test is entitled to depend on.
  const click = (name) => {
    const el = [...document.querySelectorAll('button, [role="button"]')].find(
      (b) => ((b.getAttribute('aria-label') || b.textContent || '').trim() === name),
    );
    if (el) el.click();
    return !!el;
  };
  const settle = () => new Promise((r) => setTimeout(r, 150));

  const push = async () => {
    const dir = await window.api.recorderStart();
    for (let i = 0; i < samples.length; i += ${CHUNK}) {
      window.api.recorderChunk('them', samples.slice(i, i + ${CHUNK}));
    }
    await window.api.recorderStop();
    // recorderStop resolves after the worker flushes, but the utterance
    // messages travel main -> renderer separately; give them a turn to land
    // and render.
    await new Promise((r) => setTimeout(r, 400));
    return dir;
  };

  const expanded = click('Expand to Main Window');
  await settle();

  // Recording starts in the widget, which cannot open a microphone in a
  // headless run — so the audio goes in through the bridge, and the page is
  // reached the way a user reaches it afterwards: through the list. The first
  // pass exists to produce a recording to open.
  const dir = await push();
  click('Recordings');
  await settle();
  click('Refresh list');
  await settle();
  const card = [...document.querySelectorAll('button, [role="button"]')].find((b) =>
    (b.getAttribute('aria-label') || '').startsWith('Open recording from'),
  );
  const opened = !!card;
  if (card) card.click();
  await new Promise((r) => setTimeout(r, 800));

  const before = document.querySelectorAll('[data-testid="line-them"]').length;

  // The part only this test covers: utterances decoded in the worker, arriving
  // at a page that is already open, reaching the DOM as they are spoken.
  await push();
  const after = document.querySelectorAll('[data-testid="line-them"]').length;

  // Rows render as Astryx Item components: the timestamp is the row's leading
  // content, so it prefixes the row text. Split it back off rather than reaching
  // into the design system's internal class names, which are not a contract.
  const lines = [...document.querySelectorAll('[data-testid="line-them"]')].map((el) => {
    const m = el.textContent.trim().match(/^(\\d+:\\d{2})\\s*(.*)$/s);
    return { ts: m ? m[1] : '', text: m ? m[2] : el.textContent.trim() };
  });
  return {
    dir,
    lines,
    expanded,
    opened,
    before,
    after,
    meLines: document.querySelectorAll('[data-testid="line-me"]').length,
    // The empty state is unmounted once any line exists, rather than hidden.
    emptyHidden: !document.body.textContent.includes('No transcript lines'),
  };
})()`;

// Called at module load, BEFORE app ready — exactly as main.ts does it. Calling
// it inside whenReady instead would hide a whole class of too-early bug, which
// is how `utilityProcess cannot be created before app is ready` reached a run.
// The try/catch matters: a throw here happens before any app.exit() path exists,
// so without it the test hangs instead of failing.
try {
  registerIpc();
} catch (e) {
  console.error(`RESULT: FAIL — registerIpc threw before app ready: ${e.message}`);
  process.exit(1);
}

// Model load plus decode, but nothing here should take two minutes. Fail loudly
// rather than hanging a CI run.
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
    const wave = sherpa.readWave(wavPath, false);
    console.log(`[test] wav: ${wave.sampleRate}Hz, ${wave.samples.length} samples`);

    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    const res = await win.webContents.executeJavaScript(script(encode(wave.samples)));
    dir = res.dir;

    console.log(`[test] ${res.lines.length} lines rendered in the Them column:`);
    for (const l of res.lines) console.log(`  ${l.ts}  ${l.text}`);

    // Navigation first: without these, "no lines in the DOM" below means only
    // that the transcript was never on screen to begin with.
    if (!res.expanded) fails.push('no "Expand to Main Window" button in the mini widget');
    if (!res.opened) fails.push('no recording to open from the list');
    if (res.lines.length === 0) {
      fails.push('no lines reached the DOM — live loop is broken somewhere');
    }
    // Two utterances per pass through the sample, on top of the two already on
    // screen from the recording that was opened.
    console.log(`[test] lines in the Them column: ${res.before} before, ${res.after} after`);
    if (res.after - res.before !== 2) {
      fails.push(
        `${res.after - res.before} live lines reached the open page, expected 2 — ` +
          'utterances are not arriving in the DOM as they are decoded',
      );
    }
    if (res.lines.length !== 4) fails.push(`${res.lines.length} lines, expected 4`);
    if (res.lines.length > 0 && !/wish to see it/.test(res.lines[0].text)) {
      fails.push(`first line unexpected: ${res.lines[0].text}`);
    }
    // Timestamps must survive to the UI; 0:00 for everything means the clock
    // was lost between the worker and the column. Counted as distinct values,
    // since the same sample is pushed twice and each utterance appears once
    // per pass — the two passes SHOULD agree with each other.
    const stamps = new Set(res.lines.map((l) => l.ts));
    if (stamps.size < 2) {
      fails.push(`every line shows the same timestamp (${[...stamps]})`);
    }
    // Audio was pushed as 'them' only.
    if (res.meLines !== 0) fails.push(`${res.meLines} lines leaked into the Me column`);
    if (!res.emptyHidden) fails.push('placeholder still visible with lines present');

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
    // Both passes wrote a session; the userData root here is the throwaway one
    // from ./user-data, so the whole recordings directory goes.
    fs.rmSync(path.join(app.getPath('userData'), 'recordings'), {
      recursive: true,
      force: true,
    });
  }
});
