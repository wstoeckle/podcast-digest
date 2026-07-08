import { useState } from 'react';

// A collapsible box that lets the reader paste a transcript they already have
// (e.g. from the show's website) instead of waiting on — or paying for — machine
// transcription. Plain text, VTT, SRT, or JSON all work; the server cleans it.

interface Props {
  /** Called with the pasted text once the reader submits. */
  onSubmit: (text: string) => void;
  /** Opening label — tuned per phase (offer vs. recovery vs. replace). */
  label: string;
  /** Whether the box starts open (e.g. after an error, lead with it). */
  defaultOpen?: boolean;
}

const MIN_CHARS = 200;

export default function PasteTranscript({ onSubmit, label, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [text, setText] = useState('');
  const trimmed = text.trim();
  const short = trimmed.length > 0 && trimmed.length < MIN_CHARS;

  if (!open) {
    return (
      <button className="btn ghost paste-open" onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  }

  return (
    <div className="panel paste-box">
      <label className="digest-h" htmlFor="paste-transcript">
        Paste the transcript
      </label>
      <p className="muted paste-hint">
        Have the transcript from the show’s site? Paste it here to skip transcription — it’s free,
        instant, and higher quality. Plain text, VTT, SRT, or JSON all work.
      </p>
      <textarea
        id="paste-transcript"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste the full episode transcript…"
        rows={8}
        autoCapitalize="none"
        spellCheck={false}
      />
      <div className="paste-actions">
        <button
          className="btn"
          disabled={trimmed.length < MIN_CHARS}
          onClick={() => onSubmit(trimmed)}
        >
          Use this transcript
        </button>
        <button className="btn subtle" onClick={() => setOpen(false)}>
          Cancel
        </button>
        {short && <span className="muted paste-count">A bit short — paste the full text.</span>}
      </div>
    </div>
  );
}
