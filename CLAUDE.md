# Podcast Digest — Engineering Guide

A phone-installable PWA that turns a single podcast episode into something you
can **read, question, and listen to** in a fraction of the runtime. Search any
show (or paste a Pocket Casts / Apple / Spotify / RSS link), pick an episode, and get a
Claude-written TLDR + key points, a follow-up Q&A chat, and an on-device
read-aloud player.

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
                                  ◀── AssemblyAI STT of the audio URL  (fallback)
                                                 │
                                    Claude digest (TLDR + key points + topics)
                                                 │
                              read it · ask follow-ups (streamed) · listen (on-device TTS)
```

### Where things live

- `src/lib/*` — **pure, unit-tested** logic shared by the browser and the API:
  `rss.ts` (feed parsing), `transcriptFormats.ts` (VTT/SRT/JSON → text),
  `resolveUrl.ts` (link normalization), `digestPrompt.ts` (prompt + schema).
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
- `api/*.ts` — serverless endpoints (see below). `api/_lib/*` — `redis`,
  `anthropic`, `stt` helpers.

### API endpoints

| Route                     | Does                                                                 |
| ------------------------- | ------------------------------------------------------------------- |
| `GET /api/search?q=`      | iTunes Search proxy → shows (keyless).                               |
| `GET /api/feed?url=`      | Fetch + parse an RSS feed → show + episodes (avoids browser CORS).   |
| `POST /api/resolve`       | Normalize a pasted URL → `{ feedUrl, guid? }`.                       |
| `POST /api/transcript`    | Pasted transcript → cache-first → RSS transcript → submit STT job. `GET` polls it. |
| `POST /api/digest`        | Cached transcript → Claude → `{ tldr, bullets, topics }`.            |
| `POST /api/ask`           | Streamed Claude answer over the transcript (prompt-cached).          |

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
- Official `@anthropic-ai/sdk`. Model from `DIGEST_MODEL` env, default
  `claude-opus-4-8`.
- Digest uses structured outputs (`output_config.format`).
- The **transcript is prompt-cached** (`cache_control`) so repeat Q&A over the
  same episode is cheap. Q&A is **streamed** to the client.
- The system prompt forbids inventing anything not supported by the transcript.

### Testing
- Vitest. The pure `src/lib/*` parsers carry the coverage (RSS shapes, transcript
  formats, URL resolution). Fixtures live beside the tests.

### Commits
- Conventional commits; commit after each meaningful step.

---

## What to push back on

- An account/login gate. The library is anonymous-first, `localStorage`-only.
- Summaries that editorialize or add claims the transcript doesn't support.
- Moving big audio files through the serverless function (transcode/upload) —
  the STT layer ingests the audio **by URL** on purpose. Keep it that way.
