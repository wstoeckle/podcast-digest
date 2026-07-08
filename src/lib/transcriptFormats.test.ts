import { describe, it, expect } from 'vitest';
import { toPlainTranscript } from './transcriptFormats';

describe('toPlainTranscript', () => {
  it('converts WebVTT, dropping headers, cue numbers and timestamps', () => {
    const vtt = `WEBVTT

1
00:00:01.000 --> 00:00:04.000
<v Host>Welcome to the show.

2
00:00:04.500 --> 00:00:07.000
Today we talk about oceans.`;
    expect(toPlainTranscript(vtt, 'text/vtt')).toBe(
      'Welcome to the show.\nToday we talk about oceans.',
    );
  });

  it('converts SRT (comma timestamps, index lines)', () => {
    const srt = `1
00:00:01,000 --> 00:00:04,000
Hello there.

2
00:00:05,000 --> 00:00:08,000
General Kenobi.`;
    expect(toPlainTranscript(srt)).toBe('Hello there.\nGeneral Kenobi.');
  });

  it('converts Podcasting 2.0 JSON with speakers', () => {
    const json = JSON.stringify({
      version: '1.0.0',
      segments: [
        { speaker: 'Alice', startTime: 0, body: 'First point.' },
        { speaker: 'Alice', startTime: 3, body: 'Still Alice.' },
        { speaker: 'Bob', startTime: 6, body: 'Now Bob.' },
      ],
    });
    expect(toPlainTranscript(json, 'application/json')).toBe(
      'Alice: First point.\nStill Alice.\nBob: Now Bob.',
    );
  });

  it('handles a generic array of {text}', () => {
    const json = JSON.stringify([{ text: 'a' }, { text: 'b' }]);
    expect(toPlainTranscript(json)).toBe('a\nb');
  });

  it('strips HTML transcripts', () => {
    expect(toPlainTranscript('<p>Hello <b>world</b></p>', 'text/html')).toBe('Hello world');
  });

  it('passes plain text through, collapsing blank lines', () => {
    expect(toPlainTranscript('Line one.\n\n\n\nLine two.')).toBe('Line one.\nLine two.');
  });

  it('auto-detects VTT without a type hint', () => {
    expect(toPlainTranscript('WEBVTT\n\n00:00.000 --> 00:02.000\nHi')).toBe('Hi');
  });

  it('returns empty string for empty input', () => {
    expect(toPlainTranscript('   ')).toBe('');
  });

  it('cleans a transcript pasted from a website (ragged whitespace, speaker lines)', () => {
    const pasted = [
      '   Host: Welcome back to the show.   ',
      '',
      '   ',
      'Guest: Thanks for having me.',
      '',
      '',
      'Host: Let’s dig in.',
    ].join('\n');
    expect(toPlainTranscript(pasted)).toBe(
      'Host: Welcome back to the show.\nGuest: Thanks for having me.\nHost: Let’s dig in.',
    );
  });
});
