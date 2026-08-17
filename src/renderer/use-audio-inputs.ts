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

export type AudioPermissionStatus = 'prompt' | 'granted' | 'denied' | 'checking';

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
  /** Microphone permission status: granted, denied, prompt, or checking. */
  permissionStatus: AudioPermissionStatus;
  /** Explanation if microphone access failed or was refused. */
  permissionError: string | null;
  /** Request microphone access from the user/OS to verify and reveal devices. */
  requestPermission: () => Promise<boolean>;
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
  const [permissionStatus, setPermissionStatus] = useState<AudioPermissionStatus>('checking');
  const [permissionError, setPermissionError] = useState<string | null>(null);
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
    const labelsFound = inputs.some((d) => d.label !== '');
    setHasLabels(labelsFound);
    if (labelsFound) {
      setPermissionStatus('granted');
      setPermissionError(null);
    }
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

  const requestPermission = useCallback(async (): Promise<boolean> => {
    try {
      setPermissionStatus('checking');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setPermissionStatus('granted');
      setPermissionError(null);
      await refresh();
      return true;
    } catch (err: unknown) {
      console.warn('[inputs] microphone permission request failed:', err);
      const name = (err as { name?: string })?.name;
      let msg = 'Could not access the microphone.';
      if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
        msg = 'Microphone access was denied or blocked by system privacy settings.';
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        msg = 'No microphone device found on this system.';
      } else if (name === 'NotReadableError' || name === 'TrackStartError') {
        msg = 'Microphone is currently in exclusive use by another application.';
      }
      setPermissionStatus('denied');
      setPermissionError(msg);
      await refresh();
      return false;
    }
  }, [refresh]);

  const revealNames = useCallback(() => {
    void requestPermission();
  }, [requestPermission]);

  useEffect(() => {
    void refresh().then(() => {
      if (navigator.mediaDevices) {
        navigator.mediaDevices
          .enumerateDevices()
          .then((found) => {
            const inputs = found.filter((d) => d.kind === 'audioinput' && !ALIAS_IDS.has(d.deviceId));
            if (inputs.some((d) => d.label !== '')) {
              setPermissionStatus('granted');
              setHasLabels(true);
            } else {
              window.api?.systemGetPermissionStatus?.().then((status) => {
                if (status?.microphone === 'granted') {
                  void requestPermission();
                } else if (status?.microphone === 'denied') {
                  setPermissionStatus('denied');
                  setPermissionError('Microphone access is blocked in your system privacy settings.');
                } else {
                  setPermissionStatus('prompt');
                }
              }).catch(() => {
                setPermissionStatus('prompt');
              });
            }
          })
          .catch(() => {
            setPermissionStatus('prompt');
          });
      }
    });

    const media = navigator.mediaDevices;
    const onChange = (): void => void refresh();
    media.addEventListener('devicechange', onChange);
    return () => media.removeEventListener('devicechange', onChange);
  }, [refresh, requestPermission]);

  const micConstraintId = micDeviceId === SYSTEM_DEFAULT_INPUT ? null : micDeviceId;
  const test = useMicTest(micConstraintId);

  return {
    devices,
    micDeviceId,
    micConstraintId,
    chooseMic,
    hasLabels,
    permissionStatus,
    permissionError,
    requestPermission,
    revealNames,
    test,
  };
}
