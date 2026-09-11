/**
 * Proof that the committed browser fixture `e2e/fixtures/lineage-grch38.vcf`
 * really classifies — not that a hand-built `getBase` does.
 *
 * The fixture exists because the populated lineage card (G4.4: the tree and
 * its version, the informative markers used of those required, the explicit
 * statement that no interval is available, and the resolution limit) has only
 * ever been unit-tested against a literal `HaplogroupCall`. No browser fixture
 * carried a mitochondrial or Y position, so no test ever produced one from a
 * file. This test reads the committed bytes, runs the project's real VCF
 * parser over them, rebuilds `getBase` the way
 * src/app/api/files/[id]/process/route.ts does, and asserts the exact call.
 *
 * It must fail if the fixture stops classifying, so the expectations below are
 * written out literally rather than imported from the generator; the one
 * imported thing is the generator's own line builder, used to prove the
 * committed file is still what the generator produces.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildLineageVcf,
  classifyFixture,
  FIXTURE_NAME,
} from "../../../e2e/fixtures/generate-lineage-vcf";
import { loadTree } from "./haplogroups";

const FIXTURE_PATH = `e2e/fixtures/${FIXTURE_NAME}`;
const text = readFileSync(FIXTURE_PATH, "utf8");
const lines = text.split("\n").slice(0, -1);
const dataRows = lines.filter((line) => !line.startsWith("#")).map((line) => line.split("\t"));

describe("lineage-grch38.vcf", () => {
  it("is exactly what its generator produces, deterministically", () => {
    expect(text).toBe(`${buildLineageVcf().join("\n")}\n`);
    expect(text).toBe(`${buildLineageVcf().join("\n")}\n`);
  });

  it("says in-file that it is synthetic, and names no real person", () => {
    expect(lines[1]).toContain("synthetic");
    expect(lines[1]).toContain("no real person");
  });

  it("carries only shipped tree positions and shipped tree alleles", () => {
    const markers = new Map<string, Set<string>>();
    for (const lineage of ["mtDNA", "Y"] as const) {
      const chrom = lineage === "mtDNA" ? "chrM" : "chrY";
      for (const node of loadTree(lineage)) {
        for (const marker of node.markers) {
          const key = `${chrom}:${marker.pos}`;
          const alleles = markers.get(key) ?? new Set<string>();
          alleles.add(marker.anc);
          alleles.add(marker.der);
          markers.set(key, alleles);
        }
      }
    }
    expect(dataRows).toHaveLength(98);
    for (const [chrom, pos, id, ref, alt, , , , format, sample] of dataRows) {
      const alleles = markers.get(`${chrom}:${pos}`);
      // Nothing invented: both letters on every row are that marker's own
      // ancestral/derived pair out of data/ref/haplogroups.
      expect(alleles, `${chrom}:${pos} is not a shipped defining marker`).toBeDefined();
      expect(alleles!.has(ref) && alleles!.has(alt), `${chrom}:${pos} ${ref}/${alt}`).toBe(true);
      expect(ref).not.toBe(alt);
      // Haploid, as mitochondria and the Y are, and a called variant: a `0/0`
      // row never reaches `classify`, the parser files it as a reference call.
      expect([id, format, sample]).toEqual([".", "GT", "1"]);
    }
  });
});

describe("classify over the committed fixture", () => {
  it("parses as GRCh38 with no skipped row and reaches both lineage guards", async () => {
    const result = await classifyFixture(lines);
    expect(result.build).toBe("GRCh38");
    expect(result.skipped).toBe(0);
    expect(result.variantCount).toBe(98);
    expect([result.hasMt, result.hasY]).toEqual([true, true]);
  });

  it("calls mtDNA K1 with its full six-node path, every marker matched", async () => {
    const { mtDNA } = (await classifyFixture(lines)).calls;
    expect(mtDNA.haplogroup).toBe("K1");
    expect(mtDNA.path).toEqual(["L3", "N", "R", "U", "K", "K1"]);
    expect([mtDNA.matched, mtDNA.tested]).toEqual([17, 17]);
    expect(mtDNA.support).toBe("strong");
    expect(mtDNA.note).toBe(
      "matched 17/17 defining markers along L3 > N > R > U > K > K1 (76 marker positions covered overall)",
    );
  });

  it("calls Y I2 with its full path, every marker matched", async () => {
    const { Y } = (await classifyFixture(lines)).calls;
    expect(Y.haplogroup).toBe("I2");
    expect(Y.path).toEqual(["I", "I2"]);
    expect([Y.matched, Y.tested]).toEqual([4, 4]);
    expect(Y.support).toBe("strong");
    expect(Y.note).toBe("matched 4/4 defining markers along I > I2 (22 marker positions covered overall)");
  });

  it("would render a populated lineage card on both parent lines", async () => {
    // The card shows the haplogroup, its path and the matched-of-tested
    // coverage figure only when `haplogroup` is a string and both counts are
    // numbers (src/components/results/ancestry/lineage-card.tsx).
    const { calls } = await classifyFixture(lines);
    for (const call of [calls.mtDNA, calls.Y]) {
      expect(typeof call.haplogroup).toBe("string");
      expect(call.path.length).toBeGreaterThan(0);
      expect(call.tested).toBeGreaterThan(0);
      expect(call.support).not.toBe("insufficient");
    }
  });

  it("fails when a defining marker along the winning path stops being carried", async () => {
    // The proof is load-bearing: drop K's five markers and the deepest
    // reachable node is U, so the card would show a different call.
    const withoutK = lines.filter((line) => {
      const [chrom, pos] = line.split("\t");
      return !(chrom === "chrM" && ["9055", "10550", "11299", "14798", "16224"].includes(pos));
    });
    const { mtDNA } = (await classifyFixture(withoutK)).calls;
    expect(mtDNA.haplogroup).toBe("U");
    expect(mtDNA.path).toEqual(["L3", "N", "R", "U"]);
  });
});
