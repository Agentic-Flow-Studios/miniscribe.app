import { useEffect, useState } from 'react';
import { HStack } from '@astryxdesign/core/HStack';

interface InputLevelMeterProps {
  /** Shared peak store, mutated every frame by useInputLevels. */
  levels: React.RefObject<Record<string, number>>;
  deviceId: string;
  /** Nothing is listening to this device: draw the bars as flat placeholders. */
  isIdle?: boolean;
}

/** Bar heights in px, quietest first. The rising staircase is what makes a
 *  glance readable: shape carries the level as much as the lit count does. */
const BAR_HEIGHTS = [4, 7, 10, 13, 16];

// Speech peaks are small; the same x3 scaling the recording meters use.
const SCALE = 3;

/**
 * A five-bar level indicator for one input device.
 *
 * Its own component, and its own animation frame, so a moving meter repaints
 * five spans rather than the panel that contains it. State only changes when
 * the number of lit bars actually moves, so a silent device costs nothing.
 */
export function InputLevelMeter({
  levels,
  deviceId,
  isIdle = false,
}: InputLevelMeterProps): React.ReactNode {
  const [lit, setLit] = useState(0);

  useEffect(() => {
    if (isIdle) {
      setLit(0);
      return;
    }
    let raf = 0;
    const tick = (): void => {
      const level = Math.min(1, (levels.current[deviceId] ?? 0) * SCALE);
      const next = Math.round(level * BAR_HEIGHTS.length);
      setLit((prev) => (prev === next ? prev : next));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [deviceId, isIdle, levels]);

  return <LevelBars lit={lit} />;
}

/**
 * The bars themselves, given how many are lit.
 *
 * Presentational and loop-free so the two things that own a level loop — this
 * file's per-device meter and the recording meters — can draw the same
 * indicator without either one learning about the other's level source.
 */
export function LevelBars({ lit }: { lit: number }): React.ReactNode {
  return (
    <HStack gap={0.5} vAlign="end" style={{ height: `${BAR_HEIGHTS[BAR_HEIGHTS.length - 1]}px` }}>
      {BAR_HEIGHTS.map((height, index) => (
        <span
          key={height}
          aria-hidden="true"
          style={{
            display: 'block',
            width: '3px',
            height: `${height}px`,
            borderRadius: 'var(--radius-full)',
            backgroundColor:
              index < lit ? 'var(--color-accent)' : 'var(--color-border-emphasized)',
            opacity: index < lit ? 1 : 0.5,
            transition: 'background-color var(--duration-fast) var(--ease-standard)',
          }}
        />
      ))}
    </HStack>
  );
}

/** Turn a 0-100 meter reading into a lit-bar count. */
export function barsFor(percent: number): number {
  return Math.round((percent / 100) * BAR_HEIGHTS.length);
}
