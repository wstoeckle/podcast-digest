import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  clearPlaylist,
  digestSpeechText,
  estimateListenSec,
  movePlaylistItem,
  readPlaylist,
  removeFromPlaylist,
  type PlaylistItem,
} from '../lib/playlist';
import { formatDuration } from '../lib/format';
import {
  RATES,
  SentenceSpeaker,
  isTtsSupported,
  readRate,
  saveRate,
  splitSentences,
  type SpeakerState,
} from '../lib/tts';

// The listen queue: digests stacked up and spoken back to back. Playback is
// fully on-device (the digest text is embedded in each queue item), so a
// loaded-up queue works on a walk with no signal.

export default function Playlist() {
  const nav = useNavigate();
  const supported = isTtsSupported();
  const [items, setItems] = useState<PlaylistItem[]>(() => readPlaylist());
  const [current, setCurrent] = useState(-1); // index into items; -1 = nothing active
  const [state, setState] = useState<SpeakerState>('idle');
  const [sentence, setSentence] = useState('');
  const [rate, setRate] = useState(() => readRate());
  const speakerRef = useRef<SentenceSpeaker | null>(null);
  // The effect-scoped speaker calls back into the latest playAt via this ref,
  // so auto-advance always sees the current queue + rate.
  const advanceRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!supported) return;
    const sp = new SentenceSpeaker();
    sp.onState = setState;
    sp.onComplete = () => advanceRef.current();
    speakerRef.current = sp;
    return () => sp.stop();
  }, [supported]);

  const totalSec = useMemo(
    () => items.reduce((sum, it) => sum + estimateListenSec(digestSpeechText(it), rate), 0),
    [items, rate],
  );

  function playAt(index: number, r = rate) {
    const sp = speakerRef.current;
    const item = items[index];
    if (!sp || !item) {
      setCurrent(-1);
      return;
    }
    const sentences = splitSentences(digestSpeechText(item));
    sp.onIndex = (i) => setSentence(sentences[i] ?? '');
    sp.load(sentences);
    setCurrent(index);
    sp.start({ rate: r });
  }

  advanceRef.current = () => {
    if (current >= 0 && current + 1 < items.length) playAt(current + 1);
    else setCurrent(-1);
  };

  function toggle() {
    const sp = speakerRef.current;
    if (!sp) return;
    if (state === 'playing') sp.pause();
    else if (state === 'paused') sp.resume();
    else playAt(current >= 0 ? current : 0);
  }

  function skip(dir: -1 | 1) {
    const next = (current >= 0 ? current : 0) + dir;
    if (next >= 0 && next < items.length) playAt(next);
  }

  function onRate(r: number) {
    setRate(r);
    saveRate(r);
    if (state !== 'idle' && current >= 0) playAt(current, r); // restart current item at the new speed
  }

  function remove(guid: string) {
    const playingGuid = current >= 0 ? items[current]?.guid : undefined;
    const next = removeFromPlaylist(guid);
    setItems(next);
    if (playingGuid === guid) {
      speakerRef.current?.stop();
      setCurrent(-1);
    } else if (playingGuid) {
      setCurrent(next.findIndex((i) => i.guid === playingGuid));
    }
  }

  function move(guid: string, dir: -1 | 1) {
    const playingGuid = items[current]?.guid;
    const next = movePlaylistItem(guid, dir);
    setItems(next);
    if (playingGuid) setCurrent(next.findIndex((i) => i.guid === playingGuid));
  }

  function clearAll() {
    speakerRef.current?.stop();
    clearPlaylist();
    setItems([]);
    setCurrent(-1);
  }

  return (
    <>
      <Link to="/" className="back-link">
        ← Home
      </Link>

      <div className="ep-head">
        <h1>Listen queue</h1>
        {items.length > 0 && (
          <p className="muted" style={{ margin: '0.2rem 0 0' }}>
            {items.length} digest{items.length === 1 ? '' : 's'} · about{' '}
            {formatDuration(totalSec) || 'a minute'} at {rate}×
          </p>
        )}
      </div>

      {!supported && (
        <p className="muted">Read-aloud isn’t available in this browser. Try Safari or Chrome.</p>
      )}

      {items.length === 0 ? (
        <p className="empty">
          Queue up digests to listen back to back — open an episode and tap{' '}
          <strong>Add to queue</strong> once its digest is ready. A 30-minute walk fits five or six
          of these.
        </p>
      ) : (
        <>
          {supported && (
            <div className="panel">
              <div className="player">
                <button
                  className="play"
                  onClick={toggle}
                  aria-label={state === 'playing' ? 'Pause' : 'Play'}
                >
                  {state === 'playing' ? '❚❚' : '▶'}
                </button>
                <button
                  className="btn subtle"
                  onClick={() => skip(-1)}
                  disabled={current <= 0}
                  aria-label="Previous digest"
                >
                  ⏮
                </button>
                <button
                  className="btn subtle"
                  onClick={() => skip(1)}
                  disabled={current < 0 || current >= items.length - 1}
                  aria-label="Next digest"
                >
                  ⏭
                </button>
                <div className="rate">
                  <label>
                    Speed{' '}
                    <select value={rate} onChange={(e) => onRate(Number(e.target.value))}>
                      {RATES.map((r) => (
                        <option key={r} value={r}>
                          {r}×
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
              {current >= 0 && items[current] && (
                <div style={{ marginTop: '0.7rem' }}>
                  <div className="muted" style={{ fontSize: '0.85rem' }}>
                    Now playing · {items[current].showTitle}
                  </div>
                  <div style={{ fontWeight: 620 }}>{items[current].episodeTitle}</div>
                  {state !== 'idle' && sentence && (
                    <p className="speaking" style={{ marginTop: '0.5rem', lineHeight: 1.5 }}>
                      <mark>{sentence}</mark>
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="card-list">
            {items.map((item, i) => (
              <div
                key={item.guid}
                className={`card${i === current ? ' playing' : ''}`}
                style={{ cursor: 'default' }}
              >
                {item.artwork ? (
                  <img className="art" src={item.artwork} alt="" loading="lazy" />
                ) : (
                  <span className="art" />
                )}
                <button
                  className="body"
                  style={{ background: 'none', border: 'none', textAlign: 'left', padding: 0 }}
                  onClick={() => (supported ? playAt(i) : openEpisode(item))}
                  title="Play from here"
                >
                  <span className="title">{item.episodeTitle}</span>
                  <span className="meta">
                    <span>{item.showTitle}</span>
                    <span>· ≈{formatDuration(estimateListenSec(digestSpeechText(item), rate))}</span>
                  </span>
                </button>
                <div className="queue-actions">
                  <button
                    className="icon-btn"
                    onClick={() => move(item.guid, -1)}
                    disabled={i === 0}
                    aria-label="Move up"
                  >
                    ↑
                  </button>
                  <button
                    className="icon-btn"
                    onClick={() => move(item.guid, 1)}
                    disabled={i === items.length - 1}
                    aria-label="Move down"
                  >
                    ↓
                  </button>
                  <button
                    className="icon-btn"
                    onClick={() => remove(item.guid)}
                    aria-label="Remove from queue"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>

          <button className="btn subtle" style={{ marginTop: '0.9rem' }} onClick={clearAll}>
            Clear queue
          </button>
        </>
      )}
    </>
  );

  function openEpisode(item: PlaylistItem) {
    if (!item.feedUrl) return;
    nav(`/episode?feed=${encodeURIComponent(item.feedUrl)}&guid=${encodeURIComponent(item.guid)}`);
  }
}
