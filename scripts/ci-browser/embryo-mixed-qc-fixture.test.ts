import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mixedQcVcf } from "./embryo-mixed-qc-fixture";
import { assertMixedQcPublication } from "./embryo-mixed-qc-proof";
import { embryoVcfChunks, validateEmbryoVcfChunk } from "../../src/lib/embryos/vcf-transport";
import { analyseEmbryoFragment, embryoOrdinalOutcome } from "../../src/lib/embryos/split-analysis";

const source = readFileSync("e2e/fixtures/embryo-pair-grch38.vcf", "utf8");
const binding = { challenge: "s".repeat(43), revision: 1, build: "GRCh38" as const, sampleCount: 2,
  handles: ["h".repeat(43), "k".repeat(43)] };
it("measures the planted no-calls through the real sanitiser/parser, preserving the first sample exactly", async () => {
  const changed = mixedQcVcf(source);
  const originalRows = source.split("\n").filter(line => line && !line.startsWith("#"));
  const changedRows = changed.split("\n").filter(line => line && !line.startsWith("#"));
  expect(changedRows.map(line => line.split("\t").slice(0, 10))).toEqual(originalRows.map(line => line.split("\t").slice(0, 10)));
  const chunks = await Array.fromAsync(embryoVcfChunks(new Blob([changed]), binding));
  expect(chunks).toHaveLength(1);
  const fragments = validateEmbryoVcfChunk(chunks[0], { ...binding, resolveHandle: handle => {
    const ordinal = binding.handles.indexOf(handle); return ordinal < 0 ? null : ordinal;
  } });
  const outcomes = [];
  for (const fragment of fragments) {
    const rows: unknown[] = [];
    const measured = await analyseEmbryoFragment(new TextEncoder().encode(fragment.vcf), fragment.ordinal, "GRCh38", row => { rows.push(row); });
    expect(rows).toHaveLength(fragment.ordinal === 0 ? 1200 : 588);
    const outcome = embryoOrdinalOutcome(measured);
    expect(outcome.qc.figure_basis.producer).toBe("embryo-split-calls-v1");
    expect(outcome.qc.figure_basis.call_rate.basis).toBe("observed");
    expect(outcome.qc.sites_expected).toBe(1200);
    outcomes.push(outcome);
  }
  expect(outcomes).toMatchObject([
    { outcome: "passed", variantCount: 1200, qc: { sites_called: 1200, call_rate: 1, qc_verdict: "pass" } },
    { outcome: "qc_fail_no_source", variantCount: 0, failureReason: "embryo_call_rate", qc: { sites_called: 588, call_rate: 0.49, qc_verdict: "fail" } },
  ]);
});

it("refuses foreign, wrong-sample and incomplete planted inputs", () => {
  for (const invalid of [source.replace("no real person", "unknown source"), source.replace(/#CHROM[^\n]+/, "#CHROM"), source.split("\n").slice(0, 30).join("\n")])
    expect(() => mixedQcVcf(invalid)).toThrow();
});

describe("whole mixed cohort publication proof", () => {
  const proof = { jobs: 1, sessions: 1, cohorts: 1, sources: 1, parts: 1, allPartsCurrent: true,
    pendingOrdinals: 0, pendingVariants: 0, scores: 0, ordinals: [
      { ordinal: 0, status: "qc_pass", sources: 1, parts: 1 },
      { ordinal: 1, status: "qc_fail", sources: 0, parts: 0 },
    ] };
  it("accepts only the complete measured disposition", () => { expect(assertMixedQcPublication(proof)).toEqual(proof); });
  it("refuses incomplete, dirty, crossed, unsupported or manufactured publication", () => {
    for (const invalid of [{ ...proof, jobs: 0 }, { ...proof, cohorts: 0 }, { ...proof, pendingOrdinals: 1 },
      { ...proof, pendingVariants: 1 }, { ...proof, scores: 1 }, { ...proof, allPartsCurrent: false },
      { ...proof, sources: 2 }, { ...proof, ordinals: proof.ordinals.slice(0, 1) },
      { ...proof, ordinals: [...proof.ordinals].reverse() },
      { ...proof, ordinals: [proof.ordinals[0], { ...proof.ordinals[1], sources: 1 }] },
      { ...proof, ordinals: [proof.ordinals[0], { ...proof.ordinals[1], parts: 1 }] },
      { ...proof, ordinals: [proof.ordinals[0], { ...proof.ordinals[1], status: "qc_pass" }] }, { ...proof, extra: true }])
      expect(() => assertMixedQcPublication(invalid)).toThrow();
  });
});
