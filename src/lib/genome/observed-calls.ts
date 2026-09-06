import type { VariantRecord } from "./types";

export const OBSERVED_CALL_VERSION = "vcf-literal-diploid-snp-v1";

/** Source observations, not additions to the variant-only analysis inputs. */
export interface ObservedCall extends VariantRecord {
  line: number;
  sourceGt: string | null;
  filter: string | null;
  sampleFilter: string | null;
  genotypeQuality: number | null;
  depth: number | null;
  quality: "pass" | "unknown" | "failed";
  usable: boolean;
}

function numeric(raw: string | undefined): number | null {
  if (!raw || raw === "." || !/^\d+(?:\.\d+)?$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** Never interprets a symbolic ALT, interval anchor, absent row or multi-sample row. */
export function observedVcfCall(f: string[], chrom: number, pos: number, line: number): ObservedCall | null {
  if (!/^rs[1-9]\d*$/i.test(f[2] ?? "")) return null;
  return observedVcfPointCall(f, chrom, pos, line);
}

/** File read quality does not require an rsID; report matching still does. */
export function observedVcfPointCall(f: string[], chrom: number, pos: number, line: number): ObservedCall | null {
  if (f.length !== 10 ||
      !/^[ACGT]$/.test(f[3]) || !/^[ACGT]$/.test(f[4]) || f[3] === f[4] ||
      /(?:^|;)(?:END|SVLEN)=/.test(f[7])) return null;
  const keys = f[8].split(":");
  if (new Set(keys).size !== keys.length || keys.includes("LEN")) return null;
  const values = f[9].split(":");
  const value = (key: string) => values[keys.indexOf(key)];
  const sourceGt = value("GT") ?? null;
  const filter = f[6] === "." ? null : f[6];
  const sampleFilter = value("FT") && value("FT") !== "." ? value("FT")! : null;
  const quality = (filter !== null && filter !== "PASS") || (sampleFilter !== null && sampleFilter !== "PASS")
    ? "failed" : filter === "PASS" && (sampleFilter === null || sampleFilter === "PASS") ? "pass" : "unknown";
  const validGt = sourceGt !== null && /^[01][/|][01]$/.test(sourceGt);
  const alleles = [f[3], f[4]];
  const genotype = validGt ? sourceGt.split(/[/|]/).map((index) => alleles[Number(index)]).sort().join("/") : "--";
  return {
    line, rsid: /^rs[1-9]\d*$/i.test(f[2]) ? Number(f[2].slice(2)) : null, chrom, pos, ref: f[3], alt: f[4], genotype,
    sourceGt, filter, sampleFilter, genotypeQuality: numeric(value("GQ")), depth: numeric(value("DP")),
    quality, usable: validGt && quality !== "failed",
  };
}
