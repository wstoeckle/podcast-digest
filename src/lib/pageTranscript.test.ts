import { describe, expect, it } from 'vitest';
import {
  htmlToText,
  looksLikeTranscript,
  nprTranscriptUrl,
  sameSiteTranscriptLinks,
  transcriptFromPage,
  wordCount,
} from './pageTranscript';

/** `n` lines of two people talking, ~20 words a line. */
function dialogue(n: number): string[] {
  return Array.from({ length: n }, (_, i) =>
    i % 2
      ? `Guest: That is a fair question, and the honest answer is that line ${i} took us years to work out properly.`
      : `Host: So tell me about the part where things changed, because line ${i} is where most people get lost.`,
  );
}

const paragraphs = (lines: string[]) => lines.map((l) => `<p>${l}</p>`).join('\n');

const SHOW_NOTES = `
  <h1>Episode 412: How batteries got cheap</h1>
  <p>In this episode we talk with a guest about the battery industry.</p>
  <ul><li>Sponsor: Example Mattresses</li><li>Sponsor: Example VPN</li></ul>`;

describe('htmlToText', () => {
  it('keeps the readable text, one block per line, and drops scripts and menus', () => {
    const html = `<html><head><title>T</title><style>p{}</style></head><body>
      <nav><a href="/">Home</a></nav>
      <script>var x = "<p>not text</p>";</script>
      <p>Tom&rsquo;s &amp; Jerry&#39;s <b>show</b>&nbsp;notes</p><p>Second&hellip;</p>
      <footer>© 2026</footer></body></html>`;
    expect(htmlToText(html)).toBe("Tom’s & Jerry's show notes\nSecond…");
  });

  it('counts words', () => {
    expect(wordCount('one two  three\nfour')).toBe(4);
    expect(wordCount('')).toBe(0);
  });
});

describe('looksLikeTranscript', () => {
  const text = dialogue(60).join('\n'); // ~1,200 words

  it('needs about half the words the episode length implies', () => {
    expect(looksLikeTranscript(text, 10 * 60)).toBe(true); // wants ≥ 800
    expect(looksLikeTranscript(text, 60 * 60)).toBe(false); // wants ≥ 4,500
    expect(looksLikeTranscript(text)).toBe(false); // unknown length wants ≥ 4,000
  });

  it('wants dialogue unless the text sits under a Transcript heading', () => {
    const essay = Array.from(
      { length: 60 },
      () => 'A long article paragraph with plenty of words in it that keeps going on and on.',
    ).join('\n');
    expect(looksLikeTranscript(essay, 10 * 60)).toBe(false);
    expect(looksLikeTranscript(essay, 10 * 60, true)).toBe(true);
  });
});

describe('transcriptFromPage', () => {
  it('takes what follows a "Transcript" heading, leaving out the show notes', () => {
    const html = `<main>${SHOW_NOTES}<h2>Transcript</h2>${paragraphs(dialogue(60))}</main>`;
    const out = transcriptFromPage(html, 10 * 60);
    expect(out).not.toBeNull();
    expect(out?.startsWith('Host: So tell me')).toBe(true);
    expect(out).not.toContain('Sponsor');
  });

  it('uses the last "Transcript" label that still leaves a whole transcript', () => {
    // A tab label up top, then the real heading. (Buttons are dropped anyway.)
    const html = `<div class="tabs"><span>Transcript</span></div>${SHOW_NOTES}
      <h3>Full transcript:</h3>${paragraphs(dialogue(60))}
      <p>Transcript</p><p>Copyright and corrections policy.</p>`;
    const out = transcriptFromPage(html, 10 * 60);
    expect(out?.startsWith('Host:')).toBe(true);
    expect(out).not.toContain('In this episode');
  });

  it('accepts a whole page of dialogue with no heading', () => {
    const out = transcriptFromPage(`<article>${paragraphs(dialogue(60))}</article>`, 10 * 60);
    expect(out).toContain('Guest: That is a fair question');
  });

  it('rejects show notes', () => {
    expect(transcriptFromPage(`<main>${SHOW_NOTES}</main>`, 60 * 60)).toBeNull();
    // Even under a heading, a few lines are not the whole episode.
    const short = `${SHOW_NOTES}<h2>Transcript</h2>${paragraphs(dialogue(10))}`;
    expect(transcriptFromPage(short, 60 * 60)).toBeNull();
  });
});

describe('sameSiteTranscriptLinks', () => {
  const page = 'https://lexfridman.com/larry-lawton';

  it("follows a link to this episode's transcript on the same site", () => {
    const html = `
      <a href="https://lexfridman.com/larry-lawton-transcript">Transcript</a>
      <a href="https://lexfridman.com/larry-lawton-transcript/">Transcript</a>
      <a href="https://www.lexfridman.com/larry-lawton-transcript#top">Read it</a>`;
    expect(sameSiteTranscriptLinks(html, page)).toEqual([
      'https://lexfridman.com/larry-lawton-transcript',
      'https://www.lexfridman.com/larry-lawton-transcript',
    ]);
  });

  it('ignores other sites, other episodes, and anchors on the same page', () => {
    const html = `
      <a href="https://tim.blog/larry-lawton-transcript">Transcript</a>
      <a href="/someone-else-transcript">Transcript</a>
      <a href="#transcript">Jump to transcript</a>
      <a href="/larry-lawton-photos">Photos</a>
      <a href="mailto:x@larry-lawton-transcript.com">Transcript</a>`;
    expect(sameSiteTranscriptLinks(html, page)).toEqual([]);
  });

  it('resolves relative links and needs a real slug', () => {
    expect(sameSiteTranscriptLinks('<a href="/larry-lawton-transcript">T</a>', page)).toEqual([
      'https://lexfridman.com/larry-lawton-transcript',
    ]);
    expect(sameSiteTranscriptLinks('<a href="/ep-transcript">T</a>', 'https://x.test/ep')).toEqual(
      [],
    );
    expect(sameSiteTranscriptLinks('<a href="/a">T</a>', 'not a url')).toEqual([]);
  });
});

describe('nprTranscriptUrl', () => {
  it("points an NPR episode page at NPR's transcript page", () => {
    expect(
      nprTranscriptUrl('https://www.npr.org/2025/03/14/nx-s1-5327301/batteries-planet-money'),
    ).toBe('https://www.npr.org/transcripts/nx-s1-5327301');
    expect(nprTranscriptUrl('https://www.npr.org/2019/05/03/719979455/episode-911')).toBe(
      'https://www.npr.org/transcripts/719979455',
    );
  });

  it('leaves other pages alone', () => {
    expect(nprTranscriptUrl('https://www.npr.org/podcasts/510289/planet-money')).toBeNull();
    expect(nprTranscriptUrl('https://notnpr.org/2025/03/14/nx-s1-5327301/x')).toBeNull();
    expect(nprTranscriptUrl('nope')).toBeNull();
  });
});
