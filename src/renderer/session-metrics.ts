import { speakerOf, wordsOf } from './speaker-labels';
import type { TranscriptLine } from './use-session';

/**
 * What a session actually looked like, derived from the transcript alone.
 *
 * Nothing here is measured a second time off the audio: every number falls out
 * of the utterance spans the recogniser already produced, which is the same
 * clock the transcript and the scrubber run on. That matters more than it
 * sounds — a "talk time" computed from a separate pass over the WAV would
 * disagree with the highlighted line on screen, and the user would be right to
 * trust the transcript over the number.
 *
 * The recogniser gives us three things and no more: utterance boundaries from
 * the VAD, per-token timestamps, and (after a diarization pass) a cluster id per
 * utterance. There is no confidence score and no prosody, so anything claiming
 * to measure certainty or sentiment would be invented. Everything below is
 * arithmetic on time and words.
 */

export interface Span {
  start: number;
  end: number;
}

/** Merge overlapping and touching spans, so no moment is ever counted twice. */
export function mergeSpans(spans: Span[]): Span[] {
  const sorted = spans.filter((s) => s.end > s.start).sort((a, b) => a.start - b.start);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push({ start: s.start, end: s.end });
  }
  return out;
}

export function spanSeconds(spans: Span[]): number {
  return spans.reduce((total, s) => total + (s.end - s.start), 0);
}

/**
 * Seconds during which at least `atLeast` of the given spans are open at once.
 *
 * A sweep rather than a sampling loop, because the answer has to stay exact for
 * a 90-minute meeting without picking an arbitrary resolution. Ends sort before
 * starts at equal time, so two spans that merely touch are not overlap.
 */
function concurrentSeconds(spans: Span[], atLeast: number): number {
  const events = spans
    .flatMap((s) => [
      { t: s.start, delta: 1 },
      { t: s.end, delta: -1 },
    ])
    .sort((a, b) => a.t - b.t || a.delta - b.delta);

  let depth = 0;
  let from = 0;
  let total = 0;
  for (const event of events) {
    if (depth >= atLeast) total += event.t - from;
    depth += event.delta;
    from = event.t;
  }
  return total;
}

// Filler words are counted, never removed. They are a speaking-habit signal the
// user may want and the transcript should keep verbatim either way.
//
// Deliberately short. Words that are as often content as hesitation — "so",
// "right", "okay" — are left out: counting them would turn an ordinary sentence
// into evidence of waffling, and a statistic nobody trusts is worse than none.
const FILLERS = new Set([
  'um',
  'umm',
  'uh',
  'uhh',
  'erm',
  'er',
  'ah',
  'hmm',
  'mmm',
  'basically',
  'literally',
]);

const FILLER_PHRASES = ['you know', 'i mean', 'sort of', 'kind of'];

// Longest gap that still counts as the same breath. Chosen against the VAD,
// which closes an utterance after 0.5s of silence: anything under a few seconds
// is the same thought continuing, and anything over it is a new one.
const MONOLOGUE_GAP = 3;

function bareWord(text: string): string {
  return text.toLowerCase().replace(/[^a-z']/g, '');
}

function countFillers(text: string, words: { text: string }[]): number {
  let n = 0;
  for (const word of words) {
    if (FILLERS.has(bareWord(word.text))) n++;
  }
  const flat = text.toLowerCase();
  for (const phrase of FILLER_PHRASES) {
    // A phrase can appear more than once in a long utterance.
    let from = 0;
    for (;;) {
      const at = flat.indexOf(phrase, from);
      if (at === -1) break;
      n++;
      from = at + phrase.length;
    }
  }
  return n;
}

export interface SpeakerMetrics {
  /** Raw speaker id — the key a user-supplied name is stored under. */
  speaker: string;
  /** Utterances filed under this speaker. */
  turns: number;
  /** Time this speaker held the floor, overlap within their own lines removed. */
  seconds: number;
  words: number;
  /** Words per minute over this speaker's own talk time, not the meeting's. */
  wordsPerMinute: number;
  /** 0..1 of all speech in the session. */
  shareOfSpeech: number;
  /** 0..1 of the session's whole wall clock, silence included. */
  shareOfSession: number;
  longestTurn: number;
  averageTurn: number;
  /** Utterances that read as a question. Cheap heuristic: ends in '?'. */
  questions: number;
  fillers: number;
  firstAt: number;
  lastAt: number;
  /** Merged talk spans, for drawing this speaker's lane on the timeline. */
  spans: Span[];
}

export interface SessionMetrics {
  /** Wall clock of the recording, silence included. */
  duration: number;
  /** Union of every speaker's talk time. */
  speechSeconds: number;
  silenceSeconds: number;
  /** 0..1 of the session nobody was talking. */
  silenceShare: number;
  /** Time two or more voices overlapped. */
  crosstalkSeconds: number;
  /** Handovers between speakers — one less than the number of runs. */
  turns: number;
  utterances: number;
  words: number;
  /** Words per minute over the whole session, silence included. */
  wordsPerMinute: number;
  /** The longest stretch of silence BETWEEN utterances, and when it started. */
  longestPause: { seconds: number; at: number } | null;
  /** Longest single uninterrupted run by one speaker. */
  longestMonologue: { speaker: string; seconds: number; at: number } | null;
  /** Per speaker, ordered by talk time, longest first. */
  speakers: SpeakerMetrics[];
}

const EMPTY: SessionMetrics = {
  duration: 0,
  speechSeconds: 0,
  silenceSeconds: 0,
  silenceShare: 0,
  crosstalkSeconds: 0,
  turns: 0,
  utterances: 0,
  words: 0,
  wordsPerMinute: 0,
  longestPause: null,
  longestMonologue: null,
  speakers: [],
};

/**
 * Everything the panel shows, in one pass over the transcript.
 *
 * `duration` is the recording's wall clock, which the caller knows from the
 * audio; the transcript can only ever say when the last person stopped talking,
 * so the two are reconciled here rather than at every call site.
 */
export function computeMetrics(lines: TranscriptLine[], duration: number): SessionMetrics {
  if (lines.length === 0) return { ...EMPTY, duration: Math.max(0, duration) };

  const ordered = [...lines].sort((a, b) => a.start - b.start || a.id - b.id);
  const lastEnd = ordered.reduce((max, l) => Math.max(max, l.end), 0);
  const total = Math.max(duration, lastEnd);

  const bySpeaker = new Map<string, TranscriptLine[]>();
  for (const line of ordered) {
    const speaker = speakerOf(line);
    const bucket = bySpeaker.get(speaker);
    if (bucket) bucket.push(line);
    else bySpeaker.set(speaker, [line]);
  }

  const merged = new Map<string, Span[]>();
  for (const [speaker, own] of bySpeaker) {
    merged.set(
      speaker,
      mergeSpans(own.map((l) => ({ start: l.start, end: l.end }))),
    );
  }

  const allSpans = mergeSpans([...merged.values()].flat());
  const speechSeconds = spanSeconds(allSpans);
  const crosstalkSeconds = concurrentSeconds([...merged.values()].flat(), 2);

  let words = 0;
  const speakers: SpeakerMetrics[] = [];
  for (const [speaker, own] of bySpeaker) {
    const spans = merged.get(speaker) ?? [];
    const seconds = spanSeconds(spans);
    let ownWords = 0;
    let questions = 0;
    let fillers = 0;
    let longestTurn = 0;
    for (const line of own) {
      const lineWords = wordsOf(line);
      ownWords += lineWords.length;
      if (line.text.trim().endsWith('?')) questions++;
      fillers += countFillers(line.text, lineWords);
      longestTurn = Math.max(longestTurn, line.end - line.start);
    }
    words += ownWords;
    speakers.push({
      speaker,
      turns: own.length,
      seconds,
      words: ownWords,
      wordsPerMinute: seconds > 0 ? (ownWords / seconds) * 60 : 0,
      shareOfSpeech: speechSeconds > 0 ? seconds / speechSeconds : 0,
      shareOfSession: total > 0 ? seconds / total : 0,
      longestTurn,
      averageTurn: own.length > 0 ? seconds / own.length : 0,
      questions,
      fillers,
      firstAt: own[0].start,
      lastAt: own.reduce((max, l) => Math.max(max, l.end), 0),
      spans,
    });
  }
  speakers.sort((a, b) => b.seconds - a.seconds || a.speaker.localeCompare(b.speaker));

  // A turn is a handover, so it counts transitions between consecutive
  // utterances rather than utterances themselves: one person talking for ten
  // lines straight is one turn, not ten.
  let turns = 0;
  let longestPause: SessionMetrics['longestPause'] = null;
  for (let i = 1; i < allSpans.length; i++) {
    const gap = allSpans[i].start - allSpans[i - 1].end;
    if (!longestPause || gap > longestPause.seconds) {
      longestPause = { seconds: gap, at: allSpans[i - 1].end };
    }
  }
  let longestMonologue: SessionMetrics['longestMonologue'] = null;
  let runSpeaker = speakerOf(ordered[0]);
  let runStart = ordered[0].start;
  let runEnd = ordered[0].end;
  const closeRun = (): void => {
    const seconds = runEnd - runStart;
    if (!longestMonologue || seconds > longestMonologue.seconds) {
      longestMonologue = { speaker: runSpeaker, seconds, at: runStart };
    }
  };
  for (let i = 1; i < ordered.length; i++) {
    const speaker = speakerOf(ordered[i]);
    const isSameVoice = speaker === runSpeaker;
    if (!isSameVoice) turns++;
    // Nobody else talking is not the same as talking without stopping: two
    // remarks either side of a long silence are two remarks. A run therefore
    // ends at a handover OR at a pause, and only the first is a turn.
    if (isSameVoice && ordered[i].start - runEnd <= MONOLOGUE_GAP) {
      runEnd = Math.max(runEnd, ordered[i].end);
      continue;
    }
    closeRun();
    runSpeaker = speaker;
    runStart = ordered[i].start;
    runEnd = ordered[i].end;
  }
  closeRun();

  return {
    duration: total,
    speechSeconds,
    silenceSeconds: Math.max(0, total - speechSeconds),
    silenceShare: total > 0 ? Math.max(0, total - speechSeconds) / total : 0,
    crosstalkSeconds,
    turns,
    utterances: ordered.length,
    words,
    wordsPerMinute: total > 0 ? (words / total) * 60 : 0,
    longestPause,
    longestMonologue,
    speakers,
  };
}

/** `1:04`, or `1:02:03` once a meeting runs past the hour. */
export function fmtClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? m.toString().padStart(2, '0') : String(m);
  return h > 0
    ? `${h}:${mm}:${sec.toString().padStart(2, '0')}`
    : `${mm}:${sec.toString().padStart(2, '0')}`;
}

/** Duration read as prose — `4m 12s`. For stat tiles, not timecodes. */
export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${rest.toString().padStart(2, '0')}s`;
}

export function fmtPercent(fraction: number): string {
  if (!Number.isFinite(fraction)) return '—';
  return `${Math.round(fraction * 100)}%`;
}
