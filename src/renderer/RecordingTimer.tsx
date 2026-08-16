import { useEffect, useState } from 'react';
import { Text } from '@astryxdesign/core/Text';

/**
 * How long this session has been recording — audio kept, not time elapsed.
 *
 * Sampled from a ref rather than driven by state, the same arrangement the
 * meters use: a clock in React state would re-render the whole app once a
 * second for the sake of two digits. Reading the captured-seconds ref also
 * makes pausing honest for free — paused audio never reaches the counter, so
 * the timer stops with it and matches the file that ends up on disk.
 */
export function RecordingTimer({
  seconds,
  isRunning,
}: {
  seconds: React.RefObject<number>;
  isRunning: boolean;
}): React.ReactNode {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (!isRunning) {
      // One last read, so a pause leaves the true figure on screen rather than
      // whatever the last tick happened to catch.
      setShown(Math.floor(seconds.current));
      return;
    }
    const tick = (): void => setShown(Math.floor(seconds.current));
    tick();
    // Twice a second: a whole-second display driven by a one-second timer sits
    // visibly behind whenever the two clocks drift apart.
    const timer = setInterval(tick, 500);
    return () => clearInterval(timer);
  }, [isRunning, seconds]);

  return (
    <span data-testid="recording-timer">
      <Text type="label" size="sm" weight="semibold" hasTabularNumbers>
        {fmtElapsed(shown)}
      </Text>
    </span>
  );
}

/** m:ss under an hour, h:mm:ss past it. */
export function fmtElapsed(total: number): string {
  const secs = Math.max(0, Math.floor(total));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}
