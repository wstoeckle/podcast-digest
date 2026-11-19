// Finding a transcript on a show's own website. Many shows post full
// transcripts on the episode page (Acquired, Dwarkesh, 80,000 Hours), on a
// linked page on the same site (Lex Fridman), or at a predictable address
// (NPR). Pure: the fetching happens in api/_lib/transcripts.ts.
//
// Being wrong is worse than finding nothing (a digest of show notes, or of
// another episode), so a page only counts as a transcript when it is long
// enough for the episode and either sits under a "Transcript" heading or reads
// like a conversation.

import { decodeEntities } from './rss.js';

/** Speech runs about 150 words a minute. */
const WORDS_PER_MINUTE = 150;

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  mdash: '—',
  ndash: '–',
  hellip: '…',
};

/** Readable text from HTML: one line per block, without scripts, menus or footers. */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<head\b[\s\S]*?<\/head>/gi, ' ')
    .replace(
      /<(script|style|noscript|svg|template|iframe|nav|header|footer|aside|form|button|select|textarea)\b[\s\S]*?<\/\1>/gi,
      ' ',
    )
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(
      /<\/?(p|div|li|ul|ol|h[1-6]|tr|section|article|blockquote|dd|dt|pre|figcaption|main)\b[^>]*>/gi,
      '\n',
    )
    .replace(/<\/?(td|th)\b[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&([a-z]+);/gi, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
  return decodeEntities(text)
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

export function wordCount(text: string): number {
  return text.match(/\S+/g)?.length ?? 0;
}

/** Lines that look like dialogue: "Name: …", "Name (12:34) …", or a timestamp. */
function dialogueLines(lines: string[]): number {
  const speaker = /^[A-Z][\w.'’-]*(?: [A-Z][\w.'’-]*){0,4}(?:,[^:]{1,40})?:\s/;
  const timed = /(?:^|\s)[[(]?(?:\d{1,2}:)?\d{1,2}:\d{2}[\])]?(?:\s|$)/;
  return lines.filter((l) => speaker.test(l) || timed.test(l)).length;
}

/**
 * Whether text is plausibly the whole episode spoken: at least half the words
 * the episode's length implies (or 4,000 words when the length is unknown).
 * Without a "Transcript" heading it must also read like a conversation.
 */
export function looksLikeTranscript(
  text: string,
  durationSec?: number,
  underHeading = false,
): boolean {
  const words = wordCount(text);
  const minWords = durationSec ? Math.max(800, (durationSec / 60) * WORDS_PER_MINUTE * 0.5) : 4000;
  if (words < minWords) return false;
  if (underHeading) return true;
  return dialogueLines(text.split('\n')) >= Math.max(10, words / 2000);
}

const TRANSCRIPT_HEADING =
  /^(?:(?:full|episode|show|complete|read the|read the full|read full)\s+)?transcripts?\s*:?$/i;

/** The transcript on a page, or null when the page doesn't carry one. */
export function transcriptFromPage(html: string, durationSec?: number): string | null {
  const text = htmlToText(html);
  const lines = text.split('\n');
  // Prefer what follows a "Transcript" heading: it leaves out the show notes.
  // Pages often say "Transcript" more than once (a tab, a button, the heading),
  // so take the last one that still leaves a whole transcript after it.
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!TRANSCRIPT_HEADING.test(lines[i] ?? '')) continue;
    const rest = lines.slice(i + 1).join('\n');
    if (looksLikeTranscript(rest, durationSec, true)) return rest;
  }
  return looksLikeTranscript(text, durationSec) ? text : null;
}

function hostOf(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, '');
}

/**
 * Links on the page to this episode's transcript on the same site: the link
 * mentions "transcript" and its address carries the episode page's own slug
 * (lexfridman.com/larry-lawton → /larry-lawton-transcript). Transcripts of
 * other episodes, or on other sites, are never followed.
 */
export function sameSiteTranscriptLinks(html: string, pageUrl: string): string[] {
  let page: URL;
  try {
    page = new URL(pageUrl);
  } catch {
    return [];
  }
  const slug = page.pathname.split('/').filter(Boolean).pop()?.toLowerCase();
  if (!slug || slug.length < 4) return [];
  const out: string[] = [];
  for (const m of html.matchAll(
    /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi,
  )) {
    const href = decodeEntities(m[1] ?? '');
    if (!/transcript/i.test(href + (m[2] ?? ''))) continue;
    let url: URL;
    try {
      url = new URL(href, page);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
    if (hostOf(url) !== hostOf(page)) continue;
    if (url.pathname === page.pathname) continue; // an anchor on this same page
    if (!url.pathname.toLowerCase().includes(slug)) continue;
    url.hash = '';
    const s = url.toString();
    // "/x-transcript" and "/x-transcript/" are the same page.
    const same = (o: string) => o.replace(/\/$/, '') === s.replace(/\/$/, '');
    if (!out.some(same)) out.push(s);
  }
  return out.slice(0, 2);
}

/** NPR posts transcripts at /transcripts/<story id>; the episode page names the id. */
export function nprTranscriptUrl(pageUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return null;
  }
  if (!/(^|\.)npr\.org$/i.test(url.hostname)) return null;
  const m = /\/\d{4}\/\d{2}\/\d{2}\/(nx-s1-\d+|\d{6,})(?:\/|$)/.exec(url.pathname);
  return m ? `https://www.npr.org/transcripts/${m[1]}` : null;
}
