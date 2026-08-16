import { useCallback, useMemo, useState } from 'react';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { HStack } from '@astryxdesign/core/HStack';
import { Icon } from '@astryxdesign/core/Icon';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Section } from '@astryxdesign/core/Section';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import {
  ArrowLeft,
  Columns2,
  Cpu,
  Download,
  FileText,
  Mic,
  Pause,
  Play,
  RefreshCw,
  Rows3,
  StopCircle,
  Trash2,
  Volume2,
} from 'lucide-react';
import { Meters } from './Meters';
import { SessionInsights } from './SessionInsights';
import { Transcript, type TranscriptView } from './Transcript';
import { Transport } from './Transport';
import { computeMetrics, fmtClock } from './session-metrics';
import { lineAt, speakerColumns, wordAt, wordsOf } from './speaker-labels';
import {
  EXPORT_FORMATS,
  exportFileName,
  formatTranscript,
  type ExportFormat,
  type ExportMeta,
} from './transcript-export';
import { usePlayer } from './use-player';
import type { Session, StatusKind, TranscriptInfo, TranscriptLine } from './use-session';

interface RecordingPageProps {
  session: Session;
  diarize: boolean;
  setDiarize: (val: boolean) => void;
  numSpeakers: number;
  setNumSpeakers: (val: number) => void;
  /** Whether any speech model is installed. Null until the first check answers. */
  hasModel: boolean | null;
  /** Take the user where a model can be installed. */
  onInstallModel: () => void;
  /** Back to the widget, which is where a recording is started. */
  onOpenWidget: () => void;
  /** Delete the recording on screen. This page asks before calling it. */
  onDeleteRecording: (id: string) => void;
  onBackToRecordings: () => void;
}

const STATUS_DOT: Record<StatusKind, 'neutral' | 'accent' | 'success' | 'error'> = {
  idle: 'neutral',
  recording: 'accent',
  working: 'accent',
  done: 'success',
  error: 'error',
};

const VIEW_KEY = 'miniscribe.transcriptView';
const PLAYER_KEY = 'miniscribe.playerPanelOpen';

/** The reading width of the canvas. Transcript lines past this get hard to track. */
const CANVAS_MAX_WIDTH = 960;

/** Session directory names are ISO stamps with `:` and `.` swapped out. */
function idToIso(id: string): string {
  return id.replace(
    /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/,
    '$1T$2:$3:$4.$5Z',
  );
}

function fmtWhen(startedAt: string): string {
  const d = new Date(startedAt);
  if (Number.isNaN(d.getTime())) return startedAt;
  return d.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Where the transcript on screen came from, in one line of plain English. */
function transcriptNote(info: TranscriptInfo | null, hasLines: boolean): string {
  if (!info) {
    return hasLines
      ? 'Transcript for this recording.'
      : 'No transcript saved for this recording yet.';
  }
  const when = info.savedAt ? fmtWhen(info.savedAt) : null;
  const made =
    info.source === 'live' ? 'Transcribed live while recording' : 'Re-transcribed';
  return when ? `${made} · ${when}` : made;
}

export function RecordingPage({
  session,
  diarize,
  setDiarize,
  numSpeakers,
  setNumSpeakers,
  hasModel,
  onInstallModel,
  onOpenWidget,
  onDeleteRecording,
  onBackToRecordings,
}: RecordingPageProps): React.ReactNode {
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const {
    status,
    isRecording,
    isPaused,
    isBusy,
    openTracks,
    activity,
    lines,
    levels,
    warnings,
    loadedRecording,
    transcriptInfo,
    speakerLabels,
    notice,
    notify,
    dismissNotice,
  } = session;

  const playableFrom = !isRecording && !isBusy ? loadedRecording : null;
  const player = usePlayer(playableFrom);

  // Layout is a reading preference, not a property of a recording: whoever
  // prefers one long column wants it for the next meeting too.
  const [view, setView] = useState<TranscriptView>(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(VIEW_KEY) : null;
    return saved === 'unified' ? 'unified' : 'split';
  });
  const chooseView = useCallback((next: string) => {
    const chosen: TranscriptView = next === 'unified' ? 'unified' : 'split';
    setView(chosen);
    try {
      localStorage.setItem(VIEW_KEY, chosen);
    } catch {
      // A locked-down storage partition costs the preference, not the page.
    }
  }, []);

  // Whether the player panel is expanded. A preference like the layout above:
  // someone reading a long transcript on a laptop wants the room back, and
  // wants it back for the next recording too.
  const [isPlayerOpen, setIsPlayerOpen] = useState<boolean>(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(PLAYER_KEY) : null;
    return saved !== 'closed';
  });
  const choosePlayerOpen = useCallback((open: boolean) => {
    setIsPlayerOpen(open);
    try {
      localStorage.setItem(PLAYER_KEY, open ? 'open' : 'closed');
    } catch {
      // A locked-down storage partition costs the preference, not the page.
    }
  }, []);

  const activeLine = useMemo<TranscriptLine | null>(
    () => (player.isPlaying || player.time > 0 ? lineAt(lines, player.time) : null),
    [lines, player.isPlaying, player.time],
  );
  const activeWord = useMemo(
    () => (activeLine ? wordAt(wordsOf(activeLine), player.time) : -1),
    [activeLine, player.time],
  );

  const playAt = player.playAt;
  const playFrom = useCallback((line: TranscriptLine) => playAt(line.start), [playAt]);

  const speakers = useMemo(
    () => speakerColumns(lines, isRecording ? openTracks : []),
    [isRecording, lines, openTracks],
  );

  // The player knows the wall clock; while recording, or before the audio has
  // loaded, the transcript's last word is the best clock there is.
  const metrics = useMemo(() => computeMetrics(lines, player.duration), [lines, player.duration]);

  const exportMeta = useMemo<ExportMeta>(
    () => ({
      recordingId: loadedRecording,
      startedAt: loadedRecording ? idToIso(loadedRecording) : null,
      labels: speakerLabels,
      metrics,
    }),
    [loadedRecording, metrics, speakerLabels],
  );

  const exportAs = useCallback(
    async (format: ExportFormat): Promise<void> => {
      const spec = EXPORT_FORMATS.find((f) => f.id === format);
      if (!spec) return;
      try {
        const result = await window.api.exportTranscript({
          suggestedName: exportFileName(exportMeta, format),
          content: formatTranscript(format, lines, exportMeta),
          extension: spec.extension,
          label: spec.label,
        });
        // A cancelled dialog is not an outcome worth announcing.
        if (result.saved) notify(true, `Transcript saved to ${result.path}`);
      } catch (err) {
        notify(false, `Export failed: ${(err as Error).message}`);
      }
    },
    [exportMeta, lines, notify],
  );

  const live = openTracks
    .filter((kind) => activity[kind] !== 'idle')
    .map((kind) => `${kind === 'me' ? 'Me' : 'Them'} ${activity[kind]}…`)
    .join(', ');

  const currentTitle = loadedRecording
    ? fmtWhen(idToIso(loadedRecording))
    : isRecording
    ? 'Live recording session'
    : 'New recording';

  // A loaded recording is a closed one: its audio is on disk and playable. Until
  // then the page belongs to the capture lifecycle, and only then does it carry
  // the controls that start and stop one. Showing "Start Recording" while the
  // user reads a session they recorded last week is what made this confusing.
  const isCapturing = loadedRecording === null;

  return (
    <VStack height="100%" minHeight={0} gap={0}>
      {/* Page header. The window controls and the drag region belong to
          AppLayout's window bar above this — one set per window. */}
      <Section variant="transparent" padding={3} paddingBlock={2} dividers={['bottom']}>
        <HStack width="100%" vAlign="center" hAlign="between" wrap="wrap" gap={2}>
          <HStack gap={2} vAlign="center">
            <Button
              label="Back"
              icon={<Icon icon={ArrowLeft} />}
              variant="ghost"
              size="sm"
              clickAction={onBackToRecordings}
              tooltip="Back to all recordings"
            />
            <Text type="label" weight="semibold">
              {currentTitle}
            </Text>
          </HStack>

          <HStack gap={1} vAlign="center">
            {/* Only for a recording that exists on disk: there is nothing to
                delete while one is still being made. */}
            {loadedRecording && !isRecording ? (
              <Button
                label="Delete"
                icon={<Icon icon={Trash2} />}
                variant="destructive"
                size="sm"
                isDisabled={isBusy}
                tooltip="Delete this recording and its audio"
                clickAction={() => setIsConfirmingDelete(true)}
              />
            ) : null}

            <DropdownMenu
              button={{
                label: 'Export',
                icon: <Icon icon={Download} />,
                variant: 'ghost',
                size: 'sm',
                isDisabled: lines.length === 0,
              }}
              placement="below"
              alignment="end"
              menuWidth={240}
              items={EXPORT_FORMATS.map((format) => ({
                label: `${format.label} — ${format.description}`,
                onClick: () => void exportAs(format.id),
              }))}
            />
          </HStack>
        </HStack>
      </Section>

      {/* Destructive and irreversible: the audio is the only copy of the
          meeting, and the transcript goes with the directory it lives in. */}
      <AlertDialog
        isOpen={isConfirmingDelete}
        onOpenChange={setIsConfirmingDelete}
        title="Delete this recording?"
        description={`The audio and transcript from ${currentTitle} will be deleted from this device. This cannot be undone.`}
        actionLabel="Delete Recording"
        actionVariant="destructive"
        onAction={() => {
          setIsConfirmingDelete(false);
          if (loadedRecording) onDeleteRecording(loadedRecording);
        }}
      />

      {warnings.length > 0 && (
        <Banner
          status="warning"
          container="section"
          title="Capture warning"
          description={`${warnings.join('; ')}`}
          isDismissable
        />
      )}

      {/* One banner for every outcome this page produces — exporting,
          transcribing, opening — rather than a channel per feature. */}
      {notice && (
        <Banner
          status={notice.ok ? 'success' : 'error'}
          container="section"
          title={notice.ok ? 'Done' : 'That did not work'}
          description={notice.text}
          isDismissable
          onDismiss={dismissNotice}
        />
      )}

      {/* A session in flight. Recording is set up and started in the widget —
          this window has no controls for beginning one — so what is here is
          only what a running session needs: how it is going, and the two ways
          to interrupt it. */}
      {isRecording ? (
        <Section variant="transparent" padding={3} paddingBlock={2} dividers={['bottom']}>
          <VStack gap={2} width="100%">
            <HStack width="100%" vAlign="center" hAlign="between" wrap="wrap" gap={2}>
              <HStack gap={1.5} vAlign="center">
                <StatusDot
                  variant={isPaused ? 'neutral' : 'accent'}
                  isPulsing={!isPaused}
                  label={isPaused ? 'Paused' : 'Recording'}
                />
                <Text type="label" weight="semibold">
                  {isPaused ? 'Paused' : 'Recording'}
                </Text>
                {live ? (
                  <Text type="supporting" size="sm" color="accent">
                    {live}
                  </Text>
                ) : null}
              </HStack>

              <HStack gap={2} vAlign="center">
                {/* Same pause as the widget: a meeting goes off the record far
                    more often than it ends. */}
                <Button
                  label={isPaused ? 'Resume' : 'Pause'}
                  variant="secondary"
                  icon={<Icon icon={isPaused ? Play : Pause} />}
                  isDisabled={isBusy}
                  style={{ borderRadius: '9999px', paddingInline: '16px' }}
                  clickAction={() => session.setPaused(!isPaused)}
                />
                {/* Red, like the widget's stop: the colour is what makes it
                    findable in a hurry, and it is the same act in both places. */}
                <Button
                  label="Stop & Transcribe"
                  variant="primary"
                  icon={<Icon icon={StopCircle} />}
                  isDisabled={!isRecording}
                  isLoading={isBusy}
                  style={{
                    borderRadius: '9999px',
                    backgroundColor: 'var(--color-error)',
                    color: '#ffffff',
                    paddingInline: '20px',
                  }}
                  clickAction={() => session.stop({ diarize, numSpeakers })}
                />
              </HStack>
            </HStack>

            <Meters isRecording={isRecording} openTracks={openTracks} levels={levels} />
          </VStack>
        </Section>
      ) : isCapturing ? null : (
        // A saved recording carries its transcript with it — the panel is filled
        // from disk, not by decoding the audio again. Running ASR over it is
        // still one click away, for a better model or to separate speakers.
        <Section variant="transparent" padding={3} paddingBlock={2} dividers={['bottom']}>
          <HStack width="100%" vAlign="center" hAlign="between" wrap="wrap" gap={2}>
            <HStack gap={1.5} vAlign="center">
              <Icon icon={FileText} size="sm" color="secondary" />
              <Text type="supporting" size="sm" color="secondary">
                {transcriptNote(transcriptInfo, lines.length > 0)}
              </Text>
            </HStack>

            <HStack gap={3} vAlign="center" wrap="wrap">
              <Switch
                label="Separate speakers"
                value={diarize}
                onChange={setDiarize}
                isDisabled={isBusy}
                size="sm"
              />
              {diarize && (
                <NumberInput
                  label="Speakers"
                  description="0 auto-detects"
                  value={numSpeakers}
                  onChange={setNumSpeakers}
                  min={0}
                  max={10}
                  size="sm"
                  width={140}
                />
              )}
              {hasModel === false ? (
                // Transcribing is not available to offer, so offer the thing
                // that makes it available instead of a button that fails.
                <Button
                  label="Install a Model"
                  icon={<Icon icon={Download} />}
                  variant="primary"
                  size="sm"
                  tooltip="A speech model is needed before this recording can be transcribed"
                  clickAction={onInstallModel}
                />
              ) : (
                <Button
                  label={lines.length > 0 ? 'Re-transcribe' : 'Transcribe'}
                  icon={<Icon icon={RefreshCw} />}
                  variant="secondary"
                  size="sm"
                  isDisabled={isBusy}
                  tooltip="Run speech recognition over this recording's audio again"
                  clickAction={() => session.retranscribe({ diarize, numSpeakers })}
                />
              )}
            </HStack>
          </HStack>
        </Section>
      )}

      {/* Reading canvas. Flex-sized rather than height:100%, which would be 100%
          of the page ON TOP OF its siblings and push the canvas off the bottom
          of the window.

          Deliberately NOT scrollable: the transcript inside does its own
          scrolling, and following the audio must move the transcript alone.
          When this scrolled too, every auto-scroll took the player, the
          insights and the toolbar up off the top of the page with it. */}
      <VStack minHeight={0} padding={3} gap={0} hAlign="center" style={{ flex: 1 }}>
        <Card
          padding={0}
          width="100%"
          maxWidth={CANVAS_MAX_WIDTH}
          style={{
            // Height as a style rather than the `height` prop: the prop also
            // makes the card itself a scroll box, which is the very thing this
            // layout is arranged to avoid.
            height: '100%',
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            borderRadius: '8px',
            border: '1px solid var(--color-border)',
          }}
        >
          {/* Player panel: what the session is, how to move through it, and what
              it added up to. Recessed against the transcript below it, which is
              what the page is actually for. */}
          {playableFrom || lines.length > 0 ? (
            <Section variant="muted" padding={0}>
              <Section variant="transparent" padding={3} paddingBlock={2} dividers={['bottom']}>
                {/* The status line is the trigger, so it stays readable folded
                    or open — and folding the transport hands its whole height
                    to the transcript, which is what a long meeting needs. */}
                <Collapsible
                  isOpen={playableFrom ? isPlayerOpen : false}
                  onOpenChange={choosePlayerOpen}
                  // Nothing to fold while recording: the transport only exists
                  // once the audio is closed and playable.
                  isDisabled={!playableFrom}
                  trigger={
                    <HStack gap={1.5} vAlign="center" wrap="wrap">
                      {/* Idle is not worth a sentence. With nothing happening,
                          this says what the recording IS; the machine's state
                          takes the line back the moment there is one. */}
                      {status.kind === 'idle' ? (
                        <Text type="supporting" weight="medium">
                          {lines.length} {lines.length === 1 ? 'utterance' : 'utterances'} ·{' '}
                          {fmtClock(metrics.duration)}
                        </Text>
                      ) : (
                        <>
                          <StatusDot
                            variant={STATUS_DOT[status.kind]}
                            isPulsing={status.kind === 'recording' || status.kind === 'working'}
                            label={status.kind}
                          />
                          <Text type="supporting" weight="medium">
                            {status.text}
                          </Text>
                        </>
                      )}
                      {isRecording && live ? (
                        <Text type="supporting" color="accent">
                          {live}
                        </Text>
                      ) : null}
                      {/* Folded, the clock is the one thing worth keeping: it
                          says where in the recording the highlight is. */}
                      {playableFrom && !isPlayerOpen ? (
                        <Text type="supporting" size="sm" color="secondary" hasTabularNumbers>
                          {fmtClock(player.time)} / {fmtClock(player.duration)}
                        </Text>
                      ) : null}
                    </HStack>
                  }
                >
                  {playableFrom ? (
                    <Transport
                      player={player}
                      lines={lines}
                      speakers={speakers}
                      labels={speakerLabels}
                    />
                  ) : null}
                </Collapsible>
              </Section>

              {lines.length > 0 ? (
                <SessionInsights
                  metrics={metrics}
                  labels={speakerLabels}
                  onSeek={playableFrom ? playAt : null}
                />
              ) : null}
            </Section>
          ) : null}

          {/* Transcript panel */}
          {lines.length > 0 ? (
            <Section variant="transparent" padding={3} paddingBlock={1.5} dividers={['bottom']}>
              <HStack width="100%" vAlign="center" hAlign="between" gap={2} wrap="wrap">
                <Text type="supporting" size="sm" color="secondary">
                  {lines.length} {lines.length === 1 ? 'utterance' : 'utterances'} ·{' '}
                  {speakers.length} {speakers.length === 1 ? 'voice' : 'voices'}
                </Text>
                <SegmentedControl
                  label="Transcript layout"
                  size="sm"
                  value={view}
                  onChange={chooseView}
                >
                  <SegmentedControlItem value="split" label="Split" icon={<Icon icon={Columns2} />} />
                  <SegmentedControlItem
                    value="unified"
                    label="Unified"
                    icon={<Icon icon={Rows3} />}
                  />
                </SegmentedControl>
              </HStack>
            </Section>
          ) : null}

          {/* The one part of the page that scrolls. Flex-sized so it takes
              whatever the panels above leave — including the height they give
              back when the player is folded away. */}
          <VStack minHeight={0} gap={0} style={{ flex: 1 }}>
            {lines.length === 0 && !isRecording && hasModel === false ? (
              // Nothing can be transcribed without a model, so say THAT rather
              // than reporting an empty transcript as if it were a result. This
              // used to surface as an error at the end of a recording — after
              // the meeting, when it was too late to do anything about it.
              <EmptyState
                title="No speech model installed"
                description="Miniscribe transcribes on this device, so it needs a speech model before it can turn audio into text. Recordings made now are still saved — you can transcribe them once a model is installed."
                icon={<Icon icon={Cpu} size="lg" />}
                actions={
                  <Button
                    label="Install a Model"
                    icon={<Icon icon={Download} />}
                    variant="primary"
                    clickAction={onInstallModel}
                  />
                }
              />
            ) : lines.length === 0 && !isRecording && isCapturing ? (
              // Nothing loaded and nothing running. Recording lives in the
              // widget — one place to start one — so this points there instead
              // of offering a second way in.
              <EmptyState
                title="Nothing open"
                description="Recording starts in the mini widget, which floats above your meeting. Stop a recording there and it opens here, transcribed."
                icon={<Icon icon={Mic} size="lg" />}
                actions={
                  <Button
                    label="Open Mini Widget"
                    icon={<Icon icon={Mic} />}
                    variant="primary"
                    clickAction={onOpenWidget}
                  />
                }
              />
            ) : lines.length === 0 && !isRecording ? (
              <EmptyState
                title="No transcript lines"
                description="This recording has no transcript yet. Transcribe it to read what was said."
                icon={<Icon icon={Volume2} size="lg" />}
              />
            ) : (
              <Transcript
                lines={lines}
                liveTracks={isRecording ? openTracks : []}
                activity={activity}
                labels={speakerLabels}
                onRename={session.renameSpeaker}
                activeLineId={activeLine?.id ?? null}
                activeWord={activeWord}
                isPlaying={player.isPlaying}
                onPlayFrom={playableFrom ? playFrom : null}
                view={view}
              />
            )}
          </VStack>
        </Card>
      </VStack>
    </VStack>
  );
}
