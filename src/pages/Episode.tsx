import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Digest, Episode as Ep, TranscriptResponse } from '../types';
import { fetchFeed, getDigest, pollTranscript, startTranscript } from '../net/api';
import { inLibrary, saveToLibrary, toggleLibrary } from '../lib/library';
import { addToPlaylist, inPlaylist } from '../lib/playlist';
import DigestView from '../components/DigestView';
import AskChat from '../components/AskChat';
import PasteTranscript from '../components/PasteTranscript';

type Phase = 'loading' | 'transcribing' | 'summarizing' | 'ready' | 'error';

interface EpisodeCtx {
  ep: Ep;
  showTitle: string;
  artwork?: string;
  feedUrl?: string;
}

const POLL_MS = 5000;
const MAX_POLLS = 48; // ~4 minutes

export default function Episode() {
  const [params] = useSearchParams();
  const feed = params.get('feed') ?? '';
  const guid = params.get('guid') ?? '';
  const audio = params.get('audio') ?? '';
  const pastedTitle = params.get('title') ?? 'Pasted audio';

  const [phase, setPhase] = useState<Phase>('loading');
  const [ctx, setCtx] = useState<EpisodeCtx | null>(null);
  const [transcript, setTranscript] = useState('');
  const [source, setSource] = useState<TranscriptResponse['source']>();
  const [digest, setDigest] = useState<Digest | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [queued, setQueued] = useState(false);
  // Each run() gets its own cancellation token, and starting a new run cancels
  // the previous one. Together with a mounted flag this makes re-runs safe — a
  // "Try again", or pasting a transcript while STT is still polling, can't let
  // the older run clobber state or surface a spurious error.
  const activeRun = useRef<{ cancelled: boolean } | null>(null);
  const mounted = useRef(true);

  const run = useCallback(
    async (opts?: { pasted?: string }) => {
      if (activeRun.current) activeRun.current.cancelled = true;
      const token = { cancelled: false };
      activeRun.current = token;
      const alive = () => mounted.current && !token.cancelled;
      setPhase('loading');
      setError('');
      setDigest(null);
      if (!opts?.pasted) setTranscript('');

      try {
        // 1) Resolve the episode.
        const resolved = await resolveEpisode({ feed, guid, audio, pastedTitle });
        if (!alive()) return;
        if (!resolved) {
          setError('Could not find that episode.');
          setPhase('error');
          return;
        }
        setCtx(resolved);
        setSaved(inLibrary(resolved.ep.guid));
        setQueued(inPlaylist(resolved.ep.guid));

        // 2) Transcript (pasted → cache → RSS transcript → STT).
        setPhase('transcribing');
        const text = await obtainTranscript(resolved.ep, () => !alive(), setSource, opts?.pasted);
        if (!alive()) return;
        if (!text) {
          setError(
            'No transcript available for this episode, and auto-transcription did not finish. Try again shortly, or paste the transcript yourself.',
          );
          setPhase('error');
          return;
        }
        setTranscript(text);

        // 3) Digest.
        setPhase('summarizing');
        const d = await getDigest({
          guid: resolved.ep.guid,
          transcript: text,
          showTitle: resolved.showTitle,
          episodeTitle: resolved.ep.title,
        });
        if (!alive()) return;
        setDigest(d);
        setPhase('ready');

        // Auto-save to the library so a processed episode is never lost. We only
        // save when we can reopen it later (feed + guid); the server caches the
        // transcript + digest for 30 days, so reopening never re-transcribes or
        // re-summarizes (no extra cost). Don't bump an existing entry's position.
        if (resolved.feedUrl && !inLibrary(resolved.ep.guid)) {
          saveToLibrary({
            guid: resolved.ep.guid,
            feedUrl: resolved.feedUrl,
            showTitle: resolved.showTitle,
            episodeTitle: resolved.ep.title,
            ...(resolved.artwork ? { artwork: resolved.artwork } : {}),
          });
          setSaved(true);
        }
      } catch (err) {
        if (!alive()) return;
        setError((err as Error).message);
        setPhase('error');
      }
    },
    [feed, guid, audio, pastedTitle],
  );

  useEffect(() => {
    mounted.current = true;
    run();
    // Stop any in-flight run from touching state after unmount / re-run.
    return () => {
      mounted.current = false;
    };
  }, [run]);

  const usePasted = useCallback((text: string) => run({ pasted: text }), [run]);

  function onQueue() {
    if (!ctx || !digest) return;
    addToPlaylist({
      guid: ctx.ep.guid,
      showTitle: ctx.showTitle,
      episodeTitle: ctx.ep.title,
      tldr: digest.tldr,
      bullets: digest.bullets,
      ...(ctx.feedUrl ? { feedUrl: ctx.feedUrl } : {}),
      ...(ctx.artwork ? { artwork: ctx.artwork } : {}),
    });
    setQueued(true);
  }

  function onToggleSave() {
    if (!ctx) return;
    const now = toggleLibrary({
      guid: ctx.ep.guid,
      feedUrl: ctx.feedUrl ?? '',
      showTitle: ctx.showTitle,
      episodeTitle: ctx.ep.title,
      ...(ctx.artwork ? { artwork: ctx.artwork } : {}),
    });
    setSaved(now);
  }

  return (
    <>
      <Link to={feed ? `/show?feed=${encodeURIComponent(feed)}` : '/'} className="back-link">
        ← {feed ? 'Episodes' : 'Home'}
      </Link>

      <div className="ep-head">
        <div className="show">{ctx?.showTitle}</div>
        <h1>{ctx?.ep.title ?? 'Loading…'}</h1>
        {ctx?.feedUrl && (
          <button className="btn subtle" onClick={onToggleSave} aria-pressed={saved}>
            {saved ? '♥ Saved' : '♡ Save to library'}
          </button>
        )}
      </div>

      {(phase === 'loading' || phase === 'transcribing' || phase === 'summarizing') && (
        <>
          <StatusPanel phase={phase} source={source} />
          {phase === 'transcribing' && source !== 'rss' && (
            <PasteTranscript
              onSubmit={usePasted}
              label="Have the transcript? Paste it to skip the wait →"
            />
          )}
        </>
      )}

      {phase === 'error' && (
        <>
          <div className="panel">
            <p className="error">{error}</p>
            <button className="btn" onClick={() => run()}>
              Try again
            </button>
          </div>
          <PasteTranscript onSubmit={usePasted} label="Paste the transcript instead" defaultOpen />
        </>
      )}

      {phase === 'ready' && digest && ctx && (
        <>
          {digest.demo && (
            <div className="panel" style={{ paddingTop: '0.7rem', paddingBottom: '0.7rem' }}>
              <span className="badge accent">demo mode</span>{' '}
              <span className="muted">
                Sample output — add an ANTHROPIC_API_KEY (and ASSEMBLYAI_API_KEY) to digest real
                episodes.
              </span>
            </div>
          )}
          <div className="ep-actions">
            <button className="btn subtle" onClick={onQueue} disabled={queued}>
              {queued ? '✓ In your queue' : '＋ Add to queue'}
            </button>
            {queued && (
              <Link to="/playlist" className="muted" style={{ fontSize: '0.88rem' }}>
                Open queue →
              </Link>
            )}
          </div>
          <DigestView digest={digest} sourceLabel={sourceLabel(source)} />
          {(source === 'demo' || source === 'stt') && (
            <PasteTranscript
              onSubmit={usePasted}
              label={
                source === 'demo'
                  ? 'Paste the real transcript for a real digest →'
                  : 'Auto-transcribed — paste the official transcript to improve it →'
              }
            />
          )}
          <AskChat
            transcript={transcript}
            guid={ctx.ep.guid}
            showTitle={ctx.showTitle}
            episodeTitle={ctx.ep.title}
          />
        </>
      )}
    </>
  );
}

function StatusPanel({ phase, source }: { phase: Phase; source?: TranscriptResponse['source'] }) {
  const label =
    phase === 'loading'
      ? 'Loading the episode…'
      : phase === 'transcribing'
        ? source === 'rss'
          ? 'Reading the published transcript…'
          : 'Transcribing the audio… this can take a minute for a long episode.'
        : 'Summarizing with Claude…';
  const stepClass = (i: number) => {
    const active = phase === 'loading' ? 0 : phase === 'transcribing' ? 1 : 2;
    if (i < active) return 'step done';
    if (i === active) return 'step active';
    return 'step';
  };
  return (
    <div className="panel">
      <div className="status">
        <span className="spinner" />
        <span>{label}</span>
      </div>
      <div className="progress-steps">
        <span className={stepClass(0)} />
        <span className={stepClass(1)} />
        <span className={stepClass(2)} />
      </div>
    </div>
  );
}

function sourceLabel(source: TranscriptResponse['source']): string {
  switch (source) {
    case 'rss':
      return 'from the show’s published transcript';
    case 'stt':
      return 'auto-transcribed from the audio';
    case 'pasted':
      return 'from a transcript you pasted';
    case 'cache':
      return 'from cache';
    case 'demo':
      return 'demo transcript';
    default:
      return '';
  }
}

// ---- helpers ----

async function resolveEpisode(p: {
  feed: string;
  guid: string;
  audio: string;
  pastedTitle: string;
}): Promise<EpisodeCtx | null> {
  if (p.feed && p.guid) {
    const data = await fetchFeed(p.feed);
    const ep = data.episodes.find((e) => e.guid === p.guid);
    if (!ep) return null;
    const out: EpisodeCtx = { ep, showTitle: data.show.title, feedUrl: p.feed };
    if (data.show.artwork) out.artwork = data.show.artwork;
    return out;
  }
  if (p.audio) {
    return {
      ep: { guid: p.guid || p.audio, title: p.pastedTitle, audioUrl: p.audio },
      showTitle: '',
    };
  }
  return null;
}

async function obtainTranscript(
  ep: Ep,
  isCancelled: () => boolean,
  setSource: (s: TranscriptResponse['source']) => void,
  pasted?: string,
): Promise<string | null> {
  const start = await startTranscript({
    guid: ep.guid,
    ...(pasted ? { transcript: pasted } : {}),
    ...(ep.audioUrl ? { audioUrl: ep.audioUrl } : {}),
    ...(ep.transcriptUrl ? { transcriptUrl: ep.transcriptUrl } : {}),
    ...(ep.transcriptType ? { transcriptType: ep.transcriptType } : {}),
  });
  if (start.status === 'ready' && start.text) {
    setSource(start.source);
    return start.text;
  }
  if (start.status === 'error') throw new Error(start.error ?? 'transcription failed');

  // Poll the running job.
  let jobId = start.jobId;
  for (let i = 0; i < MAX_POLLS; i++) {
    if (isCancelled()) return null;
    await sleep(POLL_MS);
    if (isCancelled()) return null;
    const r = await pollTranscript(ep.guid, jobId);
    if (r.status === 'ready' && r.text) {
      setSource(r.source);
      return r.text;
    }
    if (r.status === 'error') throw new Error(r.error ?? 'transcription failed');
    if (r.jobId) jobId = r.jobId;
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
