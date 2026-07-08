// A gentle, dismissible install hint. On Chrome/Android we use the
// beforeinstallprompt event; on iOS Safari (no such event) we show the
// Add-to-Home-Screen instruction once. Never nags: dismissal is remembered.

import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'pd.install.dismissed';

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    try {
      if (localStorage.getItem(DISMISS_KEY)) return;
    } catch {
      /* ignore */
    }

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);

    if (isIos()) {
      const t = setTimeout(() => setShowIosHint(true), 1500);
      return () => {
        clearTimeout(t);
        window.removeEventListener('beforeinstallprompt', onPrompt);
      };
    }
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignore */
    }
    setDeferred(null);
    setShowIosHint(false);
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    dismiss();
  }

  if (deferred) {
    return (
      <div className="install-toast" role="dialog" aria-label="Install app">
        <span>Install Digest to your home screen.</span>
        <button className="btn" onClick={install}>
          Install
        </button>
        <button className="icon-btn" onClick={dismiss} aria-label="Dismiss">
          ✕
        </button>
      </div>
    );
  }

  if (showIosHint) {
    return (
      <div className="install-toast" role="dialog" aria-label="Install app">
        <span className="muted">
          Add to Home Screen: tap Share <span aria-hidden>􀈂</span> then “Add to Home Screen”.
        </span>
        <button className="icon-btn" onClick={dismiss} aria-label="Dismiss">
          ✕
        </button>
      </div>
    );
  }
  return null;
}
