import { createHash } from "node:crypto";
import sitesJson from "../../../data/ref/neanderthal/sites.json";
import { NEANDERTHAL_PANEL, NEANDERTHAL_RESAMPLES } from "./neanderthal-panel";

/**
 * The Neanderthal estimate, defined exactly (brief line 2265, §4.6):
 *
 *   the fraction of COVERED panel sites at which the reader carries at least
 *   one archaic-derived allele,
 *
 * reported with the number of panel sites covered and a 200-resample bootstrap
 * 90% interval. It is NOT a genome-wide ancestry proportion, and the surface
 * says so. The panel is the Sprime calls of Browning et al. 2018 (CC BY 4.0),
 * subset to one site per introgressed segment and lifted to GRCh38; each site
 * carries the Neanderthal-matching letter and the other letter. See
 * `data/ref/neanderthal/PROVENANCE.md`.
 *
 * This module carries the 3,110-site table and is used only on the server
 * (the generation worker) and in build scripts and tests; the copy module and
 * the content schema take the small `NEANDERTHAL_PANEL` constants instead, so
 * no client bundle pulls in the table. Like the sibling admixture estimators
 * it is a pure module, not marked `server-only`.
 */

/** One row of `sites.json`: [chrom, pos37, pos38, rsid, archaic, other]. */
type RawSite = [number, number, number, string, string, string];

const PANEL = sitesJson as unknown as { id: string; version: string; sites: RawSite[] };

/** Fail loudly if the loaded table is not the manifest's: the estimate must be the panel it names. */
const MARKER_SHA256 = createHash("sha256").update(JSON.stringify(PANEL.sites)).digest("hex");
if (PANEL.id !== NEANDERTHAL_PANEL.id || PANEL.version !== NEANDERTHAL_PANEL.version
  || PANEL.sites.length !== NEANDERTHAL_PANEL.siteCount || MARKER_SHA256 !== NEANDERTHAL_PANEL.markerSha256) {
  throw new Error("neanderthal_panel_mismatch");
}

export interface NeanderthalSite {
  chrom: number;
  pos38: number;
  rsid: string;
  /** The letter the Altai Neanderthal carries at this site; the reader "matches" when they carry it. */
  archaic: string;
  other: string;
}

export const NEANDERTHAL_SITES: readonly NeanderthalSite[] = Object.freeze(
  PANEL.sites.map((site) => Object.freeze({ chrom: site[0], pos38: site[2], rsid: site[3], archaic: site[4], other: site[5] })),
);

/** The panel positions a reader's calls are read at, for the generation RPC's locus request. */
export function neanderthalLoci(): { chrom: number; pos: number }[] {
  return NEANDERTHAL_SITES.map((site) => ({ chrom: site.chrom, pos: site.pos38 }));
}

export interface NeanderthalResult {
  /** Every site in the panel. */
  panelSites: number;
  /** Sites with a usable biallelic genotype of this site's two letters. */
  coveredSites: number;
  /** Covered sites carrying at least one archaic-derived allele. */
  archaicSites: number;
  /** archaicSites / coveredSites, or null when nothing is covered. */
  estimate: number | null;
  /** The 90% bootstrap interval, or null when it has no width or nothing is covered (G4.4's disjunction). */
  interval: { low: number; high: number } | null;
  resamples: number;
}

export interface NeanderthalCall {
  chrom: number;
  pos: number;
  ref: string | null;
  alt: string | null;
  genotype: string;
  usable: boolean;
}

/** Two A/C/G/T letters in a canonical order, or null for anything that is not one diploid call. */
function normalizedDiploid(value: string): string | null {
  if (!/^[ACGT](?:[/|]?[ACGT])$/.test(value)) return null;
  return value.replace(/[/|]/g, "").split("").sort().join("/");
}

/**
 * mulberry32, with a CONSTANT seed. One file must always produce one interval:
 * a clock- or id-derived seed would move a reader's published range between two
 * readings of the same result, which is the kind of number this product must
 * never print. The seed is the ASCII of "nean".
 */
const RESAMPLE_SEED = 0x6e65_616e;
function resampleRandom(): () => number {
  let a = RESAMPLE_SEED >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The value at a percentile of an ascending column (the same convention the admixture estimator uses). */
function quantile(ascending: readonly number[], p: number): number {
  const index = Math.round(p * (ascending.length - 1));
  return ascending[Math.min(ascending.length - 1, Math.max(0, index))];
}

/**
 * Resolve one reader's calls against the panel and estimate. A site is covered
 * when exactly one usable diploid genotype is present and both of its letters
 * are this site's archaic/other pair; a third allele, a no-call, a filtered
 * call or disagreeing rows leave it uncovered, exactly as the AIMs reader
 * treats such a position. Nothing is imputed: an absent row is uncovered, never
 * read as carrying the ancestral letter.
 */
export function estimateNeanderthal(calls: readonly NeanderthalCall[], encoding: "vcf-literal" | "array-genotype"): NeanderthalResult {
  const byPosition = new Map<string, NeanderthalCall[]>();
  for (const row of calls) {
    const key = `${row.chrom}:${row.pos}`;
    const group = byPosition.get(key) ?? [];
    group.push(row);
    byPosition.set(key, group);
  }
  const hits: number[] = [];
  let archaicSites = 0;
  for (const site of NEANDERTHAL_SITES) {
    const rows = byPosition.get(`${site.chrom}:${site.pos38}`);
    if (!rows || rows.length === 0) continue;
    const genotypes = new Set(rows.map((row) => normalizedDiploid(row.genotype)).filter((value): value is string => value !== null));
    if (genotypes.size !== 1) continue;
    if (rows.some((row) => row.genotype === "--" || row.genotype === "./." || row.genotype === ".")) continue;
    if (rows.some((row) => !row.usable)) continue;
    const genotype = [...genotypes][0];
    const alleles = genotype.split("/");
    // Both letters must be this site's pair. A VCF call carries real REF/ALT
    // that must also agree; an array call may omit them.
    if (alleles.some((allele) => allele !== site.archaic && allele !== site.other)) continue;
    if (encoding === "vcf-literal" && rows.some((row) =>
      row.ref === null || row.alt === null
      || !(row.ref === site.archaic || row.ref === site.other)
      || alleles.some((allele) => allele !== row.ref && !row.alt!.split(",").includes(allele)))) continue;
    const hit = alleles.includes(site.archaic) ? 1 : 0;
    hits.push(hit);
    archaicSites += hit;
  }
  const coveredSites = hits.length;
  if (coveredSites === 0) {
    return { panelSites: NEANDERTHAL_SITES.length, coveredSites: 0, archaicSites: 0, estimate: null, interval: null, resamples: NEANDERTHAL_RESAMPLES };
  }
  const estimate = archaicSites / coveredSites;
  const random = resampleRandom();
  const means: number[] = [];
  for (let b = 0; b < NEANDERTHAL_RESAMPLES; b++) {
    let sum = 0;
    for (let i = 0; i < coveredSites; i++) sum += hits[Math.floor(random() * coveredSites)];
    means.push(sum / coveredSites);
  }
  means.sort((a, b) => a - b);
  const round = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000;
  const low = round(quantile(means, 0.05));
  const high = round(quantile(means, 0.95));
  return {
    panelSites: NEANDERTHAL_SITES.length,
    coveredSites,
    archaicSites,
    estimate,
    // A zero-width interval is not a measurement of spread; the surface then
    // states that no range is available rather than printing "x to x".
    interval: high > low ? { low, high } : null,
    resamples: NEANDERTHAL_RESAMPLES,
  };
}
