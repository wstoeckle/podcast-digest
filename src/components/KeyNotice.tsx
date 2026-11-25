import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getAccess } from '../net/api';

/**
 * For a visitor without a key on someone else's copy of the app: digests run
 * on the owner's keys, so say up front how to bring your own.
 */
export default function KeyNotice() {
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    let live = true;
    getAccess()
      .then((a) => live && setLocked(a.claude === 'locked'))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  if (!locked) return null;
  return (
    <section className="panel key-notice">
      <p>
        <strong>Bring your own key.</strong> This copy of Podcast Digest runs on its owner's API
        keys. To make digests here, add your own Anthropic API key. It stays on this device.
      </p>
      <Link to="/settings">Add your key in Settings →</Link>
    </section>
  );
}
