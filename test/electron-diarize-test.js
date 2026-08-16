// Headless Electron test for Layer 3 (speaker diarization) inside the MAIN
// process. Runs the full pipeline — VAD + Parakeet ASR + pyannote/TitaNet
// diarization — on a known 4-speaker WAV and checks we recover multiple
// distinct "Them N" speakers.
//
// Run: npx electron test/electron-diarize-test.js
const path = require('node:path');
const { app } = require('electron');
// Points userData at a throwaway dir with the repo's models linked in. Must come
// before anything reads a model path — see the file for why.
require('./user-data');
const sherpa = require('sherpa-onnx-node');
const { transcribeTracks } = require('../dist/transcription.js');

const wavPath = path.join(__dirname, '4-speakers.wav');

app.whenReady().then(() => {
  try {
    const wave = sherpa.readWave(wavPath, false);
    console.log(`[test] wav: ${wave.sampleRate}Hz, ${wave.samples.length} samples`);

    // This is a Chinese 4-speaker clip run through ENGLISH ASR + embedding models,
    // so the transcript TEXT will be gibberish — that's expected. We're proving
    // the diarization pipeline (multiple distinct speakers) end-to-end in Electron
    // main, not transcription accuracy. numSpeakers: 4 keeps it deterministic.
    const segments = transcribeTracks([
      { samples: wave.samples, speaker: 'Them', diarize: true, numSpeakers: 4 },
    ]);

    const speakers = new Set(segments.map((s) => s.speaker));
    for (const s of segments) {
      console.log(`[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.speaker}: ${s.text}`);
    }
    console.log(`[test] utterances: ${segments.length}, distinct speakers: ${speakers.size}`);

    if (segments.length > 0 && speakers.size >= 2) {
      console.log('RESULT: PASS');
      app.exit(0);
    } else {
      console.log('RESULT: FAIL (expected >=2 distinct speakers)');
      app.exit(2);
    }
  } catch (e) {
    console.error('RESULT: FAIL', e);
    app.exit(1);
  }
});
