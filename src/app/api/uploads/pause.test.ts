import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), claims: vi.fn(), admin: vi.fn(), from: vi.fn(),
  insert: vi.fn(), list: vi.fn(), move: vi.fn(), rpc: vi.fn(), storage: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.user, getClaims: mocks.claims } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
import { POST as issue } from "./route";
import { POST as issueAlias } from "../files/upload-session/route";
import { POST as complete } from "./[id]/complete/route";
import { POST as completeAlias } from "../files/[id]/finalize/route";

const uploadId = "77000000-0000-4000-8000-000000000001";
const fileId = "77000000-0000-4000-8000-000000000002";
const declaration = { originalName: "synthetic.vcf", fileType: "vcf", sizeBytes: 8,
  sha256: "a".repeat(64), contentType: "application/octet-stream" };
function request(body: unknown = declaration) {
  return new Request("https://inherit.test/api/files/upload-session", { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("INHERIT_PAUSE_LEGACY_UPLOADS", "");
  mocks.user.mockResolvedValue({ data: { user: { id: "owner" } } });
  mocks.claims.mockResolvedValue({ data: { claims: { session_id: "session" } } });
  mocks.from.mockImplementation((table: string) => {
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(),
      insert: mocks.insert, single: vi.fn().mockResolvedValue({ data: { id: uploadId }, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: table === "subjects" ? { id: "subject" } : {
        account_id: "owner", auth_session_id: "session", staging_object_name: "source", expected_size: 8,
        status: "issued", expires_at: new Date(Date.now() + 60_000).toISOString(),
      } }),
    };
    mocks.insert.mockReturnValue(query);
    return query;
  });
  mocks.list.mockResolvedValue({ data: [{ name: "source", id: "object", metadata: { size: 8 } }], error: null });
  mocks.move.mockResolvedValue({ error: null });
  mocks.storage.mockReturnValue({ list: mocks.list, move: mocks.move });
  mocks.rpc.mockResolvedValue({ data: fileId, error: null });
  mocks.admin.mockReturnValue({ from: mocks.from, storage: { from: mocks.storage }, rpc: mocks.rpc });
});
afterEach(() => vi.unstubAllEnvs());

describe("legacy new-upload pause", () => {
  it.each(["", "false"])("preserves issuance when the pause is off (%j)", async value => {
    vi.stubEnv("INHERIT_PAUSE_LEGACY_UPLOADS", value);
    const response = await issue(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ uploadId, bucketName: "genomes-staging", tier: 1 });
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ account_id: "owner", auth_session_id: "session",
      subject_id: "subject", expected_size: 8, expected_sha256: declaration.sha256, status: "issued" }));
  });
  it.each([issue, issueAlias])("both issuance paths refuse before privileged or Storage access", async handler => {
    vi.stubEnv("INHERIT_PAUSE_LEGACY_UPLOADS", "true");
    const response = await handler(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ error: "uploads_paused" });
    expect(mocks.user).toHaveBeenCalledOnce();
    expect(mocks.claims).toHaveBeenCalledOnce();
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.storage).not.toHaveBeenCalled();
  });
  it("the server setting is authoritative even if the request asks to resume", async () => {
    vi.stubEnv("INHERIT_PAUSE_LEGACY_UPLOADS", "true");
    expect((await issue(request({ ...declaration, paused: false }))).status).toBe(503);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("pause does not substitute for authentication", async () => {
    vi.stubEnv("INHERIT_PAUSE_LEGACY_UPLOADS", "true");
    mocks.user.mockResolvedValue({ data: { user: null } });
    expect((await issue(request())).status).toBe(401);
    expect(mocks.admin).not.toHaveBeenCalled();
    mocks.user.mockResolvedValue({ data: { user: { id: "owner" } } });
    mocks.claims.mockResolvedValue({ data: { claims: {} } });
    expect((await issue(request())).status).toBe(401);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it.each([complete, completeAlias])("already-issued uploads retain completion while new issuance is paused", async handler => {
    vi.stubEnv("INHERIT_PAUSE_LEGACY_UPLOADS", "true");
    const response = await handler(request({ originalName: "synthetic.vcf", fileType: "vcf", tier: 1 }),
      { params: Promise.resolve({ id: uploadId }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ fileId });
    expect(mocks.move).toHaveBeenCalledWith("source", "source", { destinationBucket: "genomes" });
    expect(mocks.rpc).toHaveBeenCalledWith("complete_upload_session", { p_upload_session_id: uploadId,
      p_account_id: "owner", p_auth_session_id: "session", p_storage_object_id: "object",
      p_original_name: "synthetic.vcf", p_file_type: "vcf", p_tier: 1 });
  });
  it("an unauthenticated completion still fails while paused", async () => {
    vi.stubEnv("INHERIT_PAUSE_LEGACY_UPLOADS", "true");
    mocks.user.mockResolvedValue({ data: { user: null } });
    const response = await complete(request({ originalName: "synthetic.vcf", fileType: "vcf", tier: 1 }),
      { params: Promise.resolve({ id: uploadId }) });
    expect(response.status).toBe(401);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
});
