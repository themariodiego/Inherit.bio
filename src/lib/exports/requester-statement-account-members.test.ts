import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {sealNewCorrection} from "../future-person/correction-case-envelope";
import {sealNewAppeal} from "../future-person/appeal-case-envelope";
import {prepareAccountRequesterStatementMembers} from "./requester-statement-account-members";
const id=(n:number)=>`83000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const statement="My own synthetic statement, with no reviewer notes or somebody else's data.";
const originalSubmittedAt=new Date().toISOString(),originalDeadline=new Date(Date.parse(originalSubmittedAt)+30*86400_000).toISOString(),receipt="a".repeat(64);
function fixture(){
 const binding={accountId:id(1),sessionId:id(2),subjectId:id(3),principalId:id(4),bindingId:id(5),
  accountAuthSessionRevision:1,sessionRevision:1,principalRevision:1,lifecycleRevision:1,bindingRevision:1,sourceReceipt:receipt,caseHash:"b".repeat(64)};
 const correction={version:1 as const,caseKind:"correction" as const,caseId:id(6),originalAuthorPrincipalId:id(4),initialStatementRevision:1 as const,
  originalSubmittedAt,originalDeadline,requestedField:"display-label" as const,originalSubjectId:id(3)};
 const appeal={version:1 as const,caseKind:"appeal" as const,caseId:id(7),originalAuthorPrincipalId:id(4),initialStatementRevision:1 as const,
  originalSubmittedAt,originalDeadline,intakeKind:"access-or-review-appeal" as const};
 const sealedAppeal=sealNewAppeal(appeal,{kind:appeal.intakeKind,claimantName:"Synthetic Requester",contactEmail:"test@example.invalid",statement,affirmed:true});
 const rows=[{id:id(6),frame:{scope:correction,binding,envelope:sealNewCorrection(correction,statement)}},
  {id:id(7),frame:{scope:appeal,binding,envelope:{format:sealedAppeal.format,statementCiphertextHex:sealedAppeal.statementCiphertextHex,wrappedCaseKeyHex:sealedAppeal.wrappedCaseKeyHex}}}];
 const partitions=[{subjectId:id(3),rows:2}],classes={correction_requests:{rows:1,membershipSha256:"c".repeat(64),partitions:[{subjectId:id(3),rows:1}]},
  appeal_intakes:{rows:1,membershipSha256:"d".repeat(64),partitions:[{subjectId:id(3),rows:1}]}};
 const capture={version:"test-account-own-statements-v2",corrections:1,appeals:1,membershipSha256:"e".repeat(64),originalDeadline,partitions,classes};
 const signal=new AbortController().signal,check=vi.fn(async()=>{});
 const call=vi.fn(async(_subject:string,after:string|null)=>after===null?{rows,count:rows.length,nextAfterId:rows.at(-1)!.id}:{rows:[],count:0,nextAfterId:null});
 return {rows,options:{capture,accountId:id(1),sessionId:id(2),authorityReceipt:receipt,subjects:[id(3)],signal,check,call}};
}
beforeEach(()=>{vi.stubEnv("INHERIT_TEST_JURISDICTION","1");vi.stubEnv("INHERIT_TEST_REQUESTER_STATEMENTS","1");vi.stubEnv("BYOK_ENCRYPTION_KEY",Buffer.alloc(32,71).toString("base64"));});
afterEach(()=>vi.unstubAllEnvs());
async function materialize(f:ReturnType<typeof fixture>){const prepared=await prepareAccountRequesterStatementMembers(f.options);const output:Uint8Array[]=[];
 for await(const bytes of prepared.factories[0]!.chunks(f.options.signal))output.push(bytes.slice());return JSON.parse(Buffer.concat(output).toString("utf8"));}
describe("account requester statement producer consumer",()=>{
 it("serializes exactly requester correction and appeal statements, without contact or reviewer fields",async()=>{
  const value=await materialize(fixture());expect(value.rows).toEqual([{correctionId:id(6),statement},{appealId:id(7),statement}]);
  expect(JSON.stringify(value)).not.toContain("test@example.invalid");expect(JSON.stringify(value)).not.toContain("workingCiphertext");
 });
 it("regenerates through a fresh complete census and EOF rather than reusing decrypted output",async()=>{
  const f=fixture();expect(await materialize(f)).toEqual(await materialize(f));expect(f.options.call).toHaveBeenCalledTimes(8);
 });
 it.each(["accountId","sessionId","principalId","subjectId","sourceReceipt"] as const)("refuses a foreign or stale %s before output",async field=>{
  const f=fixture();f.rows[0]!.frame.binding={...f.rows[0]!.frame.binding,[field]:field==="sourceReceipt"?"f".repeat(64):id(99)};
  await expect(prepareAccountRequesterStatementMembers(f.options)).rejects.toThrow();
 });
 it("refuses reviewer notes and the full appeal working/contact package",async()=>{
  const f=fixture();Object.assign(f.rows[0]!.frame,{reviewerNotes:"Synthetic confidential notes"});
  await expect(prepareAccountRequesterStatementMembers(f.options)).rejects.toThrow();
  const g=fixture();Object.assign(g.rows[1]!.frame.envelope,{contactCiphertextHex:"ab".repeat(40)});
  await expect(prepareAccountRequesterStatementMembers(g.options)).rejects.toThrow();
 });
 it("refuses a missing member or EOF and a correction substituted for an appeal",async()=>{
  const f=fixture();f.rows.pop();await expect(prepareAccountRequesterStatementMembers(f.options)).rejects.toThrow();
  const g=fixture();g.rows[1]=g.rows[0]!;await expect(prepareAccountRequesterStatementMembers(g.options)).rejects.toThrow();
 });
 it("rechecks authority before materialization and stops a revoked regenerated request",async()=>{
  const f=fixture();const prepared=await prepareAccountRequesterStatementMembers(f.options);
  f.options.check.mockRejectedValue(new Error("revoked"));
  await expect((async()=>{for await(const ignored of prepared.factories[0]!.chunks(f.options.signal))void ignored;})()).rejects.toThrow("revoked");
 });
 it("keeps the TEST switches mandatory",async()=>{
  vi.stubEnv("INHERIT_TEST_REQUESTER_STATEMENTS","0");await expect(prepareAccountRequesterStatementMembers(fixture().options)).rejects.toThrow();
 });
 it("refuses an expired original deadline without renewing it during regeneration",async()=>{
  const f=fixture();f.options.capture.originalDeadline=new Date(Date.now()-1).toISOString();
  await expect(prepareAccountRequesterStatementMembers(f.options)).rejects.toThrow();expect(f.options.call).not.toHaveBeenCalled();
 });
});
