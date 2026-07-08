import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { FeedResult } from '../types';
import { fetchFeed } from '../net/api';
import { isFollowing, toggleFollow } from '../lib/following';
import { formatDate, formatDuration } from '../lib/format';

export default function Show() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const feedUrl = params.get('feed') ?? '';
  const [data, setData] = useState<FeedResult | null>(null);
  const [error, setError] = useState('');
  const [followed, setFollowed] = useState(() => isFollowing(feedUrl));

  function onToggleFollow() {
    if (!data) return;
    setFollowed(
      toggleFollow({
        feedUrl,
        title: data.show.title,
        ...(data.show.artwork ? { artwork: data.show.artwork } : {}),
      }),
    );
  }

  useEffect(() => setFollowed(isFollowing(feedUrl)), [feedUrl]);

  useEffect(() => {
    if (!feedUrl) {
      setError('No feed specified.');
      return;
    }
    let live = true;
    setData(null);
    setError('');
    fetchFeed(feedUrl)
      .then((d) => live && setData(d))
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [feedUrl]);

  function open(guid: string) {
    nav(`/episode?feed=${encodeURIComponent(feedUrl)}&guid=${encodeURIComponent(guid)}`);
  }

  return (
    <>
      <Link to="/" className="back-link">
        ← Home
      </Link>

      {error && <p className="error">{error}</p>}

      {!data && !error && (
        <div className="card-list" aria-hidden>
          {Array.from({ length: 5 }).map((_, i) => (
            <div className="skeleton" key={i} />
          ))}
        </div>
      )}

      {data && (
        <>
          <div className="ep-head">
            <div className="card" style={{ cursor: 'default' }}>
              {data.show.artwork ? (
                <img className="art" src={data.show.artwork} alt="" />
              ) : (
                <span className="art" />
              )}
              <span className="body">
                <span className="title" style={{ WebkitLineClamp: 3 }}>
                  {data.show.title}
                </span>
                <span className="meta">{data.show.author}</span>
              </span>
            </div>
            <button
              className="btn subtle"
              style={{ marginTop: '0.6rem' }}
              onClick={onToggleFollow}
              aria-pressed={followed}
            >
              {followed ? '♥ Following' : '♡ Follow'}
            </button>
          </div>

          <h2 className="section-title">
            {data.episodes.length} episode{data.episodes.length === 1 ? '' : 's'}
          </h2>
          <div className="card-list">
            {data.episodes.map((ep) => (
              <button key={ep.guid} className="card" onClick={() => open(ep.guid)}>
                <span className="body">
                  <span className="title">{ep.title}</span>
                  <span className="meta">
                    {ep.publishedAt && <span>{formatDate(ep.publishedAt)}</span>}
                    {ep.durationSec ? <span>{formatDuration(ep.durationSec)}</span> : null}
                    {ep.transcriptUrl && <span className="badge good">transcript</span>}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}
