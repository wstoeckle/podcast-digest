import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { recommendDigests } from '../net/api';
import {
  candidate,
  chooseQueue,
  clearListeningHistory,
  markHeard,
  readDigests,
  readInterests,
  saveInterests,
  type RecommendationResult,
} from '../lib/listening';
import { digestSpeechText, estimateListenSec, replacePlaylist } from '../lib/playlist';
import { RATES, readRate, saveRate } from '../lib/tts';
import { formatDuration } from '../lib/format';

export default function ForYou() {
  const nav = useNavigate();
  const [items, setItems] = useState(readDigests);
  const [interests, setInterests] = useState(readInterests);
  const [minutes, setMinutes] = useState(20);
  const [rate, setRate] = useState(readRate);
  const [result, setResult] = useState<RecommendationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const revision = useRef(0);
  const candidates = items.filter((d) => !d.heardAt).slice(0, 20);
  const history = items
    .filter((d) => d.heardAt)
    .sort((a, b) => (b.heardAt ?? 0) - (a.heardAt ?? 0))
    .slice(0, 10);
  const queue = result ? chooseQueue(candidates, result.ranks, minutes, rate) : [];
  const seconds = queue.reduce(
    (sum, d) => sum + Math.max(1, estimateListenSec(digestSpeechText(d), rate)),
    0,
  );
  function invalidate() {
    revision.current++;
    setResult(null);
    setError('');
  }
  async function recommend(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    const version = ++revision.current;
    saveInterests(interests);
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const ranked = await recommendDigests({
        interests,
        candidates: candidates.map(candidate),
        history: history.map(candidate),
      });
      if (revision.current === version) setResult(ranked);
    } catch (err) {
      if (revision.current === version)
        setError(err instanceof Error ? err.message : 'Could not build a plan.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Link to="/" className="back-link">
        ← Home
      </Link>
      <div className="ep-head">
        <h1>A listening plan for you</h1>
        <p className="muted">A little time, spent on the ideas you care about.</p>
      </div>
      <form className="panel listening-form" onSubmit={recommend}>
        <label htmlFor="interests">What are you interested in right now?</label>
        <textarea
          id="interests"
          value={interests}
          maxLength={2000}
          required
          rows={3}
          placeholder="e.g. Building useful AI products, climate technology, and thoughtful interviews about writing."
          onChange={(e) => {
            setInterests(e.target.value);
            invalidate();
          }}
        />
        <div className="listening-controls">
          <label>
            Time{' '}
            <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
              {[5, 10, 20, 30, 45].map((m) => (
                <option key={m} value={m}>
                  {m} minutes
                </option>
              ))}
            </select>
          </label>
          <label>
            Speed{' '}
            <select value={rate} onChange={(e) => setRate(Number(e.target.value))}>
              {RATES.map((r) => (
                <option key={r} value={r}>
                  {r}×
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="muted">
          Build sends your interests, up to 20 saved digests, and your 10 most recently heard
          digests to TypeSafe. Playback stays on your device. Times estimate spoken digests, not
          full episodes.
        </p>
        <button className="btn" disabled={busy || !candidates.length || !interests.trim()}>
          {busy ? 'Finding your next listen…' : 'Build listening plan'}
        </button>
        <p className="muted" role="status">
          {candidates.length} available · {history.length} recent listens included
        </p>
        {error && <p role="alert">{error}</p>}
      </form>
      {!candidates.length && (
        <p className="empty">
          Create a digest from an episode first. New digests and your existing listen queue appear
          here automatically; older library entries need to be reopened once.
        </p>
      )}
      {result && (
        <section className="panel" aria-live="polite">
          <h2>{queue.length ? `Your ${minutes}-minute plan` : 'No strong matches that fit yet'}</h2>
          <p className="muted">
            {queue.length
              ? `${queue.length} digests · about ${formatDuration(seconds) || 'a minute'} at ${rate}×. Ordered by interest fit and new information.`
              : 'Try different interests, more time, or save another digest.'}
          </p>
          <p className="muted">
            Suggestions use saved summaries and may miss nuance. Adjust time or speed to refit this
            plan without another model call.
          </p>
          {queue.map((d) => {
            const rank = result.ranks.find((r) => r.guid === d.guid)!;
            return (
              <article key={d.guid} className="listening-pick">
                <h3>{d.episodeTitle}</h3>
                <p className="muted">
                  {d.showTitle} · ≈
                  {formatDuration(estimateListenSec(digestSpeechText(d), rate)) || 'a minute'} ·{' '}
                  {rank.relevance >= 2.5 ? 'Strong interest match' : 'Interest match'}
                  {history.length
                    ? rank.novelty >= 2
                      ? ' · Adds new information'
                      : ' · Some familiar ground'
                    : ''}
                </p>
                <p>{d.tldr}</p>
                <button
                  className="btn subtle"
                  onClick={() => {
                    markHeard(d);
                    setItems(readDigests());
                    invalidate();
                  }}
                >
                  Already heard this
                </button>
              </article>
            );
          })}
          {queue.length > 0 && (
            <button
              className="btn"
              onClick={() => {
                replacePlaylist(queue);
                saveRate(rate);
                nav('/playlist');
              }}
            >
              Replace listen queue with this plan
            </button>
          )}
        </section>
      )}
      {history.length > 0 && (
        <button
          className="btn subtle"
          onClick={() => {
            clearListeningHistory();
            setItems(readDigests());
            invalidate();
          }}
        >
          Forget listening history
        </button>
      )}
      <p className="muted">
        History records completed digest playback and “Already heard this.” It does not infer that
        you listened just because you opened an episode.
      </p>
    </>
  );
}
