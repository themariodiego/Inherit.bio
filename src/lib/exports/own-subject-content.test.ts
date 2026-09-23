import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { ownSubjectExportContent, renderOwnSubjectReport, type OwnExportRpc, type OwnExportSnapshot } from "./own-subject-content";
import gastrointestinal from "../../../data/templates/gastrointestinal.json";
import neurodegenerative from "../../../data/templates/neurodegenerative.json";
import { reportCatalogTemplateSchema } from "../genome/report-catalog-snapshot";
import { REPORT_SCIENTIFIC_CORRECTION_NOTICE } from "../genome/report-scientific-corrections";
import { computeOwnAncestryContent, CURRENT_OWN_ANCESTRY_PANEL } from "../uploads/own-ancestry-content";
import { computeOwnAncestryContentV3, SEVEN_OWN_ANCESTRY_PANEL } from "../uploads/own-ancestry-content-v3";
import { REGIONAL_AIMS, REGIONAL_CAVEAT } from "../genome/regional-admixture";
const preparedExport = vi.hoisted(() => vi.fn());
vi.mock("../genome/prepared-source/export-source", () => ({ exportOwnPreparedRecords: preparedExport }));
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
const oldTrem2Interpretation = "Two copies of R47H. This result is extremely rare and has been reported only a few times. An array call this rare is likely to be a test error. Confirm it with clinical-quality sequencing before trying to interpret it.";
function correctionExport(historical: boolean, captureCatalog: boolean) {
  const template = reportCatalogTemplateSchema.parse({
    ...neurodegenerative.find(row => row.slug === "trem2-r47h-alzheimers"),
    layer: "estimate", estimate_kind: "single_locus",
  });
  if (historical) template.variants[0].interpretations.TT = oldTrem2Interpretation;
  return { ...saved, report: { slug: template.slug, covered: true, conflictingRsids: [],
    variants: [{ rsid: 75932628, outcome: { status: "genotyped", genotype: "TT",
      interpretation: template.variants[0].interpretations.TT, strandFlipped: false } }],
    ...(captureCatalog ? { catalogSnapshot: { schemaVersion: 1, templateSha256: "b".repeat(64), template } } : {}),
  } };
}
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
  it.each([false, true])("adds correction metadata without changing saved content (catalog=%s)", async captureCatalog => {
    const row = correctionExport(true, captureCatalog), before = structuredClone(row);
    const rpc = db(a => a.p_operation === "check" ? source : a.p_offset ? [] : [row]);
    const result = (await ownSubjectExportContent(rpc, actor).reports(source)).reports[0];
    expect(row).toEqual(before);
    expect(result.catalogSnapshot).toEqual(before.report.catalogSnapshot);
    expect(result).toMatchObject({ slug: before.report.slug, completed_at: before.completed_at,
      purpose: before.purpose, covered: true, conflictingRsids: [],
      scientific_correction: { status: "known-superseded", notice: REPORT_SCIENTIFIC_CORRECTION_NOTICE,
        corrections: [{ field: "interpretation", rsid: 75932628, genotype: "TT", correctedOn: "2026-09-23" }] },
      variants: [{ rsid: "rs75932628", status: "genotyped", genotype: "TT",
        interpretation: oldTrem2Interpretation, strand_flipped: false }] });
    expect(result.scientific_correction?.corrections).toHaveLength(1);
    const printed = renderOwnSubjectReport(result);
    expect(printed.startsWith(REPORT_SCIENTIFIC_CORRECTION_NOTICE)).toBe(true);
    expect(printed).toContain(oldTrem2Interpretation);
    expect(printed).toContain(`Completed: ${before.completed_at}`);
    expect(printed).toContain(captureCatalog ? `Catalog SHA-256: ${"b".repeat(64)}` : "did not capture the catalog revision");
  });
  it.each([false, true])("does not mark current captured wording as superseded (catalog=%s)", async captureCatalog => {
    const row = correctionExport(false, captureCatalog);
    const result = (await ownSubjectExportContent(db(a => a.p_operation === "check" ? source : a.p_offset ? [] : [row]), actor).reports(source)).reports[0];
    expect(result).not.toHaveProperty("scientific_correction");
    expect(renderOwnSubjectReport(result)).not.toContain(REPORT_SCIENTIFIC_CORRECTION_NOTICE);
  });
  it("does not label unknown no-catalog wording or an unrelated report as corrected", async () => {
    const unknown = correctionExport(true, false); unknown.report.variants[0].outcome.interpretation = "Unregistered historical wording.";
    const unrelated = correctionExport(true, false); unrelated.report.slug = "unrelated-report";
    const results = (await ownSubjectExportContent(db(a => a.p_operation === "check" ? source : a.p_offset ? [] : [unknown, unrelated]), actor).reports(source)).reports;
    expect(results.every(result => !("scientific_correction" in result))).toBe(true);
    expect(results[0].variants[0].interpretation).toBe("Unregistered historical wording.");
    expect(results[1].variants[0].interpretation).toBe(oldTrem2Interpretation);
  });
  it("exports the exact seven-region capture and caveat, then refuses a withdrawn capture", async () => {
    const previous = ancestryResult();
    const result = computeOwnAncestryContentV3({ source: previous.result.source,
      calls: REGIONAL_AIMS.map(marker => ({ file_id: source.file.id, chrom: marker.chrom, pos: marker.pos38,
        ref: marker.ref, alt: marker.alt, genotype: `${marker.ref}/${marker.ref}`, usable: true })),
      panel: SEVEN_OWN_ANCESTRY_PANEL });
    const row = { ...previous, result };
    const rpc = db(a => a.p_operation === "check" ? source : [row]);
    const exported = await ownSubjectExportContent(rpc, actor).ancestry(source);
    expect(exported).toEqual([{ file_id: source.file.id, subject_id: source.file.subject_id,
      purpose: "ancestry", completed_at: row.completed_at, result }]);
    expect(JSON.stringify(exported)).toContain(REGIONAL_CAVEAT);
    expect(JSON.stringify(exported)).not.toContain('"ranges"');
    let reads = 0;
    const revoked = db(a => a.p_operation === "check" ? source : ++reads === 1 ? [row] : []);
    await expect(ownSubjectExportContent(revoked, actor).ancestry(source)).rejects.toThrow("export unavailable");
  });

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

function preparedSnapshot(): OwnExportSnapshot {
  return { ...snapshot(), preparedSource: { version: "own-prepared-report-source-v1", backend: "prepared-object-v1",
    manifestId: id(80), membershipSha256: "c".repeat(64), rootArtifactId: id(81), rootSha256: "d".repeat(64) } };
}
describe("prepared-object export snapshot dispatch", () => {
  it("passes the exact captured source and current export checker to the streaming transport", async () => {
    preparedExport.mockReset(); const selected = preparedSnapshot(), rpc = db(() => selected), consume = vi.fn();
    preparedExport.mockImplementation(async (_actor, selection, options) => {
      expect(selection).toMatchObject({ fileId: selected.file.id, rawSha256: selected.file.sha256,
        decodedSha256: selected.file.source_sha256, preparedSource: selected.preparedSource });
      await options.checkOperation(new AbortController().signal);
      return { recordCount: 3, variantCount: 1 };
    });
    expect(await ownSubjectExportContent(rpc, actor).preparedRecords(selected, consume)).toEqual({ recordCount: 3, variantCount: 1 });
    expect(rpc.mock.calls.map(([, a]) => a.p_operation)).toEqual(["check", "check"]);
    expect(preparedExport).toHaveBeenCalledWith(actor, expect.any(Object), expect.any(Object), consume);
  });
  it("refuses database fallback for prepared variant and observation pages", () => {
    const selected = preparedSnapshot(), rpc = db(() => []), content = ownSubjectExportContent(rpc, actor);
    expect(() => content.variants(selected)).toThrow("export unavailable");
    expect(() => content.observed(selected)).toThrow("export unavailable");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("rejects a changed complete export snapshot before any prepared object request", async () => {
    preparedExport.mockReset(); const selected = preparedSnapshot();
    const rpc = db(() => ({ ...selected, preparedSource: { ...selected.preparedSource!, membershipSha256: "e".repeat(64) } }));
    await expect(ownSubjectExportContent(rpc, actor).preparedRecords(selected, async () => {})).rejects.toThrow("export unavailable");
    expect(preparedExport).not.toHaveBeenCalled();
  });
});
