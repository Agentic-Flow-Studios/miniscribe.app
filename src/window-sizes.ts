// The two shapes the one window takes, in one place.
//
// Main and the widget are the same BrowserWindow resized, and the size is set
// from three directions: the initial create, the tray menu, and the renderer's
// mode switch. When those numbers lived apart, the widget's collapsed height
// drifted from the height its popovers restored it to, and the panel came back
// a few pixels short every time.

/** The floating recorder. Wide enough for the status sentence not to crowd. */
export const MINI_WIDTH = 572;
export const MINI_HEIGHT = 92;

export const MAIN_WIDTH = 1020;
export const MAIN_HEIGHT = 740;
