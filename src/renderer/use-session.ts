import { useCallback, useEffect, useRef, useState } from 'react';
import type { AudioChunk, TrackKind } from '../capture-types';
import { SAMPLE_RATE, WebCaptureSource } from './capture';
import type { UpdateState } from './use-updater';

/** One word and the moment it starts, in seconds from the start of recording. */
export interface Word {
  t: number;
  text: string;
}

interface TranscriptSegment {
  start: number;
  end: number;
  speaker: string;
  text: string;
  words: Word[];
}

interface LiveUtterance {
  kind: TrackKind;
  start: number;
  end: number;
  text: string;
  words: Word[];
}

interface TrackFile {
  path: string;
  speaker: string;
  diarize?: boolean;
  numSpeakers?: number;
}

/** How a transcript was produced: streamed while recording, or a later re-run. */
export type TranscriptSource = 'live' | 'rerun';

/** The transcript stored beside a recording's audio. */
interface StoredTranscript {
  version: number;
  savedAt: string;
  source: TranscriptSource;
  segments: TranscriptSegment[];
}

/** Where the transcript on screen came from. Null when there isn't one. */
export interface TranscriptInfo {
  source: TranscriptSource;
  /** ISO stamp of when it was saved; empty if the file predates the field. */
  savedAt: string;
}

interface RecordedTrack {
  kind: TrackKind;
  path: string;
  seconds: number;
}

// Bridge exposed by preload.ts
declare global {
  interface Window {
    api: {
      recorderStart: () => Promise<string>;
      recorderChunk: (kind: TrackKind, samples: Float32Array) => void;
      recorderStop: () => Promise<RecordedTrack[]>;
      onLiveUtterance: (cb: (u: LiveUtterance) => void) => void;
      onLiveActivity: (cb: (a: { kind: TrackKind; speaking: boolean }) => void) => void;
      onLiveError: (cb: (message: string) => void) => void;
      onTranscribeProgress: (cb: (progress: { stage: string; percent: number }) => void) => void;
      transcribeFiles: (tracks: TrackFile[]) => Promise<TranscriptSegment[]>;
      recordingsList: () => Promise<Recording[]>;
      recordingsTranscribe: (
        id: string,
        opts: { diarize: boolean; numSpeakers: number },
      ) => Promise<TranscriptSegment[]>;
      recordingsTranscript: (id: string) => Promise<StoredTranscript | null>;
      recordingsDelete: (id: string) => Promise<Recording[]>;
      recordingsLabels: (id: string) => Promise<Record<string, string>>;
      recordingsSetLabels: (id: string, labels: Record<string, string>) => Promise<void>;
      /** Both tracks summed into one playable file, as a file:// URL. */
      recordingsAudio: (id: string) => Promise<{ url: string; seconds: number }>;
      /** Save formatted transcript text; the user picks the file in a dialog. */
      exportTranscript: (req: {
        suggestedName: string;
        content: string;
        extension: string;
        label: string;
      }) => Promise<{ saved: boolean; path: string | null }>;
      windowSetMode: (mode: 'main' | 'mini') => Promise<void>;
      windowSetAlwaysOnTop: (flag: boolean) => Promise<void>;
      windowSetPopoverOpen: (open: boolean, height?: number) => Promise<void>;
      windowMinimize: () => Promise<void>;
      windowClose: () => Promise<void>;
      onWindowModeChanged: (cb: (mode: 'main' | 'mini') => void) => void;
      modelsList: () => Promise<ModelStatus[]>;
      modelsCatalog: () => Promise<ModelSpec[]>;
      modelsDownload: (id: string) => Promise<ModelStatus[]>;
      modelsDelete: (id: string) => Promise<ModelStatus[]>;
      modelsSetActive: (id: string) => Promise<ModelStatus[]>;
      onModelProgress: (
        cb: (progress: { id: string; progressPct: number; downloadSpeedMb: number }) => void,
      ) => void;
      updaterState: () => Promise<UpdateState>;
      updaterCheck: () => Promise<UpdateState>;
      updaterDownload: () => Promise<UpdateState>;
      updaterInstall: () => Promise<UpdateState>;
      onUpdaterChanged: (cb: (state: UpdateState) => void) => void;
      systemOpenPrivacySettings: (type?: 'microphone' | 'screen') => Promise<void>;
      systemGetPermissionStatus: () => Promise<{
        microphone: string;
        platform: string;
        isWindows: boolean;
        isMac: boolean;
      }>;
    };
  }
}

export interface ModelStatus {
  id: string;
  isInstalled: boolean;
  isActive: boolean;
  isDownloading: boolean;
  progressPct: number;
  downloadSpeedMb: number;
}

export interface ModelSpec {
  id: string;
  name: string;
  type: 'nemo_transducer' | 'whisper';
  description: string;
  sizeMb: number;
}

export interface Recording {
  id: string;
  startedAt: string;
  seconds: number;
  tracks: TrackKind[];
}

export interface TranscriptLine {
  id: number;
  kind: TrackKind;
  start: number;
  /** Seconds from recording start. With `start`, the span this line sounds in. */
  end: number;
  text: string;
  speaker?: string;
  /** Per-word start times from the recogniser, for follow-along highlighting. */
  words?: Word[];
}

export type StatusKind = 'idle' | 'recording' | 'working' | 'done' | 'error';

/**
 * What a track is doing right now. `transcribing` is derived, not reported:
 * speech stopping and the utterance arriving are separated by a decode, and
 * that gap is exactly the interval the panel used to look frozen in.
 */
export type Activity = 'idle' | 'speaking' | 'transcribing';

export interface StartOptions {
  mic: boolean;
  system: boolean;
  /** Which microphone to open. Empty or absent means the system default. */
  micDeviceId?: string | null;
}

export interface StopOptions {
  diarize: boolean;
  numSpeakers: number;
}

export interface OpenOptions extends StopOptions {
  /**
   * Whether a recording with no saved transcript may be transcribed on the
   * spot. False when no speech model is installed: the attempt could only fail,
   * and an error where the transcript goes says nothing about what to do next.
   */
  canTranscribe?: boolean;
}

interface TrackStats {
  frames: number;
  peak: number;
  sumSq: number;
}

const TRACKS: TrackKind[] = ['me', 'them'];

/**
 * Nothing happening. Where the session sits whenever it is not capturing or
 * working — reading a saved transcript is not a session state, so opening one
 * leaves the machine here and reports itself through `notice` instead.
 */
const IDLE: { kind: StatusKind; text: string } = { kind: 'idle', text: 'Ready to record.' };

const emptyStats = (): Record<TrackKind, TrackStats> => ({
  me: { frames: 0, peak: 0, sumSq: 0 },
  them: { frames: 0, peak: 0, sumSq: 0 },
});

export interface Session {
  status: { kind: StatusKind; text: string };
  /** Capture diagnostics from the last run: silent tracks, dropped audio. */
  warnings: string[];
  isRecording: boolean;
  /** Recording, but not writing: the devices stay open and the clock stops. */
  isPaused: boolean;
  isBusy: boolean;
  /** Tracks that actually opened; drives which meters and columns are live. */
  openTracks: TrackKind[];
  /** Per-track live state, so a pending utterance is visible before it lands. */
  activity: Record<TrackKind, Activity>;
  lines: TranscriptLine[];
  /** Past sessions on disk, newest first. */
  recordings: Recording[];
  /**
   * The recording the transcript on screen came from, once its audio is closed
   * and on disk — which is also the only time a line can be played back. Null
   * while recording, and until the first session of the run has been stopped.
   */
  loadedRecording: string | null;
  /** Where the transcript on screen came from, for the header line above it. */
  transcriptInfo: TranscriptInfo | null;
  /** User-supplied names, keyed by raw speaker id. Persisted per recording. */
  speakerLabels: Record<string, string>;
  /** Name a speaker; an empty name restores the raw id. */
  renameSpeaker: (speaker: string, name: string) => void;
  refreshRecordings: () => Promise<void>;
  /** Show a past recording: its saved transcript, or a fresh pass if it has none. */
  openRecording: (id: string, opts: OpenOptions) => Promise<void>;
  /** Run ASR over the loaded recording again, replacing its saved transcript. */
  retranscribe: (opts: StopOptions) => Promise<void>;
  /** Delete a recording and its audio. Irreversible; confirm before calling. */
  deleteRecording: (id: string) => Promise<void>;
  /**
   * The outcome of the last action taken on the LIBRARY, for the page that
   * action happened on.
   *
   * Deliberately not `status`: that one describes the recording session, and
   * the widget puts it on screen — which is how "Recording deleted." ended up
   * sitting in the recorder, where nothing had been deleted.
   */
  notice: { ok: boolean; text: string } | null;
  /** Report an outcome. Successes fade after a few seconds; failures wait. */
  notify: (ok: boolean, text: string) => void;
  dismissNotice: () => void;
  /**
   * Seconds of audio actually captured this session, sampled rather than
   * rendered: paused time is not in it, because paused audio is not on disk.
   */
  recordedSeconds: React.RefObject<number>;
  /**
   * Live peak per track, mutated in place by the capture callback. Deliberately
   * a ref and not state: meters repaint every animation frame, and routing that
   * through React would re-render the transcript with it.
   */
  levels: React.RefObject<Record<TrackKind, number>>;
  /** Clear the panel back to an empty, unstarted session. */
  newSession: () => void;
  start: (opts: StartOptions) => Promise<void>;
  /** Stop writing without ending the session; resume picks up where it left off. */
  setPaused: (paused: boolean) => void;
  stop: (opts: StopOptions) => Promise<void>;
}

export function useSession(): Session {
  const [status, setStatus] = useState<Session['status']>(IDLE);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [openTracks, setOpenTracks] = useState<TrackKind[]>([]);
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [activity, setActivity] = useState<Record<TrackKind, Activity>>({
    me: 'idle',
    them: 'idle',
  });
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loadedRecording, setLoadedRecording] = useState<string | null>(null);
  const [transcriptInfo, setTranscriptInfo] = useState<TranscriptInfo | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [speakerLabels, setSpeakerLabels] = useState<Record<string, string>>({});

  const source = useRef<WebCaptureSource | null>(null);
  // A ref, not the state: the capture callback runs off the audio thread's
  // messages and must read the CURRENT answer, not the one captured when it
  // was last rendered.
  const paused = useRef(false);
  const levels = useRef<Record<TrackKind, number>>({ me: 0, them: 0 });
  // Seconds of audio on the longest track. A ref for the same reason levels is
  // one: a timer ticking in React state would re-render the whole app every
  // second, transcript included.
  const recordedSeconds = useRef(0);
  // Total frames the capture thread never delivered, per track. Non-zero means the
  // timeline had holes, which were padded with silence to keep timestamps honest.
  const gaps = useRef<Record<TrackKind, number>>({ me: 0, them: 0 });
  // Running signal stats, accumulated per chunk. Audio itself goes straight to
  // disk and is never retained here, so diagnostics have to be computed on the way
  // past rather than over a buffer at the end.
  const stats = useRef<Record<TrackKind, TrackStats>>(emptyStats());
  const nextId = useRef(0);
  // Mirrors `lines` so the status text can quote a count without reading state
  // from inside a setState updater (React may invoke updaters more than once).
  const lineCount = useRef(0);
  // The session currently being recorded, known from the moment its directory is
  // opened. Distinct from `loadedRecording`, which only names a recording whose
  // audio is closed and therefore playable.
  const sessionId = useRef<string | null>(null);
  // Mirrors of the two pieces of state a rename has to read. A rename is a
  // read-modify-write against whatever is on screen, and reading that from
  // inside a setState updater would put a disk write in a function React is
  // free to call twice.
  const labelsRef = useRef<Record<string, string>>({});
  const loadedRef = useRef<string | null>(null);
  const labelSave = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showLabels = useCallback((next: Record<string, string>) => {
    labelsRef.current = next;
    setSpeakerLabels(next);
  }, []);

  const showLoaded = useCallback((id: string | null) => {
    loadedRef.current = id;
    setLoadedRecording(id);
  }, []);

  // Names are typed a keystroke at a time; the file is small but there is no
  // reason to rewrite it on every one.
  const saveLabels = useCallback((id: string | null, labels: Record<string, string>) => {
    if (!id) return;
    if (labelSave.current) clearTimeout(labelSave.current);
    labelSave.current = setTimeout(() => {
      labelSave.current = null;
      void window.api
        .recordingsSetLabels(id, labels)
        .catch((err) => console.error('[labels] save failed', err));
    }, 400);
  }, []);

  const renameSpeaker = useCallback(
    (speaker: string, name: string): void => {
      const next = { ...labelsRef.current };
      // An empty field means "go back to the cluster id", not "store a blank".
      if (name.trim()) next[speaker] = name;
      else delete next[speaker];
      showLabels(next);
      saveLabels(loadedRef.current, next);
    },
    [saveLabels, showLabels],
  );

  // Replace the whole transcript with a finished pass — the diarized re-run of
  // the session just recorded, or an earlier session reopened from the panel.
  const showSegments = useCallback((segments: TranscriptSegment[]) => {
    nextId.current = 0;
    lineCount.current = segments.length;
    setLines(
      segments.map((seg) => ({
        id: nextId.current++,
        kind: seg.speaker === 'Me' ? ('me' as TrackKind) : ('them' as TrackKind),
        start: seg.start,
        end: seg.end,
        text: seg.text,
        speaker: seg.speaker,
        words: seg.words,
      })),
    );
  }, []);

  const refreshRecordings = useCallback(async (): Promise<void> => {
    try {
      setRecordings(await window.api.recordingsList());
    } catch (err) {
      // A listing failure must not take out the recording controls with it, and
      // must not surface as an unhandled rejection.
      console.error('[recordings] list failed', err);
    }
  }, []);

  const appendLine = useCallback((line: Omit<TranscriptLine, 'id'>) => {
    lineCount.current++;
    setLines((prev) => [...prev, { ...line, id: nextId.current++ }]);
  }, []);

  // Preload exposes these as single-subscriber sinks, so register once for the
  // lifetime of the window rather than per recording.
  useEffect(() => {
    window.api.onLiveUtterance((u) => {
      appendLine({ kind: u.kind, start: u.start, end: u.end, text: u.text, words: u.words });
      // The line landing is what ends a decode; the worker never says so.
      setActivity((prev) =>
        prev[u.kind] === 'transcribing' ? { ...prev, [u.kind]: 'idle' } : prev,
      );
    });
    window.api.onLiveActivity(({ kind, speaking }) => {
      setActivity((prev) => ({ ...prev, [kind]: speaking ? 'speaking' : 'transcribing' }));
    });
    window.api.onLiveError((m) => {
      setStatus({ kind: 'error', text: `ASR error: ${m}` });
    });
    window.api.onTranscribeProgress?.((p) => {
      setStatus({ kind: 'working', text: `${p.stage}` });
    });
    void refreshRecordings();
  }, [appendLine, refreshRecordings]);

  const onChunk = useCallback((chunk: AudioChunk): void => {
    // Paused: the devices stay open — reopening a microphone mid-meeting is how
    // you lose the next sentence — but nothing is written and nothing is
    // transcribed. Dropping the audio here rather than at the source keeps the
    // WAV and the ASR clock identical: both only ever see what was kept, so a
    // ten-minute pause leaves no ten-minute hole in the timestamps.
    if (paused.current) return;
    const st = stats.current[chunk.kind];
    st.frames += chunk.samples.length;
    // Frames kept, not wall time: paused chunks never arrive here, so this
    // counts the audio that actually exists — which is what a recording timer
    // is claiming to show.
    const secs = st.frames / SAMPLE_RATE;
    if (secs > recordedSeconds.current) recordedSeconds.current = secs;
    if (chunk.peak > st.peak) st.peak = chunk.peak;
    for (let i = 0; i < chunk.samples.length; i++) {
      st.sumSq += chunk.samples[i] * chunk.samples[i];
    }
    if (chunk.peak > levels.current[chunk.kind]) levels.current[chunk.kind] = chunk.peak;
    // Straight to disk and to the ASR worker. Nothing accumulates in this process.
    window.api.recorderChunk(chunk.kind, chunk.samples);
  }, []);

  const onGap = useCallback((kind: TrackKind, missing: number, atFrame: number): void => {
    gaps.current[kind] += missing;
    console.warn(
      `[capture] ${kind}: ${(missing / SAMPLE_RATE).toFixed(3)}s gap at ` +
        `${(atFrame / SAMPLE_RATE).toFixed(2)}s — padded with silence`,
    );
  }, []);

  // Was each track actually carrying signal? A silent track means a CAPTURE
  // problem; a loud track that yields no text means VAD/ASR.
  const diagnose = useCallback((): string[] => {
    const notes: string[] = [];
    for (const kind of TRACKS) {
      const st = stats.current[kind];
      if (st.frames === 0) continue;
      const rms = Math.sqrt(st.sumSq / st.frames);
      const label = kind === 'me' ? 'Me' : 'Them';
      console.log(
        `[capture] ${kind}: ${(st.frames / SAMPLE_RATE).toFixed(1)}s ` +
          `peak=${st.peak.toFixed(3)} rms=${rms.toFixed(4)}`,
      );
      if (st.peak < 0.01) notes.push(`${label} track was silent (peak ${st.peak.toFixed(3)})`);
      if (gaps.current[kind] > 0) {
        notes.push(`${label} dropped ${(gaps.current[kind] / SAMPLE_RATE).toFixed(2)}s of audio`);
      }
    }
    return notes;
  }, []);

  const teardown = useCallback(() => {
    setIsRecording(false);
    paused.current = false;
    setIsPaused(false);
    setOpenTracks([]);
    setActivity({ me: 'idle', them: 'idle' });
    levels.current = { me: 0, them: 0 };
  }, []);

  const setPaused = useCallback((next: boolean): void => {
    paused.current = next;
    setIsPaused(next);
    // Meters read this ref every frame; without the reset they would hold the
    // last peak from before the pause and read as live input.
    if (next) levels.current = { me: 0, them: 0 };
    setStatus({
      kind: 'recording',
      text: next
        ? 'Paused — nothing is being recorded or transcribed.'
        : 'Recording — lines appear as each side stops speaking.',
    });
  }, []);

  /**
   * Put the panel back in front of an empty session, without opening anything.
   *
   * Recording used to be the only way to leave a loaded recording behind, which
   * made "new recording" and "start recording" the same act. They are not: the
   * user needs a moment in between to choose sources and test the microphone.
   */
  const newSession = useCallback(() => {
    if (isRecording) return;
    setLines([]);
    setWarnings([]);
    setActivity({ me: 'idle', them: 'idle' });
    showLoaded(null);
    showLabels({});
    setTranscriptInfo(null);
    setStatus(IDLE);
  }, [isRecording, showLabels, showLoaded]);

  const start = useCallback(
    async (opts: StartOptions): Promise<void> => {
      gaps.current = { me: 0, them: 0 };
      stats.current = emptyStats();
      recordedSeconds.current = 0;
      lineCount.current = 0;
      paused.current = false;
      setIsPaused(false);
      setLines([]);
      setWarnings([]);
      setActivity({ me: 'idle', them: 'idle' });
      // A new recording owns the transcript panel; nothing from the archive is
      // on screen any more, and its audio is not closed yet, so nothing is
      // playable either. Names belong to a recording, so they go with it.
      showLoaded(null);
      showLabels({});
      setTranscriptInfo(null);

      const want: TrackKind[] = [];
      if (opts.mic) want.push('me');
      if (opts.system) want.push('them');
      if (want.length === 0) {
        setStatus({ kind: 'error', text: 'Pick at least one audio source.' });
        return;
      }

      // Open the session directory before capture, so the very first chunk has
      // somewhere to land.
      const dir = await window.api.recorderStart();
      // The directory name IS the recording id, which is what every later call
      // (labels, clips) is keyed by. Taken off the tail of the path rather than
      // returned separately, so the recorder keeps its one-value contract.
      sessionId.current = dir.split(/[\\/]/).filter(Boolean).pop() ?? null;
      console.log(`[recorder] writing to ${dir}`);

      const capture = new WebCaptureSource({
        onChunk,
        onGap,
        onNotice: (text) => setWarnings((prev) => (prev.includes(text) ? prev : [...prev, text])),
      });
      source.current = capture;

      let opened: TrackKind[];
      try {
        opened = await capture.start(want, { micDeviceId: opts.micDeviceId });
      } catch (err) {
        await window.api.recorderStop();
        source.current = null;
        throw err;
      }

      if (opened.length === 0) {
        setStatus({
          kind: 'error',
          text: want.includes('them')
            ? 'No audio captured. (System audio: nothing playing, or loopback unavailable.)'
            : 'No audio captured.',
        });
        await window.api.recorderStop();
        source.current = null;
        return;
      }
      if (want.includes('them') && !opened.includes('them')) {
        setStatus({
          kind: 'recording',
          text: 'No system-audio track (nothing playing / loopback unavailable). Recording mic only…',
        });
      } else {
        setStatus({ kind: 'recording', text: 'Recording — lines appear as each side stops speaking.' });
      }

      setOpenTracks(opened);
      setIsRecording(true);
    },
    [onChunk, onGap, showLabels, showLoaded],
  );

  const stop = useCallback(
    async (opts: StopOptions): Promise<void> => {
      setIsRecording(false);
      setIsBusy(true);
      setStatus({ kind: 'working', text: 'Finishing the last utterance…' });

      try {
        // Flushes each worklet's partial chunk, so close the WAVs only after it
        // resolves or the last 128ms never reaches disk or the ASR worker.
        await source.current?.stop();
        source.current = null;
        teardown();

        // recorderStop flushes the ASR worker before closing the files, so by the
        // time it resolves the live transcript is complete.
        const recorded = await window.api.recorderStop();
        const notes = diagnose();
        // Merged, not replaced: a notice raised while opening the sources (a
        // microphone that would not open, say) is still true at the end.
        setWarnings((prev) => [...new Set([...prev, ...notes])]);

        if (recorded.length === 0) {
          setStatus({ kind: 'error', text: 'No audio captured.' });
          return;
        }
        const audioSecs = Math.max(...recorded.map((r) => r.seconds));

        // The WAVs are closed, so this session is now an ordinary recording:
        // selected in the panel, and its lines playable. Any names typed while
        // it was still running are flushed to it now — until this moment there
        // was no directory on disk entitled to own them.
        if (sessionId.current) {
          showLoaded(sessionId.current);
          if (Object.keys(labelsRef.current).length > 0) {
            void window.api
              .recordingsSetLabels(sessionId.current, labelsRef.current)
              .catch((err) => console.error('[labels] save failed', err));
          }
        }

        // Whatever happens next, the live pass has already been written beside
        // the audio by recorderStop — so this recording opens instantly from
        // here on, even if the diarization pass below is cancelled or fails.
        setTranscriptInfo({ source: 'live', savedAt: new Date().toISOString() });

        if (!opts.diarize) {
          // The live output already is the transcript — nothing to re-run.
          setStatus({
            kind: 'done',
            text: `Done — ${lineCount.current} utterances, ${audioSecs.toFixed(1)}s audio.`,
          });
          return;
        }

        // Diarization can only run over a whole track: cluster labels aren't stable
        // until every speaker has been heard. So it's a second pass over the WAVs,
        // which replaces the live lines with speaker-labelled ones.
        setStatus({ kind: 'working', text: 'Separating speakers locally… (diarization is slower)' });
        const tracks: TrackFile[] = recorded.map((r) =>
          r.kind === 'me'
            ? { path: r.path, speaker: 'Me' }
            : {
                path: r.path,
                speaker: 'Them',
                diarize: true,
                numSpeakers: opts.numSpeakers || -1,
              },
        );

        const t0 = performance.now();
        // By id wherever we have one, so main writes the diarized pass over the
        // live transcript it saved a moment ago; the path-based call is only for
        // the case where the session directory name could not be read back.
        const segments = sessionId.current
          ? await window.api.recordingsTranscribe(sessionId.current, {
              diarize: true,
              numSpeakers: opts.numSpeakers,
            })
          : await window.api.transcribeFiles(tracks);
        showSegments(segments);
        setTranscriptInfo({ source: 'rerun', savedAt: new Date().toISOString() });
        const rtf = (performance.now() - t0) / 1000 / audioSecs;
        setStatus({
          kind: 'done',
          text:
            `Done — ${segments.length} utterances, ${audioSecs.toFixed(1)}s audio, ` +
            `diarization pass RTF ${rtf.toFixed(2)}.`,
        });
      } catch (err) {
        setStatus({ kind: 'error', text: `Error: ${(err as Error).message}` });
      } finally {
        setIsBusy(false);
        // The session just closed is now the newest entry in the panel.
        void refreshRecordings();
      }
    },
    [diagnose, refreshRecordings, showLoaded, showSegments, teardown],
  );

  // A full pass over a recording's WAVs. Minutes of CPU for a long meeting, so
  // it only ever runs when asked for or when there is no saved transcript to
  // show. Main saves whatever it produces, so it runs once per request.
  const transcribeRecording = useCallback(
    async (id: string, opts: StopOptions): Promise<void> => {
      setStatus({
        kind: 'working',
        text: opts.diarize
          ? 'Transcribing with speaker separation… (slower)'
          : 'Transcribing this recording…',
      });
      const t0 = performance.now();
      const segments = await window.api.recordingsTranscribe(id, opts);
      showSegments(segments);
      setTranscriptInfo({ source: 'rerun', savedAt: new Date().toISOString() });
      const elapsed = (performance.now() - t0) / 1000;
      setStatus(IDLE);
      setNotice({
        ok: true,
        text: `${segments.length} utterances, transcribed in ${elapsed.toFixed(1)}s.`,
      });
    },
    [showSegments],
  );

  const openRecording = useCallback(
    async (id: string, opts: OpenOptions): Promise<void> => {
      setIsBusy(true);
      showLoaded(id);
      setLines([]);
      setWarnings([]);
      setTranscriptInfo(null);
      setNotice(null);
      // Whatever the last session was saying — an ASR failure, a finished run —
      // it was about a different recording than the one being opened. Reading
      // from the library is not a session state, so the machine goes quiet.
      setStatus(IDLE);
      try {
        // Names first: they are a single small file, and having them in hand
        // before the segments land means no line ever renders under a cluster id
        // and then renames itself a moment later.
        showLabels(
          await window.api.recordingsLabels(id).catch((err) => {
            console.error('[labels] load failed', err);
            return {};
          }),
        );

        // The transcript this recording was saved with. Reading it is a file
        // read, so the panel fills immediately — re-running ASR here would make
        // opening a meeting cost as much as recording it, to arrive at the same
        // words. Re-running stays available, as a deliberate act.
        const saved = await window.api.recordingsTranscript(id).catch((err) => {
          console.error('[transcript] load failed', err);
          return null;
        });

        if (saved && saved.segments.length > 0) {
          showSegments(saved.segments);
          setTranscriptInfo({ source: saved.source, savedAt: saved.savedAt });
          setNotice({
            ok: true,
            text: `${saved.segments.length} utterances from the saved transcript.`,
          });
          return;
        }

        if (opts.canTranscribe === false) {
          // Nothing saved and nothing that can be run: say what is missing,
          // where the page can offer the fix, instead of failing a pass that
          // never had a model to use.
          setNotice({
            ok: false,
            text: 'No transcript yet — install a speech model to transcribe this recording.',
          });
          return;
        }

        // No transcript on disk: a recording made before they were saved, or a
        // session that never reached a clean stop. Decode it once — main stores
        // the result, so this is the last time this recording pays for it.
        await transcribeRecording(id, opts);
      } catch (err) {
        showLoaded(null);
        setNotice({ ok: false, text: `Could not open that recording: ${(err as Error).message}` });
      } finally {
        setIsBusy(false);
      }
    },
    [showLabels, showLoaded, showSegments, transcribeRecording],
  );

  const retranscribe = useCallback(
    async (opts: StopOptions): Promise<void> => {
      const id = loadedRef.current;
      if (!id || isRecording) return;
      setIsBusy(true);
      try {
        // Lines are left standing until the new ones land: the old transcript is
        // still the best reading of this meeting until a better one exists.
        await transcribeRecording(id, opts);
      } catch (err) {
        setStatus(IDLE);
        setNotice({ ok: false, text: `Could not transcribe: ${(err as Error).message}` });
      } finally {
        setIsBusy(false);
      }
    },
    [isRecording, transcribeRecording],
  );

  const deleteRecording = useCallback(
    async (id: string): Promise<void> => {
      if (isRecording) return;
      // Let go of it on screen FIRST. The player has mix.wav open, and on
      // Windows a file with a live handle cannot be unlinked at all — so the
      // panel has to release it before main tries, not after.
      if (loadedRef.current === id) {
        setLines([]);
        setWarnings([]);
        showLoaded(null);
        showLabels({});
        setTranscriptInfo(null);
      }
      try {
        setRecordings(await window.api.recordingsDelete(id));
        setNotice({ ok: true, text: 'Recording deleted.' });
      } catch (err) {
        setNotice({ ok: false, text: `Could not delete: ${(err as Error).message}` });
        // The list is the thing the user is looking at; put it back in step with
        // the disk whether or not the delete landed.
        void refreshRecordings();
      }
    },
    [isRecording, refreshRecordings, showLabels, showLoaded],
  );

  const dismissNotice = useCallback(() => setNotice(null), []);

  /** Report the outcome of an action the user took, on the page they took it. */
  const notify = useCallback((ok: boolean, text: string) => setNotice({ ok, text }), []);

  // Successes clear themselves; failures stay until dismissed, because they are
  // the ones that need doing something about. Here rather than in each page, so
  // every surface that shows a notice agrees on how long it lives.
  useEffect(() => {
    if (!notice || !notice.ok) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  const startSafely = useCallback(
    async (opts: StartOptions): Promise<void> => {
      try {
        await start(opts);
      } catch (err) {
        setStatus({ kind: 'error', text: `Error: ${(err as Error).message}` });
        void source.current?.stop();
        void window.api.recorderStop();
        source.current = null;
        teardown();
      }
    },
    [start, teardown],
  );

  return {
    status,
    warnings,
    isRecording,
    isPaused,
    isBusy,
    openTracks,
    activity,
    lines,
    recordings,
    loadedRecording,
    transcriptInfo,
    speakerLabels,
    renameSpeaker,
    refreshRecordings,
    openRecording,
    retranscribe,
    deleteRecording,
    notice,
    notify,
    dismissNotice,
    levels,
    recordedSeconds,
    newSession,
    start: startSafely,
    setPaused,
    stop,
  };
}
