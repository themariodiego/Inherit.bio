import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import panelFile from "../../../../data/ref/read-calling-loci.json";
import { buildProduct, PRODUCT_PLAN, writeBam } from "../../../../scripts/generate-read-calling-fixtures";
import { prepareIncrementalVcf, type PositionEntry } from "../../uploads/incremental-vcf-normalization";
import { validateSubjectStructure } from "../../uploads/subject-structure";
import { countInputLines, emptyReadCounts } from "../input-provenance";
import { ReadFileError } from "./binary";
import { blobChunks } from "./bgzf";
import { openCram, type ReferenceLookup } from "./cram";
import { parseFasta, referenceLookup } from "./fasta";
import { callLoci, type CallerLocus } from "./caller";
import { assertGrch38, type ReadCallingPanel } from "./panel";
import { callReadsFile, readFileKind } from "./read-calls";
import { readCallsMarker, READ_CALLS_NOTE, writeReadCallVcf } from "./read-call-vcf";
import { READ_CALLING_THRESHOLDS } from "./thresholds";

/**
 * Reads in, canonical calls out, through the unchanged VCF path (ADR 0038).
 * The VCF the caller writes is handed to the server's own structural
 * validator, listed-call counter and incremental normalizer, and the rows
 * they stage are compared with the planted truth.
 */

const panel = panelFile as unknown as ReadCallingPanel;
const file = (name: string) => new Uint8Array(readFileSync(name));
const blob = (data: Uint8Array) => new Blob([data as BlobPart]);
const PRODUCT = "e2e/fixtures/read-calls-product-grch38.bam";
const MATRIX = "src/lib/genome/reads/fixtures";

/** The VCF path's staging, with the registration contract modelled as the
 * incremental normalizer's own tests model it (one row per position). */
async function canonicalRows(vcf: string) {
  const observed: Record<string, unknown>[] = [], variants: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  const summary = await prepareIncrementalVcf((async function* () { yield* vcf.trimEnd().split("\n"); })(), {
    build: "GRCh38", maximumUnmappedFraction: 0.1,
    register: async (_sequence: number, entries: PositionEntry[]) => {
      const acceptedVariantOrdinals: number[] = [];
      entries.forEach((entry, ordinal) => {
        const key = `${entry.source_chrom}:${entry.source_pos}`;
        expect(seen.has(key), `one row per position (${key})`).toBe(false);
        seen.add(key);
        if (entry.variant) acceptedVariantOrdinals.push(ordinal);
      });
      return { acceptedVariantOrdinals, attempted: 0, unmapped: 0 };
    },
    stage: async (kind, _sequence, rows) => { (kind === "observed" ? observed : variants).push(...(rows as Record<string, unknown>[])); },
  });
  return { summary, observed, variants };
}
async function code(work: () => Promise<unknown>) {
  try { await work(); } catch (error) { return error instanceof ReadFileError ? error.code : `other: ${String(error)}`; }
  return "no error";
}

describe("the product BAM, through the existing VCF path", () => {
  it("calls the four planted report positions and leaves every other position unlisted", async () => {
    const result = await callReadsFile({ reads: blob(file(PRODUCT)), reference: null, panel });
    expect(result.summary).toEqual({ input: "BAM", positions: panel.loci.length, called: 3, noCall: 1, notCovered: panel.loci.length - 4 });
    const rows = result.vcf.trimEnd().split("\n").filter((line) => !line.startsWith("#"));
    expect(rows).toEqual([
      "chr2\t135851076\trs4988235\tG\tA\t.\tPASS\tIRC=called\tGT:DP:AD\t1/1:16:0,16",
      "chr11\t66560624\trs1815739\tC\tT\t.\t.\tIRC=low_depth\tGT:DP:AD\t./.:4:2,2",
      "chr12\t111803962\trs671\tG\tA\t.\tPASS\tIRC=called\tGT:DP:AD\t0/0:14:14,0",
      "chr15\t74749576\trs762551\tC\tA\t.\tPASS\tIRC=called\tGT:DP:AD\t0/1:22:12,10",
    ]);
    expect(PRODUCT_PLAN.map((locus) => locus.genotype)).toEqual(["1/1", "./.", "0/0", "0/1"]);
  });

  it("says in its header who called it, from what, under which unreviewed thresholds", async () => {
    const { vcf } = await callReadsFile({ reads: blob(file(PRODUCT)), reference: null, panel });
    const header = vcf.split("\n").filter((line) => line.startsWith("##"));
    expect(header).toContain(readCallsMarker("BAM"));
    expect(readCallsMarker("BAM")).toBe("##inheritReadCalls=<Version=inherit-read-calls-v1,Input=BAM,MinimumDepth=10,"
      + "MinimumBaseQuality=20,MinimumMappingQuality=20,HeterozygousLow=0.25,HeterozygousHigh=0.75,HomozygousMinimum=0.9,Reviewed=false>");
    expect(header).toContain(READ_CALLS_NOTE);
    expect(READ_CALLS_NOTE).toContain("Inherit called these genotypes from sequencing reads it did not generate.");
    expect(READ_CALLS_NOTE).toContain("engineering defaults pending scientific review");
    expect(header).toContain("##reference=GRCh38");
  });

  it("passes the server's own structural check and listed-call count unchanged", async () => {
    const { vcf } = await callReadsFile({ reads: blob(file(PRODUCT)), reference: null, panel });
    const encoded = new TextEncoder().encode(vcf);
    const evidence = await validateSubjectStructure((async function* () { yield encoded; })(), {
      declaredFormat: "VCF", expectedSize: encoded.length, expectedSha256: null, maximumDecodedBytes: 10_000_000 });
    expect(evidence).toMatchObject({ rawBytes: encoded.length, decodedBytes: encoded.length });
    const counts = emptyReadCounts();
    const drained: string[] = [];
    for await (const line of countInputLines((async function* () { yield* vcf.trimEnd().split("\n"); })(), "vcf", counts)) drained.push(line);
    expect(drained).toEqual(vcf.trimEnd().split("\n"));
    expect(counts).toEqual({ called: 3, noCall: 1, unsupported: 0, failedFilter: 0, blocks: 0, singleSample: true, buildClaim: true });
  });

  it("stages exactly the canonical observed rows and variant rows a VCF with these calls produces", async () => {
    const { vcf } = await callReadsFile({ reads: blob(file(PRODUCT)), reference: null, panel });
    const { summary, observed, variants } = await canonicalRows(vcf);
    expect(summary).toEqual({ variantCount: 2, observedCallCount: 4, attempted: 0, unmapped: 0 });
    const row = (line: number, chrom: number, pos: number, rsid: number, ref: string, alt: string, gt: string,
      genotype: string, depth: number, called: boolean) => ({
      source_line: line, source_chrom: chrom, source_pos: pos, source_ref: ref, source_alt: alt, source_gt: gt, rsid,
      chrom, pos, ref, alt, genotype, site_filter: called ? "PASS" : null, sample_filter: null, genotype_quality: null,
      read_depth: depth, quality_state: called ? "pass" : "unknown", usable: called });
    expect(observed).toEqual([
      row(11, 2, 135851076, 4988235, "G", "A", "1/1", "A/A", 16, true),
      row(12, 11, 66560624, 1815739, "C", "T", "./.", "--", 4, false),
      row(13, 12, 111803962, 671, "G", "A", "0/0", "G/G", 14, true),
      row(14, 15, 74749576, 762551, "C", "A", "0/1", "A/C", 22, true),
    ]);
    expect(variants).toEqual([
      { rsid: 4988235, chrom: 2, pos: 135851076, ref: "G", alt: "A", genotype: "A/A" },
      { rsid: 762551, chrom: 15, pos: 74749576, ref: "C", alt: "A", genotype: "A/C" },
    ]);
  });
});

describe("the CRAM matrix, through the existing VCF path", () => {
  it("stages one canonical row per called or uncalled position with an rsID, and none for the uncovered one", async () => {
    const receipt = JSON.parse(readFileSync(`${MATRIX}/synthetic-matrix.receipt.json`, "utf8")) as {
      truth: { id: string; contig: string; position: number; ref: string; alts: string[]; rsid: number | null;
        state: string; genotype: string; alt: string; depth: number }[];
    };
    const loci: CallerLocus[] = receipt.truth.map((truth) => ({ contig: truth.contig, position: truth.position,
      ref: truth.ref, alts: truth.alts, rsid: truth.rsid }));
    const genome = await parseFasta(file(`${MATRIX}/synthetic-reference.fa`));
    let lookup: ReferenceLookup | null = null;
    const cram = await openCram(blobChunks(blob(file(`${MATRIX}/synthetic-matrix.cram`))), (reference) => lookup?.(reference) ?? null);
    lookup = referenceLookup(genome, cram.header.references);
    const calls = await callLoci(cram.records, cram.header.references, loci, READ_CALLING_THRESHOLDS);
    const vcf = writeReadCallVcf(calls, { input: "CRAM", contigOrder: ["chr20", "chr21", "chr22"] });
    const { observed } = await canonicalRows(vcf);
    const listed = receipt.truth.filter((truth) => truth.state !== "not_covered" && truth.rsid !== null);
    expect(observed.map((row) => [row.source_chrom, row.source_pos, row.source_gt, row.genotype, row.read_depth, row.usable]))
      .toEqual(listed.map((truth) => {
        const [a, b] = truth.genotype === "./." ? [] : truth.genotype.split("/").map((index) => index === "0" ? truth.ref : truth.alt);
        return [Number(truth.contig.slice(3)), truth.position, truth.genotype,
          truth.genotype === "./." ? "--" : [a, b].sort().join("/"), truth.depth, truth.state === "called"];
      }));
    expect(vcf).toContain(readCallsMarker("CRAM"));
  });
});

describe("what the uploader refuses before anything is sent", () => {
  it("knows a BAM, a CRAM and anything else from the first bytes", async () => {
    expect(await readFileKind(file(PRODUCT).subarray(0, 65536))).toBe("BAM");
    expect(await readFileKind(file(`${MATRIX}/synthetic-matrix.cram`).subarray(0, 64))).toBe("CRAM");
    expect(await readFileKind(new TextEncoder().encode("##fileformat=VCFv4.2\n"))).toBeNull();
  });

  it("a CRAM needs its own reference, and these invented contigs are not GRCh38", async () => {
    const cram = blob(file(`${MATRIX}/synthetic-matrix.cram`));
    expect(await code(() => callReadsFile({ reads: cram, reference: null, panel }))).toBe("reference_required");
    expect(await code(() => callReadsFile({ reads: cram, reference: blob(new TextEncoder().encode("##not a fasta\n")), panel })))
      .toBe("reference_mismatch");
    expect(await code(() => callReadsFile({ reads: cram, reference: blob(file(`${MATRIX}/synthetic-reference.fa`)), panel })))
      .toBe("unsupported_build");
  });

  it("reads aligned to anything but GRCh38 are refused, and so is a file that covers no product position", async () => {
    const product = buildProduct(process.cwd());
    const grch37 = product.references.map((reference) => reference.name === "chr1" ? { ...reference, length: 249250621 } : reference);
    const text37 = product.headerText.replace("LN:248956422", "LN:249250621").replaceAll("AS:GRCh38", "AS:GRCh37");
    expect(await code(() => callReadsFile({ reads: blob(writeBam(text37, grch37, product.reads)), reference: null, panel })))
      .toBe("unsupported_build");
    const elsewhere = product.reads.map((read) => ({ ...read, pos0: read.pos0 + 5000 }));
    expect(await code(() => callReadsFile({ reads: blob(writeBam(product.headerText, product.references, elsewhere)), reference: null, panel })))
      .toBe("nothing_covered");
    expect(() => assertGrch38([])).toThrow(ReadFileError);
    expect(() => assertGrch38([{ name: "chr1", length: 248956422, md5: null, assembly: "GRCh37" }])).toThrow(ReadFileError);
  });
});
