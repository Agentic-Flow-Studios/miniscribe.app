import { app, BrowserWindow, Menu, screen, session, desktopCapturer, Tray, nativeImage, shell, nativeTheme } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { registerIpc, onRecordingChanged } from './ipc';
import { registerUpdater } from './updater';
import { MAIN_HEIGHT, MAIN_WIDTH, MINI_HEIGHT, MINI_WIDTH } from './window-sizes';
import { miniPositionIn, placeMain, placeMini } from './window-position';

let win: BrowserWindow | null = null;
let tray: Tray | null = null;

// Drop Electron's stock File/Edit/View/Window/Help bar.
Menu.setApplicationMenu(null);

// Icons are committed under assets/ rather than generated at build time, and
// assets/ is in electron-builder's `files` list, so this one path resolves the
// same in a dev run and inside the packaged asar.
function assetPath(name: string): string {
  return path.join(__dirname, '..', 'assets', name);
}

function getAppIconPath(): string {
  const ext = process.platform === 'win32' ? '.ico' : (process.platform === 'darwin' ? '.icns' : '.png');
  const icon = assetPath(`icon${ext}`);
  return fs.existsSync(icon) ? icon : assetPath('icon.png');
}

function getTrayIcon(recording = false): ReturnType<typeof nativeImage.createFromPath> {
  const isMac = process.platform === 'darwin';
  const isWin = process.platform === 'win32';

  if (isMac) {
    // Template images are black-on-transparent and macOS tints them itself, so
    // there is one pair rather than a light and a dark set.
    const template = assetPath(`${recording ? 'tray-iconTemplate-recording' : 'tray-iconTemplate'}.png`);
    if (fs.existsSync(template)) return nativeImage.createFromPath(template);
  }

  const isDarkMode = nativeTheme.shouldUseDarkColors;
  const themeSuffix = isDarkMode ? '-dark' : '-light';
  const baseName = recording ? `tray-icon-recording${themeSuffix}` : `tray-icon${themeSuffix}`;
  const ext = isWin ? '.ico' : '.png';

  const candidates = [assetPath(`${baseName}${ext}`), assetPath(`tray-icon${ext}`)];

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return nativeImage.createFromPath(p);
    }
  }

  // Fallback inline SVG
  const fill = recording ? '#ff3b30' : (isDarkMode ? '#38BDF8' : '#0F172A');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
    <circle cx="8" cy="8" r="7" fill="${fill}"/>
  </svg>`;
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
}

function createTray(): void {
  let isRecording = false;
  const icon = getTrayIcon(isRecording);
  tray = new Tray(icon);
  tray.setToolTip('Miniscribe');

  // React to OS Theme Changes (Light / Dark mode switches)
  nativeTheme.on('updated', () => {
    if (tray) {
      tray.setImage(getTrayIcon(isRecording));
    }
  });

  // The recording-state icon assets only ever got drawn here before: nothing
  // told this tray a recording had started, so it silently sat on the idle
  // glyph for the whole meeting. ipc.ts is the only place that knows the two
  // moments that answer this (recorder:start / recorder:stop), hence the
  // callback rather than reading some shared flag.
  onRecordingChanged((recording) => {
    isRecording = recording;
    if (tray) tray.setImage(getTrayIcon(isRecording));
  });

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Mini Widget',
      click: () => {
        if (!win) return;
        win.show();
        win.setAlwaysOnTop(true, 'screen-saver');
        win.setResizable(false);
        placeMini(win);
        win.focus();
        win.webContents.send('window:mode-changed', 'mini');
      },
    },
    {
      label: 'Show Main App (Recordings)',
      click: () => {
        if (!win) return;
        win.show();
        win.setAlwaysOnTop(false);
        win.setResizable(true);
        placeMain(win, MAIN_WIDTH, MAIN_HEIGHT);
        win.focus();
        win.webContents.send('window:mode-changed', 'main');
      },
    },
    { type: 'separator' },
    {
      label: 'Quit Miniscribe',
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (!win) return;
    if (win.isVisible()) {
      if (win.isFocused()) {
        win.hide();
      } else {
        win.focus();
      }
    } else {
      win.show();
      win.focus();
    }
  });
}

function createWindow(): void {
  // Launch state is default MINI widget floating window with transparent
  // background, sitting along the bottom of the screen. The position is passed
  // at construction rather than set afterwards: Electron centres a window with
  // no x/y, so setting it later would show the widget mid-screen for a frame
  // and then jump.
  const { x, y } = miniPositionIn(screen.getPrimaryDisplay().workArea);
  win = new BrowserWindow({
    x,
    y,
    width: MINI_WIDTH,
    height: MINI_HEIGHT,
    icon: getAppIconPath(),
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // The renderer runs in Chromium's OS-level sandbox, so a bug in the page
      // (or in a UI dependency) is confined to a process that cannot open a
      // file, spawn anything, or reach the network. The preload keeps working
      // because it only ever touches contextBridge and ipcRenderer, which stay
      // available under the sandbox; everything else it might have reached is
      // already on the other side of an IPC handler.
      sandbox: true,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');

  // Safely open external links in user's default browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win?.webContents.getURL()) {
      event.preventDefault();
      if (url.startsWith('https:') || url.startsWith('http:')) {
        void shell.openExternal(url);
      }
    }
  });

  // Route getDisplayMedia() requests so the renderer can capture SYSTEM audio safely.
  session.defaultSession.setDisplayMediaRequestHandler(
    (request, callback) => {
      const isAppFrame = request.frame?.url.startsWith('file://');
      if (!isAppFrame) {
        callback({});
        return;
      }
      desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
        if (sources.length > 0) {
          callback({ video: sources[0], audio: 'loopback' });
        } else {
          callback({});
        }
      }).catch((err) => {
        console.warn('[main] desktopCapturer error:', err);
        callback({});
      });
    },
    { useSystemPicker: false },
  );

  void win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

registerIpc();
// Registers its handlers now and defers the first check until the app is ready,
// the same shape as registerIpc above.
registerUpdater();
