// Session metrics and transcript export, over a transcript with a known shape.
//
// Plain node — these two modules are pure functions over the lines the
// recogniser produced, with no Electron, no audio, and no model. The arithmetic
// is the part that can silently drift (overlapping utterances double-counted,
// a turn counted per line instead of per handover), and it is exactly the part
// nobody notices is wrong until a meeting is already over.
//
//   npm run test:metrics

const assert = require('node:assert');
const { computeMetrics, mergeSpans, spanSeconds } = require('../dist/test/session-metrics.js');
const {
  EXPORT_FORMATS,
  exportFileName,
  formatTranscript,
} = require('../dist/test/transcript-export.js');

// me      ####          ######
// them        #######            ...        ##
// 0    1    2    3    4    5    6    7 ... 10   11        12 (end)
const LINES = [
  { id: 0, kind: 'me', start: 0, end: 2, text: 'Hello there', speaker: 'Me' },
  { id: 1, kind: 'them', start: 2.5, end: 5, text: 'Hi, how are you?', speaker: 'Them 1' },
  { id: 2, kind: 'me', start: 4.5, end: 7, text: 'Um I am fine', speaker: 'Me' },
  { id: 3, kind: 'them', start: 10, end: 11, text: 'Good', speaker: 'Them 1' },
];
const LABELS = { 'Them 1': 'Priya' };
const DURATION = 12;

function near(actual, expected, what) {
  assert.ok(
    Math.abs(actual - expected) < 1e-6,
    `${what}: expected ${expected}, got ${actual}`,
  );
}

// --- spans ----------------------------------------------------------------

{
  const merged = mergeSpans([
    { start: 0, end: 2 },
    { start: 1.5, end: 3 },
    { start: 3, end: 4 },
    { start: 9, end: 10 },
  ]);
  assert.deepStrictEqual(merged, [
    { start: 0, end: 4 },
    { start: 9, end: 10 },
  ]);
  near(spanSeconds(merged), 5, 'merged span seconds');
  assert.deepStrictEqual(mergeSpans([{ start: 3, end: 3 }]), [], 'empty spans dropped');
  console.log('ok: spans merge without double counting');
}

// --- session metrics ------------------------------------------------------

const m = computeMetrics(LINES, DURATION);

near(m.duration, 12, 'duration');
// Union is [0,2] + [2.5,7] + [10,11] — the me/them overlap at 4.5-5 counts once.
near(m.speechSeconds, 7.5, 'speech seconds');
near(m.silenceSeconds, 4.5, 'silence seconds');
near(m.silenceShare, 4.5 / 12, 'silence share');
near(m.crosstalkSeconds, 0.5, 'crosstalk seconds');
assert.strictEqual(m.turns, 3, 'handovers, not utterances');
assert.strictEqual(m.utterances, 4, 'utterance count');
assert.strictEqual(m.words, 11, 'word count');
near(m.longestPause.seconds, 3, 'longest pause');
near(m.longestPause.at, 7, 'longest pause start');
assert.strictEqual(m.longestMonologue.seconds, 2.5, 'longest monologue');
console.log('ok: session totals');

const me = m.speakers.find((s) => s.speaker === 'Me');
const them = m.speakers.find((s) => s.speaker === 'Them 1');
near(me.seconds, 4.5, 'me talk time');
near(them.seconds, 3.5, 'them talk time');
near(me.shareOfSpeech, 4.5 / 7.5, 'me share of speech');
near(me.shareOfSession, 4.5 / 12, 'me share of session');
assert.strictEqual(me.words, 6, 'me words');
assert.strictEqual(me.turns, 2, 'me utterances');
assert.strictEqual(me.fillers, 1, 'me fillers ("Um")');
assert.strictEqual(them.questions, 1, 'them questions');
near(me.firstAt, 0, 'me first heard');
near(them.firstAt, 2.5, 'them first heard');
// Sorted by talk time, so the speaker who held the floor leads the table.
assert.strictEqual(m.speakers[0].speaker, 'Me', 'speakers ordered by talk time');
console.log('ok: per-speaker metrics');

{
  // One voice, two remarks, a six-second silence between them. Nobody else
  // spoke, but that is not a twelve-second monologue — the run has to break at
  // the pause or the number flatters whoever was on their own in the room.
  const alone = computeMetrics(
    [
      { id: 0, kind: 'me', start: 2, end: 6, text: 'One two three four', speaker: 'Me' },
      { id: 1, kind: 'me', start: 12, end: 14, text: 'Five six', speaker: 'Me' },
    ],
    15,
  );
  assert.strictEqual(alone.turns, 0, 'a single voice never hands over');
  near(alone.longestMonologue.seconds, 4, 'monologue breaks at the pause');
  near(alone.longestMonologue.at, 2, 'monologue start');
  near(alone.longestPause.seconds, 6, 'the silence is still a pause');
  assert.strictEqual(alone.speakers[0].turns, 2, 'both utterances still counted');
  console.log('ok: a pause ends a monologue but not a turn');
}

{
  const empty = computeMetrics([], 30);
  near(empty.duration, 30, 'empty duration');
  assert.strictEqual(empty.speakers.length, 0, 'no speakers');
  assert.strictEqual(empty.longestPause, null, 'no pause without speech');
  // A transcript that outruns the audio the player measured still reports the
  // whole conversation rather than truncating at the shorter clock.
  near(computeMetrics(LINES, 3).duration, 11, 'duration falls back to last utterance');
  console.log('ok: degenerate sessions');
}

// --- export ---------------------------------------------------------------

const meta = { recordingId: '2026-08-12T09-30-00-000Z', startedAt: '2026-08-12T09:30:00.000Z', labels: LABELS, metrics: m };

{
  const txt = formatTranscript('txt', LINES, meta);
  assert.ok(txt.includes('[00:00:00] Me: Hello there'), 'txt line');
  // The name the user typed replaces the cluster id everywhere, in every format.
  assert.ok(txt.includes('Priya: Hi, how are you?'), 'txt uses the speaker name');
  assert.ok(!txt.includes('Them 1:'), 'raw cluster id not printed');
  console.log('ok: plain text');
}

{
  const srt = formatTranscript('srt', LINES, meta);
  assert.ok(srt.startsWith('1\n00:00:00,000 --> 00:00:02,000\n'), 'srt first cue');
  assert.ok(srt.includes('00:00:02,500 --> 00:00:05,000'), 'srt fractional timecode');
  assert.strictEqual(srt.match(/-->/g).length, 4, 'one cue per utterance');
  console.log('ok: srt');
}

{
  const vtt = formatTranscript('vtt', LINES, meta);
  assert.ok(vtt.startsWith('WEBVTT\n'), 'vtt header');
  assert.ok(vtt.includes('00:00:02.500 --> 00:00:05.000'), 'vtt uses a dot');
  assert.ok(vtt.includes('<v Priya>'), 'vtt voice span');
  console.log('ok: webvtt');
}

{
  const csv = formatTranscript('csv', LINES, meta);
  const rows = csv.trim().split('\n');
  assert.strictEqual(rows.length, 5, 'header plus a row per utterance');
  // The comma inside "Hi, how are you?" must not become a column break.
  assert.ok(csv.includes('"Hi, how are you?"'), 'csv quotes a field with a comma');
  const quoted = formatTranscript(
    'csv',
    [{ id: 0, kind: 'me', start: 0, end: 1, text: 'He said "no"', speaker: 'Me' }],
    meta,
  );
  assert.ok(quoted.includes('"He said ""no"""'), 'csv doubles embedded quotes');
  console.log('ok: csv');
}

{
  const parsed = JSON.parse(formatTranscript('json', LINES, meta));
  assert.strictEqual(parsed.lines.length, 4, 'json lines');
  assert.strictEqual(parsed.lines[1].speaker, 'Priya', 'json resolved name');
  assert.strictEqual(parsed.lines[1].rawSpeaker, 'Them 1', 'json keeps the cluster id');
  near(parsed.metrics.speechSeconds, 7.5, 'json carries the metrics');
  assert.ok(!('spans' in parsed.metrics.speakers[0]), 'spans dropped from the export');
  console.log('ok: json');
}

{
  const md = formatTranscript('md', LINES, meta);
  assert.ok(md.includes('| Priya |'), 'markdown speaking-time table');
  assert.ok(md.includes('**Priya**'), 'markdown groups a run under one name');
  console.log('ok: markdown');
}

{
  // The stamp is the user's local time, not the ISO string's UTC, so the test
  // asserts the shape rather than a wall clock that depends on where it runs.
  assert.match(exportFileName(meta, 'srt'), /^miniscribe-2026-08-\d{2}-\d{4}\.srt$/);
  for (const format of EXPORT_FORMATS) {
    assert.ok(
      exportFileName(meta, format.id).endsWith(`.${format.extension}`),
      `${format.id} filename extension`,
    );
    assert.ok(formatTranscript(format.id, LINES, meta).length > 0, `${format.id} produces output`);
  }
  console.log('ok: filenames and every format');
}

console.log('\nAll metrics and export checks passed.');
