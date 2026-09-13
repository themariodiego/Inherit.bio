import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/mail-outbox", () => ({ enqueueAccountMail: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: (...args: unknown[]) => { const result = mocks.rpc(...args); return Object.assign(result, { abortSignal: () => result }); },
    // D-086: the drain no longer counts the deletions still due for its
    // response body, so a table read from this route is a defect. This mock
    // makes one fail rather than pass unnoticed.
    from: (table: string) => { throw new Error(`the retention drain must not read ${table}`); },
  }),
}));

describe("independent retention queues", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

  it("continues invitation, draft and account retention when terminal-contact expiry fails", async () => {
    vi.stubEnv("JOBS_SECRET", "test-job-secret");
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "claim_own_original_retirement_v1") return { data: null, error: null };
      if (name === "prepare_due_prepared_scratch_v1") return { data: 0, error: null };
      if (name === "claim_own_prepared_cleanup_v1") return { data: null, error: null };
      if (name === "run_own_report_purge_v1") return { data: null, error: null };
      if (name === "reap_expired_own_normalizations_v1") return { data: 0, error: null };
      if (name === "claim_own_upload_purge_v1") return { data: null, error: null };
      if (name === "expire_embryo_terminal_mail_v1") return { data: null, error: { code: "synthetic" } };
      if (name === "expire_due_adult_subject_invitations_v1") return { data: 0, error: null };
      return { data: [], error: null };
    });
    const response = await POST(new Request("http://localhost/api/jobs/retention", {
      method: "POST", headers: { authorization: "Bearer test-job-secret" },
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "complete", outcome: "completed_with_failures" });
    expect(mocks.rpc).toHaveBeenCalledWith("expire_due_adult_subject_invitations_v1");
    expect(mocks.rpc).toHaveBeenCalledWith("run_due_embryo_retention_phases_v1");
    expect(mocks.rpc).toHaveBeenCalledWith("claim_due_account_deletion_v1", expect.any(Object));
    expect(mocks.rpc).toHaveBeenCalledWith("reap_expired_own_normalizations_v1");
  });

  it("reaps interrupted preparation even when the upload provider queue fails", async () => {
    vi.stubEnv("JOBS_SECRET", "test-job-secret");
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "claim_own_original_retirement_v1") return { data: null, error: null };
      if (name === "prepare_due_prepared_scratch_v1") return { data: 0, error: null };
      if (name === "claim_own_prepared_cleanup_v1") return { data: null, error: null };
      if (name === "run_own_report_purge_v1") return { data: null, error: null };
      if (name === "reap_expired_own_normalizations_v1") return { data: 2, error: null };
      if (name === "claim_own_upload_purge_v1") return { data: null, error: { code: "synthetic" } };
      if (name === "expire_due_adult_subject_invitations_v1") return { data: 0, error: null };
      return { data: [], error: null };
    });
    const response = await POST(new Request("http://localhost/api/jobs/retention", {
      method: "POST", headers: { authorization: "Bearer test-job-secret" },
    }));
    expect(await response.json()).toEqual({ status: "complete", outcome: "completed_with_failures" });
    expect(mocks.rpc.mock.calls.filter(call => call[0] === "reap_expired_own_normalizations_v1"))
      .toEqual([["reap_expired_own_normalizations_v1"]]);
  });

  it("reports an idle sweep as no_work, not as a completed one", async () => {
    vi.stubEnv("JOBS_SECRET", "test-job-secret");
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "prepare_due_prepared_scratch_v1") return { data: 0, error: null };
      if (name === "reap_expired_own_normalizations_v1") return { data: 0, error: null };
      if (name === "expire_due_adult_subject_invitations_v1") return { data: 0, error: null };
      return { data: null, error: null };
    });
    const response = await POST(new Request("http://localhost/api/jobs/retention", {
      method: "POST", headers: { authorization: "Bearer test-job-secret" },
    }));
    expect(response.status).toBe(200);
    // Nothing was due. A cron monitor must be able to tell that apart from a
    // sweep that deleted something, and from one that failed to.
    expect(await response.json()).toEqual({ status: "complete", outcome: "no_work" });
  });

  it("does not accept a streaming body without Content-Length as a selector", async () => {
    vi.stubEnv("JOBS_SECRET", "test-job-secret");
    const response = await POST(new Request("http://localhost/api/jobs/retention", {
      method: "POST", headers: { authorization: "Bearer test-job-secret" }, body: "{}",
    }));
    expect(response.status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
