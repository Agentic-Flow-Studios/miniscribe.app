// The transcript a recording keeps: written when the session stops, read back
// when it is reopened.
//
//   chunks -> ASR worker -> transcript.json beside the audio
//                        -> recordingsTranscript() on reopen
//
// The failure this exists to catch is a reopened recording that shows an empty
// panel and then spends minutes decoding audio it has already transcribed once.
// Only an end-to-end run can catch it: the live utterances are accumulated in
// main, and the file is written inside recorderStop, after the worker flush.
//
// Run: npx electron test/electron-transcript-cache-test.js
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

  const dir = await window.api.recorderStart();
  for (let i = 0; i < samples.length; i += ${CHUNK}) {
    window.api.recorderChunk('them', samples.slice(i, i + ${CHUNK}));
  }
  await window.api.recorderStop();

  // The renderer only ever knows the id, never a path — the same read the
  // recordings list performs when a session is opened.
  const id = dir.split(/[\\\\/]/).filter(Boolean).pop();
  const saved = await window.api.recordingsTranscript(id);
  return { dir, id, saved };
})()`;

// Called at module load, BEFORE app ready — exactly as main.ts does it.
try {
  registerIpc();
} catch (e) {
  console.error(`RESULT: FAIL — registerIpc threw before app ready: ${e.message}`);
  process.exit(1);
}

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

    const file = path.join(dir, 'transcript.json');
    if (!fs.existsSync(file)) {
      fails.push('recorderStop left no transcript.json beside the audio');
    }

    const saved = res.saved;
    if (!saved) {
      fails.push('recordingsTranscript returned null for a session just recorded');
    } else {
      console.log(`[test] ${saved.segments.length} segments, source=${saved.source}:`);
      for (const s of saved.segments) {
        console.log(`  ${s.start.toFixed(2)}s ${s.speaker}: ${s.text}`);
      }

      // Same sample the live tests use; it yields two utterances.
      if (saved.segments.length !== 2) {
        fails.push(`${saved.segments.length} segments saved, expected 2`);
      }
      if (saved.source !== 'live') {
        fails.push(`source is "${saved.source}", expected "live"`);
      }
      if (Number.isNaN(Date.parse(saved.savedAt))) {
        fails.push(`savedAt is not a date: ${saved.savedAt}`);
      }
      const first = saved.segments[0];
      if (first && !/wish to see it/.test(first.text)) {
        fails.push(`first segment unexpected: ${first.text}`);
      }
      // Audio was pushed as 'them' only. A segment attributed to the wrong side
      // reads as the other person saying it.
      const wrongSide = saved.segments.filter((s) => s.speaker !== 'Them');
      if (wrongSide.length > 0) {
        fails.push(`${wrongSide.length} segments attributed to ${wrongSide[0].speaker}`);
      }
      // Timestamps and per-word times are what playback follows along with; a
      // transcript that loses them still reads but no longer plays.
      if (saved.segments.some((s) => !Array.isArray(s.words) || s.words.length === 0)) {
        fails.push('a segment came back with no word times');
      }
      const sorted = saved.segments.every(
        (s, i) => i === 0 || saved.segments[i - 1].start <= s.start,
      );
      if (!sorted) fails.push('segments are not in chronological order');
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
