import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  systemPreferences,
  utilityProcess,
  type UtilityProcess,
  type WebContents,
} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  resetRecognizer,
  type TrackFile,
  type TranscriptSegment,
} from './transcription';
import { WavWriter, wavHeader, SAMPLE_RATE } from './recorder';
import type { TrackKind } from './capture-types';
import type { WorkerIn, WorkerOut } from './asr-worker';
import {
  listModelStatuses,
  downloadModel,
  deleteModel,
  saveSettings,
  loadSettings,
  MODEL_CATALOG,
  USER_DATA_ENV,
  textNormalizerStatus,
  downloadTextNormalizer,
  setTextCleanupEnabled,
  deleteTextNormalizer,
} from './model-manager';
import { normalizeTranscript } from './text-normalizer';
import { MAIN_HEIGHT, MAIN_WIDTH, MINI_HEIGHT } from './window-sizes';
import { placeMain, placeMini } from './window-position';

// Split out of main.ts so tests can register the same handlers against their own
// BrowserWindow without also spawning the app's real window.

const recorders = new Map<TrackKind, WavWriter>();
let sessionDir: string | null = null;
let client: WebContents | null = null;

// main.ts owns the tray icon and wants to know when it should switch to the
// recording glyph; this module owns the only two moments that answer that
// (recorder:start / recorder:stop). A callback rather than an import keeps
// the dependency pointing the way it already does — main.ts depends on
// ipc.ts, not back — so ipc.ts still bundles standalone for the test suites
// (see the note above) without pulling in main.ts's Tray/BrowserWindow.
let onRecordingChange: ((recording: boolean) => void) | null = null;
export function onRecordingChanged(cb: (recording: boolean) => void): void {
  onRecordingChange = cb;
}

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

// --- Transcript on disk ---------------------------------------------------
// The live pass already produced a transcript while the meeting ran; storing it
// beside the audio is what makes reopening a recording instant. Without it,
// "open" meant "decode the whole meeting again" — minutes of CPU to redisplay
// text the app had already written once, and a blank panel until it finished.
//
// The WAVs remain the source of truth: this file can be deleted, corrupted or
// simply absent (recordings made before it existed), and every reader falls
// back to transcribing the audio again.

const TRANSCRIPT_FILE = 'transcript.json';
const TRANSCRIPT_VERSION = 1;

/** How the stored segments were produced. */
export type TranscriptSource = 'live' | 'rerun';

export interface StoredTranscript {
  version: number;
  savedAt: string;
  source: TranscriptSource;
  segments: TranscriptSegment[];
}

function isSegment(v: unknown): v is TranscriptSegment {
  if (!v || typeof v !== 'object') return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.start === 'number' &&
    typeof s.end === 'number' &&
    typeof s.speaker === 'string' &&
    typeof s.text === 'string'
  );
}

function readTranscript(dir: string): StoredTranscript | null {
  const file = path.join(dir, TRANSCRIPT_FILE);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    const stored = parsed as Partial<StoredTranscript>;
    if (!Array.isArray(stored.segments)) return null;
    return {
      version: typeof stored.version === 'number' ? stored.version : TRANSCRIPT_VERSION,
      savedAt: typeof stored.savedAt === 'string' ? stored.savedAt : '',
      source: stored.source === 'rerun' ? 'rerun' : 'live',
      // Per-word times are optional: a segment without them still reads, it just
      // cannot highlight along with playback.
      segments: stored.segments
        .filter(isSegment)
        .map((s) => ({ ...s, words: Array.isArray(s.words) ? s.words : [] })),
    };
  } catch (err) {
    // A half-written file costs a re-run, not the recording.
    console.warn(`[recordings] ignoring unreadable ${TRANSCRIPT_FILE} in ${dir}:`, err);
    return null;
  }
}

function writeTranscript(
  dir: string,
  segments: TranscriptSegment[],
  source: TranscriptSource,
): void {
  const stored: StoredTranscript = {
    version: TRANSCRIPT_VERSION,
    savedAt: new Date().toISOString(),
    source,
    // Chronological on disk. The live pass emits per track as each side stops
    // speaking, so arrival order interleaves rather than reads.
    segments: [...segments].sort((a, b) => a.start - b.start),
  };
  try {
    fs.writeFileSync(path.join(dir, TRANSCRIPT_FILE), JSON.stringify(stored));
  } catch (err) {
    // Losing the cache must not lose the recording: the audio is already closed
    // and the transcript is still on screen.
    console.error(`[recordings] could not save ${TRANSCRIPT_FILE} in ${dir}:`, err);
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
  // One native memcpy into out's own backing store, rather than one
  // readInt16LE call per sample — the difference between a bulk copy and
  // ~43M individual bounds-checked calls for a 45-minute meeting, which is
  // what the first playback of a long recording was paying to build its mix.
  // Safe on every platform this app ships to (Windows/macOS/Linux desktops
  // are all little-endian), the same assumption the WAV writer already makes
  // in recorder.ts's writeInt16LE.
  Buffer.from(out.buffer, out.byteOffset, out.byteLength).set(
    buf.subarray(44, 44 + frames * 2),
  );
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
// Every utterance of the session being recorded, kept on this side as well as
// sent on. The renderer's copy dies with its page; this is the copy that gets
// written beside the audio when the session stops.
let liveSegments: TranscriptSegment[] = [];

let transcribeReqId = 0;
const pendingTranscriptions = new Map<
  string,
  {
    resolve: (segments: TranscriptSegment[]) => void;
    reject: (err: Error) => void;
  }
>();

function send(msg: WorkerIn): void {
  asr?.postMessage(msg);
}

export async function requestTranscription(tracks: TrackFile[]): Promise<TranscriptSegment[]> {
  ensureAsr();
  const id = `tx-${++transcribeReqId}-${Date.now()}`;
  return new Promise<TranscriptSegment[]>((resolve, reject) => {
    pendingTranscriptions.set(id, { resolve, reject });
    send({ type: 'transcribe', id, tracks });
  });
}

function ensureAsr(): UtilityProcess {
  if (asr) return asr;
  // The worker has no `app` of its own, so it is told where userData is rather
  // than left to guess from the working directory. Both sides then read the
  // same models directory and the same settings file.
  const proc = utilityProcess.fork(path.join(__dirname, 'asr-worker.js'), [], {
    env: { ...process.env, [USER_DATA_ENV]: app.getPath('userData') },
  });
  proc.on('message', (msg: WorkerOut) => {
    switch (msg.type) {
      case 'utterance':
        // Kept for the transcript file — but only while a session owns a
        // directory to write it to.
        if (sessionDir) {
          liveSegments.push({
            start: msg.start,
            end: msg.end,
            speaker: msg.kind === 'me' ? 'Me' : 'Them',
            text: msg.text,
            words: msg.words,
          });
        }
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
      case 'transcribe:progress':
        client?.send('transcribe:progress', {
          stage: msg.stage,
          percent: msg.percent,
        });
        break;
      case 'transcribe:done': {
        const pending = pendingTranscriptions.get(msg.id);
        if (pending) {
          pendingTranscriptions.delete(msg.id);
          pending.resolve(msg.segments);
        }
        break;
      }
      case 'transcribe:error': {
        const pending = pendingTranscriptions.get(msg.id);
        if (pending) {
          pendingTranscriptions.delete(msg.id);
          pending.reject(new Error(msg.error));
        }
        break;
      }
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
    onExited?.();
    onExited = null;
    for (const [, pending] of pendingTranscriptions) {
      pending.reject(new Error('ASR worker process exited unexpectedly.'));
    }
    pendingTranscriptions.clear();
  });
  asr = proc;
  return proc;
}

let onExited: (() => void) | null = null;

/**
 * Stop the worker and wait for the process to be gone.
 *
 * The recognizer is a native ONNX session holding the model files open, and
 * nothing in the addon's API disposes one — dropping the JS reference leaks it
 * and keeps the handles. Ending the process is the only thing that reliably
 * gives the files back, which is what deleting a model needs on Windows, where
 * an open handle makes the unlink fail outright.
 */
async function stopAsr(): Promise<void> {
  const proc = asr;
  if (!proc) return;
  const exited = new Promise<void>((resolve) => {
    onExited = resolve;
    // Never hang the IPC call on a worker that will not die.
    setTimeout(resolve, 3000).unref?.();
  });
  proc.kill();
  await exited;
  asr = null;
}

/**
 * Reload the ASR model in the worker.
 *
 * The worker caches its recognizer for the life of the process, so a model
 * downloaded, deleted or made active in main changed nothing about live
 * transcription until the app was restarted: the user picked Whisper, hit
 * record, and got Parakeet. Restarting the worker is what makes the choice take
 * effect, and it costs one model load — which is what switching models costs
 * anyway.
 */
async function restartAsr(): Promise<void> {
  await stopAsr();
  ensureAsr();
  send({ type: 'warmup' });
}

/**
 * Model changes restart the worker, and the worker IS the live transcript, so
 * doing one mid-meeting would silently stop transcribing a recording that is
 * still running. Refusing is the honest answer; the alternative is a recording
 * with a hole in it that nobody notices until it is over.
 */
function refuseWhileRecording(action: string): void {
  if (sessionDir) {
    throw new Error(`Stop the recording before ${action}.`);
  }
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
    liveSegments = [];
    ensureAsr();
    send({ type: 'reset' });
    onRecordingChange?.(true);
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

    // The flush above is what makes this complete rather than merely current:
    // every utterance the worker had in hand has arrived by now. Reopening this
    // recording later reads this file instead of decoding the audio again.
    if (sessionDir && out.length > 0) writeTranscript(sessionDir, liveSegments, 'live');
    liveSegments = [];
    sessionDir = null;
    onRecordingChange?.(false);
    return out;
  });

  // --- Past recordings -----------------------------------------------------

  ipcMain.handle('recordings:list', () => listRecordings());

  // Re-transcribe an earlier session. The renderer passes an id, never a path:
  // every file this reads is resolved under the recordings root here, so the
  // renderer cannot aim the transcriber at an arbitrary file on disk.
  ipcMain.handle(
    'recordings:transcribe',
    async (evt, id: string, opts: { diarize: boolean; numSpeakers: number }) => {
      client = evt.sender;
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
      const segments = await requestTranscription(tracks);
      // A re-run replaces whatever was stored: it was asked for because the
      // stored pass was not what the user wanted (no speaker separation, or a
      // different model since).
      writeTranscript(dir, segments, 'rerun');
      return segments;
    },
  );

  // The transcript saved when this recording was made, or null if there is
  // none — an older recording, or a session that never reached a clean stop.
  // Callers fall back to `recordings:transcribe`, which saves what it produces.
  ipcMain.handle('recordings:transcript', (_evt, id: string) =>
    readTranscript(recordingDir(id)),
  );

  // Delete a recording, audio and all. Resolved from an id under the recordings
  // root like every other path here, so this cannot be aimed elsewhere.
  ipcMain.handle('recordings:delete', (_evt, id: string) => {
    const dir = recordingDir(id);
    // Refusing beats racing: the WAV writers hold this directory open, and a
    // half-deleted session in progress would keep receiving chunks.
    if (sessionDir && path.resolve(sessionDir) === path.resolve(dir)) {
      throw new Error('That recording is still being recorded.');
    }
    // Retries because the renderer's <audio> element may still be letting go of
    // mix.wav: on Windows an open handle makes the unlink fail outright, and the
    // release lands a tick or two after the page drops the source.
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
    // The fresh listing, so the caller never has to ask a second time.
    return listRecordings();
  });

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
  //
  // This is the one handler in the file that takes a path instead of an id: the
  // renderer's normal route is recordings:transcribe by id (below), and this is
  // only the fallback for the rare case where the session directory name could
  // not be read back after recorder:stop (see use-session.ts). The paths it is
  // ever actually called with are ones main itself just handed back to the
  // renderer moments earlier — recorder:stop returns each WavWriter's own
  // filePath — so every legitimate call already resolves under
  // recordingsRoot(). Enforcing that here, rather than trusting the renderer to
  // keep echoing it back honestly, is what keeps this handler from being a
  // "run ASR over any WAV on disk and return the text" primitive sitting next
  // to a file of handlers that otherwise never accept one.
  ipcMain.handle('transcribe-files', async (evt, tracks: TrackFile[]) => {
    client = evt.sender;
    const root = path.resolve(recordingsRoot());
    for (const t of tracks) {
      const resolved = path.resolve(t.path);
      if (resolved !== root && !resolved.startsWith(root + path.sep)) {
        throw new Error(`Refusing to transcribe a path outside recordings: ${t.path}`);
      }
    }
    return requestTranscription(tracks);
  });

  // --- Window controls ----------------------------------------------------

  ipcMain.handle('window:set-mode', (evt, mode: 'main' | 'mini') => {
    const win = BrowserWindow.fromWebContents(evt.sender);
    if (!win) return;
    if (mode === 'mini') {
      win.setAlwaysOnTop(true, 'screen-saver');
      win.setResizable(false);
      // Moves as well as resizes: see window-position.ts for why the top-left
      // corner is the wrong thing to keep across a mode change.
      placeMini(win);
    } else {
      win.setAlwaysOnTop(false);
      win.setResizable(true);
      placeMain(win, MAIN_WIDTH, MAIN_HEIGHT);
    }
  });

  ipcMain.handle('window:set-popover-open', (evt, open: boolean, height?: number) => {
    const win = BrowserWindow.fromWebContents(evt.sender);
    if (!win) return;
    const bounds = win.getBounds();
    const COLLAPSED_HEIGHT = MINI_HEIGHT;
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

  // Each of these changes which model should be loaded, so each has to reach
  // BOTH recognizers: the one in this process (batch re-transcription) and the
  // one the worker holds (live transcription). resetRecognizer() only covers
  // the first; restartAsr() is what covers the second.

  ipcMain.handle('models:download', async (evt, modelId: string) => {
    refuseWhileRecording('downloading a model');
    await downloadModel(modelId, evt.sender);
    resetRecognizer();
    await restartAsr();
    return listModelStatuses();
  });

  ipcMain.handle('models:delete', async (_evt, modelId: string) => {
    refuseWhileRecording('deleting a model');
    // Order matters: the worker has the model's files open, and on Windows the
    // directory cannot be removed until it lets go. Stop it, delete, then come
    // back up on whatever model is left.
    await stopAsr();
    resetRecognizer();
    deleteModel(modelId);
    await restartAsr();
    return listModelStatuses();
  });

  ipcMain.handle('models:set-active', async (_evt, modelId: string) => {
    refuseWhileRecording('switching models');
    saveSettings({ ...loadSettings(), activeModelId: modelId });
    resetRecognizer();
    await restartAsr();
    return listModelStatuses();
  });

  // S1-mini is an optional post-ASR stage. It never changes the speech model
  // or the live worker, and is only allowed to touch transcripts by recording id.
  ipcMain.handle('text-normalizer:status', () => textNormalizerStatus());
  ipcMain.handle('text-normalizer:download', async (evt) => {
    refuseWhileRecording('downloading S1-mini');
    return downloadTextNormalizer(evt.sender);
  });
  ipcMain.handle('text-normalizer:set-enabled', (_evt, enabled: boolean) =>
    setTextCleanupEnabled(enabled === true),
  );
  ipcMain.handle('text-normalizer:delete', () => {
    refuseWhileRecording('deleting S1-mini');
    return deleteTextNormalizer();
  });
  ipcMain.handle('recordings:clean-transcript', async (_evt, id: string) => {
    const dir = recordingDir(id);
    const stored = readTranscript(dir);
    if (!stored) throw new Error('This recording has no transcript to clean.');
    const segments = await normalizeTranscript(stored.segments);
    writeTranscript(dir, segments, stored.source);
    return segments;
  });

  // --- System & Permissions -----------------------------------------------

  ipcMain.handle('system:open-privacy-settings', async (_evt, type: 'microphone' | 'screen' = 'microphone') => {
    const isWin = process.platform === 'win32';
    const isMac = process.platform === 'darwin';
    if (isWin) {
      if (type === 'microphone') {
        await shell.openExternal('ms-settings:privacy-microphone');
      } else {
        await shell.openExternal('ms-settings:privacy');
      }
    } else if (isMac) {
      if (type === 'microphone') {
        await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone');
      } else {
        await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
      }
    }
  });

  ipcMain.handle('system:get-permission-status', () => {
    let micStatus = 'unknown';
    try {
      if (systemPreferences?.getMediaAccessStatus) {
        micStatus = systemPreferences.getMediaAccessStatus('microphone');
      }
    } catch {
      micStatus = 'unknown';
    }
    return {
      microphone: micStatus,
      platform: process.platform,
      isWindows: process.platform === 'win32',
      isMac: process.platform === 'darwin',
    };
  });
}

