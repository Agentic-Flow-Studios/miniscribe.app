import type { TrackKind } from '../capture-types';
import type { TranscriptLine } from './use-session';

/** The speaker id a track carries before diarization splits it up. */
export const TRACK_SPEAKER: Record<TrackKind, string> = { me: 'Me', them: 'Them' };

// Distinct token colours for diarized "Them N" speakers.
const SPEAKER_COLORS = ['yellow', 'pink', 'purple', 'green', 'orange', 'blue'] as const;

export type TokenColor = (typeof SPEAKER_COLORS)[number] | 'gray';

/**
 * Colour for a RAW speaker id, never a user-supplied name. Renaming "Them 2" to
 * "Priya" has to leave its colour alone, or every line on screen would change
 * colour the moment it got a name.
 */
export function speakerColor(speaker: string): TokenColor {
  const m = speaker.match(/(\d+)$/);
  // No trailing digit means diarization found no overlapping segment and fell
  // back to the bare track label. Give it its own neutral colour rather than
  // letting it masquerade as "Them 1".
  if (!m) return 'gray';
  const n = parseInt(m[1], 10) - 1;
  return SPEAKER_COLORS[((n % SPEAKER_COLORS.length) + SPEAKER_COLORS.length) % SPEAKER_COLORS.length];
}

/**
 * The raw speaker id a line belongs to — the key its user-supplied name is
 * stored under. Live lines carry no `speaker` at all (only the diarized pass
 * assigns one), so the track stands in for it: the column already says which.
 */
export function speakerOf(line: TranscriptLine): string {
  return line.speaker ?? (line.kind === 'me' ? 'Me' : 'Them');
}

/**
 * Words with their start times, synthesised when the recogniser gave none.
 *
 * Live lines from an older run, or any path where the model returned no token
 * timestamps, still have to follow along; spreading the words evenly across the
 * utterance is wrong in the small but right in the large, and it degrades to
 * "the whole line lights up roughly in time" rather than to nothing.
 */
export function wordsOf(line: TranscriptLine): { t: number; text: string }[] {
  if (line.words && line.words.length > 0) return line.words;
  const words = line.text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const span = Math.max(0, line.end - line.start);
  return words.map((text, i) => ({ t: line.start + (span * i) / words.length, text }));
}

/**
 * The line sounding at `time`, or null in a gap between utterances.
 *
 * Silence between turns is not attributed to anyone — that is the same claim the
 * empty cells in a row make, and keeping it here means the highlight goes out
 * when nobody is talking instead of lingering on whoever spoke last.
 */
export function lineAt(lines: TranscriptLine[], time: number): TranscriptLine | null {
  let best: TranscriptLine | null = null;
  for (const line of lines) {
    // Latest start wins, so overlapping speech highlights whoever spoke most
    // recently rather than whoever happens to come first in the array.
    if (line.start <= time && time < line.end && (!best || line.start > best.start)) {
      best = line;
    }
  }
  return best;
}

/**
 * All lines sounding at `time`, allowing concurrent speakers (e.g. Me and Them)
 * to be highlighted simultaneously during playback.
 */
export function linesAt(lines: TranscriptLine[], time: number): TranscriptLine[] {
  return lines.filter((line) => line.start <= time && time < line.end);
}

/** Index of the last word started at or before `time`; -1 before the first. */
export function wordAt(words: { t: number }[], time: number): number {
  let i = -1;
  while (i + 1 < words.length && words[i + 1].t <= time) i++;
  return i;
}

/** Raw speaker ids present in a transcript, in first-appearance order. */
function speakersIn(lines: TranscriptLine[]): string[] {
  const seen: string[] = [];
  for (const line of lines) {
    const s = speakerOf(line);
    if (!seen.includes(s)) seen.push(s);
  }
  return seen;
}

// Me first, then the remote side in cluster order — bare "Them" (diarization
// found no overlapping segment) ahead of "Them 1", since it is the track itself.
function rank(speaker: string): [number, number] {
  if (speaker === TRACK_SPEAKER.me) return [0, 0];
  const m = speaker.match(/(\d+)$/);
  return [1, m ? parseInt(m[1], 10) : 0];
}

/**
 * One column per voice, left to right.
 *
 * A live track earns a column before it has said anything, so an open mic is
 * visible waiting. Otherwise a speaker only gets a column if a line is actually
 * filed under it — which is what keeps a bare "Them" out of the header once
 * diarization has split that track into "Them 1" and "Them 2" and nothing can
 * ever be attributed to it again.
 */
export function speakerColumns(lines: TranscriptLine[], liveTracks: TrackKind[]): string[] {
  const present = new Set(speakersIn(lines));
  for (const kind of liveTracks) present.add(TRACK_SPEAKER[kind]);
  if (present.size === 0) return [TRACK_SPEAKER.me, TRACK_SPEAKER.them];

  return [...present].sort((a, b) => {
    const [ga, na] = rank(a);
    const [gb, nb] = rank(b);
    return ga - gb || na - nb || a.localeCompare(b);
  });
}
