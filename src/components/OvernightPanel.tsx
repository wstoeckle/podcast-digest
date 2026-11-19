import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { OvernightShow, OvernightStatus } from '../types';
import type { FollowedShow } from '../lib/following';
import { getOvernight, syncOvernight } from '../net/api';
import {
  feedKey,
  isOvernightOn,
  pickerRows,
  setOvernightOn,
  type PickerRow,
} from '../lib/overnight';
import { formatDate } from '../lib/format';
import OvernightShowPicker from './OvernightShowPicker';

/**
 * Overnight digests: new episodes of the shows you pick, digested while you
 * sleep. Off by default; only the picked shows are shared with the server.
 */
export default function OvernightPanel({ following }: { following: FollowedShow[] }) {
  const nav = useNavigate();
  const [on, setOn] = useState(isOvernightOn);
  const [status, setStatus] = useState<OvernightStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set());

  // While on, load the picks and the latest digests (this also collects
  // digests that finished overnight).
  useEffect(() => {
    if (!on) return;
    let live = true;
    getOvernight()
      .then((s) => live && setStatus(s))
      .catch((err: Error) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, [on]);

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
      /* turning off locally still stops this device from adding picks */
    }
    setOvernightOn(false);
    setOn(false);
    setStatus(null);
    setBusy(false);
  }

  async function toggle(row: PickerRow, chosen: boolean) {
    if (!status) return;
    const key = feedKey(row.feedUrl);
    const before = status.shows;
    const show: OvernightShow = row.artwork
      ? { feedUrl: row.feedUrl, title: row.title, artwork: row.artwork }
      : { feedUrl: row.feedUrl, title: row.title };
    // Show the change straight away; the server's answer replaces it.
    setStatus({
      ...status,
      shows: chosen ? [...before, show] : before.filter((s) => feedKey(s.feedUrl) !== key),
    });
    setPending((p) => new Set(p).add(row.feedUrl));
    setError('');
    try {
      const next = await syncOvernight(
        chosen ? { action: 'add', shows: [show] } : { action: 'remove', feedUrls: [row.feedUrl] },
      );
      setStatus(next);
    } catch (err) {
      setStatus((s) => (s ? { ...s, shows: before } : s));
      setError((err as Error).message);
    } finally {
      setPending((p) => {
        const n = new Set(p);
        n.delete(row.feedUrl);
        return n;
      });
    }
  }

  if (!on) {
    return (
      <section>
        <h2 className="section-title">Overnight digests</h2>
        <div className="panel">
          <p style={{ marginTop: 0 }}>
            New episodes of the shows you pick, digested while you sleep — ready when you open the
            app.
          </p>
          <p className="muted small">
            You choose which shows. Only those are shared with the server, so it knows what to
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
  const picked = status?.shows.length ?? 0;
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
        status?.available &&
        picked > 0 && (
          <p className="empty">
            Nothing yet. New episodes show up here the morning after they come out.
          </p>
        )
      )}
      {status?.available && (
        <OvernightShowPicker
          rows={pickerRows(following, status.shows)}
          pending={pending}
          onToggle={toggle}
        />
      )}
      {error && <p className="error">{error}</p>}
      <p className="muted small">
        {status?.available && picked > 0
          ? `Checking ${picked} show${picked === 1 ? '' : 's'} each night` +
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
