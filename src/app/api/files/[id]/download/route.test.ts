import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
const mocks = vi.hoisted(() => ({ user: vi.fn(), file: vi.fn(), actor: vi.fn(), rpc: vi.fn(), sign: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.user }, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.file }) }) }) }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: (name: string, args: Record<string, unknown>) => ({ abortSignal: async (signal: AbortSignal) => { signal.throwIfAborted(); return mocks.rpc(name, args); } }), storage: { from: () => ({ createSignedUrl: mocks.sign }) } }) }));
vi.mock("@/lib/account-deletion", () => ({ getSensitiveAccountContext: mocks.actor }));
vi.mock("@/lib/genome/prepared-source/storage-common", async original => ({ ...await original<typeof import("@/lib/genome/prepared-source/storage-common")>(), preparedStorageConfig: () => ({ origin: "http://127.0.0.1:55321", key: "synthetic-placeholder" }) }));
const id = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const bytes = new TextEncoder().encode("synthetic original");
const source = () => ({ version: "prepared-original-download-v1", fileId: id, manifestId: other, sourceRevision: 1,
  rawSha256: createHash("sha256").update(bytes).digest("hex"), bucket: "genomes", objectId: id, objectKey: other,
  storageVersion: id, sizeBytes: bytes.length, expiresAt: new Date(Date.now()+120000).toISOString() });
const state = (prepared = true, retired = false) => ({ version: "own-original-download-state-v1", fileId: id, prepared, retired, expiresAt: null });
const run = (signal?: AbortSignal) => GET(new Request(`http://localhost/api/files/${id}/download`, { signal }), { params: Promise.resolve({ id }) });
beforeEach(() => {
  vi.resetAllMocks(); mocks.user.mockResolvedValue({ data: { user: { id } } }); mocks.actor.mockResolvedValue({ user: { id }, sessionId: other });
  mocks.file.mockResolvedValue({ data: { bucket_path: other, original_name: "synthetic.vcf.gz" } }); mocks.sign.mockResolvedValue({ data: { signedUrl: "https://example.invalid/original" }, error: null });
  const captured = source(); mocks.rpc.mockImplementation(async name => ({ data: name === "own_original_download_state_v1" ? state() : { source: captured, originalName: "synthetic.vcf.gz" }, error: null }));
  vi.stubGlobal("fetch", vi.fn(async () => new Response(bytes, { status: 206, headers: { "content-range": `bytes 0-${bytes.length-1}/${bytes.length}`, "content-length": String(bytes.length) } })));
});
afterEach(() => { vi.unstubAllGlobals(); });
describe("original download route", () => {
  it("requires authenticated ownership before privileged state lookup", async () => {
    mocks.user.mockResolvedValue({ data: { user: null } });expect((await run()).status).toBe(401);expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.user.mockResolvedValue({ data: { user: { id } } });mocks.file.mockResolvedValue({ data: null });expect((await run()).status).toBe(404);expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("preserves the ordinary legacy signed-download branch", async () => {
    mocks.rpc.mockResolvedValue({ data: state(false), error: null });const response = await run();expect(response.status).toBe(307);
    expect(mocks.sign).toHaveBeenCalledWith(other,300,{ download: "synthetic.vcf.gz" });expect(fetch).not.toHaveBeenCalled();
  });
  it("returns retired explicitly without signing or fetching an original", async () => {
    mocks.rpc.mockResolvedValue({ data: state(true,true), error: null });const response = await run();expect(response.status).toBe(410);
    expect(mocks.sign).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
  });
  it("authorizes before headers and streams actual exact bytes with current checks", async () => {
    const response = await run(); expect(response.status).toBe(200);expect(fetch).not.toHaveBeenCalled();expect(mocks.sign).not.toHaveBeenCalled();
    expect(mocks.rpc.mock.calls.map(c=>c[0])).toEqual(["own_original_download_state_v1","authorize_own_prepared_original_v1"]);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(mocks.rpc.mock.calls.filter(c=>c[0]==="authorize_own_prepared_original_v1")).toHaveLength(4);
    expect(response.headers.get("content-disposition")).toContain("synthetic.vcf.gz");
  });
  it("refuses a changed exact source before any range bytes are requested", async () => {
    const captured = source();let checks=0;
    mocks.rpc.mockImplementation(async name => ({ data: name === "own_original_download_state_v1" ? state() : { source: ++checks === 1 ? captured : { ...captured, manifestId: id }, originalName: "synthetic.vcf.gz" }, error: null }));
    const response = await run();await expect(response.arrayBuffer()).rejects.toThrow("Original download did not complete.");expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects wrong source identity before sending successful headers", async () => {
    mocks.rpc.mockImplementation(async name => ({ data: name === "own_original_download_state_v1" ? state() : { source: { ...source(), fileId: other }, originalName: "synthetic.vcf.gz" }, error: null }));
    expect((await run()).status).toBe(503);expect(fetch).not.toHaveBeenCalled();
  });
  it("does not continue under another actor session", async () => {
    mocks.actor.mockResolvedValue({ user: { id: other }, sessionId: other });expect((await run()).status).toBe(401);expect(fetch).not.toHaveBeenCalled();
  });
  it("cancels without starting a range when the browser closes before consuming", async () => {
    const response=await run();await response.body!.cancel();expect(fetch).not.toHaveBeenCalled();
  });
});
