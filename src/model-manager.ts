import { app, type WebContents } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { Readable } from 'node:stream';
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

export function getModelsDir(): string {
  // Store in app userData/models (or fallback to root/models in dev test if app not ready)
  const base = app ? app.getPath('userData') : process.cwd();
  const dir = path.join(base, 'models');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getSettingsFile(): string {
  const base = app ? app.getPath('userData') : process.cwd();
  return path.join(base, 'settings.json');
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

async function extractArchive(archivePath: string, destDir: string): Promise<void> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      execSync(`tar -xf "${archivePath}" -C "${destDir}"`, { stdio: 'ignore' });
      return;
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

export async function downloadFileWithProgress(
  url: string,
  destPath: string,
  onProgress: (bytesReceived: number, totalBytes: number, speedMbps: number) => void,
): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`);
  }

  const contentLength = res.headers.get('content-length');
  const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;

  const out = fs.createWriteStream(destPath);
  let bytesReceived = 0;
  let startTime = Date.now();

  const reader = res.body.getReader();

  async function pump(): Promise<void> {
    const { done, value } = await reader.read();
    if (done) {
      out.end();
      return;
    }
    if (value) {
      bytesReceived += value.length;
      out.write(value);

      const elapsedSec = (Date.now() - startTime) / 1000;
      const speedMbps = elapsedSec > 0 ? bytesReceived / (1024 * 1024) / elapsedSec : 0;
      onProgress(bytesReceived, totalBytes, Math.round(speedMbps * 10) / 10);
    }
    await pump();
  }

  await pump();
  await new Promise((r) => setTimeout(r, 150));
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
    );

    console.log(`[model-manager] extracting ${spec.archiveName}...`);
    await extractArchive(archivePath, modelsDir);
    if (fs.existsSync(archivePath)) {
      fs.rmSync(archivePath);
    }

    // Check & download VAD and Diarization models if missing
    await ensureAuxiliaryModels();

    console.log(`[model-manager] ${spec.name} downloaded & ready.`);

    // Automatically set active if first model
    const settings = loadSettings();
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

export async function ensureAuxiliaryModels(): Promise<void> {
  const dir = getModelsDir();
  const BASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download';

  // 1. Silero VAD
  const vadPath = path.join(dir, 'silero_vad.onnx');
  if (!fs.existsSync(vadPath)) {
    console.log('[model-manager] downloading Silero VAD...');
    await downloadFileWithProgress(`${BASE}/asr-models/silero_vad.onnx`, vadPath, () => {});
  }

  // 2. Pyannote Segmentation
  const segDir = path.join(dir, 'sherpa-onnx-pyannote-segmentation-3-0');
  if (!fs.existsSync(segDir)) {
    console.log('[model-manager] downloading Segmentation model...');
    const archive = path.join(dir, 'sherpa-onnx-pyannote-segmentation-3-0.tar.bz2');
    await downloadFileWithProgress(
      `${BASE}/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2`,
      archive,
      () => {},
    );
    await extractArchive(archive, dir);
    if (fs.existsSync(archive)) fs.rmSync(archive);
  }

  // 3. TitaNet Embedding
  const embPath = path.join(dir, 'nemo_en_titanet_small.onnx');
  if (!fs.existsSync(embPath)) {
    console.log('[model-manager] downloading TitaNet Embedding...');
    await downloadFileWithProgress(
      `${BASE}/speaker-recongition-models/nemo_en_titanet_small.onnx`,
      embPath,
      () => {},
    );
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
