// Light/dark theme: follow the OS by default, with a manual override persisted
// in localStorage. Applied by setting [data-theme] on <html>.

export type Theme = 'light' | 'dark' | 'system';

const KEY = 'pd.theme';

export function storedTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    /* private mode / disabled storage */
  }
  return 'system';
}

export function applyStoredTheme(): void {
  const t = storedTheme();
  const root = document.documentElement;
  if (t === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', t);
}

/** Cycle system → dark → light → system and return the new value. */
export function cycleTheme(): Theme {
  const order: Theme[] = ['system', 'dark', 'light'];
  const next = order[(order.indexOf(storedTheme()) + 1) % order.length] ?? 'system';
  try {
    if (next === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch {
    /* ignore */
  }
  applyStoredTheme();
  return next;
}
