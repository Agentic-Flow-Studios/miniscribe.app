import { useEffect, useRef, useState } from 'react';
import { SYSTEM_DEFAULT_INPUT, type AudioInput } from './use-audio-inputs';

export interface InputLevels {
  /**
   * Live peak per device id, 0-1, mutated in place. A ref rather than state:
   * these move every animation frame, and routing that through React would
   * repaint the whole widget with them. The system-default entry is mirrored
   * under SYSTEM_DEFAULT_INPUT as well as under the device it resolved to.
   */
  levels: React.RefObject<Record<string, number>>;
  /** Devices that would not open — in use elsewhere, or gone. */
  unavailable: string[];
  /** True once at least one device is open and being read. */
  isMonitoring: boolean;
}

const BASE_CONSTRAINTS: MediaTrackConstraints = {
  // Match the recorder: a level shown here should be the level it would capture.
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: 1,
};

interface OpenInput {
  id: string;
  stream: MediaStream;
  analyser: AnalyserNode;
}

/**
 * Listen to every microphone at once and report what each one hears.
 *
 * This is how a user answers the only question that matters when picking an
 * input: "which of these is the one that moves when I talk?" Device names lie —
 * "Microphone (2- USB Audio Device)" tells you nothing — so the meters do the
 * identifying instead.
 *
 * Only runs while `isActive`, which callers tie to the panel being open and to
 * NOT recording: holding six devices open in the background would be rude, and
 * on Windows a device already open can refuse to open again for the take.
 */
export function useInputLevels(devices: AudioInput[], isActive: boolean): InputLevels {
  const levels = useRef<Record<string, number>>({});
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const [isMonitoring, setIsMonitoring] = useState(false);

  // Effects must not re-run because the array identity changed; the set of ids
  // is what actually matters.
  const deviceKey = devices.map((d) => d.id).join('|');

  useEffect(() => {
    if (!isActive) {
      levels.current = {};
      setUnavailable([]);
      setIsMonitoring(false);
      return;
    }

    let cancelled = false;
    let raf = 0;
    let ctx: AudioContext | null = null;
    const open: OpenInput[] = [];

    const listen = async (): Promise<void> => {
      const audioCtx = new AudioContext();
      ctx = audioCtx;
      const failed: string[] = [];

      const attach = (id: string, stream: MediaStream): void => {
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 1024;
        audioCtx.createMediaStreamSource(stream).connect(analyser);
        // Never connected to the destination — monitoring six microphones
        // through the speakers is a feedback loop, not a meter.
        open.push({ id, stream, analyser });
      };

      // The default first, so we learn which real device it stands for and can
      // show that row moving too, without opening the same hardware twice.
      let defaultId: string | null = null;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: BASE_CONSTRAINTS });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        defaultId = stream.getAudioTracks()[0]?.getSettings().deviceId ?? null;
        attach(SYSTEM_DEFAULT_INPUT, stream);
      } catch (err) {
        console.warn('[levels] default input unavailable', err);
        failed.push(SYSTEM_DEFAULT_INPUT);
      }

      for (const device of devices) {
        if (cancelled) break;
        if (device.id === defaultId) continue; // already open as the default
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: { ...BASE_CONSTRAINTS, deviceId: { exact: device.id } },
          });
          if (cancelled) {
            stream.getTracks().forEach((t) => t.stop());
            break;
          }
          attach(device.id, stream);
        } catch (err) {
          console.warn(`[levels] ${device.label} unavailable`, err);
          failed.push(device.id);
        }
      }

      if (cancelled || open.length === 0) {
        setUnavailable(failed);
        return;
      }

      const samples = new Float32Array(1024);
      const tick = (): void => {
        for (const input of open) {
          input.analyser.getFloatTimeDomainData(samples);
          let loudest = 0;
          for (const sample of samples) {
            const size = Math.abs(sample);
            if (size > loudest) loudest = size;
          }
          // Decay rather than snap, so a meter reads like a VU meter instead of
          // flickering between frames of a syllable.
          const previous = levels.current[input.id] ?? 0;
          levels.current[input.id] = Math.max(loudest, previous * 0.85);
          if (input.id === SYSTEM_DEFAULT_INPUT && defaultId) {
            levels.current[defaultId] = levels.current[SYSTEM_DEFAULT_INPUT];
          }
        }
        raf = requestAnimationFrame(tick);
      };

      setUnavailable(failed);
      setIsMonitoring(true);
      raf = requestAnimationFrame(tick);
    };

    void listen().catch((err) => console.error('[levels] monitor failed', err));

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      open.forEach((input) => input.stream.getTracks().forEach((t) => t.stop()));
      void ctx?.close();
      levels.current = {};
      setIsMonitoring(false);
    };
    // devices is intentionally read through deviceKey; see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceKey, isActive]);

  return { levels, unavailable, isMonitoring };
}
