// Where each shape of the window lands.
//
// Resizing keeps the top-left corner, so without an explicit move the widget
// ends up wherever the main window's title bar was, and the main window opens
// off in the corner the widget happened to occupy. Both are only visible on a
// real screen, which is why this measures actual bounds against the display's
// work area rather than trusting the calls that set them.
//
// Run: npx electron test/electron-window-position-test.js
const path = require('node:path');
const { app, BrowserWindow, screen } = require('electron');
require('./user-data');
const { registerIpc } = require('../dist/ipc.js');
const { MINI_WIDTH, MINI_HEIGHT, MAIN_WIDTH, MAIN_HEIGHT } = require('../dist/window-sizes.js');

// Matches BOTTOM_MARGIN in src/window-position.ts.
const BOTTOM_MARGIN = 24;
// A half-pixel centre rounds, and a fractional display scale factor (125% and
// friends) costs a pixel or two on the way through DIP conversion. Neither is
// what this test is about: where the window sits is.
const SLACK = 3;

try {
  registerIpc();
} catch (e) {
  console.error(`RESULT: FAIL — registerIpc threw before app ready: ${e.message}`);
  process.exit(1);
}

setTimeout(() => {
  console.log('RESULT: FAIL (timed out)');
  app.exit(3);
}, 60000).unref();

const near = (a, b) => Math.abs(a - b) <= SLACK;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    // Frameless, as the real window is: getBounds() includes the frame, so a
    // bordered test window reports two pixels more than it was given and every
    // size assertion below is off by the border.
    frame: false,
    width: MINI_WIDTH,
    height: MINI_HEIGHT,
    webPreferences: {
      preload: path.join(__dirname, '..', 'dist', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Matches the app (see src/main.ts): the renderer this exercises is a
      // sandboxed one, so the preload bridge is tested as it actually ships.
      sandbox: true,
    },
  });

  const fails = [];

  try {
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));

    // Main: centred on the work area of the display it is on.
    await win.webContents.executeJavaScript(`window.api.windowSetMode('main')`);
    const main = win.getBounds();
    let area = screen.getDisplayMatching(main).workArea;
    console.log(`[test] work area ${JSON.stringify(area)}`);
    console.log(`[test] main ${JSON.stringify(main)}`);

    if (!near(main.width, MAIN_WIDTH) || !near(main.height, MAIN_HEIGHT)) {
      fails.push(`main is ${main.width}x${main.height}, expected ${MAIN_WIDTH}x${MAIN_HEIGHT}`);
    }
    if (!near(main.x, area.x + (area.width - MAIN_WIDTH) / 2)) {
      fails.push(`main x ${main.x}, expected it centred in ${area.x}..${area.x + area.width}`);
    }
    if (!near(main.y, area.y + (area.height - MAIN_HEIGHT) / 2)) {
      fails.push(`main y ${main.y}, expected it centred vertically`);
    }

    // Mini: bottom centre, clear of the taskbar or dock — which is what the
    // work area excludes, so "inside the work area" is the whole assertion.
    await win.webContents.executeJavaScript(`window.api.windowSetMode('mini')`);
    const mini = win.getBounds();
    area = screen.getDisplayMatching(mini).workArea;
    console.log(`[test] mini ${JSON.stringify(mini)}`);

    if (!near(mini.width, MINI_WIDTH) || !near(mini.height, MINI_HEIGHT)) {
      fails.push(`mini is ${mini.width}x${mini.height}, expected ${MINI_WIDTH}x${MINI_HEIGHT}`);
    }
    if (!near(mini.x, area.x + (area.width - MINI_WIDTH) / 2)) {
      fails.push(`mini x ${mini.x}, expected it centred horizontally`);
    }
    if (!near(mini.y, area.y + area.height - MINI_HEIGHT - BOTTOM_MARGIN)) {
      fails.push(
        `mini y ${mini.y}, expected ${area.y + area.height - MINI_HEIGHT - BOTTOM_MARGIN} ` +
          `(${BOTTOM_MARGIN}px above the bottom of the work area)`,
      );
    }
    if (mini.y + mini.height > area.y + area.height) {
      fails.push('the widget hangs below the work area, over the taskbar or dock');
    }
    // Halfway up the screen is where it used to sit, and where it covers the
    // meeting it is listening to.
    if (mini.y < area.y + area.height / 2) {
      fails.push(`mini y ${mini.y} is in the top half of the screen`);
    }

    if (fails.length === 0) {
      console.log('RESULT: PASS');
      app.exit(0);
    } else {
      fails.forEach((f) => console.log(`  FAIL: ${f}`));
      console.log('RESULT: FAIL');
      app.exit(2);
    }
  } catch (e) {
    console.error('RESULT: FAIL', e);
    app.exit(1);
  }
});
