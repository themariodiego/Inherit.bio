import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaimantExportDependencies } from "./claimant-export-http";
vi.stubEnv("BYOK_ENCRYPTION_KEY", Buffer.alloc(32, 52).toString("base64"));
const { postClaimantExport, pollClaimantExport, presentClaimantExportCreate, claimantExportCookieHash, claimantExportCsrfBinding }
  = await import("./claimant-export-http");
const { mintExportOperation } = await import("./export-operation-token");
const { claimantCsrf } = await import("@/lib/future-person/rights");
const { RIGHTS_COOKIE_NAME, rightsSessionHash } = await import("@/lib/embryos/rights-session");
afterAll(() => vi.unstubAllEnvs());

/** Test doubles only: no database, no provider. */
const id = (n: number) => `87000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PRINCIPAL = id(1), SUBJECT = id(2), EXPORT = id(3), DOWNLOAD = id(4);
const secret = Buffer.alloc(32, 9).toString("base64url"), session = rightsSessionHash(secret);
const exportSecret = Buffer.alloc(32, 11).toString("base64url");
const capture = { principalId: PRINCIPAL, principalHash: "a".repeat(64), originBinding: "b".repeat(64), authorityReceipt: "c".repeat(64),
  lifecycleRevision: 3, principalGraphRevision: 1, subjectPartitions: [SUBJECT], fileCount: 1 };
const base = { routeId: "api.future-person-export" as const, origin: "independent-rights" as const, principalId: PRINCIPAL,
  targetKind: "subject" as const, targetId: SUBJECT, exportContract: "approved-future-person-export-v1" as const,
  originBinding: capture.originBinding, authorityReceipt: capture.authorityReceipt };
const createNonce = () => mintExportOperation({ ...base, csrfBinding: claimantExportCsrfBinding(session, "create"), operation: "create" }).token;
const openNonce = () => mintExportOperation({ ...base, csrfBinding: claimantExportCsrfBinding(session, "open-ready"), operation: "open-ready",
  exportId: EXPORT, exportRevision: 1 }).token;
const readyRow = { exportId: EXPORT, exportRevision: 1, sizeBytes: 1000, sha256: "d".repeat(64),
  expiresAt: new Date(Date.now() + 20 * 3_600_000).toISOString(), segmentCount: 1, pageCount: 1, authorityReceipt: capture.authorityReceipt };
type Call = [string, ...unknown[]];
let calls: Call[];
let state: { status: string; errors: Record<string, string | undefined> };
function deps(overrides: Partial<ClaimantExportDependencies> = {}): ClaimantExportDependencies {
  const result = (name: string, data: unknown) => Promise.resolve(state.errors[name]
    ? { data: null, error: { code: state.errors[name] } } : { data, error: null });
  return {
    open: () => true,
    rpc: () => ({
      request: (operation, sessionHash, payload, csrf) => { calls.push([operation, sessionHash, payload, csrf]);
        return result(operation, operation === "capture" ? capture : operation === "create"
          ? { exportId: EXPORT, exportRevision: 1, status: "queued", authorityReceipt: capture.authorityReceipt }
          : { exportId: EXPORT, exportRevision: 1, status: state.status, expiresAt: null }); },
      ready: (sessionHash, payload) => { calls.push(["ready", sessionHash, payload]); return result("ready", readyRow); },
      open: (sessionHash, payload, csrf) => { calls.push(["open", sessionHash, payload, csrf]); return result("open", {
        downloadSessionId: DOWNLOAD, expiresAt: new Date(Date.now() + 3_000_000).toISOString(), chunkBytes: 4_000_000,
        sizeBytes: 1000, sha256: "d".repeat(64) }); },
    }),
    generation: { assertReady: async () => undefined },
    delivery: { assertReady: async () => undefined },
    ...overrides,
  };
}
const url = "https://test.e2e.local/api/future-person/claim/session/export";
function post(body: unknown, headers: Record<string, string> = {}, withExportCookie = false) {
  return new Request(url, { method: "POST", body: JSON.stringify(body), headers: { origin: "https://test.e2e.local",
    "sec-fetch-site": "same-origin", "content-type": "application/json", "x-inherit-csrf": claimantCsrf(session),
    cookie: `${RIGHTS_COOKIE_NAME}=${secret}${withExportCookie ? `; __Host-inherit-export=${EXPORT}.${exportSecret}` : ""}`, ...headers } });
}
function get(cookie = `${RIGHTS_COOKIE_NAME}=${secret}; __Host-inherit-export=${EXPORT}.${exportSecret}`, target = url) {
  return new Request(target, { headers: { cookie } });
}
beforeEach(() => { calls = []; state = { status: "queued", errors: {} }; });

describe("POST create", () => {
  it("enqueues once under the live capture and sets only a hash-bound export cookie", async () => {
    const response = await postClaimantExport(post({ operation: "create", nonce: createNonce() }), deps());
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "preparing", exportId: EXPORT });
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(new RegExp(`^__Host-inherit-export=${EXPORT}\\.[A-Za-z0-9_-]{43}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=86400$`, "u"));
    expect(calls.map(call => call[0])).toEqual(["capture", "create"]);
    const [, , payload, csrf] = calls[1]!;
    const value = cookie.split(";")[0]!.split(".")[1]!;
    expect(payload).toMatchObject({ exportCookieHash: claimantExportCookieHash(value, session) });
    expect(JSON.stringify(payload)).not.toContain(value);
    expect(csrf).toBe(claimantExportCsrfBinding(session, "create"));
  });
  it("answers 503 before any write while no generation capability exists", async () => {
    const response = await postClaimantExport(post({ operation: "create", nonce: createNonce() }), deps({ generation: null }));
    expect(response.status).toBe(503);
    expect(calls.map(call => call[0])).toEqual(["capture"]);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
  it("is the one opaque 404 for every missing, invalid, stale or foreign input", async () => {
    const cases: [string, Request, Partial<ClaimantExportDependencies>?, (() => void)?][] = [
      ["closed", post({ operation: "create", nonce: createNonce() }), { open: () => false }],
      ["no rights cookie", post({ operation: "create", nonce: createNonce() }, { cookie: "" })],
      ["missing CSRF", post({ operation: "create", nonce: createNonce() }, { "x-inherit-csrf": "" })],
      ["foreign CSRF", post({ operation: "create", nonce: createNonce() }, { "x-inherit-csrf": claimantCsrf("e".repeat(64)) })],
      ["cross-site", post({ operation: "create", nonce: createNonce() }, { "sec-fetch-site": "cross-site" })],
      ["cross-origin", post({ operation: "create", nonce: createNonce() }, { origin: "https://other.example" })],
      ["text", post({ operation: "create", nonce: createNonce() }, { "content-type": "text/plain" })],
      ["unknown field", post({ operation: "create", nonce: createNonce(), subjectId: SUBJECT })],
      ["unknown operation", post({ operation: "delete", nonce: createNonce() })],
      ["open-ready nonce for create", post({ operation: "create", nonce: openNonce() })],
      ["nonce for another target", post({ operation: "create", nonce: mintExportOperation({ ...base, targetId: id(9),
        csrfBinding: claimantExportCsrfBinding(session, "create"), operation: "create" }).token })],
      ["database refusal", post({ operation: "create", nonce: createNonce() }), {}, () => { state.errors.capture = "42501"; }],
      ["already pending", post({ operation: "create", nonce: createNonce() }), {}, () => { state.errors.create = "55000"; }],
      ["replayed nonce", post({ operation: "create", nonce: createNonce() }), {}, () => { state.errors.create = "23505"; }],
    ];
    for (const [label, request, overrides, setup] of cases) {
      calls = []; state = { status: "queued", errors: {} }; setup?.();
      const response = await postClaimantExport(request, deps(overrides));
      expect(response.status, label).toBe(404);
      expect(await response.json(), label).toEqual({ error: "not_found" });
      expect(response.headers.get("set-cookie"), label).toBeNull();
    }
    const query = new Request(`${url}?x=1`, post({ operation: "create", nonce: createNonce() }));
    expect((await postClaimantExport(query, deps())).status).toBe(404);
  });
});

describe("POST open-ready", () => {
  it("opens one download session only for the exact ready cookie-bound export", async () => {
    state.status = "ready";
    const response = await postClaimantExport(post({ operation: "open-ready", nonce: openNonce() }, {}, true), deps());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ session: DOWNLOAD, filename: "inherit-claimed-record-export.zip", sizeBytes: 1000,
      sha256: "d".repeat(64), chunkBytes: 4_000_000, chunkCount: 1, chunkRoute: `/api/downloads/${DOWNLOAD}/chunks/{sequence}` });
    expect(response.headers.get("set-cookie")).toMatch(/^__Host-inherit-download=[A-Za-z0-9_-]{43}; Path=\/; Secure; HttpOnly; SameSite=Strict; Max-Age=\d+$/u);
    expect(calls.map(call => call[0])).toEqual(["capture", "check", "ready", "open"]);
    expect(calls.map(call => call[0])).not.toContain("create");
  });
  it("refuses without a ready export, cookie, delivery or matching proof", async () => {
    const cases: [string, Request, string, Partial<ClaimantExportDependencies>?, number?][] = [
      ["no export cookie", post({ operation: "open-ready", nonce: openNonce() }), "ready"],
      ["still preparing", post({ operation: "open-ready", nonce: openNonce() }, {}, true), "building"],
      ["create nonce", post({ operation: "open-ready", nonce: createNonce() }, {}, true), "ready"],
      ["no delivery capability", post({ operation: "open-ready", nonce: openNonce() }, {}, true), "ready", { delivery: null }, 503],
    ];
    for (const [label, request, status, overrides, expected] of cases) {
      calls = []; state = { status, errors: {} };
      const response = await postClaimantExport(request, deps(overrides));
      expect(response.status, label).toBe(expected ?? 404);
      expect(calls.map(call => call[0]), label).not.toContain("open");
    }
  });
});

describe("GET poll", () => {
  it("polls with zero writes and never sets a cookie", async () => {
    for (const [status, code, body] of [["queued", 202, { status: "preparing", exportId: EXPORT }], ["building", 202, { status: "preparing", exportId: EXPORT }],
      ["ready", 200, { status: "ready", exportId: EXPORT, filename: "inherit-claimed-record-export.zip", sizeBytes: 1000, sha256: "d".repeat(64),
        openAction: { method: "POST", operation: "open-ready" } }]] as const) {
      calls = []; state = { status, errors: {} };
      const response = await pollClaimantExport(get(), deps());
      expect(response.status, status).toBe(code);
      expect(await response.json(), status).toEqual(body);
      expect(response.headers.get("set-cookie"), status).toBeNull();
      expect(calls.map(call => call[0]).filter(name => ["create", "open"].includes(name)), status).toEqual([]);
    }
  });
  it("binds the export cookie to the rights session, so another session presents a different digest", async () => {
    const other = Buffer.alloc(32, 10).toString("base64url");
    await pollClaimantExport(get(), deps());
    await pollClaimantExport(get(`${RIGHTS_COOKIE_NAME}=${other}; __Host-inherit-export=${EXPORT}.${exportSecret}`), deps());
    const digests = calls.filter(call => call[0] === "check").map(call => (call[2] as { exportCookieHash: string }).exportCookieHash);
    expect(digests).toHaveLength(2);
    expect(digests[0]).not.toBe(digests[1]);
    expect(calls.filter(call => call[0] === "check").map(call => call[1])).toEqual([session, rightsSessionHash(other)]);
  });
  it("is the opaque 404 without the rights-bound export cookie or for a terminal export", async () => {
    for (const [label, request, status] of [["no export cookie", get(`${RIGHTS_COOKIE_NAME}=${secret}`), "queued"],
      ["no rights session", get(`__Host-inherit-export=${EXPORT}.${exportSecret}`), "queued"],
      ["duplicate export cookie", get(`${RIGHTS_COOKIE_NAME}=${secret}; __Host-inherit-export=${EXPORT}.${exportSecret}; __Host-inherit-export=${EXPORT}.${exportSecret}`), "queued"],
      ["query", get(undefined, `${url}?poll=1`), "queued"], ["expired", get(), "expired"], ["failed", get(), "failed"]] as const) {
      calls = []; state = { status, errors: {} };
      expect((await pollClaimantExport(request, deps())).status, label).toBe(404);
    }
    state = { status: "ready", errors: {} };
    expect((await pollClaimantExport(get(), deps({ delivery: null }))).status).toBe(503);
  });
});

describe("presentation", () => {
  it("renders no create action while no generation capability exists", async () => {
    const request = new Request(url, { headers: { cookie: `${RIGHTS_COOKIE_NAME}=${secret}` } });
    expect(await presentClaimantExportCreate(request, deps({ generation: null }))).toBeNull();
    expect(calls).toEqual([]);
    const presented = await presentClaimantExportCreate(request, deps());
    expect(presented).toMatchObject({ operation: "create", csrf: claimantCsrf(session) });
    expect((await postClaimantExport(post({ operation: "create", nonce: presented!.nonce }), deps())).status).toBe(202);
  });
});
