import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), rpc: vi.fn(), resolve: vi.fn(), normalize: vi.fn() }));
vi.mock("@/lib/uploads/own-upload-context", () => ({ currentOwnUploadAccount: mocks.actor,
  ownUploadJson: (body: unknown, status = 200) => Response.json(body, { status }) }));
vi.mock("./own-provider-authority", () => ({ ownCopilotRpc: mocks.rpc }));
vi.mock("./model-endpoint", () => ({ normalizeModelEndpoint: mocks.normalize, resolveModelEndpoint: mocks.resolve }));
import { saveOwnCopilotSettings, removeOwnCopilotSettings } from "./own-settings";
import { mintPersonOperationNonce } from "@/lib/person-operation-nonce";
import { hashOperationNonce } from "@/lib/account-deletion";
import { ANTHROPIC_MODELS } from "@/lib/llm";

/**
 * api.llm-settings on the register's bodies and llm-settings-v1 answers
 * (owner decision of 23 October 2026, G8.5). Every value is synthetic.
 */
const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const HOSTED_MODEL = ANTHROPIC_MODELS[0];
const CLOUD = { baseUrl: "https://model.synthetic.invalid/v1", origin: "https://model.synthetic.invalid",
  providerClass: "cloud", runtimeAttestationFingerprint: "a".repeat(64) };
const LOCAL = { baseUrl: "http://127.0.0.1:11434/v1", origin: "http://127.0.0.1:11434",
  providerClass: "local", runtimeAttestationFingerprint: "b".repeat(64) };
const body = { mode: "remote-openai-compatible", provider: "openai-compatible", model: "synthetic-model",
  baseUrl: "https://model.synthetic.invalid/v1", apiKey: "synthetic-key-only" };
const request = (payload: unknown = body, method = "POST", sameOrigin = true, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/llm/settings", { method,
    headers: { ...(sameOrigin ? { origin: "http://localhost", "sec-fetch-site": "same-origin", "content-type": "application/json" } : {}), ...headers },
    ...(method === "POST" || payload !== null ? { body: JSON.stringify(payload) } : {}) });
const nonce = (overrides: Partial<{ accountId: string; sessionId: string; targetId: string }> = {}) =>
  mintPersonOperationNonce({ accountId: OWNER, sessionId: SESSION, operation: "provider_setting_delete", targetId: OWNER, ...overrides });
const remove = (code: string | null = nonce(), payload: unknown = null) =>
  removeOwnCopilotSettings(request(payload, "DELETE", true, code === null ? {} : { "x-inherit-operation-nonce": code }));

beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("BYOK_ENCRYPTION_KEY", Buffer.alloc(32, 23).toString("base64"));
  mocks.actor.mockResolvedValue({ accountId: OWNER, sessionId: SESSION }); mocks.resolve.mockResolvedValue({ address: "8.8.8.8", family: 4 });
  mocks.normalize.mockReturnValue(CLOUD);
  mocks.rpc.mockResolvedValue({ data: { saved: true, settingsRevision: 2 }, error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/llm/settings", () => {
  it("saves configuration and encrypted credential in one RPC without granting permission", async () => {
    expect((await saveOwnCopilotSettings(request())).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    const [name, args] = mocks.rpc.mock.calls[0];
    expect(name).toBe("save_own_copilot_settings_v1");
    expect(args.p_account_id).toBe(OWNER); expect(args.p_session_id).toBe(SESSION);
    expect(args.p_encrypted_key).toMatch(/^\\x[0-9a-f]+$/); expect(args.p_encrypted_key).not.toContain(body.apiKey);
    expect(args.p_key_fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("stores exactly what the former body stored: the same provider, address, label and classification", async () => {
    await saveOwnCopilotSettings(request());
    expect(mocks.rpc.mock.calls[0][1].p_settings).toEqual({ provider: "openai_compatible", baseUrl: CLOUD.baseUrl, model: "synthetic-model",
      origin: CLOUD.origin, providerLabel: "model.synthetic.invalid", providerClass: "cloud", runtimeAttestationFingerprint: CLOUD.runtimeAttestationFingerprint });
    expect(mocks.normalize).toHaveBeenCalledWith(body.baseUrl);
  });

  it("answers llm-settings-v1: the server-normalized provider, origin and classification, and never the key", async () => {
    const response = await saveOwnCopilotSettings(request());
    const answer = await response.json();
    expect(answer).toEqual({ status: "saved", provider: "model.synthetic.invalid", endpointOrigin: CLOUD.origin, classification: "cloud" });
    expect(JSON.stringify(answer)).not.toContain(body.apiKey);
  });

  it("maps the hosted body to the stored anthropic provider and its fixed address", async () => {
    const hosted = { mode: "hosted", provider: "anthropic", model: HOSTED_MODEL, apiKey: "synthetic-hosted-key" };
    mocks.normalize.mockReturnValue({ ...CLOUD, baseUrl: "https://api.anthropic.com/v1", origin: "https://api.anthropic.com" });
    const response = await saveOwnCopilotSettings(request(hosted));
    expect(await response.json()).toEqual({ status: "saved", provider: "anthropic", endpointOrigin: "https://api.anthropic.com", classification: "cloud" });
    expect(mocks.normalize).toHaveBeenCalledWith("https://api.anthropic.com/v1");
    expect(mocks.rpc.mock.calls[0][1].p_settings).toMatchObject({ provider: "anthropic", providerLabel: "Anthropic", model: HOSTED_MODEL });
  });

  it("accepts the same-host-local body only where the server classifies the address as local", async () => {
    const local = { mode: "same-host-local", provider: "openai-compatible-local", model: "synthetic-local", baseUrl: LOCAL.baseUrl };
    mocks.normalize.mockReturnValue(LOCAL);
    const response = await saveOwnCopilotSettings(request(local));
    expect(await response.json()).toEqual({ status: "saved", provider: "127.0.0.1:11434", endpointOrigin: LOCAL.origin, classification: "local" });
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_encrypted_key: null, p_key_last4: null });
    // A remote body for a local address, and a local body for a cloud address, are refused before any write.
    mocks.rpc.mockClear();
    expect((await saveOwnCopilotSettings(request({ ...body, baseUrl: "https://127.0.0.1:11434/v1" }))).status).toBe(422);
    mocks.normalize.mockReturnValue(CLOUD);
    expect((await saveOwnCopilotSettings(request({ ...local, baseUrl: CLOUD.baseUrl }))).status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("keeps the stored key when no key is sent, as before", async () => {
    const withoutKey: Record<string, unknown> = { ...body };
    delete withoutKey.apiKey;
    expect((await saveOwnCopilotSettings(request(withoutKey))).status).toBe(200);
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_encrypted_key: null, p_key_last4: null });
  });

  it("refuses the former body and every body the register does not declare, before any write", async () => {
    for (const payload of [
      { provider: "openai_compatible", base_url: body.baseUrl, model: "synthetic-model", api_key: "synthetic-key-only" },
      { ...body, mode: "cloud" },
      { ...body, provider: "openai_compatible" },
      { ...body, baseUrl: "http://model.synthetic.invalid/v1" },
      { mode: "hosted", provider: "anthropic", model: HOSTED_MODEL, baseUrl: body.baseUrl },
      { mode: "hosted", provider: "anthropic", model: "not-an-allowlisted-model" },
      { ...body, api_key: "synthetic-key-only" },
      { ...body, apiKey: "abc" },
    ]) {
      expect((await saveOwnCopilotSettings(request(payload))).status).toBe(422);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
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
});

describe("DELETE /api/llm/settings", () => {
  it("removes settings and keys through the door that consumes the page's nonce, and answers llm-settings-v1", async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    const code = nonce();
    const response = await remove(code);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "deleted" });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("remove_own_copilot_settings_with_nonce_v1", { p_account_id: OWNER, p_session_id: SESSION,
      p_nonce_hash: hashOperationNonce(code), p_nonce_expires_at: expect.any(String) });
  });

  it("refuses a removal without the nonce for this account and session, before any write", async () => {
    for (const code of [null, "not-a-nonce", nonce({ accountId: OTHER }), nonce({ sessionId: OTHER }), nonce({ targetId: OTHER }),
      mintPersonOperationNonce({ accountId: OWNER, sessionId: SESSION, operation: "consent_revoke", targetId: OWNER })]) {
      const response = await remove(code);
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: "invalid_request" });
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuses a removal that carries a body, which the register forbids", async () => {
    expect((await remove(nonce(), { all: true })).status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("answers a replayed nonce as an invalid request", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "invalid_operation_nonce" } });
    expect((await remove()).status).toBe(422);
  });

  it("refuses cross-origin and unauthenticated removals before any write", async () => {
    expect((await removeOwnCopilotSettings(request(null, "DELETE", false, { "x-inherit-operation-nonce": nonce() }))).status).toBe(403);
    mocks.actor.mockResolvedValue(null);
    expect((await remove()).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("does not claim removal succeeded after a database error", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "private detail" } });
    const response = await remove(); expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "unavailable" });
  });
});
