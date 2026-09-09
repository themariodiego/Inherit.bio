import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publicationFixture } from "./prepare-genome-publication.fixtures";
import { prepareGenomePublication } from "./prepare-genome-publication";
import { withOwnPreparedSource, type OwnPreparedSource } from "./published-source-reader";
import { exportOwnPreparedRecords, type OwnPreparedExportSelection } from "./export-source";
import type { CanonicalRecord } from "./canonical-schema";
import { jobId, attemptId, row } from "./materialize-canonical.fixtures";
import type { PreparedStoredArtifact } from "./storage-writer";

const origin = "https://synthetic.invalid", credential = "synthetic-placeholder";
const actor = { accountId: "11111111-1111-4111-8111-111111111111", sessionId: "22222222-2222-4222-8222-222222222222" };
const manifestId = "88888888-8888-4888-8888-888888888888";
type Override = (url: string, init: RequestInit) => Response | Promise<Response> | undefined;
async function setup(rows?: string[], build: "GRCh37" | "GRCh38" = "GRCh38") {
  const f = await publicationFixture(rows, build);
  const publication = await prepareGenomePublication({ canonical: f.canonical, rsid: f.root,
    expected: { binding: f.binding, jobId, attemptId, firstRsidArtifactSequence: f.root.firstArtifactSequence } },
  { ...f, check: async () => {} });
  const source: OwnPreparedSource = { version: "own-prepared-source-v1", backend: "prepared-object-v1", manifestId,
    fileId: f.binding.source.fileId, subjectId: f.binding.source.subjectId, sourceRevision: f.binding.source.sourceRevision,
    rawSha256: f.binding.source.rawSha256, decodedSha256: f.binding.source.decodedSha256, preparedAt: "2026-09-08T19:00:00Z",
    root: publication.rootArtifact, summary: publication.payload.summary, memberCount: publication.members.length,
    membershipSha256: "d".repeat(64) };
  const member = (artifact: PreparedStoredArtifact) => ({ version: "own-prepared-member-v1", manifestId, fileId: source.fileId,
    membershipSha256: source.membershipSha256, member: artifact });
  const order: string[] = [], state: { override?: Override } = {};
  const provider = vi.fn(async (url: string, init: RequestInit) => {
    expect(url.startsWith(origin)).toBe(true); expect(init).toMatchObject({ cache: "no-store", redirect: "error", signal: expect.any(AbortSignal) });
    expect(new Headers(init.headers).get("Authorization")).toBe(`Bearer ${credential}`);
    const override = state.override?.(url, init); if (override !== undefined) return override;
    const rpcHeaders = { "Content-Range": "0-0/*", "Range-Unit": "items" };
    if (url.endsWith("/read_own_prepared_manifest_v1")) { order.push("source"); return Response.json(source, { headers: rpcHeaders }); }
    if (url.endsWith("/check_own_prepared_member_v1")) {
      const args = JSON.parse(init.body as string); const artifact = publication.members.find(a => a.receipt.artifactId === args.p_artifact_id);
      expect(args).toMatchObject({ p_account_id: actor.accountId, p_session_id: actor.sessionId,
        p_file_id: source.fileId, p_expected_manifest_id: manifestId });
      order.push(`member:${args.p_artifact_id}`);
      return artifact ? Response.json(member(artifact), { headers: rpcHeaders }) : Response.json({ error: "not_found" }, { status: 403 });
    }
    const key = url.split("/genomes/")[1], bytes = f.objects.get(key); if (!bytes) return new Response(null, { status: 404 });
    const artifact = publication.members.find(a => a.receipt.objectKey === key)!;
    order.push(`storage:${artifact.receipt.artifactId}`);
    const range = new Headers(init.headers).get("Range");
    if (range) {
      const [, first, last] = /^bytes=(\d+)-(\d+)$/.exec(range)!; const start = Number(first), end = Number(last);
      return new Response(Buffer.from(bytes.subarray(start, end + 1)), { status: 206,
        headers: { "Content-Range": `bytes ${start}-${end}/${bytes.length}`, "Content-Length": String(end - start + 1) } });
    }
    return new Response(Buffer.from(bytes), { headers: { "Content-Length": String(bytes.length) } });
  });
  vi.stubGlobal("fetch", provider);
  const checkOperation = vi.fn<(signal: AbortSignal) => Promise<void>>(async () => { order.push("operation"); });
  return { ...f, publication, source, member, order, state, provider, checkOperation,
    request: { fileId: source.fileId, expectedManifestId: manifestId, loci: [{ chrom: 1, pos: 1 }] } };
}
beforeEach(() => { vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", origin); vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", credential); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
type Fixture = Awaited<ReturnType<typeof setup>>;
function selection(f: Fixture): OwnPreparedExportSelection {
  const s = f.source;
  return { fileId: s.fileId, subjectId: s.subjectId, sourceRevision: s.sourceRevision,
    rawSha256: s.rawSha256, decodedSha256: s.decodedSha256, preparedAt: s.preparedAt,
    preparedSource: { version: "own-prepared-report-source-v1", backend: "prepared-object-v1", manifestId,
      membershipSha256: s.membershipSha256, rootArtifactId: s.root.receipt.artifactId, rootSha256: s.root.receipt.sha256 } };
}
const run = (f: Fixture, consume: Parameters<typeof exportOwnPreparedRecords>[3],
  selected = selection(f), signal?: AbortSignal) => exportOwnPreparedRecords(actor, selected,
    { checkOperation: f.checkOperation, signal }, consume);

describe("actual prepared export transport composition", () => {
  it("reads every final canonical record through exact member RPCs and full stored hashes, preserving all dispositions", async () => {
    const f = await setup(), records: CanonicalRecord[] = [];
    const counts = await run(f, async page => { records.push(...page); });
    expect(counts).toEqual({ recordCount: f.canonical.recordCount, variantCount: f.source.summary.variantCount });
    expect(records).toHaveLength(f.canonical.recordCount);
    expect(records.some(r => r.event.type === "reference")).toBe(true);
    expect(records.some(r => r.normalization.status === "duplicate")).toBe(true);
    expect(f.order[0]).toBe("operation"); expect(f.order.at(-1)).toBe("operation");
    expect(f.order.filter(v => v === "source").length).toBeGreaterThanOrEqual(3);
  });
  it("does not filter original GRCh37 records when normalized output is unavailable", async () => {
    const f = await setup(undefined, "GRCh37"), records: CanonicalRecord[] = [];
    await run(f, async (page, _, header) => {
      records.push(...page); expect(header.binding.source.sourceBuild).toBe("GRCh37");
      expect(header.binding.targetBuild).toBe("GRCh38");
    });
    expect(records).toHaveLength(f.canonical.recordCount);
    expect(records.filter(r => r.normalization.status === "normalized" && r.event.type === "variant")).toHaveLength(f.source.summary.variantCount);
    expect(records.filter(r => r.event.type === "observed")).toHaveLength(f.source.summary.sourceObservedCount);
  });
  it.each(["subjectId", "rawSha256", "decodedSha256", "preparedAt", "rootSha256"])("rejects changed captured %s before delivering any record", async field => {
    const f = await setup(), selected = selection(f), consume = vi.fn(async () => {});
    if (field === "rootSha256") selected.preparedSource.rootSha256 = "a".repeat(64);
    else Object.assign(selected, { [field]: field === "subjectId" ? actor.accountId : field === "preparedAt" ? "2026-09-01T00:00:00Z" : "f".repeat(64) });
    await expect(run(f, consume, selected)).rejects.toMatchObject({ code: "integrity_mismatch" });
    expect(consume).not.toHaveBeenCalled();
  });
  it("does not read ahead while the archive sink applies backpressure", async () => {
    const f = await setup(Array.from({ length: 1100 }, (_, i) => row(i + 1)));
    let release = () => {}; const held = new Promise<void>(resolve => { release = resolve; });
    let entered = () => {}; const started = new Promise<void>(resolve => { entered = resolve; });
    let pages = 0;
    const pending = run(f, async () => { if (++pages === 1) { entered(); await held; } });
    await started; const calls = f.provider.mock.calls.length;
    await new Promise(resolve => setTimeout(resolve, 10)); expect(f.provider).toHaveBeenCalledTimes(calls);
    release(); await pending; expect(pages).toBeGreaterThan(1);
  });
  it("refuses completion when an unread final member disappears after data reached the sink", async () => {
    const f = await setup(); let delivered = 0;
    await expect(run(f, async records => {
      delivered += records.length;
      f.state.override = url => url.endsWith("/read_own_prepared_manifest_v1") ? Response.json({ error: "unavailable" }, { status: 403 }) : undefined;
    })).rejects.toBeDefined();
    expect(delivered).toBeGreaterThan(0);
  });
  it("cancels at sink failure without further data delivery or successful completion", async () => {
    const f = await setup(), consume = vi.fn(async () => { throw Error("private sink failure"); });
    await expect(run(f, consume)).rejects.toMatchObject({ code: "unavailable" });
    expect(consume).toHaveBeenCalledTimes(1);
  });
  it("closes escaped artifact access when the awaited source scope finishes", async () => {
    const f = await setup();
    const access = await withOwnPreparedSource(actor,
      { fileId: f.source.fileId, expectedManifestId: manifestId }, f, async value => value);
    const calls = f.provider.mock.calls.length;
    expect(access.signal.aborted).toBe(true);
    expect(() => access.readArtifact(f.source.root, new AbortController().signal)).toThrow("aborted");
    await expect(access.checkSource()).rejects.toMatchObject({ code: "aborted" });
    expect(f.provider).toHaveBeenCalledTimes(calls);
  });

});
