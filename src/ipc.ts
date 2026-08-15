import { app, BrowserWindow, dialog, ipcMain, utilityProcess, type UtilityProcess, type WebContents } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { transcribeFiles, resetRecognizer, type TrackFile } from './transcription';
import { WavWriter, wavHeader, SAMPLE_RATE } from './recorder';
import type { TrackKind } from './capture-types';
import type { WorkerIn, WorkerOut } from './asr-worker';
import {
  listModelStatuses,
  downloadModel,
  deleteModel,
  saveSettings,
  MODEL_CATALOG,
} from './model-manager';

// Split out of main.ts so tests can register the same handlers against their own
// BrowserWindow without also spawning the app's real window.

const recorders = new Map<TrackKind, WavWriter>();
let sessionDir: string | null = null;
let client: WebContents | null = null;

const TRACK_KINDS: TrackKind[] = ['me', 'them'];

function recordingsRoot(): string {
  return path.join(app.getPath('userData'), 'recordings');
}

// Duration from the WAV header alone. The alternative — sherpa's readWave —
// decodes the entire file, which for a listing of 30-minute meetings means
// reading hundreds of megabytes to render a sidebar.
function wavSeconds(file: string): number {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(44);
    if (fs.readSync(fd, head, 0, 44, 0) < 44) return 0;
    const sampleRate = head.readUInt32LE(24);
    const bytesPerFrame = head.readUInt16LE(32) || 2;
    const dataBytes = head.readUInt32LE(40);
    if (!sampleRate) return 0;
    return dataBytes / bytesPerFrame / sampleRate;
  } finally {
    fs.closeSync(fd);
  }
}

// Every path a renderer request can reach is resolved from an id under the
// recordings root, here. The renderer never names a file, so it cannot aim a
// read at an arbitrary place on disk.
function recordingDir(id: string): string {
  const dir = path.join(recordingsRoot(), id);
  if (path.dirname(dir) !== recordingsRoot() || !fs.existsSync(dir)) {
    throw new Error(`No such recording: ${id}`);
  }
  return dir;
}

// --- Speaker labels -------------------------------------------------------
// Diarization can only ever produce anonymous cluster ids ("Them 2"); who that
// actually is, only the user knows. Names live beside the audio rather than in
// the transcript, because re-transcribing rebuilds every segment from scratch
// and would throw away anything stored on one.

const LABELS_FILE = 'labels.json';

function readLabels(dir: string): Record<string, string> {
  const file = path.join(dir, LABELS_FILE);
  if (!fs.existsSync(file)) return {};
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        ([, v]) => typeof v === 'string' && v !== '',
      ),
    ) as Record<string, string>;
  } catch (err) {
    // A half-written or hand-edited file costs the names, not the transcript.
    console.warn(`[recordings] ignoring unreadable ${LABELS_FILE} in ${dir}:`, err);
    return {};
  }
}

// --- Playback audio -------------------------------------------------------
// The two tracks are one timeline recorded twice, so following a transcript
// means hearing them together. They are summed into a single `mix.wav` beside
// them, cached, and handed to the renderer as a file:// URL — the media element
// then streams and seeks it itself, which is what makes scrubbing a
// 45-minute meeting free rather than an 86MB trip across IPC.

const MIX_FILE = 'mix.wav';

/** 16-bit PCM frames of one of our own WAVs. Header is a fixed 44 bytes. */
function readPcm(file: string): Int16Array {
  const buf = fs.readFileSync(file);
  if (buf.length <= 44) return new Int16Array(0);
  const frames = (buf.length - 44) >> 1;
  const out = new Int16Array(frames);
  for (let i = 0; i < frames; i++) out[i] = buf.readInt16LE(44 + i * 2);
  return out;
}

function mixPath(dir: string): string {
  const out = path.join(dir, MIX_FILE);
  const sources = TRACK_KINDS.map((k) => path.join(dir, `${k}.wav`)).filter((f) =>
    fs.existsSync(f),
  );
  if (sources.length === 0) throw new Error('This recording has no audio');

  // Rebuild only when a source is newer than the mix. Re-transcribing never
  // touches the WAVs, so in practice this runs once per recording.
  if (fs.existsSync(out)) {
    const mixedAt = fs.statSync(out).mtimeMs;
    if (sources.every((f) => fs.statSync(f).mtimeMs <= mixedAt)) return out;
  }

  const tracks = sources.map(readPcm);
  const frames = Math.max(...tracks.map((t) => t.length));
  const pcm = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (const t of tracks) sum += i < t.length ? t[i] : 0;
    // Clamp rather than halve. Halving would quieten a whole meeting to guard
    // against the rare moment both sides talk at once; clamping only distorts
    // that moment.
    pcm.writeInt16LE(Math.max(-32768, Math.min(32767, sum)), i * 2);
  }
  fs.writeFileSync(out, Buffer.concat([wavHeader(SAMPLE_RATE, pcm.length), pcm]));
  return out;
}

export interface RecordingSummary {
  /** Directory name, also the ISO-ish timestamp the session started. */
  id: string;
  startedAt: string;
  seconds: number;
  tracks: TrackKind[];
}

function listRecordings(): RecordingSummary[] {
  const root = recordingsRoot();
  if (!fs.existsSync(root)) return [];

  const out: RecordingSummary[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    const tracks = TRACK_KINDS.filter((k) => fs.existsSync(path.join(dir, `${k}.wav`)));
    // A directory with no WAVs is a session that was started and immediately
    // stopped, or one that failed before capture. Nothing to offer.
    if (tracks.length === 0) continue;
    const seconds = Math.max(...tracks.map((k) => wavSeconds(path.join(dir, `${k}.wav`))));
    out.push({
      id: entry.name,
      // Directory names are ISO stamps with : and . replaced, so put them back
      // to get something Date can parse: 2026-08-11T14-32-05-123Z.
      startedAt: entry.name.replace(
        /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/,
        '$1T$2:$3:$4.$5Z',
      ),
      seconds,
      tracks,
    });
  }
  // Newest first: the session you just recorded is the one you want.
  out.sort((a, b) => b.id.localeCompare(a.id));
  return out;
}

// --- ASR worker -----------------------------------------------------------
// One long-lived utilityProcess. Kept warm across recordings so the model loads
// once, at app start, rather than in front of the first utterance.

let asr: UtilityProcess | null = null;
let onFlushed: (() => void) | null = null;

function send(msg: WorkerIn): void {
  asr?.postMessage(msg);
}

function ensureAsr(): UtilityProcess {
  if (asr) return asr;
  const proc = utilityProcess.fork(path.join(__dirname, 'asr-worker.js'));
  proc.on('message', (msg: WorkerOut) => {
    switch (msg.type) {
      case 'utterance':
        // Straight through to the renderer, which appends it to its column.
        client?.send('live:utterance', msg);
        break;
      case 'activity':
        // Speech started/stopped on a track — drives the live indicator while
        // the utterance itself is still being segmented.
        client?.send('live:activity', msg);
        break;
      case 'flushed':
        onFlushed?.();
        onFlushed = null;
        break;
      case 'error':
        console.error('[asr]', msg.message);
        client?.send('live:error', msg.message);
        break;
      case 'ready':
        console.log('[asr] model loaded');
        break;
    }
  });
  proc.on('exit', () => {
    asr = null;
    // Unblock a pending stop rather than hanging on a worker that died.
    onFlushed?.();
    onFlushed = null;
  });
  asr = proc;
  return proc;
}

export function registerIpc(): void {
  // ipcMain handlers can be registered at any time, but utilityProcess.fork
  // throws before the app is ready — and registerIpc() is called at module load
  // in main.ts. Defer only the fork, so this function stays safe to call from
  // either side of ready.
  void app.whenReady().then(() => {
    ensureAsr();
    send({ type: 'warmup' });
  });

  // --- Recording ----------------------------------------------------------
  // The renderer streams 128ms chunks here as they leave the audio thread. Each
  // chunk has two consumers: a WAV on disk, and the ASR worker for live output.
  // Nothing accumulates in the renderer heap, and a crash costs at most the last
  // chunk.

  ipcMain.handle('recorder:start', (evt) => {
    client = evt.sender;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    sessionDir = path.join(recordingsRoot(), stamp);
    fs.mkdirSync(sessionDir, { recursive: true });
    recorders.clear();
    ensureAsr();
    send({ type: 'reset' });
    return sessionDir;
  });

  // on(), not handle(): fire-and-forget so a slow disk can never stall capture.
  ipcMain.on('recorder:chunk', (_evt, kind: TrackKind, samples: Float32Array) => {
    if (!sessionDir) return; // chunk arrived after stop; drop it
    let w = recorders.get(kind);
    if (!w) {
      // Created lazily so a track that never produces audio leaves no empty file.
      w = new WavWriter(path.join(sessionDir, `${kind}.wav`));
      recorders.set(kind, w);
    }
    w.append(samples);
    send({ type: 'chunk', kind, samples });
  });

  ipcMain.handle('recorder:stop', async () => {
    // Close out the trailing partial utterance before returning, so the caller
    // knows the live transcript is complete rather than merely quiet.
    const flushed = new Promise<void>((resolve) => {
      onFlushed = resolve;
      send({ type: 'flush' });
    });
    await flushed;

    const out = [...recorders.entries()].map(([kind, w]) => {
      w.close();
      return { kind, path: w.filePath, seconds: w.seconds };
    });
    recorders.clear();
    sessionDir = null;
    return out;
  });

  // --- Past recordings -----------------------------------------------------

  ipcMain.handle('recordings:list', () => listRecordings());

  // Re-transcribe an earlier session. The renderer passes an id, never a path:
  // every file this reads is resolved under the recordings root here, so the
  // renderer cannot aim the transcriber at an arbitrary file on disk.
  ipcMain.handle(
    'recordings:transcribe',
    async (_evt, id: string, opts: { diarize: boolean; numSpeakers: number }) => {
      const dir = recordingDir(id);
      const tracks: TrackFile[] = TRACK_KINDS.filter((k) =>
        fs.existsSync(path.join(dir, `${k}.wav`)),
      ).map((k) =>
        k === 'me'
          ? { path: path.join(dir, 'me.wav'), speaker: 'Me' }
          : {
              path: path.join(dir, 'them.wav'),
              speaker: 'Them',
              diarize: opts.diarize,
              numSpeakers: opts.numSpeakers || -1,
            },
      );
      if (tracks.length === 0) throw new Error(`Recording ${id} has no audio`);
      return transcribeFiles(tracks);
    },
  );

  // --- Speaker names -------------------------------------------------------

  ipcMain.handle('recordings:labels', (_evt, id: string) => readLabels(recordingDir(id)));

  ipcMain.handle(
    'recordings:set-labels',
    (_evt, id: string, labels: Record<string, string>) => {
      const dir = recordingDir(id);
      // Written whole every time: the set is small, and a rename is as often a
      // deletion (name cleared, fall back to the cluster id) as an addition.
      const clean = Object.fromEntries(
        Object.entries(labels ?? {}).filter(
          ([k, v]) => typeof k === 'string' && typeof v === 'string' && v.trim() !== '',
        ),
      );
      fs.writeFileSync(path.join(dir, LABELS_FILE), JSON.stringify(clean, null, 2));
    },
  );

  // --- Playback audio ------------------------------------------------------

  ipcMain.handle('recordings:audio', (_evt, id: string) => {
    const file = mixPath(recordingDir(id));
    // A URL, not a path: the renderer hands it straight to an <audio> element,
    // and it is derived from an id here, so the renderer still never names a
    // file of its own choosing.
    return { url: pathToFileURL(file).href, seconds: wavSeconds(file) };
  });

  // --- Transcript export ---------------------------------------------------
  // The renderer formats the text (it is the side that knows the names on
  // screen and the view the user is reading) and this side chooses the file and
  // writes it. The renderer never names a path: the only path that exists is
  // the one the user picks in the dialog, so an export cannot be aimed
  // anywhere the user did not just point it.

  ipcMain.handle(
    'transcript:export',
    async (
      evt,
      req: { suggestedName: string; content: string; extension: string; label: string },
    ): Promise<{ saved: boolean; path: string | null }> => {
      const win = BrowserWindow.fromWebContents(evt.sender);
      const options = {
        title: 'Export transcript',
        // basename(): a suggestion is a NAME, not a location. Anything
        // directory-shaped in it is dropped before the dialog ever sees it.
        defaultPath: path.join(
          app.getPath('documents'),
          path.basename(req.suggestedName || 'transcript.txt'),
        ),
        filters: [
          { name: req.label || 'Transcript', extensions: [req.extension || 'txt'] },
          { name: 'All files', extensions: ['*'] },
        ],
      };
      const result = win
        ? await dialog.showSaveDialog(win, options)
        : await dialog.showSaveDialog(options);
      if (result.canceled || !result.filePath) return { saved: false, path: null };
      fs.writeFileSync(result.filePath, req.content, 'utf8');
      return { saved: true, path: result.filePath };
    },
  );

  // Full re-transcription from the WAVs written above — only worth running when
  // diarization is on, since cluster labels aren't stable until the whole track
  // has been seen. Otherwise the live output already IS the transcript.
  ipcMain.handle('transcribe-files', async (_evt, tracks: TrackFile[]) => {
    return transcribeFiles(tracks);
  });

  // --- Window controls ----------------------------------------------------

  ipcMain.handle('window:set-mode', (evt, mode: 'main' | 'mini') => {
    const win = BrowserWindow.fromWebContents(evt.sender);
    if (!win) return;
    if (mode === 'mini') {
      win.setAlwaysOnTop(true, 'screen-saver');
      win.setSize(440, 76);
      win.setResizable(false);
    } else {
      win.setAlwaysOnTop(false);
      win.setResizable(true);
      win.setSize(1020, 740);
    }
  });

  ipcMain.handle('window:set-popover-open', (evt, open: boolean, height?: number) => {
    const win = BrowserWindow.fromWebContents(evt.sender);
    if (!win) return;
    const bounds = win.getBounds();
    const COLLAPSED_HEIGHT = 76;
    // Panels differ in height — a device list with meters is much taller than a
    // delay menu — so the renderer says how much room it needs. Clamped, since
    // that number crosses a process boundary and must not be trusted to be sane.
    const EXPANDED_HEIGHT = Math.min(720, Math.max(200, Math.round(height ?? 290)));

    if (open && bounds.height !== EXPANDED_HEIGHT) {
      const dy = EXPANDED_HEIGHT - bounds.height;
      win.setBounds({
        x: bounds.x,
        y: bounds.y - dy,
        width: bounds.width,
        height: EXPANDED_HEIGHT,
      });
    } else if (!open && bounds.height > COLLAPSED_HEIGHT) {
      const dy = bounds.height - COLLAPSED_HEIGHT;
      win.setBounds({
        x: bounds.x,
        y: bounds.y + dy,
        width: bounds.width,
        height: COLLAPSED_HEIGHT,
      });
    }
  });

  ipcMain.handle('window:set-always-on-top', (evt, flag: boolean) => {
    const win = BrowserWindow.fromWebContents(evt.sender);
    if (!win) return;
    win.setAlwaysOnTop(flag, flag ? 'screen-saver' : 'normal');
  });

  ipcMain.handle('window:minimize', (evt) => {
    const win = BrowserWindow.fromWebContents(evt.sender);
    win?.minimize();
  });

  ipcMain.handle('window:close', (evt) => {
    const win = BrowserWindow.fromWebContents(evt.sender);
    win?.close();
  });

  // --- Model Management ---------------------------------------------------

  ipcMain.handle('models:list', () => listModelStatuses());

  ipcMain.handle('models:catalog', () => MODEL_CATALOG);

  ipcMain.handle('models:download', async (evt, modelId: string) => {
    await downloadModel(modelId, evt.sender);
    resetRecognizer();
    return listModelStatuses();
  });

  ipcMain.handle('models:delete', (_evt, modelId: string) => {
    deleteModel(modelId);
    resetRecognizer();
    return listModelStatuses();
  });

  ipcMain.handle('models:set-active', (_evt, modelId: string) => {
    saveSettings({ activeModelId: modelId });
    resetRecognizer();
    return listModelStatuses();
  });
}

