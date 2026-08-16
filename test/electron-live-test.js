// Equivalence test: streaming the same audio in 128ms chunks must produce the
// same transcript as decoding the whole file at once.
//
// Live transcription pushes 2048-frame chunks into a long-lived VAD, so the
// utterance boundaries and their absolute timestamps now depend on state carried
// across pushes. If that drifts, live output and the diarized final pass would
// disagree about when things were said — and the only way to notice would be
// reading both transcripts of a real meeting side by side.
//
// Run: npx electron test/electron-live-test.js
const path = require('node:path');
const { app } = require('electron');
// Points userData at a throwaway dir with the repo's models linked in. Must come
// before anything reads a model path — see the file for why.
require('./user-data');
const sherpa = require('sherpa-onnx-node');
const { transcribeTracks, makeLiveTrack } = require('../dist/transcription.js');

const CHUNK = 2048; // what the AudioWorklet emits
// Same clean English sample the batch test uses, so a difference here is the
// streaming refactor and nothing else.
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
    const wave = sherpa.readWave(wavPath, false);
    console.log(`[test] wav: ${wave.sampleRate}Hz, ${wave.samples.length} samples`);

    // Batch: the known-good path.
    const batch = transcribeTracks([{ samples: wave.samples, speaker: 'Them' }]);

    // Live: same audio, arriving the way the capture layer delivers it.
    const track = makeLiveTrack();
    const live = [];
    for (let i = 0; i < wave.samples.length; i += CHUNK) {
      live.push(...track.push(wave.samples.subarray(i, i + CHUNK)));
    }
    live.push(...track.flush());

    console.log(`[test] batch: ${batch.length} utterances, live: ${live.length}`);
    for (const u of live) {
      console.log(`  [${u.start.toFixed(3)}-${u.end.toFixed(3)}] ${u.text}`);
    }

    const fails = [];
    if (live.length === 0) fails.push('live path produced nothing');
    if (batch.length !== live.length) {
      fails.push(`batch has ${batch.length} utterances, live has ${live.length}`);
    }

    const n = Math.min(batch.length, live.length);
    for (let i = 0; i < n; i++) {
      if (batch[i].text !== live[i].text) {
        fails.push(`utterance ${i} text differs:\n    batch: ${batch[i].text}\n    live:  ${live[i].text}`);
      }
      // Chunk boundaries land on different VAD windows than a single pass, so
      // allow a window of slack rather than demanding bit-identical offsets.
      for (const field of ['start', 'end']) {
        const delta = Math.abs(batch[i][field] - live[i][field]);
        if (delta > 0.05) {
          fails.push(
            `utterance ${i} ${field} differs by ${delta.toFixed(3)}s ` +
              `(batch ${batch[i][field].toFixed(3)}, live ${live[i][field].toFixed(3)})`,
          );
        }
      }
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
  }
});
