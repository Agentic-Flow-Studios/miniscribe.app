import { useCallback, useEffect, useRef, useState } from 'react';
import { useMicTest, type MicTest } from './use-mic-test';

/**
 * The selection that means "whatever the OS calls the default input". A named
 * sentinel rather than an empty string, because a picker needs a value it can
 * show as selected; it is translated to "no deviceId constraint" — how every
 * recording worked before this picker existed — at the capture seam.
 */
export const SYSTEM_DEFAULT_INPUT = 'system-default';

const STORAGE_KEY = 'miniscribe.micDeviceId';

export interface AudioInput {
  id: string;
  label: string;
}

export interface AudioInputs {
  /** Selectable microphones, without the "system default" entry. */
  devices: AudioInput[];
  /** What the picker shows as selected: a device id, or SYSTEM_DEFAULT_INPUT. */
  micDeviceId: string;
  /** What capture opens: a device id, or null for the system default. */
  micConstraintId: string | null;
  chooseMic: (id: string) => void;
  /**
   * True once the browser has handed over real device names. Chromium withholds
   * them until the page has held a microphone permission at least once, so a
   * first-run list is a row of "Microphone 2"-style placeholders.
   */
  hasLabels: boolean;
  /** Ask for a momentary mic grant so the names above become real. */
  revealNames: () => void;
  /**
   * Listen to the chosen microphone without recording. Owned here rather than
   * by the picker so that whoever starts a recording can close the test first:
   * on Windows a device already open for testing can refuse to open again.
   */
  test: MicTest;
}

// Chromium synthesises these two on Windows: they are aliases for whatever the
// OS default is, not devices in their own right. We offer that choice as
// SYSTEM_DEFAULT_INPUT already, and listing three entries that all mean "the
// default" is how a picker stops being useful.
const ALIAS_IDS = new Set(['default', 'communications']);

function readSaved(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? SYSTEM_DEFAULT_INPUT;
  } catch {
    return SYSTEM_DEFAULT_INPUT;
  }
}

/**
 * The list of microphones the machine can record from, and which one is chosen.
 *
 * The choice outlives the app: a user with a headset and a webcam picks once.
 * It is validated against the live device list on every change, because a saved
 * id belongs to hardware that may not be plugged in this morning — and silently
 * recording from the wrong microphone is worse than recording from the default.
 */
export function useAudioInputs(): AudioInputs {
  const [devices, setDevices] = useState<AudioInput[]>([]);
  const [hasLabels, setHasLabels] = useState(false);
  const [micDeviceId, setMicDeviceId] = useState<string>(readSaved);
  // Read inside the enumeration callback, which must not be rebuilt (and so
  // must not re-subscribe to devicechange) every time the selection moves.
  const chosen = useRef(micDeviceId);

  const chooseMic = useCallback((id: string) => {
    chosen.current = id;
    setMicDeviceId(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // A locked-down storage partition costs the preference, not the recording.
    }
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    let found: MediaDeviceInfo[];
    try {
      found = await navigator.mediaDevices.enumerateDevices();
    } catch (err) {
      console.error('[inputs] enumerate failed', err);
      return;
    }

    const inputs = found.filter((d) => d.kind === 'audioinput' && !ALIAS_IDS.has(d.deviceId));
    setHasLabels(inputs.some((d) => d.label !== ''));
    setDevices(
      inputs.map((d, i) => ({
        id: d.deviceId,
        label: d.label || `Microphone ${i + 1}`,
      })),
    );

    // The saved device is gone — unplugged, or on another machine entirely.
    // Fall back rather than hold a selection that would record nothing.
    if (
      chosen.current !== SYSTEM_DEFAULT_INPUT &&
      !inputs.some((d) => d.deviceId === chosen.current)
    ) {
      chooseMic(SYSTEM_DEFAULT_INPUT);
    }
  }, [chooseMic]);

  useEffect(() => {
    void refresh();
    const media = navigator.mediaDevices;
    const onChange = (): void => void refresh();
    media.addEventListener('devicechange', onChange);
    return () => media.removeEventListener('devicechange', onChange);
  }, [refresh]);

  const revealNames = useCallback(() => {
    if (hasLabels) return;
    void navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        // The grant is the whole point; the audio is not wanted.
        stream.getTracks().forEach((t) => t.stop());
        return refresh();
      })
      .catch((err) => console.error('[inputs] name reveal failed', err));
  }, [hasLabels, refresh]);

  const micConstraintId = micDeviceId === SYSTEM_DEFAULT_INPUT ? null : micDeviceId;
  const test = useMicTest(micConstraintId);

  return {
    devices,
    micDeviceId,
    micConstraintId,
    chooseMic,
    hasLabels,
    revealNames,
    test,
  };
}
