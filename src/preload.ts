import { contextBridge, ipcRenderer } from 'electron';
import type { TrackKind } from './capture-types';

interface TrackFile {
  path: string;
  speaker: string;
  diarize?: boolean;
  numSpeakers?: number;
}

interface LiveUtterance {
  kind: TrackKind;
  start: number;
  end: number;
  text: string;
  words: { t: number; text: string }[];
}

contextBridge.exposeInMainWorld('api', {
  /** Open a session directory; returns its path. */
  recorderStart: (): Promise<string> => ipcRenderer.invoke('recorder:start'),
  /** Fire-and-forget so disk latency can never back up into the audio thread. */
  recorderChunk: (kind: TrackKind, samples: Float32Array): void =>
    ipcRenderer.send('recorder:chunk', kind, samples),
  /** Flushes the trailing utterance, then closes each WAV. */
  recorderStop: (): Promise<{ kind: TrackKind; path: string; seconds: number }[]> =>
    ipcRenderer.invoke('recorder:stop'),
  /** Utterances pushed from the ASR worker during recording. */
  onLiveUtterance: (cb: (u: LiveUtterance) => void): void => {
    ipcRenderer.on('live:utterance', (_evt, u: LiveUtterance) => cb(u));
  },
  /** Speech start/stop per track, ahead of the utterance itself. */
  onLiveActivity: (cb: (a: { kind: TrackKind; speaking: boolean }) => void): void => {
    ipcRenderer.on('live:activity', (_evt, a: { kind: TrackKind; speaking: boolean }) => cb(a));
  },
  onLiveError: (cb: (message: string) => void): void => {
    ipcRenderer.on('live:error', (_evt, m: string) => cb(m));
  },
  transcribeFiles: (tracks: TrackFile[]) => ipcRenderer.invoke('transcribe-files', tracks),
  /** Past sessions on disk, newest first. */
  recordingsList: () => ipcRenderer.invoke('recordings:list'),
  /** Re-run ASR over an earlier session's WAVs. Takes an id, never a path. */
  recordingsTranscribe: (id: string, opts: { diarize: boolean; numSpeakers: number }) =>
    ipcRenderer.invoke('recordings:transcribe', id, opts),
  /** User-supplied speaker names for a recording, keyed by raw speaker id. */
  recordingsLabels: (id: string) => ipcRenderer.invoke('recordings:labels', id),
  recordingsSetLabels: (id: string, labels: Record<string, string>) =>
    ipcRenderer.invoke('recordings:set-labels', id, labels),
  /** Both tracks summed into one playable file, as a file:// URL. */
  recordingsAudio: (id: string) => ipcRenderer.invoke('recordings:audio', id),
  /** Save formatted transcript text; the user picks the file in a save dialog. */
  exportTranscript: (req: {
    suggestedName: string;
    content: string;
    extension: string;
    label: string;
  }): Promise<{ saved: boolean; path: string | null }> =>
    ipcRenderer.invoke('transcript:export', req),
  /** Toggle window display mode: 'main' or 'mini'. */
  windowSetMode: (mode: 'main' | 'mini') => ipcRenderer.invoke('window:set-mode', mode),
  windowSetAlwaysOnTop: (flag: boolean) => ipcRenderer.invoke('window:set-always-on-top', flag),
  /** `height` is how tall the widget must grow to show the open panel. */
  windowSetPopoverOpen: (open: boolean, height?: number) =>
    ipcRenderer.invoke('window:set-popover-open', open, height),
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  onWindowModeChanged: (cb: (mode: 'main' | 'mini') => void): void => {
    ipcRenderer.on('window:mode-changed', (_evt, mode: 'main' | 'mini') => cb(mode));
  },
  modelsList: () => ipcRenderer.invoke('models:list'),
  modelsCatalog: () => ipcRenderer.invoke('models:catalog'),
  modelsDownload: (id: string) => ipcRenderer.invoke('models:download', id),
  modelsDelete: (id: string) => ipcRenderer.invoke('models:delete', id),
  modelsSetActive: (id: string) => ipcRenderer.invoke('models:set-active', id),
  onModelProgress: (
    cb: (progress: { id: string; progressPct: number; downloadSpeedMb: number }) => void,
  ): void => {
    ipcRenderer.on('models:progress', (_evt, p) => cb(p));
  },
});
