"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  availabilityFor,
  COUNTRIES,
  US_STATES,
  type Provider,
  type ProviderProduct,
} from "@/lib/providers";

const DEPTH_FILTERS = [
  { key: "all", label: "All test types" },
  { key: "array", label: "Genotyping array" },
  { key: "wgs", label: "Whole genome (30x+)" },
  { key: "specialty", label: "Y-DNA / mtDNA / exome" },
] as const;

// "Works with Inherit" per product row — derived mechanically from the raw
// file formats the product returns (formats_returned), never hand-labeled.
// Rules: array-txt/VCF/gVCF → supported; BAM/CRAM/FASTQ only or no
// compatible raw file → not usable under the current upload contract.
const NO_FILE_RE = /app\/portal|reports only|not stated|unverified/i;
const FULL_RE = /array|gvcf|\bvcf\b/i;
const UNSUPPORTED_RE = /\b(bam|cram|fastq)\b/i;

type Compat = {
  kind: "full" | "none";
  label: string;
  detail: string;
};

function compatFor(prod: ProviderProduct): Compat {
  const formats = (prod.formats_returned ?? []).filter(
    (f) => f.trim() !== "" && !NO_FILE_RE.test(f),
  );
  if (formats.length === 0) {
    return {
      kind: "none",
      label: "Not usable — no raw file",
      detail:
        "This product returns no raw data file, so Inherit has nothing to analyze.",
    };
  }
  if (formats.some((f) => FULL_RE.test(f))) {
    return {
      kind: "full",
      label: "Supported raw file",
      detail:
        "Returns an array or VCF file that Inherit can prepare. Choose reports separately; findings depend on what your file covers.",
    };
  }
  if (formats.some((f) => UNSUPPORTED_RE.test(f))) {
    return {
      kind: "none",
      label: "Not usable — needs a VCF",
      detail:
        "Returns BAM/CRAM/FASTQ only. Inherit does not accept these files. Ask the lab for a VCF, or create one with your own variant-calling tools.",
    };
  }
  return {
    kind: "none",
    label: "Not usable — no compatible raw file",
    detail:
      "The raw files this product returns are not a format Inherit can analyze.",
  };
}

// One-line explanations for the Depth column (also stated visibly in the
// explainer box above the directory — the tooltip is a convenience, not the
// only conveyance).
function depthTip(depth: string): string {
  const d = depth.toLowerCase();
  if (d.includes("array"))
    return "Genotyping array: tests ~700k specific common variants, not the whole genome.";
  if (d.includes("exome"))
    return "Exome sequencing: reads the ~2% of the genome that codes for proteins.";
  const cov = d.match(/(\d+)x/);
  if (cov)
    return `Whole genome sequencing at ${cov[1]}x: reads (nearly) every position of your genome, about ${cov[1]} times over on average.`;
  if (d.includes("wgs") || d.includes("whole"))
    return "Whole genome sequencing: reads (nearly) every position of your genome.";
  if (d.includes("mtdna") || d.includes("mitochondrial"))
    return "Mitochondrial DNA only: maternal-line ancestry, not genome-wide reports.";
  if (d.includes("y-dna") || d.includes("y-snp") || d.includes("y-str"))
    return "Y chromosome only: paternal-line ancestry, not genome-wide reports.";
  if (d.includes("rna"))
    return "RNA gene-expression test — not a DNA genome test.";
  return "";
}

// Horizontal-scroll wrapper for the product tables: the table scrolls inside
// this container (the page body never scrolls horizontally), and a right-edge
// fade appears only while there is more table to the right — a swipe
// affordance on narrow screens. The fade is a decorative, pointer-inert,
// aria-hidden overlay, so it is invisible to axe.
function ScrollableTable({
  children,
  labelledBy,
}: {
  children: ReactNode;
  labelledBy: string;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState(false);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const update = () => {
      const canScroll = el.scrollWidth > el.clientWidth + 1;
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
      setFade(canScroll && !atEnd);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    el.addEventListener("scroll", update, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", update);
    };
  }, []);

  return (
    <div className="relative">
      {/* Focusable and named: the table is wider than a phone, and a
          scrolling container nothing can focus is unreachable by keyboard
          (axe `scrollable-region-focusable`, sixteen of them on this page at
          320x568 and 390x844). It borrows the provider heading above it
          rather than carrying a second copy of the name. */}
      <div
        ref={scrollerRef}
        className="overflow-x-auto rounded-sm"
        role="region"
        aria-labelledby={labelledBy}
        tabIndex={0}
      >
        {children}
      </div>
      {fade ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-10"
          style={{
            background: "linear-gradient(to left, var(--card), transparent)",
          }}
        />
      ) : null}
    </div>
  );
}

function depthClass(p: Provider): Set<string> {
  const classes = new Set<string>();
  for (const prod of p.products) {
    const d = prod.depth.toLowerCase();
    if (d.includes("array")) classes.add("array");
    else if (/\b(30x|50x|100x|120x|wgs|whole)/.test(d)) classes.add("wgs");
    else classes.add("specialty");
  }
  return classes;
}

const TH = "h-row pr-4 align-middle text-xs font-medium text-ink-muted";
const TD = "py-4 pr-4 align-top";

export function ProviderDirectory({ providers }: { providers: Provider[] }) {
  const [country, setCountry] = useState("US");
  const [usState, setUsState] = useState<string>("");
  const [depth, setDepth] = useState<string>("all");

  const rows = useMemo(() => {
    return providers
      .map((p) => ({
        provider: p,
        availability: availabilityFor(p, country, usState || undefined),
      }))
      .filter(
        ({ provider }) => depth === "all" || depthClass(provider).has(depth),
      )
      .sort((a, b) => {
        if (a.availability.available !== b.availability.available) {
          return a.availability.available ? -1 : 1;
        }
        return a.provider.name.localeCompare(b.provider.name);
      });
  }, [providers, country, usState, depth]);

  return (
    <div className="stack-blocks">
      {/* One plate: the explainer under its labelled edge, then the filters
          under a hairline. The explainer keeps its own region and heading. */}
      <div className="plate">
        <section aria-labelledby="test-types-heading">
          <div className="plate-head">
            <h2 id="test-types-heading" className="eyebrow py-1">
              New to this? What the three test types mean
            </h2>
          </div>
          <div className="plate-body">
            <ul className="max-w-measure space-y-3 text-ink">
              <li>
                <strong className="font-semibold">
                  Genotyping array (~$30–120):
                </strong>{" "}
                tests a set of common variants. Inherit can prepare supported array
                text files; each report depends on the positions covered.
              </li>
              <li>
                <strong className="font-semibold">
                  Whole genome 30x (~$200–1,000):
                </strong>{" "}
                aims to read across the genome. Some positions may be missing or
                unclear; a VCF/gVCF file is needed for upload.
              </li>
              <li>
                <strong className="font-semibold">Exome/other:</strong> reads
                protein-coding regions; coverage varies.
              </li>
            </ul>
            <p className="mt-4 max-w-measure text-ink">
              Check which raw files the lab provides before you buy. Choose reports
              after your file is prepared; no test type covers every finding.
            </p>
          </div>
        </section>

        <div className="plate-body border-t border-line">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="country-select">Your country</Label>
              <Select
                value={country}
                onValueChange={(v) => {
                  setCountry(v);
                  if (v !== "US") setUsState("");
                }}
              >
                <SelectTrigger id="country-select" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COUNTRIES.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {country === "US" ? (
              <div className="space-y-2">
                <Label htmlFor="state-select">State</Label>
                <Select value={usState} onValueChange={setUsState}>
                  <SelectTrigger id="state-select" className="w-full">
                    <SelectValue placeholder="Choose a state" />
                  </SelectTrigger>
                  <SelectContent>
                    {US_STATES.map((s) => (
                      <SelectItem key={s.code} value={s.code}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="depth-select">Test type</Label>
              <Select value={depth} onValueChange={setDepth}>
                <SelectTrigger id="depth-select" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DEPTH_FILTERS.map((d) => (
                    <SelectItem key={d.key} value={d.key}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="caption mt-4 max-w-measure">
            Location is used only to filter this list, in your browser. Inherit
            never asks for a street address and never takes payment — you buy from
            the provider directly.
          </p>
        </div>
      </div>

      <ul className="space-y-6">
        {rows.map(({ provider: p, availability }) => {
          // A provider where every product is "Not usable" still gets a buy
          // link (people may want it for other reasons) but a quiet one.
          const anyUsable = p.products.some(
            (prod) => compatFor(prod).kind !== "none",
          );
          return (
            <li
              key={p.slug}
              data-testid={`provider-${p.slug}`}
              className={`surface overflow-hidden ${availability.available ? "" : "opacity-60"}`}
            >
              {/* The labelled edge: name, where it ships, and availability
                  as plain text when the provider cannot serve this place. */}
              <div className="plate-head items-start py-3 sm:items-center">
                <div className="min-w-0">
                  <h2 id={`provider-${p.slug}-name`} className="title">
                    {p.name}
                  </h2>
                  <p className="caption mt-0.5">
                    Ships to: {p.ships_to}
                    {p.shipping.note ? ` (${p.shipping.note})` : ""}
                  </p>
                </div>
                {!availability.available ? (
                  <p className="max-w-[18rem] shrink-0 text-sm text-ink sm:text-right">
                    {availability.reason}
                  </p>
                ) : null}
              </div>

              <div className="surface-pad-sm">
                {availability.available && availability.stateFlag ? (
                  <p
                    data-testid="state-exclusion-flag"
                    className="surface-tint mb-4 px-4 py-3 text-sm text-ink"
                  >
                    ⚠ {availability.stateFlag}
                  </p>
                ) : null}

                {/* Phone and tablet: each product is an inset block that
                    states everything a buyer compares before the Buy action. */}
                <div className="space-y-4 lg:hidden">
                  {p.products.map((prod, index) => {
                    const compat = compatFor(prod);
                    return (
                      <section
                        key={index}
                        className="surface-inset surface-pad-sm"
                        aria-label={prod.name}
                      >
                        <h3 className="title">{prod.name}</h3>
                        <p
                          className={`label mt-2 ${compat.kind === "full" ? "text-forest" : "text-ink"}`}
                        >
                          {compat.label}
                        </p>
                        <p className="mt-1 text-sm text-ink">
                          {compat.detail}
                        </p>
                        <dl className="mt-4 grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-x-4 gap-y-3 text-sm">
                          <dt className="text-ink-muted">Price</dt>
                          <dd className="text-ink">
                            {prod.price}
                            <span className="caption mt-1 block">
                              Captured {p.last_verified_at}
                            </span>
                          </dd>
                          <dt className="text-ink-muted">Raw files you get</dt>
                          <dd className="text-ink">
                            {(prod.formats_returned ?? []).join(", ") || "—"}
                          </dd>
                          <dt className="text-ink-muted">Depth</dt>
                          <dd className="text-ink">{prod.depth}</dd>
                          <dt className="text-ink-muted">
                            Advertised turnaround
                          </dt>
                          <dd className="text-ink">{prod.turnaround || "—"}</dd>
                        </dl>
                      </section>
                    );
                  })}
                </div>
                <div className="hidden lg:block">
                  {/* Desktop comparison keeps compatibility next to the product.
                  Narrow screens use the labelled product summaries above. */}
                  <ScrollableTable labelledBy={`provider-${p.slug}-name`}>
                    <table className="w-full min-w-[44rem] text-left text-sm">
                      <thead>
                        <tr className="border-b border-line">
                          <th className={TH}>Product</th>
                          <th className={TH}>
                            Works with Inherit
                          </th>
                          <th className={TH}>Depth</th>
                          <th className={TH}>
                            Price (captured {p.last_verified_at})
                          </th>
                          <th className={TH}>
                            Raw files you get
                          </th>
                          <th className={`${TH} pr-0`}>
                            Advertised turnaround
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.products.map((prod, i) => {
                          const tip = depthTip(prod.depth);
                          const compat = compatFor(prod);
                          return (
                            <tr
                              key={i}
                              className="h-row border-t border-line first:border-t-0"
                            >
                              <td className={`${TD} font-medium text-ink`}>{prod.name}</td>
                              <td className={TD}>
                                <Badge
                                  variant="outline"
                                  title={compat.detail}
                                  className={`max-w-[13rem] whitespace-normal rounded-sm py-1 text-left ${
                                    compat.kind === "none" ? "text-ink-muted" : ""
                                  }`}
                                >
                                  {compat.label}
                                </Badge>
                              </td>
                              <td
                                className={`${TD} ${tip ? "cursor-help" : ""}`}
                                title={tip || undefined}
                                aria-label={
                                  tip ? `${prod.depth} — ${tip}` : undefined
                                }
                              >
                                {prod.depth}
                              </td>
                              <td className={TD}>{prod.price}</td>
                              <td className={`${TD} text-xs text-ink-muted`}>
                                {(prod.formats_returned ?? []).join(", ") || "—"}
                              </td>
                              <td className="py-4 align-top text-xs text-ink-muted">
                                {prod.turnaround || "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </ScrollableTable>
                </div>

                {/* The outbound action comes after the comparison, never
                    before it; gating text wraps beside it inside the card. */}
                <div className="mt-6 flex min-w-0 max-w-full flex-wrap items-center justify-end gap-3">
                  {p.gating ? (
                    <Badge
                      variant="outline"
                      className="max-w-full shrink whitespace-normal rounded-sm py-1 text-left"
                    >
                      {p.gating}
                    </Badge>
                  ) : null}
                  {availability.available ? (
                    <Button
                      asChild
                      variant="outline"
                      className={anyUsable ? undefined : "text-ink-muted"}
                    >
                      <a
                        href={p.checkout_url}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        title={
                          anyUsable
                            ? undefined
                            : "This provider returns no raw file Inherit can use"
                        }
                      >
                        Buy through provider ↗
                      </a>
                    </Button>
                  ) : null}
                </div>

                <div className="caption mt-6 space-y-1 border-t border-line pt-4">
                  {p.data_practices_note ? (
                    <p>
                      <strong className="font-semibold text-ink">Data practices:</strong> {p.data_practices_note}{" "}
                      {p.privacy_policy_url ? (
                        <a
                          href={p.privacy_policy_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="prose-link"
                        >
                          Privacy policy ↗
                        </a>
                      ) : null}
                    </p>
                  ) : null}
                  <p>
                    Verified {p.last_verified_at} ·{" "}
                    {p.source_urls.slice(0, 3).map((u, i) => (
                      <a
                        key={u}
                        href={u}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="prose-link"
                      >
                        source {i + 1}{" "}
                      </a>
                    ))}
                    {p.affiliate
                      ? "· Inherit may earn a commission if you buy through this affiliate link. We show this here so you can see it."
                      : "· No affiliate relationship."}
                  </p>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
