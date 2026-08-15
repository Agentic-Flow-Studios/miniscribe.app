// Headless test for what a finished recording gains after Stop: speaker names,
// and a mixed audio file the transcript can be played against.
//
// Claims:
//   1. The mix SUMS the tracks rather than picking one or concatenating them.
//      The two tracks are written as constant DC levels, so a sample of the mix
//      has exactly one correct value and any other arithmetic shows up as a
//      different number, not as a subtly wrong-sounding file.
//   2. It runs the full length of the LONGER track, so a mic that kept recording
//      after the far side hung up is not truncated.
//   3. Overlap clamps instead of wrapping. Two loud tracks summed past full scale
//      must saturate; wrapping would turn a loud moment into a burst of noise.
//   4. The mix is a correctly headed WAV, at the sample rate the renderer's
//      <audio> element will be handed, reachable as a file:// URL.
//   5. It is cached: asking twice does not rewrite the file.
//   6. Names round-trip through disk, and blank ones are dropped rather than
//      stored as empty strings (an empty name means "use the cluster id").
//   7. An id cannot escape the recordings root. The renderer never names a file;
//      this is the guard that keeps it that way.
//
// Run: npx electron test/electron-audio-test.js
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const { registerIpc } = require('../dist/ipc.js');

const SAMPLE_RATE = 16000;
const CHUNK = 2048;
// 'me' runs the full span, 'them' stops early: the mix must follow the longer.
const ME_SECONDS = 4;
const THEM_SECONDS = 2;
// Chosen to saturate when summed: 0.7 + 0.5 > 1.0.
const ME_LEVEL = 0.7;
const THEM_LEVEL = 0.5;

const script = `(async () => {
  const dir = await window.api.recorderStart();
  const id = dir.split(/[\\\\/]/).filter(Boolean).pop();

  const write = (kind, level, seconds) => {
    const total = ${SAMPLE_RATE} * seconds;
    for (let i = 0; i < total; i += ${CHUNK}) {
      const s = new Float32Array(Math.min(${CHUNK}, total - i));
      s.fill(level);
      window.api.recorderChunk(kind, s);
    }
  };
  write('me', ${ME_LEVEL}, ${ME_SECONDS});
  write('them', ${THEM_LEVEL}, ${THEM_SECONDS});
  await window.api.recorderStop();

  const listed = (await window.api.recordingsList()).find((r) => r.id === id) ?? null;

  // A blank name is a deletion, not a value.
  await window.api.recordingsSetLabels(id, { 'Them 2': 'Priya', Me: '   ' });
  const labels = await window.api.recordingsLabels(id);

  const first = await window.api.recordingsAudio(id);
  const again = await window.api.recordingsAudio(id);

  // Read the mix back through the same URL the <audio> element would use, so a
  // URL the renderer cannot actually fetch fails here rather than in the UI.
  const bytes = new Uint8Array(await (await fetch(first.url)).arrayBuffer());
  const view = new DataView(bytes.buffer);
  const ascii = (at) => String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3));
  const sampleAt = (seconds) => view.getInt16(44 + Math.floor(seconds * ${SAMPLE_RATE}) * 2, true) / 32767;

  let traversal = 'allowed';
  try {
    await window.api.recordingsAudio('../' + id);
  } catch (e) {
    traversal = 'rejected';
  }

  return {
    dir,
    id,
    listed,
    labels,
    traversal,
    url: first.url,
    seconds: first.seconds,
    sameUrl: first.url === again.url,
    header: {
      riff: ascii(0),
      wave: ascii(8),
      data: ascii(36),
      format: view.getUint16(20, true),
      channels: view.getUint16(22, true),
      sampleRate: view.getUint32(24, true),
      bits: view.getUint16(34, true),
      dataBytes: view.getUint32(40, true),
    },
    bytes: bytes.byteLength,
    // While both tracks run, and after the short one has ended.
    overlapped: sampleAt(1),
    meOnly: sampleAt(3),
  };
})()`;

try {
  registerIpc();
} catch (e) {
  console.error(`RESULT: FAIL — registerIpc threw before app ready: ${e.message}`);
  process.exit(1);
}

const timer = setTimeout(() => {
  console.log('RESULT: FAIL — timed out');
  app.exit(3);
}, 120_000);

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'dist', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  let dir = null;
  const fails = [];

  try {
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    const res = await win.webContents.executeJavaScript(script, true);
    dir = res.dir;

    const expectedBytes = ME_SECONDS * SAMPLE_RATE * 2 + 44;

    console.log(
      `[test] mix ${res.bytes} bytes (expected ${expectedBytes}), ` +
        `overlap ${res.overlapped.toFixed(3)} (clamped from ${(ME_LEVEL + THEM_LEVEL).toFixed(3)}), ` +
        `me-only ${res.meOnly.toFixed(3)} (expected ${ME_LEVEL.toFixed(3)})`,
    );
    console.log(`[test] labels ${JSON.stringify(res.labels)}, traversal ${res.traversal}`);

    if (!res.listed) fails.push(`recording ${res.id} was not listed`);

    // Claim 2: the longer track sets the length.
    if (res.bytes !== expectedBytes) fails.push(`mix ${res.bytes} bytes, expected ${expectedBytes}`);
    if (Math.abs(res.seconds - ME_SECONDS) > 0.01) {
      fails.push(`mix reported ${res.seconds}s, expected ${ME_SECONDS}s`);
    }

    // Claims 1 and 3: summed, and saturated rather than wrapped.
    if (Math.abs(res.overlapped - 1) > 0.001) {
      fails.push(`overlap sample ${res.overlapped}, expected ~1.0 (clamped)`);
    }
    if (Math.abs(res.meOnly - ME_LEVEL) > 0.001) {
      fails.push(`past the short track the mix reads ${res.meOnly}, expected ${ME_LEVEL}`);
    }

    // Claim 4: a WAV a media element will accept, over a URL it can load.
    const h = res.header;
    if (h.riff !== 'RIFF' || h.wave !== 'WAVE' || h.data !== 'data') {
      fails.push(`mix header chunks ${h.riff}/${h.wave}/${h.data}`);
    }
    if (h.format !== 1) fails.push(`mix format ${h.format}, expected 1 (PCM)`);
    if (h.channels !== 1) fails.push(`mix channels ${h.channels}, expected 1`);
    if (h.bits !== 16) fails.push(`mix bit depth ${h.bits}, expected 16`);
    if (h.sampleRate !== SAMPLE_RATE) fails.push(`mix sampleRate ${h.sampleRate}`);
    if (h.dataBytes !== res.bytes - 44) {
      fails.push(`mix header declares ${h.dataBytes} data bytes, file carries ${res.bytes - 44}`);
    }
    if (!res.url.startsWith('file:///')) fails.push(`mix url is not a file URL: ${res.url}`);

    // Claim 5: cached.
    if (!res.sameUrl) fails.push('a second request returned a different file');

    // Claim 6: names on disk, blanks dropped.
    if (res.labels['Them 2'] !== 'Priya') {
      fails.push(`labels did not round-trip: ${JSON.stringify(res.labels)}`);
    }
    if ('Me' in res.labels) fails.push('a blank name was stored instead of dropped');

    // Claim 7: the path guard.
    if (res.traversal !== 'rejected') fails.push('an id escaped the recordings root');

    if (fails.length === 0) {
      console.log('RESULT: PASS');
      clearTimeout(timer);
      app.exit(0);
    } else {
      fails.forEach((f) => console.log(`  FAIL: ${f}`));
      console.log('RESULT: FAIL');
      clearTimeout(timer);
      app.exit(2);
    }
  } catch (e) {
    console.error('RESULT: FAIL', e);
    clearTimeout(timer);
    app.exit(1);
  } finally {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});
