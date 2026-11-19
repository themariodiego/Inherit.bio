import "server-only";

import reference from "../../../data/ref/build-discriminating-sites.json";
import type { EmbryoTransportBinding } from "./ingest-binding";

/**
 * The server reference store a laboratory table's rsID locus is resolved
 * from (register `transportWireV1.table`: "rsID loci resolved from the
 * server reference store in the current build before retaining any row").
 *
 * It is the attributed coordinate reference the repository already ships,
 * `data/ref/build-discriminating-sites.json` (provenance in
 * `data/ref/BUILD_DISCRIMINATING_SITES_PROVENANCE.md`): numeric rsID,
 * autosome, GRCh37 and GRCh38 position, nothing else. An rsID outside it is
 * not resolvable, and the transport refuses the chunk closed rather than
 * guess a position (ADR 0037 records this limit). Coordinates a table
 * states itself never pass through here.
 */
interface Reference { schemaVersion: number; columns: string[]; sites: number[][] }

let index: ReadonlyMap<number, readonly [number, number, number]> | null = null;

function load(): ReadonlyMap<number, readonly [number, number, number]> {
  if (index) return index;
  const panel = reference as Reference;
  if (panel.schemaVersion !== 1 || JSON.stringify(panel.columns) !== JSON.stringify(["rsid", "chrom", "pos37", "pos38"])) {
    throw new Error("Invalid table reference contract");
  }
  const built = new Map<number, readonly [number, number, number]>();
  for (const [rsid, chrom, pos37, pos38] of panel.sites) built.set(rsid, [chrom, pos37, pos38]);
  index = built;
  return built;
}

/** The autosomal locus of one rsID in the resolved build, or null when the store does not hold it. */
export function resolveTableRsid(rsid: number, build: EmbryoTransportBinding["build"]): { chrom: number; pos: number } | null {
  const site = load().get(rsid);
  if (!site) return null;
  return { chrom: site[0], pos: build === "GRCh37" ? site[1] : site[2] };
}
