// Downloads and extracts the Parakeet ONNX model for sherpa-onnx.
// Uses the built-in Windows `tar` (bsdtar) to unpack the .tar.bz2.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const modelsDir = path.join(root, 'models');
const BASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models';

fs.mkdirSync(modelsDir, { recursive: true });

async function download(url, dest) {
  console.log('Downloading', url);
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  }
  const out = fs.createWriteStream(dest);
  await pipeline(Readable.fromWeb(res.body), out);
  // pipeline resolves on stream end; give the OS a tick to release the file
  // handle before a subsequent tar reads it (avoids an intermittent extract fail).
  await new Promise((r) => setTimeout(r, 100));
}

// bsdtar auto-detects bzip2. Retry once — extraction can fail transiently right
// after a large download while the file handle is still settling.
async function extract(archive, dir) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      // execFileSync: argv straight to tar, so a path containing a quote or a
      // space is passed correctly rather than reinterpreted by a shell.
      execFileSync('tar', ['-xf', archive, '-C', dir], { stdio: 'inherit' });
      return;
    } catch (e) {
      if (attempt === 2) throw e;
      console.log('Extract failed, retrying…');
      await new Promise((r) => setTimeout(r, 1000)); // ~1s wait
    }
  }
}

// 1. ASR model (Parakeet, ~600MB, tar.bz2)
const asrName = 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8';
const asrDir = path.join(modelsDir, asrName);
if (fs.existsSync(asrDir)) {
  console.log('ASR model already present:', asrDir);
} else {
  const archive = path.join(modelsDir, `${asrName}.tar.bz2`);
  await download(`${BASE}/${asrName}.tar.bz2`, archive);
  console.log('Extracting…');
  // -x extract, -f file; bsdtar auto-detects bzip2 compression.
  await extract(archive, modelsDir);
  fs.rmSync(archive);
  console.log('Done:', asrDir);
}

// 2. VAD model (Silero, ~640KB, plain .onnx) — used to segment each track into
// utterances with timestamps.
const vadDest = path.join(modelsDir, 'silero_vad.onnx');
if (fs.existsSync(vadDest)) {
  console.log('VAD model already present:', vadDest);
} else {
  await download(`${BASE}/silero_vad.onnx`, vadDest);
  console.log('Done:', vadDest);
}

// 3. Speaker diarization models (Layer 3) — separate multiple speakers on one
// track. Segmentation (pyannote, ~7MB tar) + speaker embedding (TitaNet, ~40MB).
const SEG_BASE =
  'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models';
const EMB_BASE =
  'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models';

const segName = 'sherpa-onnx-pyannote-segmentation-3-0';
const segDir = path.join(modelsDir, segName);
if (fs.existsSync(segDir)) {
  console.log('Segmentation model already present:', segDir);
} else {
  const archive = path.join(modelsDir, `${segName}.tar.bz2`);
  await download(`${SEG_BASE}/${segName}.tar.bz2`, archive);
  console.log('Extracting…');
  await extract(archive, modelsDir);
  fs.rmSync(archive);
  console.log('Done:', segDir);
}

const embDest = path.join(modelsDir, 'nemo_en_titanet_small.onnx');
if (fs.existsSync(embDest)) {
  console.log('Embedding model already present:', embDest);
} else {
  await download(`${EMB_BASE}/nemo_en_titanet_small.onnx`, embDest);
  console.log('Done:', embDest);
}
