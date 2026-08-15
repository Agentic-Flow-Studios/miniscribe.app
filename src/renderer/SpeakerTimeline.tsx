import { useCallback, useMemo, useRef, useState } from 'react';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { speakerColor, speakerOf } from './speaker-labels';
import { fmtClock } from './session-metrics';
import type { TranscriptLine } from './use-session';

interface Props {
  lines: TranscriptLine[];
  /** Raw speaker ids, in the order their lanes should be stacked. */
  speakers: string[];
  /** User-supplied names, keyed by raw speaker id. */
  labels: Record<string, string>;
  duration: number;
  time: number;
  onSeek: (seconds: number) => void;
  isDisabled?: boolean;
}

const LANE_HEIGHT = 14;
const LANE_GAP = 3;
const NAME_WIDTH = 76;

// Enough steps that the axis is readable, few enough that the labels never
// collide. Chosen from round intervals so the numbers under them are round too.
const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];

function tickStep(duration: number): number {
  for (const step of TICK_STEPS) {
    if (duration / step <= 8) return step;
  }
  return TICK_STEPS[TICK_STEPS.length - 1];
}

/**
 * Who was talking, when — and the scrubber, which are the same object.
 *
 * A plain progress bar answers "how far in am I"; this answers "where in the
 * meeting is the bit I want". One lane per voice, every utterance drawn in that
 * voice's colour, so the shape of the conversation — who dominated, where the
 * back-and-forth was, where the room went quiet — is visible before a word is
 * read, and clicking on that shape is what seeks.
 *
 * Segments are absolutely positioned in percentages rather than drawn on a
 * canvas: a meeting's worth of utterances is a few hundred nodes, the browser
 * lays them out once per resize, and they can carry theme tokens for colour
 * instead of hard-coded values sampled out of the stylesheet.
 */
export function SpeakerTimeline({
  lines,
  speakers,
  labels,
  duration,
  time,
  onSeek,
  isDisabled = false,
}: Props): React.ReactNode {
  const surface = useRef<HTMLDivElement>(null);
  const [hoverAt, setHoverAt] = useState<number | null>(null);

  // A zero-length recording would divide by zero on every segment.
  const span = Math.max(duration, 0.1);

  const lanes = useMemo(
    () =>
      speakers.map((speaker) => ({
        speaker,
        name: labels[speaker]?.trim() || speaker,
        color: speakerColor(speaker),
        segments: lines
          .filter((line) => speakerOf(line) === speaker)
          .map((line) => ({
            id: line.id,
            left: (Math.max(0, line.start) / span) * 100,
            // A one-word utterance is a sliver; floor the width so it stays a
            // visible mark rather than a hairline nobody can aim at.
            width: Math.max(0.35, ((line.end - line.start) / span) * 100),
          })),
      })),
    [labels, lines, span, speakers],
  );

  const ticks = useMemo(() => {
    const step = tickStep(span);
    const out: { at: number; left: number }[] = [];
    for (let at = 0; at <= span; at += step) out.push({ at, left: (at / span) * 100 });
    return out;
  }, [span]);

  const secondsAt = useCallback(
    (clientX: number): number => {
      const box = surface.current?.getBoundingClientRect();
      if (!box || box.width === 0) return 0;
      return Math.min(span, Math.max(0, ((clientX - box.left) / box.width) * span));
    },
    [span],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (isDisabled) return;
      // Capture on the surface, so a drag that leaves the ribbon keeps scrubbing
      // instead of stopping dead at the edge.
      event.currentTarget.setPointerCapture(event.pointerId);
      onSeek(secondsAt(event.clientX));
    },
    [isDisabled, onSeek, secondsAt],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (isDisabled) return;
      const at = secondsAt(event.clientX);
      setHoverAt(at);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) onSeek(at);
    },
    [isDisabled, onSeek, secondsAt],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (isDisabled) return;
      const step = event.shiftKey ? 30 : 5;
      if (event.key === 'ArrowLeft') onSeek(Math.max(0, time - step));
      else if (event.key === 'ArrowRight') onSeek(Math.min(span, time + step));
      else if (event.key === 'Home') onSeek(0);
      else if (event.key === 'End') onSeek(span);
      else return;
      event.preventDefault();
    },
    [isDisabled, onSeek, span, time],
  );

  const playedPct = (Math.min(time, span) / span) * 100;
  const laneStackHeight = lanes.length * LANE_HEIGHT + Math.max(0, lanes.length - 1) * LANE_GAP;
  const isHovering = hoverAt !== null && !isDisabled;

  return (
    <VStack gap={1} width="100%">
      <HStack gap={2} vAlign="start" width="100%">
        <VStack width={NAME_WIDTH} gap={LANE_GAP} style={{ flexShrink: 0 }}>
          {lanes.map((lane) => (
            <HStack
              key={lane.speaker}
              height={LANE_HEIGHT}
              vAlign="center"
              hAlign="end"
              width="100%"
            >
              <Text type="supporting" size="2xs" color="secondary" maxLines={1}>
                {lane.name}
              </Text>
            </HStack>
          ))}
        </VStack>

        <div
          ref={surface}
          role="slider"
          aria-label="Position in the recording"
          aria-valuemin={0}
          aria-valuemax={span}
          aria-valuenow={Math.min(time, span)}
          aria-valuetext={`${fmtClock(time)} of ${fmtClock(span)}`}
          aria-disabled={isDisabled || undefined}
          tabIndex={isDisabled ? -1 : 0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHoverAt(null)}
          onKeyDown={onKeyDown}
          style={{
            position: 'relative',
            flex: 1,
            minWidth: 0,
            height: `${laneStackHeight}px`,
            cursor: isDisabled ? 'default' : 'pointer',
            touchAction: 'none',
            opacity: isDisabled ? 0.5 : 1,
          }}
        >
          {lanes.map((lane, index) => (
            <div
              key={lane.speaker}
              style={{
                position: 'absolute',
                insetInlineStart: 0,
                insetInlineEnd: 0,
                top: `${index * (LANE_HEIGHT + LANE_GAP)}px`,
                height: `${LANE_HEIGHT}px`,
                borderRadius: 'var(--radius-sm, 4px)',
                backgroundColor: 'var(--color-background-muted)',
                overflow: 'hidden',
              }}
            >
              {lane.segments.map((segment) => (
                <div
                  key={segment.id}
                  style={{
                    position: 'absolute',
                    insetBlock: 0,
                    insetInlineStart: `${segment.left}%`,
                    width: `${segment.width}%`,
                    borderRadius: 'var(--radius-sm, 4px)',
                    backgroundColor: `var(--color-icon-${lane.color})`,
                  }}
                />
              ))}
            </div>
          ))}

          {/* What has been heard, washed over every lane at once — the ribbon
              reads as one clock even though it is drawn as several rows. */}
          <div
            style={{
              position: 'absolute',
              insetBlock: 0,
              insetInlineStart: 0,
              width: `${playedPct}%`,
              backgroundColor: 'var(--color-overlay-pressed)',
              pointerEvents: 'none',
            }}
          />
          <div
            style={{
              position: 'absolute',
              insetBlock: `-${LANE_GAP}px`,
              insetInlineStart: `${playedPct}%`,
              width: '2px',
              marginInlineStart: '-1px',
              backgroundColor: 'var(--color-accent)',
              borderRadius: 'var(--radius-sm, 4px)',
              pointerEvents: 'none',
            }}
          />
          {isHovering ? (
            <div
              style={{
                position: 'absolute',
                insetBlock: `-${LANE_GAP}px`,
                insetInlineStart: `${(hoverAt / span) * 100}%`,
                width: '1px',
                backgroundColor: 'var(--color-border-emphasized)',
                pointerEvents: 'none',
              }}
            />
          ) : null}
        </div>
      </HStack>

      {/* Time axis. Offset by the name gutter so a tick sits under the moment it
          names, not under the label column. Under the cursor it collapses to a
          single number: while aiming at a point, the other labels are noise. */}
      <HStack gap={2} width="100%">
        <div style={{ width: `${NAME_WIDTH}px`, flexShrink: 0 }} />
        <div style={{ position: 'relative', flex: 1, minWidth: 0, height: '14px' }}>
          {isHovering
            ? null
            : ticks.map((tick) => (
                <div
                  key={tick.at}
                  style={{
                    position: 'absolute',
                    insetInlineStart: `${tick.left}%`,
                    // The last tick would otherwise hang off the end of the track.
                    transform: tick.left > 92 ? 'translateX(-100%)' : undefined,
                  }}
                >
                  <Text type="supporting" size="2xs" color="disabled" hasTabularNumbers>
                    {fmtClock(tick.at)}
                  </Text>
                </div>
              ))}
          {isHovering ? (
            <div
              style={{
                position: 'absolute',
                insetInlineStart: `${(hoverAt / span) * 100}%`,
                transform: 'translateX(-50%)',
              }}
            >
              <Text type="supporting" size="2xs" color="accent" hasTabularNumbers>
                {fmtClock(hoverAt)}
              </Text>
            </div>
          ) : null}
        </div>
      </HStack>
    </VStack>
  );
}
