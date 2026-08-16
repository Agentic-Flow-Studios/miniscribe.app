import path from 'node:path';
import fs from 'node:fs';
import { getModelsDir, loadSettings, MODEL_CATALOG } from './model-manager';

// sherpa-onnx-node is a native (N-API) CommonJS addon. It's marked external in the
// esbuild config, so this require() stays intact and resolves at runtime from
// node_modules. `require` is provided by esbuild's CJS/node output.
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports
const sherpa: any = require('sherpa-onnx-node');

const SAMPLE_RATE = 16000;
const VAD_WINDOW = 512;

function getVadModelPath(): string {
  return path.join(getModelsDir(), 'silero_vad.onnx');
}

function getSegModelPath(): string {
  return path.join(getModelsDir(), 'sherpa-onnx-pyannote-segmentation-3-0', 'model.onnx');
}

function getEmbModelPath(): string {
  return path.join(getModelsDir(), 'nemo_en_titanet_small.onnx');
}

export interface TrackInput {
  samples: Float32Array;
  speaker: string; // 'Me' | 'Them'
  // Layer 3: separate multiple speakers within this track. numSpeakers = -1 (or
  // 0) means auto-detect via clustering threshold; a positive N forces N speakers.
  diarize?: boolean;
  numSpeakers?: number;
}

/** One word and the moment it starts, in seconds from the start of recording. */
export interface Word {
  t: number;
  text: string;
}

interface Utterance {
  start: number;
  end: number;
  text: string;
  words: Word[];
}

interface DiarSegment {
  start: number;
  end: number;
  speaker: number;
}

export interface TranscriptSegment {
  start: number; // seconds from recording start
  end: number; // seconds from recording start
  speaker: string;
  text: string;
  words: Word[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let recognizer: any = null;

export function resetRecognizer(): void {
  recognizer = null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getRecognizer(): any {
  if (recognizer) return recognizer;

  const modelsDir = getModelsDir();
  const settings = loadSettings();

  let spec = MODEL_CATALOG.find((m) => m.id === settings.activeModelId);
  if (!spec || !fs.existsSync(path.join(modelsDir, spec.folderName))) {
    spec = MODEL_CATALOG.find((m) => fs.existsSync(path.join(modelsDir, m.folderName)));
  }

  if (!spec) {
    throw new Error(
      `No Speech Recognition model installed in ${modelsDir}.\nPlease download a model in Settings.`,
    );
  }

  const modelFolder = path.join(modelsDir, spec.folderName);

  if (spec.type === 'nemo_transducer') {
    recognizer = new sherpa.OfflineRecognizer({
      featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
      modelConfig: {
        transducer: {
          encoder: path.join(modelFolder, 'encoder.int8.onnx'),
          decoder: path.join(modelFolder, 'decoder.int8.onnx'),
          joiner: path.join(modelFolder, 'joiner.int8.onnx'),
        },
        tokens: path.join(modelFolder, 'tokens.txt'),
        numThreads: 2,
        provider: 'cpu',
        debug: 0,
        modelType: 'nemo_transducer',
      },
    });
  } else {
    // whisper
    const files = fs.readdirSync(modelFolder);
    const encoderFile = files.find((f: string) => f.includes('encoder') && f.endsWith('.onnx')) ?? 'encoder.onnx';
    const decoderFile = files.find((f: string) => f.includes('decoder') && f.endsWith('.onnx')) ?? 'decoder.onnx';

    recognizer = new sherpa.OfflineRecognizer({
      featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
      modelConfig: {
        whisper: {
          encoder: path.join(modelFolder, encoderFile),
          decoder: path.join(modelFolder, decoderFile),
          language: 'en',
          task: 'transcribe',
        },
        tokens: path.join(modelFolder, 'tokens.txt'),
        numThreads: 2,
        provider: 'cpu',
        debug: 0,
        modelType: 'whisper',
      },
    });
  }

  return recognizer;
}

// A fresh VAD per call keeps state from bleeding between tracks. It's a tiny
// (~640KB) model, so the construction cost is negligible next to the recognizer.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeVad(): any {
  const vadModel = getVadModelPath();
  if (!fs.existsSync(vadModel)) {
    throw new Error(`VAD model not found at ${vadModel}.\nPlease download models in Settings.`);
  }
  return new sherpa.Vad(
    {
      sileroVad: {
        model: vadModel,
        threshold: 0.5,
        minSpeechDuration: 0.25,
        minSilenceDuration: 0.5,
        maxSpeechDuration: 4,
        windowSize: VAD_WINDOW,
      },
      sampleRate: SAMPLE_RATE,
      numThreads: 1,
      debug: false,
    },
    60,
  );
}

// Speaker diarization (Layer 3). Loads a pyannote segmentation model + a speaker
// embedding model. Cached and rebuilt only when the requested cluster count
// changes (numClusters is fixed at construction time).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let diarizer: any = null;
let diarizerClusters = Number.NaN;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getDiarizer(numClusters: number): any {
  if (diarizer && diarizerClusters === numClusters) return diarizer;
  const seg = getSegModelPath();
  const emb = getEmbModelPath();
  for (const m of [seg, emb]) {
    if (!fs.existsSync(m)) {
      throw new Error(`Diarization model not found at ${m}.\nPlease download models in Settings.`);
    }
  }
  diarizer = new sherpa.OfflineSpeakerDiarization({
    segmentation: { pyannote: { model: seg } },
    embedding: { model: emb },
    clustering: {
      // -1 = auto (use threshold); a positive N forces exactly N speakers.
      // If you know the speaker count, PASS IT — auto mode is far less reliable.
      numClusters: numClusters > 0 ? numClusters : -1,
      // Auto-mode knob: larger threshold => FEWER speakers. 0.5 over-clustered a
      // 4-speaker sample into 8; 0.7 is a saner meeting default. Tune per audio.
      threshold: 0.7,
    },
    minDurationOn: 0.2,
    minDurationOff: 0.5,
  });
  diarizerClusters = numClusters;
  return diarizer;
}

/**
 * Group the recogniser's per-token timestamps into words.
 *
 * Parakeet emits BPE pieces, and a piece that STARTS WITH A SPACE is the start
 * of a new word (" J", "e", "j", "u" -> "Jeju"). The timestamps are relative to
 * the segment that was decoded, so they are shifted onto the recording's clock
 * here — the same clock the line's start and end already use.
 *
 * The model exposes a `words` field too, but it only populates for models
 * shipped with a word-boundary head; on Parakeet it comes back empty.
 */
function wordsFrom(tokens: unknown, timestamps: unknown, offset: number): Word[] {
  if (!Array.isArray(tokens) || !Array.isArray(timestamps)) return [];
  const out: Word[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = String(tokens[i]);
    const piece = token.trimStart();
    if (piece === '') continue;
    // A leading space opens a word; so does the first piece, whatever it looks
    // like, since there is nothing for it to attach to.
    if (piece !== token || out.length === 0) {
      out.push({ t: offset + (Number(timestamps[i]) || 0), text: piece });
    } else {
      out[out.length - 1].text += piece;
    }
  }
  return out;
}

/**
 * One track's VAD + ASR state, fed incrementally.
 *
 * This is the primitive both paths run on: live transcription pushes chunks as
 * they arrive off the audio thread, and batch transcription pushes the whole
 * buffer then flushes. Sharing one implementation is deliberate — two copies
 * would drift, and a timestamp discrepancy between live and final output is
 * exactly the kind of bug nobody notices until a meeting is already over.
 *
 * The VAD instance is long-lived, so `segment.start` keeps counting from the
 * first sample ever pushed. That's what makes utterance timestamps absolute, and
 * therefore comparable across tracks.
 */
export interface LiveTrack {
  /** Returns the utterances this push completed — usually none. */
  push(samples: Float32Array): Utterance[];
  /** Closes the trailing partial utterance. */
  flush(): Utterance[];
  /**
   * Whether the VAD is currently inside a speech segment. Drives the live
   * "speaking / transcribing" affordance: an utterance can be seconds away, and
   * without this the UI cannot tell "heard nothing" from "still listening".
   */
  isSpeaking(): boolean;
}

export function makeLiveTrack(): LiveTrack {
  const rec = getRecognizer();
  const vad = makeVad();
  // The VAD only accepts exact windows, and chunk sizes need not be a multiple
  // of one, so whatever is left over rides along to the next push.
  let pending = new Float32Array(0);

  const drain = (out: Utterance[]): void => {
    // NOTE: vad.front(false) — enableExternalBuffer=false. sherpa-onnx defaults
    // to returning segment samples as an EXTERNAL buffer, which Electron's main
    // process forbids ("External buffers are not allowed"). false copies into a
    // normal buffer instead.
    while (!vad.isEmpty()) {
      const segment = vad.front(false);
      const stream = rec.createStream();
      stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples: segment.samples });
      rec.decode(stream);
      const result = rec.getResult(stream);
      const text: string = (result.text ?? '').trim();
      if (text) {
        const start = segment.start / SAMPLE_RATE;
        out.push({
          start,
          end: (segment.start + segment.samples.length) / SAMPLE_RATE,
          text,
          words: wordsFrom(result.tokens, result.timestamps, start),
        });
      }
      vad.pop();
    }
  };

  return {
    push(samples: Float32Array): Utterance[] {
      const out: Utterance[] = [];
      let buf: Float32Array;
      if (pending.length === 0) {
        buf = samples;
      } else {
        buf = new Float32Array(pending.length + samples.length);
        buf.set(pending, 0);
        buf.set(samples, pending.length);
      }

      let i = 0;
      for (; i + VAD_WINDOW <= buf.length; i += VAD_WINDOW) {
        vad.acceptWaveform(buf.subarray(i, i + VAD_WINDOW));
        drain(out);
      }
      pending = buf.slice(i);
      return out;
    },

    isSpeaking(): boolean {
      return vad.isDetected();
    },

    flush(): Utterance[] {
      const out: Utterance[] = [];
      if (pending.length > 0) {
        // Pad the tail to a full window rather than dropping it; the padding is
        // silence, so the VAD reads it as the end of speech either way.
        const last = new Float32Array(VAD_WINDOW);
        last.set(pending);
        pending = new Float32Array(0);
        vad.acceptWaveform(last);
        drain(out);
      }
      vad.flush();
      drain(out);
      return out;
    },
  };
}

// Run one track through VAD → per-utterance ASR. Each utterance's timestamp is
// derived from the VAD segment's sample offset, so it's measured in seconds from
// the start of recording — directly comparable across tracks.
function transcribeUtterances(samples: Float32Array): Utterance[] {
  const track = makeLiveTrack();
  const out: Utterance[] = [];
  for (let i = 0; i < samples.length; i += VAD_WINDOW) {
    out.push(...track.push(samples.subarray(i, i + VAD_WINDOW)));
  }
  out.push(...track.flush());
  return out;
}

function overlap(a: Utterance, b: DiarSegment): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

// Assign each ASR utterance to the diarized speaker whose time span overlaps it
// most. Keeps clean VAD utterance boundaries while borrowing the "who" from
// diarization. Returns a 0-based speaker id per utterance (-1 = no overlap).
function assignSpeakers(utterances: Utterance[], diar: DiarSegment[]): number[] {
  return utterances.map((u) => {
    let best = -1;
    let bestOverlap = 0;
    for (const d of diar) {
      const ov = overlap(u, d);
      if (ov > bestOverlap) {
        bestOverlap = ov;
        best = d.speaker;
      }
    }
    return best;
  });
}

function transcribeTrack(track: TrackInput): TranscriptSegment[] {
  const utterances = transcribeUtterances(track.samples);
  if (utterances.length === 0) return [];

  if (!track.diarize) {
    return utterances.map((u) => ({ ...u, speaker: track.speaker }));
  }

  // Layer 3: diarize the whole track, then label each utterance by overlap.
  const sd = getDiarizer(track.numSpeakers ?? -1);
  if (sd.sampleRate !== SAMPLE_RATE) {
    throw new Error(`Diarizer expects ${sd.sampleRate}Hz, track is ${SAMPLE_RATE}Hz`);
  }
  const diar: DiarSegment[] = sd.process(track.samples);
  const ids = assignSpeakers(utterances, diar);

  return utterances.map((u, i) => ({
    ...u,
    // "Them 1", "Them 2", … — fall back to the bare track label if unmatched.
    speaker: ids[i] >= 0 ? `${track.speaker} ${ids[i] + 1}` : track.speaker,
  }));
}

export function transcribeTracks(tracks: TrackInput[]): TranscriptSegment[] {
  const all: TranscriptSegment[] = [];
  for (const t of tracks) {
    if (t.samples && t.samples.length > 0) {
      all.push(...transcribeTrack(t));
    }
  }
  all.sort((a, b) => a.start - b.start);
  return all;
}

export interface TrackFile {
  path: string;
  speaker: string;
  diarize?: boolean;
  numSpeakers?: number;
}

// Transcribe straight from the WAVs the recorder streamed to disk. The renderer
// no longer holds audio at all, so nothing has to cross IPC at Stop except a
// couple of file paths.
export function transcribeFiles(tracks: TrackFile[]): TranscriptSegment[] {
  return transcribeTracks(
    tracks.map((t) => {
      // enableExternalBuffer=false for the same reason as vad.front() below:
      // Electron's main process rejects external buffers.
      const wave = sherpa.readWave(t.path, false);
      if (wave.sampleRate !== SAMPLE_RATE) {
        throw new Error(`${t.path} is ${wave.sampleRate}Hz, expected ${SAMPLE_RATE}Hz`);
      }
      return {
        samples: wave.samples,
        speaker: t.speaker,
        diarize: t.diarize,
        numSpeakers: t.numSpeakers,
      };
    }),
  );
}
