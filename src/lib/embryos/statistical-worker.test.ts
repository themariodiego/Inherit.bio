import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runNextEmbryoStatisticalCoverage, type StatisticalWorkerRpc } from "./statistical-worker";
import { TEST_STATISTICAL_SCORE_PANEL } from "./statistical-coverage";
import { embryoVcfChunks, validateEmbryoVcfChunk } from "./vcf-transport";
import { analyseEmbryoFragment, embryoOrdinalOutcome } from "./split-analysis";

const id = (n: number) => `90000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
async function fixture() {
  const binding = { challenge: "s".repeat(43), revision: 3, build: "GRCh38" as const,
    sampleCount: 2, handles: ["h".repeat(43), "k".repeat(43)] };
  const chunks = await Array.fromAsync(embryoVcfChunks(new Blob([readFileSync("e2e/fixtures/embryo-pair-grch38.vcf")]), binding));
  const fragments = validateEmbryoVcfChunk(chunks[0], { ...binding, resolveHandle: h => binding.handles.indexOf(h) });
  const calls = new Map<string, unknown[]>(), embryos = [];
  for (const fragment of fragments) {
    const embryoId = id(10 + fragment.ordinal), fileId = id(30 + fragment.ordinal), own: unknown[] = [];
    const result = await analyseEmbryoFragment(new TextEncoder().encode(fragment.vcf), fragment.ordinal, "GRCh38", row => {
      if (TEST_STATISTICAL_SCORE_PANEL.variants.some(variant => row[0] === variant.chrom && row[1] === variant.pos))
        own.push({ fileId, chrom: row[0], pos: row[1], ref: row[2], alt: row[3], genotype: row[4] });
    });
    calls.set(embryoId, own);
    const outcome = embryoOrdinalOutcome(result);
    embryos.push({ embryoId, sampleOrdinal: fragment.ordinal,
      source: { cohort_id: id(1), embryo_id: embryoId, subject_id: id(20 + fragment.ordinal), file_id: fileId,
        canonical_build: "GRCh38", source_sha256: "a".repeat(64), source_binding_fingerprint: "a".repeat(64),
        source_publication_revision: 1, upload_revision: 1, normalization_source_revision: 1,
        call_immutability_proof: "exact-staged-calls-v1" },
      qc: { embryo_id: embryoId, ...outcome.qc, parent_a_concordance: null, parent_b_concordance: null,
        allelic_dropout_estimate: null, allelic_dropout_interval_low: null, allelic_dropout_interval_high: null,
        allelic_dropout_method: null, amplification_method: null, source_laboratory: null, source_assay: null,
        imputation_performed: false, imputation_panel: null, contamination_estimate: null, computed_at: "2026-10-10T00:00:00Z" },
    });
  }
  const claim = { version: "embryo-test-statistical-claim-v1", jobId: id(2), attempt: 1,
    claimExpiresAt: new Date(Date.now() + 300_000).toISOString(), deadline: new Date(Date.now() + 3_600_000).toISOString(),
    captureSha256: "d".repeat(64), capture: { version: "embryo-test-statistical-capture-v1", cohortId: id(1),
      publicationRevision: 1, panel: TEST_STATISTICAL_SCORE_PANEL, authority: { fixture: "unit only" },
      conditions: [{ condition_id: "SYNTHETIC:9001", condition_name: "Synthetic score coverage", reference_receipt: {} }], embryos } };
  const operations: string[] = [], saved: unknown[] = [];
  let edit: ((operation: string, value: unknown) => unknown) | undefined;
  const rpc: StatisticalWorkerRpc = async (_name, args) => {
    operations.push(args.p_operation);expect(args.p_test_jurisdiction).toBe(true);
    expect(args.p_claim_token_hash).toMatch(/^[0-9a-f]{64}$/);
    let value: unknown;
    if (args.p_operation === "claim") value = structuredClone(claim);
    if (args.p_operation === "check") value = { version: "embryo-test-statistical-check-v2", jobId: claim.jobId,
      attempt: claim.attempt, claimExpiresAt: claim.claimExpiresAt, deadline: claim.deadline, captureSha256: claim.captureSha256 };
    if (args.p_operation === "read") {
      const input = args.p_payload as { embryoId: string; conditionId: string };
      value = { version: "embryo-test-statistical-calls-v1", jobId: claim.jobId, attempt: 1,
        captureSha256: claim.captureSha256, ...input, calls: structuredClone(calls.get(input.embryoId)) };
    }
    if (args.p_operation === "save") { saved.push(structuredClone(args.p_payload));
      value = { status: "saved_held", jobId: claim.jobId, attempt: 1, captureSha256: claim.captureSha256,
        saved: embryos.length, publication: "coverage-only" }; }
    if (args.p_operation === "fail") value = { status: "failed" };
    return edit ? edit(args.p_operation, value) : value;
  };
  return { claim, calls, operations, saved, rpc, change: (value: typeof edit) => { edit = value; } };
}
afterEach(() => { vi.unstubAllEnvs();vi.useRealTimers(); });
describe("bounded TEST statistical worker", () => {
  it("refuses outside TEST before accessing a native client", async () => {
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "0");const rpc = vi.fn<StatisticalWorkerRpc>();
    await expect(runNextEmbryoStatisticalCoverage({ rpc })).rejects.toMatchObject({ code: "worker_disabled" });expect(rpc).not.toHaveBeenCalled();
  });
  it("retains default absent admission and idle without reading calls or saving", async () => {
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");const rpc = vi.fn<StatisticalWorkerRpc>().mockResolvedValue({ status: "held", reason: "synthetic_reference_unavailable" });
    expect(await runNextEmbryoStatisticalCoverage({ rpc })).toEqual({ status: "held", reason: "synthetic_reference_unavailable" });
    expect(rpc).toHaveBeenCalledTimes(1);rpc.mockResolvedValue(null);expect(await runNextEmbryoStatisticalCoverage({ rpc })).toEqual({ status: "idle" });
  });
  it("uses both actual parser-produced ordinal call sets and saves the complete native cohort once", async () => {
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");const f = await fixture();
    expect(await runNextEmbryoStatisticalCoverage({ rpc: f.rpc })).toEqual({ status: "saved_coverage" });
    expect(f.operations).toEqual(["claim", "check", "read", "check", "check", "read", "check", "check", "save"]);
    expect(f.saved).toHaveLength(1);
    const measurements = (f.saved[0] as { measurements: { finding: unknown; measurement: { matchedVariants: number }; reason: string }[] }).measurements;
    expect(measurements).toHaveLength(2);expect(measurements.map(value => value.measurement.matchedVariants)).toEqual([0, 0]);
    expect(measurements.every(value => value.reason === "insufficient_coverage")).toBe(true);
    expect(JSON.stringify(f.saved)).not.toMatch(/raw_score|percentile|absolute_risk|interval_low/);
  });
  it.each(["call_rate", "contamination_estimate", "allelic_dropout_estimate"])("keeps %s QC refusal separate from statistical coverage", async metric => {
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");const f = await fixture();
    Object.assign(f.claim.capture.embryos[0].qc, { [metric]: metric === "call_rate" ? 0.94 : metric === "contamination_estimate" ? 0.06 : 0.11 });
    expect(await runNextEmbryoStatisticalCoverage({ rpc: f.rpc })).toEqual({ status: "saved_coverage" });
    expect((f.saved[0] as { measurements: unknown[] }).measurements[0]).toMatchObject({ measurement: null, finding: null });
    expect(f.operations.filter(value => value === "read")).toHaveLength(1);
  });
  it.each(["panel", "ordinal", "source", "lease", "extra"])("refuses a malformed %s claim before calls/save", async fault => {
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");const f = await fixture();
    f.change((operation, value) => { if (operation !== "claim") return value;
      const claim = value as typeof f.claim & { risk?: unknown };
      if (fault === "panel") (claim.capture.panel as { variants: unknown[] }).variants.pop();
      if (fault === "ordinal") claim.capture.embryos[0].sampleOrdinal = 1;
      if (fault === "source") claim.capture.embryos[0].source.cohort_id = id(9);
      if (fault === "lease") claim.claimExpiresAt = "2020-01-01T00:00:00Z";
      if (fault === "extra") claim.risk = 0.5;return claim;
    });
    await expect(runNextEmbryoStatisticalCoverage({ rpc: f.rpc })).rejects.toMatchObject({ code: "invalid_response" });
    expect(f.operations).toEqual(["claim"]);expect(f.saved).toEqual([]);
  });
  it("does not save after the post-call current-source checkpoint cancels", async () => {
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");const f = await fixture();
    f.change((operation, value) => operation === "check" && f.operations.includes("read") ? { status: "cancelled" } : value);
    expect(await runNextEmbryoStatisticalCoverage({ rpc: f.rpc })).toEqual({ status: "cancelled" });expect(f.saved).toEqual([]);
  });
  it("suppresses a raw transport secret and keeps failure a failure", async () => {
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");const canary = "synthetic-private-transport-canary";
    await expect(runNextEmbryoStatisticalCoverage({ rpc: async () => { throw new Error(canary); } })).rejects.toThrow("unavailable");
  });
  it("suppresses an aborted transport error rather than throwing its raw cause", async () => {
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");const controller = new AbortController();
    await expect(runNextEmbryoStatisticalCoverage({ signal: controller.signal, rpc: async () => {
      controller.abort();throw new Error("synthetic-private-aborted-transport-canary");
    } })).rejects.toMatchObject({ code: "aborted", message: "aborted" });
  });
  it("does not turn an uncertain failure-write error into success or a raw diagnostic", async () => {
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");const f = await fixture();
    f.change((operation, value) => {
      if (operation === "read" || operation === "fail") throw new Error("synthetic-private-failure-write-canary");
      return value;
    });
    await expect(runNextEmbryoStatisticalCoverage({ rpc: f.rpc })).rejects.toMatchObject({ code: "unavailable", message: "unavailable" });
    expect(f.operations.at(-1)).toBe("fail");expect(f.saved).toEqual([]);
  });
});
