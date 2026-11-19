import { useState } from 'react';
import type { PickerRow } from '../lib/overnight';

/**
 * Tick the shows to digest overnight. Collapsed once something is picked, so a
 * long follow list doesn't take over the home page; a filter appears when the
 * list is long.
 */
export default function OvernightShowPicker({
  rows,
  pending,
  onToggle,
}: {
  rows: PickerRow[];
  /** Feed URLs with a change in flight. */
  pending: Set<string>;
  onToggle: (row: PickerRow, chosen: boolean) => void;
}) {
  const picked = rows.filter((r) => r.chosen).length;
  const [open, setOpen] = useState(picked === 0);
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const shown = query ? rows.filter((r) => r.title.toLowerCase().includes(query)) : rows;

  return (
    <details className="panel picker" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <span className="picker-title">Shows to digest overnight</span>
        <span className="muted">
          {' '}
          · {picked === 0 ? 'none picked yet' : `${picked} of ${rows.length}`}
        </span>
      </summary>
      {rows.length === 0 ? (
        <p className="muted small">Follow some shows first, then pick them here.</p>
      ) : (
        <>
          {rows.length > 8 && (
            <label className="field picker-filter">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Filter your shows…"
                aria-label="Filter your shows"
              />
            </label>
          )}
          <ul className="pick-list">
            {shown.map((r) => (
              <li key={r.feedUrl}>
                <label className="pick">
                  <input
                    type="checkbox"
                    checked={r.chosen}
                    disabled={pending.has(r.feedUrl)}
                    onChange={(e) => onToggle(r, e.target.checked)}
                  />
                  {r.artwork ? (
                    <img className="pick-art" src={r.artwork} alt="" loading="lazy" />
                  ) : (
                    <span className="pick-art" />
                  )}
                  <span className="pick-title">
                    {r.title}
                    {!r.followed && (
                      <span className="muted small"> · not followed on this device</span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
    </details>
  );
}
