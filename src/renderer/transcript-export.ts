import { speakerOf, wordsOf } from './speaker-labels';
import { fmtDuration, fmtPercent, type SessionMetrics } from './session-metrics';
import type { TranscriptLine } from './use-session';

/**
 * The transcript, written out for somewhere else.
 *
 * Every format is built from the same three inputs — the lines, the names the
 * user typed, and the metrics already on screen — so a caption file and a
 * summary document can never disagree about who said what. Pure string
 * building: choosing a file and writing it belongs to the main process, which
 * is the only side that may touch the filesystem.
 */

export type ExportFormat = 'txt' | 'md' | 'srt' | 'vtt' | 'csv' | 'json';

export interface ExportFormatSpec {
  id: ExportFormat;
  label: string;
  extension: string;
  description: string;
}

export const EXPORT_FORMATS: ExportFormatSpec[] = [
  { id: 'txt', label: 'Plain text', extension: 'txt', description: 'Timestamped lines' },
  { id: 'md', label: 'Markdown', extension: 'md', description: 'Notes with a summary header' },
  { id: 'srt', label: 'Subtitles (SRT)', extension: 'srt', description: 'Captions for video' },
  { id: 'vtt', label: 'WebVTT', extension: 'vtt', description: 'Captions for the web' },
  { id: 'csv', label: 'Spreadsheet (CSV)', extension: 'csv', description: 'One row per utterance' },
  { id: 'json', label: 'JSON', extension: 'json', description: 'Everything, word timings included' },
];

export interface ExportMeta {
  recordingId: string | null;
  /** ISO stamp the session started, when it is known. */
  startedAt: string | null;
  labels: Record<string, string>;
  metrics: SessionMetrics;
}

/** The name to print for a raw speaker id, falling back to the id itself. */
function nameOf(speaker: string, labels: Record<string, string>): string {
  const name = labels[speaker];
  return name && name.trim() ? name.trim() : speaker;
}

function pad(n: number, width = 2): string {
  return Math.floor(n).toString().padStart(width, '0');
}

/** `00:01:02,345` — SRT's comma, or WebVTT's dot. */
function timecode(seconds: number, decimal: ',' | '.'): string {
  const s = Math.max(0, seconds);
  const ms = Math.round((s % 1) * 1000);
  return `${pad(s / 3600)}:${pad((s % 3600) / 60)}:${pad(s % 60)}${decimal}${pad(ms, 3)}`;
}

function stamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${pad(s / 3600)}:${pad((s % 3600) / 60)}:${pad(s % 60)}`;
}

function whenLine(meta: ExportMeta): string | null {
  if (!meta.startedAt) return null;
  const d = new Date(meta.startedAt);
  return Number.isNaN(d.getTime()) ? meta.startedAt : d.toLocaleString();
}

function ordered(lines: TranscriptLine[]): TranscriptLine[] {
  return [...lines].sort((a, b) => a.start - b.start || a.id - b.id);
}

function toTxt(lines: TranscriptLine[], meta: ExportMeta): string {
  const when = whenLine(meta);
  const head = [
    'Miniscribe transcript',
    when ? `Recorded: ${when}` : null,
    `Duration: ${fmtDuration(meta.metrics.duration)}`,
    `Speakers: ${meta.metrics.speakers.map((s) => nameOf(s.speaker, meta.labels)).join(', ')}`,
    '',
  ].filter((l): l is string => l !== null);

  const body = ordered(lines).map(
    (line) => `[${stamp(line.start)}] ${nameOf(speakerOf(line), meta.labels)}: ${line.text}`,
  );
  return [...head, ...body, ''].join('\n');
}

function toMarkdown(lines: TranscriptLine[], meta: ExportMeta): string {
  const { metrics } = meta;
  const when = whenLine(meta);
  const out: string[] = ['# Meeting transcript', ''];
  if (when) out.push(`**Recorded:** ${when}  `);
  out.push(
    `**Duration:** ${fmtDuration(metrics.duration)}  `,
    `**Speech:** ${fmtDuration(metrics.speechSeconds)} · **Silence:** ${fmtPercent(metrics.silenceShare)}  `,
    `**Words:** ${metrics.words} · **Pace:** ${Math.round(metrics.wordsPerMinute)} wpm · **Turns:** ${metrics.turns}`,
    '',
  );

  if (metrics.speakers.length > 0) {
    out.push(
      '## Speaking time',
      '',
      '| Speaker | Talk time | Share | Words | Pace | Utterances |',
      '| --- | ---: | ---: | ---: | ---: | ---: |',
      ...metrics.speakers.map(
        (s) =>
          `| ${nameOf(s.speaker, meta.labels)} | ${fmtDuration(s.seconds)} | ${fmtPercent(
            s.shareOfSpeech,
          )} | ${s.words} | ${Math.round(s.wordsPerMinute)} wpm | ${s.turns} |`,
      ),
      '',
    );
  }

  out.push('## Transcript', '');
  let previous: string | null = null;
  for (const line of ordered(lines)) {
    const speaker = nameOf(speakerOf(line), meta.labels);
    // A run by one person reads as one block; repeating the name on every line
    // buries the handovers, which is the thing worth seeing in a meeting.
    if (speaker !== previous) {
      if (previous !== null) out.push('');
      out.push(`**${speaker}**`);
      previous = speaker;
    }
    out.push(`- \`${stamp(line.start)}\` ${line.text}`);
  }
  out.push('');
  return out.join('\n');
}

function toSrt(lines: TranscriptLine[], meta: ExportMeta): string {
  return (
    ordered(lines)
      .map((line, i) =>
        [
          String(i + 1),
          `${timecode(line.start, ',')} --> ${timecode(Math.max(line.end, line.start + 0.5), ',')}`,
          `${nameOf(speakerOf(line), meta.labels)}: ${line.text}`,
          '',
        ].join('\n'),
      )
      .join('\n') + '\n'
  );
}

function toVtt(lines: TranscriptLine[], meta: ExportMeta): string {
  const cues = ordered(lines).map((line, i) =>
    [
      String(i + 1),
      `${timecode(line.start, '.')} --> ${timecode(Math.max(line.end, line.start + 0.5), '.')}`,
      `<v ${nameOf(speakerOf(line), meta.labels)}>${line.text}`,
      '',
    ].join('\n'),
  );
  return ['WEBVTT', '', ...cues].join('\n');
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(lines: TranscriptLine[], meta: ExportMeta): string {
  const rows = [
    ['start_seconds', 'end_seconds', 'start', 'speaker', 'raw_speaker', 'track', 'words', 'text'],
    ...ordered(lines).map((line) => [
      line.start.toFixed(3),
      line.end.toFixed(3),
      stamp(line.start),
      nameOf(speakerOf(line), meta.labels),
      speakerOf(line),
      line.kind,
      String(wordsOf(line).length),
      line.text,
    ]),
  ];
  return rows.map((row) => row.map(csvCell).join(',')).join('\n') + '\n';
}

function toJson(lines: TranscriptLine[], meta: ExportMeta): string {
  return (
    JSON.stringify(
      {
        app: 'Miniscribe',
        recordingId: meta.recordingId,
        startedAt: meta.startedAt,
        exportedAt: new Date().toISOString(),
        speakerNames: meta.labels,
        // The spans are dropped: they are a redundant view of the lines below,
        // and a file this size should not carry the same intervals twice.
        metrics: { ...meta.metrics, speakers: meta.metrics.speakers.map(({ spans, ...s }) => s) },
        lines: ordered(lines).map((line) => ({
          start: line.start,
          end: line.end,
          track: line.kind,
          rawSpeaker: speakerOf(line),
          speaker: nameOf(speakerOf(line), meta.labels),
          text: line.text,
          words: line.words ?? null,
        })),
      },
      null,
      2,
    ) + '\n'
  );
}

export function formatTranscript(
  format: ExportFormat,
  lines: TranscriptLine[],
  meta: ExportMeta,
): string {
  switch (format) {
    case 'md':
      return toMarkdown(lines, meta);
    case 'srt':
      return toSrt(lines, meta);
    case 'vtt':
      return toVtt(lines, meta);
    case 'csv':
      return toCsv(lines, meta);
    case 'json':
      return toJson(lines, meta);
    default:
      return toTxt(lines, meta);
  }
}

/** A filename that says which meeting this is without being opened. */
export function exportFileName(meta: ExportMeta, format: ExportFormat): string {
  const spec = EXPORT_FORMATS.find((f) => f.id === format);
  const when = meta.startedAt ? new Date(meta.startedAt) : null;
  const slug =
    when && !Number.isNaN(when.getTime())
      ? `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}-${pad(
          when.getHours(),
        )}${pad(when.getMinutes())}`
      : (meta.recordingId ?? 'transcript');
  return `miniscribe-${slug}.${spec?.extension ?? 'txt'}`;
}
