import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { allowedConditionsRegistry, type AllowedConditionsFile } from "./allowed-conditions";
import type { CarrierAssertionRow } from "../family/carrier-assertions";
import { runNextEmbryoCarrier, type EmbryoCarrierRpc } from "./carrier-worker";
import { embryoVcfChunks, validateEmbryoVcfChunk } from "./vcf-transport";
import { analyseEmbryoFragment, embryoOrdinalOutcome } from "./split-analysis";
import { observeEmbryoCarrierAllele } from "./carrier-observation";

const id = (n: number) => `71000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const entry = { condition_id: "SYNTHETIC:1", condition_name: "Synthetic observed recessive condition",
  category: "Having children", permitted_result_kinds: ["carrier_status"], risk_model_id: null, enabled_by_default: true };
const registry: AllowedConditionsFile = { ...allowedConditionsRegistry(), conditions: [entry] };
const assertion: CarrierAssertionRow = { assertion_id: 1, variation_id: 1, release_id: "synthetic-worker-observation",
  gene_validity_read_on: "2026-10-02", condition_id: entry.condition_id, condition_name: entry.condition_name,
  gene_symbol: "SYNTHETIC", inheritance_mode: "autosomal_recessive", penetrance_class: "unestablished",
  penetrance_citation: null, variant_name: "Synthetic T>C at 1:22133085", classification: "Pathogenic",
  review_status: "reviewed by expert panel", review_stars: 3, last_evaluated: null,
  chrom: 1, pos: 22133085, ref: "T", alt: "C", equivalents: [] };

// Both actual per-ordinal parser outputs are used. No parent, sibling or
// reference call is invented to make a positive worker result.
async function fixture(source?: string, evidence: CarrierAssertionRow[] = [assertion]) {
  const binding = { challenge: "s".repeat(43), revision: 3, build: "GRCh38" as const,
    sampleCount: 2, handles: ["h".repeat(43), "k".repeat(43)] };
  const chunks = await Array.fromAsync(embryoVcfChunks(new Blob([
    source ?? readFileSync("e2e/fixtures/embryo-pair-grch38.vcf", "utf8"),
  ]), binding));
  const fragments = validateEmbryoVcfChunk(chunks[0], { ...binding,
    resolveHandle: h => binding.handles.indexOf(h) });
  const calls = new Map<string, unknown[]>();
  const embryos = [];
  for (const fragment of fragments) {
    const embryoId = id(10 + fragment.ordinal), fileId = id(30 + fragment.ordinal), ownCalls: unknown[] = [];
    const measured = await analyseEmbryoFragment(new TextEncoder().encode(fragment.vcf), fragment.ordinal, "GRCh38", row => {
      if (evidence.some(a => row[0] === a.chrom && [a.pos, ...a.equivalents.map(key => key[0])].includes(row[1]))) ownCalls.push({ fileId,
        chrom: row[0], pos: row[1], ref: row[2], alt: row[3], genotype: row[4] });
    });
    const outcome = embryoOrdinalOutcome(measured);
    calls.set(embryoId, ownCalls);
    embryos.push({ embryoId, sampleOrdinal: fragment.ordinal,
      source: { cohort_id: id(1), embryo_id: embryoId, subject_id: id(20 + fragment.ordinal), file_id: fileId,
        canonical_build: "GRCh38", source_sha256: (fragment.ordinal === 0 ? "a" : "b").repeat(64),
        source_binding_fingerprint: (fragment.ordinal === 0 ? "a" : "b").repeat(64),
        source_publication_revision: 1, upload_revision: 1, normalization_source_revision: 1,
        call_immutability_proof: "exact-staged-calls-v1" },
      qc: { embryo_id: embryoId, ...outcome.qc,
        parent_a_concordance: null, parent_b_concordance: null, allelic_dropout_estimate: null,
        allelic_dropout_interval_low: null, allelic_dropout_interval_high: null, allelic_dropout_method: null,
        amplification_method: null, source_laboratory: null, source_assay: null,
        imputation_performed: false, imputation_panel: null, contamination_estimate: null,
        computed_at: "2026-10-02T00:00:00.000Z" },
    });
  }
  const claim = { version: "embryo-carrier-claim-v1", jobId: id(2), attempt: 1,
    claimExpiresAt: new Date(Date.now() + 300_000).toISOString(), deadline: new Date(Date.now() + 3_600_000).toISOString(),
    captureSha256: "d".repeat(64), capture: { version: "embryo-carrier-capture-v1", cohortId: id(1),
      publicationRevision: 1, registry, authority: { basisFingerprint: "e".repeat(64), grants: [id(9)] },
      conditions: [{ condition_id: entry.condition_id, condition_registry: [{ condition_id: entry.condition_id,
        condition_name: entry.condition_name, category: entry.category, active: true }], assertions: evidence,
        reference_receipt: { review: "synthetic-only", release: "synthetic-only" } }], embryos },
  };
  const operations: string[] = [], reads: string[] = [], saved: unknown[] = [];
  let cancelAt: string | undefined, edit: ((operation: string, value: unknown) => unknown) | undefined;
  const rpc: EmbryoCarrierRpc = async (_name, args) => {
    operations.push(args.p_operation);
    expect(args.p_test_jurisdiction).toBe(true);
    expect(args.p_claim_token_hash).toMatch(/^[0-9a-f]{64}$/);
    if (cancelAt === `${args.p_operation}:${operations.filter(op => op === args.p_operation).length}`) return { status: "cancelled" };
    let value: unknown;
    switch (args.p_operation) {
      case "claim": value = structuredClone(claim);break;
      case "check": {
        value = { version: "embryo-carrier-check-v2", jobId: claim.jobId, attempt: claim.attempt,
          claimExpiresAt: claim.claimExpiresAt, deadline: claim.deadline, captureSha256: claim.captureSha256 };break;
      }
      case "read": {
        const payload = args.p_payload as { embryoId: string; conditionId: string };
        reads.push(payload.embryoId);
        value = { version: "embryo-carrier-calls-v1", jobId: claim.jobId, attempt: claim.attempt,
          captureSha256: claim.captureSha256, embryoId: payload.embryoId, conditionId: payload.conditionId,
          calls: structuredClone(calls.get(payload.embryoId)) };break;
      }
      case "read_batch": {
        const payload = args.p_payload as { embryoId: string; conditionId: string; assertionIds: number[] };
        reads.push(payload.embryoId);
        value = { version: "embryo-carrier-call-batch-v1", jobId: claim.jobId, attempt: claim.attempt,
          captureSha256: claim.captureSha256, embryoId: payload.embryoId, conditionId: payload.conditionId,
          pages: payload.assertionIds.map(assertionId => {
            const a = evidence.find(row => row.assertion_id === assertionId)!;
            return { assertionId, calls: structuredClone(calls.get(payload.embryoId)!.filter(call => {
              const row = call as { chrom: number; pos: number };
              return row.chrom === a.chrom && [a.pos, ...a.equivalents.map(key => key[0])].includes(row.pos);
            })) };
          }) };break;
      }
      case "save": {
        saved.push(structuredClone(args.p_payload));
        value = { status: "saved_held", jobId: claim.jobId, attempt: claim.attempt,
          captureSha256: claim.captureSha256, saved: 2, publication: "held" };break;
      }
      case "fail": value = { status: "failed" };break;
    }
    return edit ? edit(args.p_operation, value) : value;
  };
  return { claim, calls, rpc, operations, reads, saved,
    cancel: (value: string) => { cancelAt = value; },
    change: (fn: typeof edit) => { edit = fn; } };
}
afterEach(() => { vi.unstubAllEnvs();vi.useRealTimers(); });

describe("the actual observed carrier worker boundary", () => {
  it("refuses the empty compiled registry before constructing or calling a source client", async () => {
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");
    const rpc = vi.fn<EmbryoCarrierRpc>();
    expect(await runNextEmbryoCarrier({ rpc })).toEqual({ status: "held", reason: "no_registered_conditions" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("refuses outside TEST-LOCAL before claiming, even with a synthetic admitted registry", async () => {
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "0");
    const rpc = vi.fn<EmbryoCarrierRpc>();
    await expect(runNextEmbryoCarrier({ rpc, registry })).rejects.toMatchObject({ code: "worker_disabled" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("runs both parser-produced ordinals through guarded reads and saves their distinct observed copies atomically", async () => {
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");const f = await fixture();
    expect(await runNextEmbryoCarrier({ rpc: f.rpc, registry })).toEqual({ status: "saved_held" });
    expect(f.operations).toEqual(["claim", "check", "read", "check", "check", "read", "check", "check", "save"]);
    expect(f.reads).toEqual(f.claim.capture.embryos.map(row => row.embryoId));
    expect(f.saved).toHaveLength(1);
    const saved = f.saved[0] as { measurements: Array<{ observation: { observed_copies: number; source: { file_id: string }; figure_basis: object } }> };
    expect(saved.measurements.map(row => row.observation.observed_copies)).toEqual([0, 2]);
    expect(saved.measurements.map(row => row.observation.source.file_id)).toEqual(f.claim.capture.embryos.map(row => row.source.file_id));
    expect(saved.measurements.every(row => JSON.stringify(row.observation.figure_basis) === '{"version":1,"basis":"observed"}')).toBe(true);
    expect(JSON.stringify(saved)).not.toMatch(/absolute_risk|probability|rank|best|baseline/);
  });
  it.each([
    ["haploid", "C", "1", "C"],
    ["multiallelic", "C,G", "1/2", "C/G"],
    ["literal N", "N", "0/1", "N/T"],
  ])("persists the unchanged core's truthful refusal for a real parser-produced %s call", async (_shape, alt, gt, letters) => {
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");
    const original = readFileSync("e2e/fixtures/embryo-pair-grch38.vcf", "utf8");
    const modified = original.replace("chr1\t22133085\trs116422505\tT\tC\t50\tPASS\t.\tGT\t0/0\t1/1",
      `chr1\t22133085\trs116422505\tT\t${alt}\t50\tPASS\t.\tGT\t${gt}\t${gt}`);
    expect(modified).not.toBe(original);
    const f = await fixture(modified);
    for (const embryo of f.claim.capture.embryos) {
      expect(embryo.qc.qc_verdict).toBe("pass");
      expect(f.calls.get(embryo.embryoId)).toEqual([expect.objectContaining({ alt, genotype: letters })]);
      expect(observeEmbryoCarrierAllele({ condition_id: entry.condition_id,
        condition_registry: f.claim.capture.conditions[0].condition_registry, assertions: [assertion],
        source: embryo.source, calls: f.calls.get(embryo.embryoId) }, registry))
        .toEqual({ ok: false, reason: "invalid_calls" });
    }
    expect(await runNextEmbryoCarrier({ rpc: f.rpc, registry })).toEqual({ status: "saved_held" });
    expect(f.saved).toHaveLength(1);
    const saved = f.saved[0] as { measurements: object[] };
    expect(saved.measurements).toEqual(f.claim.capture.embryos.map(embryo => ({
      embryoId: embryo.embryoId, conditionId: entry.condition_id, observation: null, reason: "invalid_calls",
    })));
  });
  it("measures a complete 781-assertion condition in bounded pages using each actual parser output", async () => {
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");
    const source = readFileSync("e2e/fixtures/embryo-pair-grch38.vcf", "utf8");
    const evidence: CarrierAssertionRow[] = source.split("\n").filter(line => line && !line.startsWith("#"))
      .slice(0, 781).map((line, index) => {
        const fields = line.split("\t");
        return { ...assertion, assertion_id: index + 1, variation_id: index + 1,
          chrom: Number(fields[0].slice(3)), pos: Number(fields[1]), ref: fields[3], alt: fields[4],
          variant_name: `Synthetic ${fields[3]}>${fields[4]} at ${fields[0]}:${fields[1]}` };
      });
    expect(evidence).toHaveLength(781);
    const f = await fixture(source, evidence);
    expect(await runNextEmbryoCarrier({ rpc: f.rpc, registry })).toEqual({ status: "saved_held" });
    expect(f.operations.filter(op => op === "read_batch")).toHaveLength(2 * Math.ceil(781 / 32));
    expect(f.operations).not.toContain("read");expect(f.saved).toHaveLength(1);
    const saved = f.saved[0] as { measurements: Array<{ observation: { version: number; covered_assertions: number;
      required_assertions: number; interpretation_status: string }; assertion_measurements: object[] }> };
    for (const [index, embryo] of f.claim.capture.embryos.entries()) {
      const expected = evidence.map(row => {
        const ownCalls = f.calls.get(embryo.embryoId)!.filter(call => {
          const called = call as { chrom: number; pos: number };return called.chrom === row.chrom && called.pos === row.pos;
        });
        const measured = observeEmbryoCarrierAllele({ condition_id: entry.condition_id,
          condition_registry: f.claim.capture.conditions[0].condition_registry, assertions: [row], source: embryo.source,
          calls: ownCalls }, registry);
        return { assertion_id: row.assertion_id, observed_copies: measured.ok ? measured.observation.observed_copies : null,
          reason: measured.ok ? null : measured.reason };
      });
      const covered = expected.filter(row => row.observed_copies !== null).length;
      expect(covered).toBeGreaterThan(740);expect(covered).toBeLessThanOrEqual(781);
      expect(saved.measurements[index].assertion_measurements).toEqual(expected);
      expect(saved.measurements[index].observation).toMatchObject({ version: 2, covered_assertions: covered,
        required_assertions: 781, interpretation_status: "held" });
    }
    expect(saved.measurements[0].observation.covered_assertions).toBe(781);
    expect(saved.measurements[1].observation.covered_assertions).toBe(774);
    expect(JSON.stringify(saved)).not.toMatch(/carrier_state|absolute_risk|probability|phase|rank/);
  });
  it.each(["reordered", "foreign source", "extra assertion"])("refuses a %s batch before any complete-set save", async fault => {
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");
    const other = { ...assertion, assertion_id: 2, variation_id: 2, pos: 22153726, ref: "C", alt: "G" };
    const f = await fixture(undefined, [assertion, other]);
    f.change((op, value) => {
      if (op !== "read_batch") return value;
      const result = structuredClone(value) as { pages: Array<{ assertionId: number; calls: Array<{ fileId: string }> }> };
      if (fault === "reordered") result.pages.reverse();
      if (fault === "foreign source") result.pages[0].calls[0].fileId = id(31);
      if (fault === "extra assertion") result.pages.push({ assertionId: 3, calls: [] });
      return result;
    });
    await expect(runNextEmbryoCarrier({ rpc: f.rpc, registry })).rejects.toMatchObject({ code: "invalid_response" });
    expect(f.saved).toHaveLength(0);
  });
  it("retains two reviewed assertions at one locus as separate evidence and denominator entries", async () => {
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");
    const other = { ...assertion, assertion_id: 2, variation_id: 2, alt: "G" };
    const f = await fixture(undefined, [assertion, other]);
    expect(await runNextEmbryoCarrier({ rpc: f.rpc, registry })).toEqual({ status: "saved_held" });
    const saved = f.saved[0] as { measurements: Array<{ observation: { covered_assertions: number; required_assertions: number };
      assertion_measurements: Array<{ assertion_id: number; observed_copies: number }> }> };
    expect(saved.measurements.map(row => row.observation.required_assertions)).toEqual([2, 2]);
    expect(saved.measurements.map(row => row.observation.covered_assertions)).toEqual([2, 2]);
    expect(saved.measurements.map(row => row.assertion_measurements)).toEqual([
      [{ assertion_id: 1, observed_copies: 0, reason: null }, { assertion_id: 2, observed_copies: 0, reason: null }],
      [{ assertion_id: 1, observed_copies: 2, reason: null }, { assertion_id: 2, observed_copies: 0, reason: null }],
    ]);
  });
  it.each(["claim:1", "check:1", "read:1", "check:2", "check:3", "read:2", "check:4", "check:5"])(
    "discards the complete attempt without a save when current authority cancels at %s", async point => {
      vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");const f = await fixture();f.cancel(point);
      expect(await runNextEmbryoCarrier({ rpc: f.rpc, registry })).toEqual({ status: "cancelled" });
      expect(f.saved).toHaveLength(0);expect(f.operations).not.toContain("save");
    });
  it.each(["claim", "check", "read", "save"])("refuses an extra key in the %s response", async operation => {
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");const f = await fixture();
    f.change((op, value) => op === operation ? { ...(value as object), forbidden: true } : value);
    await expect(runNextEmbryoCarrier({ rpc: f.rpc, registry })).rejects.toMatchObject({ code: "invalid_response" });
    if (operation !== "save") expect(f.saved).toHaveLength(0);
  });
  it.each(["jobId", "attempt", "captureSha256"])("refuses a changed %s in a bounded read before any save", async key => {
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");const f = await fixture();
    f.change((op, value) => op === "read" ? { ...(value as object), [key]: key === "attempt" ? 2 : key === "jobId" ? id(99) : "f".repeat(64) } : value);
    await expect(runNextEmbryoCarrier({ rpc: f.rpc, registry })).rejects.toMatchObject({ code: "invalid_response" });
    expect(f.saved).toHaveLength(0);
  });
  it("refuses a changed full capture even when its claimed digest is repeated", async () => {
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");const f = await fixture();
    f.change((op, value) => op === "check" ? { ...(value as object), capture: { ...f.claim.capture,
      authority: { basisFingerprint: "f".repeat(64), grants: [id(9)] } } } : value);
    await expect(runNextEmbryoCarrier({ rpc: f.rpc, registry })).rejects.toMatchObject({ code: "invalid_response" });
    expect(f.reads).toHaveLength(0);expect(f.saved).toHaveLength(0);
  });
  it("does not borrow another embryo's actual parser calls", async () => {
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");const f = await fixture();
    f.change((op, value) => op === "read" ? { ...(value as object), calls: f.calls.get(id(11)) } : value);
    await expect(runNextEmbryoCarrier({ rpc: f.rpc, registry })).rejects.toMatchObject({ code: "invalid_response" });
    expect(f.saved).toHaveLength(0);
  });
  it("saves the named true QC failure without reading a locus for that embryo", async () => {
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");const f = await fixture();
    f.claim.capture.embryos[0].qc.call_rate = 0.9;
    expect(await runNextEmbryoCarrier({ rpc: f.rpc, registry })).toEqual({ status: "saved_held" });
    expect(f.reads).toEqual([id(11)]);
    const saved = f.saved[0] as { measurements: object[] };
    expect(saved.measurements[0]).toMatchObject({ embryoId: id(10), observation: null, reason: "embryo_call_rate" });
  });
  it("refuses an expired finite claim before the first locus read", async () => {
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");const f = await fixture();f.claim.claimExpiresAt = new Date(Date.now() - 1).toISOString();
    await expect(runNextEmbryoCarrier({ rpc: f.rpc, registry })).rejects.toMatchObject({ code: "invalid_response" });
    expect(f.reads).toHaveLength(0);expect(f.saved).toHaveLength(0);
  });
  it("rejects a late response after caller cancellation and performs no save", async () => {
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");const f = await fixture();const controller = new AbortController();
    let release: () => void = () => { throw new Error("not reached"); };
    const reached = Promise.withResolvers<void>();
    const rpc: EmbryoCarrierRpc = async (name, args, signal) => {
      const value = await f.rpc(name, args, signal);
      if (args.p_operation === "read") await new Promise<void>(resolve => { release = resolve;reached.resolve(); });
      return value;
    };
    const running = runNextEmbryoCarrier({ rpc, registry, signal: controller.signal });
    await reached.promise;controller.abort();release();
    await expect(running).rejects.toMatchObject({ code: "aborted" });
    expect(f.saved).toHaveLength(0);
  });
});
