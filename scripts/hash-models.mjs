// Prints the SHA-256 of every model the app downloads, ready to paste into the
// `sha256` fields in src/model-manager.ts.
//
// Run this once whenever a catalog entry is added or its URL changes — the
// release assets themselves are immutable, so the values do not drift on their
// own and this is not a recurring chore.
//
//   npm run hash-models
//
// Nothing is written to disk: each file is streamed through the hash and
// discarded, so this costs bandwidth and no space.
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const SHERPA_RELEASES = 'https://github.com/k2-fsa/sherpa-onnx/releases/download';

// Kept in step with MODEL_CATALOG and AUXILIARY_MODELS in src/model-manager.ts.
const TARGETS = [
  ['parakeet-0.6b', `${SHERPA_RELEASES}/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2`],
  ['whisper-base-en', `${SHERPA_RELEASES}/asr-models/sherpa-onnx-whisper-base.en.tar.bz2`],
  ['whisper-small-en', `${SHERPA_RELEASES}/asr-models/sherpa-onnx-whisper-small.en.tar.bz2`],
  ['aux: silero vad', `${SHERPA_RELEASES}/asr-models/silero_vad.onnx`],
  ['aux: pyannote segmentation', `${SHERPA_RELEASES}/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2`],
  ['aux: titanet embedding', `${SHERPA_RELEASES}/speaker-recongition-models/nemo_en_titanet_small.onnx`],
];

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

for (const [label, url] of TARGETS) {
  process.stdout.write(`${label} … `);
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    console.log(`FAILED ${res.status} ${res.statusText}`);
    continue;
  }
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  await pipeline(Readable.fromWeb(res.body), async function* (source) {
    for await (const chunk of source) {
      bytes += chunk.length;
      hash.update(chunk);
    }
    // Consume only; there is no destination worth writing to.
  });
  console.log(`${hash.digest('hex')}  (${mb(bytes)})`);
}
