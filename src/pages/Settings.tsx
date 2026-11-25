import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AccessStatus } from '../types';
import { getAccess } from '../net/api';
import { loadKeys, maskKey, saveKeys, type StoredKeys } from '../lib/keys';
import KeyStatus from '../components/KeyStatus';

type Field = keyof StoredKeys;

const FIELDS: { name: Field; label: string; hint: React.ReactNode; placeholder: string }[] = [
  {
    name: 'anthropicKey',
    label: 'Anthropic API key',
    placeholder: 'sk-ant-…',
    hint: (
      <>
        For digests and questions. Create one at{' '}
        <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noreferrer">
          platform.claude.com
        </a>
        . Claude Max, Ultra and Team plans include monthly API credits.
      </>
    ),
  },
  {
    name: 'assemblyAiKey',
    label: 'AssemblyAI API key (optional)',
    placeholder: 'Only needed to transcribe audio',
    hint: (
      <>
        Only for episodes with no published transcript (about $0.17 per audio hour). Get one at{' '}
        <a href="https://www.assemblyai.com" target="_blank" rel="noreferrer">
          assemblyai.com
        </a>
        , or paste transcripts yourself.
      </>
    ),
  },
  {
    name: 'ownerCode',
    label: 'Owner code',
    placeholder: 'Only if this is your copy of the app',
    hint: <>If you run this app, enter the OWNER_CODE you set on the server to use its own keys.</>,
  },
];

/** Your own API keys and the owner code, kept on this device. */
export default function Settings() {
  const [saved, setSaved] = useState<StoredKeys>(() => loadKeys());
  const [draft, setDraft] = useState<StoredKeys>({});
  const [show, setShow] = useState(false);
  const [status, setStatus] = useState<AccessStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState('');

  async function refresh(check: boolean) {
    setChecking(check);
    try {
      setStatus(await getAccess(check));
    } catch {
      setStatus(null);
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    void refresh(false);
  }, []);

  const dirty = FIELDS.some((f) => (draft[f.name] ?? '') !== '');

  function onSave(e: React.FormEvent) {
    e.preventDefault();
    const next = saveKeys({ ...saved, ...draft });
    setSaved(next);
    setDraft({});
    setNote('Saved on this device.');
    // Check new keys right away (free calls); otherwise just refresh the status.
    void refresh(Boolean(draft.anthropicKey || draft.assemblyAiKey));
  }

  function forget(name: Field) {
    const next: StoredKeys = { ...saved };
    delete next[name];
    setSaved(saveKeys(next));
    setNote('Removed from this device.');
    void refresh(false);
  }

  return (
    <>
      <Link to="/" className="back-link">
        ← Home
      </Link>
      <h1 className="page-title">Settings</h1>
      <p className="muted">
        Use this app with your own API keys, so you pay for what you use. Keys stay on this device:
        the app sends them with each request, and its server never stores them.
      </p>

      <KeyStatus status={status} checking={checking} onCheck={() => void refresh(true)} />

      <form className="panel settings" onSubmit={onSave}>
        {FIELDS.map((f) => (
          <div className="setting" key={f.name}>
            <label htmlFor={f.name} className="setting-label">
              {f.label}
            </label>
            {saved[f.name] && (
              <div className="saved-key">
                <span className="muted small">Saved: {maskKey(saved[f.name] ?? '')}</span>
                <button
                  type="button"
                  className="btn ghost small-btn"
                  onClick={() => forget(f.name)}
                >
                  Remove
                </button>
              </div>
            )}
            <div className="field">
              <input
                id={f.name}
                type={show ? 'text' : 'password'}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder={saved[f.name] ? 'Replace with a new one…' : f.placeholder}
                value={draft[f.name] ?? ''}
                onChange={(e) => setDraft({ ...draft, [f.name]: e.target.value })}
              />
            </div>
            <p className="muted small setting-hint">{f.hint}</p>
          </div>
        ))}
        <label className="show-keys small">
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Show
          what I type
        </label>
        <div className="setting-actions">
          <button className="btn" type="submit" disabled={!dirty}>
            Save
          </button>
          {note && (
            <span className="muted small" role="status">
              {note}
            </span>
          )}
        </div>
      </form>
    </>
  );
}
