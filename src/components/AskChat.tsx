import { Fragment, useEffect, useRef, useState } from 'react';
import type { ChatTurn, Citation } from '../types';
import { streamAsk } from '../net/api';
import { applyAskEvent, type AnswerTurn as Turn } from '../lib/askAnswer';
import TimeChip from './TimeChip';

const SUGGESTIONS = [
  'What were the main takeaways?',
  'Did they mention any specific numbers or studies?',
  'What was the most surprising point?',
];

export default function AskChat({
  transcript,
  guid,
  showTitle,
  episodeTitle,
  onSeek,
}: {
  transcript: string;
  guid: string;
  showTitle: string;
  episodeTitle: string;
  onSeek?: ((seconds: number) => void) | undefined;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [turns]);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setError('');
    setInput('');
    // The API gets plain text history; markers and passages stay in the UI.
    const history: ChatTurn[] = turns.map(({ role, content }) => ({ role, content }));
    setTurns([...turns, { role: 'user', content: q }, { role: 'assistant', content: '' }]);
    setBusy(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await streamAsk(
        { transcript, guid, showTitle, episodeTitle, history, question: q },
        (event) => {
          if (event.type === 'error') {
            setError(event.message);
            return;
          }
          setTurns((prev) => {
            const last = prev[prev.length - 1];
            if (!last || last.role !== 'assistant') return prev;
            return [...prev.slice(0, -1), applyAskEvent(last, event)];
          });
        },
        ctrl.signal,
      );
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setError((err as Error).message);
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  return (
    <section className="panel">
      <div className="digest-h">Ask about this episode</div>

      {turns.length === 0 && (
        <div className="suggestions">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => ask(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      {turns.length > 0 && (
        <div className="chat">
          {turns.map((t, i) => (
            <div key={i} className={`msg ${t.role}`}>
              {t.content ? (
                <AnswerText turn={t} />
              ) : busy && i === turns.length - 1 ? (
                <span className="muted">…</span>
              ) : null}
              {t.cites && t.cites.length > 0 && <Sources cites={t.cites} onSeek={onSeek} />}
            </div>
          ))}
          <div ref={endRef} />
        </div>
      )}

      {error && <p className="error">{error}</p>}

      <form
        className="ask-form"
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
      >
        <label className="field">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a follow-up…"
          />
        </label>
        <button className="btn" disabled={busy || !input.trim()}>
          {busy ? '…' : 'Ask'}
        </button>
      </form>
    </section>
  );
}

function AnswerText({ turn }: { turn: Turn }) {
  if (!turn.parts) return <>{turn.content}</>;
  return (
    <>
      {turn.parts.map((p, i) =>
        'text' in p ? (
          <Fragment key={i}>{p.text}</Fragment>
        ) : (
          <sup key={i} className="cite-mark" aria-label={`source ${p.cite}`}>
            {p.cite}
          </sup>
        ),
      )}
    </>
  );
}

function Sources({
  cites,
  onSeek,
}: {
  cites: Citation[];
  onSeek?: ((seconds: number) => void) | undefined;
}) {
  return (
    <div className="sources">
      <div className="sources-h">From the transcript</div>
      <ol>
        {cites.map((c, i) => (
          <li key={i}>
            <span className="cite-num" aria-hidden>
              {i + 1}
            </span>
            <div>
              <blockquote>{c.text}</blockquote>
              {c.start !== undefined && <TimeChip seconds={c.start} onSeek={onSeek} />}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
