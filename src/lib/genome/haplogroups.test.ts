import { describe, expect, it } from "vitest";
import {
  classify,
  loadTree,
  type GetBase,
  type Lineage,
} from "./haplogroups";

const CHROM: Record<Lineage, number> = { mtDNA: 25, Y: 24 };

/**
 * Synthetic sample built from the seed markers themselves: every marker
 * position carries its ancestral base, then the nodes on `path` are
 * overwritten with their derived bases.
 */
function syntheticSample(lineage: Lineage, path: string[]): GetBase {
  const tree = loadTree(lineage);
  const byName = new Map(tree.map((n) => [n.haplogroup, n]));
  const bases = new Map<number, string>();
  for (const node of tree) {
    for (const m of node.markers) {
      if (!bases.has(m.pos)) bases.set(m.pos, m.anc);
    }
  }
  for (const hg of path) {
    const node = byName.get(hg);
    if (!node) throw new Error(`unknown haplogroup ${hg}`);
    for (const m of node.markers) bases.set(m.pos, m.der);
  }
  return (chrom, pos) =>
    chrom === CHROM[lineage] ? (bases.get(pos) ?? null) : null;
}

describe("classify mtDNA", () => {
  it("recovers H1 with its full path", () => {
    const path = ["L3", "N", "R", "HV", "H", "H1"];
    const call = classify("mtDNA", syntheticSample("mtDNA", path));
    expect(call.haplogroup).toBe("H1");
    expect(call.path).toEqual(path);
    expect(call.matched).toBe(call.tested);
    expect(call.support).toBe("strong");
  });

  it("recovers U5 with its full path", () => {
    const path = ["L3", "N", "R", "U", "U5"];
    const call = classify("mtDNA", syntheticSample("mtDNA", path));
    expect(call.haplogroup).toBe("U5");
    expect(call.path).toEqual(path);
    expect(call.support).toBe("strong");
  });

  it("recovers an L-lineage root (L2)", () => {
    const call = classify("mtDNA", syntheticSample("mtDNA", ["L2"]));
    expect(call.haplogroup).toBe("L2");
    expect(call.path).toEqual(["L2"]);
    expect(call.support).toBe("strong");
  });

  it("reports insufficient when almost nothing is tested", () => {
    // Only the two H markers are covered; the walk cannot even enter the
    // roots, and fewer than 3 markers are tested overall.
    const sparse: GetBase = (chrom, pos) => {
      if (chrom !== 25) return null;
      if (pos === 2706) return "A";
      if (pos === 7028) return "C";
      return null;
    };
    const call = classify("mtDNA", sparse);
    expect(call.haplogroup).toBeNull();
    expect(call.support).toBe("insufficient");
    expect(call.tested).toBe(2);
  });
});

describe("classify Y", () => {
  it("recovers R1b", () => {
    const call = classify("Y", syntheticSample("Y", ["R", "R1b"]));
    expect(call.haplogroup).toBe("R1b");
    expect(call.path).toEqual(["R", "R1b"]);
    expect(call.matched).toBe(3); // M207 + M343 + M269
    expect(call.support).toBe("strong");
  });

  it("recovers E1b1a with honest partial support (2 markers)", () => {
    const call = classify("Y", syntheticSample("Y", ["E", "E1b1a"]));
    expect(call.haplogroup).toBe("E1b1a");
    expect(call.path).toEqual(["E", "E1b1a"]);
    expect(call.matched).toBe(2);
    expect(call.support).toBe("partial");
  });

  it("returns null for a sample with no Y calls (female)", () => {
    const call = classify("Y", () => null);
    expect(call.haplogroup).toBeNull();
    expect(call.path).toEqual([]);
    expect(call.support).toBe("insufficient");
    expect(call.note).toContain("no Y-chromosome calls");
  });

  it("labels a mixed sparse sample partial", () => {
    // M207 derived, M269 derived, but M343 still ancestral: R1b is reached
    // with 2/3 markers matched on the path.
    const byRsid: Record<string, string> = {
      rs2032658: "G", // M207 derived
      rs9786184: "C", // M343 ancestral
      rs9786153: "C", // M269 derived
    };
    const tree = loadTree("Y");
    const posToBase = new Map<number, string>();
    for (const node of tree) {
      for (const m of node.markers) {
        if (m.rsid && byRsid[m.rsid] !== undefined) {
          posToBase.set(m.pos, byRsid[m.rsid]);
        }
      }
    }
    const sparse: GetBase = (chrom, pos) =>
      chrom === 24 ? (posToBase.get(pos) ?? null) : null;
    const call = classify("Y", sparse);
    expect(call.haplogroup).toBe("R1b");
    expect(call.matched).toBe(2);
    expect(call.tested).toBe(3);
    expect(call.support).toBe("partial");
  });
});
