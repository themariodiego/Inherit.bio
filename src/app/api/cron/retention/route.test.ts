import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({ retention: vi.fn() }));
vi.mock("@/app/api/jobs/retention/route", () => ({ POST: mocks.retention }));

const URL = "http://localhost/api/cron/retention";
function request(headers: Record<string, string> = {}, suffix = "") {
  return new Request(`${URL}${suffix}`, { headers: { authorization: "Bearer cron-test-secret", ...headers } });
}

describe("retention cron transport", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "cron-test-secret");
    vi.stubEnv("JOBS_SECRET", "operator-test-secret");
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });

  it.each([undefined, "Bearer wrong-secret", "Bearer operator-test-secret", "bearer cron-test-secret", "Bearer cron-test-secret-extra"])(
    "refuses absent or non-cron credentials before delegation (%s)", async authorization => {
      const response = await GET(new Request(`${URL}?target=private`, {
        headers: authorization ? { authorization } : {},
      }));
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "unauthenticated" });
      expect(mocks.retention).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, ""])("refuses an unconfigured cron secret (%s)", async secret => {
    vi.stubEnv("CRON_SECRET", secret);
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
    expect(mocks.retention).not.toHaveBeenCalled();
  });

  it.each<Record<string, string>>([{}, { "content-length": "0" }])("delegates exactly one fresh authorized bodyless POST (%j)", async headers => {
    const result = Response.json({ processed: 1, failed: 0, pending: 0, expiredInvitations: 0 });
    mocks.retention.mockResolvedValue(result);
    const response = await GET(request({ ...headers, cookie: "unrelated=private", "x-target-id": "ignored" }));
    expect(response).toBe(result);
    expect(mocks.retention).toHaveBeenCalledTimes(1);
    const delegated = mocks.retention.mock.calls[0][0] as Request;
    expect(delegated.url).toBe("http://localhost/api/jobs/retention");
    expect(delegated.method).toBe("POST");
    expect(delegated.body).toBeNull();
    expect([...delegated.headers]).toEqual([["authorization", "Bearer cron-test-secret"]]);
  });

  it.each(["?targetId=x", "?limit=1", "?targetId=", "#target"])("refuses selector-bearing URLs (%s)", async suffix => {
    const response = await GET(request({}, suffix));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(mocks.retention).not.toHaveBeenCalled();
  });

  it.each<Record<string, string>>([
    { "transfer-encoding": "chunked" }, { "content-length": "1" },
    { "content-length": "-1" }, { "content-length": "invalid" },
  ])("refuses body selectors before delegation (%j)", async headers => {
    const response = await GET(request(headers));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(mocks.retention).not.toHaveBeenCalled();
  });

  it("refuses an adapter-supplied stream without trusting Content-Length", async () => {
    const incoming = request({ "content-length": "0" });
    Object.defineProperty(incoming, "body", { value: new ReadableStream() });
    const response = await GET(incoming);
    expect(response.status).toBe(400);
    expect(mocks.retention).not.toHaveBeenCalled();
  });

  it("refuses Next's automatic HEAD delegation without running retention", async () => {
    const response = await GET(new Request(URL, { method: "HEAD", headers: { authorization: "Bearer cron-test-secret" } }));
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
    expect(mocks.retention).not.toHaveBeenCalled();
  });

  it("preserves a delegated failure response exactly", async () => {
    const failure = Response.json({ error: "retention_worker_unavailable" }, { status: 503, headers: { "retry-after": "60" } });
    mocks.retention.mockResolvedValue(failure);
    const response = await GET(request());
    expect(response).toBe(failure);
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(await response.json()).toEqual({ error: "retention_worker_unavailable" });
    expect(mocks.retention).toHaveBeenCalledTimes(1);
  });

  it("returns a closed failure when delegation throws without exposing details", async () => {
    mocks.retention.mockRejectedValue(new Error("private provider details"));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "retention_worker_unavailable" });
    expect(mocks.retention).toHaveBeenCalledTimes(1);
  });

  it("registers the separate GET adapter against the existing POST worker authority", () => {
    const register = JSON.parse(readFileSync("docs/route-register.json", "utf8"));
    const adapter = register.routes.find((route: { id: string }) => route.id === "jobs.retention-cron");
    expect(adapter).toMatchObject({ path: "/api/cron/retention", methods: ["GET"],
      requestContract: { body: "forbidden", query: "forbidden" },
      methodPolicies: { GET: { authAllOf: ["cron-secret"] } },
      policy: { workerBinding: "workerExecutionBindings.jobs.retention", adapterFor: "jobs.retention" } });
    expect(register.routes.find((route: { id: string }) => route.id === "jobs.retention").methods).toEqual(["POST"]);
    expect(register.machineAuthBindings[adapter.id]).toBe("machine-api-v1");
  });
});
