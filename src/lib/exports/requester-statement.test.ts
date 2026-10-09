import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {sealNewCorrection} from "../future-person/correction-case-envelope";
import {openRequesterCorrectionStatement,requesterStatementsOpen} from "../future-person/requester-statement";
import {nativeAccountStatement,accountOwnStatementCapture} from "./requester-statement-account-members";
import {createRequesterStatementMemorySpool} from "./requester-statement-spool";
import {createRequesterStatementRuntime} from "./requester-statement-runtime";
const id=(n:number)=>`81000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const scope={version:1 as const,caseKind:"correction" as const,caseId:id(1),originalAuthorPrincipalId:id(2),
 initialStatementRevision:1 as const,originalSubmittedAt:"2026-10-03T18:00:00+00:00",originalDeadline:"2026-11-02T18:00:00+00:00",
 requestedField:"display-label" as const,originalSubjectId:id(3)};
const binding={rightsSessionId:id(4),principalId:id(2),subjectId:id(3),authorityRevision:1,tokenHashId:id(5),
 principalRevision:1,lifecycleRevision:1,bindingRevision:1,sourceReceipt:"a".repeat(64),caseHash:"b".repeat(64)};
const statement="Synthetic own correction statement for source-only cryptographic tests.";
beforeEach(()=>vi.stubEnv("BYOK_ENCRYPTION_KEY",Buffer.alloc(32,71).toString("base64")));
afterEach(()=>vi.unstubAllEnvs());
// AUTHORED, UNRUN. These parser/crypto/buffer tests cannot prove native owner,
// current session, source receipt, provider disposal or browser release gates.
describe("TEST own-statement cryptography and closed output",()=>{
 it("opens the actual new package and emits exactly the statement DTO",()=>{
  const frame={scope,binding,envelope:sealNewCorrection(scope,statement)};
  expect(openRequesterCorrectionStatement(frame,id(1))).toEqual({correctionId:id(1),statement});
  expect(Object.keys(openRequesterCorrectionStatement(frame,id(1))!).sort()).toEqual(["correctionId","statement"]);
 });
 it.each(["principalId","subjectId"] as const)("refuses a different current requester %s",field=>{
  const frame={scope,binding:{...binding,[field]:id(99)},envelope:sealNewCorrection(scope,statement)};
  expect(openRequesterCorrectionStatement(frame,id(1))).toBeNull();
 });
 it("refuses notes, extra authority, legacy format, absent keys and another case",()=>{
  const frame={scope,binding,envelope:sealNewCorrection(scope,statement)};
  for(const bad of [{...frame,reviewerNotes:statement},{...frame,binding:{...binding,isReviewer:true}},
   {...frame,envelope:{...frame.envelope,format:"legacy"}},
   {...frame,envelope:{...frame.envelope,wrappedCaseKeyHex:""}}])expect(openRequesterCorrectionStatement(bad,id(1))).toBeNull();
  expect(openRequesterCorrectionStatement(frame,id(99))).toBeNull();
 });
 it("keeps default production closed and requires both explicit TEST switches",()=>{
  expect(requesterStatementsOpen({})).toBe(false);
  expect(requesterStatementsOpen({INHERIT_TEST_REQUESTER_STATEMENTS:"1"})).toBe(false);
  expect(requesterStatementsOpen({INHERIT_TEST_JURISDICTION:"1"})).toBe(false);
  expect(requesterStatementsOpen({INHERIT_TEST_JURISDICTION:"1",INHERIT_TEST_REQUESTER_STATEMENTS:"1"})).toBe(true);
 });
 it("does not adopt a rights-session proof as an account-binding proof",()=>{
  expect(nativeAccountStatement.safeParse({scope,binding,envelope:sealNewCorrection(scope,statement)}).success).toBe(false);
 });
 it("checks complete partition counts and the preserved case deadline",()=>{
  const good={version:"test-account-own-statements-v1",corrections:1,appeals:0,membershipSha256:"c".repeat(64),
   originalDeadline:scope.originalDeadline,partitions:[{subjectId:id(3),rows:1}]};
  expect(accountOwnStatementCapture.safeParse(good).success).toBe(true);
  for(const bad of [{...good,appeals:1},{...good,corrections:0},{...good,originalDeadline:null},
   {...good,partitions:[...good.partitions,...good.partitions]}])expect(accountOwnStatementCapture.safeParse(bad).success).toBe(false);
 });
});
describe("actual controlled mutable copy disposal",()=>{
 it("zeros the memory-spool replay copy and refuses reuse",async()=>{
  const spool=createRequesterStatementMemorySpool(),signal=new AbortController().signal,record=new Uint8Array(74).fill(7);
  await spool.append(record,signal);const reader=spool.replay(signal).getReader();const output=(await reader.read()).value!;
  expect(output.some(byte=>byte===7)).toBe(true);await spool.dispose();expect(output.every(byte=>byte===0)).toBe(true);
  await expect(spool.append(record,signal)).rejects.toThrow();expect(()=>spool.replay(signal)).toThrow();
  await reader.cancel();reader.releaseLock();
 });
 it("refuses payload-sized central records",async()=>{
  const spool=createRequesterStatementMemorySpool();await expect(spool.append(new Uint8Array(330),new AbortController().signal)).rejects.toThrow();await spool.dispose();
 });
 it("does not equate task admission or an expired bound with disposal",async()=>{
  const runtime=createRequesterStatementRuntime();expect(()=>runtime.assertSettled()).toThrow();
  await expect(runtime.settle(Date.now()-1)).rejects.toThrow();
 });
});
