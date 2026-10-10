import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runNextEmbryoStatisticalCoverage, runNextEmbryoStatisticalFit,
  type StatisticalWorkerRpc, type StatisticalFitWorkerRpc } from "./statistical-worker";
import { TEST_STATISTICAL_SCORE_PANEL } from "./statistical-coverage";
import { canonicalStatisticalFitPackage, statisticalFitPackageDigest, statisticalFitSaveRowSchema,
  STATISTICAL_FIT_ARTIFACT_SHA256, STATISTICAL_FIT_PANEL_SHA256 } from "./statistical-fit-contract";
import { embryoVcfChunks, validateEmbryoVcfChunk } from "./vcf-transport";
import { analyseEmbryoFragment, embryoOrdinalOutcome } from "./split-analysis";

const id = (n: number) => `90000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
async function fixture(vcf?: string) {
  const binding = { challenge: "s".repeat(43), revision: 3, build: "GRCh38" as const,
    sampleCount: 2, handles: ["h".repeat(43), "k".repeat(43)] };
  const chunks = await Array.fromAsync(embryoVcfChunks(new Blob([vcf ?? readFileSync("e2e/fixtures/embryo-pair-grch38.vcf")]), binding));
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

function fittedVcf(n: number) {
  const header = readFileSync("e2e/fixtures/embryo-pair-grch38.vcf", "utf8").split("\n").filter(line => line.startsWith("#"));
  const rows = TEST_STATISTICAL_SCORE_PANEL.variants.slice(0, n).map(row =>
    `chr${row.chrom}\t${row.pos}\t.\t${row.otherAllele}\t${row.effectAllele}\t.\tPASS\t.\tGT\t0/1\t1/1`);
  // Real off-panel parser rows keep whole-file call QC independent of score
  // coverage. Missing panel loci remain missing, never parental imputation.
  for (let i = 0; i < 100; i++) rows.push(`chr22\t${50_000 + i}\t.\tA\tG\t.\tPASS\t.\tGT\t0/1\t1/1`);
  return [...header, ...rows, ""].join("\n");
}
async function fittedFixture(n = 10) {
  const f = await fixture(fittedVcf(n)), pkg = canonicalStatisticalFitPackage();
  const artifact: unknown = JSON.parse(readFileSync("data/embryo/test-statistical-fit-population.json", "utf8"));
  // These closed unit responses exercise parsing and lifecycle; they are not
  // native fixture admission, reference installation or production evidence.
  const reference = { singleton: true, version: 1, panel_sha256: STATISTICAL_FIT_PANEL_SHA256,
    panel: TEST_STATISTICAL_SCORE_PANEL, system_identifier: "123456789", database_name: "postgres", database_oid: 5,
    server_version: 170006, runtime_binding: { kind: "owned-linux", project: "sequence", head: "a".repeat(40),
      migrationSha256: "b".repeat(64), configSha256: "c".repeat(64), dbContainerId: "d".repeat(64), networkId: "e".repeat(64),
      owner: id(40), daemonId: "pure-unit-only", runtimeIdentity: { unitOnly: true } }, installed_at: "2026-10-10T00:00:00Z",
    fit_artifact: artifact, fit_artifact_sha256: STATISTICAL_FIT_ARTIFACT_SHA256,
    fit_package: pkg, fit_package_digest: statisticalFitPackageDigest(pkg) };
  let edit: ((operation: string, value: unknown) => unknown) | undefined;
  const rpc: StatisticalFitWorkerRpc = async (name, args, signal) => {
    expect(name).toBe("embryo_test_statistical_fit_worker_v1");
    let value = await f.rpc("embryo_test_statistical_worker_v1", args, signal);
    if (value !== null && typeof value === "object") {
      const response = value;
      if (args.p_operation === "claim") value = { ...response, version: "embryo-test-statistical-fit-claim-v1",
        capture: { ...f.claim.capture, version: "embryo-test-statistical-fit-capture-v1",
          conditions: [{ condition_id: "SYNTHETIC:9001", condition_name: "Synthetic score coverage", reference_receipt: reference }],
          fitArtifact: artifact, fitPackage: pkg, fitPackageDigest: statisticalFitPackageDigest(pkg) } };
      if (args.p_operation === "check") value = { ...response, version: "embryo-test-statistical-fit-check-v1" };
      if (args.p_operation === "read") value = { ...response, version: "embryo-test-statistical-fit-calls-v1" };
      if (args.p_operation === "save") value = { ...response, publication: "synthetic-fitted-test-only" };
    }
    return edit ? edit(args.p_operation, structuredClone(value)) : structuredClone(value);
  };
  return { ...f, rpc, changeFit: (value: typeof edit) => { edit = value; } };
}

describe("distinct fitted TEST worker lifecycle", () => {
  it("refuses non-TEST before any client and preserves absent admission as held/idle", async () => {
    const rpc = vi.fn<StatisticalFitWorkerRpc>();vi.stubEnv("INHERIT_TEST_JURISDICTION", "0");
    await expect(runNextEmbryoStatisticalFit({ rpc })).rejects.toMatchObject({ code: "worker_disabled" });
    expect(rpc).not.toHaveBeenCalled();vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");
    rpc.mockResolvedValue({ status: "held", reason: "synthetic_reference_unavailable" });
    expect(await runNextEmbryoStatisticalFit({ rpc })).toEqual({ status: "held", reason: "synthetic_reference_unavailable" });
    rpc.mockResolvedValue(null);expect(await runNextEmbryoStatisticalFit({ rpc })).toEqual({ status: "idle" });
    expect(rpc.mock.calls.every(([, args]) => args.p_operation === "claim")).toBe(true);
  });
  it.each([8, 9, 10])("saves %i/10 from both actual VCF ordinal call sets only via the fitted native door", async n => {
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");const f = await fittedFixture(n);
    expect(await runNextEmbryoStatisticalFit({ rpc: f.rpc })).toEqual({ status: "saved_fitted_test" });
    expect(f.operations).toEqual(["claim", "check", "read", "check", "check", "read", "check", "check", "save"]);
    expect(f.saved).toHaveLength(1);
    const rows = (f.saved[0] as { measurements: unknown[] }).measurements.map(value => statisticalFitSaveRowSchema.parse(value));
    expect(rows.map(row => row.measurement!.matchedVariants)).toEqual([n, n]);
    expect(rows.every(row => row.finding === null && row.reason === "sex_combined_model_unavailable")).toBe(true);
    expect(rows.every(row => row.result?.clinicalPublication === false && row.result.withinFamily.betaRatio === null)).toBe(true);
    expect(rows[0].result?.point).not.toEqual(rows[1].result?.point);
    expect(rows[0].result?.dropoutMultiplier).toBe("1.500000000");
    expect(JSON.stringify(f.saved)).not.toMatch(/absolute_risk|raw_score|percentile|"clinicalPublication":true/);
  });
  it("keeps seven real own panel rows below floor with observed failure and no model interval", async () => {
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");const f = await fittedFixture(7);
    expect(await runNextEmbryoStatisticalFit({ rpc: f.rpc })).toEqual({ status: "saved_fitted_test" });
    const rows = (f.saved[0] as { measurements: unknown[] }).measurements.map(value => statisticalFitSaveRowSchema.parse(value));
    expect(rows.every(row => row.result === null && row.reason === "insufficient_coverage"
      && row.measurement?.scoreCoverage === .7 && row.finding?.figure_basis.basis === "observed")).toBe(true);
  });
  it.each(["call_rate", "contamination_estimate", "allelic_dropout_estimate"])("preserves %s refusal with no own-call read or fitted number", async metric => {
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");const f = await fittedFixture();
    Object.assign(f.claim.capture.embryos[0].qc, { [metric]: metric === "call_rate" ? .94 : metric === "contamination_estimate" ? .06 : .11 });
    expect(await runNextEmbryoStatisticalFit({ rpc: f.rpc })).toEqual({ status: "saved_fitted_test" });
    expect((f.saved[0] as { measurements: unknown[] }).measurements[0]).toMatchObject({ measurement: null, finding: null, result: null });
    expect(f.operations.filter(op => op === "read")).toHaveLength(1);
  });
  it.each(["coverage-claim", "artifact", "package", "digest", "old-admission", "source", "ordinal", "lease"])(
    "refuses %s before any call/save instead of upgrading coverage-only authority", async fault => {
      vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");const f = await fittedFixture();
      f.changeFit((operation, value) => {
        if (operation !== "claim") return value;
        const claim = value as { version: string; claimExpiresAt: string; capture: {
          fitArtifact: Record<string, unknown>; fitPackage: { fit: { coefficients: string[] } }; fitPackageDigest: string;
          conditions: { reference_receipt: unknown }[]; embryos: { source: { cohort_id: string }; sampleOrdinal: number }[] } };
        if (fault === "coverage-claim") claim.version = "embryo-test-statistical-claim-v1";
        if (fault === "artifact") claim.capture.fitArtifact.provenance = "clinical";
        if (fault === "package") claim.capture.fitPackage.fit.coefficients[0] = "0.123456789";
        if (fault === "digest") claim.capture.fitPackageDigest = "f".repeat(64);
        if (fault === "old-admission") claim.capture.conditions[0].reference_receipt = {};
        if (fault === "source") claim.capture.embryos[0].source.cohort_id = id(99);
        if (fault === "ordinal") claim.capture.embryos[0].sampleOrdinal = 1;
        if (fault === "lease") claim.claimExpiresAt = "2020-01-01T00:00:00Z";return claim;
      });
      await expect(runNextEmbryoStatisticalFit({ rpc: f.rpc })).rejects.toMatchObject({ code: "invalid_response" });
      expect(f.operations).toEqual(["claim"]);expect(f.saved).toEqual([]);
    });
  it("checks current authority again after calls and never saves a cancelled fitted job", async () => {
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");const f = await fittedFixture();
    f.changeFit((op, value) => op === "check" && f.operations.includes("read") ? { status: "cancelled" } : value);
    expect(await runNextEmbryoStatisticalFit({ rpc: f.rpc })).toEqual({ status: "cancelled" });expect(f.saved).toEqual([]);
  });
  it.each(["foreign-call", "wrong-capture", "coverage-saved", "wrong-count"])("refuses %s without fitted acceptance", async fault => {
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");const f = await fittedFixture();
    f.changeFit((op, value) => {
      if (op === "read") {
        const read = value as { calls: { fileId: string }[]; captureSha256: string };
        if (fault === "foreign-call") read.calls[0].fileId = id(99);
        if (fault === "wrong-capture") read.captureSha256 = "f".repeat(64);
      }
      if (op === "save") {
        const saved = value as { publication: string; saved: number };
        if (fault === "coverage-saved") saved.publication = "coverage-only";
        if (fault === "wrong-count") saved.saved = 1;
      }return value;
    });
    await expect(runNextEmbryoStatisticalFit({ rpc: f.rpc })).rejects.toMatchObject({ code: "invalid_response" });
  });
  it("suppresses an uncertain fitted transport/failure-write exception and never reports success", async () => {
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");const f = await fittedFixture();
    f.changeFit((op, value) => { if (op === "read" || op === "fail") throw new Error("synthetic-private-fit-canary");return value; });
    await expect(runNextEmbryoStatisticalFit({ rpc: f.rpc })).rejects.toMatchObject({ code: "unavailable", message: "unavailable" });
    expect(f.operations.at(-1)).toBe("fail");expect(f.saved).toEqual([]);
  });
});
