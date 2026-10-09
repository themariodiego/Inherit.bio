import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sealNewAppeal } from "./appeal-case-envelope";
import { appealReviewRow, publicAppealReviewBody, appealDocumentDecisionBody, sealAppealDecisionReference, openAppealDecisionNotice } from "./public-appeal-review";
const id=(n:number)=>`84000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const now=new Date(),deadline=new Date(now.getTime()+30*86400000).toISOString();
const scope={version:1,caseKind:"appeal",caseId:id(1),originalAuthorPrincipalId:id(2),initialStatementRevision:1,
 originalSubmittedAt:now.toISOString(),originalDeadline:deadline,intakeKind:"subject-objection"};
function fixture(){ const envelope=sealNewAppeal(scope,{kind:"subject-objection",claimantName:"Synthetic Claimant",contactEmail:"synthetic@example.test",
 statement:"This is the original statement for a synthetic documentary review.",affirmed:true});
 return {caseId:id(1),caseKind:"subject-objection",scope,reviewRevision:1,evidenceRevision:1,deadline,...envelope,
  documents:[{documentId:id(3),documentKind:"appeal-photo-identity",sha256:"a".repeat(64),decision:null},
   {documentId:id(4),documentKind:"appeal-subject-source-control",sha256:"b".repeat(64),decision:null}]}; }
function native(){const {format:_format,...row}=fixture();void _format;return row;}
beforeEach(()=>vi.stubEnv("BYOK_ENCRYPTION_KEY",Buffer.alloc(32,83).toString("base64")));
afterEach(()=>vi.unstubAllEnvs());
describe("assigned appeal documentary projection",()=>{
 it("opens only the original complete package and keeps target disposition unresolved",()=>{
  const row=native();const opened=publicAppealReviewBody(row);expect(opened?.statement).toContain("original statement");
  expect(opened?.contactEmail).toBe("synthetic@example.test");expect(opened?.targetBinding.state).toBe("unresolved");
  expect(Object.keys(opened!)).toEqual(["caseId","kind","submittedAt","claimantName","contactEmail","reference","statement","targetBinding","contradictionOverturnPackage","evidence","reviewRevision","deadline"]);
  expect(JSON.stringify(opened)).not.toContain(row.wrappedCaseKeyHex);
 });
 it("compares exact native clock instants without assuming PG and JS render them identically",()=>{
  expect(appealReviewRow.safeParse({...native(),deadline:deadline.replace("Z","+00:00")}).success).toBe(true);
 });
 it.each(["caseId","caseKind","deadline"])("refuses a mismatched native %s",field=>{
  const row=native();const bad=field==="caseId"?id(9):field==="caseKind"?"genetic-parent-objection":new Date(Date.parse(deadline)+1).toISOString();
  expect(publicAppealReviewBody({...row,[field]:bad})).toBeNull();
 });
 it("refuses contact/target/notes expansion or a swapped native document kind",()=>{
  const row=native();expect(publicAppealReviewBody({...row,targetAccount:id(9)})).toBeNull();
  expect(publicAppealReviewBody({...row,documents:[row.documents[0],{...row.documents[1],documentKind:"appeal-genetic-parent-authority"}]})).toBeNull();
 });
 it("refuses foreign scoped ciphertext, duplicate documents and absent authority",()=>{
  const row=native();expect(publicAppealReviewBody({...row,scope:{...scope,caseId:id(9)}})).toBeNull();
  expect(publicAppealReviewBody({...row,documents:[row.documents[0],row.documents[0]]})).toBeNull();
  expect(publicAppealReviewBody({...row,documents:[row.documents[0]]})).toBeNull();
 });
 it("requires all three exact native access-review document kinds",()=>{
  const row=native();const access={...row,caseKind:"access-or-review-appeal",scope:{...scope,intakeKind:"access-or-review-appeal"},
   documents:[...row.documents,{documentId:id(5),documentKind:"appeal-decision-notice",sha256:"c".repeat(64),decision:null}]};
  expect(appealReviewRow.safeParse(access).success).toBe(true);expect(appealReviewRow.safeParse({...access,documents:row.documents}).success).toBe(false);
 });
});
describe("original verified case decision notice",()=>{
 function notice(){const row=native(),nonce="d".repeat(64),reference=sealAppealDecisionReference(row.wrappedCaseKeyHex,id(1),id(4),nonce);
  return {scope,wrappedCaseKeyHex:row.wrappedCaseKeyHex,decisions:[{documentId:id(4),documentKind:"appeal-subject-source-control",decision:"rejected",
   nonceHash:nonce,referenceCiphertextHex:reference.ciphertext.slice(2),referenceHash:reference.hash}]};}
 it("returns the actual decryptable native-bound rejection reference and only closed public fields",()=>{
  const row=notice();const opened=openAppealDecisionNotice(row)!;expect(opened.decisions[0]!.decisionReference).toMatch(/^[0-9a-f]{48}$/u);
  expect(crypto.createHash("sha256").update(opened.decisions[0]!.decisionReference!).digest("hex")).toBe(row.decisions[0]!.referenceHash);
  expect(Object.keys(opened)).toEqual(["deadline","decisions"]);expect(Object.keys(opened.decisions[0]!)).toEqual(["documentKind","decision","decisionReference"]);
 });
 it.each(["documentId","nonceHash","referenceHash","referenceCiphertextHex"])("refuses reference substitution in %s",field=>{
  const row=notice();const value=field==="documentId"?id(8):field==="referenceCiphertextHex"?"ee".repeat(76):"e".repeat(64);
  expect(openAppealDecisionNotice({...row,decisions:[{...row.decisions[0],[field]:value}]})).toBeNull();
 });
 it("refuses a foreign case scope or reviewer notes in a notice",()=>{
  const row=notice();expect(openAppealDecisionNotice({...row,scope:{...scope,caseId:id(8)}})).toBeNull();
  expect(openAppealDecisionNotice({...row,decisions:[{...row.decisions[0],reason:"private reviewer notes"}]})).toBeNull();
 });
 it("does not turn photo approval into an access-review reference",()=>{
  const row=notice();expect(openAppealDecisionNotice({...row,decisions:[{...row.decisions[0],decision:"approved"}]})).toEqual({deadline,decisions:[{
   documentKind:"appeal-subject-source-control",decision:"approved",decisionReference:null}]});
 });
});
describe("document-only decisions",()=>{
 const body={decision:"rejected",documentSha256:"a".repeat(64),reviewRevision:1,nonce:"synthetic-native-bound-nonce",reason:"The whole document does not establish the stated source control."};
 it("retains documentary approval/refusal without target or account decisions",()=>expect(appealDocumentDecisionBody.safeParse(body).success).toBe(true));
 it.each([{decision:"approve-access"},{decision:"rejected-documentary-conflict"},{targetId:id(9)},{accountId:id(9)},{reason:"short"},{reviewRevision:0}])(
  "refuses broader or invalid authority %j",extra=>expect(appealDocumentDecisionBody.safeParse({...body,...extra}).success).toBe(false));
});
