# Podcast Digest — Engineering Guide

A phone-installable PWA that turns a single podcast episode into something you
can **read, question, and listen to** in a fraction of the runtime. Search any
show (or paste a Pocket Casts / Apple / Spotify / RSS link), pick an episode, and get a
Claude-written TLDR, key points, outline, and verified quotes, a follow-up Q&A
chat, and an on-device read-aloud player.

---

## Mission

Get the substance of an episode without listening end-to-end. Especially for
important-but-thin topics where a 90-minute show has 8 minutes of signal. Calm,
reader-first, respectful of attention. No feeds, no engagement loops.

---

## Design language

### Mood

A **calm reader**. Warm paper and soft-dark, generous line-height, comfortable
reading measure. Restrained: one accent, lots of whitespace, no gradients or
arcade flourishes. iPhone-first, big tap targets, installable to the home
screen. It should feel like a well-set article, not a dashboard.

### Palette (see `src/styles/tokens.css`)

| Token         | Light     | Dark      | Use                                  |
| ------------- | --------- | --------- | ------------------------------------ |
| `--bg`        | `#f7f2ea` | `#1a1614` | App background (warm paper / cocoa)  |
| `--surface`   | `#fffdf9` | `#241f1c` | Cards, sheets                        |
| `--ink`       | `#241f1c` | `#f2ece4` | Primary text                         |
| `--ink-muted` | `#6f655c` | `#a99e93` | Secondary text, metadata             |
| `--accent`    | `#c25e34` | `#e68a5c` | Links, primary action, the drawn bar |
| `--hairline`  | `#e6ddd0` | `#392f2a` | Borders, dividers                    |

Both themes ship; the app follows `prefers-color-scheme` and a manual toggle.

### Typography

- **Reading** (digest body, answers): a serif stack (Georgia / `ui-serif`) at a
  comfortable size and line-height — this is the content people came for.
- **UI** (chrome, buttons, metadata): system sans.
- Numbers/timestamps use `font-variant-numeric: tabular-nums`.

### Visual rules

- Rounded cards (14px). Soft, sparing shadows.
- Minimum 44px touch targets.
- Respect `prefers-reduced-motion` (the Listen player highlights sentences;
  disable the scroll-follow when reduced motion is set).
- **No accounts, no gates.** The library is personal and lives in `localStorage`.
  The one exception is opt-in: overnight digests share the shows you *pick*
  for them with the server (it has to know what to check). Following a show
  never shares it. Off by default.
- No dark patterns, no fake urgency.

### Voice

Plain, warm, and brief. "Here's the gist." Not "Unlock insights!" The digest
itself must be faithful to the episode — never invent claims the transcript
doesn't support.

---

## Architecture

Vite + React + TypeScript PWA. Serverless logic
in `api/*.ts` (`@vercel/node`), deployed on Vercel (`vercel.json`).

### Data flow

```
search (iTunes) ─┐
paste a link ────┴─▶ resolve ─▶ RSS feed ─▶ pick episode
                                                 │
                       transcript ◀── a transcript you paste in  (free, instant, wins)
                                  ◀── RSS <podcast:transcript>  (free, instant)
                                  ◀── the show's website: episode page, a linked
                                      transcript page, NPR's /transcripts/<id>  (free)
                                  ◀── AssemblyAI STT of the audio URL  (fallback)
                       (kept as timed text: `[m:ss]` paragraph markers when the source has times)
                                                 │
                  Claude digest (TLDR + key points + topics + outline + quotes)
                                                 │
     read it · ask follow-ups (streamed, cited) · listen (on-device TTS) · jump into the audio

picked shows ──▶ nightly cron ─▶ new episodes ─▶ transcripts ─▶ Message Batch (½ price, OVERNIGHT_MODEL)
                                  app open ─▶ collect finished batch ─▶ "New overnight"
```

### Timed transcripts

A transcript is one string. When the source has timing (VTT, SRT, Podcasting
2.0 JSON, AssemblyAI, pasted text with timestamps), paragraphs start with a
`[m:ss]` / `[h:mm:ss]` marker (`src/lib/timed.ts`). Everything downstream reads
the times back out: the digest's outline starts (the model copies the marker;
the server drops times outside the transcript), quote times (located by
matching), and citation times (the cited character offset → the marker before
it). Untimed transcripts work exactly as before, just without time chips.
Timestamps come from the transcript, so on shows with dynamically inserted ads
a jump can land a little off.

### Where things live

- `src/lib/*` — **pure, unit-tested** logic shared by the browser and the API:
  `rss.ts` (feed parsing), `transcriptFormats.ts` (VTT/SRT/JSON → text, plain
  or timed), `timed.ts` (time markers), `pageTranscript.ts` (finding a
  transcript on an episode's web page, and telling it from show notes),
  `resolveUrl.ts` (link normalization), `digestPrompt.ts` (prompt + schema +
  grounding), `askAnswer.ts` (folding the cited answer stream into text +
  markers).
  These have **no** DOM or Node dependencies so they run in tests, the browser,
  and serverless functions alike.
- `src/net/api.ts` — the **only** browser module that calls `fetch`.
- `src/lib/library.ts` — personal library in `localStorage`. `following.ts`
  (shows you follow, filled by OPML import or the Follow button) and
  `playlist.ts` (the listen queue; items embed their digest text so playback is
  offline) follow the same pattern.
- `src/lib/opml.ts` — pure OPML subscription-list parser (Pocket Casts et al).
- `src/lib/tts.ts` + `src/components/ListenPlayer.tsx` — on-device read-aloud
  (0.5×–2×, speed persisted). `src/pages/Playlist.tsx` chains queue items
  back-to-back via the speaker's `onComplete`.
- `src/components/EpisodeAudio.tsx` — the episode's own audio; time chips
  (`TimeChip.tsx`) call its `seek()`, and it docks to the bottom once playing.
- `api/*.ts` — serverless endpoints (see below). `api/_lib/*` — `redis`,
  `anthropic`, `stt`, `transcripts` helpers, and `overnight.ts` (the overnight
  pipeline; every outside call goes through injected deps, so it's tested
  against fakes).

### API endpoints

| Route                     | Does                                                                 |
| ------------------------- | ------------------------------------------------------------------- |
| `GET /api/search?q=`      | iTunes Search proxy → shows (keyless).                               |
| `GET /api/feed?url=`      | Fetch + parse an RSS feed → show + episodes (avoids browser CORS).   |
| `POST /api/resolve`       | Normalize a pasted URL → `{ feedUrl, guid? }`.                       |
| `POST /api/transcript`    | Pasted transcript → cache-first → published transcript (feed files, then the show's website) → submit STT job. `GET` polls it. |
| `POST /api/digest`        | Cached transcript → Claude → `{ tldr, bullets, topics, outline, quotes }`. |
| `POST /api/ask`           | Streamed answer as NDJSON `AskEvent`s: text + cited transcript passages. |
| `GET/POST /api/overnight` | Overnight digests: status + picked shows + collect (GET), add/remove picked shows (POST), nightly run (GET from Vercel Cron with `CRON_SECRET`). |

### Graceful degradation ("demo mode")

Every server dependency is optional and detected at runtime (`redis()`
returns `null` when unconfigured):

- No `ANTHROPIC_API_KEY` → digest/ask return canned sample content.
- No `ASSEMBLYAI_API_KEY` → transcript falls back to a canned sample transcript.
- No Upstash env → nothing is cached (work is redone), but everything still runs.

This keeps the whole UI clickable — and end-to-end testable — with zero secrets.
Add real keys to light up real episodes.

---

## Coding conventions

### TypeScript
- Strict mode; `noUncheckedIndexedAccess`, `noImplicitOverride` on. No `any`.

### React
- Function components + hooks, one component per file, split past ~250 lines.
- `src/net/` is the only place that touches `fetch`.

### Claude usage (`api/_lib/anthropic.ts`)
- Official `@anthropic-ai/sdk` (1.x, API version `2026-10-21`). Model from
  `DIGEST_MODEL` env, default `claude-opus-5-5`. Model rules (which models take
  `effort` and `fallbacks`) live in `api/_lib/claudeConfig.ts`, unit-tested.
- **Thinking is always on** for current models; `output_config.effort` is the
  cost/latency dial (digest `medium`, Q&A `low`; `DIGEST_EFFORT` / `ASK_EFFORT`
  override). Never send `thinking: {type: "disabled"}`, a `budget_tokens`, or
  `temperature` — current models reject them. `max_tokens` must leave room for
  thinking. Read replies by block `type`, never `content[0]`.
- Digest uses **structured outputs** (`output_config.format` with
  `DIGEST_SCHEMA`). Bump `PROMPT_VERSION` in `src/lib/digestPrompt.ts` when the prompt
  or schema changes.
- **Refusals**: safety classifiers can decline (HTTP 200, `stop_reason:
  "refusal"`). Requests opt into server-side `fallbacks: "default"` where the
  model supports it; always check `stop_reason` before using the reply.
- Quotes are kept only if they appear **word for word** in the transcript
  (`groundQuotes`) — never show a line nobody said.
- Q&A sends the transcript as a **citations-enabled document**; answers stream
  with `citations_delta` passages. Citations and structured outputs can't be
  combined, so never add `output_config.format` to the ask request.
- Overnight digests use the **Message Batches API** (half price) on
  `OVERNIGHT_MODEL` (default `claude-haiku-5-5`), separate from the live
  `DIGEST_MODEL`. Batches don't take `fallbacks`; a declined overnight digest is
  just made live later.
- The **transcript is prompt-cached** (`cache_control`) so repeat Q&A over the
  same episode is cheap. Q&A is **streamed** to the client.
- The system prompt forbids inventing anything not supported by the transcript.
- Each call logs one `claude_usage` JSON line (tokens, cache hits) for the
  Vercel logs.

### Testing
- Vitest. The pure `src/lib/*` parsers carry the coverage (RSS shapes, transcript
  formats, URL resolution). Fixtures live beside the tests.
- `tests/anthropic.test.ts` stubs `fetch` and asserts the exact Claude request
  bodies (model, effort, schema, fallbacks, citations) — no key, no spend.
- `tests/overnight.test.ts` runs whole nights against an in-memory store and
  fake feeds/STT/batches.
- `npm run typecheck` covers `api/` too (`tsconfig.api.json`).

### Commits
- Conventional commits; commit after each meaningful step.

---

## What to push back on

- An account/login gate. The library is anonymous-first, `localStorage`-only.
- Summaries that editorialize or add claims the transcript doesn't support.
- Moving big audio files through the serverless function (transcode/upload) —
  the STT layer ingests the audio **by URL** on purpose. Keep it that way.
- Loosening the website transcript finder. Summarizing show notes, or another
  episode's transcript, is worse than paying to transcribe: a page counts only
  if it's long enough for the episode and reads like a conversation, and only
  same-site links carrying the episode's own slug are followed.
