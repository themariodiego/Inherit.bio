import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), rpc: vi.fn(), resolve: vi.fn() }));
vi.mock("@/lib/uploads/own-upload-context", () => ({ currentOwnUploadAccount: mocks.actor,
  ownUploadJson: (body: unknown, status = 200) => Response.json(body, { status }) }));
vi.mock("./own-provider-authority", () => ({ ownCopilotRpc: mocks.rpc }));
vi.mock("./model-endpoint", () => ({ normalizeModelEndpoint: () => ({ baseUrl: "https://model.synthetic.invalid/v1", origin: "https://model.synthetic.invalid",
  providerClass: "cloud", runtimeAttestationFingerprint: "a".repeat(64) }), resolveModelEndpoint: mocks.resolve }));
import { saveOwnCopilotSettings, removeOwnCopilotSettings } from "./own-settings";
const body = { provider: "openai_compatible", base_url: "https://model.synthetic.invalid/v1", model: "synthetic-model", api_key: "synthetic-key-only" };
const request = (payload: unknown = body, method = "POST", sameOrigin = true) => new Request("http://localhost/api/llm/settings", { method,
  headers: sameOrigin ? { origin: "http://localhost", "sec-fetch-site": "same-origin", "content-type": "application/json" } : {},
  ...(method === "POST" ? { body: JSON.stringify(payload) } : {}) });
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("BYOK_ENCRYPTION_KEY", Buffer.alloc(32, 23).toString("base64"));
  mocks.actor.mockResolvedValue({ accountId: "owner", sessionId: "session" }); mocks.resolve.mockResolvedValue({ address: "8.8.8.8", family: 4 });
  mocks.rpc.mockResolvedValue({ data: { saved: true, settingsRevision: 2 }, error: null });
});
afterEach(() => vi.unstubAllEnvs());
it("saves configuration and encrypted credential in one RPC without granting permission", async () => {
  expect((await saveOwnCopilotSettings(request())).status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  const [name, args] = mocks.rpc.mock.calls[0];
  expect(name).toBe("save_own_copilot_settings_v1");
  expect(args.p_account_id).toBe("owner"); expect(args.p_session_id).toBe("session");
  expect(args.p_encrypted_key).toMatch(/^\\x[0-9a-f]+$/); expect(args.p_encrypted_key).not.toContain(body.api_key);
  expect(args.p_key_fingerprint).toMatch(/^[0-9a-f]{64}$/);
});
it("does no database write after destination validation fails", async () => {
  mocks.resolve.mockRejectedValue(new Error("synthetic DNS refusal"));
  expect((await saveOwnCopilotSettings(request())).status).toBe(422); expect(mocks.rpc).not.toHaveBeenCalled();
});
it("refuses cross-origin saves before account or database access", async () => {
  expect((await saveOwnCopilotSettings(request(body, "POST", false))).status).toBe(403);
  expect(mocks.actor).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
});
it("refuses unauthenticated settings writes", async () => {
  mocks.actor.mockResolvedValue(null); expect((await saveOwnCopilotSettings(request())).status).toBe(401); expect(mocks.rpc).not.toHaveBeenCalled();
});
it("rejects client-controlled recipient configuration", async () => {
  expect((await saveOwnCopilotSettings(request({ ...body, recipientRevision: 999 }))).status).toBe(422); expect(mocks.rpc).not.toHaveBeenCalled();
});
it("returns only the useful key requirement on a destination change", async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { message: "key_required" } });
  const response = await saveOwnCopilotSettings(request()); expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: "key_required" });
});
it("removes settings and keys through the same atomic server operation", async () => {
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  expect(await (await removeOwnCopilotSettings(request(null, "DELETE"))).json()).toEqual({ deleted: true });
  expect(mocks.rpc).toHaveBeenCalledWith("remove_own_copilot_settings_v1", { p_account_id: "owner", p_session_id: "session" });
});
it("does not claim removal succeeded after a database error", async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { message: "private detail" } });
  const response = await removeOwnCopilotSettings(request(null, "DELETE")); expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "unavailable" });
});
