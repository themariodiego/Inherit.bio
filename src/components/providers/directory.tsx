"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
// Rules: array-txt/VCF/gVCF → full reports; BAM/CRAM/FASTQ only → stored
// only; nothing usable returned → not usable.
const NO_FILE_RE = /app\/portal|reports only|not stated|unverified/i;
const FULL_RE = /array|gvcf|\bvcf\b/i;
const STORED_RE = /\b(bam|cram|fastq)\b/i;

type Compat = {
  kind: "full" | "stored" | "none";
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
      label: "Full reports",
      detail:
        "Returns an array/VCF raw file Inherit analyzes directly — most reports resolve.",
    };
  }
  if (formats.some((f) => STORED_RE.test(f))) {
    return {
      kind: "stored",
      label: "Stored only (analysis needs self-hosting)",
      detail:
        "Returns BAM/CRAM/FASTQ only — Inherit stores these, but analysis requires a self-hosted variant-calling step.",
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
function ScrollableTable({ children }: { children: ReactNode }) {
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
    <div className="relative mt-4">
      <div ref={scrollerRef} className="overflow-x-auto">
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
        ({ provider }) =>
          depth === "all" || depthClass(provider).has(depth),
      )
      .sort((a, b) => {
        if (a.availability.available !== b.availability.available) {
          return a.availability.available ? -1 : 1;
        }
        return a.provider.name.localeCompare(b.provider.name);
      });
  }, [providers, country, usState, depth]);

  return (
    <div className="space-y-6">
      <section
        aria-labelledby="test-types-heading"
        className="rounded-2xl border border-line bg-card p-4"
      >
        <h2 id="test-types-heading" className="text-sm font-medium">
          New to this? What the three test types mean
        </h2>
        <ul className="mt-2 space-y-1.5 text-sm text-ink-muted">
          <li>
            <strong className="font-medium text-ink">
              Genotyping array (~$30–120):
            </strong>{" "}
            tests ~700k common variants — works fully with Inherit, most
            reports resolve.
          </li>
          <li>
            <strong className="font-medium text-ink">
              Whole genome 30x (~$200–1,000):
            </strong>{" "}
            reads everything — fullest report coverage, biggest files.
          </li>
          <li>
            <strong className="font-medium text-ink">Exome/other:</strong>{" "}
            reads protein-coding regions; coverage varies.
          </li>
        </ul>
        <p className="mt-2 text-sm">
          If you&apos;re new and just want reports: an array kit is the
          cheapest way in; whole genome is the most complete.
        </p>
      </section>

      <div className="flex flex-wrap items-end gap-4 rounded-2xl border border-line bg-card p-4">
        <div className="space-y-1.5">
          <Label htmlFor="country-select">Your country</Label>
          <Select
            value={country}
            onValueChange={(v) => {
              setCountry(v);
              if (v !== "US") setUsState("");
            }}
          >
            <SelectTrigger id="country-select" className="w-52">
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
          <div className="space-y-1.5">
            <Label htmlFor="state-select">State</Label>
            <Select value={usState} onValueChange={setUsState}>
              <SelectTrigger id="state-select" className="w-52">
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
        <div className="space-y-1.5">
          <Label htmlFor="depth-select">Test type</Label>
          <Select value={depth} onValueChange={setDepth}>
            <SelectTrigger id="depth-select" className="w-52">
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
        <p className="basis-full text-xs text-ink-muted">
          Location is used only to filter this list, in your browser. Inherit
          never asks for a street address and never takes payment — you buy
          from the provider directly.
        </p>
      </div>

      <ul className="space-y-4">
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
            className={`rounded-2xl border border-line bg-card p-5 ${availability.available ? "" : "opacity-60"}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-medium">{p.name}</h2>
                <p className="mt-0.5 text-xs text-ink-muted">
                  Ships to: {p.ships_to}
                  {p.shipping.note ? ` (${p.shipping.note})` : ""}
                </p>
              </div>
              {/* min-w-0 + flex-wrap + wrapping badges: long gating text
                  wraps inside the card instead of forcing the page wider
                  and pushing the buy button off-screen. */}
              <div className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2">
                {p.gating ? (
                  <Badge
                    variant="secondary"
                    className="max-w-full shrink whitespace-normal rounded-lg text-left"
                  >
                    {p.gating}
                  </Badge>
                ) : null}
                {availability.available ? (
                  <Button
                    asChild
                    size="sm"
                    variant={anyUsable ? "default" : "outline"}
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
                ) : (
                  <Badge
                    variant="secondary"
                    className="max-w-full shrink whitespace-normal rounded-lg text-left"
                  >
                    {availability.reason}
                  </Badge>
                )}
              </div>
            </div>

            {availability.available && availability.stateFlag ? (
              <p
                data-testid="state-exclusion-flag"
                className="mt-3 rounded-lg bg-tint px-3 py-2 text-xs"
              >
                ⚠ {availability.stateFlag}
              </p>
            ) : null}

            {/* "Works with Inherit" is the decision column, so it sits
                second — right after the product name — where it stays
                visible on narrow screens instead of far off to the right. */}
            <ScrollableTable>
              <table className="w-full min-w-[44rem] text-left text-sm">
                <thead>
                  <tr className="text-xs text-ink-muted">
                    <th className="pb-1 pr-4 font-normal">Product</th>
                    <th className="pb-1 pr-4 font-normal">Works with Inherit</th>
                    <th className="pb-1 pr-4 font-normal">Depth</th>
                    <th className="pb-1 pr-4 font-normal">Price (captured {p.last_verified_at})</th>
                    <th className="pb-1 pr-4 font-normal">Raw files you get</th>
                    <th className="pb-1 font-normal">Advertised turnaround</th>
                  </tr>
                </thead>
                <tbody>
                  {p.products.map((prod, i) => {
                    const tip = depthTip(prod.depth);
                    const compat = compatFor(prod);
                    return (
                      <tr key={i} className="border-t border-line align-top">
                        <td className="py-1.5 pr-4">{prod.name}</td>
                        <td className="py-1.5 pr-4">
                          <Badge
                            variant={
                              compat.kind === "full" ? "secondary" : "outline"
                            }
                            title={compat.detail}
                            className={`max-w-[13rem] whitespace-normal rounded-lg text-left text-[11px] leading-4 ${
                              compat.kind === "none" ? "text-ink-muted" : ""
                            }`}
                          >
                            {compat.label}
                          </Badge>
                        </td>
                        <td
                          className={`py-1.5 pr-4 ${tip ? "cursor-help" : ""}`}
                          title={tip || undefined}
                          aria-label={
                            tip ? `${prod.depth} — ${tip}` : undefined
                          }
                        >
                          {prod.depth}
                        </td>
                        <td className="py-1.5 pr-4">{prod.price}</td>
                        <td className="py-1.5 pr-4 text-xs">
                          {(prod.formats_returned ?? []).join(", ") || "—"}
                        </td>
                        <td className="py-1.5 text-xs">
                          {prod.turnaround || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollableTable>

            <div className="mt-3 space-y-1 border-t border-line pt-3 text-xs text-ink-muted">
              {p.data_practices_note ? (
                <p>
                  <strong>Data practices:</strong> {p.data_practices_note}{" "}
                  {p.privacy_policy_url ? (
                    <a
                      href={p.privacy_policy_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2"
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
                    className="underline underline-offset-2"
                  >
                    source {i + 1}{" "}
                  </a>
                ))}
                {p.affiliate
                  ? "· Inherit may earn a commission if you buy through this affiliate link. We show this here so you can see it."
                  : "· No affiliate relationship."}
              </p>
            </div>
          </li>
          );
        })}
      </ul>
    </div>
  );
}
