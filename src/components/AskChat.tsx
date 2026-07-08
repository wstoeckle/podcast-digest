import { useEffect, useRef, useState } from 'react';
import type { ChatTurn } from '../types';
import { streamAsk } from '../net/api';

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
}: {
  transcript: string;
  guid: string;
  showTitle: string;
  episodeTitle: string;
}) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
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
    const history = turns;
    setTurns([...history, { role: 'user', content: q }, { role: 'assistant', content: '' }]);
    setBusy(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await streamAsk(
        { transcript, guid, showTitle, episodeTitle, history, question: q },
        (delta) =>
          setTurns((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.role === 'assistant') {
              next[next.length - 1] = { role: 'assistant', content: last.content + delta };
            }
            return next;
          }),
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
              {t.content || (busy && i === turns.length - 1 ? <span className="muted">…</span> : '')}
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
