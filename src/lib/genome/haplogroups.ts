// mtDNA + Y haplogroup classification against curated defining-marker trees
// (data/ref/haplogroups/*.json; see PROVENANCE.md there for sources).
//
// The walk starts at the tree roots and descends into a branch only when the
// sample carries at least one of that branch's derived alleles; among reached
// nodes the deepest wins, ties broken by matched/tested ratio, then matched
// count. Support labels are honest: sparse data (fewer than 3 markers tested
// overall) is reported as 'insufficient', not guessed.

import mtdnaTree from "../../../data/ref/haplogroups/mtdna.json";
import yTree from "../../../data/ref/haplogroups/y.json";

export type Lineage = "mtDNA" | "Y";

export interface HaplogroupMarker {
  pos: number;
  /** Base carried by samples outside the branch. */
  anc: string;
  /** Base carried by samples inside the branch ("-" for a deletion). */
  der: string;
  /** Y only: marker name, e.g. "M269". */
  name?: string;
  /** Y only: dbSNP rsID used to verify the GRCh38 position. */
  rsid?: string;
}

export interface HaplogroupNode {
  haplogroup: string;
  parent: string | null;
  lineage: Lineage;
  markers: HaplogroupMarker[];
}

export interface HaplogroupCall {
  haplogroup: string | null;
  /** Root-to-leaf haplogroup names for the winning branch. */
  path: string[];
  /** Markers matched / tested along the winning path (0 when no call). */
  matched: number;
  tested: number;
  support: "strong" | "partial" | "insufficient";
  note: string;
}

/** Returns the sample's base at (chrom, pos), or null when not covered. */
export type GetBase = (chrom: number, pos: number) => string | null;

const CHROM: Record<Lineage, number> = { mtDNA: 25, Y: 24 };

// Trees are bundled as static imports (not runtime reads), so they ship
// cleanly in the serverless function without whole-project tracing.
const TREES: Record<Lineage, HaplogroupNode[]> = {
  mtDNA: mtdnaTree as HaplogroupNode[],
  Y: yTree as HaplogroupNode[],
};

export function loadTree(lineage: Lineage): HaplogroupNode[] {
  return TREES[lineage];
}

interface Candidate {
  path: string[];
  matched: number;
  tested: number;
}

function betterThan(a: Candidate, b: Candidate): boolean {
  if (a.path.length !== b.path.length) return a.path.length > b.path.length;
  const ra = a.matched / a.tested;
  const rb = b.matched / b.tested;
  if (ra !== rb) return ra > rb;
  return a.matched > b.matched;
}

export function classify(lineage: Lineage, getBase: GetBase): HaplogroupCall {
  const tree = loadTree(lineage);
  const chrom = CHROM[lineage];

  // One call per position; positions recur across nodes (e.g. mtDNA 3010).
  const baseCache = new Map<number, string | null>();
  const base = (pos: number): string | null => {
    let b = baseCache.get(pos);
    if (b === undefined) {
      b = getBase(chrom, pos);
      baseCache.set(pos, b);
    }
    return b;
  };

  if (lineage === "Y") {
    const anyCall = tree.some((n) => n.markers.some((m) => base(m.pos) !== null));
    if (!anyCall) {
      return {
        haplogroup: null,
        path: [],
        matched: 0,
        tested: 0,
        support: "insufficient",
        note: "no Y-chromosome calls in sample (female, or Y not covered)",
      };
    }
  }

  const children = new Map<string | null, HaplogroupNode[]>();
  for (const node of tree) {
    const sibs = children.get(node.parent) ?? [];
    sibs.push(node);
    children.set(node.parent, sibs);
  }

  // Distinct marker positions with a call, whether or not the walk reaches
  // them — the honest basis for the 'insufficient' threshold.
  let covered = 0;
  const seen = new Set<number>();
  for (const node of tree) {
    for (const m of node.markers) {
      if (seen.has(m.pos)) continue;
      seen.add(m.pos);
      if (base(m.pos) !== null) covered++;
    }
  }

  const candidates: Candidate[] = [];

  const visit = (node: HaplogroupNode, path: string[], m: number, t: number): void => {
    let matched = 0;
    let tested = 0;
    for (const marker of node.markers) {
      const b = base(marker.pos);
      if (b === null) continue;
      tested++;
      if (b === marker.der) matched++;
    }
    if (matched < 1) return;
    const cand: Candidate = {
      path: [...path, node.haplogroup],
      matched: m + matched,
      tested: t + tested,
    };
    candidates.push(cand);
    for (const child of children.get(node.haplogroup) ?? []) {
      visit(child, cand.path, cand.matched, cand.tested);
    }
  };
  for (const root of children.get(null) ?? []) visit(root, [], 0, 0);

  let won: Candidate | null = null;
  for (const cand of candidates) {
    if (won === null || betterThan(cand, won)) won = cand;
  }
  if (won === null) {
    return {
      haplogroup: null,
      path: [],
      matched: 0,
      tested: covered,
      support: "insufficient",
      note: `no haplogroup branch matched (${covered} marker positions covered)`,
    };
  }

  const ratio = won.matched / won.tested;
  const support: HaplogroupCall["support"] =
    covered < 3
      ? "insufficient"
      : won.matched >= 3 && ratio >= 0.8
        ? "strong"
        : "partial";
  return {
    haplogroup: won.path[won.path.length - 1],
    path: won.path,
    matched: won.matched,
    tested: won.tested,
    support,
    note: `matched ${won.matched}/${won.tested} defining markers along ${won.path.join(" > ")} (${covered} marker positions covered overall)`,
  };
}
