import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { UNWIND_DISPATCH_BLOCKED, dispatchIngestAttemptFailure, failIngestAttempt } from "./ingest-failure";

const COHORT = "a0000000-0000-4000-8000-000000000001";
const credentials = {
  p_account_id: COHORT, p_auth_session_id: COHORT, p_ingest_session_id: COHORT,
  p_cookie_hash: "a".repeat(64), p_origin: "https://inherit.example", p_test_jurisdiction: true as const,
};

describe("dispatching attemptFailure", () => {
  it("asks for the unwind of exactly this cohort and ingest revision, and logs nothing when it succeeds", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await dispatchIngestAttemptFailure({ cohortId: COHORT, ingestRevision: 7 }, rpc);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("prepare_embryo_ingest_unwind_v1", { p_cohort_id: COHORT, p_ingest_revision: 7 });
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("records a failed dispatch only as the registered event, whether it errors or throws", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await dispatchIngestAttemptFailure({ cohortId: COHORT, ingestRevision: 7 }, vi.fn().mockResolvedValue({ error: { message: "PRIVATE" } }));
    await dispatchIngestAttemptFailure({ cohortId: COHORT, ingestRevision: 7 }, vi.fn().mockRejectedValue(new Error("PRIVATE")));
    expect(log.mock.calls).toEqual([[UNWIND_DISPATCH_BLOCKED], [UNWIND_DISPATCH_BLOCKED]]);
    log.mockRestore();
  });

  /** Owner decision 5A: the event's operation and reason are registered codes, not ad hoc text. */
  it("uses a feature.blocked operation and reason the route register lists", () => {
    const register = JSON.parse(readFileSync("docs/route-register.json", "utf8")) as {
      observabilityCodeRegistries: { featureBlockedOperationIds: string[]; featureBlockedReasonIds: string[] };
    };
    const [template, operation, reason, ...rest] = UNWIND_DISPATCH_BLOCKED.split(" ");
    expect(template).toBe("feature.blocked");
    expect(rest).toEqual([]);
    expect(register.observabilityCodeRegistries.featureBlockedOperationIds).toContain(operation);
    expect(register.observabilityCodeRegistries.featureBlockedReasonIds).toContain(reason);
  });
});

describe("recording a terminal branch the route found", () => {
  it("marks through the credential-bound door, then dispatches", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { status: "failure_pending", cohortId: COHORT, ingestRevision: 7 }, error: null });
    const dispatch = vi.fn().mockResolvedValue(undefined);
    expect(await failIngestAttempt(credentials, { cohortId: COHORT, ingestRevision: 7 }, "header", rpc, dispatch)).toBe(true);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("fail_embryo_ingest_attempt_v1",
      { ...credentials, p_cohort_id: COHORT, p_ingest_revision: 7, p_code: "header" });
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ status: "failure_pending", cohortId: COHORT, ingestRevision: 7 });
  });

  it("reports false, and dispatches nothing, when the attempt could not be marked", async () => {
    for (const rpc of [
      vi.fn().mockResolvedValue({ data: null, error: { code: "55P03" } }),
      vi.fn().mockResolvedValue({ data: { status: "failure_pending" }, error: null }),
      vi.fn().mockRejectedValue(new Error("PRIVATE")),
    ]) {
      const dispatch = vi.fn();
      expect(await failIngestAttempt(credentials, { cohortId: COHORT, ingestRevision: 7 }, "chunk", rpc, dispatch)).toBe(false);
      expect(dispatch).not.toHaveBeenCalled();
    }
  });
});
