/**
 * The record glyphs, in one place so every control that starts or resumes
 * capture draws the same thing.
 *
 * A microphone is the wrong mark here: the widget already uses one for the
 * input picker, and two mics side by side that do different things is a coin
 * flip every time. What every recorder on earth uses instead is a red disc
 * inside a ring — the ring being the button itself — and a square to stop.
 */

interface GlyphProps {
  size?: number;
  /**
   * Defaults to the error token, which is the red these marks are meant to be.
   * A glyph sitting ON that red — the filled stop button — passes white
   * instead: the theme has no on-colour token to reach for, and card
   * background would disappear into the red in dark mode.
   */
  color?: string;
}

/** The red disc: start, or resume after a pause. */
export function RecordDot({ size = 20, color = 'var(--color-error)' }: GlyphProps): React.ReactNode {
  return (
    <span
      aria-hidden="true"
      style={{
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: '50%',
        backgroundColor: color,
        display: 'inline-block',
        flexShrink: 0,
      }}
    />
  );
}

/** The stop square. Slightly rounded, the way hardware transports draw it. */
export function StopSquare({ size = 16, color = 'var(--color-error)' }: GlyphProps): React.ReactNode {
  return (
    <span
      aria-hidden="true"
      style={{
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: '3px',
        backgroundColor: color,
        display: 'inline-block',
        flexShrink: 0,
      }}
    />
  );
}
