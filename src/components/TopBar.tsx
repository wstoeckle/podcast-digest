import { useState } from 'react';
import { Link } from 'react-router-dom';
import BrandMark from './BrandMark';
import { cycleTheme, storedTheme, type Theme } from '../lib/theme';

const LABEL: Record<Theme, string> = { system: '◐', dark: '☾', light: '☀' };
const TITLE: Record<Theme, string> = {
  system: 'Theme: follow system',
  dark: 'Theme: dark',
  light: 'Theme: light',
};

export default function TopBar() {
  const [theme, setTheme] = useState<Theme>(() => storedTheme());
  return (
    <header className="topbar">
      <Link to="/" className="brand">
        <BrandMark />
        <span>Podcast Digest</span>
      </Link>
      <span className="spacer" />
      <Link to="/for-you" className="for-you-link">For you</Link>
      <Link to="/playlist" className="icon-btn" title="Listen queue" aria-label="Listen queue">
        ♫
      </Link>
      <button
        className="icon-btn"
        onClick={() => setTheme(cycleTheme())}
        title={TITLE[theme]}
        aria-label={TITLE[theme]}
      >
        {LABEL[theme]}
      </button>
    </header>
  );
}
