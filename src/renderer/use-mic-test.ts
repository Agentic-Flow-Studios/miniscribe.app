import { useCallback, useEffect, useRef, useState } from 'react';

/** How long a test runs before it stops itself, in ms. Long enough to say a
 *  sentence, short enough that a forgotten test never holds the device. */
const TEST_DURATION = 15_000;

/** Peak above which we are willing to say the microphone is hearing something.
 *  Room tone on a laptop mic sits well under this; speech clears it easily. */
const SIGNAL_PEAK = 0.02;

export type MicTestState = 'idle' | 'starting' | 'listening' | 'error';

export interface MicTest {
  state: MicTestState;
  /** Current level as a 0-100 percentage, scaled for meter travel. */
  level: number;
  /** Loudest sample seen this run, 0-1. */
  peak: number;
  /** True once this run has heard something louder than room tone. */
  heardSignal: boolean;
  error: string | null;
  start: () => void;
  stop: () => void;
}

function describe(err: unknown): string {
  const name = (err as { name?: string }).name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Microphone access was refused. Grant it in your system settings and try again.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'That microphone is no longer available. Pick another one.';
  }
  if (name === 'NotReadableError') {
    return 'Another app is holding that microphone. Close it and try again.';
  }
  return `Could not open that microphone: ${(err as Error).message}`;
}

/**
 * Listen to one microphone and report what it is hearing, without recording.
 *
 * Deliberately separate from the capture pipeline: nothing here writes to disk,
 * reaches the ASR worker, or touches the session. A test is a question about the
 * hardware ("is this the mic I think it is, and is it live?"), and answering it
 * must never be able to leave a stray file or a half-open session behind.
 */
export function useMicTest(deviceId: string | null): MicTest {
  const [state, setState] = useState<MicTestState>('idle');
  const [level, setLevel] = useState(0);
  const [peak, setPeak] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const stream = useRef<MediaStream | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const raf = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = useCallback(() => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = 0;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    void ctx.current?.close();
    ctx.current = null;
    setLevel(0);
    setState((prev) => (prev === 'error' ? prev : 'idle'));
  }, []);

  const start = useCallback(() => {
    stop();
    setError(null);
    setPeak(0);
    setState('starting');

    const audio: MediaTrackConstraints = {
      // Same unprocessed capture the recorder uses, so the test measures the
      // signal the recording would actually get.
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
    };
    if (deviceId) audio.deviceId = { exact: deviceId };

    void navigator.mediaDevices
      .getUserMedia({ audio })
      .then((opened) => {
        stream.current = opened;
        const audioCtx = new AudioContext();
        ctx.current = audioCtx;
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 2048;
        audioCtx.createMediaStreamSource(opened).connect(analyser);
        // Not connected to the destination: monitoring the mic through the
        // speakers is how a test turns into feedback howl.

        const samples = new Float32Array(analyser.fftSize);
        let seen = 0;
        const tick = (): void => {
          analyser.getFloatTimeDomainData(samples);
          let loudest = 0;
          for (const sample of samples) {
            const size = Math.abs(sample);
            if (size > loudest) loudest = size;
          }
          if (loudest > seen) {
            seen = loudest;
            setPeak(seen);
          }
          // Scaled the same way the recording meters are, so a level that looks
          // healthy here looks the same once recording.
          const pct = Math.round(Math.min(1, loudest * 3) * 100);
          setLevel((prev) => (prev === pct ? prev : pct));
          raf.current = requestAnimationFrame(tick);
        };

        setState('listening');
        raf.current = requestAnimationFrame(tick);
        timer.current = setTimeout(stop, TEST_DURATION);
      })
      .catch((err) => {
        console.error('[mic-test] open failed', err);
        setError(describe(err));
        setState('error');
      });
  }, [deviceId, stop]);

  // A test belongs to the device that was chosen when it started. Switching the
  // picker mid-test would otherwise leave the old device open and the meter
  // reporting it under the new device's name.
  useEffect(() => stop, [deviceId, stop]);

  return {
    state,
    level,
    peak,
    heardSignal: peak > SIGNAL_PEAK,
    error,
    start,
    stop,
  };
}
