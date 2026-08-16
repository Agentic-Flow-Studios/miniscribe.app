// Headless Electron regression test for the "External buffers are not allowed"
// bug. Runs the REAL transcription path (VAD segmentation + Parakeet ASR) inside
// an Electron MAIN process — the exact environment where vad.front() threw.
// Pass = the fixed vad.front(false) copy path works and we get text back.
//
// Run: npx electron test/electron-transcribe-test.js
const path = require('node:path');
const { app } = require('electron');
// Points userData at a throwaway dir with the repo's models linked in. Must come
// before anything reads a model path — see the file for why.
require('./user-data');
const sherpa = require('sherpa-onnx-node');
const { transcribeTracks } = require('../dist/transcription.js');

const wavPath = path.join(
  __dirname,
  '..',
  'models',
  'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8',
  'test_wavs',
  '0.wav',
);

app.whenReady().then(() => {
  try {
    // readWave with enableExternalBuffer=false (same reason as vad.front(false)).
    const wave = sherpa.readWave(wavPath, false);
    console.log(`[test] wav: ${wave.sampleRate}Hz, ${wave.samples.length} samples`);

    const segments = transcribeTracks([{ samples: wave.samples, speaker: 'Test' }]);

    console.log('[test] segments:', JSON.stringify(segments, null, 2));
    if (segments.length > 0 && segments.every((s) => s.text.length > 0)) {
      console.log('RESULT: PASS');
      app.exit(0);
    } else {
      console.log('RESULT: FAIL (no transcript produced)');
      app.exit(2);
    }
  } catch (e) {
    console.error('RESULT: FAIL', e);
    app.exit(1);
  }
});
