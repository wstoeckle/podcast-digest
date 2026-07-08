// Small pure formatting helpers for durations and dates.

/** "1h 12m", "48m", "9m" from a second count. Empty string for unknown. */
export function formatDuration(sec: number | undefined): string {
  if (!sec || sec <= 0 || !Number.isFinite(sec)) return '';
  const total = Math.round(sec);
  const h = Math.floor(total / 3600);
  const m = Math.round((total % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${Math.max(1, m)}m`;
}

/** Parse an iTunes-style duration: seconds ("3600"), "MM:SS", or "HH:MM:SS". */
export function parseDuration(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const s = raw.trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const parts = s.split(':').map((p) => parseInt(p, 10));
  if (parts.some((n) => Number.isNaN(n))) return undefined;
  let secs = 0;
  for (const p of parts) secs = secs * 60 + p;
  return secs;
}

/** "Jul 6, 2026" for a date-ish string. Empty for unknown. */
export function formatDate(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
