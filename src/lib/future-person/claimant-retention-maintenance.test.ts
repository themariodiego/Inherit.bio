import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";

// Compose the actual retention POST, actual optional capability factory and
// actual strict transport parser. All unrelated queues are explicitly idle
// composition doubles; no provider/native disposal proof is claimed.
const idle=vi.hoisted(()=>({rpc:vi.fn(),open:vi.fn(),source:vi.fn(),remove:vi.fn()}));
vi.mock("postgres",()=>({default:(config:unknown)=>{
 idle.open(config);throw new Error("unexpected_claimant_database_acquisition");
}}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>({
 rpc:(...args:unknown[])=>{const result=idle.rpc(...args);return Object.assign(result,{abortSignal:()=>result});},
 from:()=>{throw new Error("unexpected_retention_table_read");},
 auth:{admin:{deleteUser:()=>{throw new Error("unexpected_auth_deletion");}}},
 storage:{from:()=>({remove:idle.remove})},
})}));
vi.mock("@/lib/mail-outbox",()=>({enqueueAccountMail:vi.fn()}));
vi.mock("@/lib/future-person/requester-statement",()=>({requesterStatementsOpen:()=>false}));
vi.mock("@/lib/future-person/appeals-open",()=>({testAppealIntakeOpen:()=>false}));
vi.mock("@/lib/future-person/erasure-storage",()=>({drainClaimantSource:idle.source}));
vi.mock("@/lib/embryos/refused-invitation-cleanup",()=>({drainRefusedInvitationCleanup:async()=>({processed:0,failed:0})}));
vi.mock("@/lib/uploads/retention-cleanup",()=>({drainOwnUploadCleanup:async()=>({processed:0,failed:0})}));
vi.mock("@/lib/uploads/file-deletion-backstop",()=>({drainStrandedFileDeletions:async()=>({processed:0,failed:0})}));
vi.mock("@/lib/uploads/report-revocation-cleanup",()=>({drainOwnReportRevocations:async()=>({processed:0,failed:0})}));
vi.mock("@/lib/uploads/normalization-cleanup",()=>({drainOwnNormalizationCleanup:async()=>({processed:0,failed:0})}));
vi.mock("@/lib/genome/prepared-source/original-retention",()=>({drainOwnOriginalRetirement:async()=>({processed:0,failed:0})}));
vi.mock("@/lib/genome/prepared-source/cleanup-integration",()=>({
 drainPreparedScratch:async()=>({processed:0,failed:0}),
 prepareAccountCleanup:()=>{throw new Error("unexpected_account_cleanup");},
}));
vi.mock("@/lib/embryos/account-cleanup",()=>({drainAccountEmbryoCleanup:()=>{throw new Error("unexpected_embryo_cleanup");}}));
import {POST} from "@/app/api/jobs/retention/route";

beforeEach(()=>{
 vi.clearAllMocks();
 vi.stubEnv("JOBS_SECRET","test-claimant-retention-job");
 vi.stubEnv("INHERIT_TEST_JURISDICTION","1");
 vi.stubEnv("INHERIT_TEST_CLAIMANT_RIGHTS","");
 vi.stubEnv("INHERIT_TEST_ACCOUNT_ARCHIVE_R2","");
 vi.stubEnv("INHERIT_TEST_ACCOUNT_ARCHIVE_R2_DATABASE",undefined);
 vi.stubEnv("INHERIT_TEST_ACCOUNT_ARCHIVE_R2_DATABASE_CA_CERT",undefined);
 vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL","http://127.0.0.1:54321");
 vi.stubEnv("INHERIT_LOCAL_E2E_PROJECT","sequence");
 idle.rpc.mockImplementation(async(name:string)=>name==="drain_due_new_public_appeals_v1"
  ?{data:{shredded:0,completed:0,held:0},error:null}:{data:null,error:null});
});
afterEach(()=>vi.unstubAllEnvs());
const request=()=>new Request("http://localhost/api/jobs/retention",{
 method:"POST",headers:{authorization:"Bearer test-claimant-retention-job"},
});
describe("optional claimant continuation in the real retention route",()=>{
 it.each([undefined,""])("ordinary TEST without dedicated DSN %j preserves no_work and acquires nothing",async dsn=>{
  vi.stubEnv("INHERIT_TEST_ACCOUNT_ARCHIVE_R2_DATABASE",dsn);
  const response=await POST(request());expect(response.status).toBe(200);
  expect(await response.json()).toEqual({status:"complete",outcome:"no_work"});
  expect(idle.open).not.toHaveBeenCalled();expect(idle.source).not.toHaveBeenCalled();expect(idle.remove).not.toHaveBeenCalled();
  expect(idle.rpc.mock.calls.some(([name])=>name==="future_person_deletion_parts_v1")).toBe(false);
  expect(idle.rpc).toHaveBeenCalledWith("purge_due_future_person_contacts_v1");
  expect(idle.rpc).toHaveBeenCalledWith("run_due_embryo_retention_phases_v1");
  expect(idle.rpc).toHaveBeenCalledWith("claim_due_account_deletion_v1",expect.any(Object));
 });
 it.each(["invalid-url"," "])("nonempty malformed dedicated DSN %j remains a genuine failure without native acquisition",async dsn=>{
  vi.stubEnv("INHERIT_TEST_ACCOUNT_ARCHIVE_R2_DATABASE",dsn);
  const response=await POST(request());expect(response.status).toBe(200);
  expect(await response.json()).toEqual({status:"complete",outcome:"completed_with_failures"});
  expect(idle.open).not.toHaveBeenCalled();expect(idle.source).not.toHaveBeenCalled();expect(idle.remove).not.toHaveBeenCalled();
  expect(idle.rpc).toHaveBeenCalledWith("claim_due_account_deletion_v1",expect.any(Object));
 });
});
