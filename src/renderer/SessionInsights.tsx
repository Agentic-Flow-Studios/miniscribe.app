import { Button } from '@astryxdesign/core/Button';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { Grid } from '@astryxdesign/core/Grid';
import { HStack } from '@astryxdesign/core/HStack';
import { Icon } from '@astryxdesign/core/Icon';
import { Section } from '@astryxdesign/core/Section';
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
} from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { Token } from '@astryxdesign/core/Token';
import { VStack } from '@astryxdesign/core/VStack';
import { BarChart3 } from 'lucide-react';
import { speakerColor } from './speaker-labels';
import {
  fmtClock,
  fmtDuration,
  fmtPercent,
  type SessionMetrics,
  type SpeakerMetrics,
} from './session-metrics';

interface Props {
  metrics: SessionMetrics;
  labels: Record<string, string>;
  /** Jump the player to a moment a statistic points at. */
  onSeek: ((seconds: number) => void) | null;
  isOpenByDefault?: boolean;
}

function Stat({
  value,
  label,
  detail,
}: {
  value: string;
  label: string;
  detail?: string;
}): React.ReactNode {
  return (
    <VStack gap={0.5}>
      <Text type="label" size="xl" weight="semibold" hasTabularNumbers>
        {value}
      </Text>
      <Text type="supporting" size="2xs" color="secondary">
        {label}
      </Text>
      {detail ? (
        <Text type="supporting" size="2xs" color="disabled">
          {detail}
        </Text>
      ) : null}
    </VStack>
  );
}

/** The share bar, in the speaker's own colour so it reads with the timeline. */
function ShareBar({ speaker }: { speaker: SpeakerMetrics }): React.ReactNode {
  return (
    <HStack gap={1.5} vAlign="center" width="100%">
      <div
        style={{
          position: 'relative',
          flex: 1,
          minWidth: '48px',
          height: '6px',
          borderRadius: 'var(--radius-sm, 4px)',
          backgroundColor: 'var(--color-background-muted)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            insetBlock: 0,
            insetInlineStart: 0,
            width: `${Math.round(speaker.shareOfSpeech * 100)}%`,
            backgroundColor: `var(--color-icon-${speakerColor(speaker.speaker)})`,
          }}
        />
      </div>
      <Text type="supporting" size="2xs" hasTabularNumbers>
        {fmtPercent(speaker.shareOfSpeech)}
      </Text>
    </HStack>
  );
}

/**
 * What the numbers say about the session, next to the transcript that produced
 * them.
 *
 * Collapsed by default: the transcript is why the page exists, and a wall of
 * statistics above it would push the first line off screen. Every figure here
 * is derived from utterance timings and word timestamps — the only per-token
 * data the recogniser actually reports. It has no confidence score and no
 * prosody, so nothing here claims to measure certainty, sentiment, or emphasis.
 */
export function SessionInsights({
  metrics,
  labels,
  onSeek,
  isOpenByDefault = false,
}: Props): React.ReactNode {
  const nameOf = (speaker: string): string => labels[speaker]?.trim() || speaker;
  const loudest = metrics.speakers[0];

  return (
    <Section variant="transparent" padding={3} paddingBlock={2} dividers={['bottom']}>
      <Collapsible
        defaultIsOpen={isOpenByDefault}
        trigger={
          <HStack gap={2} vAlign="center" wrap="wrap">
            <Icon icon={BarChart3} size="sm" color="accent" />
            <Text type="label" weight="semibold">
              Session insights
            </Text>
            <Text type="supporting" size="sm" color="secondary">
              {fmtDuration(metrics.duration)} · {metrics.speakers.length}{' '}
              {metrics.speakers.length === 1 ? 'voice' : 'voices'} · {metrics.words} words
              {loudest
                ? ` · ${nameOf(loudest.speaker)} held ${fmtPercent(loudest.shareOfSpeech)}`
                : ''}
            </Text>
          </HStack>
        }
      >
        <VStack gap={3} paddingBlock={2}>
          <Grid columns={4} gap={3}>
            <Stat value={fmtDuration(metrics.duration)} label="Session length" />
            <Stat
              value={fmtDuration(metrics.speechSeconds)}
              label="Time anyone was talking"
              detail={`${fmtPercent(1 - metrics.silenceShare)} of the session`}
            />
            <Stat
              value={fmtPercent(metrics.silenceShare)}
              label="Silence"
              detail={fmtDuration(metrics.silenceSeconds)}
            />
            <Stat
              value={String(metrics.turns)}
              label="Speaker handovers"
              detail={`${metrics.utterances} utterances`}
            />
            <Stat value={String(metrics.words)} label="Words spoken" />
            <Stat
              value={`${Math.round(metrics.wordsPerMinute)}`}
              label="Words per minute"
              detail="over the whole session"
            />
            <Stat
              value={fmtDuration(metrics.crosstalkSeconds)}
              label="Crosstalk"
              detail="two or more voices at once"
            />
            <Stat
              value={metrics.longestPause ? fmtDuration(metrics.longestPause.seconds) : '—'}
              label="Longest pause"
              detail={
                metrics.longestPause ? `starting ${fmtClock(metrics.longestPause.at)}` : undefined
              }
            />
          </Grid>

          {metrics.longestMonologue && metrics.longestMonologue.seconds > 0 ? (
            <Text type="supporting" size="sm" color="secondary">
              Longest uninterrupted run:{' '}
              <Text type="inherit" weight="semibold">
                {nameOf(metrics.longestMonologue.speaker)}
              </Text>{' '}
              for {fmtDuration(metrics.longestMonologue.seconds)}, from{' '}
              {fmtClock(metrics.longestMonologue.at)}.
            </Text>
          ) : null}

          <Table density="compact" dividers="rows" hasHover>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Speaker</TableHeaderCell>
                <TableHeaderCell>Talk time</TableHeaderCell>
                <TableHeaderCell>Share of speech</TableHeaderCell>
                <TableHeaderCell>Words</TableHeaderCell>
                <TableHeaderCell>Pace</TableHeaderCell>
                <TableHeaderCell>Utterances</TableHeaderCell>
                <TableHeaderCell>Longest</TableHeaderCell>
                <TableHeaderCell>Questions</TableHeaderCell>
                <TableHeaderCell>Fillers</TableHeaderCell>
                <TableHeaderCell>First heard</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {metrics.speakers.map((speaker) => (
              <TableRow key={speaker.speaker}>
                <TableCell>
                  <Token
                    size="sm"
                    color={speakerColor(speaker.speaker)}
                    label={nameOf(speaker.speaker)}
                  />
                </TableCell>
                <TableCell>
                  <Text type="supporting" size="sm" hasTabularNumbers>
                    {fmtDuration(speaker.seconds)}
                  </Text>
                </TableCell>
                <TableCell>
                  <ShareBar speaker={speaker} />
                </TableCell>
                <TableCell>
                  <Text type="supporting" size="sm" hasTabularNumbers>
                    {speaker.words}
                  </Text>
                </TableCell>
                <TableCell>
                  <Text type="supporting" size="sm" hasTabularNumbers>
                    {Math.round(speaker.wordsPerMinute)} wpm
                  </Text>
                </TableCell>
                <TableCell>
                  <Text type="supporting" size="sm" hasTabularNumbers>
                    {speaker.turns}
                  </Text>
                </TableCell>
                <TableCell>
                  <Text type="supporting" size="sm" hasTabularNumbers>
                    {fmtDuration(speaker.longestTurn)}
                  </Text>
                </TableCell>
                <TableCell>
                  <Text type="supporting" size="sm" hasTabularNumbers>
                    {speaker.questions}
                  </Text>
                </TableCell>
                <TableCell>
                  <Text type="supporting" size="sm" hasTabularNumbers>
                    {speaker.fillers}
                  </Text>
                </TableCell>
                <TableCell>
                  {onSeek ? (
                    // Jumping the player to where a voice first appears is the
                    // fastest way to answer "who is Them 2?".
                    <Button
                      label={fmtClock(speaker.firstAt)}
                      variant="ghost"
                      size="sm"
                      tooltip={`Play from ${fmtClock(speaker.firstAt)}`}
                      clickAction={() => onSeek(Math.max(0, speaker.firstAt - 0.15))}
                    />
                  ) : (
                    <Text type="supporting" size="sm" hasTabularNumbers>
                      {fmtClock(speaker.firstAt)}
                    </Text>
                  )}
                </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <Text type="supporting" size="2xs" color="disabled">
            Measured from utterance boundaries and per-word timestamps produced on this device.
            Filler counts cover common hesitations; questions are counted by ending punctuation.
          </Text>
        </VStack>
      </Collapsible>
    </Section>
  );
}
