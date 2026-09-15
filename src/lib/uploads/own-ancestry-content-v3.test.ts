import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseVcf } from "../genome/parsers/vcf";
import { REGIONAL_AIMS, REGIONAL_CAVEAT } from "../genome/regional-admixture";
import { computeOwnAncestryContent, CURRENT_OWN_ANCESTRY_PANEL, type OwnAncestryCall, type OwnAncestrySource } from "./own-ancestry-content";
import { ownAncestryCapturedContentSchema } from "./own-ancestry-captured-content";
import { computeOwnAncestryContentV3, ownAncestryContentV3Schema, SEVEN_OWN_ANCESTRY_PANEL } from "./own-ancestry-content-v3";

const fileId = "30000000-0000-4000-8000-000000000001";
const source: OwnAncestrySource = { fileId, subjectId: "30000000-0000-4000-8000-000000000002", sourceRevision: 1,
  sourceSha256: "a".repeat(64), normalizedAt: "2026-09-15T00:00:00Z", normalizedBuild: "GRCh38", callEncoding: "vcf-literal" };
const panel = SEVEN_OWN_ANCESTRY_PANEL;
function call(index = 0): OwnAncestryCall {
  const m = REGIONAL_AIMS[index];
  return { file_id: fileId, chrom: m.chrom, pos: m.pos38, ref: m.ref, alt: m.alt, genotype: `${m.ref}/${m.alt}`, usable: true };
}
const compute = (calls: OwnAncestryCall[] = []) => computeOwnAncestryContentV3({ source, panel, calls });
describe("captured seven-region ancestry", () => {
  it("round-trips v3 and preserves both historical content revisions", () => {
    const current = compute();
    expect(current.admixture.result.proportions).toBeNull();
    expect(ownAncestryCapturedContentSchema.parse(current)).toEqual(current);
    const old = computeOwnAncestryContent({ source, calls: [], panel: CURRENT_OWN_ANCESTRY_PANEL });
    expect(ownAncestryCapturedContentSchema.parse(old)).toEqual(old);
    const oldest = { ...old, schemaVersion: 1, computationRevision: "own-ancestry-content-v1",
      lineages: ["mtdna", "ydna"].map(kind => ({ kind, state: "unavailable", reason: "no_supplied_positions", observedPositions: 0 })) };
    expect(ownAncestryCapturedContentSchema.parse(oldest)).toEqual(oldest);
  });
  it("binds the full synthetic source to the new panel without rounded trigger inputs", () => {
    const rows = REGIONAL_AIMS.map((_, i) => call(i));
    const result = compute(rows);
    expect(ownAncestryContentV3Schema.parse(result)).toEqual(result);
    expect(result).toMatchObject({ schemaVersion: 3, source, panel: { minimumMarkers: 168 },
      admixture: { result_state: "available", coverage: 1, resolution: "seven-regions-adaptive-v1",
        result: { markersUsed: 168, reporting: { caveat: REGIONAL_CAVEAT } } } });
    expect(compute(rows.reverse())).toEqual(result);
    expect(result.admixture.result).not.toHaveProperty("ranges");
  });
  it.each([1, 42, 84, 167])("keeps a %s-marker result partial under the full-panel release policy", count => {
    const result = compute(REGIONAL_AIMS.slice(0, count).map((_, i) => call(i)));
    expect(result.admixture.result_state).toBe("partial");
    expect(result.admixture.result.markersUsed).toBe(count);
    expect(ownAncestryContentV3Schema.safeParse(result).success).toBe(true);
  });
  it("retains actual reference calls but excludes missing, filtered, conflicting and incompatible calls", () => {
    const m = REGIONAL_AIMS[0], row = call();
    expect(compute([{ ...row, genotype: `${m.ref}/${m.ref}` }]).panelPositions.called).toBe(1);
    expect(compute([{ ...row, genotype: "./." }]).panelPositions.noCall).toBe(1);
    expect(compute([{ ...row, usable: false }]).panelPositions.filtered).toBe(1);
    expect(compute([row, { ...row, genotype: `${m.ref}/${m.ref}` }]).panelPositions.conflicting).toBe(1);
    expect(compute([{ ...row, ref: ["A", "C", "G", "T"].find(a => a !== m.ref && a !== m.alt)! }]).panelPositions.unsupported).toBe(1);
    expect(compute().panelPositions.missing).toBe(168);
  });
  it("refuses another file, wrong encoding and a mismatched reference", () => {
    expect(() => compute([{ ...call(), file_id: source.subjectId }])).toThrow("ancestry_source_mismatch");
    expect(() => compute([{ ...call(), ref: null }])).toThrow("ancestry_call_encoding_mismatch");
    expect(() => computeOwnAncestryContentV3({ source, calls: [], panel: { ...panel, version: "other" } })).toThrow("ancestry_panel_mismatch");
    const changed = panel.markers.map((m, i) => i ? m : { ...m, freqs: { ...m.freqs, EUR: 0 } });
    expect(() => computeOwnAncestryContentV3({ source, calls: [], panel: { ...panel, markers: changed } })).toThrow("ancestry_panel_mismatch");
  });
  it("rejects altered saved reporting, coverage, fit diagnostics and invented ranges", () => {
    const value = compute([call()]), result = value.admixture.result;
    for (const altered of [
      { ...result, reporting: { ...result.reporting, merged: !result.reporting.merged } },
      { ...result, reporting: { ...result.reporting, threshold: 0.2 } },
      { ...result, reporting: { ...result.reporting, caveat: "certain" } },
      { ...result, proportions: null }, { ...result, fit: { iterations: 0, converged: true } },
      { ...result, ranges: { EUR: { low: 0, high: 1 } } },
    ]) expect(ownAncestryContentV3Schema.safeParse({ ...value, admixture: { ...value.admixture, result: altered } }).success).toBe(false);
    expect(ownAncestryContentV3Schema.safeParse({ ...value, admixture: { ...value.admixture, coverage: 1 } }).success).toBe(false);
  });
  it("retains both computed lineages from the committed synthetic fixture", async () => {
    const text = await readFile("e2e/fixtures/lineage-grch38.vcf", "utf8");
    async function* lines() { yield* text.split(/\r?\n/); }
    const parsed = await parseVcf(lines());
    const lineageCalls = parsed.records.filter(r => r.chrom === 24 || r.chrom === 25).map(r => ({ file_id: fileId,
      chrom: r.chrom, pos: r.pos, ref: r.ref, alt: r.alt, genotype: r.genotype, usable: true }));
    const value = computeOwnAncestryContentV3({ source, panel, calls: [], lineageCalls });
    expect(value.lineages.map(row => row.call?.haplogroup)).toEqual(["K1", "I2"]);
    expect(ownAncestryContentV3Schema.parse(value)).toEqual(value);
    expect(value.admixture.result.proportions).toBeNull();
    const lineage = value.lineages[0], actual = lineage.call!;
    for (const invalid of [{ ...actual, path: ["L"] }, { ...actual, matched: actual.tested + 1 },
      { ...actual, tested: lineage.readablePositions + 1 }]) {
      expect(ownAncestryContentV3Schema.safeParse({ ...value,
        lineages: [{ ...lineage, call: invalid }, value.lineages[1]] }).success).toBe(false);
    }
  });
});
