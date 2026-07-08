// Dependency-free, tolerant RSS parser for podcast feeds. Runs in Node
// (serverless), the browser, and tests — so no DOMParser. It's regex-based,
// which is imperfect for arbitrary XML but reliable for the well-formed feeds
// podcast hosts emit. Extracts the channel header plus episodes, including
// enclosure audio URLs, itunes:duration, and Podcasting-2.0
// <podcast:transcript> tags.

import type { Episode, FeedResult, Show } from '../types';
import { parseDuration } from './format.js';

/** Small stable hash → base36, used for guids when a feed omits them. */
export function hashId(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&#x?0*2f;/gi, '/')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .trim();
}

/** Inner text of the first <tag>…</tag> within `scope`. */
function tagText(scope: string, tag: string): string | undefined {
  const re = new RegExp(`<${escapeTag(tag)}(?:\\s[^>]*)?>([\\s\\S]*?)</${escapeTag(tag)}>`, 'i');
  const m = re.exec(scope);
  return m ? decodeEntities(m[1] ?? '') : undefined;
}

/** Value of `attr` on the first `<tag …>` (handles self-closing tags). */
function tagAttr(scope: string, tag: string, attr: string): string | undefined {
  const re = new RegExp(`<${escapeTag(tag)}\\b([^>]*)>`, 'i');
  const m = re.exec(scope);
  if (!m) return undefined;
  const am = new RegExp(`${attr}\\s*=\\s*"([^"]*)"|${attr}\\s*=\\s*'([^']*)'`, 'i').exec(m[1] ?? '');
  if (!am) return undefined;
  return decodeEntities(am[1] ?? am[2] ?? '');
}

function escapeTag(tag: string): string {
  return tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function firstOf(scope: string, tags: string[]): string | undefined {
  for (const t of tags) {
    const v = tagText(scope, t);
    if (v) return v;
  }
  return undefined;
}

function parseItem(block: string): Episode | null {
  const title = firstOf(block, ['title']) ?? 'Untitled episode';
  const audioUrl = tagAttr(block, 'enclosure', 'url');
  const explicitGuid = firstOf(block, ['guid']);
  const guid = explicitGuid || (audioUrl ? hashId(audioUrl) : hashId(title));

  const ep: Episode = { guid, title };
  if (audioUrl) ep.audioUrl = audioUrl;

  const dur = parseDuration(firstOf(block, ['itunes:duration', 'duration']));
  if (dur !== undefined) ep.durationSec = dur;

  const pub = firstOf(block, ['pubDate', 'published', 'dc:date']);
  if (pub) {
    const d = new Date(pub);
    if (!Number.isNaN(d.getTime())) ep.publishedAt = d.toISOString();
  }

  const desc = firstOf(block, ['itunes:summary', 'description', 'itunes:subtitle']);
  if (desc) ep.description = stripHtml(desc);

  const tUrl = tagAttr(block, 'podcast:transcript', 'url');
  if (tUrl) {
    ep.transcriptUrl = tUrl;
    const tType = tagAttr(block, 'podcast:transcript', 'type');
    if (tType) ep.transcriptType = tType;
  }
  return ep;
}

export function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1') // tidy the space a stripped tag left before punctuation
    .trim();
}

/**
 * Parse a podcast RSS/XML string into a show header + episodes.
 * `feedUrl` is echoed onto the Show (the feed itself doesn't contain it).
 */
export function parseFeed(xml: string, feedUrl: string): FeedResult {
  const firstItem = xml.search(/<item[\s>]/i);
  const channel = firstItem >= 0 ? xml.slice(0, firstItem) : xml;

  const show: Show = {
    id: feedUrl,
    title: firstOf(channel, ['title']) ?? 'Untitled podcast',
    feedUrl,
  };
  const author = firstOf(channel, ['itunes:author', 'managingEditor', 'author']);
  if (author) show.author = author;
  const artwork =
    tagAttr(channel, 'itunes:image', 'href') ?? tagText(channel, 'url')?.trim() ?? undefined;
  if (artwork) show.artwork = artwork;
  const desc = firstOf(channel, ['description', 'itunes:summary']);
  if (desc) show.description = stripHtml(desc);

  const episodes: Episode[] = [];
  const itemRe = /<item[\s>][\s\S]*?<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null) {
    const ep = parseItem(m[0]);
    if (ep) episodes.push(ep);
  }
  return { show, episodes };
}
