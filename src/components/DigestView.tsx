import type { Digest } from '../types';
import { digestSpeechText } from '../lib/playlist';
import ListenPlayer from './ListenPlayer';

export default function DigestView({
  digest,
  sourceLabel,
}: {
  digest: Digest;
  sourceLabel?: string;
}) {
  return (
    <>
      <section className="panel">
        <div className="digest-h">TLDR</div>
        <p className="tldr">{digest.tldr}</p>
      </section>

      <section className="panel">
        <ListenPlayer text={digestSpeechText(digest)} />
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
