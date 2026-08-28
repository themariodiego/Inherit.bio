"use client";

import { useMemo, useState } from "react";
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
} from "@/lib/providers";

const DEPTH_FILTERS = [
  { key: "all", label: "All test types" },
  { key: "array", label: "Genotyping array" },
  { key: "wgs", label: "Whole genome (30x+)" },
  { key: "specialty", label: "Y-DNA / mtDNA / exome" },
] as const;

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
          Location is used only to filter this list, in your browser. Sequence
          never asks for a street address and never takes payment — you buy
          from the provider directly.
        </p>
      </div>

      <ul className="space-y-4">
        {rows.map(({ provider: p, availability }) => (
          <li
            key={p.slug}
            data-testid={`provider-${p.slug}`}
            className={`rounded-2xl border border-line bg-card p-5 ${availability.available ? "" : "opacity-60"}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-medium">{p.name}</h2>
                <p className="mt-0.5 text-xs text-ink-muted">
                  Ships to: {p.ships_to}
                  {p.shipping.note ? ` (${p.shipping.note})` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {p.gating ? (
                  <Badge variant="secondary">{p.gating}</Badge>
                ) : null}
                {availability.available ? (
                  <Button asChild size="sm">
                    <a
                      href={p.checkout_url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                    >
                      Buy through provider ↗
                    </a>
                  </Button>
                ) : (
                  <Badge variant="secondary">{availability.reason}</Badge>
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

            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[36rem] text-left text-sm">
                <thead>
                  <tr className="text-xs text-ink-muted">
                    <th className="pb-1 pr-4 font-normal">Product</th>
                    <th className="pb-1 pr-4 font-normal">Depth</th>
                    <th className="pb-1 pr-4 font-normal">Price (captured {p.last_verified_at})</th>
                    <th className="pb-1 pr-4 font-normal">Raw files you get</th>
                    <th className="pb-1 font-normal">Advertised turnaround</th>
                  </tr>
                </thead>
                <tbody>
                  {p.products.map((prod, i) => (
                    <tr key={i} className="border-t border-line align-top">
                      <td className="py-1.5 pr-4">{prod.name}</td>
                      <td className="py-1.5 pr-4">{prod.depth}</td>
                      <td className="py-1.5 pr-4">{prod.price}</td>
                      <td className="py-1.5 pr-4 text-xs">
                        {(prod.formats_returned ?? []).join(", ") || "—"}
                      </td>
                      <td className="py-1.5 text-xs">
                        {prod.turnaround || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

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
                  ? "· Affiliate link — Sequence may earn a commission (disclosed here because it must be)."
                  : "· No affiliate relationship."}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
