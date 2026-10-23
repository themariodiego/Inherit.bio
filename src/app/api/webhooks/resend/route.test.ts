import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `POST /api/webhooks/resend` (register webhooks.resend), held to what the
 * register now says it does (owner decision of 23 October 2026, G8.5,
 * "webhooks.resend: register what it does"): the auth contract
 * `resend-webhook-signature-v1`, the success contract
 * `provider-webhook-acknowledgement-v1` and `provider-webhook-unavailable-v1`.
 *
 * Every delivery here is signed for real, the way Resend signs it through
 * Svix (Standard Webhooks v1: HMAC-SHA256 over `id.timestamp.body` under the
 * base64 secret after `whsec_`), and verified by the real Resend SDK. The
 * secret and every id are synthetic. Only the database door is mocked.
 */
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));

const { POST } = await import("./route");
const { hmacSecret } = await import("@/lib/crypto");

const SECRET = `whsec_${Buffer.alloc(32, 41).toString("base64")}`;
const OTHER_SECRET = `whsec_${Buffer.alloc(32, 42).toString("base64")}`;
const EMAIL_ID = "4ef9a417-02e9-4d39-ad75-9611e0fcc33c";

const register = JSON.parse(readFileSync("docs/route-register.json", "utf8")) as {
  routes: { id: string; auth?: string; successResponseContract?: string }[];
  contractDefaults: Record<string, string>;
  authContracts: Record<string, Record<string, unknown>>;
  responseContracts: Record<string, Record<string, unknown>>;
  responseContractBindings: { routes: Record<string, string[]> };
};

function sign(body: string, secret = SECRET, timestamp = Math.floor(Date.now() / 1000), id = "msg_synthetic_1") {
  const key = Buffer.from(secret.slice("whsec_".length), "base64");
  const signature = crypto.createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
  return { "svix-id": id, "svix-timestamp": String(timestamp), "svix-signature": `v1,${signature}` };
}

const event = (type: string, data: Record<string, unknown> = { email_id: EMAIL_ID }) =>
  JSON.stringify({ type, created_at: "2026-10-23T10:00:00.000Z", data });

function deliver(body: string, headers: Record<string, string> = sign(body)) {
  return POST(new Request("https://inherit.test/api/webhooks/resend", {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body,
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("RESEND_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("RESEND_API_KEY", "synthetic-not-a-provider-key");
  vi.stubEnv("BYOK_ENCRYPTION_KEY", Buffer.alloc(32, 9).toString("base64"));
  mocks.rpc.mockResolvedValue({ data: true, error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("the register describes webhooks.resend (G8.5)", () => {
  const entry = register.routes.find(route => route.id === "webhooks.resend")!;

  it("binds the route's auth mode to a defined signature contract", () => {
    expect(entry.auth).toBe("resend-standard-webhook-signature");
    expect(register.contractDefaults["endpoint:resend-standard-webhook-signature"]).toBe("authContracts.resend-webhook-signature-v1");
    const contract = register.authContracts["resend-webhook-signature-v1"];
    expect(Object.keys(contract.headers as object)).toEqual(["svix-id", "svix-timestamp", "svix-signature"]);
    expect(contract.missingInvalidStaleOrUnmatchedSignature).toMatchObject({ status: 401, body: { const: "Invalid signature" } });
  });

  it("names a defined success contract and binds it with the unavailable answer", () => {
    expect(entry.successResponseContract).toBe("provider-webhook-acknowledgement-v1");
    expect(register.responseContractBindings.routes["webhooks.resend"])
      .toEqual(["provider-webhook-acknowledgement-v1", "provider-webhook-unavailable-v1"]);
    const success = register.responseContracts["provider-webhook-acknowledgement-v1"];
    expect([success.matched, success.notRecorded, success.unmatched].map(branch => (branch as { status: number }).status))
      .toEqual([204, 204, 202]);
    expect(register.responseContracts["provider-webhook-unavailable-v1"]).toMatchObject({ status: 503, body: { const: "Webhook unavailable" } });
  });
});

describe("POST /api/webhooks/resend answers what its register entry says", () => {
  const success = register.responseContracts["provider-webhook-acknowledgement-v1"] as Record<string, { status: number }> & {
    recordedEventTypes: Record<string, string>;
  };
  const refusal = register.authContracts["resend-webhook-signature-v1"].missingInvalidStaleOrUnmatchedSignature as {
    status: number; contentType: string; body: { const: string };
  };
  const unavailable = register.responseContracts["provider-webhook-unavailable-v1"] as {
    status: number; contentType: string; body: { const: string };
  };

  it("records a matched event of every recorded type and answers the empty matched acknowledgement", async () => {
    for (const [type, status] of Object.entries(success.recordedEventTypes)) {
      mocks.rpc.mockClear();
      const body = event(type);
      const response = await deliver(body);
      expect(response.status, type).toBe(success.matched.status);
      expect(await response.text()).toBe("");
      expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("record_resend_mail_event", {
        p_provider_message_id_hmac: hmacSecret(EMAIL_ID, "resend-message-id-v1"),
        p_provider_event_hmac: hmacSecret(body, "resend-webhook-event-v1"),
        p_status: status,
        p_occurred_at: "2026-10-23T10:00:00.000Z",
      });
    }
  });

  it("answers the unmatched acknowledgement when no recorded attempt matches", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    const response = await deliver(event("email.delivered"));
    expect(response.status).toBe(success.unmatched.status);
    expect(await response.text()).toBe("");
  });

  it("acknowledges an event type it does not record, and one without an email id, with nothing read or written", async () => {
    for (const body of [event("email.opened"), event("contact.created"), event("email.delivered", {})]) {
      const response = await deliver(body);
      expect(response.status).toBe(success.notRecorded.status);
      expect(await response.text()).toBe("");
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuses a missing, wrong, stale, early or tampered signature with 401 and writes nothing", async () => {
    const body = event("email.delivered");
    const now = Math.floor(Date.now() / 1000);
    const cases: Record<string, string>[] = [
      {},
      { ...sign(body), "svix-signature": "" },
      { ...sign(body), "svix-id": "" },
      sign(body, OTHER_SECRET),
      sign(body, SECRET, now - 301),
      sign(body, SECRET, now + 301),
      { ...sign(body), "svix-signature": sign(body)["svix-signature"].replace("v1,", "v2,") },
    ];
    for (const headers of cases) {
      const response = await deliver(body, headers);
      expect(response.status).toBe(refusal.status);
      expect(response.headers.get("content-type")).toBe(refusal.contentType);
      expect(await response.text()).toBe(refusal.body.const);
    }
    // A body changed after signing: the signature no longer matches.
    const response = await deliver(event("email.bounced"), sign(body));
    expect(response.status).toBe(refusal.status);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("accepts a signature inside the 300-second skew either way, and any one matching signature in the list", async () => {
    const body = event("email.delivered");
    const now = Math.floor(Date.now() / 1000);
    for (const headers of [sign(body, SECRET, now - 290), sign(body, SECRET, now + 290),
      { ...sign(body), "svix-signature": `${sign(body, OTHER_SECRET)["svix-signature"]} ${sign(body)["svix-signature"]}` }]) {
      expect((await deliver(body, headers)).status).toBe(success.matched.status);
    }
  });

  it("refuses every delivery as unsigned while the SDK client cannot be built, as the register says", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const response = await deliver(event("email.delivered"));
    expect(response.status).toBe(refusal.status);
    expect(await response.text()).toBe(refusal.body.const);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(register.authContracts["resend-webhook-signature-v1"].verifierConstruction).toMatch(/RESEND_API_KEY/);
  });

  it("refuses a signed body that is not JSON the same way", async () => {
    const response = await deliver("not json", sign("not json"));
    expect(response.status).toBe(refusal.status);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("answers 503 before reading the body when no signing secret is configured", async () => {
    vi.stubEnv("RESEND_WEBHOOK_SECRET", "");
    const body = event("email.delivered");
    const request = new Request("https://inherit.test/api/webhooks/resend", { method: "POST", headers: sign(body), body });
    const response = await POST(request);
    expect(response.status).toBe(unavailable.status);
    expect(response.headers.get("content-type")).toBe(unavailable.contentType);
    expect(await response.text()).toBe(unavailable.body.const);
    expect(request.bodyUsed).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("answers 503 with no detail when the delivery-state write fails", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "synthetic private detail" } });
    const response = await deliver(event("email.delivered"));
    expect(response.status).toBe(unavailable.status);
    expect(await response.text()).toBe(unavailable.body.const);
  });

  it("answers only statuses the register lets the route answer", async () => {
    const registered = new Set([success.matched.status, success.notRecorded.status, success.unmatched.status, refusal.status, unavailable.status]);
    const answered = new Set<number>();
    answered.add((await deliver(event("email.delivered"))).status);
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    answered.add((await deliver(event("email.delivered"))).status);
    answered.add((await deliver(event("email.opened"))).status);
    answered.add((await deliver(event("email.delivered"), {})).status);
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "synthetic" } });
    answered.add((await deliver(event("email.delivered"))).status);
    vi.stubEnv("RESEND_WEBHOOK_SECRET", "");
    answered.add((await deliver(event("email.delivered"))).status);
    expect([...answered].sort()).toEqual([...registered].sort());
  });
});
