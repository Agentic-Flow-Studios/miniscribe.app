import { useCallback, useEffect, useRef, useState } from 'react';

export interface Player {
  /** Seconds into the recording. Updated on an animation frame while playing. */
  time: number;
  duration: number;
  isPlaying: boolean;
  /** True until the recording's audio is ready to play. */
  isLoading: boolean;
  /** Playback speed, 1 being real time. */
  rate: number;
  setRate: (rate: number) => void;
  /** 0..1. Independent of mute, so unmuting returns to where it was. */
  volume: number;
  setVolume: (volume: number) => void;
  isMuted: boolean;
  toggleMute: () => void;
  toggle: () => void;
  /** Jump to a point and keep going (or start, if stopped). */
  playAt: (seconds: number) => void;
  seek: (seconds: number) => void;
  /** Nudge by a signed number of seconds, clamped to the recording. */
  skip: (seconds: number) => void;
  error: string | null;
}

export const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2] as const;

/**
 * Plays a whole recording, with the clock the transcript follows.
 *
 * The element streams a file:// URL, so seeking anywhere in a 45-minute meeting
 * is immediate and nothing but the played part is ever read. `time` is sampled
 * on an animation frame rather than from `timeupdate`, which only fires about
 * four times a second — too coarse to light up a word as it is spoken.
 */
export function usePlayer(recordingId: string | null): Player {
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rate, setRateState] = useState(1);
  const [volume, setVolumeState] = useState(1);
  const [isMuted, setIsMuted] = useState(false);

  const audio = useRef<HTMLAudioElement | null>(null);
  const frame = useRef<number | null>(null);
  // Playback settings belong to the listener, not to the file: someone who
  // listens back at 1.5x wants the next recording at 1.5x too. Mirrored in refs
  // because a fresh element is built outside of React's render for each
  // recording and has to be configured before it is ever heard.
  const settings = useRef({ rate: 1, volume: 1, muted: false });

  const stopClock = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  }, []);

  const startClock = useCallback(() => {
    stopClock();
    let last = -1;
    const tick = (): void => {
      const el = audio.current;
      if (!el) return;
      // Sampled every frame, published about twelve times a second. Word
      // highlighting cannot resolve finer than that anyway, and every published
      // value is a render of everything derived from the clock.
      if (Math.abs(el.currentTime - last) >= 0.08) {
        last = el.currentTime;
        setTime(el.currentTime);
      }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, [stopClock]);

  // One element per recording. Switching recordings tears the old one down —
  // audio that outlives the transcript it belongs to is just noise.
  useEffect(() => {
    setTime(0);
    setDuration(0);
    setIsPlaying(false);
    setError(null);

    if (!recordingId) {
      audio.current = null;
      setIsLoading(false);
      return;
    }

    let live = true;
    setIsLoading(true);

    void (async () => {
      try {
        const { url, seconds } = await window.api.recordingsAudio(recordingId);
        if (!live) return;
        const el = new Audio(url);
        el.playbackRate = settings.current.rate;
        el.volume = settings.current.volume;
        el.muted = settings.current.muted;
        el.addEventListener('play', () => setIsPlaying(true));
        el.addEventListener('pause', () => setIsPlaying(false));
        el.addEventListener('ended', () => setIsPlaying(false));
        el.addEventListener('error', () => setError('Could not play this recording.'));
        // The mix is written before this resolves, so its duration is known
        // without waiting for metadata; the element corrects it either way.
        el.addEventListener('loadedmetadata', () => {
          if (Number.isFinite(el.duration)) setDuration(el.duration);
        });
        audio.current = el;
        setDuration(seconds);
        setIsLoading(false);
      } catch (err) {
        if (!live) return;
        setError(`Could not load audio: ${(err as Error).message}`);
        setIsLoading(false);
      }
    })();

    return () => {
      live = false;
      audio.current?.pause();
      audio.current = null;
    };
  }, [recordingId]);

  // The clock runs only while sound does.
  useEffect(() => {
    if (isPlaying) startClock();
    else stopClock();
    return stopClock;
  }, [isPlaying, startClock, stopClock]);

  useEffect(() => stopClock, [stopClock]);

  const seek = useCallback((seconds: number): void => {
    const el = audio.current;
    if (!el) return;
    const limit = Number.isFinite(el.duration) ? el.duration : Number.POSITIVE_INFINITY;
    el.currentTime = Math.min(Math.max(0, seconds), limit);
    // Repaint the position immediately: while paused there is no clock running
    // to notice the move.
    setTime(el.currentTime);
  }, []);

  const skip = useCallback(
    (seconds: number): void => {
      const el = audio.current;
      if (!el) return;
      seek(el.currentTime + seconds);
    },
    [seek],
  );

  const toggle = useCallback((): void => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) void el.play().catch((err: Error) => setError(`Playback failed: ${err.message}`));
    else el.pause();
  }, []);

  const playAt = useCallback(
    (seconds: number): void => {
      const el = audio.current;
      if (!el) return;
      seek(seconds);
      if (el.paused) {
        void el.play().catch((err: Error) => setError(`Playback failed: ${err.message}`));
      }
    },
    [seek],
  );

  const setRate = useCallback((next: number): void => {
    settings.current.rate = next;
    setRateState(next);
    if (audio.current) audio.current.playbackRate = next;
  }, []);

  const setVolume = useCallback((next: number): void => {
    const clamped = Math.min(1, Math.max(0, next));
    settings.current.volume = clamped;
    setVolumeState(clamped);
    if (audio.current) audio.current.volume = clamped;
    // Dragging the slider up is the same instruction as unmuting.
    if (clamped > 0 && settings.current.muted) {
      settings.current.muted = false;
      setIsMuted(false);
      if (audio.current) audio.current.muted = false;
    }
  }, []);

  const toggleMute = useCallback((): void => {
    const next = !settings.current.muted;
    settings.current.muted = next;
    setIsMuted(next);
    if (audio.current) audio.current.muted = next;
  }, []);

  return {
    time,
    duration,
    isPlaying,
    isLoading,
    rate,
    setRate,
    volume,
    setVolume,
    isMuted,
    toggleMute,
    toggle,
    playAt,
    seek,
    skip,
    error,
  };
}
