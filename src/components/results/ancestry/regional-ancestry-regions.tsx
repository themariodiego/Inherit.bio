"use client";

import { Fragment, useState, type ReactNode } from "react";
import { ClaimBlock } from "@/components/figures/claim-block";
import { CHIP_LABELS, IDENTITY, MARKER_GLOSS, RAW_NUMBERS_SUMMARY } from "@/copy/ancestry";
import {
  REGIONAL_FILTER_NOTE, REGIONAL_FIT_LIMIT, REGIONAL_HIDDEN_LABEL, REGIONAL_MAP_CAPTION, REGIONAL_MAP_LABEL,
  REGIONAL_MAP_LIMIT, REGIONAL_NO_RANGE, REGIONAL_NO_RESULT, REGIONAL_SPLIT_SUMMARY,
  REGIONAL_TOGGLE_LABEL, REGIONAL_UNASSIGNABLE_NOTE, regionalBelowMinimum, regionalPanelLine,
} from "@/copy/regional-ancestry";
import type { MapShapes } from "@/lib/ancestry/geometry";
import { presentRegionalShares, regionalChipShares, regionalReportingShapes } from "@/lib/ancestry/regional-present";
import { REGIONAL_COMBINED_CODE, REGIONAL_SPLIT_CODES, type RegionalReferenceFacts } from "@/lib/ancestry/regional-regions";
import type { RegionalAdmixtureResult } from "@/lib/genome/regional-admixture";
import type { AncestryShareSpec, StandaloneFigureSpec } from "@/lib/figures/spec";
import { AncestryMap } from "./ancestry-map";
import { useAncestryRegionPanel } from "./use-ancestry-region-panel";

const PROVENANCE = { kind: "computed", module: "src/lib/genome/regional-admixture.ts" } as const;
function shareSpec(share: number): AncestryShareSpec {
  return { kind: "ancestry-share", class: "ancestry", basis: "modelled", provenance: PROVENANCE,
    share, range: { unavailable: true } };
}

export interface RegionalAncestryRegionsProps {
  subjectId: string;
  result: RegionalAdmixtureResult | null;
  minMarkers: number;
  panel: { markers: number; version: string };
  reference: RegionalReferenceFacts;
  shapes: MapShapes;
  initialWellSupportedOnly?: boolean;
}

/** Versioned seven-region surface. No estimator or reference marker table enters this client boundary. */
export function RegionalAncestryRegions(props: RegionalAncestryRegionsProps) {
  const { result, minMarkers, shapes, panel, reference } = props;
  if (!result?.proportions || result.markersUsed < minMarkers) return (
    <div data-slot="regional-ancestry" className="space-y-4">
      <AncestryMap shapes={shapes} rows={[]} mode="grey" label={REGIONAL_MAP_LABEL} caption={REGIONAL_MAP_CAPTION} />
      {/* inherit-figure-exempt: quality counts explain why no result is displayed */}
      <p data-slot="grey-state">{result ? regionalBelowMinimum(result.markersUsed, minMarkers) : REGIONAL_NO_RESULT}</p>
      {result ? <p data-slot="stored-support-note" className="text-sm text-ink-muted">{result.note}</p> : null}
      {/* inherit-figure-exempt: versioned reference metadata, not a subject result */}
      <p className="text-sm text-ink-muted">{regionalPanelLine(panel, reference)}</p>
      <p className="text-sm text-ink-muted">{MARKER_GLOSS}</p>
      <p className="text-sm text-ink-muted">{IDENTITY}</p>
      {result?.proportions && result.markersUsed > 0 ? <RawRegionalRows subjectId={props.subjectId} result={result} minMarkers={minMarkers} /> : null}
    </div>
  );
  return <ShownRegionalRegions {...props} result={result} />;
}

/** Retain derived rows (G5.3a) without presenting an insufficient-panel fit as a supported result. */
function RawRegionalRows({ subjectId, result, minMarkers }: {
  subjectId: string; result: RegionalAdmixtureResult; minMarkers: number;
}) {
  const { rows, split } = presentRegionalShares(result);
  return <details data-slot="raw-numbers">
    <summary className="min-h-11 cursor-pointer py-3 text-sm text-ink-muted underline decoration-dotted underline-offset-2">{RAW_NUMBERS_SUMMARY}</summary>
    <ClaimBlock subject={{ subjectId }} figures={[...rows, ...split].map(row => shareSpec(row.share))}
      renderFigures={nodes => <div className="space-y-3 text-sm text-ink-muted">
        {/* inherit-figure-exempt: coverage explains why these raw estimates are unreliable */}
        <p className="text-ink">Only {result.markersUsed} of the required {minMarkers} usable markers were read. These raw estimates are unreliable. They may change greatly with the missing markers.</p>
        <p>{result.note}</p><p data-slot="regional-caveat">{result.reporting.caveat}</p>
        <ul data-slot="raw-numbers-list" className="space-y-2">{rows.map((row, index) =>
          <li key={row.code} data-region={row.code} className="flex flex-wrap items-baseline gap-x-3"><span>{row.name}</span>{nodes[index]}</li>)}</ul>
        {split.length ? <details data-slot="regional-split">
          <summary className="min-h-11 cursor-pointer py-3 underline decoration-dotted underline-offset-2">{REGIONAL_SPLIT_SUMMARY}</summary>
          <p data-slot="regional-split-caveat" className="mb-3">{result.reporting.caveat}</p>
          <div className="space-y-2">{split.map((row, index) => <p key={row.code} data-split-region={row.code}
            className="flex flex-wrap items-baseline gap-x-3"><span>{row.name}</span>{nodes[rows.length + index]}</p>)}</div>
        </details> : null}
        <p>{REGIONAL_NO_RANGE}</p>{!result.fit.converged ? <p data-slot="fit-limit">{REGIONAL_FIT_LIMIT}</p> : null}
      </div>} />
  </details>;
}

function ShownRegionalRegions({ subjectId, result, panel, reference, shapes, minMarkers,
  initialWellSupportedOnly = true }: RegionalAncestryRegionsProps & { result: RegionalAdmixtureResult }) {
  const { rows, split } = presentRegionalShares(result);
  const reportingShapes = regionalReportingShapes(shapes, result.reporting.merged);
  const [wellSupportedOnly, setWellSupportedOnly] = useState(initialWellSupportedOnly);
  const visibleRows = rows.filter(row => !wellSupportedOnly || row.wellSupported);
  const { openCode, pathRef, panelRef, closeRef, onHover, onActivate, close } = useAncestryRegionPanel(visibleRows.map(row => row.code));
  const selectedRow = visibleRows.find(row => row.code === openCode) ?? null;
  const chips = regionalChipShares(rows, wellSupportedOnly);
  const splitIndex = rows.length;
  const chipIndex = splitIndex + split.length;
  const coverageIndex = chipIndex + 2;
  const selectedIndex = coverageIndex + 1;
  const figures: StandaloneFigureSpec[] = [
    ...rows.map(row => shareSpec(row.share)), ...split.map(row => shareSpec(row.share)),
    shareSpec(chips.unassignable), shareSpec(chips.hidden),
    { kind: "coverage", class: "quality", basis: "observed", provenance: PROVENANCE,
      read: result.markersUsed, needed: panel.markers },
    ...(selectedRow ? [shareSpec(selectedRow.share)] : []),
  ];
  function renderFigures(nodes: ReactNode[]) {
    const selectedCodes: readonly string[] = selectedRow?.code === REGIONAL_COMBINED_CODE
      ? REGIONAL_SPLIT_CODES : [selectedRow?.code ?? ""];
    const selectedReference = reference.regions.filter(region => selectedCodes.includes(region.code));
    return (
      <div data-slot="regional-ancestry" data-fit-converged={String(result.fit.converged)} className="space-y-4">
        <AncestryMap shapes={reportingShapes} rows={visibleRows} mode="shown"
          label={REGIONAL_MAP_LABEL} caption={REGIONAL_MAP_CAPTION} selectedCode={openCode}
          pathRef={pathRef} onHover={onHover} onActivate={onActivate} />
        <p data-slot="regional-caveat" className="text-sm text-ink">{result.reporting.caveat}</p>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" role="switch" aria-checked={wellSupportedOnly}
            data-slot="well-supported-toggle" onClick={() => setWellSupportedOnly(value => !value)}
            className="inline-flex min-h-11 items-center gap-3 rounded-full border border-line bg-card px-4 text-sm text-ink focus-visible:outline-3 focus-visible:outline-forest">
            <span aria-hidden="true" className={`relative inline-block h-5 w-9 shrink-0 rounded-full ${wellSupportedOnly ? "bg-forest" : "bg-line"}`}>
              <span className={`absolute top-0.5 left-0 size-4 rounded-full bg-paper ${wellSupportedOnly ? "translate-x-4" : "translate-x-0.5"}`} />
            </span>
            {REGIONAL_TOGGLE_LABEL}
          </button>
          <p data-slot="ancestry-chip" data-chip="unassignable" className="inline-flex flex-wrap items-baseline gap-x-2 rounded-full border border-line px-3 py-1 text-sm text-ink-muted">
            <span>{CHIP_LABELS.unassignable}</span>{nodes[chipIndex]}
          </p>
          <p data-slot="ancestry-chip" data-chip="hidden" className="inline-flex flex-wrap items-baseline gap-x-2 rounded-full border border-line px-3 py-1 text-sm text-ink-muted">
            <span>{REGIONAL_HIDDEN_LABEL}</span>{nodes[chipIndex + 1]}
          </p>
        </div>
        <p data-slot="regional-filter-note" className="text-sm text-ink-muted">{REGIONAL_FILTER_NOTE}</p>
        <table data-slot="region-table" className="w-full text-left text-sm">
          <caption className="sr-only">{REGIONAL_MAP_CAPTION}</caption>
          <thead><tr className="border-b border-line text-ink-muted">
            <th scope="col" className="py-2 pr-3 font-medium">Region</th>
            <th scope="col" className="py-2 pr-3 font-medium">Share</th>
            <th scope="col" className="py-2 font-medium">In words</th>
          </tr></thead>
          <tbody>{rows.map((row, index) => <Fragment key={row.code}>
            <tr data-slot="region-row" data-region={row.code} hidden={wellSupportedOnly && !row.wellSupported}
              aria-selected={row.code === openCode} className="border-b border-line">
              <th scope="row" data-slot="region-name" className="py-3 pr-3 font-medium">{row.name}</th>
              <td className="py-3 pr-3">{nodes[index]}</td><td data-slot="region-band" className="py-3 text-ink-muted">{row.band}</td>
            </tr>
            {row.code === REGIONAL_COMBINED_CODE ? <tr><td colSpan={3} className="pb-3">
              <details data-slot="regional-split">
                <summary className="min-h-11 cursor-pointer py-3 text-ink underline decoration-dotted underline-offset-2">
                  {REGIONAL_SPLIT_SUMMARY}
                </summary>
                <p data-slot="regional-split-caveat" className="mb-3 text-sm text-ink">{result.reporting.caveat}</p>
                <ul className="space-y-2">{split.map((part, i) => <li key={part.code} data-split-region={part.code}
                  className="flex flex-wrap items-baseline gap-x-3"><span>{part.name}</span>{nodes[splitIndex + i]}</li>)}</ul>
                <p className="mt-3 text-sm text-ink-muted">{REGIONAL_NO_RANGE}</p>
              </details>
            </td></tr> : null}
          </Fragment>)}</tbody>
        </table>
        {selectedRow ? <div ref={panelRef} role="dialog" aria-modal="false" aria-label={`${selectedRow.name} region`}
          data-slot="region-panel" data-region={selectedRow.code} className="space-y-3 rounded-2xl border border-line bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3"><h3 data-slot="region-title" className="font-medium">{selectedRow.name}</h3>
            <button ref={closeRef} type="button" onClick={() => close(true)}
              className="min-h-11 min-w-11 rounded-full border border-line px-3 focus-visible:outline-3 focus-visible:outline-forest">Close</button>
          </div>
          {nodes[selectedIndex]}
          <p className="text-sm text-ink">{result.reporting.caveat}</p>
          {/* inherit-figure-exempt: reference sample counts describe the panel, not this subject */}
          <p className="text-sm text-ink-muted">This reference combines {selectedReference.reduce((sum, region) => sum + region.referenceSampleCount, 0)} samples
            {" "}from {selectedReference.reduce((sum, region) => sum + region.populationCount, 0)} study groups. The map is a guide to place, not a set of sample sites.</p>
          <p className="text-sm text-ink-muted">{REGIONAL_NO_RANGE}</p>
        </div> : null}
        <div className="space-y-2 text-sm text-ink-muted">
          <p data-slot="stored-support-note">{result.note}</p>
          {!result.note.includes("no tested range yet") ? <p data-slot="range-note">{REGIONAL_NO_RANGE}</p> : null}
          {!result.fit.converged ? <p data-slot="fit-limit" className="text-ink">{REGIONAL_FIT_LIMIT}</p> : null}
          <p>{REGIONAL_UNASSIGNABLE_NOTE}</p>
          {/* inherit-figure-exempt: versioned reference metadata, not a subject result */}
          <p>{regionalPanelLine(panel, reference)}</p>
          {/* inherit-figure-exempt: admission threshold metadata, paired with the attributed coverage figure */}
          <p className="flex flex-wrap items-baseline gap-x-2"><span>This result needs at least {minMarkers} usable ancestry markers.</span>{nodes[coverageIndex]}</p>
          <p>{MARKER_GLOSS}</p><p>{REGIONAL_MAP_LIMIT}</p><p className="text-ink">{IDENTITY}</p>
        </div>
      </div>
    );
  }
  return <ClaimBlock subject={{ subjectId }} figures={figures} renderFigures={renderFigures} />;
}
