import { app, BrowserWindow, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';

// Updates, as a state machine the Settings page can render.
//
// electron-updater is event-driven and stateless: it tells you a check started,
// or a download finished, and forgets. A settings panel needs the opposite —
// the current answer, available on demand, whenever the page happens to open.
// So every event folds into one state object here, which is the only thing the
// renderer ever sees.
//
// Downloads are NOT automatic. An update is a change to the app the user is in
// the middle of using, and this app's whole promise is that nothing happens on
// the network without asking. The check is automatic; fetching the package is a
// button.

export type UpdateStage =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  /** Not an installed build — there is no update feed to ask. */
  | 'unsupported';

export interface UpdateState {
  stage: UpdateStage;
  /** The version running right now. */
  currentVersion: string;
  /** The version waiting, once a check has found one. */
  newVersion: string | null;
  /** 0-100 while downloading. */
  progressPct: number;
  /** Download rate in MB/s, for the readout beside the bar. */
  downloadSpeedMb: number;
  /** ISO stamp of the last check that finished, successfully or not. */
  lastCheckedAt: string | null;
  /** Error text, or a note explaining an inactive state. */
  message: string | null;
}

let state: UpdateState = {
  stage: 'idle',
  currentVersion: '0.0.0',
  newVersion: null,
  progressPct: 0,
  downloadSpeedMb: 0,
  lastCheckedAt: null,
  message: null,
};

function publish(next: Partial<UpdateState>): void {
  state = { ...state, ...next };
  // Every window: the mini widget and the main window are the same renderer in
  // two shapes, and either may be showing when an update lands.
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('updater:changed', state);
  }
}

/** Installed builds only: a dev run has no feed, and would fail every check. */
function isSupported(): boolean {
  return app.isPackaged;
}

const UNSUPPORTED_NOTE =
  'Update checks run in the installed app. This is a development build.';

/**
 * What went wrong, in words that mean something on screen.
 *
 * The two failures a user actually meets are "no release published yet" (the
 * feed 404s) and "no network". Both arrive as transport errors whose own text
 * explains nothing about updates.
 */
function friendlyError(err: { message?: string } | null): string {
  const raw = err?.message || '';
  if (/404/.test(raw)) return 'No published release to update to yet.';
  if (/ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|net::/.test(raw)) {
    return 'Could not reach the update server. Check your connection and try again.';
  }
  return raw || 'Update check failed.';
}

function wireEvents(): void {
  autoUpdater.on('checking-for-update', () => {
    publish({ stage: 'checking', message: null });
  });
  autoUpdater.on('update-available', (info) => {
    publish({
      stage: 'available',
      newVersion: info.version,
      lastCheckedAt: new Date().toISOString(),
      message: null,
    });
  });
  autoUpdater.on('update-not-available', () => {
    publish({
      stage: 'up-to-date',
      newVersion: null,
      lastCheckedAt: new Date().toISOString(),
      message: null,
    });
  });
  autoUpdater.on('download-progress', (progress) => {
    publish({
      stage: 'downloading',
      progressPct: Math.round(progress.percent),
      downloadSpeedMb: Math.round((progress.bytesPerSecond / 1_000_000) * 10) / 10,
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
    publish({
      stage: 'downloaded',
      newVersion: info.version,
      progressPct: 100,
      downloadSpeedMb: 0,
      message: null,
    });
  });
  autoUpdater.on('error', (err) => {
    console.warn('[updater]', err?.message || err);
    publish({
      stage: 'error',
      lastCheckedAt: new Date().toISOString(),
      message: friendlyError(err),
    });
  });
}

async function check(): Promise<UpdateState> {
  if (!isSupported()) {
    publish({ stage: 'unsupported', message: UNSUPPORTED_NOTE });
    return state;
  }
  // A check already running is the answer to "check now" — starting a second
  // one would only race the first.
  if (state.stage === 'checking' || state.stage === 'downloading') return state;
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    // The 'error' event has usually fired already; this catches the case where
    // the call itself rejects, so a click never ends in a silent no-op.
    publish({
      stage: 'error',
      lastCheckedAt: new Date().toISOString(),
      message: (err as Error).message,
    });
  }
  return state;
}

async function download(): Promise<UpdateState> {
  if (!isSupported()) {
    publish({ stage: 'unsupported', message: UNSUPPORTED_NOTE });
    return state;
  }
  if (state.stage !== 'available') return state;
  publish({ stage: 'downloading', progressPct: 0, downloadSpeedMb: 0 });
  try {
    await autoUpdater.downloadUpdate();
  } catch (err) {
    publish({ stage: 'error', message: (err as Error).message });
  }
  return state;
}

export function registerUpdater(): void {
  // Downloading is a button, not a side effect of checking — see the note above.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  wireEvents();

  ipcMain.handle('updater:state', () => state);
  ipcMain.handle('updater:check', () => check());
  ipcMain.handle('updater:download', () => download());
  ipcMain.handle('updater:install', () => {
    if (state.stage !== 'downloaded') return state;
    // Closes every window and relaunches into the new version. Nothing is lost:
    // audio and transcripts are written as they are produced, not at exit.
    setImmediate(() => autoUpdater.quitAndInstall());
    return state;
  });

  void app.whenReady().then(() => {
    console.log(
      `[updater] version ${app.getVersion()}` + (app.isPackaged ? '' : ' (dev build, no update feed)'),
    );
    publish({
      currentVersion: app.getVersion(),
      stage: isSupported() ? 'idle' : 'unsupported',
      message: isSupported() ? null : UNSUPPORTED_NOTE,
    });
    // One check per launch, once the window is up and the first meeting is not
    // waiting on it.
    if (isSupported()) setTimeout(() => void check(), 5000);
  });
}
