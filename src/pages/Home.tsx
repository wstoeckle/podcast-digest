import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SearchResultShow } from '../types';
import { resolveLink, searchShows } from '../net/api';
import { readLibrary, removeFromLibrary, type LibraryItem } from '../lib/library';
import { importFollowing, readFollowing, unfollowShow, type FollowedShow } from '../lib/following';
import { parseOpml } from '../lib/opml';
import { hashId } from '../lib/rss';
import { formatDate } from '../lib/format';

type Mode = 'search' | 'paste';

export default function Home() {
  const nav = useNavigate();
  const [mode, setMode] = useState<Mode>('search');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [shows, setShows] = useState<SearchResultShow[] | null>(null);
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [following, setFollowing] = useState<FollowedShow[]>([]);
  const [importNote, setImportNote] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setLibrary(readLibrary());
    setFollowing(readFollowing());
  }, []);

  async function onOpmlFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    try {
      const shows = parseOpml(await file.text());
      if (shows.length === 0) {
        setImportNote('No podcasts found in that file — is it an OPML export?');
        return;
      }
      const added = importFollowing(shows);
      setFollowing(readFollowing());
      setImportNote(
        added === 0
          ? 'Already following everything in that file.'
          : `Imported ${added} show${added === 1 ? '' : 's'}.`,
      );
    } catch {
      setImportNote('Could not read that file.');
    }
  }

  function unfollow(feedUrl: string) {
    unfollowShow(feedUrl);
    setFollowing(readFollowing());
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = q.trim();
    if (!value || busy) return;
    setBusy(true);
    setError('');
    try {
      if (mode === 'search') {
        const { shows: found } = await searchShows(value);
        setShows(found);
        if (found.length === 0) setError('No shows found. Try a different search.');
      } else {
        const r = await resolveLink(value);
        if (r.error && !r.feedUrl && !r.audioUrl) {
          setError(r.error);
        } else if (r.feedUrl && r.guid) {
          nav(`/episode?feed=${encodeURIComponent(r.feedUrl)}&guid=${encodeURIComponent(r.guid)}`);
        } else if (r.feedUrl) {
          nav(`/show?feed=${encodeURIComponent(r.feedUrl)}`);
        } else if (r.audioUrl) {
          const guid = hashId(r.audioUrl);
          nav(
            `/episode?audio=${encodeURIComponent(r.audioUrl)}&guid=${encodeURIComponent(guid)}` +
              `&title=${encodeURIComponent('Pasted audio')}`,
          );
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function openShow(s: SearchResultShow) {
    nav(`/show?feed=${encodeURIComponent(s.feedUrl)}`);
  }

  function forget(guid: string) {
    removeFromLibrary(guid);
    setLibrary(readLibrary());
  }

  return (
    <>
      <section className="hero">
        <h1>Get the gist of any episode.</h1>
        <p>
          Pick a podcast episode and get a faithful TLDR and key points — then ask follow-ups or
          have it read aloud. No more 90 minutes for 8 minutes of signal.
        </p>

        <div className="tabs" role="tablist">
          <button
            className="tab"
            role="tab"
            aria-selected={mode === 'search'}
            onClick={() => setMode('search')}
          >
            Search
          </button>
          <button
            className="tab"
            role="tab"
            aria-selected={mode === 'paste'}
            onClick={() => setMode('paste')}
          >
            Paste a link
          </button>
        </div>

        <form className="search" onSubmit={submit}>
          <label className="field">
            <span className="lead" aria-hidden>
              {mode === 'search' ? '🔎' : '🔗'}
            </span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              inputMode={mode === 'paste' ? 'url' : 'search'}
              autoCapitalize="none"
              autoCorrect="off"
              placeholder={
                mode === 'search'
                  ? 'Search podcasts…'
                  : 'Paste an RSS, Apple, Spotify, or Pocket Casts link'
              }
            />
          </label>
          <button className="btn" disabled={busy || !q.trim()}>
            {busy ? '…' : mode === 'search' ? 'Search' : 'Open'}
          </button>
        </form>
        {mode === 'paste' && (
          <p className="muted" style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>
            Pocket Casts and Spotify episode links work too — we resolve them back to the show.
            (Spotify-exclusive shows have no public feed, so those can’t be opened.)
          </p>
        )}
        {error && <p className="error">{error}</p>}
      </section>

      {shows && shows.length > 0 && (
        <section>
          <h2 className="section-title">Shows</h2>
          <div className="card-list">
            {shows.map((s) => (
              <button key={s.id} className="card" onClick={() => openShow(s)}>
                {s.artwork ? (
                  <img className="art" src={s.artwork} alt="" loading="lazy" />
                ) : (
                  <span className="art" />
                )}
                <span className="body">
                  <span className="title">{s.title}</span>
                  <span className="meta">{s.author}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="section-title">Shows you follow</h2>
        {following.length > 0 && (
          <div className="card-list" style={{ marginBottom: '0.6rem' }}>
            {following.map((s) => (
              <div key={s.feedUrl} className="card" style={{ cursor: 'default' }}>
                {s.artwork ? (
                  <img className="art" src={s.artwork} alt="" loading="lazy" />
                ) : (
                  <span className="art" />
                )}
                <button
                  className="body"
                  style={{ background: 'none', border: 'none', textAlign: 'left', padding: 0 }}
                  onClick={() => nav(`/show?feed=${encodeURIComponent(s.feedUrl)}`)}
                >
                  <span className="title">{s.title}</span>
                </button>
                <button
                  className="icon-btn"
                  onClick={() => unfollow(s.feedUrl)}
                  aria-label={`Unfollow ${s.title}`}
                  title="Unfollow"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".opml,.xml,text/xml,text/x-opml"
          style={{ display: 'none' }}
          onChange={onOpmlFile}
        />
        <button className="btn ghost" onClick={() => fileRef.current?.click()}>
          Import shows (OPML)
        </button>
        <p className="muted" style={{ fontSize: '0.82rem', marginTop: '0.4rem' }}>
          Bring your subscriptions from Pocket Casts (Profile → Settings → Export Podcasts) or any
          podcast app that exports OPML.
        </p>
        {importNote && <p className="muted">{importNote}</p>}
      </section>

      <section>
        <h2 className="section-title">Your library</h2>
        {library.length === 0 ? (
          <p className="empty">
            Episodes you digest show up here — saved on this device only. Search for a show to get
            started.
          </p>
        ) : (
          <div className="card-list">
            {library.map((item) => (
              <div key={item.guid} className="card" style={{ cursor: 'default' }}>
                {item.artwork ? (
                  <img className="art" src={item.artwork} alt="" loading="lazy" />
                ) : (
                  <span className="art" />
                )}
                <button
                  className="body"
                  style={{ background: 'none', border: 'none', textAlign: 'left', padding: 0 }}
                  onClick={() =>
                    nav(
                      `/episode?feed=${encodeURIComponent(item.feedUrl)}&guid=${encodeURIComponent(
                        item.guid,
                      )}`,
                    )
                  }
                >
                  <span className="title">{item.episodeTitle}</span>
                  <span className="meta">
                    <span>{item.showTitle}</span>
                    <span>· saved {formatDate(new Date(item.addedAt).toISOString())}</span>
                  </span>
                </button>
                <button
                  className="icon-btn"
                  onClick={() => forget(item.guid)}
                  aria-label="Remove from library"
                  title="Remove from library"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
