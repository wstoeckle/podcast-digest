import type { Digest } from '../types';
import { digestSpeechText } from '../lib/playlist';
import ListenPlayer from './ListenPlayer';

export default function DigestView({
  digest,
  sourceLabel,
  onComplete,
}: {
  digest: Digest;
  onComplete?: (() => void) | undefined;
  sourceLabel?: string;
}) {
  return (
    <>
      <section className="panel">
        <div className="digest-h">TLDR</div>
        <p className="tldr">{digest.tldr}</p>
      </section>

      <section className="panel">
        <ListenPlayer text={digestSpeechText(digest)} onComplete={onComplete} />
      </section>

      {digest.bullets.length > 0 && (
        <section className="panel">
          <div className="digest-h">Key points</div>
          <ul className="bullets">
            {digest.bullets.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </section>
      )}

      {digest.quotes && digest.quotes.length > 0 && (
        <section className="panel">
          <div className="digest-h">In their words</div>
          <ul className="quotes">
            {digest.quotes.map((q, i) => (
              <li key={i}>
                <blockquote className="quote">{q}</blockquote>
              </li>
            ))}
          </ul>
        </section>
      )}

      {digest.outline && digest.outline.length > 0 && (
        <section className="panel">
          <div className="digest-h">Episode outline</div>
          <ol className="outline">
            {digest.outline.map((s, i) => (
              <li key={i}>
                <span className="seg-title">{s.title}</span>
                {s.summary && <span className="seg-summary"> — {s.summary}</span>}
              </li>
            ))}
          </ol>
        </section>
      )}

      {(digest.topics.length > 0 || sourceLabel) && (
        <section className="panel">
          {digest.topics.length > 0 && (
            <>
              <div className="digest-h">Topics</div>
              <div className="topics">
                {digest.topics.map((t, i) => (
                  <span className="chip" key={i}>
                    {t}
                  </span>
                ))}
              </div>
            </>
          )}
          {sourceLabel && (
            <p className="muted" style={{ fontSize: '0.82rem', marginTop: '0.8rem' }}>
              Transcript {sourceLabel}.
            </p>
          )}
        </section>
      )}
    </>
  );
}
