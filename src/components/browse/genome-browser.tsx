"use client";

import { useEffect, useRef, useState } from "react";
import { chromToName } from "@/lib/genome/types";

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
function labelIgvControls(root: HTMLElement) {
  try {
    const label = (el: Element | null, name: string, asButton = false) => {
      if (!el || el.hasAttribute("aria-label")) return;
      el.setAttribute("aria-label", name);
      if (asButton && !el.hasAttribute("role")) {
        el.setAttribute("role", "button");
      }
    };

    // Chromosome picker: a bare 26-option <select> with no name.
    label(
      root.querySelector(".igv-chromosome-select-widget-container select"),
      "Chromosome",
    );

    // Locus search box (placeholder-only otherwise) and its icon "button".
    label(root.querySelector("input.igv-search-input"), "Search by locus");
    label(root.querySelector(".igv-search-icon-container"), "Search", true);

    // Zoom widget: [zoom-out div] [slider] [zoom-in div], per ZoomWidget's
    // construction order in the igv dist.
    const zoom = root.querySelector(".igv-zoom-widget");
    if (zoom) {
      label(zoom.querySelector("input[type='range']"), "Zoom level");
      label(zoom.firstElementChild, "Zoom out", true);
      label(zoom.lastElementChild, "Zoom in", true);
    }

    // Navbar toggle buttons (cursor guide, center line, track labels, …)
    // are divs carrying only a title tooltip; promote it to a real name.
    for (const btn of root.querySelectorAll(
      ".igv-navbar-text-button, .igv-navbar-icon-button",
    )) {
      const title = btn.getAttribute("title");
      if (title) label(btn, title, true);
    }

    // The igv logo is decorative.
    root.querySelector(".igv-logo")?.setAttribute("aria-hidden", "true");
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
      const res = await fetch(
        `/api/browse/region?file=${fileId}&chrom=${chromName}&start=${locus.start}&end=${locus.end}`,
      );
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
        reference: {
          id: "hg38-positions",
          name: "GRCh38 (positions only, no external sequence host)",
          format: "chromsizes",
          fastaURL: "/genomes/hg38.chrom.sizes",
        },
        locus: `${chromName}:${locus.start}-${locus.end}`,
        tracks: [
          {
            name: "Your variants",
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

  if (status === "error") {
    return (
      <div
        role="alert"
        className="flex min-h-64 items-center justify-center rounded-xl border border-line bg-card p-6 text-center text-sm text-ink-muted"
      >
        The genome browser could not load — your variants are still listed
        above.
      </div>
    );
  }

  return (
    <div>
      <div className="relative">
        {/* igv owns this element's DOM (we clear it before handing it over),
            so React must never render children into it — states render as
            siblings/overlays instead. */}
        <div
          ref={containerRef}
          data-testid="genome-browser"
          role="region"
          aria-label="Interactive genome browser"
          className="min-h-64 rounded-xl border border-line bg-white p-2 dark:bg-card"
        />
        {status === "loading" ? (
          <div
            className="absolute inset-0 flex items-center justify-center rounded-xl"
            aria-live="polite"
          >
            <p className="text-sm text-ink-muted">
              Loading the genome browser…
            </p>
          </div>
        ) : null}
      </div>
      {status === "ready" && variantCount === 0 ? (
        <p className="mt-2 rounded-lg border border-line bg-card px-3 py-2 text-xs text-ink-muted">
          Your file has no variants in this region, so the track above is
          empty — that reflects your file&apos;s coverage, not an error.
        </p>
      ) : null}
    </div>
  );
}
