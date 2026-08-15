import { app, BrowserWindow, Menu, session, desktopCapturer, Tray, nativeImage, shell } from 'electron';
import path from 'node:path';
import { autoUpdater } from 'electron-updater';
import { registerIpc } from './ipc';

let win: BrowserWindow | null = null;
let tray: Tray | null = null;

// Drop Electron's stock File/Edit/View/Window/Help bar.
Menu.setApplicationMenu(null);

function setupAutoUpdater(): void {
  autoUpdater.autoDownload = true;
  autoUpdater.on('update-available', () => {
    console.log('[updater] New patch version available, downloading in background...');
  });
  autoUpdater.on('update-downloaded', () => {
    console.log('[updater] Patch downloaded successfully, ready to install');
  });
  autoUpdater.on('error', (err) => {
    console.warn('[updater] Update check notice:', err?.message || err);
  });
  setTimeout(() => {
    void autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      console.warn('[updater] Check failed:', err);
    });
  }, 5000);
}

function createTray(): void {
  // Simple red mic icon for system tray / macOS menu bar
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
    <circle cx="8" cy="8" r="7" fill="#ff3b30"/>
    <rect x="6.5" y="4" width="3" height="5" rx="1.5" fill="#ffffff"/>
    <path d="M4.5 8.5a3.5 3.5 0 0 0 7 0" stroke="#ffffff" stroke-width="1.2" fill="none" stroke-linecap="round"/>
    <line x1="8" y1="12" x2="8" y2="14" stroke="#ffffff" stroke-width="1.2"/>
  </svg>`;

  const icon = nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
  );

  tray = new Tray(icon);
  tray.setToolTip('Miniscribe');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Mini Widget',
      click: () => {
        if (!win) return;
        win.show();
        win.setAlwaysOnTop(true, 'screen-saver');
        win.setSize(440, 76);
        win.setResizable(false);
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
        win.setSize(1020, 740);
        win.setResizable(true);
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
  // Launch state is default MINI widget floating window with transparent background
  win = new BrowserWindow({
    width: 440,
    height: 76,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
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
  setupAutoUpdater();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

registerIpc();
