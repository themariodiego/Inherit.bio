"use client";

/**
 * <AncestryRegions> — the regions section of the ancestry page (brief §4.6,
 * A.8, G4.4, X13, X16.5): the map, the "Show only what’s well supported"
 * toggle, the two chips, the always-visible table, the click panel and the
 * sentences G4.4 requires, all inside ONE <ClaimBlock> so every
 * `ancestry-share` figure has exactly one attributed ancestor. The server
 * has already done the arithmetic (`presentShares` → `regionsView`); this
 * component owns only the toggle state and the selected region.
 *
 * Shown mode (enough markers): rows are apportioned once, so a region's
 * value is the same in both toggle states and shown + unassignable + hidden
 * is always 100.0. The toggle only changes which rows and paths are hidden
 * and which chip values show; it never re-fetches.
 *
 * Grey mode (too few markers): the map is grey, no percentages, no toggle,
 * no chips; the mandated sentence states the counts; the raw numbers stay
 * one activation away inside a disclosure whose summary is pinned by the
 * GIAB browser test, and that section contains exactly one list.
 *
 * Panel behaviour: hover or focus opens it without moving focus; Enter,
 * Space or click opens it and moves focus to Close; Escape, Close or a
 * click outside closes it and returns focus to the region path. Never
 * modal, never a navigation.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ClaimBlock } from "@/components/figures/claim-block";
import {
  CHIP_LABELS,
  IDENTITY,
  MARKER_GLOSS,
  NOISE,
  NOTHING_READ,
  NO_SEGMENTED_CONTROL,
  RANGE_UNAVAILABLE,
  RAW_NUMBERS_SUMMARY,
  RESOLUTION_LIMIT,
  TOGGLE_LABEL,
  greyState,
  markersLine,
  panelLine,
  subContinental,
  type PanelFacts,
} from "@/copy/ancestry";
import type { MapShapes } from "@/lib/ancestry/geometry";
import type { RegionRowView, RegionsView } from "@/lib/ancestry/view";
import type { AncestryShareRange, AncestryShareSpec, CoverageSpec, StandaloneFigureSpec } from "@/lib/figures/spec";
import { cn } from "@/lib/utils";
import { AncestryMap } from "./ancestry-map";
import { RegionList } from "./region-list";
import { RegionPanel } from "./region-panel";

/** Where every share on this surface is computed. */
const ADMIXTURE_MODULE = "src/lib/genome/admixture.ts";
const PROVENANCE = { kind: "computed", module: ADMIXTURE_MODULE } as const;
const UNAVAILABLE: AncestryShareRange = { unavailable: true };

function shareSpec(share: number, range: AncestryShareRange): AncestryShareSpec {
  return { kind: "ancestry-share", class: "ancestry", basis: "modelled", provenance: PROVENANCE, share, range };
}

export interface AncestryResultView {
  markersUsed: number;
  /** The stored support note; rendered only inside the grey-state disclosure. */
  supportNote: string;
  /** True when the continental tier qualifies (markersUsed ≥ the region minimum). */
  shown: boolean;
  view: RegionsView;
}

export interface AncestryRegionsProps {
  subjectId: string;
  shapes: MapShapes;
  panel: PanelFacts;
  minMarkers: number;
  /** null when the subject has no stored admixture result yet. */
  result: AncestryResultView | null;
  /** The toggle's starting state; the brief's default is on. */
  initialWellSupportedOnly?: boolean;
}

export function AncestryRegions({
  subjectId,
  shapes,
  panel,
  minMarkers,
  result,
  initialWellSupportedOnly = true,
}: AncestryRegionsProps) {
  if (result === null) return <NoResult shapes={shapes} />;
  if (!result.shown) return <GreyRegions subjectId={subjectId} shapes={shapes} panel={panel} result={result} />;
  return (
    <ShownRegions
      subjectId={subjectId}
      shapes={shapes}
      panel={panel}
      minMarkers={minMarkers}
      result={result}
      initialWellSupportedOnly={initialWellSupportedOnly}
    />
  );
}

function NoResult({ shapes }: { shapes: MapShapes }) {
  return (
    <div className="space-y-4">
      <AncestryMap shapes={shapes} rows={[]} mode="grey" />
      <p data-slot="nothing-read" className="text-sm text-ink-muted">
        {NOTHING_READ}
      </p>
    </div>
  );
}

function GreyRegions({
  subjectId,
  shapes,
  panel,
  result,
}: {
  subjectId: string;
  shapes: MapShapes;
  panel: PanelFacts;
  result: AncestryResultView;
}) {
  const rows = result.view.rows;
  const figures: StandaloneFigureSpec[] = rows.map((row) => shareSpec(row.share, row.range));
  return (
    <div className="space-y-4">
      <AncestryMap shapes={shapes} rows={[]} mode="grey" />
      {/* inherit-figure-exempt: mandated §4.6 grey-state sentence; a count of positions, not a result figure */}
      <p data-slot="grey-state" className="text-base text-ink">
        {greyState(result.markersUsed, panel)}
      </p>
      <p className="text-sm text-ink-muted">{MARKER_GLOSS}</p>
      <p className="text-sm text-ink-muted">{panelLine(panel)}</p>
      <p className="text-sm text-ink-muted">{IDENTITY}</p>
      <details data-slot="raw-numbers">
        <summary className="cursor-pointer text-sm text-ink-muted underline decoration-dotted underline-offset-2">
          {RAW_NUMBERS_SUMMARY}
        </summary>
        <ClaimBlock
          subject={{ subjectId }}
          figures={figures}
          className="mt-3"
          renderFigures={(nodes) => (
            <div className="space-y-2 text-sm text-ink-muted">
              <p>{result.supportNote}</p>
              <p>{NOISE}</p>
              <ul data-slot="raw-numbers-list" className="space-y-1">
                {rows.map((row, index) => (
                  <li key={row.code} className="flex flex-wrap items-baseline gap-x-3">
                    <span data-slot="region-name" className="text-ink">
                      {row.name}
                    </span>
                    {nodes[index]}
                  </li>
                ))}
              </ul>
            </div>
          )}
        />
      </details>
    </div>
  );
}

function ShownRegions({
  subjectId,
  shapes,
  panel,
  minMarkers,
  result,
  initialWellSupportedOnly,
}: {
  subjectId: string;
  shapes: MapShapes;
  panel: PanelFacts;
  minMarkers: number;
  result: AncestryResultView;
  initialWellSupportedOnly: boolean;
}) {
  const { rows, chips } = result.view;
  const [wellSupportedOnly, setWellSupportedOnly] = useState(initialWellSupportedOnly);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const pathRefs = useRef(new Map<string, SVGPathElement>());
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  /** Set while focus is returned to a path, so its focus handler does not reopen the panel. */
  const suppressOpen = useRef(false);
  /** Counts activations (click, Enter, Space): each one moves focus to Close once the panel has rendered. */
  const [activation, setActivation] = useState(0);

  const visibleRows = rows.filter((row) => !wellSupportedOnly || row.wellSupported);
  const visibleCodes = new Set(visibleRows.map((row) => row.code));
  const selectedRow = visibleRows.find((row) => row.code === selectedCode) ?? null;
  const openCode = selectedRow?.code ?? null;
  const chipShares = wellSupportedOnly ? chips.on : chips.off;

  const rowSpecs = rows.map((row) => shareSpec(row.share, row.range));
  const chipSpecs = [shareSpec(chipShares.unassignable, UNAVAILABLE), shareSpec(chipShares.hidden, UNAVAILABLE)];
  const coverageSpec: CoverageSpec = {
    kind: "coverage",
    class: "quality",
    basis: "observed",
    provenance: PROVENANCE,
    read: result.markersUsed,
    needed: panel.markers,
  };
  const panelSpecs = selectedRow ? [shareSpec(selectedRow.share, selectedRow.range)] : [];
  const figures: StandaloneFigureSpec[] = [...rowSpecs, ...chipSpecs, ...(panel.known === false ? [] : [coverageSpec]), ...panelSpecs];
  const chipIndex = rows.length;
  const coverageIndex = chipIndex + 2;
  const panelIndex = coverageIndex + (panel.known === false ? 0 : 1);

  const pathRef = useCallback((code: string, element: SVGPathElement | null) => {
    if (element) pathRefs.current.set(code, element);
    else pathRefs.current.delete(code);
  }, []);

  const close = useCallback(
    (returnFocus: boolean) => {
      setSelectedCode(null);
      if (!returnFocus || !openCode) return;
      const path = pathRefs.current.get(openCode);
      if (!path) return;
      suppressOpen.current = true;
      path.focus();
      suppressOpen.current = false;
    },
    [openCode],
  );

  const onHover = useCallback((code: string) => {
    if (suppressOpen.current) return;
    setSelectedCode(code);
  }, []);

  const onActivate = useCallback((code: string) => {
    setSelectedCode(code);
    setActivation((count) => count + 1);
  }, []);

  // After an activation the panel has rendered (it may already have been
  // open from hover or focus): move focus to Close.
  useEffect(() => {
    if (activation === 0) return;
    closeRef.current?.focus();
  }, [activation]);

  // Escape and clicks outside close the panel and return focus to the path.
  useEffect(() => {
    if (!openCode) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close(true);
    }
    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (panelRef.current?.contains(target)) return;
      if (target.closest('[data-slot="ancestry-map"] path[data-region]')) return;
      close(true);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [openCode, close]);

  function renderFigures(nodes: ReactNode[]) {
    return (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          <AncestryMap
            shapes={shapes}
            rows={visibleRows}
            mode="shown"
            selectedCode={openCode}
            pathRef={pathRef}
            onHover={onHover}
            onActivate={onActivate}
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={wellSupportedOnly}
              data-slot="well-supported-toggle"
              onClick={() => setWellSupportedOnly((value) => !value)}
              className={cn(
                "inline-flex min-h-11 items-center gap-3 rounded-full border border-line bg-card px-4 text-sm text-ink",
                "outline-none focus-visible:ring-[3px] focus-visible:ring-forest/50",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "relative inline-block h-5 w-9 shrink-0 rounded-full transition-colors",
                  wellSupportedOnly ? "bg-forest" : "bg-line",
                )}
              >
                <span
                  className={cn(
                    "absolute top-0.5 left-0 size-4 rounded-full bg-paper transition-transform",
                    wellSupportedOnly ? "translate-x-4" : "translate-x-0.5",
                  )}
                />
              </span>
              {TOGGLE_LABEL}
            </button>
            <p
              data-slot="ancestry-chip"
              data-chip="unassignable"
              className="inline-flex flex-wrap items-baseline gap-x-2 rounded-full border border-line px-3 py-1 text-sm text-ink-muted"
            >
              <span>{CHIP_LABELS.unassignable}</span>
              {nodes[chipIndex]}
            </p>
            <p
              data-slot="ancestry-chip"
              data-chip="hidden"
              className="inline-flex flex-wrap items-baseline gap-x-2 rounded-full border border-line px-3 py-1 text-sm text-ink-muted"
            >
              <span>{CHIP_LABELS.hidden}</span>
              {nodes[chipIndex + 1]}
            </p>
          </div>
          <RegionList
            rows={rows}
            figures={nodes.slice(0, rows.length)}
            visibleCodes={visibleCodes}
            selectedCode={openCode}
          />
          <div className="space-y-2 text-sm text-ink-muted">
            <p>{RANGE_UNAVAILABLE}</p>
            <p>{panelLine(panel)}</p>
            <p className="flex flex-wrap items-baseline gap-x-2">
              <span>{markersLine(result.markersUsed, panel, minMarkers)}</span>
              {panel.known === false ? null : nodes[coverageIndex]}
            </p>
            <p>{MARKER_GLOSS}</p>
            {panel.known === false ? null : <p>{RESOLUTION_LIMIT}</p>}
            <p>{subContinental(panel)}</p>
            <p>{NO_SEGMENTED_CONTROL}</p>
            <p className="text-ink">{IDENTITY}</p>
          </div>
        </div>
        {selectedRow ? (
          <div ref={panelRef} className="min-w-0">
            <RegionPanel
              knownPanel={panel.known !== false}
              row={selectedRow}
              figure={nodes[panelIndex]}
              markersLine={markersLine(result.markersUsed, panel, minMarkers)}
              closeRef={closeRef}
              onClose={() => close(true)}
            />
          </div>
        ) : null}
      </div>
    );
  }

  return <ClaimBlock subject={{ subjectId }} figures={figures} renderFigures={renderFigures} />;
}

export type { RegionRowView };
