import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn(), pinned: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("node:http", () => ({ default: { request: mocks.request } }));
vi.mock("node:https", () => ({ default: { request: mocks.request } }));
import { allowedModelAddress, createPinnedModelFetch, modelRuntime, normalizeModelEndpoint, resolveModelEndpoint } from "./model-endpoint";

const localEnv = { INHERIT_DEPLOYMENT_KIND: "self-hosted-development", ALLOW_LOCAL_MODEL_ENDPOINTS: "1",
  INHERIT_LOCAL_MODEL_ORIGINS: '["http://localhost:3103"]', INHERIT_LOCAL_MODEL_HOST_ATTESTATION: "same-host-egress-isolated-v1" };
function provider(status = 200, all = false) {
  mocks.request.mockImplementation((_url, options, callback) => {
    const req = new EventEmitter() as EventEmitter & { end: () => void; destroy: (error?: Error) => void; setTimeout: () => void };
    req.destroy = error => { if (error) req.emit("error", error); req.emit("close"); };
    req.setTimeout = () => undefined;
    req.end = () => options.lookup("model.synthetic.invalid", { all }, (error: Error | null, addresses: unknown, family: unknown) => {
      mocks.pinned(addresses, family);
      if (error) { req.destroy(error); return; }
      const res = new EventEmitter() as EventEmitter & { statusCode: number; headers: object; destroy: () => void };
      res.statusCode = status; res.headers = status === 302 ? { location: "https://elsewhere.synthetic.invalid" } : { "content-type": "application/json" };
      res.destroy = () => undefined;
      callback(res);
      queueMicrotask(() => { res.emit("data", Buffer.from('{"ok":true}')); res.emit("end"); req.emit("close"); });
    });
    return req;
  });
}
beforeEach(() => { vi.clearAllMocks(); mocks.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]); provider(); });
afterEach(() => vi.unstubAllEnvs());

describe("model destination policy", () => {
  it("requires the complete attested local deployment, independently of optimized build mode", () => {
    expect(modelRuntime({ ...localEnv, NODE_ENV: "production" }).localAllowed).toBe(true);
    for (const env of [{ ...localEnv, VERCEL: "1" }, { ...localEnv, VERCEL_ENV: "preview" },
      { ...localEnv, INHERIT_DEPLOYMENT_KIND: "production" }, { ...localEnv, INHERIT_DEPLOYMENT_KIND: "preview" },
      { ...localEnv, INHERIT_LOCAL_MODEL_HOST_ATTESTATION: "" }, { ...localEnv, ALLOW_LOCAL_MODEL_ENDPOINTS: "0" }]) {
      expect(modelRuntime(env).localAllowed).toBe(false);
    }
  });
  it.each(["::ffff:127.0.0.1", "0:0:0:0:0:ffff:7f00:1", "2001:0db8::1", "2001:0010::1", "2001:0000::1", "3fff::1", "fe80::1", "fc00::1", "64:ff9b::1", "0.0.0.0", "100.64.0.1", "169.254.169.254", "192.168.1.1", "224.0.0.1"])("blocks reserved destination %s", address => {
    expect(allowedModelAddress(address, false)).toBe(false);
    expect(allowedModelAddress(address, true)).toBe(false);
  });
  it("allows only loopback locally and actual public unicast remotely", () => {
    expect(allowedModelAddress("::1", true)).toBe(true);
    expect(allowedModelAddress("127.0.0.1", true)).toBe(true);
    expect(allowedModelAddress("2606:4700:4700::1111", false)).toBe(true);
    expect(allowedModelAddress("8.8.8.8", false)).toBe(true);
  });
  it.each(["http://model.synthetic.invalid", "https://user:pass@model.synthetic.invalid", "https://model.synthetic.invalid/?secret=1", "https://model.synthetic.invalid/#x", "https://model.synthetic.invalid/a/../v1", "https://model.synthetic.invalid/%2fprivate"])("rejects ambiguous endpoint %s", value => {
    expect(() => normalizeModelEndpoint(value)).toThrow();
  });
  it("rejects a mixed public/private DNS answer", async () => {
    mocks.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 }]);
    await expect(resolveModelEndpoint(normalizeModelEndpoint("https://model.synthetic.invalid/v1"))).rejects.toThrow();
  });
  it("re-resolves at send after an earlier accepted lookup and refuses rebinding", async () => {
    const endpoint = normalizeModelEndpoint("https://model.synthetic.invalid/v1");
    await resolveModelEndpoint(endpoint);
    mocks.lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    await expect(createPinnedModelFetch(endpoint, async () => true)(`${endpoint.baseUrl}/chat/completions`, { method: "POST", body: "{}" })).rejects.toThrow();
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("pins the validated IP and checks authority inside the actual connection lookup", async () => {
    const endpoint = normalizeModelEndpoint("https://model.synthetic.invalid/v1");
    const authorize = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(createPinnedModelFetch(endpoint, authorize)(`${endpoint.baseUrl}/chat/completions`, { method: "POST", body: "{}" })).rejects.toThrow();
    expect(authorize).toHaveBeenCalledTimes(2);
  });
  it("never follows a model redirect or sends a second request", async () => {
    provider(302);
    const endpoint = normalizeModelEndpoint("https://model.synthetic.invalid/v1");
    await expect(createPinnedModelFetch(endpoint, async () => true)(`${endpoint.baseUrl}/chat/completions`, { method: "POST", body: "{}" })).rejects.toThrow();
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
  it("honors the Node all-address lookup callback while pinning just the validated address", async () => {
    provider(200, true);
    const endpoint = normalizeModelEndpoint("https://model.synthetic.invalid/v1");
    await createPinnedModelFetch(endpoint, async () => true)(`${endpoint.baseUrl}/chat/completions`, { method: "POST", body: "{}" });
    expect(mocks.pinned).toHaveBeenCalledWith([{ address: "8.8.8.8", family: 4 }], undefined);
  });
  it.each([204, 205])("handles a bodyless HTTP %i without an uncaught event-handler exception", async status => {
    provider(status);
    const endpoint = normalizeModelEndpoint("https://model.synthetic.invalid/v1");
    const response = await createPinnedModelFetch(endpoint, async () => true)(`${endpoint.baseUrl}/chat/completions`, { method: "POST", body: "{}" });
    expect(response.status).toBe(status); expect(await response.text()).toBe("");
  });
  it("accepts a bounded authorized response", async () => {
    const endpoint = normalizeModelEndpoint("https://model.synthetic.invalid/v1");
    const response = await createPinnedModelFetch(endpoint, async () => true)(`${endpoint.baseUrl}/chat/completions`, { method: "POST", body: "{}" });
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.lookup).toHaveBeenCalledTimes(1);
  });
});
