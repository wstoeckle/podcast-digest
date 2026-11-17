import { formatClock } from '../lib/timed';

/** A timestamp; a button that plays the episode from there when audio is available. */
export default function TimeChip({
  seconds,
  onSeek,
}: {
  seconds: number;
  onSeek?: ((seconds: number) => void) | undefined;
}) {
  const label = formatClock(seconds);
  if (!onSeek) return <span className="time-chip static">{label}</span>;
  return (
    <button
      type="button"
      className="time-chip"
      onClick={() => onSeek(seconds)}
      aria-label={`Play the episode from ${label}`}
    >
      ▶ {label}
    </button>
  );
}
