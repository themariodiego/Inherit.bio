/**
 * <AncestryMap> — the inline SVG world map of the five broad regions (brief
 * §4.6, A.8, X16.5). One encoding: fill opacity ∝ the interval's lower bound
 * (floor 0.15) through a radial gradient whose outer 30% of radius fades to
 * transparent (a feather of 15% of the bounding-box width, the X16.5
 * minimum); a share whose lower bound is 0 is a dashed hairline with no fill.
 * The map is a locator and a shading, never a border: no administrative line
 * is drawn, and the land outside every region is one muted path.
 *
 * Shown mode: one focusable `<path>` per visible region in descending share
 * order, named as A.8 asks; hover and focus report to the parent, Enter,
 * Space and click activate. Grey mode: every region as a grey outline,
 * nothing focusable, no gradient.
 *
 * The SVG carries `data-density-pixel-exclusion="map-tile"`: the density
 * measurement treats it as a map, not as ink.
 */
import type { KeyboardEvent } from "react";
import type { MapShapes } from "@/lib/ancestry/geometry";
import type { RegionRowView } from "@/lib/ancestry/view";
import { VIEWBOX } from "@/lib/geo/project";
import { MAP_CAPTION, MAP_LABEL } from "@/copy/ancestry";
import { cn } from "@/lib/utils";

/** Where the feather starts, as a share of the gradient radius: the outer 30% fades. */
export const FEATHER_START = 0.7;
/** The same point as a gradient stop offset. */
const FEATHER_OFFSET = `${FEATHER_START * 100}%`;

export function gradientId(code: string): string {
  return `feather-${code}`;
}

export interface AncestryMapProps {
  shapes: MapShapes;
  /** Visible rows in descending share order; ignored in grey mode. */
  rows: RegionRowView[];
  mode: "shown" | "grey";
  selectedCode?: string | null;
  /** Receives each region path so the parent can return focus to it. */
  pathRef?: (code: string, element: SVGPathElement | null) => void;
  /** Hover or focus: opens the panel without moving focus. */
  onHover?: (code: string) => void;
  /** Click, Enter or Space: opens the panel and moves focus to its Close button. */
  onActivate?: (code: string) => void;
}

export function AncestryMap({ shapes, rows, mode, selectedCode, pathRef, onHover, onActivate }: AncestryMapProps) {
  const shapeByCode = new Map(shapes.regions.map((shape) => [shape.code, shape]));
  const shown = mode === "shown";
  const stopStyle = { stopColor: "var(--forest)" };

  function onKeyDown(event: KeyboardEvent<SVGPathElement>, code: string) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onActivate?.(code);
    }
  }

  return (
    <figure data-slot="ancestry-figure" className="m-0">
      <svg
        viewBox={VIEWBOX}
        role="group"
        aria-label={MAP_LABEL}
        data-slot="ancestry-map"
        data-mode={mode}
        data-density-pixel-exclusion="map-tile"
        className="h-auto w-full rounded-2xl border border-line bg-paper"
      >
        {shown ? (
          <defs>
            {rows
              .filter((row) => row.opacity !== null)
              .map((row) => (
                <radialGradient
                  key={row.code}
                  id={gradientId(row.code)}
                  gradientUnits="objectBoundingBox"
                  cx="50%"
                  cy="50%"
                  r="50%"
                >
                  <stop offset="0%" stopOpacity={row.opacity ?? 0} style={stopStyle} />
                  <stop offset={FEATHER_OFFSET} stopOpacity={row.opacity ?? 0} style={stopStyle} />
                  <stop offset="100%" stopOpacity={0} style={stopStyle} />
                </radialGradient>
              ))}
          </defs>
        ) : null}
        <path d={shapes.land} fill="var(--line)" fillOpacity={0.5} stroke="none" aria-hidden="true" />
        {shown
          ? rows.map((row) => {
              const shape = shapeByCode.get(row.code);
              if (!shape) return null;
              const hairline = row.opacity === null;
              const selected = selectedCode === row.code;
              return (
                <path
                  key={row.code}
                  ref={(element) => pathRef?.(row.code, element)}
                  d={shape.d}
                  fillRule="evenodd"
                  data-region={row.code}
                  data-lower-bound={row.lowerBound}
                  data-fill-opacity={hairline ? undefined : row.opacity}
                  data-hairline={hairline ? "true" : undefined}
                  data-hatched={row.hatched ? "true" : undefined}
                  fill={hairline ? "none" : `url(#${gradientId(row.code)})`}
                  stroke="var(--forest)"
                  strokeWidth={selected ? 3 : hairline ? 2 : 1}
                  strokeDasharray={hairline ? "6 6" : undefined}
                  tabIndex={0}
                  role="button"
                  aria-label={row.accessibleName}
                  aria-haspopup="dialog"
                  aria-expanded={selected}
                  className={cn(
                    "cursor-pointer outline-none",
                    "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-forest",
                  )}
                  onMouseEnter={() => onHover?.(row.code)}
                  onFocus={() => onHover?.(row.code)}
                  onClick={() => onActivate?.(row.code)}
                  onKeyDown={(event) => onKeyDown(event, row.code)}
                />
              );
            })
          : shapes.regions.map((shape) => (
              <path
                key={shape.code}
                d={shape.d}
                fillRule="evenodd"
                data-region={shape.code}
                fill="var(--line)"
                fillOpacity={0.3}
                stroke="var(--ink-muted)"
                strokeWidth={1}
                aria-hidden="true"
              />
            ))}
      </svg>
      <figcaption data-slot="map-caption" className="mt-2 text-sm text-ink-muted">
        {MAP_CAPTION}
      </figcaption>
    </figure>
  );
}
