// The little equalizer glyph used in the top bar (matches the app icon).

const BARS = [9, 15, 20, 12, 17];

export default function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      {BARS.map((h, i) => (
        <i key={i} style={{ height: `${h}px` }} />
      ))}
    </span>
  );
}
