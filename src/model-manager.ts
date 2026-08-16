import { app, type WebContents } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export type ModelType = 'nemo_transducer' | 'whisper';

export interface ModelSpec {
  id: string;
  name: string;
  type: ModelType;
  description: string;
  sizeMb: number;
  downloadUrl: string;
  archiveName: string;
  folderName: string;
  /**
   * SHA-256 of the downloaded file, lowercase hex.
   *
   * These are hundreds of megabytes of neural network that the app then loads
   * and executes, fetched from a release host this project does not control.
   * TLS proves who served the bytes, not that they are the bytes this build was
   * written against — so the hash is checked before anything is extracted.
   *
   * The URLs point at immutable release assets, so a hash only ever changes
   * when an entry in this catalog changes, which is a code edit already. Run
   * `npm run hash-models` to print the current values.
   *
   * Optional so a catalog entry can be added before its hash is known; an entry
   * without one downloads unverified and says so in the log.
   */
  sha256?: string;
}

export const MODEL_CATALOG: ModelSpec[] = [
  {
    id: 'parakeet-0.6b',
    name: 'Parakeet TDT 0.6B (Recommended)',
    type: 'nemo_transducer',
    description: 'Fastest local ASR, ultra-low latency, highly accurate for English.',
    sizeMb: 600,
    downloadUrl:
      'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2',
    archiveName: 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2',
    folderName: 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8',
  },
  {
    id: 'whisper-base-en',
    name: 'OpenAI Whisper Base (.en)',
    type: 'whisper',
    description: 'Compact & lightweight model by OpenAI, great for lower memory devices.',
    sizeMb: 140,
    downloadUrl:
      'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-base.en.tar.bz2',
    archiveName: 'sherpa-onnx-whisper-base.en.tar.bz2',
    folderName: 'sherpa-onnx-whisper-base.en',
  },
  {
    id: 'whisper-small-en',
    name: 'OpenAI Whisper Small (.en)',
    type: 'whisper',
    description: 'High accuracy Whisper model, handles background noise & accents well.',
    sizeMb: 480,
    downloadUrl:
      'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-small.en.tar.bz2',
    archiveName: 'sherpa-onnx-whisper-small.en.tar.bz2',
    folderName: 'sherpa-onnx-whisper-small.en',
  },
];

export interface ModelStatus {
  id: string;
  isInstalled: boolean;
  isActive: boolean;
  isDownloading: boolean;
  progressPct: number;
  downloadSpeedMb: number;
}

export interface AppSettings {
  activeModelId: string;
}

let activeClient: WebContents | null = null;
let currentDownloadingModelId: string | null = null;

/**
 * Where main tells the ASR worker to look. The worker runs in a utilityProcess,
 * and `require('electron')` there exposes only `net` and `systemPreferences` —
 * there is no `app` to ask for userData. Left to guess, it falls back to the
 * working directory, which in a packaged app is the install folder: main
 * downloads a model to userData and the worker then reports no model installed.
 * So main passes its own answer down in the environment when it forks.
 */
export const USER_DATA_ENV = 'MINISCRIBE_USER_DATA';

/** The one directory both processes must agree on. */
function userDataDir(): string {
  if (app) return app.getPath('userData');
  return process.env[USER_DATA_ENV] || process.cwd();
}

export function getModelsDir(): string {
  const dir = path.join(userDataDir(), 'models');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getSettingsFile(): string {
  return path.join(userDataDir(), 'settings.json');
}

export function loadSettings(): AppSettings {
  const file = getSettingsFile();
  if (fs.existsSync(file)) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (data && typeof data.activeModelId === 'string') {
        return { activeModelId: data.activeModelId };
      }
    } catch (e) {
      console.warn('[model-manager] error reading settings:', e);
    }
  }
  return { activeModelId: 'parakeet-0.6b' };
}

export function saveSettings(settings: AppSettings): void {
  const file = getSettingsFile();
  fs.writeFileSync(file, JSON.stringify(settings, null, 2));
}

export function isModelInstalled(spec: ModelSpec): boolean {
  const dir = path.join(getModelsDir(), spec.folderName);
  return fs.existsSync(dir);
}

export function listModelStatuses(): ModelStatus[] {
  const settings = loadSettings();
  return MODEL_CATALOG.map((spec) => ({
    id: spec.id,
    isInstalled: isModelInstalled(spec),
    isActive: settings.activeModelId === spec.id,
    isDownloading: currentDownloadingModelId === spec.id,
    progressPct: 0,
    downloadSpeedMb: 0,
  }));
}

// execFileSync, not execSync: the archive path contains the user's home
// directory, so building a shell command string out of it means a quote or a
// backtick in an account name lands in a shell. This form passes argv straight
// to tar with no shell in between, and needs no quoting to be correct.
async function extractArchive(archivePath: string, destDir: string): Promise<void> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      execFileSync('tar', ['-xf', archivePath, '-C', destDir], { stdio: 'ignore' });
      return;
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

/** How often progress crosses IPC, at most. */
const PROGRESS_INTERVAL_MS = 250;

export async function downloadFileWithProgress(
  url: string,
  destPath: string,
  onProgress: (bytesReceived: number, totalBytes: number, speedMbps: number) => void,
  expectedSha256?: string,
): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`);
  }

  const contentLength = res.headers.get('content-length');
  const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;

  const hash = crypto.createHash('sha256');
  const startTime = Date.now();
  let bytesReceived = 0;
  let lastReport = 0;

  const report = (): void => {
    const elapsedSec = (Date.now() - startTime) / 1000;
    // MB/s, not Mbps — this is what the readout beside the bar is labelled.
    const speed = elapsedSec > 0 ? bytesReceived / (1024 * 1024) / elapsedSec : 0;
    onProgress(bytesReceived, totalBytes, Math.round(speed * 10) / 10);
  };

  // Counting and hashing happen in the middle of the pipe rather than in a read
  // loop, so backpressure is preserved end to end: a slow disk slows the socket
  // instead of queueing the difference in memory. The previous version pushed
  // every chunk into an unbounded write queue, which on a 600MB model meant the
  // whole download could sit in the heap.
  const tap = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      hash.update(chunk);
      bytesReceived += chunk.length;
      // Throttled: a 600MB download is tens of thousands of chunks, and a
      // progress bar redrawing faster than the screen refreshes only costs IPC.
      const now = Date.now();
      if (now - lastReport >= PROGRESS_INTERVAL_MS) {
        lastReport = now;
        report();
      }
      cb(null, chunk);
    },
  });

  await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), tap, fs.createWriteStream(destPath));
  // The throttle can swallow the last update, and a bar stuck at 97% reads as a
  // hang. Always land on the true final figure.
  report();

  const digest = hash.digest('hex');
  if (expectedSha256 && digest !== expectedSha256.toLowerCase()) {
    // Delete first, throw second: a file that failed verification must not be
    // left somewhere a later run could mistake for a good download.
    fs.rmSync(destPath, { force: true });
    throw new Error(
      `Checksum mismatch for ${path.basename(destPath)}.\n` +
        `Expected ${expectedSha256.toLowerCase()}\n` +
        `Got      ${digest}\n` +
        'The download was discarded. Try again; if it keeps failing, report it.',
    );
  }
  if (!expectedSha256) {
    console.warn(`[model-manager] no sha256 for ${path.basename(destPath)}; got ${digest}`);
  }
}

export async function downloadModel(
  modelId: string,
  clientWebContents: WebContents,
): Promise<void> {
  const spec = MODEL_CATALOG.find((m) => m.id === modelId);
  if (!spec) throw new Error(`Unknown model ID: ${modelId}`);

  activeClient = clientWebContents;
  currentDownloadingModelId = modelId;

  const modelsDir = getModelsDir();
  const archivePath = path.join(modelsDir, spec.archiveName);

  try {
    console.log(`[model-manager] starting download for ${spec.name}...`);

    await downloadFileWithProgress(
      spec.downloadUrl,
      archivePath,
      (received, total, speed) => {
        const pct = total > 0 ? Math.round((received / total) * 100) : 0;
        activeClient?.send('models:progress', {
          id: modelId,
          progressPct: pct,
          downloadSpeedMb: speed,
        });
      },
      spec.sha256,
    );

    console.log(`[model-manager] extracting ${spec.archiveName}...`);
    await extractArchive(archivePath, modelsDir);
    if (fs.existsSync(archivePath)) {
      fs.rmSync(archivePath);
    }

    // Check & download VAD and Diarization models if missing
    await ensureAuxiliaryModels();

    console.log(`[model-manager] ${spec.name} downloaded & ready.`);

    // A model the user just chose to download is the one they want to use.
    saveSettings({ activeModelId: modelId });

    currentDownloadingModelId = null;
    activeClient?.send('models:progress', {
      id: modelId,
      progressPct: 100,
      downloadSpeedMb: 0,
      completed: true,
    });
  } catch (err) {
    currentDownloadingModelId = null;
    if (fs.existsSync(archivePath)) {
      fs.rmSync(archivePath, { force: true });
    }
    console.error(`[model-manager] download error:`, err);
    throw err;
  }
}

const SHERPA_RELEASES = 'https://github.com/k2-fsa/sherpa-onnx/releases/download';

/**
 * The models every ASR model needs alongside it: voice activity detection, and
 * the segmentation + embedding pair that diarization runs on. Same integrity
 * rule as MODEL_CATALOG — see ModelSpec.sha256.
 */
export const AUXILIARY_MODELS = [
  {
    label: 'Silero VAD',
    url: `${SHERPA_RELEASES}/asr-models/silero_vad.onnx`,
    /** Present when this is done: for an archive, the extracted directory. */
    target: 'silero_vad.onnx',
    archive: false,
    sha256: undefined as string | undefined,
  },
  {
    label: 'Pyannote segmentation',
    url: `${SHERPA_RELEASES}/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2`,
    target: 'sherpa-onnx-pyannote-segmentation-3-0',
    archive: true,
    sha256: undefined as string | undefined,
  },
  {
    label: 'TitaNet speaker embedding',
    url: `${SHERPA_RELEASES}/speaker-recongition-models/nemo_en_titanet_small.onnx`,
    target: 'nemo_en_titanet_small.onnx',
    archive: false,
    sha256: undefined as string | undefined,
  },
];

export async function ensureAuxiliaryModels(): Promise<void> {
  const dir = getModelsDir();

  for (const m of AUXILIARY_MODELS) {
    if (fs.existsSync(path.join(dir, m.target))) continue;
    console.log(`[model-manager] downloading ${m.label}...`);

    if (!m.archive) {
      await downloadFileWithProgress(m.url, path.join(dir, m.target), () => {}, m.sha256);
      continue;
    }

    const archive = path.join(dir, path.basename(m.url));
    await downloadFileWithProgress(m.url, archive, () => {}, m.sha256);
    await extractArchive(archive, dir);
    if (fs.existsSync(archive)) fs.rmSync(archive, { force: true });
  }
}

export function deleteModel(modelId: string): void {
  const spec = MODEL_CATALOG.find((m) => m.id === modelId);
  if (!spec) return;
  const folder = path.join(getModelsDir(), spec.folderName);
  if (fs.existsSync(folder)) {
    fs.rmSync(folder, { recursive: true, force: true });
  }
}
