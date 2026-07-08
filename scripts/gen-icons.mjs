// Generates the PWA / apple-touch icons as flat PNGs — a warm background with a
// centered audio-equalizer motif (bars of varying height). No design deps: we
// draw straight into an RGBA buffer with pngjs. Run: npm run icons
//
// Regenerate whenever the brand color or motif changes; the outputs are
// committed so a clean deploy doesn't need to run this.

import { PNG } from 'pngjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

// Brand palette (kept in sync with src/styles/tokens.css).
const BG = [26, 22, 20]; // deep warm charcoal (#1a1614)
const BAR = [230, 138, 92]; // terracotta accent (#e68a5c)
const BAR2 = [242, 224, 208]; // warm paper (#f2e0d0)

function fill(png, x0, y0, x1, y1, [r, g, b]) {
  for (let y = Math.max(0, y0); y < Math.min(png.height, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(png.width, x1); x++) {
      const i = (png.width * y + x) << 2;
      png.data[i] = r;
      png.data[i + 1] = g;
      png.data[i + 2] = b;
      png.data[i + 3] = 255;
    }
  }
}

// Relative bar heights (fraction of the drawable height), an equalizer shape.
const HEIGHTS = [0.35, 0.62, 0.95, 0.55, 0.78, 0.42];

function render(size, { safe }) {
  const png = new PNG({ width: size, height: size });
  fill(png, 0, 0, size, size, BG);

  // `safe` keeps the motif inside the maskable safe zone (center ~72%).
  const inset = safe ? size * 0.2 : size * 0.16;
  const area = size - inset * 2;
  const n = HEIGHTS.length;
  const gap = area * 0.045;
  const barW = (area - gap * (n - 1)) / n;
  const baseline = inset + area * 0.9; // bars grow upward from here

  for (let k = 0; k < n; k++) {
    const h = area * 0.78 * HEIGHTS[k];
    const x0 = Math.round(inset + k * (barW + gap));
    const x1 = Math.round(x0 + barW);
    const y1 = Math.round(baseline);
    const y0 = Math.round(baseline - h);
    fill(png, x0, y0, x1, y1, k % 2 === 0 ? BAR : BAR2);
  }
  return png;
}

const targets = [
  { name: 'icon-192.png', size: 192, safe: false },
  { name: 'icon-512.png', size: 512, safe: false },
  { name: 'icon-512-maskable.png', size: 512, safe: true },
  { name: 'apple-touch-icon.png', size: 180, safe: false },
];

for (const t of targets) {
  const png = render(t.size, { safe: t.safe });
  writeFileSync(join(outDir, t.name), PNG.sync.write(png));
  console.log('wrote', t.name);
}
