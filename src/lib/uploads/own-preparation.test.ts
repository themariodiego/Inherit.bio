import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ rpc: vi.fn(), actor: vi.fn() }));
vi.mock("../supabase/admin", () => ({ createAdminClient: () => ({ rpc: state.rpc }) }));
vi.mock("./own-upload-context", () => ({ currentOwnUploadAccount: state.actor,
  ownUploadJson: (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } }) }));
import { prepareOwnWgsFile } from "./own-preparation";
const fileId = "11111111-1111-4111-8111-111111111111", jobId = "22222222-2222-4222-8222-222222222222";
const file = { id: fileId, file_type: "vcf", single_logical_sample_verified_at: "2026-09-08T00:00:00Z" };
const request = () => new Request(`https://inherit.example/api/files/${fileId}/process`, { method: "POST", headers: { origin: "https://inherit.example", "sec-fetch-site": "same-origin" } });
const status = (value: string, id: string | null = jobId) => ({ data: { version: "own-preparation-status-v1", fileId, jobId: id, status: value }, error: null });
beforeEach(() => { vi.stubEnv("INHERIT_PREPARED_WGS_ENABLED", "true"); state.rpc.mockReset(); state.actor.mockReset().mockResolvedValue({ accountId: "owner", sessionId: "session" }); });
afterEach(() => vi.unstubAllEnvs());
describe("own WGS quick process dispatch", () => {
  it.each(["false", "", "TRUE"])("preserves existing path when explicit flag is %s", async flag => {
    vi.stubEnv("INHERIT_PREPARED_WGS_ENABLED", flag); expect(await prepareOwnWgsFile(request(), file)).toBeNull(); expect(state.actor).not.toHaveBeenCalled();
  });
  it("does not redirect arrays or historical unverified files", async () => {
    expect(await prepareOwnWgsFile(request(), { ...file, file_type: "array_23andme" })).toBeNull();
    expect(await prepareOwnWgsFile(request(), { ...file, single_logical_sample_verified_at: null })).toBeNull();
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("enqueues only after checked current source status and returns202 without reports", async () => {
    state.rpc.mockResolvedValueOnce(status("not_requested", null)).mockResolvedValueOnce({ data: {
      version: "own-preparation-job-v1", jobId, fileId, state: "queued", jobDeadline: new Date(Date.now() + 900_000).toISOString(),
    }, error: null });
    const response = await prepareOwnWgsFile(request(), file);
    expect(response?.status).toBe(202); expect(await response?.json()).toEqual({ fileId, jobId, status: "preparing", analysisState: "not_generated" });
    expect(state.rpc.mock.calls.map(([name]) => name)).toEqual(["own_preparation_status_v1", "enqueue_own_preparation_v1"]);
  });
  it("polling a queued job never enqueues or claims again", async () => {
    state.rpc.mockResolvedValueOnce(status("preparing")); expect((await prepareOwnWgsFile(request(), file))?.status).toBe(202); expect(state.rpc).toHaveBeenCalledTimes(1);
  });
  it("exposes prepared only from current full-source SQL status", async () => {
    state.rpc.mockResolvedValueOnce(status("prepared")); const response = await prepareOwnWgsFile(request(), file);
    expect(await response?.json()).toEqual({ fileId, status: "normalization_complete", analysisState: "not_generated" });
  });
  it("preserves genuine completed DB backend path", async () => {
    state.rpc.mockResolvedValueOnce(status("not_applicable", null)); expect(await prepareOwnWgsFile(request(), file)).toBeNull();
  });
  it.each(["42501", "55000"])("SQL refusal%s never falls back to DB normalization", async code => {
    state.rpc.mockResolvedValueOnce({ data: null, error: { code, message: "private diagnostic" } }); const response = await prepareOwnWgsFile(request(), file);
    expect(response?.status).toBe(code === "42501" ? 404 : 503); expect(JSON.stringify(await response?.json())).not.toContain("private");
  });
  it("refuses cross-source receipts", async () => {
    const result = status("prepared"); result.data.fileId = jobId; state.rpc.mockResolvedValueOnce(result);
    expect((await prepareOwnWgsFile(request(), file))?.status).toBe(503);
  });
  it("refuses cross-origin before account or SQL work", async () => {
    const req = request(); req.headers.set("origin", "https://other.example"); expect((await prepareOwnWgsFile(req, file))?.status).toBe(400); expect(state.actor).not.toHaveBeenCalled();
  });
  it("withholds frozen preparation and does not claim success", async () => {
    state.rpc.mockResolvedValueOnce(status("failed")); expect((await prepareOwnWgsFile(request(), file))?.status).toBe(503);
  });
});
