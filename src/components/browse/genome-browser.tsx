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

// igv.js over the user's own data, privacy-preserving by construction:
// the genome is a first-party chromsizes-only reference (no sequence host),
// and the only data fetch is our own RLS-scoped region API. No third-party
// origin is contacted — verified by the E2E network audit (which loads this
// page and asserts the full set of request origins is first-party only).
//
// Keeping that claim true takes two mechanisms, because igv.js phones home
// in two independent places (node_modules/igv/dist/igv.esm.js, v3.8.5):
//
// 1. `loadDefaultGenomes: false` in the createBrowser config — the
//    documented option that stops GenomeUtils.initializeGenomes from
//    fetching https://igv.org/genomes/genomes3.json (guarded by
//    `config.loadDefaultGenomes !== false` in the dist).
// 2. The XHR guard below — igv's transport (igvxhr) resolves EVERY string
//    URL it loads through `convert()`, which lazily fetches
//    https://igv.org/data/url_mappings.tsv the first time any URL (even our
//    own /genomes/hg38.chrom.sizes) is loaded. No config option disables
//    that, and igvxhr uses XMLHttpRequest, not fetch, so a fetch wrapper
//    would not intercept it.

/**
 * Fails any cross-origin XMLHttpRequest locally, before a connection is
 * opened. igv.js is the only XHR user in this app (the app itself uses
 * fetch), and every URL igv legitimately needs here is same-origin (the
 * chromsizes reference and the region API). igv treats the synthetic error
 * exactly like a network failure: its `convert()` url_mappings lookup is
 * wrapped in try/catch and proceeds with the unmapped URL, so rendering is
 * unaffected — the request simply never leaves the browser.
 */
let xhrGuardInstalled = false;
function installFirstPartyXhrGuard() {
  if (xhrGuardInstalled || typeof window === "undefined") return;
  xhrGuardInstalled = true;

  const blocked = new WeakSet<XMLHttpRequest>();
  const proto = XMLHttpRequest.prototype;
  const originalOpen = proto.open;
  const originalSend = proto.send;

  proto.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    async: boolean = true,
    username?: string | null,
    password?: string | null,
  ) {
    try {
      const resolved = new URL(String(url), window.location.href);
      if (resolved.origin === window.location.origin) {
        blocked.delete(this);
      } else {
        blocked.add(this);
      }
    } catch {
      // Malformed URL: let the native open raise its own error.
    }
    // Still open (open does not touch the network) so callers can set
    // headers etc. without an InvalidStateError; send() is what we stop.
    return originalOpen.call(this, method, url, async, username, password);
  };

  proto.send = function (
    this: XMLHttpRequest,
    body?: Document | XMLHttpRequestBodyInit | null,
  ) {
    if (blocked.has(this)) {
      setTimeout(() => this.dispatchEvent(new ProgressEvent("error")), 0);
      return;
    }
    return originalSend.call(this, body);
  };
}

const CREATE_BROWSER_TIMEOUT_MS = 30_000;

/**
 * Every root igv's markup can be in: the container it was handed, and any
 * shadow root it opened underneath.
 *
 * igv 3.8.5 renders its navbar into a shadow root, and `querySelector` does
 * not cross that boundary, so labelling the container alone silently matched
 * nothing — the zoom slider reached the page as a bare `<input type="range">`
 * and `e2e/a11y.spec.ts` caught it as the one violation on the variant
 * browser once that sweep covered the registered authenticated pages.
 */
function igvRoots(container: HTMLElement): ParentNode[] {
  const roots: ParentNode[] = [container];
  for (const element of [container, ...container.querySelectorAll<HTMLElement>("*")]) {
    if (element.shadowRoot) roots.push(element.shadowRoot);
  }
  return roots;
}

/**
 * igv.js (3.8.5) ships its navbar controls unlabeled: a bare <select> of
 * chromosomes, an unnamed zoom slider, and icon-only <div>s acting as
 * buttons. After createBrowser resolves we post-process the DOM igv built
 * and attach accessible names (and button roles where a plain div is
 * click-handled). Selectors follow the classnames in
 * node_modules/igv/dist/igv.esm.js — ChromosomeSelectWidget, ZoomWidget,
 * ResponsiveNavbar. Everything is best-effort inside try/catch: an igv
 * upgrade that renames a class must degrade to the old unlabeled state,
 * never crash the page.
 */
function labelIgvControls(container: HTMLElement) {
  try {
    const roots = igvRoots(container);
    const find = (selector: string): Element | null => {
      for (const root of roots) {
        const found = root.querySelector(selector);
        if (found) return found;
      }
      return null;
    };
    const findAll = (selector: string): Element[] =>
      roots.flatMap((root) => [...root.querySelectorAll(selector)]);
    const label = (el: Element | null, name: string, asButton = false) => {
      if (!el || el.hasAttribute("aria-label")) return;
      el.setAttribute("aria-label", name);
      if (asButton && !el.hasAttribute("role")) {
        el.setAttribute("role", "button");
      }
    };

    // Chromosome picker: a bare 26-option <select> with no name. Hidden by
    // the config below, but named in case a config change shows it again.
    label(
      find(".igv-chromosome-select-widget-container select"),
      IGV_CONTROL_LABELS.chromosome,
    );

    // Locus search box (placeholder-only otherwise) and its icon "button".
    label(find("input.igv-search-input"), IGV_CONTROL_LABELS.locusSearch);
    label(find(".igv-search-icon-container"), IGV_CONTROL_LABELS.locusSubmit, true);

    // Zoom widget: [zoom-out div] [slider] [zoom-in div], per ZoomWidget's
    // construction order in the igv dist.
    const zoom = find(".igv-zoom-widget");
    if (zoom) {
      label(zoom.querySelector("input[type='range']"), IGV_CONTROL_LABELS.zoomSlider);
      label(zoom.firstElementChild, IGV_CONTROL_LABELS.zoomOut, true);
      label(zoom.lastElementChild, IGV_CONTROL_LABELS.zoomIn, true);
    }

    // Navbar toggle buttons (cursor guide, center line, track labels, …)
    // are divs carrying only a title tooltip; promote it to a real name.
    for (const btn of findAll(".igv-navbar-text-button, .igv-navbar-icon-button")) {
      const title = btn.getAttribute("title");
      if (title) label(btn, title, true);
    }

    // The igv logo is decorative.
    find(".igv-logo")?.setAttribute("aria-hidden", "true");
  } catch {
    // Labeling is progressive enhancement over igv internals — never fatal.
  }
}

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
    let browserRef: unknown = null;
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
        body: JSON.stringify({
          file: fileId, chromosome: chromName, start: locus.start, end: locus.end,
        }),
      });
      if (!res.ok) {
        throw new Error(`region API responded ${res.status}`);
      }
      const { variants } = (await res.json()) as { variants: RegionVariant[] };
      if (disposed) return;

      installFirstPartyXhrGuard();

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
          fastaURL: "/genomes/hg38.chrom.sizes",
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
      labelIgvControls(el);
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
      if (browserRef && el) el.innerHTML = "";
    };
  }, [fileId, locus.chrom, locus.start, locus.end]);

  /**
   * The keyboard escape WCAG 2.1 SC 2.1.2 asks for.
   *
   * Tab past this browser's last control does not hand focus out of the
   * region — it returns to a stop already visited. Everything holding focus
   * in there is built by igv.js 3.8.5, shadow root included, so the tab order
   * is not ours to rewrite without owning the widget. SC 2.1.2 is met by the
   * second half of its own wording instead: focus can be moved away using
   * only the keyboard, and the reader is told which key does it
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
