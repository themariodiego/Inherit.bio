import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {appealIntakeBody,appealStatementAad,sealNewAppeal,openNewAppealForReviewer,openNewAppealOwnStatement} from "./appeal-case-envelope";
const id=(n:number)=>`82000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const scope={version:1 as const,caseKind:"appeal" as const,caseId:id(1),originalAuthorPrincipalId:id(2),initialStatementRevision:1 as const,
 originalSubmittedAt:"2026-10-04T11:00:00+00:00",originalDeadline:"2026-11-03T11:00:00+00:00",intakeKind:"subject-objection" as const};
const intake={kind:"subject-objection" as const,claimantName:"Synthetic Claimant",contactEmail:"synthetic@example.test",
 subjectReference:"Optional synthetic reference",statement:"Synthetic own appeal statement for source-only tests.",affirmed:true as const};
function ownEnvelope(envelope:ReturnType<typeof sealNewAppeal>){return {format:envelope.format,wrappedCaseKeyHex:envelope.wrappedCaseKeyHex,
 statementCiphertextHex:envelope.statementCiphertextHex};}
beforeEach(()=>vi.stubEnv("BYOK_ENCRYPTION_KEY",Buffer.alloc(32,83).toString("base64")));
afterEach(()=>vi.unstubAllEnvs());
// AUTHORED, UNRUN. Actual AES/closed parser tests supply no native case actor,
// reviewer assignment, current source, domain disposition or provider proof.
describe("NEW appeal independent encrypted producer",()=>{
 it("binds the exact frozen original author/revision/deadline AAD",()=>{
  expect(appealStatementAad(scope)).toBe(JSON.stringify(["reviewer-only-case-statement-v1",1,"appeal","subject-objection",
   id(1),id(2),1,scope.originalSubmittedAt,scope.originalDeadline,null]));
 });
 it("opens the genuine complete new package and limits the own DTO to statement",()=>{
  const envelope=sealNewAppeal(scope,intake);expect(envelope.wrappedCaseKeyHex).toHaveLength(144);
  expect(openNewAppealForReviewer(scope,envelope)).toEqual({version:1,intake,recipient:intake.contactEmail});
  const own=openNewAppealOwnStatement(scope,ownEnvelope(envelope));expect(own).toEqual({appealId:id(1),statement:intake.statement});
  expect(Object.keys(own!).sort()).toEqual(["appealId","statement"]);
 });
 it.each(["caseId","originalAuthorPrincipalId","originalDeadline","intakeKind"] as const)("refuses a different original %s",field=>{
  const envelope=sealNewAppeal(scope,intake),value=field==="originalDeadline"?"2026-11-04T11:00:00+00:00":field==="intakeKind"?"genetic-parent-objection":id(99);
  expect(openNewAppealForReviewer({...scope,[field]:value},envelope)).toBeNull();
 });
 it("refuses guessed legacy bytes, reviewer notes, contact override and target/account fields",()=>{
  const envelope=sealNewAppeal(scope,intake);expect(openNewAppealOwnStatement(scope,{...ownEnvelope(envelope),format:"legacy"})).toBeNull();
  expect(openNewAppealOwnStatement(scope,{...ownEnvelope(envelope),reviewerNotes:intake.statement})).toBeNull();
  expect(openNewAppealOwnStatement(scope,envelope)).toBeNull();
  for(const extra of [{accountId:id(99)},{subjectId:id(99)},{reviewer:id(99)},{contactEmailOverride:"other@example.test"}])
   expect(appealIntakeBody.safeParse({...intake,...extra}).success).toBe(false);
 });
 it("allows only the server recipient for a suspension package",()=>{
  const own={kind:"contradiction-suspension-appeal" as const,claimantName:intake.claimantName,statement:intake.statement,affirmed:true as const,
   suspensionNoticeReference:"syntheticNoticeReference123",nonce:"synthetic-operation-token"};
  const suspended={...scope,intakeKind:own.kind};expect(appealIntakeBody.safeParse({...own,contactEmail:intake.contactEmail}).success).toBe(false);
  expect(()=>sealNewAppeal(suspended,own)).toThrow();
  const envelope=sealNewAppeal(suspended,own,"verified-synthetic@example.test");
  expect(openNewAppealForReviewer(suspended,envelope)?.recipient).toBe("verified-synthetic@example.test");
  expect(openNewAppealForReviewer(suspended,envelope)?.intake).not.toHaveProperty("nonce");
  expect(JSON.stringify(openNewAppealForReviewer(suspended,envelope))).not.toContain(own.nonce);
 });
 it("normalizes before producer sealing and refuses tampered statement/package/contact",()=>{
  const normalized=appealIntakeBody.parse({...intake,claimantName:"  Synthetic Claimant  ",contactEmail:"SYNTHETIC@EXAMPLE.TEST"});
  const envelope=sealNewAppeal(scope,normalized);expect(openNewAppealForReviewer(scope,envelope)?.intake).toEqual(intake);
  for(const field of ["statementCiphertextHex","workingCiphertextHex","contactCiphertextHex"] as const){
   const value=envelope[field],mutated=`${value[0]==="a"?"b":"a"}${value.slice(1)}`;
   expect(openNewAppealForReviewer(scope,{...envelope,[field]:mutated})).toBeNull();
  }
  const own=ownEnvelope(envelope),first=own.statementCiphertextHex[0]==="a"?"b":"a";
  expect(openNewAppealOwnStatement(scope,{...own,statementCiphertextHex:`${first}${own.statementCiphertextHex.slice(1)}`})).toBeNull();
 });
});
