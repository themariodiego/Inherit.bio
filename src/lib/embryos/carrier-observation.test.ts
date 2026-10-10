import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CarrierAssertionRow, CarrierCall } from "../family/carrier-assertions";
import { allowedConditionsRegistry, type AllowedConditionEntry } from "./allowed-conditions";
import { observeEmbryoCarrierAllele, type EmbryoCarrierObservationInput,
  type EmbryoCarrierSource } from "./carrier-observation";
import { analyseEmbryoFragment } from "./split-analysis";
import { embryoVcfChunks, validateEmbryoVcfChunk } from "./vcf-transport";

// All calls, reference labels and registry membership below are synthetic.
// Injection does not activate a clinical assertion or the committed registry.
const file = "70000000-0000-4000-8000-000000000004";
const source: EmbryoCarrierSource = {
  cohort_id: "70000000-0000-4000-8000-000000000001",
  embryo_id: "70000000-0000-4000-8000-000000000002",
  subject_id: "70000000-0000-4000-8000-000000000003", file_id: file,
  canonical_build: "GRCh38",
  source_sha256: "a".repeat(64), source_binding_fingerprint: "b".repeat(64),
  source_publication_revision: 3, upload_revision: 2, normalization_source_revision: 2,
  call_immutability_proof: "exact-staged-calls-v1",
};
const entry: AllowedConditionEntry = {
  condition_id: "SYNTHETIC:1", condition_name: "Synthetic recessive condition",
  category: "Having children", permitted_result_kinds: ["carrier_status"],
  risk_model_id: null, enabled_by_default: true,
};
const registry = { ...allowedConditionsRegistry(), conditions: [entry] };
const assertion: CarrierAssertionRow = {
  assertion_id: 1, release_id: "synthetic-embryo-observation", gene_validity_read_on: "2026-10-02",
  variation_id: 1, condition_id: entry.condition_id, condition_name: entry.condition_name,
  gene_symbol: "SYNTHETIC", inheritance_mode: "autosomal_recessive", penetrance_class: "unestablished",
  penetrance_citation: null, variant_name: "Synthetic A>G at 1:1000", classification: "Pathogenic",
  review_status: "reviewed by expert panel", review_stars: 3, last_evaluated: null,
  chrom: 1, pos: 1000, ref: "A", alt: "G", equivalents: [],
};
function call(genotype = "A/G", patch: Partial<CarrierCall> = {}) {
  return { fileId: file, chrom: 1, pos: 1000, ref: "A", alt: "G", genotype, ...patch };
}
function input(patch: Partial<EmbryoCarrierObservationInput> = {}): EmbryoCarrierObservationInput {
  return { condition_id: entry.condition_id, condition_registry: [{ condition_id: entry.condition_id,
    condition_name: entry.condition_name, category: entry.category, active: true }],
    assertions: [assertion], source, calls: [call()], ...patch };
}
const observe = (patch: Partial<EmbryoCarrierObservationInput> = {}) => observeEmbryoCarrierAllele(input(patch), registry);

describe("one exact reviewed embryo allele, measured from its own called source", () => {
  it.each([
    ["A/A", 0, "not_detected"], ["A/G", 1, "carrier"], ["G/A", 1, "carrier"], ["G/G", 2, "two_variants"],
  ] as const)("counts %s as %i copies and %s without a probability", (genotype, copies, state) => {
    const result = observe({ calls: [call(genotype)] });
    expect(result).toEqual({ ok: true, observation: {
      version: 1, producer: "embryo-reviewed-allele-observation-v1", figure_basis: { version: 1, basis: "observed" },
      source, assertion, covered_positions: 1, required_positions: 1,
      observed_copies: copies, carrier_state: state, confirmation_required: true,
    } });
    const saved = JSON.parse(JSON.stringify(result));
    expect(saved).toEqual(result);
    expect(JSON.stringify(saved)).not.toMatch(/probability|absolute_risk|interval|rank|best|baseline/);
  });

  it("reads the actual VCF producer's homozygous reference row with no ALT, including a palindromic allele", () => {
    expect(observe({ assertions: [{ ...assertion, alt: "T" }], calls: [call("A/A", { alt: null })] }))
      .toMatchObject({ ok: true, observation: { observed_copies: 0, carrier_state: "not_detected" } });
    expect(observe({ calls: [call("A/G", { alt: null })] })).toEqual({ ok: false, reason: "invalid_calls" });
  });

  it("uses the existing reviewed equivalent spelling for an indel, retaining the original assertion", () => {
    const deletion = { ...assertion, ref: "ATCT", alt: "A", equivalents: [[1001, "TCTT", "T"]] } as CarrierAssertionRow;
    expect(observe({ assertions: [deletion], calls: [call("T/TCTT", { pos: 1001, ref: "TCTT", alt: "T" })] }))
      .toMatchObject({ ok: true, observation: { observed_copies: 1, assertion: deletion } });
    expect(observe({ assertions: [deletion], calls: [call("TCTT/TCTT", { pos: 1001, ref: "TCTT", alt: null })] }))
      .toMatchObject({ ok: true, observation: { observed_copies: 0 } });
  });

  it("counts no target copy from another actually observed SNV at the exact position", () => {
    expect(observe({ calls: [call("A/C", { alt: "C" })] }))
      .toMatchObject({ ok: true, observation: { observed_copies: 0 } });
  });

  it("neither changes its inputs nor aliases the saved source and assertion evidence", () => {
    const request = input();
    const before = JSON.stringify(request);
    const result = observeEmbryoCarrierAllele(request, registry);
    expect(JSON.stringify(request)).toBe(before);
    if (!result.ok) throw new Error("synthetic reading refused");
    result.observation.assertion.variant_name = "Mutated private result";
    result.observation.source.source_sha256 = "c".repeat(64);
    expect(JSON.stringify(request)).toBe(before);
  });

  it("computes from the original transport and actual per-ordinal parser without a parent or sibling input", async () => {
    const binding = { challenge: "s".repeat(43), revision: 3, build: "GRCh38" as const,
      sampleCount: 2, handles: ["h".repeat(43), "k".repeat(43)] };
    const chunks = await Array.fromAsync(embryoVcfChunks(new Blob([
      readFileSync("e2e/fixtures/embryo-pair-grch38.vcf", "utf8"),
    ]), binding));
    const fragments = validateEmbryoVcfChunk(chunks[0], { ...binding,
      resolveHandle: (handle) => { const i = binding.handles.indexOf(handle); return i < 0 ? null : i; } });
    expect(fragments).toHaveLength(2);
    for (const fragment of fragments) {
      const ownCalls: CarrierCall[] = [];
      await analyseEmbryoFragment(new TextEncoder().encode(fragment.vcf), fragment.ordinal, "GRCh38", (row) => {
        const [chrom, pos, ref, alt, genotype] = row;
        if (chrom === 1 && pos === 22133085) ownCalls.push({ fileId: file, chrom, pos, ref, alt, genotype });
      });
      expect(ownCalls).toHaveLength(1);
      expect(ownCalls[0]).toMatchObject({ chrom: 1, pos: 22133085, ref: "T",
        genotype: fragment.ordinal === 0 ? "T/T" : "C/C" });
      const ownAssertion = { ...assertion, pos: 22133085, ref: "T", alt: "C", variant_name: "Synthetic T>C at 1:22133085" };
      expect(observe({ assertions: [ownAssertion], calls: ownCalls }))
        .toMatchObject({ ok: true, observation: { observed_copies: fragment.ordinal === 0 ? 0 : 2 } });
    }
  });
});

describe("closed references and source inputs", () => {
  it("refuses the committed empty registry before inspecting any genomic or reference input", () => {
    const request = input();
    for (const key of ["source", "assertions", "calls", "condition_registry"] as const) {
      Object.defineProperty(request, key, { get: () => { throw new Error("must not inspect unregistered inputs"); } });
    }
    expect(observeEmbryoCarrierAllele(request)).toEqual({ ok: false, reason: "unregistered_condition" });
  });

  it.each(["absent", "inactive", "duplicate", "different-name", "different-category", "risk-model", "mixed-kinds"])(
    "refuses %s membership before accepting an assertion", (fault) => {
      const rows = [...input().condition_registry];
      if (fault === "absent") rows.splice(0);
      if (fault === "inactive") rows[0].active = false;
      if (fault === "duplicate") rows.push({ ...rows[0] });
      if (fault === "different-name") rows[0].condition_name = "Different condition";
      if (fault === "different-category") rows[0].category = "Cancer";
      const localEntry = { ...entry, risk_model_id: fault === "risk-model" ? "unregistered" : null,
        permitted_result_kinds: fault === "mixed-kinds" ? ["carrier_status", "absolute_risk"] : ["carrier_status"] };
      expect(observeEmbryoCarrierAllele(input({ condition_registry: rows }), { ...registry, conditions: [localEntry] }))
        .toEqual({ ok: false, reason: "unregistered_condition" });
    });

  it("rejects malformed or widened condition rows instead of treating a truthy value as active", () => {
    for (const row of [{ ...input().condition_registry[0], active: "true" },
      { ...input().condition_registry[0], extra: true }, { condition_id: entry.condition_id, active: true }]) {
      expect(observe({ condition_registry: [row] as unknown as EmbryoCarrierObservationInput["condition_registry"] }))
        .toEqual({ ok: false, reason: "unregistered_condition" });
    }
  });

  it.each([
    { review_stars: 1 }, { review_stars: 4 }, { classification: "Uncertain significance" },
    { chrom: 23 }, { condition_id: "SYNTHETIC:2" }, { condition_name: "Different condition" },
    { release_id: "clinvar-2026-09" }, { ref: "AC", alt: "GT" }, { ref: "A", alt: "AA" },
    { alt: "A" }, { penetrance_class: "high", penetrance_citation: null }, { extra: true },
    { equivalents: [[1000, "A", "G"]] }, { equivalents: [[1001, "A", "G"]] },
  ])("refuses malformed or unsupported reviewed evidence %j", (patch) => {
    expect(observe({ assertions: [{ ...assertion, ...patch }] })).toEqual({ ok: false, reason: "invalid_reference" });
  });

  it.each(["autosomal_dominant", "x_linked", "other", "unknown"] as const)("withholds %s interpretation", (mode) => {
    expect(observe({ assertions: [{ ...assertion, inheritance_mode: mode }] }))
      .toEqual({ ok: false, reason: "unsupported_inheritance" });
  });

  it("never chooses a duplicate assertion or sums two unphased alleles into a condition result", () => {
    expect(observe({ assertions: [assertion, assertion] })).toEqual({ ok: false, reason: "unsupported_allele_set" });
    expect(observe({ assertions: [assertion, { ...assertion, assertion_id: 2, pos: 2000 }] }))
      .toEqual({ ok: false, reason: "unsupported_allele_set" });
    expect(observeEmbryoCarrierAllele(input(), { ...registry, conditions: [entry, entry] }))
      .toEqual({ ok: false, reason: "unregistered_condition" });
  });

  it.each([
    { call_immutability_proof: null }, { call_immutability_proof: "exact-staged-calls-v2" },
    { canonical_build: "GRCh37" }, { canonical_build: null },
    { normalization_source_revision: 1 }, { upload_revision: 0 }, { source_publication_revision: 0 },
    { source_sha256: "not a digest" }, { file_id: "not an id" }, { embryo_id: null }, { extra: true },
  ])("refuses legacy or mismatched source metadata %j", (patch) => {
    expect(observe({ source: { ...source, ...patch } })).toEqual({ ok: false, reason: "invalid_source" });
  });

  it.each([
    call("A/G", { fileId: "70000000-0000-4000-8000-000000000005" }),
    call("G"), call("A/G/G"), call("0/1"), call("A|G"), call("A/N"),
    call("A/G", { chrom: 23 }), call("A/G", { pos: 2000 }), call("A/G", { ref: null }),
    call("A/G", { alt: "G,T" }), { ...call(), extra: true },
  ])("refuses another file, non-autosomal, non-diploid or malformed call %j", (value) => {
    expect(observe({ calls: [value] })).toEqual({ ok: false, reason: "invalid_calls" });
  });

  it.each([[], [call("--")], [call("A/G", { usable: false })],
    [call("A/G"), call("--")], [call("T/G", { ref: "T", alt: "G" })]].map((calls) => ({ calls })))(
    "withholds missing/unreadable/unmatched calls $calls without inventing a reference", ({ calls }) => {
      expect(observe({ calls })).toEqual({ ok: false, reason: "not_covered" });
    });

  it("refuses discordant canonical/reference calls and permits only agreeing evidence", () => {
    expect(observe({ calls: [call("A/G"), call("A/A", { alt: null })] }))
      .toEqual({ ok: false, reason: "source_call_disputed" });
    expect(observe({ calls: [call("G/A"), call("A/G")] }))
      .toMatchObject({ ok: true, observation: { observed_copies: 1 } });
    expect(observe({ calls: Array.from({ length: 257 }, () => call()) })).toEqual({ ok: false, reason: "invalid_calls" });
  });
});
