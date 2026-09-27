import "server-only";

import reference from "../../../data/ref/build-discriminating-sites.json";
import register from "../../../docs/route-register.json";
import { EMBRYO_INGEST_SESSION_LIMITS as limits } from "./ingest-limits";

export type InferredEmbryoBuild = "GRCh37" | "GRCh38" | "decision-required";
export interface BuildPosition { chrom: number; pos: number }

const contract = register.policyContracts["genome-build-inference-v1"];
const minimum = contract.minimumDiscriminatingPositions;
const agreementPercent = contract.acceptAgreementAtLeast * 100;

/** Reference coordinates only. No alleles, source labels or personal genotypes. */
interface Reference { schemaVersion: number; columns: string[]; sites: number[][] }

function indexReference(panel: Reference): ReadonlyMap<string, "GRCh37" | "GRCh38"> {
  if (panel.schemaVersion !== 1 || JSON.stringify(panel.columns) !== JSON.stringify(["rsid", "chrom", "pos37", "pos38"])
    || panel.sites.length < minimum || panel.sites.length > 250_000
    || !Number.isSafeInteger(minimum) || minimum < 1000 || !Number.isSafeInteger(agreementPercent) || agreementPercent < 99) {
    throw new Error("Invalid build reference contract");
  }
  const index = new Map<string, "GRCh37" | "GRCh38">();
  const identifiers = new Set<number>();
  for (const site of panel.sites) {
    const [rsid, chrom, pos37, pos38] = site;
    if (site.length !== 4 || !site.every(value => Number.isSafeInteger(value) && value > 0)
      || chrom > 22 || identifiers.has(rsid) || pos37 === pos38) throw new Error("Invalid build reference site");
    identifiers.add(rsid);
    for (const [position, build] of [[pos37, "GRCh37"], [pos38, "GRCh38"]] as const) {
      const key = `${chrom}:${position}`;
      // A coordinate shared by sites/builds cannot discriminate and is rejected.
      if (index.has(key)) throw new Error("Ambiguous build reference coordinate");
      index.set(key, build);
    }
  }
  return index;
}

const referenceIndex = indexReference(reference);

/**
 * For an embryo laboratory table without a trusted explicit build only.
 * Count the distinct input coordinates that occur in the discriminating
 * reference, once regardless of how many embryos carry a call there. Unknown
 * coordinates and valid X/Y/MT rows provide no build evidence. Input rows
 * are never retained. The transport independently removes non-autosomal calls.
 *
 * This returns only the closed decision. It does not mint a challenge, accept
 * a client-declared build, read genotypes, perform liftover or authorize writes.
 * Those remain separate operations under the live ingest session.
 */
export function inferEmbryoTableBuild(positions: Iterable<BuildPosition>): InferredEmbryoBuild {
  const seen = new Set<string>();
  const matches = { GRCh37: 0, GRCh38: 0 };
  let rows = 0;
  for (const position of positions) {
    // Keep the scan finite even for repeated or wholly unknown coordinates.
    // The transport parser owns its own earlier row/byte limits as well.
    if (++rows > limits.maximumLogicalRecords || !Number.isInteger(position.chrom)
      || position.chrom < 1 || position.chrom > 25 || !Number.isSafeInteger(position.pos) || position.pos < 1) {
      return "decision-required";
    }
    if (position.chrom > 22) continue;
    const key = `${position.chrom}:${position.pos}`;
    const build = referenceIndex.get(key);
    if (build && !seen.has(key)) { seen.add(key); matches[build]++; }
  }
  if (seen.size < minimum) return "decision-required";
  const candidates = (["GRCh37", "GRCh38"] as const).filter(build => matches[build] * 100 >= seen.size * agreementPercent);
  return candidates.length === 1 ? candidates[0] : "decision-required";
}
