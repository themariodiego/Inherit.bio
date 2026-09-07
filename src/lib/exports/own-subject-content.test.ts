import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { ownSubjectExportContent, renderOwnSubjectReport, type OwnExportRpc, type OwnExportSnapshot } from "./own-subject-content";
import gastrointestinal from "../../../data/templates/gastrointestinal.json";
import { computeOwnAncestryContent, CURRENT_OWN_ANCESTRY_PANEL } from "../uploads/own-ancestry-content";
const id = (n: number) => `12345678-1234-4234-8234-${String(n).padStart(12, "0")}`;
const actor = { accountId: id(1), sessionId: id(2) };
const digest = (text: Uint8Array | string) => createHash("sha256").update(text).digest("hex");
function snapshot(bytes: Uint8Array = Buffer.from("synthetic source"), decoded = bytes): OwnExportSnapshot {
  return { file: { id: id(3), subject_id: id(4), original_name: "Genome file", file_type: "vcf", tier: 1,
    size_bytes: bytes.length, sha256: digest(bytes), source_sha256: digest(decoded), status: "stored", build: "GRCh38",
    created_at: "2026-09-06T00:00:00Z", variant_count: 1, bucket_path: id(5), storage_object_id: id(6), upload_revision: 1 },
    binding: { ...actor, accountRevision: 1, authSessionRevision: 1, sessionRevision: 1, subjectBindingRevision: 1,
      lifecycleRevision: 1, accountBindingId: id(7), accountBindingRevision: 1, subjectPrincipalId: id(8),
      subjectPrincipalRevision: 1, accountPrincipalId: id(8), accountPrincipalRevision: 1, normalizedAt: "2026-09-06T00:00:00Z" }, normalized: true };
}
const source = snapshot();
const saved = { purpose: "reports.polygenic", completed_at: "2026-09-06T00:00:00Z", report: { slug: "test", covered: true,
  conflictingRsids: [3], variants: [{ rsid: 1, outcome: { status: "genotyped", genotype: "AA", interpretation: "Actual stored outcome", strandFlipped: false } },
    { rsid: 2, outcome: { status: "no-call" } }, { rsid: 3, outcome: { status: "not-covered" } }] } };
function db(handler: (args: Parameters<OwnExportRpc>[1]) => unknown) {
  return vi.fn<OwnExportRpc>(async (_, args) => ({ data: handler(args), error: null }));
}
function ancestryResult() {
  return { purpose: "ancestry", completed_at: "2026-09-06T00:01:00Z", grant_id: id(20), grant_revision: 1,
    result: computeOwnAncestryContent({ source: { fileId: source.file.id, subjectId: source.file.subject_id,
      sourceRevision: source.file.upload_revision, sourceSha256: source.file.sha256, normalizedAt: source.binding.normalizedAt!,
      normalizedBuild: "GRCh38", callEncoding: "vcf-literal" }, calls: [], panel: CURRENT_OWN_ANCESTRY_PANEL }) };
}
describe("own-subject export content", () => {
  it("exports exact stored ancestry with source binding and preserves the unavailable coverage state", async () => {
    const row = ancestryResult();
    const rpc = db(a => a.p_operation === "check" ? source : [row]);
    expect(await ownSubjectExportContent(rpc, actor).ancestry(source)).toEqual([
      { file_id: source.file.id, subject_id: source.file.subject_id, purpose: "ancestry", completed_at: row.completed_at, result: row.result },
    ]);
    expect(rpc.mock.calls.map(([, a]) => a.p_operation)).toEqual(["ancestry", "check", "ancestry"]);
    expect(row.result.admixture.result_state).toBe("not_covered");
  });
  it.each(["fileId", "subjectId", "sourceRevision", "sourceSha256", "normalizedAt", "callEncoding"])(
    "refuses an ancestry result with a mismatched source %s", async field => {
      const row = ancestryResult();
      const changed = { ...row, result: { ...row.result, source: { ...row.result.source,
        [field]: field === "sourceRevision" ? 2 : field === "sourceSha256" ? "b".repeat(64)
          : field === "normalizedAt" ? "2026-09-07T00:00:00Z" : field === "callEncoding" ? "array-genotype" : id(99) } } };
      await expect(ownSubjectExportContent(db(() => [changed]), actor).ancestry(source)).rejects.toThrow("export unavailable");
    },
  );
  it.each(["withdrawal", "regrant", "replacement"])("does not release buffered ancestry after %s", async transition => {
    const row = ancestryResult(); let reads = 0;
    const rpc = db(a => a.p_operation === "check" ? source : ++reads === 1 ? [row]
      : transition === "withdrawal" ? [] : [{ ...row, ...(transition === "regrant" ? { grant_id: id(99), grant_revision: 2 }
        : { completed_at: "2026-09-07T00:00:00Z" }) }]);
    await expect(ownSubjectExportContent(rpc, actor).ancestry(source)).rejects.toThrow("export unavailable");
  });
  it("returns no ancestry before completion or after withdrawal without falling back to another reader", async () => {
    const rpc = db(a => a.p_operation === "check" ? source : []);
    expect(await ownSubjectExportContent(rpc, actor).ancestry(source)).toEqual([]);
    expect(rpc.mock.calls.every(([, a]) => ["ancestry", "check"].includes(a.p_operation))).toBe(true);
  });
  it("rejects unexpected ancestry fields, extra rows and inconsistent coverage", async () => {
    const row = ancestryResult();
    for (const response of [[{ ...row, private_field: "no" }], [row, row],
      [{ ...row, result: { ...row.result, admixture: { ...row.result.admixture, coverage: 1 } } }]]) {
      await expect(ownSubjectExportContent(db(() => response), actor).ancestry(source)).rejects.toThrow("export unavailable");
    }
  });
  it("exhausts short pages and more than 1000 rows using actual returned offsets", async () => {
    const all = Array.from({ length: 1207 }, (_, index) => ({ rsid: index + 1, chrom: 1, pos: index + 1, ref: "A", alt: "G", genotype: "A/G" }));
    const rpc = db(a => all.slice(a.p_offset, a.p_offset + 500));
    const result = [];
    for await (const page of ownSubjectExportContent(rpc, actor).variants(source)) result.push(...page);
    expect(result).toEqual(all);
    expect(rpc.mock.calls.map(([, a]) => a.p_offset)).toEqual([0, 500, 1000, 1207]);
    expect(rpc.mock.calls.every(([, a]) => a.p_snapshot === source && a.p_file_id === source.file.id)).toBe(true);
  });
  it("refuses the next page after authority is invalidated", async () => {
    const rpc = vi.fn<OwnExportRpc>(async (_, args) => args.p_offset === 0
      ? { data: [{ rsid: 1, chrom: 1, pos: 1, ref: "A", alt: "G", genotype: "A/G" }], error: null }
      : { data: null, error: { code: "42501" } });
    const rows = ownSubjectExportContent(rpc, actor).variants(source);
    expect((await rows.next()).value).toHaveLength(1);
    await expect(rows.next()).rejects.toThrow("export unavailable");
    expect(rpc.mock.calls[1][1].p_snapshot).toEqual(source);
  });
  it("rejects a different actor or session before touching the RPC", async () => {
    const rpc = db(() => source);
    const reader = ownSubjectExportContent(rpc, actor);
    await expect(reader.check({ ...source, binding: { ...source.binding, sessionId: id(99) } })).rejects.toThrow("export unavailable");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("rejects stale database decisions and suppresses provider error details", async () => {
    const rpc = vi.fn<OwnExportRpc>(async () => ({ data: null, error: { message: "sensitive source" } }));
    await expect(ownSubjectExportContent(rpc, actor).check(source)).rejects.toThrow(/^export unavailable$/);
    await expect(ownSubjectExportContent(db(() => ({ ...source, normalized: false })), actor).check(source)).rejects.toThrow();
  });
  it("lists every owned source without accepting an uploader-owned foreign snapshot", async () => {
    const second = { ...source, file: { ...source.file, id: id(33) } };
    const reader = ownSubjectExportContent(db(a => a.p_offset === 0 ? [source] : a.p_offset === 1 ? [second] : []), actor);
    expect((await reader.list()).map(s => s.file.id)).toEqual([source.file.id, second.file.id]);
    await expect(ownSubjectExportContent(db(() => [{ ...source, binding: { ...source.binding, accountId: id(99) } }]), actor).list()).rejects.toThrow();
  });
  it("uses saved outcomes, including reference and no-call, without recalculation or fixture templates", async () => {
    const fixture = { ...saved, report: { ...saved.report, slug: "auto-e2e-hidden" } };
    const reader = ownSubjectExportContent(db(a => a.p_operation === "check" ? source : a.p_offset ? [] : [saved, fixture]), actor);
    const result = await reader.reports(source);
    expect(result.report_count).toBe(1);
    expect(result.reports[0].variants.map(v => [v.status, v.genotype, v.interpretation])).toEqual([
      ["genotyped", "AA", "Actual stored outcome"], ["no-call", null, null], ["not-covered", null, null],
    ]);
    expect(result.reports[0]).not.toHaveProperty("evidence");
    expect(result.reports[0]).not.toHaveProperty("citations");
    expect(result.reports[0]).not.toHaveProperty("summary");
    const printed = renderOwnSubjectReport(result.reports[0]);
    expect(printed).toContain("Actual stored outcome");
    expect(printed).toContain("did not capture the catalog revision");
    expect(printed).toContain("rs2: no-call");
    expect(result.reports[0].conflictingRsids).toEqual([3]);
    expect(printed).toContain("rs3: conflicting source calls; no reliable genotype");
  });
  it("exports completed all-conflict and uncovered evaluations without turning them into findings", async () => {
    const conflict = { ...saved, report: { slug: "all-conflict", covered: false, conflictingRsids: [3],
      variants: [{ rsid: 3, outcome: { status: "not-covered" } }] } };
    const uncovered = { ...saved, report: { slug: "uncovered", covered: false, conflictingRsids: [],
      variants: [{ rsid: 4, outcome: { status: "not-covered" } }, { rsid: 5, outcome: { status: "no-call" } }] } };
    const reader = ownSubjectExportContent(db(a => a.p_operation === "check" ? source : a.p_offset ? [] : [conflict, uncovered]), actor);
    const result = await reader.reports(source);
    expect(result.report_count).toBe(2);
    expect(result.reports.map(r => [r.slug, r.covered, r.conflictingRsids])).toEqual([
      ["all-conflict", false, [3]], ["uncovered", false, []],
    ]);
    expect(renderOwnSubjectReport(result.reports[0])).toContain("rs3: conflicting source calls; no reliable genotype");
    const printed = renderOwnSubjectReport(result.reports[1]);
    expect(printed).toContain("Covered at generation: no");
    expect(printed).toContain("rs4: not-covered");
    expect(printed).toContain("rs5: no-call");
    expect(result.reports.every(r => r.variants.every(v => v.genotype === null && v.interpretation === null))).toBe(true);
    expect(result.reports.every(r => !("summary" in r) && !("evidence" in r) && !("citations" in r))).toBe(true);
  });
  it("exports only the captured description and citations and rejects mismatched report authority", async () => {
    const catalogSnapshot = { schemaVersion: 1, templateSha256: "a".repeat(64),
      template: { ...gastrointestinal[0], layer: "estimate", estimate_kind: "single_locus" } };
    const row = { ...saved, report: { ...saved.report, slug: catalogSnapshot.template.slug, catalogSnapshot } };
    const reader = ownSubjectExportContent(db(a => a.p_operation === "check" ? source : a.p_offset ? [] : [row]), actor);
    const result = (await reader.reports(source)).reports[0];
    expect(result.catalogSnapshot).toEqual(catalogSnapshot);
    const printed = renderOwnSubjectReport(result);
    expect(printed).toContain(catalogSnapshot.template.title);
    expect(printed).toContain(catalogSnapshot.template.summary);
    expect(printed).toContain("https://pubmed.ncbi.nlm.nih.gov/11788828/");
    expect(printed).toContain("read 2026-09-05");
    expect(printed).not.toContain("did not capture");
    for (const invalid of [
      { ...row, purpose: "reports.monogenic" },
      { ...row, report: { ...row.report, slug: "another-report" } },
      { ...row, report: { ...row.report, catalogSnapshot: { ...catalogSnapshot, schemaVersion: 2 } } },
    ]) {
      await expect(ownSubjectExportContent(db(a => a.p_offset ? [] : [invalid]), actor).reports(source)).rejects.toThrow("export unavailable");
    }
  });
  it("does not invent a result when no completed rows exist", async () => {
    const reader = ownSubjectExportContent(db(a => a.p_operation === "check" ? source : []), actor);
    expect(await reader.reports(source)).toMatchObject({ report_count: 0, reports: [] });
    expect(await reader.prs(source)).toEqual([]);
  });
  it("serializes only PRS coverage and refuses unexpected numeric payload fields", async () => {
    const row = { pgs_id: "PGS000001", matched: 1, n_variants: 2, computed_at: "now", name: "Panel", trait: "Trait", ancestry_note: null };
    const rpc = db(a => a.p_operation === "check" ? source : a.p_offset ? [] : [row]);
    const result = await ownSubjectExportContent(rpc, actor).prs(source);
    expect(result[0]).toMatchObject({ file_id: source.file.id, coverage: { matched: 1, required: 2 }, status: "unavailable" });
    expect(JSON.stringify(result)).not.toMatch(/"(?:raw_score|zscore|percentile|risk)":/);
    const unsafe = db(a => a.p_offset ? [] : [{ ...row, raw_score: 7.12345 }]);
    await expect(ownSubjectExportContent(unsafe, actor).prs(source)).rejects.toThrow();
  });
  it.each([false, true])("verifies byte-identical originals and decoded hash (gzip=%s) before return", async compressed => {
    const decoded = Buffer.from("synthetic source"), raw = compressed ? gzipSync(decoded) : decoded;
    const snap = snapshot(raw, decoded), download = vi.fn(async () => ({ data: new Blob([raw]), error: null }));
    const rpc = db(() => snap);
    const blob = await ownSubjectExportContent(rpc, actor).original(snap, download);
    expect(Buffer.from(await blob.arrayBuffer())).toEqual(raw);
    expect(download).toHaveBeenCalledWith(snap.file.bucket_path);
    expect(rpc).toHaveBeenCalledTimes(2);
  });
  it("rejects substituted source bytes and decoded hashes without returning an original", async () => {
    const reader = ownSubjectExportContent(db(() => source), actor);
    await expect(reader.original(source, async () => ({ data: new Blob(["different source"]), error: null }))).rejects.toThrow();
    const snap = { ...source, file: { ...source.file, source_sha256: "a".repeat(64) } };
    await expect(ownSubjectExportContent(db(() => snap), actor).original(snap,
      async () => ({ data: new Blob(["synthetic source"]), error: null }))).rejects.toThrow();
  });
  it("checks both gzip hashes and stops after cancellation during a source download", async () => {
    const raw = gzipSync(Buffer.from("synthetic source"));
    const good = snapshot(raw, Buffer.from("synthetic source"));
    for (const field of ["sha256", "source_sha256"] as const) {
      const bad = { ...good, file: { ...good.file, [field]: "f".repeat(64) } };
      await expect(ownSubjectExportContent(db(() => bad), actor).original(bad,
        async () => ({ data: new Blob([raw]), error: null }))).rejects.toThrow("export unavailable");
    }
    let cancelled = false;
    const rpc = db(() => good);
    await expect(ownSubjectExportContent(rpc, actor, () => { if (cancelled) throw new Error("cancelled"); }).original(good,
      async () => { cancelled = true; return { data: new Blob([raw]), error: null }; })).rejects.toThrow("cancelled");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

});
