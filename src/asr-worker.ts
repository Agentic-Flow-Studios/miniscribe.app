import {
  makeLiveTrack,
  transcribeFilesAsync,
  type LiveTrack,
  type TrackFile,
  type TranscriptSegment,
  type Word,
} from './transcription';
import type { TrackKind } from './capture-types';

// Runs in a utilityProcess, not in main.
//
// Decoding one utterance is a synchronous native call: an 8s segment costs on
// the order of a second of CPU. In main that would stall IPC and freeze the
// meters mid-meeting. Here it stalls nothing — main only relays messages.

export type WorkerIn =
  | { type: 'warmup' }
  | { type: 'reset' }
  | { type: 'chunk'; kind: TrackKind; samples: Float32Array }
  | { type: 'flush' }
  | { type: 'transcribe'; id: string; tracks: TrackFile[] };

export type WorkerOut =
  | { type: 'ready' }
  | {
      type: 'utterance';
      kind: TrackKind;
      start: number;
      end: number;
      text: string;
      words: Word[];
    }
  | { type: 'activity'; kind: TrackKind; speaking: boolean }
  | { type: 'flushed' }
  | { type: 'error'; message: string }
  | { type: 'transcribe:progress'; id: string; stage: string; percent: number }
  | { type: 'transcribe:done'; id: string; segments: TranscriptSegment[] }
  | { type: 'transcribe:error'; id: string; error: string };

// Electron's parentPort isn't in the ambient node types this project loads.
const parentPort = (
  process as unknown as {
    parentPort: {
      on(ev: 'message', cb: (e: { data: WorkerIn }) => void): void;
      postMessage(msg: WorkerOut): void;
    };
  }
).parentPort;

const tracks = new Map<TrackKind, LiveTrack>();
// Last speaking state reported per track, so only transitions cross the wire
// rather than a message per 128ms chunk.
const speaking = new Map<TrackKind, boolean>();

// Report speech start/stop. Only worth sending on the way IN to a segment: the
// decode that follows a segment ending is a synchronous native call, so a
// message posted just before it does not reach main until the decode is over
// and the utterance is already on its way. The renderer derives "transcribing"
// from the gap between speech stopping and the utterance landing.
function reportActivity(kind: TrackKind): void {
  const now = trackFor(kind).isSpeaking();
  // Absent means silent: without the default, a track's first chunk reports a
  // transition to "not speaking" and the UI flashes "transcribing…" before any
  // audio has been heard.
  if ((speaking.get(kind) ?? false) === now) {
    speaking.set(kind, now);
    return;
  }
  speaking.set(kind, now);
  parentPort.postMessage({ type: 'activity', kind, speaking: now });
}

function trackFor(kind: TrackKind): LiveTrack {
  let t = tracks.get(kind);
  if (!t) {
    t = makeLiveTrack();
    tracks.set(kind, t);
  }
  return t;
}

function emit(
  kind: TrackKind,
  utterances: { start: number; end: number; text: string; words: Word[] }[],
): void {
  for (const u of utterances) {
    parentPort.postMessage({
      type: 'utterance',
      kind,
      start: u.start,
      end: u.end,
      text: u.text,
      words: u.words,
    });
  }
}

parentPort.on('message', (e) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case 'warmup':
        // Builds the recognizer (~600MB of ONNX) so the first utterance of the
        // first recording isn't charged for the model load.
        makeLiveTrack();
        parentPort.postMessage({ type: 'ready' });
        break;

      case 'reset':
        // Fresh VAD per recording: segment offsets count from the first sample
        // pushed, so reusing one across recordings would keep the old clock.
        tracks.clear();
        speaking.clear();
        break;

      case 'chunk': {
        const utterances = trackFor(msg.kind).push(msg.samples);
        reportActivity(msg.kind);
        emit(msg.kind, utterances);
        break;
      }

      case 'flush':
        for (const [kind, track] of tracks) {
          emit(kind, track.flush());
          reportActivity(kind);
        }
        parentPort.postMessage({ type: 'flushed' });
        break;

      case 'transcribe': {
        const { id, tracks: fileTracks } = msg;
        void transcribeFilesAsync(fileTracks, (stage, percent) => {
          parentPort.postMessage({
            type: 'transcribe:progress',
            id,
            stage,
            percent,
          });
        })
          .then((segments) => {
            parentPort.postMessage({
              type: 'transcribe:done',
              id,
              segments,
            });
          })
          .catch((err) => {
            parentPort.postMessage({
              type: 'transcribe:error',
              id,
              error: (err as Error).message || String(err),
            });
          });
        break;
      }
    }
  } catch (err) {
    parentPort.postMessage({ type: 'error', message: (err as Error).message });
  }
});
