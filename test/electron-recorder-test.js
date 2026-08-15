// Headless test for the incremental WAV recorder.
//
// Two claims to prove:
//   1. What we write is readable by the same sherpa readWave the transcribe path
//      uses — a recorder that produces files the pipeline can't open is worse
//      than useless, and it would only surface at Stop.
//   2. The file is valid MID-RECORDING, before close() ever runs. That's the
//      crash-resilience claim: the header is re-stamped every chunk, so a kill
//      at minute 30 costs the last 128ms rather than the whole meeting.
//
// Run: npx electron test/electron-recorder-test.js
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');
const sherpa = require('sherpa-onnx-node');
const { WavWriter, SAMPLE_RATE } = require('../dist/recorder.js');

const CHUNK = 2048;
const CHUNKS = 8; // ~1s

// 440Hz at full scale, in the same chunk size the worklet emits.
function sine(index) {
  const out = new Float32Array(CHUNK);
  for (let i = 0; i < CHUNK; i++) {
    out[i] = Math.sin((2 * Math.PI * 440 * (index * CHUNK + i)) / SAMPLE_RATE);
  }
  return out;
}

function peakOf(samples) {
  let p = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > p) p = a;
  }
  return p;
}

app.whenReady().then(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-capture-'));
  const wavPath = path.join(dir, 'me.wav');
  const fails = [];

  try {
    const w = new WavWriter(wavPath);
    for (let i = 0; i < CHUNKS; i++) w.append(sine(i));

    // --- Claim 2: valid while still open, no close() yet ---
    const partial = sherpa.readWave(wavPath, false);
    console.log(
      `[test] mid-recording read: ${partial.sampleRate}Hz, ${partial.samples.length} samples`,
    );
    if (partial.samples.length !== CHUNK * CHUNKS) {
      fails.push(`mid-recording length ${partial.samples.length}, expected ${CHUNK * CHUNKS}`);
    }

    // Two more chunks, then close.
    for (let i = CHUNKS; i < CHUNKS + 2; i++) w.append(sine(i));
    w.close();

    // --- Claim 1: readable by the transcribe path ---
    const wave = sherpa.readWave(wavPath, false);
    const expected = CHUNK * (CHUNKS + 2);
    console.log(
      `[test] final read: ${wave.sampleRate}Hz, ${wave.samples.length} samples, ` +
        `${w.seconds.toFixed(3)}s, peak ${peakOf(wave.samples).toFixed(4)}`,
    );

    if (wave.sampleRate !== SAMPLE_RATE) {
      fails.push(`sampleRate ${wave.sampleRate}, expected ${SAMPLE_RATE}`);
    }
    if (wave.samples.length !== expected) {
      fails.push(`length ${wave.samples.length}, expected ${expected}`);
    }
    if (w.frames !== expected) {
      fails.push(`writer reported ${w.frames} frames, expected ${expected}`);
    }
    // Full-scale sine survives the float -> int16 round trip to ~3 decimals.
    const peak = peakOf(wave.samples);
    if (Math.abs(peak - 1) > 0.001) fails.push(`peak ${peak.toFixed(4)}, expected ~1.0`);

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
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
