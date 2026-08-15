import { useCallback, useEffect, useRef, useState } from 'react';
import type { AudioChunk, TrackKind } from '../capture-types';
import { SAMPLE_RATE, WebCaptureSource } from './capture';

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
      transcribeFiles: (tracks: TrackFile[]) => Promise<TranscriptSegment[]>;
      recordingsList: () => Promise<Recording[]>;
      recordingsTranscribe: (
        id: string,
        opts: { diarize: boolean; numSpeakers: number },
      ) => Promise<TranscriptSegment[]>;
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

interface TrackStats {
  frames: number;
  peak: number;
  sumSq: number;
}

const TRACKS: TrackKind[] = ['me', 'them'];

const emptyStats = (): Record<TrackKind, TrackStats> => ({
  me: { frames: 0, peak: 0, sumSq: 0 },
  them: { frames: 0, peak: 0, sumSq: 0 },
});

export interface Session {
  status: { kind: StatusKind; text: string };
  /** Capture diagnostics from the last run: silent tracks, dropped audio. */
  warnings: string[];
  isRecording: boolean;
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
  /** User-supplied names, keyed by raw speaker id. Persisted per recording. */
  speakerLabels: Record<string, string>;
  /** Name a speaker; an empty name restores the raw id. */
  renameSpeaker: (speaker: string, name: string) => void;
  refreshRecordings: () => Promise<void>;
  openRecording: (id: string, opts: StopOptions) => Promise<void>;
  /**
   * Live peak per track, mutated in place by the capture callback. Deliberately
   * a ref and not state: meters repaint every animation frame, and routing that
   * through React would re-render the transcript with it.
   */
  levels: React.RefObject<Record<TrackKind, number>>;
  /** Clear the panel back to an empty, unstarted session. */
  newSession: () => void;
  start: (opts: StartOptions) => Promise<void>;
  stop: (opts: StopOptions) => Promise<void>;
}

export function useSession(): Session {
  const [status, setStatus] = useState<Session['status']>({ kind: 'idle', text: 'Miniscribe ready.' });
  const [warnings, setWarnings] = useState<string[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [openTracks, setOpenTracks] = useState<TrackKind[]>([]);
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [activity, setActivity] = useState<Record<TrackKind, Activity>>({
    me: 'idle',
    them: 'idle',
  });
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loadedRecording, setLoadedRecording] = useState<string | null>(null);
  const [speakerLabels, setSpeakerLabels] = useState<Record<string, string>>({});

  const source = useRef<WebCaptureSource | null>(null);
  const levels = useRef<Record<TrackKind, number>>({ me: 0, them: 0 });
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
    void refreshRecordings();
  }, [appendLine, refreshRecordings]);

  const onChunk = useCallback((chunk: AudioChunk): void => {
    const st = stats.current[chunk.kind];
    st.frames += chunk.samples.length;
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
    setOpenTracks([]);
    setActivity({ me: 'idle', them: 'idle' });
    levels.current = { me: 0, them: 0 };
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
    setStatus({ kind: 'idle', text: 'Ready to record.' });
  }, [isRecording, showLabels, showLoaded]);

  const start = useCallback(
    async (opts: StartOptions): Promise<void> => {
      gaps.current = { me: 0, them: 0 };
      stats.current = emptyStats();
      lineCount.current = 0;
      setLines([]);
      setWarnings([]);
      setActivity({ me: 'idle', them: 'idle' });
      // A new recording owns the transcript panel; nothing from the archive is
      // on screen any more, and its audio is not closed yet, so nothing is
      // playable either. Names belong to a recording, so they go with it.
      showLoaded(null);
      showLabels({});

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
        const segments = await window.api.transcribeFiles(tracks);
        showSegments(segments);
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

  const openRecording = useCallback(
    async (id: string, opts: StopOptions): Promise<void> => {
      setIsBusy(true);
      showLoaded(id);
      setLines([]);
      setWarnings([]);
      // Names first: they are a single small file, and having them in hand
      // before the segments land means no line ever renders under a cluster id
      // and then renames itself a moment later.
      showLabels(
        await window.api.recordingsLabels(id).catch((err) => {
          console.error('[labels] load failed', err);
          return {};
        }),
      );
      setStatus({
        kind: 'working',
        text: opts.diarize
          ? 'Re-transcribing with speaker separation… (slower)'
          : 'Re-transcribing this recording…',
      });
      const t0 = performance.now();
      try {
        const segments = await window.api.recordingsTranscribe(id, opts);
        showSegments(segments);
        const elapsed = (performance.now() - t0) / 1000;
        setStatus({
          kind: 'done',
          text: `${segments.length} utterances, re-transcribed in ${elapsed.toFixed(1)}s.`,
        });
      } catch (err) {
        showLoaded(null);
        setStatus({ kind: 'error', text: `Error: ${(err as Error).message}` });
      } finally {
        setIsBusy(false);
      }
    },
    [showLabels, showLoaded, showSegments],
  );

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
    isBusy,
    openTracks,
    activity,
    lines,
    recordings,
    loadedRecording,
    speakerLabels,
    renameSpeaker,
    refreshRecordings,
    openRecording,
    levels,
    newSession,
    start: startSafely,
    stop,
  };
}
