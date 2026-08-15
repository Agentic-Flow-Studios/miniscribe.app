// Headless test for the AudioWorklet capture path. Drives the REAL worklet with
// a synthetic oscillator instead of a microphone, so it runs in CI with no audio
// hardware, no permissions and no human.
//
// The failure this exists to catch is silence: a wrong addModule path, a
// processor that never registers, or a node that isn't pulled by the graph all
// produce zero chunks and zero errors. That looks identical to "nobody spoke".
//
// Run: npx electron test/electron-capture-test.js
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

// An AudioContext started without a user gesture would otherwise stay suspended.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const SAMPLE_RATE = 16000;
const CHUNK = 2048; // must match capture-worklet.js
const RECORD_MS = 1500;

const script = `(async () => {
  const ctx = new AudioContext({ sampleRate: ${SAMPLE_RATE} });
  await ctx.audioWorklet.addModule('../../dist/capture-worklet.js');
  await ctx.resume();

  const osc = ctx.createOscillator();
  osc.frequency.value = 440;
  const node = new AudioWorkletNode(ctx, 'capture', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 1,
    channelCountMode: 'explicit',
  });
  const mute = ctx.createGain();
  mute.gain.value = 0;
  osc.connect(node);
  node.connect(mute);
  mute.connect(ctx.destination);

  const chunks = [];
  node.port.onmessage = (e) => chunks.push({
    frame: e.data.frame,
    len: e.data.samples.length,
    peak: e.data.peak,
    bytes: e.data.samples.buffer.byteLength,
  });

  osc.start();
  await new Promise((r) => setTimeout(r, ${RECORD_MS}));
  // Same flush handshake stop() uses; the tail chunk should arrive short.
  node.port.postMessage('flush');
  await new Promise((r) => setTimeout(r, 100));
  osc.stop();
  await ctx.close();
  return { chunks, state: 'closed' };
})()`;

function check(chunks) {
  const fails = [];

  if (chunks.length === 0) {
    fails.push('no chunks received at all — worklet never ran (check the addModule path)');
    return fails;
  }

  // ~1.5s of audio in 128ms chunks. Allow slack for startup, but a big shortfall
  // means the audio thread was starved, which is the whole thing we moved off
  // the main thread to prevent.
  const expected = Math.floor((RECORD_MS / 1000) * SAMPLE_RATE / CHUNK);
  if (chunks.length < expected - 2) {
    fails.push(`only ${chunks.length} chunks, expected ~${expected}`);
  }

  // Contiguity is the real assertion: frame indices must tile with no holes,
  // because a hole is exactly what a dropped buffer looks like downstream.
  for (let i = 1; i < chunks.length; i++) {
    const want = chunks[i - 1].frame + chunks[i - 1].len;
    if (chunks[i].frame !== want) {
      fails.push(`gap at chunk ${i}: frame ${chunks[i].frame}, expected ${want}`);
      break;
    }
  }

  // Every chunk but the flushed tail should be full size.
  const wrong = chunks.slice(0, -1).filter((c) => c.len !== CHUNK);
  if (wrong.length > 0) fails.push(`${wrong.length} chunks not ${CHUNK} frames`);

  // A 440Hz oscillator peaks near 1.0. Near-zero means the node is connected but
  // receiving nothing.
  const quiet = chunks.filter((c) => c.peak < 0.5);
  if (quiet.length > 1) fails.push(`${quiet.length} chunks below peak 0.5 (silent input?)`);

  // Transfer can't be observed from this side — it detaches the SENDER's buffer,
  // and the receiver always gets a live one. What is worth asserting is that the
  // buffer arrived exactly sized: a short buffer would mean the worklet
  // transferred its reused scratch array instead of the slice, which would
  // corrupt every subsequent chunk.
  const ragged = chunks.filter((c) => c.bytes !== c.len * 4);
  if (ragged.length > 0) fails.push(`${ragged.length} chunks with mismatched buffer size`);

  return fails;
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      // A hidden window gets its timers throttled, which would starve the
      // capture graph and fail the test for the wrong reason.
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  try {
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    const { chunks } = await win.webContents.executeJavaScript(script);

    const last = chunks[chunks.length - 1];
    console.log(
      `[test] ${chunks.length} chunks, ` +
        `frames ${chunks[0]?.frame}..${last ? last.frame + last.len : 0}, ` +
        `tail ${last?.len} frames, peak ${last?.peak.toFixed(3)}`,
    );

    const fails = check(chunks);
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
