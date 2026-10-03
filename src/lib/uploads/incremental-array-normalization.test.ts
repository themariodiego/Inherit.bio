import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { prepareIncrementalArray } from "./incremental-array-normalization";
import { normalizationJsonbByteLength, type PositionEntry } from "./incremental-vcf-normalization";
import type { ArrayKind } from "../genome/parsers/array";
import { resolveReportCalls, type ReportCall } from "../genome/report-calls";
import { resolveTemplate, type ReportTemplate } from "../genome/reports";
import { createPrsCallLookup } from "../genome/prs-call-lookup";
import { computePrs, type PrsScore } from "../genome/prs";

async function* lines(text: string) { yield* text.trimEnd().split("\n"); }
function fixture(build: "GRCh37" | "GRCh38" = "GRCh38", kind: ArrayKind = "array_23andme") {
  const positions = new Map<string, PositionEntry>(); let attempted = 0, unmapped = 0;
  const register = vi.fn(async (_sequence: number, entries: PositionEntry[]) => {
    const acceptedVariantOrdinals: number[] = [];
    entries.forEach((entry, ordinal) => {
      const key = `${entry.source_chrom}:${entry.source_pos}`, prior = positions.get(key);
      if (prior && JSON.stringify(prior) !== JSON.stringify(entry)) throw new Error("native duplicate conflict");
      if (prior) return; positions.set(key, entry); acceptedVariantOrdinals.push(ordinal);
      if (entry.mapped !== null) { attempted++; if (!entry.mapped) unmapped++; }
    });
    return { acceptedVariantOrdinals, attempted, unmapped };
  });
  const stage = vi.fn<Parameters<typeof prepareIncrementalArray>[1]["stage"]>(async () => {});
  return { register, stage, options: { kind, build, maximumUnmappedFraction: 0.02, register, stage } };
}
describe("incremental literal array normalization", () => {
  it.each([["array_23andme", "23andme.txt"], ["array_ancestry", "ancestry.txt"],
    ["array_myheritage", "myheritage.csv"], ["array_ftdna", "ftdna.csv"]] as const)(
    "preserves both real fixture genotypes and unknown alleles for %s", async (kind, name) => {
      const f = fixture("GRCh38", kind), text = readFileSync(path.join(process.cwd(), "e2e/fixtures",
        `path-b-reports-grch38-${name}`), "utf8");
      expect(await prepareIncrementalArray(lines(text), f.options)).toEqual({ variantCount: 2, observedCallCount: 0,
        attempted: 0, unmapped: 0 });
      expect(f.stage.mock.calls).toEqual([["variants", 0, [
        { rsid: 762551, chrom: 15, pos: 74749576, ref: null, alt: null, genotype: "A/C" },
        { rsid: 9923231, chrom: 16, pos: 31096368, ref: null, alt: null, genotype: "C/T" },
      ]]]);
    });
  it("deduplicates actual exact repeated positions across native bounded batches", async () => {
    const f = fixture(); const text = "# Build38\n" + Array.from({ length: 1001 }, (_, n) =>
      `rs${n + 1}\t1\t${n + 1}\tAG`).join("\n") + "\nrs1\t1\t1\tAG\n";
    expect((await prepareIncrementalArray(lines(text), f.options)).variantCount).toBe(1001);
    expect(f.register).toHaveBeenCalledTimes(2);
    expect(f.register.mock.calls.every(([, entries]) => entries.length <= 1000
      && normalizationJsonbByteLength(entries) <= 4_001_024)).toBe(true);
    expect(f.stage.mock.calls.every(([kind]) => kind === "variants")).toBe(true);
  });
  it("refuses a conflicting source duplicate instead of selecting a genotype", async () => {
    const f = fixture(); await expect(prepareIncrementalArray(lines("# Build38\nrs1\t1\t1\tAG\nrs1\t1\t1\tAA\n"),
      f.options)).rejects.toThrow("native duplicate conflict"); expect(f.stage).not.toHaveBeenCalled();
  });
  it("skips unsupported and no-call readings without quality evidence, retaining literal haploid calls", async () => {
    const f = fixture(); const text = "# Build38\nrs1\t1\t1\t--\nrs2\t1\t2\tDI\nrs3\tY\t3\tAA\nrs4\tMT\t4\tG\n";
    expect((await prepareIncrementalArray(lines(text), f.options)).variantCount).toBe(2);
    expect(f.stage.mock.calls[0]).toEqual(["variants", 0, [
      { rsid: 3, chrom: 24, pos: 3, ref: null, alt: null, genotype: "A" },
      { rsid: 4, chrom: 25, pos: 4, ref: null, alt: null, genotype: "G" },
    ]]);
  });
  it("refuses a wholly unusable array", async () => {
    const f = fixture(); await expect(prepareIncrementalArray(lines("# Build38\nrs1\t1\t1\t--\n"), f.options))
      .rejects.toThrow("empty_after_parse"); expect(f.stage).not.toHaveBeenCalled();
  });
  it("requires a pinned caller mapper for37 and preserves negative-strand literal orientation", async () => {
    const f = fixture("GRCh37"); await expect(prepareIncrementalArray(lines("rs1\t1\t1\tAC\n"), f.options))
      .rejects.toThrow("unavailable");
    const lift = (chrom: number, pos: number) => ({ chrom, pos: pos + 100, strand: -1 as const });
    expect(await prepareIncrementalArray(lines("rs1\t1\t1\tAC\n"), { ...f.options, lift }))
      .toEqual({ variantCount: 1, observedCallCount: 0, attempted: 1, unmapped: 0 });
    expect(f.stage.mock.calls[0]).toEqual(["variants", 0,
      [{ rsid: 1, chrom: 1, pos: 101, ref: null, alt: null, genotype: "G/T" }]]);
  });
  it.each([49, 50])("uses the exact source-locus loss denominator for%d positions", async count => {
    const f = fixture("GRCh37"), lift = (chrom: number, pos: number) => pos === 1 ? null : { chrom, pos, strand: 1 as const };
    const text = Array.from({ length: count }, (_, n) => `rs${n + 1}\t1\t${n + 1}\tAA`).join("\n");
    const work = prepareIncrementalArray(lines(text), { ...f.options, lift });
    if (count === 49) await expect(work).rejects.toThrow("liftover_loss");
    else expect(await work).toEqual({ variantCount: 49, observedCallCount: 0, attempted: 50, unmapped: 1 });
  });
  it.each([[0, 0], [-1], [1], [0, 0, 1]])("refuses inexact accepted ordinals %j", async accepted => {
    const f = fixture(); f.register.mockResolvedValue({ acceptedVariantOrdinals: accepted, attempted: 0, unmapped: 0 });
    await expect(prepareIncrementalArray(lines("# Build38\nrs1\t1\t1\tAA\n"), f.options)).rejects.toThrow("unavailable");
    expect(f.stage).not.toHaveBeenCalled();
  });
  it("checks the completed second-pass build instead of accepting a supplied build", async () => {
    const f = fixture(); await expect(prepareIncrementalArray(lines("# Build37\nrs1\t1\t1\tAA\n"), f.options))
      .rejects.toThrow("upload_integrity_mismatch"); expect(f.stage).not.toHaveBeenCalled();
  });
  it("resolves only the exact existing template calls, with unchanged sparse and palindromic score refusals", async () => {
    const f = fixture();
    await prepareIncrementalArray(lines(readFileSync(path.join(process.cwd(),
      "e2e/fixtures/path-b-reports-grch38-23andme.txt"), "utf8")), f.options);
    const calls = (f.stage.mock.calls[0][2] as Omit<ReportCall, "file_id">[])
      .map(row => ({ ...row, file_id: "33333333-3333-4333-8333-333333333333" }));
    const templates: ReportTemplate[] = ["medicines", "lifestyle-wellness"].flatMap(name =>
      (JSON.parse(readFileSync(path.join(process.cwd(), "data/templates", `${name}.json`), "utf8")) as ReportTemplate[])
        .filter(row => ["vkorc1-rs9923231-one-position", "caffeine-metabolism-cyp1a2-rs762551"].includes(row.slug)));
    expect(templates).toHaveLength(2);
    const resolved = resolveReportCalls(calls, templates);
    expect(resolved.conflicts.size).toBe(0);
    expect(templates.map(template => resolveTemplate(template, rsid => resolved.genotypes.get(rsid)).variants[0].outcome))
      .toEqual([expect.objectContaining({ status: "genotyped", genotype: "CT", strandFlipped: false }),
        expect.objectContaining({ status: "genotyped", genotype: "AC", strandFlipped: false })]);
    const missing = resolveReportCalls([], templates);
    expect(templates.map(template => resolveTemplate(template, rsid => missing.genotypes.get(rsid)).variants[0].outcome))
      .toEqual([{ status: "not-covered" }, { status: "not-covered" }]);
    const lookup = createPrsCallLookup(calls);
    expect(lookup.get("15:74749576")).toEqual({ genotype: "A/C", ref: null, alt: null });
    const score: PrsScore = { pgs_id: "SYNTHETIC", name: "Synthetic arithmetic only", trait: "fixture", n_variants: 2,
      citation: { pmid: null, doi: null, label: "Synthetic unit fixture" }, source_url: "", license_note: "", ancestry_note: "",
      variants: [{ rsid: 762551, chrom: 15, pos38: 74749576, effect_allele: "A", other_allele: "C", weight: 1, effect_af: 0.5 },
        { rsid: 1, chrom: 1, pos38: 1, effect_allele: "A", other_allele: "C", weight: 10, effect_af: 0.5 }] };
    expect(computePrs(lookup, score)).toMatchObject({ matched: 1, coverage: 0.5, raw: 1, percentile: null, zscore: null });
    expect(computePrs(lookup, { ...score, variants: [{ ...score.variants[0], effect_allele: "A", other_allele: "T" }] }))
      .toMatchObject({ matched: 0, coverage: 0, raw: 0, percentile: null, zscore: null });
  });
});
