import { useCallback, useEffect, useMemo, useState } from 'react';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
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
import { ArrowLeft, Columns2, Download, Mic, Rows3, StopCircle, Volume2 } from 'lucide-react';
import { AudioInputPicker, MicTestReadout } from './AudioInputPicker';
import { Meters } from './Meters';
import { SessionInsights } from './SessionInsights';
import { Transcript, type TranscriptView } from './Transcript';
import { Transport } from './Transport';
import { computeMetrics } from './session-metrics';
import { lineAt, speakerColumns, wordAt, wordsOf } from './speaker-labels';
import {
  EXPORT_FORMATS,
  exportFileName,
  formatTranscript,
  type ExportFormat,
  type ExportMeta,
} from './transcript-export';
import type { AudioInputs } from './use-audio-inputs';
import { usePlayer } from './use-player';
import type { Session, StatusKind, TranscriptLine } from './use-session';

interface RecordingPageProps {
  session: Session;
  mic: boolean;
  setMic: (val: boolean) => void;
  system: boolean;
  setSystem: (val: boolean) => void;
  diarize: boolean;
  setDiarize: (val: boolean) => void;
  numSpeakers: number;
  setNumSpeakers: (val: number) => void;
  inputs: AudioInputs;
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

/** The reading width of the canvas. Transcript lines past this get hard to track. */
const CANVAS_MAX_WIDTH = 1000;

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

export function RecordingPage({
  session,
  mic,
  setMic,
  system,
  setSystem,
  diarize,
  setDiarize,
  numSpeakers,
  setNumSpeakers,
  inputs,
  onBackToRecordings,
}: RecordingPageProps): React.ReactNode {
  const {
    status,
    isRecording,
    isBusy,
    openTracks,
    activity,
    lines,
    levels,
    warnings,
    loadedRecording,
    speakerLabels,
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

  const [exportNote, setExportNote] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (!exportNote) return;
    const timer = setTimeout(() => setExportNote(null), 6000);
    return () => clearTimeout(timer);
  }, [exportNote]);

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
        if (result.saved) setExportNote({ ok: true, text: `Saved to ${result.path}` });
      } catch (err) {
        setExportNote({ ok: false, text: (err as Error).message });
      }
    },
    [exportMeta, lines],
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
      </Section>

      {warnings.length > 0 && (
        <Banner
          status="warning"
          container="section"
          title="Capture warning"
          description={`${warnings.join('; ')}`}
          isDismissable
        />
      )}

      {exportNote && (
        <Banner
          status={exportNote.ok ? 'success' : 'error'}
          container="section"
          title={exportNote.ok ? 'Transcript exported' : 'Export failed'}
          description={exportNote.text}
          isDismissable
        />
      )}

      {/* Capture controls and live levels — only while this page owns a session
          being recorded. */}
      {isCapturing ? (
        <Section variant="transparent" padding={3} paddingBlock={2} dividers={['bottom']}>
          <VStack gap={2} width="100%">
            <HStack width="100%" vAlign="center" hAlign="between" wrap="wrap" gap={2}>
              <HStack gap={3} vAlign="center" wrap="wrap">
                <Switch
                  label="Microphone (you)"
                  value={mic}
                  onChange={setMic}
                  isDisabled={isRecording}
                  size="sm"
                />
                {mic && (
                  <AudioInputPicker
                    inputs={inputs}
                    isDisabled={isRecording}
                    isLabelHidden
                    width={220}
                  />
                )}
                <Switch
                  label="System audio (them)"
                  value={system}
                  onChange={setSystem}
                  isDisabled={isRecording}
                  size="sm"
                />
                <Switch
                  label="Separate speakers"
                  value={diarize}
                  onChange={setDiarize}
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
              </HStack>

              {!isRecording ? (
                <Button
                  label="Start Recording"
                  variant="primary"
                  icon={<Icon icon={Mic} />}
                  isDisabled={isRecording || isBusy}
                  clickAction={() => {
                    // The test holds the device; hand it over before capture asks.
                    inputs.test.stop();
                    return session.start({ mic, system, micDeviceId: inputs.micConstraintId });
                  }}
                />
              ) : (
                <Button
                  label="Stop & Transcribe"
                  variant="secondary"
                  icon={<Icon icon={StopCircle} />}
                  isDisabled={!isRecording}
                  isLoading={isBusy}
                  clickAction={() => session.stop({ diarize, numSpeakers })}
                />
              )}
            </HStack>

            {mic && <MicTestReadout inputs={inputs} />}
            <Meters isRecording={isRecording} openTracks={openTracks} levels={levels} />
          </VStack>
        </Section>
      ) : null}

      {/* Reading canvas. Flex-sized rather than height:100%, which would be 100%
          of the page ON TOP OF its siblings and push the canvas off the bottom
          of the window. */}
      <VStack
        isScrollable
        minHeight={0}
        padding={3}
        gap={0}
        hAlign="center"
        style={{ flex: 1 }}
      >
        <Card
          padding={0}
          width="100%"
          maxWidth={CANVAS_MAX_WIDTH}
          style={{ overflow: 'hidden' }}
        >
          {/* Player panel: what the session is, how to move through it, and what
              it added up to. Recessed against the transcript below it, which is
              what the page is actually for. */}
          {playableFrom || lines.length > 0 ? (
            <Section variant="muted" padding={0}>
              <Section variant="transparent" padding={3} paddingBlock={2} dividers={['bottom']}>
                <HStack gap={1.5} vAlign="center" wrap="wrap">
                  <StatusDot
                    variant={STATUS_DOT[status.kind]}
                    isPulsing={status.kind === 'recording' || status.kind === 'working'}
                    label={status.kind}
                  />
                  <Text type="supporting" weight="medium">
                    {status.text}
                  </Text>
                  {isRecording && live ? (
                    <Text type="supporting" color="accent">
                      {live}
                    </Text>
                  ) : null}
                </HStack>
              </Section>

              {playableFrom ? (
                <Transport
                  player={player}
                  lines={lines}
                  speakers={speakers}
                  labels={speakerLabels}
                />
              ) : null}

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

          {lines.length === 0 && !isRecording ? (
            <EmptyState
              title="No transcript lines"
              description="Start recording or select a session to view speaker transcript."
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
        </Card>
      </VStack>
    </VStack>
  );
}
