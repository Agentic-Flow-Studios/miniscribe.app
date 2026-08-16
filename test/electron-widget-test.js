// The mini widget's control bar, measured while it actually records.
//
// Chromium's fake media device makes this possible headlessly: the widget's own
// record button opens a capture, so the recording state here is the real one
// rather than props posed for a test.
//
// Two things it pins:
//   1. The bar keeps ONE height across the session. The record button is the
//      tallest control and vanishes the moment recording starts, so without a
//      fixed slot the whole widget snaps shorter under the pointer.
//   2. No control wears a filled plate. Selected state is carried by the icon's
//      strokes — a row of tinted squares on a bar that floats over other
//      people's windows reads as clutter.
//
// Run: npx electron test/electron-widget-test.js
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

// Must be set before the app is ready, or the renderer gets a real device.
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');

require('./user-data');
const { registerIpc } = require('../dist/ipc.js');
const { MINI_WIDTH, MINI_HEIGHT } = require('../dist/window-sizes.js');

const script = `(async () => {
  const settle = (ms) => new Promise((r) => setTimeout(r, ms || 300));
  const byName = (n) =>
    [...document.querySelectorAll('button, [role="button"]')].find(
      (b) => ((b.getAttribute('aria-label') || b.textContent || '').trim() === n),
    ) || null;
  // The control card is the rounded panel the whole bar sits in.
  const card = () => document.querySelector('div[style*="border-radius: 14px"]');
  const height = () => (card() ? card().getBoundingClientRect().height : null);
  const filled = (el) => {
    if (!el) return null;
    const bg = getComputedStyle(el).backgroundColor;
    return !(bg === 'transparent' || /rgba\\(0, 0, 0, 0\\)/.test(bg));
  };

  await settle(500);
  const idleHeight = height();
  const hadRecord = !!byName('Start recording');
  const micFilledIdle = filled(byName('Audio inputs'));

  const rec = byName('Start recording');
  if (rec) rec.click();
  await settle(1500);

  const recordingHeight = height();
  const state = {
    recordGone: !byName('Start recording'),
    hasPause: !!byName('Pause recording'),
    hasStop: !!byName('Stop recording'),
    stopFilled: filled(byName('Stop recording')),
  };

  // Hovering a control must not put anything under the cursor but the control.
  // A DOM tooltip cannot leave a 94px window, so it lands on the button it
  // describes: the pointer then sits on the tooltip, the button sees a
  // mouseleave, and the pair flicker against each other.
  const pauseBtn = byName('Pause recording');
  const box = pauseBtn.getBoundingClientRect();
  const at = { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2, bubbles: true };
  for (const type of ['pointerover', 'pointerenter']) {
    pauseBtn.dispatchEvent(new PointerEvent(type, at));
  }
  for (const type of ['mouseover', 'mouseenter', 'mousemove']) {
    pauseBtn.dispatchEvent(new MouseEvent(type, at));
  }
  await settle(900);

  const top = document.elementsFromPoint(at.clientX, at.clientY)[0];
  const hover = {
    // The topmost thing at the pointer must belong to the button.
    ownedByButton: !!top && (top === pauseBtn || pauseBtn.contains(top)),
    // Any tooltip that does render must at least not be hit-testable.
    hitTestableTooltip: [...document.querySelectorAll('[role="tooltip"]')].some((t) => {
      const r = t.getBoundingClientRect();
      return r.width > 0 && getComputedStyle(t).pointerEvents !== 'none';
    }),
  };

  // The widget reports state, not prose: no sentence from the session pipeline
  // belongs on a bar this size.
  const widgetText = document.body.textContent.replace(/\s+/g, ' ').trim();
  const sessionProse = /lines appear as each side|Recording deleted|utterances,/i.test(widgetText);

  // The timer counts audio kept. Sampled twice: it must be moving.
  const readClock = () => {
    const el = document.querySelector('[data-testid="recording-timer"]');
    return el ? el.textContent.trim() : null;
  };
  const clockEarly = readClock();
  await settle(1600);
  const clockLater = readClock();

  // Pausing swaps the same button to a resume; it does not add a third one.
  const pause = byName('Pause recording');
  if (pause) pause.click();
  await settle(400);
  const pausedLabel = !!byName('Resume recording');
  const pausedHeight = height();

  // "Actively recording" is the claim the timer makes, so pausing must stop it:
  // paused audio never reaches the file, and a clock that kept running would be
  // describing time the recording does not contain.
  const clockAtPause = readClock();
  await settle(1600);
  const clockStillPaused = readClock();

  // The popovers still open through the native-tooltip wrapper.
  const inputsBtn = byName('Audio inputs');
  if (inputsBtn) inputsBtn.click();
  await settle(500);
  const popoverOpened = /System audio|Microphone/i.test(document.body.textContent);

  return {
    idleHeight,
    recordingHeight,
    pausedHeight,
    hadRecord,
    micFilledIdle,
    pausedLabel,
    popoverOpened,
    sessionProse,
    widgetText,
    clockEarly,
    clockLater,
    clockAtPause,
    clockStillPaused,
    ...hover,
    ...state,
  };
})()`;

try {
  registerIpc();
} catch (e) {
  console.error(`RESULT: FAIL — registerIpc threw before app ready: ${e.message}`);
  process.exit(1);
}

setTimeout(() => {
  console.log('RESULT: FAIL (timed out)');
  app.exit(3);
}, 90000).unref();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    frame: false,
    width: MINI_WIDTH,
    height: MINI_HEIGHT,
    webPreferences: {
      preload: path.join(__dirname, '..', 'dist', 'preload.js'),
      backgroundThrottling: false,
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
    const res = await win.webContents.executeJavaScript(script);
    console.log(`[test] ${JSON.stringify(res)}`);

    if (!res.hadRecord) fails.push('no record button on an idle widget');
    if (res.idleHeight == null) fails.push('could not find the control card');
    if (!res.recordGone) fails.push('the record button is still there while recording');
    if (!res.hasPause) fails.push('no pause button while recording');
    if (!res.hasStop) fails.push('no stop button while recording');

    // Half a pixel of subpixel layout is not a jump; anything more is.
    if (Math.abs(res.recordingHeight - res.idleHeight) > 1) {
      fails.push(
        `the bar changed height when recording started: ${res.idleHeight} -> ${res.recordingHeight}`,
      );
    }
    if (Math.abs(res.pausedHeight - res.idleHeight) > 1) {
      fails.push(`the bar changed height when paused: ${res.idleHeight} -> ${res.pausedHeight}`);
    }
    if (!res.pausedLabel) fails.push('pausing did not turn the pause button into a resume');
    if (res.micFilledIdle) fails.push('the audio inputs button has a filled background');
    if (res.stopFilled) fails.push('the stop button has a filled background');
    if (!res.ownedByButton) {
      fails.push(
        'something else is on top of the button under the pointer — hovering it will flicker',
      );
    }
    if (res.hitTestableTooltip) fails.push('a tooltip is hit-testable and can steal the hover');
    if (!res.popoverOpened) fails.push('the audio inputs popover did not open');
    if (res.sessionProse) fails.push('session status prose is still on the widget');
    if (!res.clockEarly) fails.push('no recording timer on the widget while recording');
    if (res.clockEarly && res.clockEarly === res.clockLater) {
      fails.push(`the timer did not advance (${res.clockEarly} both times)`);
    }
    if (res.clockAtPause !== res.clockStillPaused) {
      fails.push(
        `the timer kept running while paused (${res.clockAtPause} -> ${res.clockStillPaused})`,
      );
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
