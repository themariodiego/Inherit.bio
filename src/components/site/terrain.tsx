/**
 * <Terrain> — Inherit's signature ground: a range of soft hills drawn in code.
 *
 * Decorative only. It carries no data, no number and no label, so it can sit
 * behind a headline without implying a result (brief §5: no lone numbers, no
 * invented charts). It is `aria-hidden`, never focusable, and paints with the
 * identity tokens through `color-mix`, so light and dark themes get the same
 * hills in the right ink. Reduced motion stops the drift; nothing else changes.
 *
 * The ridges are deterministic: the same seed draws the same hills on the
 * server and the client, so there is no hydration drift and no per-render
 * randomness. Each ridge is a smoothed sum of three sines, nearer hills
 * larger and slower, drawn front to back so the far ridges disappear behind
 * the near ones exactly as a landscape does.
 */

const WIDTH = 1600;
const HEIGHT = 600;
const STEP = 50;

interface Ridge {
  d: string;
  /** 0 = farthest, 1 = nearest. */
  depth: number;
}

/** A tiny seeded generator so every render draws the same hills. */
function seeded(seed: number) {
  let state = (seed * 9301 + 49297) % 233280;
  return () => {
    state = (state * 9301 + 49297) % 233280;
    return state / 233280;
  };
}

/** Catmull-Rom through the points, emitted as cubic Béziers, one decimal. */
function smoothPath(points: [number, number][]): string {
  // Whole-pixel coordinates: at 1600 units wide the eye cannot tell, and the
  // inline path data is half the size on every page that draws the hills.
  const f = (n: number) => Math.round(n);
  let d = `M${f(points[0][0])} ${f(points[0][1])}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d;
}

function ridges(count: number, seed: number): Ridge[] {
  const random = seeded(seed);
  const result: Ridge[] = [];
  for (let i = 0; i < count; i++) {
    const depth = count === 1 ? 1 : i / (count - 1);
    // Far ridges sit high and small; near ridges sit low and roll more.
    const base = HEIGHT * (0.38 + 0.62 * depth);
    const amplitude = 18 + 70 * depth;
    const waves = [
      { a: amplitude, l: 420 + 260 * random(), p: random() * Math.PI * 2 },
      { a: amplitude * 0.45, l: 170 + 120 * random(), p: random() * Math.PI * 2 },
      { a: amplitude * 0.18, l: 70 + 40 * random(), p: random() * Math.PI * 2 },
    ];
    const points: [number, number][] = [];
    for (let x = -STEP; x <= WIDTH + STEP; x += STEP) {
      const y = waves.reduce((sum, w) => sum + w.a * Math.sin(x / w.l + w.p), base);
      points.push([x, y]);
    }
    result.push({ d: smoothPath(points), depth });
  }
  return result;
}

export type TerrainVariant = "hero" | "band" | "ground";

const COUNT: Record<TerrainVariant, number> = { hero: 7, band: 4, ground: 5 };

/**
 * `hero` fills a tall ground behind a headline; `band` is a short strip for a
 * section edge or an empty state; `ground` is a quiet full-bleed backdrop.
 * `seed` lets two terrains on one page draw different hills.
 */
export function Terrain({
  variant = "hero",
  seed = 7,
  className,
}: {
  variant?: TerrainVariant;
  seed?: number;
  className?: string;
}) {
  const lines = ridges(COUNT[variant], seed);
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      data-slot="terrain"
      data-variant={variant}
      className={className}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="xMidYMax slice"
    >
      <g className="terrain-drift">
        {lines.map((ridge, index) => (
          <g key={index} style={{ "--depth": ridge.depth } as React.CSSProperties}>
            {/* The hill body: filled with the page ground so nearer hills
                hide the ridges behind them, with a breath of tint on the
                nearest slopes — the hill at golden hour. */}
            <path
              d={`${ridge.d}L${WIDTH + STEP} ${HEIGHT + 40}L${-STEP} ${HEIGHT + 40}Z`}
              className="terrain-fill"
            />
            <path d={ridge.d} className="terrain-line" />
          </g>
        ))}
      </g>
    </svg>
  );
}
