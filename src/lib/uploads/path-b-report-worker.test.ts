import { describe, expect, it, vi } from "vitest";
import { runPathBReportWorker, type PathBReportRpc } from "./path-b-report-worker";

function fixture(purpose: "reports.monogenic" | "reports.polygenic" = "reports.monogenic") {
  const claim = { jobId: "11111111-1111-4111-8111-111111111111", claim: "22222222-2222-4222-8222-222222222222",
    claimExpiresAt: new Date(Date.now() + 290_000).toISOString(), fileId: "33333333-3333-4333-8333-333333333333",
    subjectId: "44444444-4444-4444-8444-444444444444", purpose, bindingRevision: 7, sourceRevision: 2,
    sourceSha256: "a".repeat(64), normalizedAt: "2026-09-30T12:00:00+00:00",
    computationRevision: `path-b-reports-v1:${"b".repeat(64)}`, authoritySha256: "c".repeat(64) };
  const variant = { file_id: claim.fileId, rsid: 123, chrom: 1, pos: 100000, ref: "A", alt: "G", genotype: "A/G" };
  const templates = ["variant_call", "estimate"].map(layer => ({ slug: `synthetic-${layer}`, category: "synthetic",
    title: "Synthetic fixture", summary: "Synthetic worker test.", evidence: "emerging", layer,
    estimate_kind: layer === "estimate" ? "single_locus" : null, pgs_id: null, citations: [],
    variants: [{ rsid: 123, gene: "SYNTHETIC", chrom: 1, pos38: 100000, ref: "A", alt: "G",
      interpretations: { AG: "Synthetic covered genotype" } }] }));
  const rpc = vi.fn<PathBReportRpc>(async args => {
    expect(args.p_test_jurisdiction).toBe(true); expect(args.p_claim_hash).toMatch(/^[0-9a-f]{64}$/);
    if (args.p_operation === "claim") {
      expect(args.p_job_id).toBeNull(); expect(args.p_claim).toBeNull();
      return { data: structuredClone(claim), error: null };
    }
    expect(args.p_job_id).toBe(claim.jobId); expect(args.p_claim).toBe(claim.claim);
    if (args.p_operation === "check") return { data: structuredClone(claim), error: null };
    if (args.p_operation === "read-variants" || args.p_operation === "read-observed") {
      const payload = args.p_payload as { loci: { chrom: number; pos: number }[]; offset: number };
      return { data: args.p_operation === "read-variants" && payload.offset === 0
        && payload.loci.some(locus => locus.chrom === 1 && locus.pos === 100000) ? [variant] : [], error: null };
    }
    if (args.p_operation === "complete") return { data: { status: "complete", purpose }, error: null };
    return { data: true, error: null };
  });
  const loadTemplates = vi.fn(async () => structuredClone(templates));
  return { claim, variant, templates, rpc, loadTemplates,
    options: { testJurisdiction: true, signal: new AbortController().signal, rpc, loadTemplates } };
}

describe("distinct queued Path B report worker", () => {
  it.each(["reports.monogenic", "reports.polygenic"] as const)("materializes only the claimed %s layer using actual report arithmetic", async purpose => {
    const f = fixture(purpose);
    expect(await runPathBReportWorker(f.options)).toEqual({ status: "complete", purpose });
    const stage = f.rpc.mock.calls.find(([args]) => args.p_operation === "stage")![0];
    expect(stage.p_payload).toMatchObject({ reports: [{ covered: true, variants: [{ rsid: 123, outcome: {
      status: "genotyped", genotype: "AG", interpretation: "Synthetic covered genotype", strandFlipped: false } }] }] });
    const payload = stage.p_payload as { reports: { slug: string }[]; prs: Record<string, unknown>[] };
    expect(payload.reports.map(report => report.slug)).toEqual([purpose === "reports.monogenic" ? "synthetic-variant_call" : "synthetic-estimate"]);
    if (purpose === "reports.monogenic") expect(payload.prs).toEqual([]);
    for (const prs of payload.prs) expect(Object.keys(prs).sort()).toEqual(["coverage", "matched", "pgs_id", "raw_score"]);
    expect(f.rpc.mock.calls.slice(-3).map(([args]) => args.p_operation)).toEqual(["stage", "check", "complete"]);
    expect(new Set(f.rpc.mock.calls.map(([args]) => args.p_claim_hash)).size).toBe(1);
  });
  it("performs no reference or genetic I/O when TEST-LOCAL is closed", async () => {
    const f = fixture(); f.options.testJurisdiction = false;
    await expect(runPathBReportWorker(f.options)).rejects.toThrow("path_b_report_unavailable");
    expect(f.rpc).not.toHaveBeenCalled(); expect(f.loadTemplates).not.toHaveBeenCalled();
  });
  it("claims at most one job and does not read an idle queue", async () => {
    const f = fixture(); f.rpc.mockResolvedValue({ data: null, error: null });
    expect(await runPathBReportWorker(f.options)).toEqual({ status: "idle" });
    expect(f.rpc).toHaveBeenCalledTimes(1); expect(f.loadTemplates).not.toHaveBeenCalled();
  });
  it("does not borrow an own report, ancestry or family claim", async () => {
    const f = fixture(); f.rpc.mockResolvedValue({ data: { ...f.claim, purpose: "ancestry" }, error: null });
    await expect(runPathBReportWorker(f.options)).rejects.toThrow("path_b_report_unavailable");
    expect(f.rpc).toHaveBeenCalledTimes(1); expect(f.loadTemplates).not.toHaveBeenCalled();
  });
  it("refuses a changed grant/source binding before reading genetic data", async () => {
    const f = fixture(), original = f.rpc.getMockImplementation()!;
    f.rpc.mockImplementation((args, signal) => args.p_operation === "check"
      ? Promise.resolve({ data: { ...f.claim, bindingRevision: 8 }, error: null }) : original(args, signal));
    await expect(runPathBReportWorker(f.options)).rejects.toThrow("path_b_report_unavailable");
    expect(f.loadTemplates).not.toHaveBeenCalled();
    expect(f.rpc.mock.calls.map(([args]) => args.p_operation)).toEqual(["claim", "check", "fail"]);
  });
  it.each(["foreign-file", "unrequested-locus", "missing-observation-state"])("refuses %s source evidence without staging", async kind => {
    const f = fixture(), original = f.rpc.getMockImplementation()!;
    f.rpc.mockImplementation((args, signal) => {
      if (args.p_operation === (kind === "missing-observation-state" ? "read-observed" : "read-variants")) {
        return Promise.resolve({ data: [{ ...f.variant,
          ...(kind === "foreign-file" ? { file_id: "99999999-9999-4999-8999-999999999999" } : {}),
          ...(kind === "unrequested-locus" ? { pos: 100001 } : {}) }], error: null });
      }
      return original(args, signal);
    });
    await expect(runPathBReportWorker(f.options)).rejects.toThrow("path_b_report_unavailable");
    expect(f.rpc.mock.calls.some(([args]) => args.p_operation === "stage")).toBe(false);
    expect(f.rpc.mock.calls.at(-1)![0].p_operation).toBe("fail");
  });
  it("does not replay an uncertain stage or publish a partial report", async () => {
    const f = fixture(), original = f.rpc.getMockImplementation()!;
    f.rpc.mockImplementation((args, signal) => {
      if (args.p_operation === "stage") throw new Error("opaque provider diagnostics");
      return original(args, signal);
    });
    await expect(runPathBReportWorker(f.options)).rejects.toThrow("path_b_report_unavailable");
    expect(f.rpc.mock.calls.filter(([args]) => args.p_operation === "stage")).toHaveLength(1);
    expect(f.rpc.mock.calls.filter(([args]) => args.p_operation === "fail")).toHaveLength(1);
    expect(f.rpc.mock.calls.some(([args]) => args.p_operation === "complete")).toBe(false);
  });
  it("discards staged output if its exact claim changes before publication", async () => {
    const f = fixture(), original = f.rpc.getMockImplementation()!; let staged = false;
    f.rpc.mockImplementation((args, signal) => {
      if (args.p_operation === "stage") staged = true;
      if (args.p_operation === "check" && staged) return Promise.resolve({ data: { ...f.claim, authoritySha256: "d".repeat(64) }, error: null });
      return original(args, signal);
    });
    await expect(runPathBReportWorker(f.options)).rejects.toThrow("path_b_report_unavailable");
    expect(f.rpc.mock.calls.some(([args]) => args.p_operation === "complete")).toBe(false);
    expect(f.rpc.mock.calls.at(-1)![0].p_operation).toBe("fail");
  });
  it.each([-1, 301_000])("refuses an expired or overlong %i ms claim before any reads", async remaining => {
    const f = fixture(); f.claim.claimExpiresAt = new Date(Date.now() + remaining).toISOString();
    await expect(runPathBReportWorker(f.options)).rejects.toThrow("path_b_report_unavailable");
    expect(f.loadTemplates).not.toHaveBeenCalled(); expect(f.rpc.mock.calls.at(-1)![0].p_operation).toBe("fail");
  });
});
