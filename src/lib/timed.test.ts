import { describe, expect, it } from 'vitest';
import {
  formatClock,
  formatTimed,
  isTimed,
  lastMarkerTime,
  markers,
  parseClock,
  stripMarkers,
  timeAt,
  timedParagraphs,
} from './timed';
import { toTimedTranscript } from './transcriptFormats';

describe('formatClock / parseClock', () => {
  it('round-trips minutes and hours', () => {
    expect(formatClock(754)).toBe('12:34');
    expect(formatClock(3723)).toBe('1:02:03');
    expect(formatClock(5)).toBe('0:05');
    expect(parseClock('12:34')).toBe(754);
    expect(parseClock('[1:02:03]')).toBe(3723);
    expect(parseClock('00:12:34.500')).toBe(754);
  });

  it('rejects things that are not clocks', () => {
    expect(parseClock('')).toBeUndefined();
    expect(parseClock('12:75')).toBeUndefined();
    expect(parseClock('about 12 minutes in')).toBeUndefined();
  });
});

describe('formatTimed', () => {
  it('groups cues into ~30s paragraphs and labels speaker changes once', () => {
    const out = formatTimed([
      { start: 0, text: 'Welcome back.', speaker: 'Host' },
      { start: 10, text: 'Today: batteries.', speaker: 'Host' },
      { start: 35, text: 'They got cheap.', speaker: 'Host' },
      { start: 40, text: 'Very cheap.', speaker: 'Guest' },
      { start: 50, text: 'Indeed.', speaker: 'Guest' },
    ]);
    expect(out).toBe(
      [
        '[0:00] Host: Welcome back. Today: batteries.',
        '[0:35] They got cheap.',
        '[0:40] Guest: Very cheap. Indeed.',
      ].join('\n'),
    );
  });

  it('waits for a sentence end before breaking, up to 60s', () => {
    const out = formatTimed([
      { start: 0, text: 'one and' },
      { start: 31, text: 'two and' },
      { start: 61, text: 'three.' },
    ]);
    expect(out).toBe('[0:00] one and two and\n[1:01] three.');
  });
});

describe('markers and lookups', () => {
  const text = '[0:00] Intro here.\n[0:45] Second part.\n[1:02:03] Late part.';

  it('finds markers and the time at a character position', () => {
    expect(markers(text).map((m) => m.start)).toEqual([0, 45, 3723]);
    expect(isTimed(text)).toBe(true);
    expect(timeAt(text, text.indexOf('Second'))).toBe(45);
    expect(timeAt(text, text.indexOf('Late'))).toBe(3723);
    expect(timeAt('no markers', 3)).toBeUndefined();
    expect(lastMarkerTime(text)).toBe(3723);
  });

  it('strips markers and lists timed paragraphs', () => {
    expect(stripMarkers(text)).toBe('Intro here.\nSecond part.\nLate part.');
    expect(timedParagraphs('[0:10] a\nb\n[0:20] c')).toEqual([
      { start: 10, text: 'a' },
      { start: 10, text: 'b' },
      { start: 20, text: 'c' },
    ]);
  });

  it('treats plain text as untimed', () => {
    expect(isTimed('Host: hello\nGuest: hi')).toBe(false);
    expect(timedParagraphs('a\nb')).toEqual([{ text: 'a' }, { text: 'b' }]);
  });
});

describe('toTimedTranscript', () => {
  it('keeps WebVTT cue times and voice names', () => {
    const vtt = `WEBVTT

1
00:00:01.000 --> 00:00:04.000
<v Host>Welcome to the show.

2
00:00:40.500 --> 00:00:43.000
<v Guest>Thanks for having me.`;
    expect(toTimedTranscript(vtt, 'text/vtt')).toBe(
      '[0:01] Host: Welcome to the show.\n[0:40] Guest: Thanks for having me.',
    );
  });

  it('keeps SRT times', () => {
    const srt = `1
00:00:01,000 --> 00:00:04,000
Hello there.

2
00:01:05,000 --> 00:01:08,000
General Kenobi.`;
    expect(toTimedTranscript(srt)).toBe('[0:01] Hello there.\n[1:05] General Kenobi.');
  });

  it('keeps Podcasting 2.0 JSON start times', () => {
    const json = JSON.stringify({
      segments: [
        { speaker: 'Alice', startTime: 0, body: 'First point.' },
        { speaker: 'Bob', startTime: 75.2, body: 'Now Bob.' },
      ],
    });
    expect(toTimedTranscript(json, 'application/json')).toBe(
      '[0:00] Alice: First point.\n[1:15] Bob: Now Bob.',
    );
  });

  it('reads pasted transcripts with leading timestamps', () => {
    const pasted = ['[00:00] Welcome.', '(00:45) Next topic.', '01:30:15 - Wrapping up.'].join(
      '\n',
    );
    expect(toTimedTranscript(pasted)).toBe(
      '[0:00] Welcome.\n[0:45] Next topic.\n[1:30:15] Wrapping up.',
    );
  });

  it('reads "Speaker  12:34" header lines', () => {
    const pasted = [
      'Jane Doe  00:00',
      'Hi everyone.',
      'John Smith  00:40',
      'Hello.',
      'Jane Doe  01:20',
      'Let us begin.',
    ].join('\n');
    expect(toTimedTranscript(pasted)).toBe(
      '[0:00] Jane Doe: Hi everyone.\n[0:40] John Smith: Hello.\n[1:20] Jane Doe: Let us begin.',
    );
  });

  it('round-trips its own output', () => {
    const timed = '[0:00] A: one.\n[0:40] B: two.\n[1:20] A: three.';
    expect(toTimedTranscript(timed)).toBe('[0:00] A: one.\n[0:40] B: two.\n[1:20] A: three.');
  });

  it('falls back to plain text when there are too few times', () => {
    expect(toTimedTranscript('Host: hi at 10:30\nGuest: hello')).toBe(
      'Host: hi at 10:30\nGuest: hello',
    );
  });
});
