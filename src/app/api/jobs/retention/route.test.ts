import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/mail-outbox", () => ({ enqueueAccountMail: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: (...args: unknown[]) => { const result = mocks.rpc(...args); return Object.assign(result, { abortSignal: () => result }); },
    // D-086: the drain no longer counts the deletions still due for its
    // response body, so a table read from this route is a defect. This mock
    // makes one fail rather than pass unnoticed.
    from: (table: string) => { throw new Error(`the retention drain must not read ${table}`); },
    storage: { from: (bucket: string) => ({ remove: (names: string[]) => mocks.remove(bucket, names) }) },
  }),
}));

const strandedFile = "81000000-0000-4000-8000-000000000005";
const strandedClaim = {
  version: "genome-file-deletion-claim-v1", fileId: strandedFile, bucket: "genomes",
  name: "db-owned-object", claimExpiresAt: "2026-09-18T12:00:00+00:00",
};
const strandedPlan = {
  version: "own-prepared-file-cleanup-v1", cleanupId: null, preparedComplete: true,
  original: { token: "81000000-0000-4000-8000-000000000002", bucket: "genomes", name: "db-owned-object" },
};
/** Every other queue idle, so the outcome and the calls are the backstop's alone. */
function idleExceptStranded(claims: unknown[]) {
  const remaining = [...claims];
  mocks.rpc.mockImplementation(async (name: string) => {
    if (name === "claim_due_genome_file_deletion_v1") return { data: remaining.shift() ?? null, error: null };
    if (name === "prepare_own_prepared_file_cleanup_claimed_v1") return { data: strandedPlan, error: null };
    if (name === "prepare_due_prepared_scratch_v1") return { data: 0, error: null };
    if (name === "reap_expired_own_normalizations_v1") return { data: 0, error: null };
    if (name === "expire_due_adult_subject_invitations_v1") return { data: 0, error: null };
    return { data: null, error: null };
  });
}
const strandedCalls = () => mocks.rpc.mock.calls.filter(call => [
  "claim_due_genome_file_deletion_v1", "prepare_own_prepared_file_cleanup_claimed_v1",
  "finish_genome_file_deletion_claimed_v1", "fail_genome_file_deletion_claim_v1",
].includes(call[0] as string)).map(call => call[0]);
const run = () => POST(new Request("http://localhost/api/jobs/retention", {
  method: "POST", headers: { authorization: "Bearer test-job-secret" },
}));

describe("independent retention queues", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

  it.each(["returned","thrown"])("continues the original queues after a %s profile erase failure", async failure => {
    vi.stubEnv("JOBS_SECRET", "test-job-secret"); idleExceptStranded([]);
    const baseline = mocks.rpc.getMockImplementation()!;
    mocks.rpc.mockImplementation(async (name: string, ...args: unknown[]) => {
      if (name === "purge_due_future_person_profiles_v1") {
        if (failure === "thrown") throw new Error("synthetic transport failure");
        return { data: null, error: { code: "synthetic" } };
      }
      return baseline(name, ...args);
    });
    const response = await run();
    expect(await response.json()).toEqual({ status: "complete", outcome: "completed_with_failures" });
    expect(mocks.rpc.mock.calls.filter(call => call[0] === "purge_due_future_person_profiles_v1"))
      .toEqual([["purge_due_future_person_profiles_v1"]]);
    expect(mocks.rpc).toHaveBeenCalledWith("run_due_embryo_retention_phases_v1");
    expect(mocks.rpc).toHaveBeenCalledWith("claim_due_account_deletion_v1", expect.any(Object));
  });

  it("erases only database-selected expired profiles before the original due queues", async () => {
    vi.stubEnv("JOBS_SECRET", "test-job-secret"); idleExceptStranded([]);
    const baseline = mocks.rpc.getMockImplementation()!;
    mocks.rpc.mockImplementation(async (name: string, ...args: unknown[]) =>
      name === "purge_due_future_person_profiles_v1" ? { data: 2, error: null } : baseline(name, ...args));
    expect(await (await run()).json()).toEqual({ status: "complete", outcome: "completed" });
    expect(mocks.rpc.mock.calls.filter(call => call[0] === "purge_due_future_person_profiles_v1"))
      .toEqual([["purge_due_future_person_profiles_v1"]]);
    expect(mocks.rpc.mock.calls.findIndex(call => call[0] === "purge_due_future_person_profiles_v1"))
      .toBeLessThan(mocks.rpc.mock.calls.findIndex(call => call[0] === "run_due_embryo_retention_phases_v1"));
  });

  it.each(["returned","thrown"])("continues retention after a %s document-key erase failure",async(failure)=>{
    vi.stubEnv("JOBS_SECRET","test-job-secret");idleExceptStranded([]);
    const baseline=mocks.rpc.getMockImplementation()!;
    mocks.rpc.mockImplementation(async(name:string,...args:unknown[])=>{
      if(name==="shred_due_claim_working_keys_v1") {
        if(failure==="thrown")throw new Error("synthetic transport failure");
        return {data:null,error:{code:"synthetic"}};
      }
      return baseline(name,...args);
    });
    const response=await run();
    expect(await response.json()).toEqual({status:"complete",outcome:"completed_with_failures"});
    expect(mocks.rpc.mock.calls.filter(call=>call[0]==="shred_due_claim_working_keys_v1")).toEqual([["shred_due_claim_working_keys_v1"]]);
    expect(mocks.rpc).toHaveBeenCalledWith("claim_document_objects_due_v1",{p_limit:100});
    expect(mocks.rpc).toHaveBeenCalledWith("purge_due_future_person_contacts_v1");
    expect(mocks.rpc).toHaveBeenCalledWith("claim_due_account_deletion_v1",expect.any(Object));
  });

  it.each(["returned","thrown"])("keeps temporary claimant contact cleanup independent when its failure is %s",async(failure)=>{
    vi.stubEnv("JOBS_SECRET","test-job-secret");idleExceptStranded([]);
    const baseline=mocks.rpc.getMockImplementation()!;
    mocks.rpc.mockImplementation(async(name:string,...args:unknown[])=>{
      if(name==="purge_due_future_person_contacts_v1") {
        if(failure==="thrown")throw new Error("synthetic transport failure");
        return {data:null,error:{code:"synthetic"}};
      }
      return baseline(name,...args);
    });
    const response=await run();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({status:"complete",outcome:"completed_with_failures"});
    expect(mocks.rpc.mock.calls.filter(call=>call[0]==="purge_due_future_person_contacts_v1")).toEqual([["purge_due_future_person_contacts_v1"]]);
    expect(mocks.rpc).toHaveBeenCalledWith("expire_due_adult_subject_invitations_v1");
    expect(mocks.rpc).toHaveBeenCalledWith("run_due_embryo_retention_phases_v1");
    expect(mocks.rpc).toHaveBeenCalledWith("claim_due_account_deletion_v1",expect.any(Object));
  });

  it("continues invitation, draft and account retention when terminal-contact expiry fails", async () => {
    vi.stubEnv("JOBS_SECRET", "test-job-secret");
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "claim_own_original_retirement_v1") return { data: null, error: null };
      if (name === "prepare_due_prepared_scratch_v1") return { data: 0, error: null };
      if (name === "claim_own_prepared_cleanup_v1") return { data: null, error: null };
      if (name === "run_own_report_purge_v1") return { data: null, error: null };
      if (name === "reap_expired_own_normalizations_v1") return { data: 0, error: null };
      if (name === "claim_own_upload_purge_v1") return { data: null, error: null };
      if (name === "claim_due_genome_file_deletion_v1") return { data: null, error: null };
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
      if (name === "claim_due_genome_file_deletion_v1") return { data: null, error: null };
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

  it("purges expired quota buckets as independent due work", async () => {
    vi.stubEnv("JOBS_SECRET", "test-job-secret");
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "prepare_due_prepared_scratch_v1") return { data: 0, error: null };
      if (name === "reap_expired_own_normalizations_v1") return { data: 0, error: null };
      if (name === "expire_due_adult_subject_invitations_v1") return { data: 0, error: null };
      if (name === "purge_expired_rate_limit_buckets_v1") return { data: 3, error: null };
      return { data: null, error: null };
    });
    const response = await run();
    expect(await response.json()).toEqual({ status: "complete", outcome: "completed" });
    // The route passes no selector: the database alone decides which bucket is past its fixed purge.
    expect(mocks.rpc.mock.calls.filter(call => call[0] === "purge_expired_rate_limit_buckets_v1"))
      .toEqual([["purge_expired_rate_limit_buckets_v1"]]);
  });

  it("keeps draining other queues when the quota bucket purge fails", async () => {
    vi.stubEnv("JOBS_SECRET", "test-job-secret");
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "prepare_due_prepared_scratch_v1") return { data: 0, error: null };
      if (name === "reap_expired_own_normalizations_v1") return { data: 0, error: null };
      if (name === "expire_due_adult_subject_invitations_v1") return { data: 0, error: null };
      if (name === "purge_expired_rate_limit_buckets_v1") return { data: null, error: { code: "synthetic" } };
      return { data: null, error: null };
    });
    const response = await run();
    expect(await response.json()).toEqual({ status: "complete", outcome: "completed_with_failures" });
    expect(mocks.rpc).toHaveBeenCalledWith("run_due_embryo_retention_phases_v1");
    expect(mocks.rpc).toHaveBeenCalledWith("claim_due_account_deletion_v1", expect.any(Object));
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

// source.revocation-7d (D-126): the seven-day backstop for a self file
// deletion the owner started but never finished. The database selects the
// record; the route redoes the same removal and finish under the claim.
describe("stranded file deletion backstop", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

  it("touches neither Storage nor a finish when the claim page is empty", async () => {
    vi.stubEnv("JOBS_SECRET", "test-job-secret");
    idleExceptStranded([]);
    const response = await run();
    expect(await response.json()).toEqual({ status: "complete", outcome: "no_work" });
    expect(strandedCalls()).toEqual(["claim_due_genome_file_deletion_v1"]);
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("redoes the record's own Storage removal and finishes under the claim", async () => {
    vi.stubEnv("JOBS_SECRET", "test-job-secret");
    idleExceptStranded([strandedClaim]);
    mocks.remove.mockResolvedValue({ data: [], error: null });
    const response = await run();
    expect(await response.json()).toEqual({ status: "complete", outcome: "completed" });
    expect(strandedCalls()).toEqual([
      "claim_due_genome_file_deletion_v1", "prepare_own_prepared_file_cleanup_claimed_v1",
      "finish_genome_file_deletion_claimed_v1", "claim_due_genome_file_deletion_v1",
    ]);
    const [, hash] = mocks.rpc.mock.calls.find(call => call[0] === "claim_due_genome_file_deletion_v1")! as [string, { p_claim_token_hash: string }];
    expect(hash.p_claim_token_hash).toMatch(/^[0-9a-f]{64}$/);
    // The bucket and name come from the claimed record, never from the caller.
    expect(mocks.remove.mock.calls).toEqual([["genomes", ["db-owned-object"]]]);
    expect(mocks.rpc).toHaveBeenCalledWith("prepare_own_prepared_file_cleanup_claimed_v1",
      { p_file_id: strandedFile, p_claim_token_hash: hash.p_claim_token_hash });
    expect(mocks.rpc).toHaveBeenCalledWith("finish_genome_file_deletion_claimed_v1",
      { p_file_id: strandedFile, p_claim_token_hash: hash.p_claim_token_hash });
    expect(mocks.rpc).not.toHaveBeenCalledWith("fail_genome_file_deletion_claim_v1", expect.anything());
  });

  it("leaves the record for the next run when Storage refuses the removal", async () => {
    vi.stubEnv("JOBS_SECRET", "test-job-secret");
    idleExceptStranded([strandedClaim, strandedClaim]);
    mocks.remove.mockResolvedValue({ data: null, error: { message: "private storage failure" } });
    const response = await run();
    expect(await response.json()).toEqual({ status: "complete", outcome: "completed_with_failures" });
    // One claim, one refused removal, the claim released, no finish, no second
    // claim in the same run: the record waits its retry delay.
    expect(strandedCalls()).toEqual([
      "claim_due_genome_file_deletion_v1", "prepare_own_prepared_file_cleanup_claimed_v1",
      "fail_genome_file_deletion_claim_v1",
    ]);
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).not.toHaveBeenCalledWith("finish_genome_file_deletion_claimed_v1", expect.anything());
  });
});

describe("Future Person claim document objects", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

  const KEY = "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333";
  function claimObjects(due: unknown) {
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "prepare_due_prepared_scratch_v1") return { data: 0, error: null };
      if (name === "reap_expired_own_normalizations_v1") return { data: 0, error: null };
      if (name === "expire_due_adult_subject_invitations_v1") return { data: 0, error: null };
      if (name === "claim_document_objects_due_v1") return due as { data: unknown; error: unknown };
      if (name === "confirm_claim_document_objects_deleted_v1") return { data: 1, error: null };
      if (name === "purge_future_person_claim_intakes_v1") return { data: 1, error: null };
      return { data: null, error: null };
    });
  }

  it("deletes the due objects from the claim bucket, confirms them, and only then purges the claim", async () => {
    vi.stubEnv("JOBS_SECRET", "test-job-secret");
    claimObjects({ data: [{ object_key: KEY }], error: null });
    mocks.remove.mockResolvedValue({ data: [], error: null });
    const response = await run();
    expect(await response.json()).toEqual({ status: "complete", outcome: "completed" });
    expect(mocks.remove.mock.calls).toEqual([["future-person-identity", [KEY]]]);
    const order = mocks.rpc.mock.calls.map((call) => call[0]).filter((name) =>
      ["close_due_claim_reviews_v1", "shred_due_claim_working_keys_v1", "claim_document_objects_due_v1", "confirm_claim_document_objects_deleted_v1",
        "purge_future_person_claim_intakes_v1"].includes(name as string));
    // Reviews past their deadline close first, so their documents are due in the same run.
    expect(order).toEqual(["close_due_claim_reviews_v1", "shred_due_claim_working_keys_v1", "claim_document_objects_due_v1",
      "confirm_claim_document_objects_deleted_v1", "purge_future_person_claim_intakes_v1"]);
    expect(mocks.rpc).toHaveBeenCalledWith("confirm_claim_document_objects_deleted_v1",
      { p_object_keys: [KEY], p_route_id: "jobs.retention" });
  });

  it("confirms nothing when Storage refuses the deletion", async () => {
    vi.stubEnv("JOBS_SECRET", "test-job-secret");
    claimObjects({ data: [{ object_key: KEY }], error: null });
    mocks.remove.mockResolvedValue({ data: null, error: { message: "private storage failure" } });
    const response = await run();
    expect(await response.json()).toEqual({ status: "complete", outcome: "completed_with_failures" });
    expect(mocks.rpc).not.toHaveBeenCalledWith("confirm_claim_document_objects_deleted_v1", expect.anything());
  });
});

describe("another adult's held uploads", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
  it("rejects due held files before the upload cleanup, so one run deletes them", async () => {
    vi.stubEnv("JOBS_SECRET", "test-job-secret");
    idleExceptStranded([]);
    expect((await run()).status).toBe(200);
    const names = mocks.rpc.mock.calls.map(call => call[0] as string);
    expect(names).toContain("expire_due_other_adult_held_uploads_v1");
    expect(names.indexOf("expire_due_other_adult_held_uploads_v1")).toBeLessThan(names.indexOf("claim_own_upload_purge_v1"));
  });
  it("reports a failed held sweep and still runs the upload cleanup", async () => {
    vi.stubEnv("JOBS_SECRET", "test-job-secret");
    idleExceptStranded([]);
    const idle = mocks.rpc.getMockImplementation()!;
    mocks.rpc.mockImplementation(async (name: string, ...rest: unknown[]) =>
      name === "expire_due_other_adult_held_uploads_v1" ? { data: null, error: { code: "synthetic" } } : idle(name, ...rest));
    const response = await run();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "complete", outcome: "completed_with_failures" });
    expect(mocks.rpc.mock.calls.some(call => call[0] === "claim_own_upload_purge_v1")).toBe(true);
  });
});
