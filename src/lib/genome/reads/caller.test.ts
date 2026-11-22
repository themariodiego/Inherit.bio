import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blobChunks } from "./bgzf";
import { openBam } from "./bam";
import { openCram, type ReferenceLookup } from "./cram";
import { parseFasta, referenceLookup } from "./fasta";
import { callLoci, genotypeFromCounts, type CallerLocus, type LocusCall } from "./caller";
import { READ_CALLING_THRESHOLDS, type ReadCallingThresholds } from "./thresholds";

/**
 * The caller against the planted truth of the invented matrix
 * (`fixtures/synthetic-matrix.receipt.json`). The truth was written by the
 * generator from its plan, never by running this caller, so an exact match
 * is a real check. Each planted position tests one rule in `thresholds.ts`.
 */

const FIXTURES = "src/lib/genome/reads/fixtures";
const bytes = (name: string) => new Uint8Array(readFileSync(`${FIXTURES}/${name}`));
interface Truth {
  id: string; contig: string; position: number; ref: string; alts: string[]; rsid: number | null;
  state: LocusCall["state"]; genotype: LocusCall["genotype"]; alt: string; depth: number;
  refCount: number; altCount: number; otherCount: number; overlapping: number; reason: LocusCall["reason"];
}
const receipt = JSON.parse(readFileSync(`${FIXTURES}/synthetic-matrix.receipt.json`, "utf8")) as { truth: Truth[]; thresholds: unknown };
const loci: CallerLocus[] = receipt.truth.map((truth) => ({ contig: truth.contig, position: truth.position, ref: truth.ref,
  alts: truth.alts, rsid: truth.rsid }));
const OUTCOME_KEYS = ["state", "genotype", "alt", "depth", "refCount", "altCount", "otherCount", "overlapping", "reason"] as const;
const outcome = (value: Record<string, unknown>) => Object.fromEntries(OUTCOME_KEYS.map((key) => [key, value[key]]));
const expected = receipt.truth.map((truth) => outcome(truth as unknown as Record<string, unknown>));
const observed = (calls: LocusCall[]) => calls.map((call) => outcome(call as unknown as Record<string, unknown>));

async function matrixCalls(format: "BAM" | "CRAM" | "htslib CRAM", thresholds: ReadCallingThresholds = READ_CALLING_THRESHOLDS) {
  if (format === "BAM") {
    const file = await openBam(blobChunks(new Blob([bytes("synthetic-matrix.bam") as BlobPart])));
    return callLoci(file.records, file.header.references, loci, thresholds);
  }
  const genome = await parseFasta(bytes("synthetic-reference.fa"));
  let lookup: ReferenceLookup | null = null;
  const name = format === "CRAM" ? "synthetic-matrix.cram" : "htslib/htslib-matrix-3.0.cram";
  const file = await openCram(blobChunks(new Blob([bytes(name) as BlobPart])), (reference) => lookup?.(reference) ?? null);
  lookup = referenceLookup(genome, file.header.references);
  return callLoci(file.records, file.header.references, loci, thresholds);
}

describe("targeted calling on the invented matrix", () => {
  it("uses the registered engineering defaults, marked unreviewed", () => {
    expect(READ_CALLING_THRESHOLDS).toEqual({ version: "inherit-read-calls-v1", minimumDepth: 10, minimumBaseQuality: 20,
      minimumMappingQuality: 20, heterozygousLow: 0.25, heterozygousHigh: 0.75, homozygousMinimum: 0.9, reviewed: false });
    expect(receipt.thresholds).toEqual(READ_CALLING_THRESHOLDS);
  });

  it("covers every planted case the rule names", () => {
    expect(receipt.truth.map((truth) => [truth.id, truth.state, truth.genotype, truth.reason])).toEqual([
      ["hom_ref", "called", "0/0", null],
      ["second_alternate", "called", "0/1", null],
      ["het", "called", "0/1", null],
      ["hom_alt", "called", "1/1", null],
      ["low_depth", "no_call", "./.", "low_depth"],
      ["low_quality_filtered", "called", "0/0", null],
      ["no_reads", "not_covered", "./.", null],
      ["paired_fragments", "no_call", "./.", "low_depth"],
      ["deletion_across", "no_call", "./.", "other_letters"],
      ["between_bands", "no_call", "./.", "between_bands"],
    ]);
  });

  for (const format of ["BAM", "CRAM", "htslib CRAM"] as const) {
    it(`${format}: every position matches the planted truth exactly`, async () => {
      expect(observed(await matrixCalls(format))).toEqual(expected);
    });
  }

  it("is sensitive to every threshold and filter: loosening any one of them breaks the planted truth", async () => {
    const perturbed: [string, Partial<ReadCallingThresholds>, string][] = [
      ["minimumDepth 5", { minimumDepth: 5 }, "low_depth"],
      ["minimumBaseQuality 0", { minimumBaseQuality: 0 }, "low_quality_filtered"],
      ["minimumMappingQuality 0", { minimumMappingQuality: 0 }, "low_quality_filtered"],
      ["heterozygousLow 0.1", { heterozygousLow: 0.1 }, "between_bands"],
      ["homozygousMinimum 0.5", { homozygousMinimum: 0.5 }, "deletion_across"],
    ];
    for (const [label, change, id] of perturbed) {
      const calls = observed(await matrixCalls("BAM", { ...READ_CALLING_THRESHOLDS, ...change }));
      const index = receipt.truth.findIndex((truth) => truth.id === id);
      expect(calls[index], label).not.toEqual(expected[index]);
    }
  });
});

describe("the genotype rule at its edges", () => {
  const locus: CallerLocus = { contig: "chr1", position: 1, ref: "A", alts: ["G", "T"], rsid: null };
  const call = (counts: Record<string, number>, overlapping = 1) =>
    genotypeFromCounts(locus, { overlapping, counts: new Map(Object.entries(counts)) }, READ_CALLING_THRESHOLDS);
  it("reads band edges inclusively and leaves the gaps uncalled", () => {
    expect(call({ A: 9, G: 1 }).genotype).toBe("0/0"); // f = 0.10
    expect(call({ A: 17, G: 3 }).reason).toBe("between_bands"); // f = 0.15
    expect(call({ A: 3, G: 1 }, 4).reason).toBe("low_depth");
    expect(call({ A: 15, G: 5 }).genotype).toBe("0/1"); // f = 0.25
    expect(call({ A: 5, G: 15 }).genotype).toBe("0/1"); // f = 0.75
    expect(call({ A: 4, G: 16 }).reason).toBe("between_bands"); // f = 0.80
    expect(call({ A: 1, G: 9 }).genotype).toBe("1/1"); // f = 0.90
  });
  it("never calls when other letters or a second alternate carry more than a tenth of the reads", () => {
    expect(call({ A: 9, G: 9, C: 3 }).reason).toBe("other_letters"); // 3 of 21
    expect(call({ A: 9, G: 9, C: 2 }).genotype).toBe("0/1"); // exactly a tenth is allowed
    expect(call({ A: 8, G: 8, T: 4 }).reason).toBe("other_letters");
    expect(call({ A: 10, G: 9, C: 1 }).genotype).toBe("0/1");
  });
  it("chooses the strongest alternate, and the panel's first one when no read shows any", () => {
    expect(call({ A: 10, T: 10 }).alt).toBe("T");
    expect(call({ A: 20 }).alt).toBe("G");
  });
  it("says not covered only when no read overlaps the position at all", () => {
    expect(call({}, 0).state).toBe("not_covered");
    expect(call({}, 3)).toMatchObject({ state: "no_call", reason: "low_depth", depth: 0 });
  });
});
