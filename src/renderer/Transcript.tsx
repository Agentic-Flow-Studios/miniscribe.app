import { memo, useEffect, useMemo, useRef } from 'react';
import { Grid } from '@astryxdesign/core/Grid';
import { HStack } from '@astryxdesign/core/HStack';
import { Icon } from '@astryxdesign/core/Icon';
import { Item } from '@astryxdesign/core/Item';
import { Section } from '@astryxdesign/core/Section';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Token } from '@astryxdesign/core/Token';
import { VStack } from '@astryxdesign/core/VStack';
import { Play, Square } from 'lucide-react';
import type { TrackKind } from '../capture-types';
import { TRACK_SPEAKER, speakerColor, speakerColumns, speakerOf, wordsOf } from './speaker-labels';
import type { Activity, TranscriptLine } from './use-session';

/**
 * `split` gives every voice its own column, so turn-taking is visible as shape.
 * `unified` is one chronological stream, which reads like a document and copies
 * like one — the right choice for a monologue, a narrow window, or a meeting
 * with five speakers where five columns leaves no room for words.
 */
export type TranscriptView = 'split' | 'unified';

interface Props {
  lines: TranscriptLine[];
  liveTracks: TrackKind[];
  activity: Record<TrackKind, Activity>;
  /** User-supplied speaker names, keyed by raw speaker id. */
  labels: Record<string, string>;
  /** Name a speaker; an empty name restores the raw id. */
  onRename: (speaker: string, name: string) => void;
  /** The line sounding right now, if the recording is being played. */
  activeLineId: number | null;
  /** Index of the last word spoken in that line; -1 before its first word. */
  activeWord: number;
  isPlaying: boolean;
  /** Start playback from a line. Null while there is no audio to play. */
  onPlayFrom: ((line: TranscriptLine) => void) | null;
  view: TranscriptView;
}

const ACTIVITY_LABEL: Record<Activity, string | null> = {
  idle: null,
  speaking: 'speaking…',
  transcribing: 'transcribing…',
};

const TRACKS: TrackKind[] = ['me', 'them'];

// The header band scrolls with nothing: it is the only place a voice can be
// named, and a name is usually wanted after reading a way down the transcript.
// Sticky on the cells themselves, because they ARE the grid's first row —
// wrapping them in an element of their own would break the column alignment
// that the whole layout exists to provide.
const STICKY: React.CSSProperties = { position: 'sticky', insetBlockStart: 0, zIndex: 1 };

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * The line's text, lit up word by word as it is spoken.
 *
 * Three states, the way lyrics read: what has been said is plain, the word being
 * said is accented, and what is still to come is dimmed. Rendered per-word only
 * while this line is the active one — every other line in a long meeting stays a
 * single Text node.
 */
function SpokenText({ line, activeWord }: { line: TranscriptLine; activeWord: number }): React.ReactNode {
  const words = useMemo(() => wordsOf(line), [line]);
  if (words.length === 0) return <Text textWrap="pretty">{line.text}</Text>;

  return (
    <Text textWrap="pretty">
      {words.map((word, i) => (
        <Text
          key={`${i}:${word.t}`}
          type="inherit"
          color={i < activeWord ? 'primary' : i === activeWord ? 'accent' : 'disabled'}
          weight={i === activeWord ? 'semibold' : undefined}
        >
          {i > 0 ? ' ' : ''}
          {word.text}
        </Text>
      ))}
    </Text>
  );
}

interface CellProps {
  line: TranscriptLine;
  isActive: boolean;
  activeWord: number;
  isPlaying: boolean;
  onPlayFrom: ((line: TranscriptLine) => void) | null;
}

// No speaker label on the line itself: the column it sits in is the label.
function LineCell({ line, isActive, activeWord, isPlaying, onPlayFrom }: CellProps): React.ReactNode {
  const ref = useRef<HTMLDivElement>(null);

  // Follow the audio. Only on becoming active, so scrolling is one move per
  // turn rather than a fight with every frame of the clock.
  useEffect(() => {
    if (isActive) ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [isActive]);

  return (
    <Item
      ref={ref}
      // Test hook for the live e2e run: it reads the timestamp and text back off
      // this row to prove an utterance decoded in the worker reached the column.
      data-testid={`line-${line.kind}`}
      data-active={isActive ? 'true' : undefined}
      density="compact"
      align="start"
      isSelected={isActive}
      onClick={onPlayFrom ? () => onPlayFrom(line) : undefined}
      startContent={
        <HStack width={36} hAlign="end">
          <Text type="supporting" color="secondary" hasTabularNumbers>
            {fmtTime(line.start)}
          </Text>
        </HStack>
      }
      endContent={
        onPlayFrom ? (
          <Icon
            icon={isActive && isPlaying ? Square : Play}
            size="xsm"
            color={isActive ? 'accent' : 'tertiary'}
            label={isActive && isPlaying ? 'Playing' : 'Play from here'}
          />
        ) : undefined
      }
      label={
        isActive ? (
          <SpokenText line={line} activeWord={activeWord} />
        ) : (
          <Text textWrap="pretty">{line.text}</Text>
        )
      }
    />
  );
}

interface RowProps extends CellProps {
  speakers: string[];
  owner: string;
}

/**
 * One utterance across every column, as a fragment so the cells stay direct
 * children of the grid. Memoised: while the clock runs, only the row that owns
 * the moving highlight has any reason to re-render.
 */
const Row = memo(function Row({
  line,
  owner,
  speakers,
  isActive,
  activeWord,
  isPlaying,
  onPlayFrom,
}: RowProps): React.ReactNode {
  return (
    <>
      {speakers.map((speaker, col) => (
        <Section
          key={`${line.id}:${speaker}`}
          variant="transparent"
          padding={0}
          dividers={col > 0 ? ['start'] : undefined}
        >
          {/* Every column gets a cell on every row, filled or not: the empty
              ones are what make a turn visible as a gap, and what keeps the
              dividers running unbroken down the page. */}
          {speaker === owner ? (
            <LineCell
              line={line}
              isActive={isActive}
              activeWord={activeWord}
              isPlaying={isPlaying}
              onPlayFrom={onPlayFrom}
            />
          ) : null}
        </Section>
      ))}
    </>
  );
});

/**
 * One column per voice, one row per utterance, in time order.
 *
 * Position carries meaning in both directions: down the page is chronological,
 * and across a row every other speaker's cell is deliberately EMPTY, so the
 * staggering shows who held the floor and where the turns changed. That is the
 * whole point of the layout — a gap is information, not wasted space.
 *
 * The cost, accepted knowingly: rows are ordered by utterance START, so a long
 * utterance that finishes after a shorter later one lands ABOVE lines already on
 * screen, moving text while you read. The earlier append-only design avoided
 * that but could not show turn-taking at all, because equal height was not equal
 * time.
 */
/**
 * The transcript as one chronological stream.
 *
 * Consecutive lines from the same voice are grouped under a single name, so a
 * two-minute answer reads as one block instead of thirty labelled fragments,
 * and every place the name reappears IS a handover. Same cells as the split
 * view — the same highlight, the same click-to-play — laid out down one column.
 */
function UnifiedStream({
  ordered,
  activeLineId,
  activeWord,
  isPlaying,
  onPlayFrom,
  labels,
}: {
  ordered: TranscriptLine[];
  activeLineId: number | null;
  activeWord: number;
  isPlaying: boolean;
  onPlayFrom: ((line: TranscriptLine) => void) | null;
  labels: Record<string, string>;
}): React.ReactNode {
  const groups = useMemo(() => {
    const out: { speaker: string; key: number; lines: TranscriptLine[] }[] = [];
    for (const line of ordered) {
      const speaker = speakerOf(line);
      const last = out[out.length - 1];
      if (last && last.speaker === speaker) last.lines.push(line);
      else out.push({ speaker, key: line.id, lines: [line] });
    }
    return out;
  }, [ordered]);

  return (
    <VStack gap={0} width="100%">
      {groups.map((group) => (
        <Section key={group.key} variant="transparent" padding={0} paddingBlock={1}>
          <VStack gap={0.5}>
            <HStack gap={1.5} vAlign="center" paddingInline={3}>
              <Token
                size="sm"
                color={speakerColor(group.speaker)}
                label={labels[group.speaker]?.trim() || group.speaker}
              />
              <Text type="supporting" size="2xs" color="disabled" hasTabularNumbers>
                {fmtTime(group.lines[0].start)}
              </Text>
            </HStack>
            {group.lines.map((line) => (
              <LineCell
                key={line.id}
                line={line}
                isActive={line.id === activeLineId}
                activeWord={line.id === activeLineId ? activeWord : -1}
                isPlaying={isPlaying}
                onPlayFrom={onPlayFrom}
              />
            ))}
          </VStack>
        </Section>
      ))}
    </VStack>
  );
}

export function Transcript({
  lines,
  liveTracks,
  activity,
  labels,
  onRename,
  activeLineId,
  activeWord,
  isPlaying,
  onPlayFrom,
  view,
}: Props): React.ReactNode {
  const speakers = useMemo(() => speakerColumns(lines, liveTracks), [lines, liveTracks]);
  // Ties broken by id so a re-sort never reshuffles two utterances that began in
  // the same millisecond.
  const ordered = useMemo(
    () => [...lines].sort((a, b) => a.start - b.start || a.id - b.id),
    [lines],
  );

  const activeSpeaker = useMemo(() => {
    const line = ordered.find((l) => l.id === activeLineId);
    return line ? speakerOf(line) : null;
  }, [ordered, activeLineId]);

  // Live state belongs to a TRACK, so it is shown against that track's own
  // column ('Me' / 'Them'), never against a cluster split out of it.
  const liveFor = (speaker: string): TrackKind | null => {
    const kind = TRACKS.find((k) => TRACK_SPEAKER[k] === speaker);
    return kind && liveTracks.includes(kind) ? kind : null;
  };

  if (view === 'unified') {
    return (
      <VStack isScrollable height="100%" minHeight={0} gap={0}>
        {/* One band for every name, since there are no columns to hang them
            off. Sticky for the same reason the column headers are: a name is
            usually wanted after reading a way down. */}
        <Section variant="muted" padding={2} dividers={['bottom']} style={STICKY}>
          <HStack gap={2} vAlign="center" wrap="wrap">
            {speakers.map((speaker) => {
              const live = liveFor(speaker);
              return (
                <HStack key={`name:${speaker}`} gap={1.5} vAlign="center">
                  <Token size="sm" color={speakerColor(speaker)} label={speaker} />
                  {speaker === activeSpeaker ? (
                    <StatusDot
                      variant="accent"
                      isPulsing={isPlaying}
                      label={`${speaker} is speaking`}
                    />
                  ) : null}
                  {live ? (
                    <StatusDot
                      variant={activity[live] === 'idle' ? 'neutral' : 'accent'}
                      isPulsing={activity[live] !== 'idle'}
                      label={`${speaker}: ${activity[live]}`}
                    />
                  ) : null}
                  <TextInput
                    label={`Name for ${speaker}`}
                    isLabelHidden
                    placeholder="Add a name"
                    value={labels[speaker] ?? ''}
                    onChange={(value) => onRename(speaker, value)}
                    size="sm"
                    width={150}
                    hasClear
                  />
                </HStack>
              );
            })}
          </HStack>
        </Section>

        <UnifiedStream
          ordered={ordered}
          activeLineId={activeLineId}
          activeWord={activeWord}
          isPlaying={isPlaying}
          onPlayFrom={onPlayFrom}
          labels={labels}
        />
      </VStack>
    );
  }

  return (
    <VStack isScrollable height="100%" minHeight={0} gap={0}>
      <Grid columns={speakers.length} gap={0}>
        {speakers.map((speaker, col) => {
          const live = liveFor(speaker);
          // The speaker holding the floor is named by lifting their whole
          // header out of the muted band — the same signal as the highlighted
          // line, read from the top of the column instead of the middle of it.
          const isTalking = speaker === activeSpeaker;
          return (
            <Section
              key={`head:${speaker}`}
              variant={isTalking ? 'section' : 'muted'}
              padding={2}
              dividers={col > 0 ? ['start', 'bottom'] : ['bottom']}
              style={STICKY}
              data-talking={isTalking ? 'true' : undefined}
            >
              <VStack gap={1}>
                <HStack gap={1.5} vAlign="center" wrap="wrap">
                  <Token size="sm" color={speakerColor(speaker)} label={speaker} />
                  {isTalking ? (
                    <StatusDot variant="accent" isPulsing={isPlaying} label={`${speaker} is speaking`} />
                  ) : null}
                  {live ? (
                    <StatusDot
                      variant={activity[live] === 'idle' ? 'neutral' : 'accent'}
                      isPulsing={activity[live] !== 'idle'}
                      label={`${speaker}: ${activity[live]}`}
                    />
                  ) : null}
                  {live && ACTIVITY_LABEL[activity[live]] ? (
                    <Text type="supporting" color="secondary">
                      {ACTIVITY_LABEL[activity[live]]}
                    </Text>
                  ) : null}
                </HStack>
                <TextInput
                  label={`Name for ${speaker}`}
                  isLabelHidden
                  placeholder="Add a name"
                  value={labels[speaker] ?? ''}
                  onChange={(value) => onRename(speaker, value)}
                  size="sm"
                  width="100%"
                  hasClear
                />
              </VStack>
            </Section>
          );
        })}

        {ordered.map((line) => {
          const isActive = line.id === activeLineId;
          return (
            <Row
              key={line.id}
              line={line}
              owner={speakerOf(line)}
              speakers={speakers}
              isActive={isActive}
              // Constant for every inactive row, so memo holds them still while
              // the highlight moves through the active one.
              activeWord={isActive ? activeWord : -1}
              isPlaying={isPlaying}
              onPlayFrom={onPlayFrom}
            />
          );
        })}
      </Grid>
    </VStack>
  );
}
