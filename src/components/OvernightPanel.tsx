import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { OvernightStatus } from '../types';
import type { FollowedShow } from '../lib/following';
import { getOvernight, syncOvernight } from '../net/api';
import { isOvernightOn, setOvernightOn } from '../lib/overnight';
import { formatDate } from '../lib/format';

/**
 * Overnight digests: new episodes of followed shows, digested while you sleep.
 * Off by default; turning it on shares the followed-shows list with the server.
 */
export default function OvernightPanel({ following }: { following: FollowedShow[] }) {
  const nav = useNavigate();
  const [on, setOn] = useState(isOvernightOn);
  const [status, setStatus] = useState<OvernightStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // While on: keep the server's list in step with this device's follows, then
  // load the latest (which also collects digests that finished overnight).
  useEffect(() => {
    if (!on) return;
    let live = true;
    const shows = following.map(({ feedUrl, title, artwork }) =>
      artwork ? { feedUrl, title, artwork } : { feedUrl, title },
    );
    (async () => {
      try {
        if (shows.length) await syncOvernight({ action: 'add', shows });
        const s = await getOvernight();
        if (live) setStatus(s);
      } catch (err) {
        if (live) setError((err as Error).message);
      }
    })();
    return () => {
      live = false;
    };
  }, [on, following]);

  function turnOn() {
    setOvernightOn(true);
    setError('');
    setOn(true);
  }

  async function turnOff() {
    setBusy(true);
    try {
      await syncOvernight({ action: 'clear' });
    } catch {
      /* turning off locally still stops future syncs */
    }
    setOvernightOn(false);
    setOn(false);
    setStatus(null);
    setBusy(false);
  }

  if (!on) {
    return (
      <section>
        <h2 className="section-title">Overnight digests</h2>
        <div className="panel">
          <p style={{ marginTop: 0 }}>
            New episodes of the shows you follow, digested while you sleep — ready when you open the
            app, at half the usual cost.
          </p>
          <p className="muted small">
            Turning this on shares the list of shows you follow with the server, so it knows what to
            check. Your library and listening stay on this device.
          </p>
          <button className="btn ghost" onClick={turnOn} disabled={following.length === 0}>
            Turn on overnight digests
          </button>
          {following.length === 0 && <p className="muted small">Follow a show first.</p>}
        </div>
      </section>
    );
  }

  const items = status?.items ?? [];
  return (
    <section>
      <h2 className="section-title">New overnight</h2>
      {status && !status.available && <p className="muted">{status.reason}</p>}
      {status?.available && !status.scheduled && (
        <p className="muted small">
          The nightly run isn’t scheduled yet: set <code>CRON_SECRET</code> in the server’s
          environment.
        </p>
      )}
      {items.length > 0 ? (
        <div className="card-list">
          {items.map((item) => (
            <button
              key={item.guid}
              className="card"
              onClick={() =>
                nav(
                  `/episode?feed=${encodeURIComponent(item.feedUrl)}&guid=${encodeURIComponent(item.guid)}`,
                )
              }
            >
              {item.artwork ? (
                <img className="art" src={item.artwork} alt="" loading="lazy" />
              ) : (
                <span className="art" />
              )}
              <span className="body">
                <span className="title">{item.episodeTitle}</span>
                <span className="meta">
                  <span>{item.showTitle}</span>
                  {item.publishedAt && <span>· {formatDate(item.publishedAt)}</span>}
                </span>
                <span className="snippet">{item.tldr}</span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        status?.available && (
          <p className="empty">
            Nothing yet. New episodes show up here the morning after they come out.
          </p>
        )
      )}
      {error && <p className="error">{error}</p>}
      <p className="muted small">
        {status?.available
          ? `Checking ${status.following} show${status.following === 1 ? '' : 's'} each night` +
            (status.pending ? ` · ${status.pending} on the way` : '') +
            (status.lastRunAt
              ? ` · last run ${formatDate(new Date(status.lastRunAt).toISOString())}`
              : '') +
            '. '
          : ''}
        <button className="link-btn" onClick={turnOff} disabled={busy}>
          Turn off
        </button>
      </p>
    </section>
  );
}
