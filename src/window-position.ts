import { screen, type BrowserWindow } from 'electron';
import { MINI_HEIGHT, MINI_WIDTH } from './window-sizes';

// Where each shape of the window belongs on screen.
//
// Resizing alone keeps the top-left corner, which is the wrong anchor for both
// transitions: shrinking the main window to the widget leaves a 92px bar
// stranded where the big window's title bar used to be, and growing it back
// pushes the main window off toward the corner the widget happened to be in.
// So each mode says where it goes, and the move happens with the resize.

/**
 * Space left under the widget. `workArea` already excludes the taskbar or dock,
 * so this is breathing room from that edge rather than clearance for it.
 */
const BOTTOM_MARGIN = 24;

/** The work area of the display the window is on — not always the primary one. */
function workAreaFor(win: BrowserWindow): Electron.Rectangle {
  return screen.getDisplayMatching(win.getBounds()).workArea;
}

/**
 * Bottom centre of a display's work area: where a floating recorder belongs.
 *
 * Dead centre is where a dialog goes — it lands on top of the meeting the
 * widget is there to listen to. Along the bottom edge it sits with the dock and
 * the taskbar, out of the way of everything above it.
 */
export function miniPositionIn(area: Electron.Rectangle): { x: number; y: number } {
  return {
    x: Math.round(area.x + (area.width - MINI_WIDTH) / 2),
    y: Math.round(area.y + area.height - MINI_HEIGHT - BOTTOM_MARGIN),
  };
}

/** Put the widget at the bottom centre of whichever display it is on. */
export function placeMini(win: BrowserWindow): void {
  const { x, y } = miniPositionIn(workAreaFor(win));
  win.setBounds({ x, y, width: MINI_WIDTH, height: MINI_HEIGHT });
}

/** Centre the main window on whichever display it is on. */
export function placeMain(win: BrowserWindow, width: number, height: number): void {
  const area = workAreaFor(win);
  win.setBounds({
    // Clamped to the work area, so a window taller than the screen still opens
    // with its title bar reachable rather than above the top edge.
    x: Math.round(Math.max(area.x, area.x + (area.width - width) / 2)),
    y: Math.round(Math.max(area.y, area.y + (area.height - height) / 2)),
    width,
    height,
  });
}
