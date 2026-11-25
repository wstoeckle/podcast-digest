import type { AccessStatus, KeyUse } from '../types';

type Check = AccessStatus['claudeKey'];

function line(use: KeyUse, check: Check, what: { name: string; does: string }): string {
  switch (use) {
    case 'server':
      return `${what.does}: the app's own ${what.name} key.`;
    case 'caller':
      return check === 'ok'
        ? `${what.does}: your ${what.name} key ✓ (it works).`
        : check === 'rejected'
          ? `${what.does}: your ${what.name} key, but ${what.name} turned it down. Check it below.`
          : `${what.does}: your ${what.name} key.`;
    case 'locked':
      return `${what.does}: needs your own ${what.name} key.`;
    case 'demo':
      return `${what.does}: no ${what.name} key here, so you'll see samples. Add your own for real ones.`;
  }
}

/** Whose keys this device uses, from GET /api/access. */
export default function KeyStatus({
  status,
  checking,
  onCheck,
}: {
  status: AccessStatus | null;
  checking: boolean;
  onCheck: () => void;
}) {
  if (!status) return null;
  const canCheck = status.claude === 'caller' || status.stt === 'caller';
  return (
    <section className="panel key-status" aria-live="polite">
      {status.ownerCode && status.owner && (
        <p className="ok-note">✓ Owner code accepted. This device can use the app's own keys.</p>
      )}
      <ul className="key-lines">
        <li>
          {line(status.claude, status.claudeKey, {
            name: 'Anthropic',
            does: 'Digests and questions',
          })}
        </li>
        <li>
          {line(status.stt, status.sttKey, {
            name: 'AssemblyAI',
            does: 'Transcribing audio',
          })}
          {status.stt !== 'server' && status.stt !== 'caller' && (
            <span className="muted"> Episodes with a published transcript work without it.</span>
          )}
        </li>
      </ul>
      {canCheck && (
        <button className="btn subtle" type="button" onClick={onCheck} disabled={checking}>
          {checking ? 'Checking…' : 'Check my keys'}
        </button>
      )}
    </section>
  );
}
