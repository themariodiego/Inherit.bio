"use client";

import { useEffect, useRef } from "react";
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
// origin is contacted — verified by the E2E network audit.
export function GenomeBrowser({
  fileId,
  locus,
}: {
  fileId: string;
  locus: { chrom: number; start: number; end: number };
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    let browserRef: unknown = null;

    async function mount() {
      const el = containerRef.current;
      if (!el) return;

      const chromName = `chr${chromToName(locus.chrom) === "MT" ? "M" : chromToName(locus.chrom)}`;
      const res = await fetch(
        `/api/browse/region?file=${fileId}&chrom=${chromName}&start=${locus.start}&end=${locus.end}`,
      );
      const { variants } = (await res.json()) as { variants: RegionVariant[] };

      const igv = (await import("igv")).default;
      if (disposed) return;
      el.innerHTML = "";
      // igv's TS types don't model the chromsizes reference format or
      // inline `features` arrays; both are supported at runtime.
      const config = {
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
      browserRef = await igv.createBrowser(
        el,
        config as unknown as Parameters<typeof igv.createBrowser>[1],
      );
    }

    const el = containerRef.current;
    void mount();
    return () => {
      disposed = true;
      if (browserRef && el) el.innerHTML = "";
    };
  }, [fileId, locus.chrom, locus.start, locus.end]);

  return (
    <div
      ref={containerRef}
      data-testid="genome-browser"
      className="min-h-64 rounded-xl border border-line bg-white p-2 dark:bg-card"
    />
  );
}
