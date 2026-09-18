# Podcast Digest

Turn a single podcast episode into something you can **read, question, and
listen to** in a fraction of the runtime.

- **Search** any podcast (free, keyless iTunes Search) or **paste a link** — an
  RSS feed, an Apple Podcasts URL, a **Pocket Casts** share link, a **Spotify**
  episode/show link, or a direct audio file. (Spotify exclusives have no public
  feed, so those can't be opened — true of any third-party app.)
- **Transcript**: uses the show's published transcript when the feed has one
  (Podcasting 2.0 `<podcast:transcript>`), otherwise **auto-transcribes** the
  audio via AssemblyAI (URL ingest — we never move the audio through the
  function).
- **Digest**: Claude writes a faithful TLDR + key points + topics, grounded
  strictly in the transcript.
- **Ask**: streamed follow-up Q&A over the same transcript (prompt-cached).
- **Listen**: on-device speech synthesis reads the digest aloud — offline, no
  key — at 0.5×–2× speed.
- **Listen queue**: stack digests and play them back to back — a 30-minute walk
  fits five or six. Queue items embed their text, so playback works offline.
- **Bring your shows**: import your subscriptions via OPML (Pocket Casts:
  Profile → Settings → Export Podcasts; most podcast apps export the same file).
- **Installable PWA**, iPhone-first. Your library, follows, and queue live in
  `localStorage` — no account.

See `CLAUDE.md` for the design language and architecture.

## Run locally

```bash
npm install
npm run dev                       # Vite dev server on http://localhost:5175
```

The Vite dev server serves the SPA. The `api/*` functions run on Vercel; to
exercise them locally use `vercel dev` (or deploy). **With no environment
variables set, the app runs in demo mode** — search works, and transcript /
digest / Q&A return canned sample content so the whole UI is clickable.

## Environment variables

All optional (see `.env.example`). Set them in your Vercel project (or
`.env.local`) to light up real episodes:

| Variable                                          | Enables                                             |
| ------------------------------------------------- | --------------------------------------------------- |
| `ANTHROPIC_API_KEY`                               | Real digests + Q&A (Claude).                        |
| `DIGEST_MODEL` (optional)                         | Model override; default `claude-opus-4-8`. Set `claude-haiku-4-5` for cheaper runs on long transcripts. |
| `ASSEMBLYAI_API_KEY`                              | Auto-transcription of episodes without a published transcript. |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Caching transcripts + digests, **and per-IP rate limiting** on the paid endpoints. |
| `RL_LLM_PER_HOUR` / `RL_STT_PER_HOUR` (optional) | Per-IP hourly caps for digest+Q&A / new transcriptions. Defaults 40 / 15. |
| `RL_LLM_GLOBAL_PER_HOUR` / `RL_STT_GLOBAL_PER_HOUR` (optional) | Whole-deployment hourly ceilings across all callers combined. Defaults 150 / 30. |

### Protecting your keys on a public URL

The API keys are server-only (never shipped to the browser), so they can't be
stolen — but the `/api/*` routes are open, so on a public deployment anyone who
finds the URL could run up your bill. Two mitigations ship here:

- **Rate limiting** (enabled automatically when Upstash is configured), metered
  right before the paid work so cache hits don't count: per-IP caps
  (`RL_LLM_PER_HOUR` / `RL_STT_PER_HOUR`) plus a whole-deployment global
  ceiling across all callers (`RL_LLM_GLOBAL_PER_HOUR` /
  `RL_STT_GLOBAL_PER_HOUR`) so many IPs can't multiply the per-IP budget.
  Oversized inputs (question, chat history, pasted transcripts) are clamped.
- Set a **hard budget cap in the Anthropic Console** (and AssemblyAI) as the
  backstop — this bounds worst-case spend no matter what.

For a fully private app, also enable Vercel's Deployment Protection (password /
SSO), which gates the site at the edge before any function runs.

## Deploy

Deployed as its **own** Vercel project (it has its own `vercel.json`). Point a
Vercel project at `apps/podcast-digest` as the root directory, add the env vars
above, and deploy.

## Self-hosting (bring your own keys)

The app is deliberately **self-contained and secrets-free**: there is nothing
in the code tied to any particular deployment, every key comes from environment
variables, and every key is optional (missing ones degrade to demo mode). To
run your own copy:

1. **Get the code** — fork/clone this repo (or copy this folder, see below).
2. **Create a Vercel project** with the app folder as the root directory. The
   included `vercel.json` handles the build, SPA rewrites, and function config.
3. **Add your own env vars** (see `.env.example` — each documents where to
   create the account/key): `ANTHROPIC_API_KEY`, `ASSEMBLYAI_API_KEY`,
   `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`.
4. **Protect your spend**: keep the built-in per-IP rate limits on (they're
   automatic with Upstash) and set hard budget caps in the Anthropic and
   AssemblyAI consoles.

Total cost at personal scale is small: Claude per digest (pennies; set
`DIGEST_MODEL=claude-haiku-4-5` to make it cheaper), AssemblyAI only for shows
without a published transcript (or paste one in — free), Upstash and Vercel
free tiers are plenty.

### History

This app started life inside a personal monorepo and was extracted here as a
standalone project. It is fully self-contained: `npm install` and every script
(`dev`, `test`, `lint`, `build`) work from this repo root.

## Scripts

| Command             | What                                        |
| ------------------- | ------------------------------------------- |
| `npm run dev`       | Vite dev server                             |
| `npm run build`     | Type-check + production build               |
| `npm run test`      | Vitest (pure parsers: RSS, transcript, URL) |
| `npm run lint`      | ESLint (`--max-warnings=0`)                 |
| `npm run typecheck` | `tsc -b --noEmit`                           |
| `npm run icons`     | Regenerate PWA icons                        |

## Interest-based listening plans (TypeSafe)

Open **For you**, enter your interests, choose a digest-listening time and speed, and
build a plan. Preview it before replacing the listen queue. TypeSafe scores interest
fit and novelty against up to ten recent listens; deterministic code selects whole
saved digests that fit the estimated time. Changing time/speed reuses the scores.
The estimate uses the existing 170-words/minute TTS model, not full episode runtimes.

Non-demo digests are remembered locally as they are generated (up to 100); existing
queue items are included. Older library metadata has no summary: reopen those episodes
once. Completion of episode/queue TTS and **Already heard this** record local history;
opening or skipping an episode does not. **Forget listening history** makes them eligible
again. No account is required. Interests and summaries leave the device only when
**Build listening plan** is clicked; only the selected summaries, titles, interests,
and recent summary history go to TypeSafe, not audio, feeds, or transcripts.

Set server-only `TYPESAFE_API_KEY`; optional `TYPESAFE_MODEL` defaults to `jev-latest`.
Use `vercel dev` to run the serverless API locally. Never prefix the key with `VITE_`. Missing credentials/errors leave the existing queue intact.
The recommend endpoint uses the existing per-IP/global LLM rate-limit configuration
(Upstash required for deployed enforcement), a 100KB payload limit, max 20 candidates,
and max 10 history entries. Paid calls are mocked in tests. Ranking weights (.7 interest,
.3 novelty) and minimum relevance (1.5/3), and minimum novelty (.75/3) are initial product heuristics, not accuracy
claims. Suggestions are based on summaries, so they cannot recover omitted nuances.
