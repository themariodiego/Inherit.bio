import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ClosedShapeError,
  SENSITIVE_HEADERS,
  blockedResponse,
  bodyIsEmpty,
  closedObject,
  consentRequired,
  invalidRequest,
  notFound,
  rpcErrorResponse,
  sensitiveJson,
  unavailable,
} from "./api";

afterEach(() => {
  vi.restoreAllMocks();
});

const EXPECTED_HEADERS: Record<string, string> = {
  "Cache-Control": "private, no-store",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
  Pragma: "no-cache",
  "Referrer-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

function expectSensitive(response: Response) {
  for (const [name, value] of Object.entries(EXPECTED_HEADERS)) {
    expect(response.headers.get(name), name).toBe(value);
  }
  expect(response.headers.get("content-type")).toContain("application/json");
}

function post(headers: Record<string, string> = {}): Request {
  return new Request("https://www.inherit.bio/api/cohorts/x/restrict", { method: "POST", headers });
}

/**
 * The shared response conventions of the embryo routes (contract §5.6,
 * §4.3; register embryo-closed-schema-v1): every body carries the
 * sensitive header set, every RPC error maps to the register's status, an
 * unregistered key never serializes, and a refused shape is a fixed 500
 * with one coded log line that carries no payload.
 */
describe("sensitiveJson", () => {
  it("sets every sensitive header on a JSON body with the given status", async () => {
    expect(SENSITIVE_HEADERS).toEqual(EXPECTED_HEADERS);
    const response = sensitiveJson({ status: "accepted" }, 202);
    expect(response.status).toBe(202);
    expectSensitive(response);
    expect(await response.json()).toEqual({ status: "accepted" });
  });

  it("defaults to 200, keeps extra headers and lets the sensitive set win over a clashing extra", async () => {
    const response = sensitiveJson({ ok: true }, undefined, {
      Location: "/withdraw/session",
      "Cache-Control": "public, max-age=60",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBe("/withdraw/session");
    expectSensitive(response);
    expect(await response.json()).toEqual({ ok: true });
  });
});

describe("fixed responses", () => {
  it("answers not found, invalid request, consent required and unavailable with the register's bodies", async () => {
    const cases: [Response, number, unknown][] = [
      [notFound(), 404, { error: "not_found" }],
      [invalidRequest(["body"]), 422, { error: "invalid_request", issues: ["body"] }],
      [invalidRequest([]), 422, { error: "invalid_request", issues: [] }],
      [consentRequired(["parentage", "disposition-rights"]), 403, { error: "consent_required", missing: ["parentage", "disposition-rights"] }],
      [unavailable(), 503, { error: "unavailable" }],
    ];
    for (const [response, status, body] of cases) {
      expect(response.status).toBe(status);
      expectSensitive(response);
      expect(await response.json()).toEqual(body);
    }
  });

  it("copies the issue and missing lists rather than sharing the caller's array", async () => {
    const issues = ["contacts"];
    const response = invalidRequest(issues);
    issues.push("later");
    expect(await response.json()).toEqual({ error: "invalid_request", issues: ["contacts"] });
  });
});

describe("rpcErrorResponse", () => {
  it.each([
    [{ code: "42501", message: "insufficient_privilege" }, 404, { error: "not_found" }],
    [{ code: "23505", message: "operation nonce already used" }, 404, { error: "not_found" }],
    [{ code: "22023", message: "invalid basis" }, 422, { error: "invalid_request", issues: ["request"] }],
    [
      { code: "55000", message: "consent_required", details: "upload-embryo, parentage,disposition-rights," },
      403,
      { error: "consent_required", missing: ["upload-embryo", "parentage", "disposition-rights"] },
    ],
    [{ code: "55000", message: "consent_required" }, 403, { error: "consent_required", missing: [] }],
    [{ code: "55000", message: "consent_required", details: "" }, 403, { error: "consent_required", missing: [] }],
    [{ code: "55000", message: "already restricted" }, 409, { error: "state_conflict" }],
    [{ code: "55000", message: "artifact superseded", details: "x" }, 409, { error: "state_conflict" }],
    [{ code: "55000" }, 409, { error: "state_conflict" }],
    [{ code: "PGRST301", message: "JWT expired" }, 503, { error: "unavailable" }],
    [{ code: "XX000", message: "internal" }, 503, { error: "unavailable" }],
    [{ message: "fetch failed" }, 503, { error: "unavailable" }],
    [{}, 503, { error: "unavailable" }],
    [null, 503, { error: "unavailable" }],
  ])("maps %j to %i %j", async (error, status, body) => {
    const response = rpcErrorResponse(error);
    expect(response.status).toBe(status);
    expectSensitive(response);
    expect(await response.json()).toEqual(body);
  });

  it("never reads a state message other than the exact consent_required as a consent matrix", async () => {
    const response = rpcErrorResponse({ code: "55000", message: "consent_required: parentage", details: "parentage" });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "state_conflict" });
  });
});

describe("closedObject", () => {
  const keys = ["cohort_id", "status", "embryo_count"] as const;

  it("returns the same object when its keys are exactly the registered set, in any order", () => {
    const value = { status: "accepted", embryo_count: 3, cohort_id: "c" };
    expect(closedObject(keys, value)).toBe(value);
    expect(closedObject([], {})).toEqual({});
  });

  it("throws a ClosedShapeError on a missing key, an extra key or a key whose value would vanish from the JSON", () => {
    expect(() => closedObject(keys, { cohort_id: "c", status: "accepted" } as Record<string, unknown>)).toThrow(ClosedShapeError);
    expect(() =>
      closedObject(keys, { cohort_id: "c", status: "accepted", embryo_count: 3, sex: "unknown" } as Record<string, unknown>),
    ).toThrow(ClosedShapeError);
    expect(() =>
      closedObject(keys, { cohort_id: "c", status: "accepted", embryo_count: undefined } as Record<string, unknown>),
    ).toThrow(ClosedShapeError);
    // A null is a value the register can list; it stays on the wire.
    expect(() => closedObject(["card"], { card: null })).not.toThrow();
  });

  it("names the differing keys on the error but keeps them out of its message", () => {
    let caught: unknown;
    try {
      closedObject(keys, { cohort_id: "c", status: "accepted", lab_identifier: "L" } as Record<string, unknown>);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ClosedShapeError);
    const error = caught as ClosedShapeError;
    expect(error.name).toBe("ClosedShapeError");
    expect(error.missing).toEqual(["embryo_count"]);
    expect(error.unexpected).toEqual(["lab_identifier"]);
    expect(error.message).not.toContain("embryo_count");
    expect(error.message).not.toContain("lab_identifier");
    expect(error.message).not.toContain("L");
  });
});

describe("blockedResponse", () => {
  it("answers 500 with the fixed body and logs one coded line naming only the registered consumer", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await blockedResponse("api.embryo-record-key-cards");
    expect(response.status).toBe(500);
    expectSensitive(response);
    expect(await response.json()).toEqual({ error: "unsafe_response_blocked" });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("feature.blocked embryo.closed-schema-serialization", "api.embryo-record-key-cards");
  });

  it("logs no fragment of an argument that is not a registered operation id", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await blockedResponse("record_key=0123456789ABCDEFGHJK {sex: unknown}");
    expect(log).toHaveBeenCalledWith("feature.blocked embryo.closed-schema-serialization", "unregistered");
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain("0123456789ABCDEFGHJK");
    expect(logged).not.toContain("sex");
  });
});

describe("bodyIsEmpty", () => {
  it("is true with no body headers or a zero Content-Length", () => {
    expect(bodyIsEmpty(post())).toBe(true);
    expect(bodyIsEmpty(post({ "content-length": "0" }))).toBe(true);
    expect(bodyIsEmpty(post({ "content-length": " 0 " }))).toBe(true);
  });

  it("is false with a Content-Length above zero or any Transfer-Encoding", () => {
    expect(bodyIsEmpty(post({ "content-length": "2" }))).toBe(false);
    expect(bodyIsEmpty(post({ "content-length": "1024" }))).toBe(false);
    expect(bodyIsEmpty(post({ "transfer-encoding": "chunked" }))).toBe(false);
    expect(bodyIsEmpty(post({ "content-length": "0", "transfer-encoding": "chunked" }))).toBe(false);
  });
});
