import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publicationFixture } from "./prepare-genome-publication.fixtures";
import { prepareGenomePublication } from "./prepare-genome-publication";
import { createOwnPreparedCoordinateReader, type OwnPreparedSource } from "./published-source-reader";
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
  return { ...f, publication, source, member, order, state, provider, checkOperation, read: createOwnPreparedCoordinateReader(actor),
    request: { fileId: source.fileId, expectedManifestId: manifestId, loci: [{ chrom: 1, pos: 1 }] } };
}
beforeEach(() => { vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", origin); vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", credential); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("published canonical source reader (synthetic HTTP, not hosted proof)", () => {
  it("follows actual serialized publication roots through exact RPC membership and authenticated selected ranges", async () => {
    const f = await setup(), result = await f.read(f.request, f);
    expect(result.source).toEqual(f.source);
    expect(result.records).toEqual(f.records.filter(r => r.normalization.status === "normalized" && r.normalization.record.pos === 1));
    expect(result.nextCursor).toBeNull(); expect(f.order[0]).toBe("operation"); expect(f.order.at(-1)).toBe("operation");
    expect(f.order.filter(p => p === "source")).toHaveLength(2);
    expect(f.order.filter(p => p.startsWith("storage:"))).toHaveLength(5);
    for (let i = 0; i < f.order.length; i++) if (f.order[i].startsWith("storage:")) {
      const id = f.order[i].slice(8);
      expect(f.order.slice(0, i)).toContain(`member:${id}`); expect(f.order.slice(i + 1)).toContain(`member:${id}`);
    }
    expect(f.provider.mock.calls.some(([url]) => /claim|normalization|publish_/.test(url))).toBe(false);
  });

  it("continues a full page with source-bound cursor while rechecking the current operation", async () => {
    const f = await setup(Array.from({ length: 1001 }, () => row(1)));
    const first = await f.read(f.request, f); expect(first.records).toHaveLength(1000);
    const second = await f.read({ ...f.request, cursor: first.nextCursor }, f);
    expect(second.nextCursor).toBeNull();
    expect([...first.records, ...second.records]).toEqual(f.records.filter(r => r.normalization.status === "normalized"));
    expect(f.order.filter(p => p === "source")).toHaveLength(4);
  });

  it("returns target-build calls while retaining original GRCh37 source evidence", async () => {
    const f = await setup([row(1), row(30)], "GRCh37");
    const result = await f.read({ ...f.request, loci: [{ chrom: 1, pos: 101 }] }, f);
    expect(result.records).toHaveLength(2);
    expect(result.records[0].event).toMatchObject({ call: { pos: 1 } });
    expect(result.records[0].normalization).toMatchObject({ record: { pos: 101 } });
  });

  it.each(["manifest", "source", "summary", "root-member", "canonical-member"])("refuses inconsistent %s identity without returning coverage", async mode => {
    const f = await setup();
    if (mode === "manifest") f.source.manifestId = "99999999-9999-4999-8999-999999999999";
    if (mode === "source") f.source.rawSha256 = "f".repeat(64);
    if (mode === "summary") f.source.summary = { ...f.source.summary, rsidPointerCount: f.source.summary.rsidPointerCount - 1 };
    if (mode === "root-member" || mode === "canonical-member") {
      const target = mode === "root-member" ? f.source.root : f.publication.canonicalRoot;
      f.state.override = (url, init) => {
        if (url.endsWith("check_own_prepared_member_v1") && JSON.parse(init.body as string).p_artifact_id === target.receipt.artifactId) {
          const wrong = structuredClone(f.member(target)); wrong.member.storageObjectId = "99999999-9999-4999-8999-999999999999";
          return Response.json(wrong);
        }
      };
    }
    await expect(f.read(f.request, f)).rejects.toMatchObject({ code: mode.endsWith("member") ? "unavailable" : "integrity_mismatch" });
    if (mode.endsWith("member")) {
      const target = mode === "root-member" ? f.source.root : f.publication.canonicalRoot;
      expect(f.provider.mock.calls.some(([url]) => url.endsWith(target.receipt.objectKey))).toBe(false);
    }
  });

  it("refuses changed canonical bytes even when source/member metadata is unchanged", async () => {
    const f = await setup(); f.objects.get(f.publication.canonicalRoot.receipt.objectKey)![0] ^= 1;
    await expect(f.read(f.request, f)).rejects.toMatchObject({ code: "unavailable" });
  });

  it("checks root semantic source binding even when its altered bytes have a matching reported hash", async () => {
    const f = await setup(), artifact = f.source.root;
    const root = JSON.parse(Buffer.from(f.objects.get(artifact.receipt.objectKey)!).toString());
    root.binding.source.sourceRevision++;
    const bytes = Buffer.from(JSON.stringify(root)); f.objects.set(artifact.receipt.objectKey, bytes);
    artifact.receipt.byteCount = bytes.length; artifact.receipt.sha256 = createHash("sha256").update(bytes).digest("hex");
    await expect(f.read(f.request, f)).rejects.toMatchObject({ code: "integrity_mismatch" });
  });

  it("does no discovery or storage read after initial operation denial", async () => {
    const f = await setup(); f.checkOperation.mockRejectedValue(new Error("synthetic purpose withdrawn"));
    await expect(f.read(f.request, f)).rejects.toMatchObject({ code: "unavailable" }); expect(f.provider).not.toHaveBeenCalled();
  });

  it("suppresses all records after a final operation denial", async () => {
    const f = await setup(); let reachedData = false, checksAfterData = 0;
    const page = JSON.parse(Buffer.from(f.objects.get(f.canonical.directories[0].artifact.receipt.objectKey)!).toString());
    const dataKey = page.containers[0].artifact.receipt.objectKey;
    f.state.override = (url, init) => { if (new Headers(init.headers).has("Range") && url.endsWith(dataKey)) reachedData = true; return undefined; };
    f.checkOperation.mockImplementation(async () => { if (reachedData && ++checksAfterData === 4) throw new Error("synthetic withdrawn"); });
    await expect(f.read(f.request, f)).rejects.toMatchObject({ code: "unavailable" });
    expect(reachedData).toBe(true);
  });

  it("refuses loss of an unread final member during selected I/O at the final full source check", async () => {
    const f = await setup(); let storageRead = false, fullReads = 0;
    const page = JSON.parse(Buffer.from(f.objects.get(f.canonical.directories[0].artifact.receipt.objectKey)!).toString());
    const dataKey = page.containers[0].artifact.receipt.objectKey;
    f.state.override = (url, init) => {
      if (url.endsWith(dataKey) && new Headers(init.headers).has("Range")) storageRead = true;
      if (url.endsWith("read_own_prepared_manifest_v1")) {
        fullReads++;
        // The database full-source gate refuses a missing unread rsID member;
        // selected/root member responses remain valid in this synthetic transport.
        if (storageRead) return new Response(null, { status: 403 });
      }
      return undefined;
    };
    await expect(f.read(f.request, f)).rejects.toMatchObject({ code: "unavailable" });
    expect(storageRead).toBe(true); expect(fullReads).toBe(2);
  });

  it("does not mistake a denied published source for an empty or legacy source", async () => {
    const f = await setup(); f.state.override = url => url.endsWith("read_own_prepared_manifest_v1") ? new Response(null, { status: 403 }) : undefined;
    await expect(f.read({ ...f.request, loci: [] }, f)).rejects.toMatchObject({ code: "unavailable" });
    expect(f.provider).toHaveBeenCalledTimes(1);
  });

  it("bounds RPC JSON bytes and requires actual EOF", async () => {
    const f = await setup(); f.state.override = url => url.endsWith("read_own_prepared_manifest_v1")
      ? new Response(JSON.stringify(f.source) + " ".repeat(16_384)) : undefined;
    await expect(f.read(f.request, f)).rejects.toMatchObject({ code: "integrity_mismatch" });
    expect(f.provider).toHaveBeenCalledTimes(1);
  });

  it.each([null, "0-0/*", "0-0/1"])("accepts only scalar RPC count metadata %s across source and member reads", async range => {
    const f = await setup(); let rpcReads = 0;
    f.state.override = (url, init) => {
      if (!url.includes("/rest/v1/rpc/")) return undefined;
      rpcReads++;
      const headers: HeadersInit = range === null ? {} : { "Content-Range": range };
      if (url.endsWith("read_own_prepared_manifest_v1")) return Response.json(f.source, { headers });
      const args = JSON.parse(init.body as string);
      const artifact = f.publication.members.find(member => member.receipt.artifactId === args.p_artifact_id)!;
      return Response.json(f.member(artifact), { headers });
    };
    const result = await f.read(f.request, f);
    expect(result.source).toEqual(f.source); expect(result.records.length).toBeGreaterThan(0);
    expect(rpcReads).toBeGreaterThan(2);
  });

  it.each([
    { status: 206, range: "0-0/*", unit: "items" },
    { status: 201, range: "0-0/1", unit: "items" },
    { status: 200, range: "bytes 0-1457/1458", unit: "bytes" },
    { status: 200, range: "0-0/*", unit: "bytes" },
    { status: 200, range: "0-1/*", unit: "items" },
    { status: 200, range: "0-1/2", unit: "items" },
    { status: 200, range: "0-0/2", unit: "items" },
    { status: 200, range: "1-1/2", unit: "items" },
    { status: 200, range: "*/0", unit: "items" },
    { status: 200, range: "0-0/01", unit: "items" },
  ])("refuses partial, byte, multiple or malformed RPC range $status/$range/$unit before Storage", async fault => {
    const f = await setup(), cancel = vi.fn();
    f.state.override = () => new Response(new ReadableStream({ cancel }, { highWaterMark: 0 }), {
      status: fault.status, headers: { "Content-Range": fault.range, "Range-Unit": fault.unit },
    });
    await expect(f.read(f.request, f)).rejects.toMatchObject({ code: "unavailable" });
    expect(f.provider).toHaveBeenCalledTimes(1); expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("does not let valid single-result count metadata turn an array into a scalar source receipt", async () => {
    const f = await setup();
    f.state.override = () => Response.json([f.source], { headers: { "Content-Range": "0-0/1" } });
    await expect(f.read(f.request, f)).rejects.toMatchObject({ code: "unavailable" });
    expect(f.provider).toHaveBeenCalledTimes(1);
  });

  it("cancels a late noncooperative RPC response body after request cancellation", async () => {
    const f = await setup(), controller = new AbortController(), entered = Promise.withResolvers<void>(), reply = Promise.withResolvers<Response>();
    const cancel = vi.fn();
    f.state.override = () => { entered.resolve(); return reply.promise; };
    const pending = f.read(f.request, { ...f, signal: controller.signal }); await entered.promise; controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "aborted" });
    reply.resolve(new Response(new ReadableStream({ cancel }, { highWaterMark: 0 })));
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
  });

  it("owns query metadata before an operation callback can mutate caller input", async () => {
    const f = await setup(); f.checkOperation.mockImplementation(async () => { f.request.loci[0].pos = 2; f.request.expectedManifestId = "99999999-9999-4999-8999-999999999999"; });
    const result = await f.read(f.request, f);
    expect(result.source.manifestId).toBe(manifestId);
    expect(result.records.every(r => r.normalization.status === "normalized" && r.normalization.record.pos === 1)).toBe(true);
  });
});
