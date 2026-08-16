import { useCallback, useEffect, useMemo } from 'react';
import { HStack } from '@astryxdesign/core/HStack';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Slider } from '@astryxdesign/core/Slider';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import {
  FastForward,
  Pause,
  Play,
  Rewind,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { SpeakerTimeline } from './SpeakerTimeline';
import { fmtClock } from './session-metrics';
import { PLAYBACK_RATES, type Player } from './use-player';
import type { TranscriptLine } from './use-session';

interface Props {
  player: Player;
  lines: TranscriptLine[];
  /** Raw speaker ids, in the order their timeline lanes should be stacked. */
  speakers: string[];
  labels: Record<string, string>;
}

const NUDGE = 10;
// Landing exactly on an utterance's first sample clips the attack, and a
// timestamp is only ever as good as the VAD's edge. A shade early is free.
const LEAD_IN = 0.15;

/**
 * Transport for the whole recording. The scrubber drives the transcript rather
 * than the other way round: everything highlighted below is derived from this
 * clock, so dragging here walks the follow-along backwards and forwards too.
 *
 * Two ways to move, because there are two questions being asked. Seconds
 * (±10s, arrow keys) is for "say that again". Utterances (skip buttons) is for
 * "next thing anybody said" — which in a meeting with long silences is the jump
 * that actually gets you somewhere, and is not a fixed number of seconds away.
 */
export function Transport({ player, lines, speakers, labels }: Props): React.ReactNode {
  const { time, duration, isPlaying, isLoading, error, rate, volume, isMuted } = player;
  const isReady = !isLoading && duration > 0;

  const starts = useMemo(
    () => [...new Set(lines.map((line) => line.start))].sort((a, b) => a - b),
    [lines],
  );

  const { playAt, seek, skip, toggle, setRate, setVolume, toggleMute } = player;

  const toUtterance = useCallback(
    (direction: -1 | 1): void => {
      if (starts.length === 0) return;
      const next =
        direction === 1
          ? starts.find((start) => start > time + 0.4)
          : // A little back-off, so "previous" on a line just started means the
            // start of THIS line — the same behaviour every music player has.
            [...starts].reverse().find((start) => start < time - 1.2);
      playAt(Math.max(0, (next ?? (direction === 1 ? duration : 0)) - LEAD_IN));
    },
    [duration, playAt, starts, time],
  );

  // Shortcuts are on the window, not the transport, so they work while reading
  // the transcript — which is where the pointer actually is. Anything typed
  // into a field is left alone: the speaker-name inputs are full of spaces.
  useEffect(() => {
    if (!isReady) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      // Anything focusable owns its own keys. A speaker-name field is full of
      // spaces, and Space on a focused Switch or Button must press it rather
      // than start playback behind it.
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          target.closest(
            'input, textarea, select, button, [role="switch"], [role="radio"], [role="slider"], [contenteditable="true"]',
          ))
      ) {
        return;
      }

      switch (event.key) {
        case ' ':
        case 'k':
          toggle();
          break;
        case 'ArrowLeft':
          skip(event.shiftKey ? -30 : -5);
          break;
        case 'ArrowRight':
          skip(event.shiftKey ? 30 : 5);
          break;
        case 'j':
          skip(-NUDGE);
          break;
        case 'l':
          skip(NUDGE);
          break;
        case 'p':
          toUtterance(-1);
          break;
        case 'n':
          toUtterance(1);
          break;
        case 'Home':
          seek(0);
          break;
        case 'End':
          seek(duration);
          break;
        case 'm':
          toggleMute();
          break;
        case '[':
        case ']': {
          const at = PLAYBACK_RATES.indexOf(rate as (typeof PLAYBACK_RATES)[number]);
          const next = Math.min(
            PLAYBACK_RATES.length - 1,
            Math.max(0, (at === -1 ? 1 : at) + (event.key === ']' ? 1 : -1)),
          );
          setRate(PLAYBACK_RATES[next]);
          break;
        }
        default:
          return;
      }
      // Only reached when a key was handled — Space must not also scroll the
      // transcript, and the arrows must not fight the scroll container.
      event.preventDefault();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [duration, isReady, rate, seek, setRate, skip, toUtterance, toggle, toggleMute]);

  // No padding or divider of its own: the transport is collapsible content, and
  // the panel it lives in owns the inset. Wrapping it in a second padded
  // section here would inset the scrubber twice over.
  return (
    <VStack gap={2} width="100%">
      <SpeakerTimeline
        lines={lines}
        speakers={speakers}
        labels={labels}
        duration={duration}
        time={time}
        onSeek={seek}
        isDisabled={!isReady}
      />

      <HStack gap={3} vAlign="center" hAlign="between" wrap="wrap" width="100%">
        <HStack gap={1} vAlign="center">
          <IconButton
            label="Previous utterance"
            icon={<Icon icon={SkipBack} />}
            variant="ghost"
            size="sm"
            isDisabled={!isReady}
            tooltip="Previous utterance (P)"
            onClick={() => toUtterance(-1)}
          />
          <IconButton
            label="Back 10 seconds"
            icon={<Icon icon={Rewind} />}
            variant="ghost"
            size="sm"
            isDisabled={!isReady}
            tooltip="Back 10s (J) · arrows nudge 5s"
            onClick={() => skip(-NUDGE)}
          />
          <IconButton
            label={isPlaying ? 'Pause' : 'Play recording'}
            icon={<Icon icon={isPlaying ? Pause : Play} />}
            variant="primary"
            size="sm"
            isDisabled={!isReady}
            isLoading={isLoading}
            tooltip={`${isPlaying ? 'Pause' : 'Play'} (Space)`}
            onClick={toggle}
          />
          <IconButton
            label="Forward 10 seconds"
            icon={<Icon icon={FastForward} />}
            variant="ghost"
            size="sm"
            isDisabled={!isReady}
            tooltip="Forward 10s (L)"
            onClick={() => skip(NUDGE)}
          />
          <IconButton
            label="Next utterance"
            icon={<Icon icon={SkipForward} />}
            variant="ghost"
            size="sm"
            isDisabled={!isReady}
            tooltip="Next utterance (N)"
            onClick={() => toUtterance(1)}
          />

          <HStack gap={1} vAlign="center" paddingInline={2}>
            <span className="text-label-md" style={{ fontWeight: 600, color: 'var(--color-text-primary)', fontVariantNumeric: 'tabular-nums' }}>
              {fmtClock(time)}
            </span>
            <span className="text-label-md" style={{ color: 'var(--color-text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
              / {fmtClock(duration)}
            </span>
            <span className="text-label-md" style={{ color: 'var(--color-text-disabled)', fontVariantNumeric: 'tabular-nums' }}>
              −{fmtClock(Math.max(0, duration - time))}
            </span>
          </HStack>
        </HStack>

        <HStack gap={3} vAlign="center" wrap="wrap">
          <SegmentedControl
            label="Playback speed"
            size="sm"
            value={String(rate)}
            onChange={(value) => setRate(Number(value))}
            isDisabled={!isReady}
          >
            {PLAYBACK_RATES.map((option) => (
              <SegmentedControlItem
                key={option}
                value={String(option)}
                label={`${option}×`}
              />
            ))}
          </SegmentedControl>

          <HStack gap={1} vAlign="center">
            <IconButton
              label={isMuted ? 'Unmute' : 'Mute'}
              icon={<Icon icon={isMuted || volume === 0 ? VolumeX : Volume2} />}
              variant="ghost"
              size="sm"
              isDisabled={!isReady}
              tooltip={`${isMuted ? 'Unmute' : 'Mute'} (M)`}
              onClick={toggleMute}
            />
            <Slider
              label="Volume"
              isLabelHidden
              width={92}
              value={isMuted ? 0 : volume}
              min={0}
              max={1}
              step={0.01}
              valueDisplay="none"
              formatValue={(value) => `${Math.round(value * 100)}%`}
              isDisabled={!isReady}
              onChange={(value: number | [number, number]) =>
                setVolume(typeof value === 'number' ? value : value[0])
              }
            />
          </HStack>
        </HStack>
      </HStack>

      {error ? (
        <HStack gap={1} vAlign="center">
          <Icon icon="error" color="error" size="sm" />
          <Text type="supporting">{error}</Text>
        </HStack>
      ) : null}
    </VStack>
  );
}
