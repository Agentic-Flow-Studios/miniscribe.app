import type { AudioChunk, TrackKind } from '../capture-types';

export const SAMPLE_RATE = 16000;

export interface CaptureCallbacks {
  onChunk: (chunk: AudioChunk) => void;
  /** A discontinuity in the shared frame clock: `missing` frames the capture
   *  thread never delivered, starting at `atFrame`. */
  onGap: (kind: TrackKind, missing: number, atFrame: number) => void;
  /** Something the take survived but the user should know about. */
  onNotice?: (text: string) => void;
}

export interface CaptureOptions {
  /** Which microphone to open. Empty or absent means the system default. */
  micDeviceId?: string | null;
}

/**
 * The seam.
 *
 * Everything downstream of capture talks to this interface and nothing else, so
 * a native per-platform implementation (ScreenCaptureKit on macOS, WASAPI or
 * libobs on Windows) can replace the web one without the pipeline noticing.
 * `AudioChunk.frame` is the part of the contract that makes the swap survivable
 * — a native source has its own clock, and the frame index is where that gets
 * reconciled.
 */
export interface CaptureSource {
  readonly sampleRate: number;
  /** Returns the kinds that actually opened; a requested source can fail. */
  start(kinds: TrackKind[], opts?: CaptureOptions): Promise<TrackKind[]>;
  stop(): Promise<void>;
}

interface TrackState {
  src: MediaStreamAudioSourceNode;
  node: AudioWorkletNode;
  mute: GainNode;
  stream: MediaStream;
  /** Next frame we expect, rebased to recording start. Gaps are the shortfall. */
  nextFrame: number;
}

interface WorkletMessage {
  frame: number;
  samples: Float32Array;
  peak: number;
}

// Resolved against the document URL, same as the <script> tag in index.html.
const WORKLET_URL = '../../dist/capture-worklet.js';

// Raw mic: echo cancellation / noise suppression / AGC all OFF. With system
// loopback also active, Chromium's echo canceller uses the loopback as its
// reference and can suppress the mic to near-silence. System audio is captured
// on its own track, so the mic wants to be clean and unprocessed.
// Trade-off: on SPEAKERS the mic also picks up "Them". Use headphones for clean
// separation; flip these to `true` if you must run on speakers.
async function openMic(
  deviceId: string | null | undefined,
  onNotice: ((text: string) => void) | undefined,
): Promise<MediaStream> {
  const audio: MediaTrackConstraints = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 1,
  };
  if (!deviceId) return navigator.mediaDevices.getUserMedia({ audio });

  try {
    // `exact` rather than a plain id: a soft constraint would quietly hand back
    // the default device, and a recording made from the wrong microphone is not
    // something the user can tell from the waveform until it is too late.
    return await navigator.mediaDevices.getUserMedia({ audio: { ...audio, deviceId: { exact: deviceId } } });
  } catch (err) {
    // Chosen device is unplugged, or held exclusively by another app. Take the
    // default instead — a recording from the wrong mic beats no recording — but
    // say so, because the user picked that device on purpose.
    console.warn('[capture] chosen microphone unavailable, using system default', err);
    onNotice?.('The chosen microphone was unavailable; recorded from the system default instead.');
    return navigator.mediaDevices.getUserMedia({ audio });
  }
}

// Triggers main's setDisplayMediaRequestHandler -> Windows WASAPI loopback.
// Returns null when the grant produced no audio track (nothing playing, or
// loopback unavailable on this device/platform).
async function openSystem(): Promise<MediaStream | null> {
  const s = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });
  s.getVideoTracks().forEach((t) => t.stop());
  if (s.getAudioTracks().length > 0) return s;
  s.getTracks().forEach((t) => t.stop());
  return null;
}

export class WebCaptureSource implements CaptureSource {
  readonly sampleRate = SAMPLE_RATE;
  private ctx: AudioContext | null = null;
  private tracks = new Map<TrackKind, TrackState>();
  private baseFrame = 0;

  constructor(private cbs: CaptureCallbacks) {}

  async start(kinds: TrackKind[], opts: CaptureOptions = {}): Promise<TrackKind[]> {
    // Open AudioContext at native hardware sample rate (e.g. 48kHz/44.1kHz).
    // The AudioWorklet handles anti-aliased 16kHz downsampling in real-time,
    // avoiding Chromium's internal PushPullFIFO clock drift and buffer overflow glitches.
    const ctx = new AudioContext();
    this.ctx = ctx;
    await ctx.audioWorklet.addModule(WORKLET_URL);

    const streams = new Map<TrackKind, MediaStream>();
    for (const kind of kinds) {
      const s =
        kind === 'me'
          ? await openMic(opts.micDeviceId, this.cbs.onNotice)
          : await openSystem();
      if (s) streams.set(kind, s);
    }
    if (streams.size === 0) {
      await this.stop();
      return [];
    }

    this.baseFrame = Math.round(ctx.currentTime * SAMPLE_RATE);
    for (const [kind, stream] of streams) this.attach(kind, stream);
    return [...streams.keys()];
  }

  private attach(kind: TrackKind, stream: MediaStream): void {
    const ctx = this.ctx!;
    const src = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, 'capture', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelCountMode: 'explicit',
    });
    // The graph is pull-based: a node has to reach the destination to be
    // rendered. Zero gain keeps it pumping without echoing system audio back
    // out of the speakers.
    const mute = ctx.createGain();
    mute.gain.value = 0;

    const state: TrackState = { src, node, mute, stream, nextFrame: 0 };
    node.port.onmessage = (e: MessageEvent<WorkletMessage>) => this.receive(kind, state, e.data);

    src.connect(node);
    node.connect(mute);
    mute.connect(ctx.destination);
    this.tracks.set(kind, state);
  }

  private receive(kind: TrackKind, state: TrackState, msg: WorkletMessage): void {
    const frame = state.nextFrame;
    this.cbs.onChunk({ kind, frame, peak: msg.peak, samples: msg.samples });
    state.nextFrame = frame + msg.samples.length;
  }

  async stop(): Promise<void> {
    // Ask each worklet for its partial chunk before tearing the graph down,
    // otherwise every track loses up to 128ms off the end.
    for (const state of this.tracks.values()) state.node.port.postMessage('flush');
    // Give those messages a turn to land. They cross a thread boundary, so
    // there's nothing to await.
    await new Promise((r) => setTimeout(r, 50));

    for (const state of this.tracks.values()) {
      state.node.port.onmessage = null;
      state.src.disconnect();
      state.node.disconnect();
      state.mute.disconnect();
      state.stream.getTracks().forEach((t) => t.stop());
    }
    this.tracks.clear();
    await this.ctx?.close();
    this.ctx = null;
  }
}
