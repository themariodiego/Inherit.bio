import { afterEach, describe, expect, it, vi } from "vitest";
import { csrfHandle } from "@/lib/security/session-csrf-client";
import {
  WITHDRAWAL_START,
  requestOwnUploadWithdrawal,
  withdrawalOutcome,
  withdrawalStep,
  type WithdrawalEvent,
  type WithdrawalState,
} from "./own-upload-withdrawal-client";

/**
 * The browser half of withdrawing the own-upload consent (owner decision of
 * 19 November 2026). The request is the self case of api.subject-delete, as
 * the register's requestContract writes it (no body, the confirmation page's
 * X-Inherit-Operation-Nonce) with the route's one-time X-Inherit-CSRF token;
 * only a 202 is a withdrawal; and only the open confirmation sends.
 */

const SUBJECT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NONCE = `${Date.now() + 60_000}.${"n".repeat(43)}.${"0".repeat(64)}`;
const TOKEN = `${Date.now() + 60_000}.${"t".repeat(43)}.${"1".repeat(64)}`;
const NEXT = `${Date.now() + 60_000}.${"s".repeat(43)}.${"2".repeat(64)}`;

/** The browser's fetch, answering every request with `status` (or failing), and recording each. */
function recordingFetch(status: number | Error) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (status instanceof Error) throw status;
    return new Response(status === 202 ? JSON.stringify({ status: "accepted" }) : null,
      { status, headers: { "X-Inherit-CSRF": NEXT } });
  });
  return { calls };
}
afterEach(() => vi.unstubAllGlobals());

describe("the withdrawal request", () => {
  it("is DELETE /api/subjects/[id] with no body, the page's code and the rendered session token, and nothing else", async () => {
    const { calls } = recordingFetch(202);
    expect(await requestOwnUploadWithdrawal(csrfHandle(TOKEN), SUBJECT, NONCE)).toBe("withdrawn");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`/api/subjects/${SUBJECT}`);
    expect(calls[0]!.init).toEqual({ method: "DELETE", headers: { "X-Inherit-CSRF": TOKEN, "X-Inherit-Operation-Nonce": NONCE } });
    expect(calls[0]!.init.body).toBeUndefined();
  });

  it("carries the successor token the last answer issued, as every request of the chain does", async () => {
    const rendered = `${Date.now() + 60_000}.${"r".repeat(43)}.${"3".repeat(64)}`;
    const first = recordingFetch(404);
    await requestOwnUploadWithdrawal(csrfHandle(rendered), SUBJECT, NONCE);
    const second = recordingFetch(202);
    await requestOwnUploadWithdrawal(csrfHandle(rendered), SUBJECT, NONCE);
    expect((first.calls[0]!.init.headers as Record<string, string>)["X-Inherit-CSRF"]).toBe(rendered);
    expect((second.calls[0]!.init.headers as Record<string, string>)["X-Inherit-CSRF"]).toBe(NEXT);
  });

  it("reads only 202 as a withdrawal; a refusal is a refusal, and any other answer or none is unknown", async () => {
    for (const [status, outcome] of [[202, "withdrawn"], [404, "refused"], [403, "refused"], [401, "refused"],
      [400, "refused"], [200, "uncertain"], [204, "uncertain"], [500, "uncertain"], [503, "uncertain"]] as const) {
      recordingFetch(status);
      expect(await requestOwnUploadWithdrawal(csrfHandle(TOKEN), SUBJECT, NONCE), String(status)).toBe(outcome);
    }
    recordingFetch(new Error("offline"));
    expect(await requestOwnUploadWithdrawal(csrfHandle(TOKEN), SUBJECT, NONCE)).toBe("uncertain");
    expect(withdrawalOutcome(null)).toBe("uncertain");
  });
});

describe("the hand-over's refusal for now (owner decision of 22 November 2026, D-158)", () => {
  it("reads 409 as refused for now only for a hand-over; for every other withdrawal it stays a refusal", () => {
    expect(withdrawalOutcome(409, true)).toBe("not-now");
    expect(withdrawalOutcome(409)).toBe("refused");
    expect(withdrawalOutcome(409, false)).toBe("refused");
    for (const status of [400, 401, 403, 404, 422]) expect(withdrawalOutcome(status, true), String(status)).toBe("refused");
    expect(withdrawalOutcome(202, true)).toBe("withdrawn");
    expect(withdrawalOutcome(503, true)).toBe("uncertain");
    expect(withdrawalOutcome(null, true)).toBe("uncertain");
  });

  it("returns the hand-over's refusal for now to the trigger with its reason", () => {
    const sending = withdrawalStep(withdrawalStep(withdrawalStep(WITHDRAWAL_START, { type: "open" }), { type: "open" }), { type: "send" });
    expect(withdrawalStep(sending, { type: "answered", outcome: "not-now" })).toEqual({ phase: "idle", failure: "not-now" });
  });
});

describe("the control's steps", () => {
  const run = (...events: WithdrawalEvent[]) => events.reduce<WithdrawalState>(withdrawalStep, WITHDRAWAL_START);

  it("sends only from the open confirmation", () => {
    expect(run({ type: "send" })).toEqual(WITHDRAWAL_START);
    expect(run({ type: "open" })).toEqual({ phase: "confirming", failure: null });
    expect(run({ type: "open" }, { type: "send" })).toEqual({ phase: "sending", failure: null });
    expect(run({ type: "open" }, { type: "cancel" }, { type: "send" })).toEqual(WITHDRAWAL_START);
  });

  it("shows a receipt only for a withdrawal, and keeps it", () => {
    const done = run({ type: "open" }, { type: "send" }, { type: "answered", outcome: "withdrawn" });
    expect(done).toEqual({ phase: "done", failure: null });
    for (const event of [{ type: "open" }, { type: "cancel" }, { type: "send" },
      { type: "answered", outcome: "refused" }] as WithdrawalEvent[]) expect(withdrawalStep(done, event)).toBe(done);
  });

  it("returns a refusal or an unknown answer to the trigger with its reason, never to the receipt", () => {
    for (const outcome of ["refused", "uncertain"] as const) {
      const failed = run({ type: "open" }, { type: "send" }, { type: "answered", outcome });
      expect(failed).toEqual({ phase: "idle", failure: outcome });
      expect(withdrawalStep(failed, { type: "open" })).toEqual({ phase: "confirming", failure: null });
    }
    // An answer that arrives with no request in flight changes nothing.
    expect(run({ type: "answered", outcome: "withdrawn" })).toEqual(WITHDRAWAL_START);
  });
});
