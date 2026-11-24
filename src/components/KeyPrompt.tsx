import { Link } from 'react-router-dom';
import type { KeyErrorCode } from '../types';

/** After a key error: the way to Settings, where you add or fix your own key. */
export default function KeyPrompt({ code }: { code: KeyErrorCode | undefined }) {
  if (!code) return null;
  return (
    <p className="key-prompt">
      <Link to="/settings">
        {code === 'needs_key' ? 'Add your key in Settings →' : 'Check your key in Settings →'}
      </Link>
    </p>
  );
}
