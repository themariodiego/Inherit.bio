"use client";

import { useEffect, useRef, useState } from "react";
import {
  BROWSER_EMPTY_REGION,
  BROWSER_FAILED,
  BROWSER_KEYBOARD_ESCAPE,
  BROWSER_KEYBOARD_ESCAPED,
  BROWSER_LOADING,
  IGV_CONTROL_LABELS,
  TRACK_NAME,
} from "@/copy/genome/data";
import { chromToName } from "@/lib/genome/types";
import { labelIgvControls } from "./igv-accessibility";
import { enhanceIgvInteractions } from "./igv-interactions";
import { enhanceIgvTrackScrolling } from "./igv-track-scrolling";
import { enhanceIgvPopovers } from "./igv-popovers";
import { loadIgvReference } from "./igv-reference";

/** Ties the region to the sentence naming its escape key. */
const ESCAPE_HINT_ID = "genome-browser-keyboard-escape";

interface RegionVariant {
  rsid: number | null;
  chrom: number;
  pos: number;
  ref: string | null;
  alt: string | null;
  genotype: string;
}

// The viewer receives only inline variant features and a local File containing
// the public first-party chromosome sizes. Together with loadDefaultGenomes:
// false this avoids igv's external registry and URL mapping requests. Do not
// replace that File with a string URL: igv resolves strings externally first.
// The full browser network audit checks the actual installed library.

const CREATE_BROWSER_TIMEOUT_MS = 30_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`igv.createBrowser timed out after ${ms}ms`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export function GenomeBrowser({
  fileId,
  locus,
}: {
  fileId: string;
  locus: { chrom: number; start: number; end: number };
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const escapedRef = useRef<HTMLDivElement>(null);
  // Outcome keyed by the mounted region: while the key doesn't match the
  // current props the browser is (re)initializing, so "loading" is derived
  // rather than reset via setState inside the effect.
  const regionKey = `${fileId}:${locus.chrom}:${locus.start}-${locus.end}`;
  const [outcome, setOutcome] = useState<{
    key: string;
    status: "ready" | "error";
    variantCount: number | null;
  } | null>(null);
  const current = outcome && outcome.key === regionKey ? outcome : null;
  const status = current?.status ?? "loading";
  const variantCount = current?.variantCount ?? null;

  useEffect(() => {
    let disposed = false;
    const request = new AbortController();
    let browserRef: unknown = null;
    let disposeInteractions: (() => void) | undefined;
    let disposeScrolling: (() => void) | undefined;
    let disposePopovers: (() => void) | undefined;
    const key = `${fileId}:${locus.chrom}:${locus.start}-${locus.end}`;

    async function mount() {
      const el = containerRef.current;
      if (!el) return;

      const chromName = `chr${chromToName(locus.chrom) === "MT" ? "M" : chromToName(locus.chrom)}`;
      // The file identifier and the stretch of genome being read travel in the
      // body, never the URL: a query string is written to server logs,
      // referrers and traces, and this request names both a person's file and
      // exactly where in their genome they are looking.
      const res = await fetch("/api/browse/region", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: request.signal,
        body: JSON.stringify({
          file: fileId, chromosome: chromName, start: locus.start, end: locus.end,
        }),
      });
      if (!res.ok) {
        throw new Error(`region API responded ${res.status}`);
      }
      const { variants } = (await res.json()) as { variants: RegionVariant[] };
      if (disposed) return;

      const referenceFile = await loadIgvReference(request.signal);
      if (disposed) return;

      // Import igv's ESM build by subpath: the package's `browser` field
      // points at the UMD build, whose AMD-or-global dispatch leaves the
      // bundled module namespace empty (no createBrowser anywhere).
      interface IgvApi {
        createBrowser(el: HTMLElement, config: unknown): Promise<unknown>;
      }
      const igvModule = (await import("igv/dist/igv.esm.js")) as unknown as {
        default?: IgvApi;
      } & IgvApi;
      const igv = igvModule.default ?? igvModule;
      if (disposed) return;
      el.innerHTML = "";
      // igv's TS types don't model the chromsizes reference format or
      // inline `features` arrays; both are supported at runtime.
      const config = {
        // Without this, igv fetches its default genome registry from
        // igv.org on startup (see the privacy note above).
        loadDefaultGenomes: false,
        // Unknown names stay local; the page's own search resolves names.
        // Do not let location parameters add library tracks or sessions.
        search: false,
        queryParametersSupported: false,
        // The navbar keeps locus search and zoom only. Every other control
        // (chromosome picker, SVG export, sample names, multi-select, track
        // labels, centre line, cursor guide) is switched off through the
        // library's own display flags — each read by name in
        // node_modules/igv/dist/igv.esm.js (3.8.5) — so the first viewport
        // at 1280×800 stays within the twelve interactive elements X6.1
        // allows even with the track in view.
        showChromosomeWidget: false,
        showSVGButton: false,
        showSampleNameButton: false,
        showMultiSelectButton: false,
        showTrackLabelButton: false,
        showCenterGuideButton: false,
        showCursorTrackingGuideButton: false,
        reference: {
          id: "hg38-positions",
          name: "GRCh38 (positions only, no external sequence host)",
          format: "chromsizes",
          fastaURL: referenceFile,
        },
        locus: `${chromName}:${locus.start}-${locus.end}`,
        tracks: [
          {
            name: TRACK_NAME,
            type: "annotation",
            format: "bed",
            displayMode: "EXPANDED",
            color: "#2E5C45",
            features: variants.map((v) => ({
              chr: chromName,
              start: v.pos - 1,
              end: v.pos,
              name: `${v.rsid ? `rs${v.rsid} ` : ""}${v.genotype}${v.ref && v.alt ? ` (${v.ref}→${v.alt})` : ""}`,
            })),
          },
        ],
      };
      browserRef = await withTimeout(
        igv.createBrowser(el, config),
        CREATE_BROWSER_TIMEOUT_MS,
      );
      if (disposed) return;
      labelIgvControls(el, IGV_CONTROL_LABELS);
      disposeInteractions = enhanceIgvInteractions(el, IGV_CONTROL_LABELS, browserRef as Parameters<typeof enhanceIgvInteractions>[2]);
      disposeScrolling = enhanceIgvTrackScrolling(el, IGV_CONTROL_LABELS, browserRef as Parameters<typeof enhanceIgvTrackScrolling>[2]);
      disposePopovers = enhanceIgvPopovers(el, IGV_CONTROL_LABELS, browserRef as Parameters<typeof enhanceIgvPopovers>[2]);
      return variants.length;
    }

    const el = containerRef.current;
    mount().then(
      (count) => {
        if (!disposed && count !== undefined) {
          setOutcome({ key, status: "ready", variantCount: count });
        }
      },
      () => {
        if (!disposed) {
          setOutcome({ key, status: "error", variantCount: null });
        }
      },
    );
    return () => {
      disposed = true;
      request.abort();
      disposeInteractions?.();
      disposeScrolling?.();
      disposePopovers?.();
      if (browserRef && el) el.innerHTML = "";
    };
  }, [fileId, locus.chrom, locus.start, locus.end]);

  /**
   * The keyboard escape WCAG 2.1 SC 2.1.2 asks for.
   *
   * A forward exit independent of the number of controls inside the widget.
   * The reader is told which key does it
   * (BROWSER_KEYBOARD_ESCAPE, rendered above the region and referenced by it
   * through aria-describedby, so it is announced on entry rather than only
   * read by someone who happened to look).
   *
   * Bound in the capture phase on our own element, so it runs before anything
   * igv binds inside and needs no reach into igv's DOM.
   *
   * Focus goes to the next thing a Tab would have reached after the region,
   * so the traversal continues forwards from where it was rather than
   * restarting; the marker after the container is the fallback for a region
   * that is the last thing on the page.
   */
  function leaveOnEscape(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape") return;
    // Let an open menu or native modal handle Escape first. Its own close
    // restores the trigger; the next Escape still leaves the whole widget.
    if (event.nativeEvent.composedPath().some(node => node instanceof HTMLElement
      && node.getAttribute("data-igv-interaction") === "open")) return;
    const region = containerRef.current;
    if (!region) return;
    event.preventDefault();
    event.stopPropagation();
    const next = Array.from(
      document.querySelectorAll<HTMLElement>(
        'a[href],button,input,select,textarea,summary,[tabindex="0"]'),
    ).find(candidate =>
      !region.contains(candidate)
      && (region.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
      && candidate.tabIndex >= 0
      && !candidate.matches(":disabled")
      && candidate.getClientRects().length > 0);
    (next ?? escapedRef.current)?.focus();
  }

  if (status === "error") {
    return (
      <div
        role="alert"
        className="flex min-h-64 items-center justify-center rounded-xl border border-line bg-card p-6 text-center text-sm text-ink-muted"
      >
        {BROWSER_FAILED}
      </div>
    );
  }

  return (
    <div>
      {/* Before the region in reading order, so a keyboard reader meets the
          escape before the thing it escapes; `aria-describedby` on the region
          repeats it on entry for a reader who arrives by Tab. */}
      <p id={ESCAPE_HINT_ID} className="mb-2 text-xs text-ink-muted">
        {BROWSER_KEYBOARD_ESCAPE}
      </p>
      <div className="relative">
        {/* igv owns this element's DOM (we clear it before handing it over),
            so React must never render children into it — states render as
            siblings/overlays instead. */}
        <div
          ref={containerRef}
          data-testid="genome-browser"
          role="region"
          aria-label={IGV_CONTROL_LABELS.region}
          aria-describedby={ESCAPE_HINT_ID}
          onKeyDownCapture={leaveOnEscape}
          // igv renders its own navbar and tracks at whatever width it wants,
          // and at the 320px support floor that widened the whole document to
          // 485px rather than reflowing (WCAG 2.1 SC 1.4.10). Scrolling inside
          // this container keeps the page itself reflowed; the container needs
          // no tabindex because igv's own controls are focusable, so a
          // keyboard reaches its contents already.
          className="min-h-64 overflow-x-auto rounded-xl border border-line bg-white p-2 dark:bg-card"
        />
        {status === "loading" ? (
          <div
            className="absolute inset-0 flex items-center justify-center rounded-xl"
            aria-live="polite"
          >
            <p className="text-sm text-ink-muted">{BROWSER_LOADING}</p>
          </div>
        ) : null}
      </div>
      {/* Where Escape lands when the region is the last thing on the page.
          tabindex="-1" adds no tab stop, so it changes nothing for a reader
          who never presses Escape.

          The name is text content, not aria-label: a bare div has no role, and
          ARIA forbids naming an element with no role. The first version of
          this used aria-label and the axe sweep failed it as
          aria-prohibited-attr on all three viewports - a WCAG violation
          introduced while fixing one. Content is also the more reliable
          answer, because a screen reader announces what a focused element
          contains without depending on role semantics. */}
      <div ref={escapedRef} tabIndex={-1}>
        <span className="sr-only">{BROWSER_KEYBOARD_ESCAPED}</span>
      </div>
      {status === "ready" && variantCount === 0 ? (
        <p className="mt-2 max-w-prose rounded-lg border border-line bg-card px-3 py-2 text-xs text-ink-muted">
          {BROWSER_EMPTY_REGION}
        </p>
      ) : null}
    </div>
  );
}
