import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import gastrointestinal from "../../../data/templates/gastrointestinal.json";
import type { ReportTemplate } from "../genome/reports";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn(), getClaims: vi.fn(), templates: vi.fn(), profile: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc, from: () => ({ select: () => ({ eq: () => ({ single: mocks.profile }) }) }) }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: mocks }) }));
vi.mock("@/lib/genome/load", () => ({ getPublishedTemplates: mocks.templates }));
import { generateOwnReports } from "./own-report-generation";
import { AIMS } from "../genome/admixture";
import { ownAncestryContentSchema } from "./own-ancestry-content";
import { hasEmptyRequestBody } from "../empty-request-body";

const account = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", session = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const fileId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc", claimId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const subject = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", grant = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const principal = "11111111-1111-4111-8111-111111111111";
const context = { accountRevision: 1, authSessionRevision: 1, jurisdictionRevision: 1, subjectBindingRevision: 1,
  accountBindingRevision: 1, uploadConsentId: principal, subjectLifecycleRevision: 1, originatingSessionRevision: 1,
  principalId: principal, principalRevision: 1 };
const authorization = { context, grantId: grant, grantRevision: 1, sourceRevision: 1, sourceSha256: "a".repeat(64),
  normalizedAt: "2026-09-06T12:00:00+00:00", subjectId: subject };
const template = { ...gastrointestinal[0], layer: "estimate", estimate_kind: "single_locus" } as ReportTemplate;
let selected: Set<string>, finished: Set<string>;
const done = (purpose: string) => ({ status: "complete", purpose });
let ancestryFileType: string;
const claim = (purpose: string) => ({ status: "authorized", claim: claimId, purpose, authorization,
  ...(purpose === "ancestry" ? { source: { fileId, fileType: ancestryFileType, normalizedBuild: "GRCh38",
    callEncoding: ancestryFileType.startsWith("array_") ? "array-genotype" : "vcf-literal" } } : {}) });
const sourceCall = { file_id: fileId, rsid: 4988235, chrom: 2, pos: 135851076, ref: "G", alt: "A", genotype: "A/G" };
const request = (body?: string) => new Request(`https://inherit.bio/api/files/${fileId}/process`, { method: "POST", body,
  headers: { origin: "https://inherit.bio", "sec-fetch-site": "same-origin" } });
async function rpc(_name: string, args: { p_operation: string; p_purpose: string; p_payload: { loci: { chrom: number; pos: number }[]; offset: number } }) {
  const p = args.p_purpose, op = args.p_operation;
  if (op === "begin") return { data: selected.has(p) ? finished.has(p) ? done(p) : claim(p) : { status: "not_selected" }, error: null };
  if (op === "check") return { data: finished.has(p) ? done(p) : claim(p), error: null };
  if (op === "read-variants") return { data: args.p_payload.offset === 0 && args.p_payload.loci.some(point => point.pos === sourceCall.pos) ? [sourceCall] : [], error: null };
  if (op === "read-observed") return { data: [], error: null };
  if (op === "complete") { finished.add(p); return { data: done(p), error: null }; }
  return { data: true, error: null };
}
beforeEach(() => {
  vi.stubEnv("BYOK_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  ancestryFileType = "vcf";
  vi.resetAllMocks(); selected = new Set(["reports.polygenic"]); finished = new Set();
  mocks.profile.mockResolvedValue({ data: { mail_contact_revision: 1 }, error: null });
  mocks.getUser.mockResolvedValue({ data: { user: { id: account, email: "ready@e2e.local", email_confirmed_at: "2026-09-06T12:00:00Z" } } });
  mocks.getClaims.mockResolvedValue({ data: { claims: { sub: account, session_id: session } } });
  mocks.templates.mockResolvedValue([template, { ...template, slug: "synthetic-monogenic", layer: "variant_call", estimate_kind: null }]);
  mocks.rpc.mockImplementation(rpc);
});
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });
describe("independent synchronous own reports", () => {
  it("generates the real MCM6 AG interpretation for only the chosen estimate purpose", async () => {
    const response = await generateOwnReports(request(), fileId);
    expect(await response.json()).toEqual({ fileId, status: "processed", analysisState: "active" });
    const completed = mocks.rpc.mock.calls.filter(call => call[1].p_operation === "complete");
    expect(completed).toHaveLength(1); expect(completed[0][1].p_purpose).toBe("reports.polygenic");
    const payload = completed[0][1].p_payload;
    expect(payload.reports[0].catalogSnapshot).toEqual({ schemaVersion: 1, template });
    expect(payload.reports[0].catalogSnapshot).not.toHaveProperty("templateSha256");
    expect(payload.reports).toHaveLength(1); expect(payload.reports[0].slug).toBe(template.slug);
    expect(payload.reports[0].variants[0].outcome).toMatchObject({ status: "genotyped", genotype: "AG",
      interpretation: template.variants[0].interpretations.AG });
    expect(payload.prs).toHaveLength(3);
    expect(JSON.stringify(payload)).not.toMatch(/"(?:zscore|percentile)"/);
    expect(mocks.rpc.mock.calls.filter(call => call[1].p_purpose === "ancestry").map(call => call[1].p_operation)).toEqual(["begin"]);
  });
  it("keeps prepared status with no selected purpose", async () => {
    selected = new Set();
    expect(await (await generateOwnReports(request(), fileId)).json())
      .toEqual({ fileId, status: "normalization_complete", analysisState: "not_generated" });
    expect(mocks.templates).not.toHaveBeenCalled();
    expect(mocks.rpc.mock.calls.every(call => call[1].p_operation === "begin")).toBe(true);
  });
  it("makes monogenic results independently with no PGS payload", async () => {
    selected = new Set(["reports.monogenic"]);
    expect((await generateOwnReports(request(), fileId)).status).toBe(200);
    const payload = mocks.rpc.mock.calls.find(call => call[1].p_operation === "complete")![1].p_payload;
    expect(payload.prs).toEqual([]); expect(payload.reports[0].slug).toBe("synthetic-monogenic");
  });
  it("returns already_processed without re-reading a completed source", async () => {
    finished.add("reports.polygenic");
    expect(await (await generateOwnReports(request(), fileId)).json()).toEqual({ fileId, status: "already_processed", analysisState: "active" });
    expect(mocks.templates).not.toHaveBeenCalled();
  });
  it("accepts a zero-byte stream even when preparation already consumed EOF", async () => {
    const req = new Request(`https://inherit.bio/api/files/${fileId}/process`, { method: "POST",
      headers: { origin: "https://inherit.bio", "sec-fetch-site": "same-origin" },
      body: new ReadableStream({ start(controller) { controller.close(); } }), duplex: "half" } as RequestInit);
    expect(await hasEmptyRequestBody(req)).toBe(true);
    expect((await generateOwnReports(req, fileId)).status).toBe(200);
  });
  it("rejects any request byte before grant or source access", async () => {
    expect((await generateOwnReports(request(" "), fileId)).status).toBe(422); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects a signed identity mismatch before database reads", async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "other", session_id: session } } });
    expect((await generateOwnReports(request(), fileId)).status).toBe(401); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("does not publish if the exact grant fails a genetic read", async () => {
    mocks.rpc.mockImplementation(async (name, args) => args.p_operation === "read-variants" ? { data: null, error: { code: "42501" } } : rpc(name, args));
    expect((await generateOwnReports(request(), fileId)).status).toBe(503);
    expect(mocks.rpc.mock.calls.some(call => call[1].p_operation === "complete")).toBe(false);
  });
  it("rejects wrong-file genetic rows", async () => {
    mocks.rpc.mockImplementation(async (name, args) => args.p_operation === "read-variants"
      ? { data: [{ ...sourceCall, file_id: subject }], error: null } : rpc(name, args));
    expect((await generateOwnReports(request(), fileId)).status).toBe(503);
  });
  it("compares complete source authorization immediately before interpretation", async () => {
    mocks.rpc.mockImplementation(async (name, args) => args.p_operation === "check"
      ? { data: { ...claim(args.p_purpose), authorization: { ...authorization, sourceRevision: 2 } }, error: null } : rpc(name, args));
    expect((await generateOwnReports(request(), fileId)).status).toBe(503);
    expect(mocks.rpc.mock.calls.some(call => call[1].p_operation === "complete")).toBe(false);
  });
  it("retains normalized coordinates for GRCh37 observations without reinterpreting source positions", async () => {
    mocks.rpc.mockImplementation(async (name, args) => args.p_operation === "read-variants" ? { data: [], error: null }
      : args.p_operation === "read-observed" ? { data: args.p_payload.loci.some((point: { pos: number }) => point.pos === sourceCall.pos)
        ? [{ ...sourceCall, usable: true }] : [], error: null } : rpc(name, args));
    expect((await generateOwnReports(request(), fileId)).status).toBe(200);
    const payload = mocks.rpc.mock.calls.find(call => call[1].p_operation === "complete")![1].p_payload;
    expect(payload.reports[0].variants[0].outcome.genotype).toBe("AG");
    expect(mocks.rpc.mock.calls.filter(call => call[1].p_operation === "read-observed")
      .flatMap(call => call[1].p_payload.loci).some(point => point.pos === 135851076)).toBe(true);
  });
  it("fails rather than declaring reports ready when template loading returned no templates", async () => {
    mocks.templates.mockResolvedValue([]);
    expect((await generateOwnReports(request(), fileId)).status).toBe(503);
    expect(mocks.rpc.mock.calls.some(call => call[1].p_operation === "complete")).toBe(false);
  });
  it("uses only the service mail adapter and binds an encrypted verified recipient to atomic completion", async () => {
    expect((await generateOwnReports(request(), fileId)).status).toBe(200);
    expect(mocks.rpc.mock.calls.every(([name]) => name === "own_report_generation_with_mail_v1")).toBe(true);
    const complete = mocks.rpc.mock.calls.find(([, args]) => args.p_operation === "complete")![1];
    expect(complete.p_payload.readyMail).toEqual({ contactRevision: 1, contactCiphertext: expect.stringMatching(/^[0-9a-f]+$/),
      contactHmac: expect.stringMatching(/^[0-9a-f]{64}$/), dashboardUrl: expect.stringMatching(/\/genome\/me\/reports$/) });
    expect(JSON.stringify(complete.p_payload.readyMail)).not.toContain("ready@e2e.local");
    expect(mocks.rpc.mock.calls.filter(([, args]) => args.p_operation === "ready")).toHaveLength(1);
  });
  it("fails closed before completion when the current recipient cannot be resolved", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: { id: account } } })
      .mockResolvedValue({ data: { user: { id: account, email: "unconfirmed@e2e.local" } } });
    expect((await generateOwnReports(request(), fileId)).status).toBe(503);
    expect(mocks.rpc.mock.calls.some(([, args]) => ["complete", "ready"].includes(args.p_operation))).toBe(false);
  });
  it("does not report success when the atomic completion rejects its notice envelope", async () => {
    mocks.rpc.mockImplementation(async (name, args) => args.p_operation === "complete"
      ? { data: null, error: { code: "22023", message: "invalid_ready_envelope" } } : rpc(name, args));
    const response = await generateOwnReports(request(), fileId);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("invalid_ready_envelope");
    expect(mocks.rpc.mock.calls.some(([, args]) => args.p_operation === "ready")).toBe(false);
  });
  it("does not request blanket readiness after one selected purpose fails", async () => {
    selected.add("reports.monogenic");
    mocks.rpc.mockImplementation(async (name, args) => args.p_purpose === "reports.polygenic" && args.p_operation === "read-variants"
      ? { data: null, error: { code: "42501" } } : rpc(name, args));
    expect((await generateOwnReports(request(), fileId)).status).toBe(503);
    expect(mocks.rpc.mock.calls.filter(([, args]) => args.p_operation === "complete")).toHaveLength(1);
    expect(mocks.rpc.mock.calls.some(([, args]) => args.p_operation === "ready")).toBe(false);
  });
  it("replays a durable notice for already completed work without regenerating results", async () => {
    finished.add("reports.polygenic");
    expect((await generateOwnReports(request(), fileId)).status).toBe(200);
    expect(mocks.rpc.mock.calls.filter(([, args]) => args.p_operation === "ready")).toHaveLength(1);
    expect(mocks.rpc.mock.calls.some(([, args]) => args.p_operation === "complete")).toBe(false);
    mocks.rpc.mockImplementation(async (name, args) => args.p_operation === "ready"
      ? { data: null, error: { code: "55000" } } : rpc(name, args));
    expect((await generateOwnReports(request(), fileId)).status).toBe(503);
  });

});

const marker = AIMS[0];
const ancestryObservation = { file_id: fileId, rsid: Number(marker.rsid.slice(2)), chrom: marker.chrom, pos: marker.pos38,
  ref: marker.ref, alt: marker.alt, genotype: `${marker.ref}/${marker.ref}`, usable: true };
function withAncestryRows(rows: unknown[]) {
  mocks.rpc.mockImplementation(async (name, args) => args.p_purpose === "ancestry" && args.p_operation.startsWith("read-")
    ? { data: args.p_payload.offset === 0 ? rows : [], error: null } : rpc(name, args));
}
function ancestryPayload() {
  return mocks.rpc.mock.calls.find(call => call[1].p_purpose === "ancestry" && call[1].p_operation === "complete")?.[1].p_payload;
}
describe("explicit canonical ancestry generation", () => {
  beforeEach(() => { selected = new Set(["ancestry"]); });
  it("uses checked literal reference observations, exact source provenance and one final durable ready check", async () => {
    withAncestryRows([ancestryObservation]);
    expect(await (await generateOwnReports(request(), fileId)).json()).toEqual({ fileId, status: "processed", analysisState: "active" });
    expect(mocks.templates).not.toHaveBeenCalled();
    const payload = ancestryPayload();
    expect(Object.keys(payload).sort()).toEqual(["ancestry", "readyMail"]);
    expect(ownAncestryContentSchema.parse(payload.ancestry)).toMatchObject({ source: { fileId, subjectId: subject,
      sourceSha256: authorization.sourceSha256, sourceRevision: 1, normalizedAt: authorization.normalizedAt, callEncoding: "vcf-literal" },
      admixture: { result_state: "partial", result: { markersUsed: 1 }, coverage: 1 / 168 } });
    const reads = mocks.rpc.mock.calls.filter(call => call[1].p_operation.startsWith("read-"));
    expect(reads).toHaveLength(1); expect(reads[0][1].p_operation).toBe("read-observed");
    expect(reads[0][1].p_payload.loci).toEqual(AIMS.map(m => ({ chrom: m.chrom, pos: m.pos38 })));
    expect(mocks.rpc.mock.calls.filter(call => call[1].p_operation === "ready")).toHaveLength(1);
  });
  it("completes honest zero coverage without inferring reference or lineage", async () => {
    expect((await generateOwnReports(request(), fileId)).status).toBe(200);
    expect(ancestryPayload().ancestry).toMatchObject({ admixture: { result: { markersUsed: 0 }, result_state: "not_covered" },
      panelPositions: { called: 0, missing: 168 }, lineages: [{ state: "unavailable" }, { state: "unavailable" }] });
  });
  it.each(["array_23andme", "array_ancestry", "array_myheritage", "array_ftdna"])("uses only variant observations for checked %s encoding", async fileType => {
    ancestryFileType = fileType;
    withAncestryRows([{ ...ancestryObservation, ref: null, alt: null }]);
    expect((await generateOwnReports(request(), fileId)).status).toBe(200);
    expect(ancestryPayload().ancestry.source.callEncoding).toBe("array-genotype");
    expect(mocks.rpc.mock.calls.filter(call => call[1].p_operation.startsWith("read-")).map(call => call[1].p_operation)).toEqual(["read-variants"]);
  });
  it("uses literal observed calls for a checked gVCF source", async () => {
    ancestryFileType = "gvcf"; withAncestryRows([ancestryObservation]);
    expect((await generateOwnReports(request(), fileId)).status).toBe(200);
    expect(ancestryPayload().ancestry.source.callEncoding).toBe("vcf-literal");
    expect(mocks.rpc.mock.calls.filter(call => call[1].p_operation.startsWith("read-")).map(call => call[1].p_operation)).toEqual(["read-observed"]);
  });
  it.each([
    { fileType: "unknown" }, { fileId: subject }, { normalizedBuild: "GRCh37" },
    { callEncoding: "array-genotype" }, { callEncoding: undefined },
  ])("refuses unsupported or mismatched checked source metadata before reads", async patch => {
    mocks.rpc.mockImplementation(async (name, args) => args.p_operation === "begin" && args.p_purpose === "ancestry"
      ? { data: { ...claim("ancestry"), source: { ...claim("ancestry").source, ...patch } }, error: null } : rpc(name, args));
    expect((await generateOwnReports(request(), fileId)).status).toBe(503);
    expect(mocks.rpc.mock.calls.some(call => call[1].p_operation.startsWith("read-"))).toBe(false);
    expect(ancestryPayload()).toBeUndefined();
  });
  it("retains no-call, filtered and conflicting evidence without panel signal", async () => {
    const second = { ...ancestryObservation, chrom: AIMS[1].chrom, pos: AIMS[1].pos38, ref: AIMS[1].ref, alt: AIMS[1].alt };
    withAncestryRows([{ ...ancestryObservation, genotype: "--" }, { ...second, usable: false },
      { ...ancestryObservation, chrom: AIMS[2].chrom, pos: AIMS[2].pos38, ref: AIMS[2].ref, alt: AIMS[2].alt, genotype: `${AIMS[2].ref}/${AIMS[2].ref}` },
      { ...ancestryObservation, chrom: AIMS[2].chrom, pos: AIMS[2].pos38, ref: AIMS[2].ref, alt: AIMS[2].alt, genotype: `${AIMS[2].alt}/${AIMS[2].alt}` }]);
    expect((await generateOwnReports(request(), fileId)).status).toBe(200);
    expect(ancestryPayload().ancestry.panelPositions).toEqual({ called: 0, missing: 165, noCall: 1, filtered: 1, conflicting: 1, unsupported: 0 });
  });
  it.each([
    { ...ancestryObservation, file_id: subject }, { ...ancestryObservation, usable: undefined },
    { ...ancestryObservation, pos: 1 }, { ...ancestryObservation, ref: null, alt: null },
  ])("refuses malformed or out-of-source literal rows before completion", async row => {
    withAncestryRows([row]);
    expect((await generateOwnReports(request(), fileId)).status).toBe(503);
    expect(ancestryPayload()).toBeUndefined();
    expect(mocks.rpc.mock.calls.some(call => call[1].p_operation === "ready")).toBe(false);
  });
  it("exhausts paged observations before computing one call per position", async () => {
    mocks.rpc.mockImplementation(async (name, args) => args.p_operation === "read-observed"
      ? { data: args.p_payload.offset === 0 ? Array(1000).fill(ancestryObservation) : [{ ...ancestryObservation, genotype: `${marker.alt}/${marker.alt}` }], error: null }
      : rpc(name, args));
    expect((await generateOwnReports(request(), fileId)).status).toBe(200);
    expect(ancestryPayload().ancestry.panelPositions.conflicting).toBe(1);
    expect(mocks.rpc.mock.calls.filter(call => call[1].p_operation === "read-observed").map(call => call[1].p_payload.offset)).toEqual([0, 1000]);
  });
  it("refuses source encoding or normalization changes between claim and completion", async () => {
    mocks.rpc.mockImplementation(async (name, args) => args.p_operation === "check" && args.p_purpose === "ancestry"
      ? { data: { ...claim("ancestry"), source: { ...claim("ancestry").source, fileType: "array_23andme", callEncoding: "array-genotype" } }, error: null }
      : rpc(name, args));
    expect((await generateOwnReports(request(), fileId)).status).toBe(503); expect(ancestryPayload()).toBeUndefined();
  });
  it("replays completed ancestry without reading or recomputing", async () => {
    finished.add("ancestry");
    expect(await (await generateOwnReports(request(), fileId)).json()).toEqual({ fileId, status: "already_processed", analysisState: "active" });
    expect(mocks.rpc.mock.calls.some(call => call[1].p_operation.startsWith("read-"))).toBe(false);
    expect(ancestryPayload()).toBeUndefined(); expect(mocks.templates).not.toHaveBeenCalled();
  });
  it("retains independent report purposes and checks all three before ready", async () => {
    selected = new Set(["reports.monogenic", "reports.polygenic", "ancestry"]);
    expect((await generateOwnReports(request(), fileId)).status).toBe(200);
    expect(mocks.rpc.mock.calls.filter(call => call[1].p_operation === "complete").map(call => call[1].p_purpose))
      .toEqual(["reports.monogenic", "reports.polygenic", "ancestry"]);
    expect(mocks.rpc.mock.calls.filter(call => call[1].p_operation === "check" && call[1].p_claim === null).map(call => call[1].p_purpose))
      .toEqual(["reports.monogenic", "reports.polygenic", "ancestry"]);
  });
});
