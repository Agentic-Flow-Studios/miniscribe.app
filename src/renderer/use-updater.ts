import { useCallback, useEffect, useState } from 'react';

/** Mirrors the state machine in src/updater.ts. */
export type UpdateStage =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'unsupported';

export interface UpdateState {
  stage: UpdateStage;
  currentVersion: string;
  newVersion: string | null;
  progressPct: number;
  downloadSpeedMb: number;
  lastCheckedAt: string | null;
  message: string | null;
}

export interface Updater {
  state: UpdateState;
  check: () => Promise<void>;
  download: () => Promise<void>;
  install: () => Promise<void>;
}

const INITIAL: UpdateState = {
  stage: 'idle',
  currentVersion: '',
  newVersion: null,
  progressPct: 0,
  downloadSpeedMb: 0,
  lastCheckedAt: null,
  message: null,
};

/**
 * The update state, as main sees it.
 *
 * Every call resolves with the state it left behind, and main also pushes the
 * state on every change — a download reports progress the renderer never asked
 * for, and the automatic check at launch can land while nobody is looking at
 * Settings.
 */
export function useUpdater(): Updater {
  const [state, setState] = useState<UpdateState>(INITIAL);

  useEffect(() => {
    void window.api
      .updaterState()
      .then(setState)
      .catch((err) => console.error('[updater] state failed', err));
    window.api.onUpdaterChanged((next) => setState(next));
  }, []);

  const run = useCallback(
    async (action: () => Promise<UpdateState>, what: string): Promise<void> => {
      try {
        setState(await action());
      } catch (err) {
        // A rejected call is itself an update failure worth showing: the panel
        // must never be left on "Checking…" with nothing coming.
        setState((prev) => ({
          ...prev,
          stage: 'error',
          message: `${what} failed: ${(err as Error).message}`,
        }));
      }
    },
    [],
  );

  return {
    state,
    check: useCallback(() => run(() => window.api.updaterCheck(), 'Update check'), [run]),
    download: useCallback(() => run(() => window.api.updaterDownload(), 'Download'), [run]),
    install: useCallback(() => run(() => window.api.updaterInstall(), 'Install'), [run]),
  };
}
