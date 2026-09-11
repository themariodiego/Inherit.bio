/**
 * The lineage reference panel: which positions a haplogroup call is read at,
 * and a pin on the trees it is read against (G4.4 — every quantity derived
 * from a reference panel names its panel and its version).
 *
 * This mirrors what `CURRENT_OWN_ANCESTRY_PANEL` does for the admixture AIMs
 * and for the same reason. `markerSha256` there exists so that captured
 * content cannot outlive the panel it was computed from; the same hazard
 * applies here, and worse, because a haplogroup NAME carries no number to
 * look wrong. A tree edit that moved one defining position would otherwise
 * leave stored calls reading as though they had been made against the tree
 * now shipping.
 *
 * The names and versions themselves live in `LINEAGE_TREES` and are not
 * restated here: the trees carry no version field of their own, so that
 * module is the single place the published build is named.
 */
import { createHash } from "node:crypto";
import { loadTree, type HaplogroupNode, type Lineage } from "@/lib/genome/haplogroups";
import { LINEAGE_TREES, type LineageTree } from "./panel";

/** The two lineages as the stored content and the result rows name them. */
export const LINEAGE_KINDS = ["mtdna", "ydna"] as const;
export type LineageKind = (typeof LINEAGE_KINDS)[number];

/** Normalized chromosome numbers, matching `CHROM` in the classifier. */
export const LINEAGE_CHROM: Readonly<Record<LineageKind, number>> = Object.freeze({ mtdna: 25, ydna: 24 });
const LINEAGE_OF: Readonly<Record<LineageKind, Lineage>> = Object.freeze({ mtdna: "mtDNA", ydna: "Y" });
const PARENT_OF: Readonly<Record<LineageKind, "mother" | "father">> = Object.freeze({ mtdna: "mother", ydna: "father" });

export const lineageOf = (kind: LineageKind): Lineage => LINEAGE_OF[kind];
export const parentOf = (kind: LineageKind): "mother" | "father" => PARENT_OF[kind];
export const treeOf = (kind: LineageKind): LineageTree => LINEAGE_TREES[PARENT_OF[kind]];

/**
 * Every field the walk can read, in a fixed order, so the hash pins the
 * topology AND both alleles of every marker rather than the file's byte
 * layout. Reordering keys in the JSON must not invalidate stored calls;
 * moving a position or flipping an allele must.
 */
function treeJson(nodes: readonly HaplogroupNode[]): string {
  return JSON.stringify(nodes.map(node => ({
    haplogroup: node.haplogroup,
    parent: node.parent,
    lineage: node.lineage,
    markers: node.markers.map(marker => ({
      pos: marker.pos, anc: marker.anc, der: marker.der,
      name: marker.name ?? null, rsid: marker.rsid ?? null,
    })),
  })));
}

const digest = (kind: LineageKind): string =>
  createHash("sha256").update(treeJson(loadTree(LINEAGE_OF[kind]))).digest("hex");

export const LINEAGE_TREE_SHA256: Readonly<Record<LineageKind, string>> =
  Object.freeze({ mtdna: digest("mtdna"), ydna: digest("ydna") });

/**
 * The distinct defining-marker positions of one tree, ascending. These are
 * the only positions a lineage read may ask for: the walk consults no other,
 * so asking for more would read genetic data the result cannot use.
 */
function positions(kind: LineageKind): readonly number[] {
  const seen = new Set<number>();
  for (const node of loadTree(LINEAGE_OF[kind])) for (const marker of node.markers) seen.add(marker.pos);
  return Object.freeze([...seen].sort((a, b) => a - b));
}

const POSITIONS: Readonly<Record<LineageKind, readonly number[]>> =
  Object.freeze({ mtdna: positions("mtdna"), ydna: positions("ydna") });

export const lineageMarkerPositions = (kind: LineageKind): readonly number[] => POSITIONS[kind];

/** Every lineage locus to request, as the read loop wants them. */
export const lineageLoci = (): readonly { chrom: number; pos: number }[] =>
  LINEAGE_KINDS.flatMap(kind => POSITIONS[kind].map(pos => ({ chrom: LINEAGE_CHROM[kind], pos })));
