import { useEffect, useState } from 'react';
import { HStack } from '@astryxdesign/core/HStack';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import type { TrackKind } from '../capture-types';
import { LevelBars, barsFor } from './InputLevelMeter';

interface Props {
  isRecording: boolean;
  openTracks: TrackKind[];
  levels: React.RefObject<Record<TrackKind, number>>;
  /**
   * 'labelled' is the full-width pair of labelled bars for the main window.
   * 'compact' is the five-bar indicator, for the mini widget, where a labelled
   * ProgressBar per track is taller than the whole widget.
   */
  variant?: 'labelled' | 'compact';
}

const LABEL: Record<TrackKind, string> = { me: 'Me', them: 'Them' };
const VARIANT: Record<TrackKind, 'accent' | 'neutral'> = { me: 'accent', them: 'neutral' };

/**
 * VU meters, deliberately their own component: the level ref is sampled every
 * animation frame, and keeping that loop here means a repaint touches two
 * meters instead of the whole transcript. State is only set when the rounded
 * percentage actually moves, so a quiet track costs nothing.
 */
export function Meters({
  isRecording,
  openTracks,
  levels,
  variant = 'labelled',
}: Props): React.ReactNode {
  const [shown, setShown] = useState<Record<TrackKind, number>>({ me: 0, them: 0 });

  useEffect(() => {
    if (!isRecording) {
      setShown({ me: 0, them: 0 });
      return;
    }
    let raf = 0;
    const tick = (): void => {
      setShown((prev) => {
        const next: Record<TrackKind, number> = { me: 0, them: 0 };
        let changed = false;
        for (const kind of ['me', 'them'] as TrackKind[]) {
          // Speech peaks are small; scale up so the meter uses its full travel.
          const pct = Math.round(Math.min(1, levels.current[kind] * 3) * 100);
          next[kind] = pct;
          if (pct !== prev[kind]) changed = true;
          levels.current[kind] *= 0.9; // VU-style decay between audio frames
        }
        return changed ? next : prev;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isRecording, levels]);

  if (openTracks.length === 0) return null;

  if (variant === 'compact') {
    return (
      <HStack gap={2} vAlign="center" wrap="nowrap">
        {openTracks.map((kind) => (
          <HStack key={kind} gap={1} vAlign="center">
            <Text type="supporting" size="xsm" color="secondary">
              {LABEL[kind]}
            </Text>
            <LevelBars lit={barsFor(shown[kind])} />
          </HStack>
        ))}
      </HStack>
    );
  }

  return (
    <VStack gap={1.5} width="100%" maxWidth={520}>
      {openTracks.map((kind) => (
        <ProgressBar
          key={kind}
          label={`${LABEL[kind]} input level`}
          value={shown[kind]}
          variant={VARIANT[kind]}
        />
      ))}
    </VStack>
  );
}
