# Podcast Digest

Turn a single podcast episode into something you can **read, question, and
listen to** in a fraction of the runtime.

- **Search** any podcast (free, keyless iTunes Search) or **paste a link** — an
  RSS feed, an Apple Podcasts URL, a **Pocket Casts** share link, a **Spotify**
  episode/show link, or a direct audio file. (Spotify exclusives have no public
  feed, so those can't be opened — true of any third-party app.)
- **Transcript**: looks for one the show already published before paying to
  transcribe: every `<podcast:transcript>` file in the feed (Podcasting 2.0),
  then the episode's web page, a transcript page it links to on the same site
  (Lex Fridman), or NPR's transcript page. Only if none turns up does it
  **auto-transcribe** the audio via AssemblyAI (URL ingest — we never move the
  audio through the function). A web page only counts when it's long enough
  for the episode and reads like a conversation (or sits under a "Transcript"
  heading), so show notes never get summarized as if they were the episode.
- **Digest**: Claude writes a faithful TLDR, key points, topics, an episode
  outline, and short quotes (shown only if they appear word for word in the
  transcript), grounded
  strictly in the transcript.
- **Jump into the audio**: when the transcript has times, outline segments and
  quotes carry a timestamp that plays the episode from there.
- **Ask**: streamed follow-up Q&A over the same transcript (prompt-cached).
  Each answer shows the exact transcript lines it's based on, with their times.
- **Listen**: on-device speech synthesis reads the digest aloud — offline, no
  key — at 0.5×–2× speed.
- **Listen queue**: stack digests and play them back to back — a 30-minute walk
  fits five or six. Queue items embed their text, so playback works offline.
- **Bring your shows**: import your subscriptions via OPML (Pocket Casts:
  Profile → Settings → Export Podcasts; most podcast apps export the same file).
- **Overnight digests** (opt-in): new episodes of the shows you pick are
  digested each night, so they're waiting when you open the app.
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
| `DIGEST_MODEL` (optional)                         | Model override; default `claude-opus-5-5`. Set `claude-haiku-5-5` for much cheaper runs. |
| `DIGEST_EFFORT` / `ASK_EFFORT` (optional)         | How hard Claude thinks: `low`, `medium`, `high`, `xhigh`, `max`. Defaults `medium` (digest) / `low` (Q&A). Lower is faster and cheaper. |
| `ASSEMBLYAI_API_KEY`                              | Auto-transcription of episodes without a published transcript. |
| `ASSEMBLYAI_SPEECH_MODEL` (optional)              | AssemblyAI model; default `universal-2` ($0.15/hr). Set `assemblyai-stt-3-7` for AssemblyAI's newest, most accurate model ($0.21/hr). |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Caching transcripts + digests, **and per-IP rate limiting** on the paid endpoints. Vercel's `KV_REST_API_URL` / `KV_REST_API_TOKEN` work too (Storage → Create Database → Upstash sets those). If the database can't be reached, the app keeps working without it (no cache or limits) and logs `redis_unavailable`. |
| `RL_LLM_PER_HOUR` / `RL_STT_PER_HOUR` (optional) | Per-IP hourly caps for digest+Q&A / new transcriptions. Defaults 40 / 15. |
| `RL_LLM_GLOBAL_PER_HOUR` / `RL_STT_GLOBAL_PER_HOUR` (optional) | Whole-deployment hourly ceilings across all callers combined. Defaults 150 / 30. |
| `OWNER_CODE` (recommended on a shared URL)        | Keeps the keys above for you: only devices that enter this code in Settings spend them. Everyone else brings their own keys (see [Sharing with friends](#sharing-with-friends)). Any long random string. Without it, everyone with the URL uses your keys. |
| `CRON_SECRET`                                     | Turns on the nightly overnight-digest run (Vercel Cron sends it). Any long random string. |
| `OVERNIGHT_MODEL` (optional)                      | Model for overnight digests; default `claude-haiku-5-5` (a fraction of a cent each). Digests you open yourself still use `DIGEST_MODEL`. |
| `OVERNIGHT_MAX_EPISODES` / `OVERNIGHT_MAX_TRANSCRIBE` (optional) | Per-night caps: episodes digested, and how many of those may be transcribed from audio. Defaults 8 / 4 (`0` = published transcripts only). |

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

## Sharing with friends

Two ways, and neither bills you:

**On your URL, with their own keys.** Set `OWNER_CODE` in Vercel and redeploy,
then on each of your devices open **Settings** (⚙ at the top) and enter the
code once. From then on only your devices spend the app's keys. A friend opens
the same URL, goes to Settings and pastes their own Anthropic API key (and,
optionally, an AssemblyAI key for episodes with no published transcript).

- Their keys stay in their browser. The app sends them with each request in
  headers; the server uses them for that request and never stores or logs them.
  Friends do have to trust your server with their key while it passes through.
- Digests are shared: an episode anyone has already digested is free and
  instant for the next person. Nothing personal is in them; libraries,
  follows and Q&A stay on each device.
- Overnight digests and listening plans run on your accounts, so they're yours
  only.
- Without `OWNER_CODE`, everyone with the URL uses your keys, limited only by
  the rate limits above.

**Their own copy.** For friends who want everything separate (their own
overnight digests, their own bill), this deploys a fresh copy to their Vercel
account, asking for their Anthropic key on the way:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fwstoeckle%2Fpodcast-digest&project-name=podcast-digest&env=ANTHROPIC_API_KEY&envDescription=Your%20Anthropic%20API%20key%2C%20for%20digests%20and%20questions&envLink=https%3A%2F%2Fplatform.claude.com%2Fsettings%2Fkeys)

They can add `ASSEMBLYAI_API_KEY` and a Redis database (Storage → Create
Database → Upstash) afterwards, as in [Self-hosting](#self-hosting-bring-your-own-keys).

## Overnight digests

Turn them on from the home page, then tick the shows you want under **Shows to
digest overnight**. Following a show doesn't add it; only ticked shows are sent
to the server, and the picks are the same on every device. Each night (09:00
UTC, set in `vercel.json`) the server checks those shows for episodes published
since the last run, gets their transcripts (published ones first, from the
feed or the show's website, then AssemblyAI up to the cap), and submits one Message Batch of digests at half
price. When you next open the app, finished digests are collected and listed
under **New overnight**; opening one is instant and costs nothing more.

Needs Upstash Redis, `ANTHROPIC_API_KEY`, and `CRON_SECRET`. To try it without
waiting for the night, use **Run** on the cron job in the Vercel dashboard
(Settings → Cron Jobs).

Cost with the defaults is bounded and small. Overnight digests use
`OVERNIGHT_MODEL` (Claude Haiku 5.5): about 0.2¢ per hour-long episode at batch
prices, so 8 a night is about 1–2¢. The larger cost is transcription: up to 4
AssemblyAI jobs a night, at roughly $0.15–0.25 per audio hour. Set
`OVERNIGHT_MAX_TRANSCRIBE=0` to digest only episodes that come with a published
transcript, which makes the whole run cost a few cents a night. Overnight
digests are what you see when you open those episodes, so they are Haiku
digests, not Opus.

## Deploy

Deployed as its **own** Vercel project (it has its own `vercel.json`). Point a
Vercel project at this repo's root, add the env vars
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
   `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` (or create an Upstash
   database from the project's Storage tab, which sets `KV_REST_API_*`).
4. **Protect your spend**: keep the built-in per-IP rate limits on (they're
   automatic with Upstash) and set hard budget caps in the Anthropic and
   AssemblyAI consoles.

Total cost at personal scale is small: Claude per digest (an estimated 5–15¢
for an hour-long episode on the default Claude Opus 5.5, under a cent with
`DIGEST_MODEL=claude-haiku-5-5`; each call logs its token use), AssemblyAI
(about $0.17 per audio hour with speaker labels) only for episodes without a
published transcript in the feed or on the show's website (or paste one in —
free). Upstash and Vercel free tiers are plenty.

**Claude Max, Ultra and Team plans include monthly Claude API credits** ($100,
$200, and up to $500 pooled). Claim them on claude.ai under Settings → Billing
→ API credits, linking the Console organization your `ANTHROPIC_API_KEY`
belongs to, and they pay for this app's digests and Q&A. A plan links to one
organization and only support can change it, so pick that one. Pro plans
don't include API credits; see
https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers.

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
