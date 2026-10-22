import {describe,expect,it} from "vitest";
import {keylessVerificationResponse,reviewPageCase,reviewPageDecisions} from "./review-page-contract";
const row={claimId:"33333333-3333-4333-8333-333333333333",mode:"record-key",state:"document_review_pending",reviewRevision:1,
 deadline:"2026-10-30T00:00:00.000Z",claimant:{fullName:"Synthetic Claimant",dateOfBirth:"2000-01-31"},
 evidence:{photoIdentityDocumentId:"11111111-1111-4111-8111-111111111111",birthRecordDocumentId:"22222222-2222-4222-8222-222222222222"},
 case:{kind:"record_key",recordSelector:{matched:true},recordedParentLink:{evidencedParentRoles:["genetic-parent"],recordedParentNames:["Synthetic Parent"]}},
 notice:{state:"not_applicable",noticeRevision:null}};
describe("the named reviewer page contract",()=>{
 it("offers only the implemented attested Record Key approval",()=>{
  const parsed=reviewPageCase.parse(row);expect(reviewPageDecisions(parsed)).toEqual(["reject","needs-more-information","approve-record-key"]);
 });
 it("offers the exact existing-principal documentary recovery transaction",()=>{
  const parsed=reviewPageCase.parse({...row,mode:"claimant-recovery-key",case:{kind:"claimant_recovery_key",recoverySelector:{matched:true},
   claimantBinding:{lifecycle:"claimed_unbound",identityHmacComparison:"pending_human_verified_document_tuple"}}});
  expect(reviewPageDecisions(parsed)).toEqual(["reject","needs-more-information","approve-recovery-key"]);
 });
 it("keeps ambiguous or unmatched keyless cases free of any release action",()=>{
  for(const kind of ["keyless_none","keyless_ambiguous"]){const parsed=reviewPageCase.parse({...row,mode:"keyless",case:{kind,selectorOutcome:"no_unique_candidate",allowedDecisions:["reject","needs-more-information"]}});
   expect(reviewPageDecisions(parsed)).toEqual(["reject","needs-more-information"]);}
 });
 it("offers each exact initial documentary transaction and never treats pending notice as release",()=>{
  for(const candidate of [{kind:"claimed_unbound_no_key_recovery",claimantBinding:{candidateClass:"exactly_one",
   lifecycle:"claimed_unbound",identityHmacComparison:"pending_human_verified_document_tuple"}},
   {kind:"unclaimed_keyless",candidateClass:"exactly_one",selectedProfile:{childDateOfBirth:"2000-01-31",
    childPlaceOfBirth:"Synthetic City",parentNames:["Synthetic Parent"]}}]){
   const reviewCase=reviewPageCase.parse({...row,mode:"keyless",case:candidate});
   expect(reviewPageDecisions(reviewCase)).toEqual(candidate.kind==="claimed_unbound_no_key_recovery"
    ?["reject","needs-more-information","approve-claimed-unbound-no-key-recovery"]:["reject","needs-more-information","keyless-document-match"]);
   const body={reviewCase,verificationProof:"a".repeat(300)};
   expect(keylessVerificationResponse.safeParse(body).success).toBe(true);
   expect(keylessVerificationResponse.safeParse({...body,verificationProof:null}).success).toBe(false);
   expect(keylessVerificationResponse.safeParse({...body,candidateCount:1}).success).toBe(false);
  }
  expect(keylessVerificationResponse.safeParse({reviewCase:row,verificationProof:"a".repeat(300)}).success).toBe(false);
 });
 it("keeps each pending notice state bound to one previously selected keyless case and separate decision operation",()=>{
  const pending={...row,mode:"keyless",state:"approved_pending_owner_notice",case:{kind:"unclaimed_keyless",candidateClass:"exactly_one",selectedProfile:{
   childDateOfBirth:"2000-01-31",childPlaceOfBirth:"Synthetic City",parentNames:["Synthetic Parent"]}}};
  for(const state of ["delivery_pending","notice_pending","objected"]){
   const parsed=reviewPageCase.parse({...pending,notice:{state,noticeRevision:2,deadline:state==="delivery_pending"?null:"2026-10-30T00:00:00+00:00"}});
   expect(reviewPageDecisions(parsed)).toEqual([]);
   expect(reviewPageCase.safeParse({...parsed,notice:{...parsed.notice,state:"not_applicable"}}).success).toBe(false);
   expect(reviewPageCase.safeParse({...parsed,state:"document_review_pending"}).success).toBe(false);
   expect(reviewPageCase.safeParse({...parsed,notice:{...parsed.notice,ownerAccountId:row.claimId}}).success).toBe(false);
  }
 });
 it.each([
  {...row,wrappedDataKey:"forbidden"},
  {...row,evidence:{...row.evidence,bucket:"forbidden"}},
  {...row,claimant:{...row.claimant,contactEmail:"synthetic@example.com"}},
  {...row,case:{...row.case,rawKey:"forbidden"}},
  {...row,notice:{state:"approved_pending_owner_notice",noticeRevision:1}},
  {...row,state:"closed"},
  {...row,mode:"keyless"},
  {...row,evidence:{...row.evidence,birthRecordDocumentId:row.evidence.photoIdentityDocumentId}},
 ])("refuses unknown secrets and unsupported closed or transferred shapes",value=>expect(reviewPageCase.safeParse(value).success).toBe(false));
});

describe("the actual client decoder for reviewer document and decision hints",()=>{
 const headers=(documents:string|null,decision:string|null,photo:string|null=null,birth:string|null=null)=>{
  const value=new Headers();
  for(const [name,content] of [["x-inherit-review-documents",documents],["x-inherit-review-decision",decision],
   ["x-inherit-photo-receipt-nonce",photo],["x-inherit-birth-receipt-nonce",birth]])if(content!==null)value.set(name!,content!);
  return value;
 };
 it("preserves current document reads and independent document-free operational decisions",async()=>{
  const {readReviewDocumentControls}=await import("./review-page-contract");
  expect(readReviewDocumentControls(headers("available","available","photo-proof","birth-proof"),"document_review_pending"))
   .toEqual({documentsAvailable:true,decisionAvailable:true,photoNonce:"photo-proof",birthNonce:"birth-proof"});
  expect(readReviewDocumentControls(headers("held","available"),"approved_pending_owner_notice"))
   .toEqual({documentsAvailable:false,decisionAvailable:true,photoNonce:null,birthNonce:null});
  expect(readReviewDocumentControls(headers("held","held"),"approved_pending_owner_notice"))
   .toEqual({documentsAvailable:false,decisionAvailable:false,photoNonce:null,birthNonce:null});
 });
 it.each([
  {documents:null,decision:"available",photo:"photo-proof",birth:"birth-proof"},
  {documents:"available",decision:null,photo:"photo-proof",birth:"birth-proof"},
  {documents:"unknown",decision:"available",photo:"photo-proof",birth:"birth-proof"},
  {documents:"available",decision:"unknown",photo:"photo-proof",birth:"birth-proof"},
  {documents:"available",decision:"held",photo:"photo-proof",birth:"birth-proof"},
  {documents:"available",decision:"available",photo:null,birth:"birth-proof"},
  {documents:"available",decision:"available",photo:"photo-proof",birth:null},
  {documents:"available",decision:"available",photo:"",birth:"birth-proof"},
  {documents:"available",decision:"available",photo:"photo-proof",birth:""},
  {documents:"available",decision:"available",photo:"p".repeat(2049),birth:"birth-proof"},
  {documents:"available",decision:"available",photo:"photo-proof",birth:"b".repeat(2049)},
  {documents:"held",decision:"held",photo:"photo-proof",birth:null},
  {documents:"held",decision:"available",photo:null,birth:"birth-proof"},
 ])("refuses malformed or contradictory delivered hints: %j",async value=>{
  const {readReviewDocumentControls}=await import("./review-page-contract");
  expect(readReviewDocumentControls(headers(value.documents,value.decision,value.photo,value.birth),"approved_pending_owner_notice")).toBeNull();
 });
 it.each(["document_review_pending","more_information_required"] as const)("refuses held hints for a nonpending %s case",async state=>{
  const {readReviewDocumentControls}=await import("./review-page-contract");
  expect(readReviewDocumentControls(headers("held","held"),state)).toBeNull();
  expect(readReviewDocumentControls(headers("held","available"),state)).toBeNull();
 });
});
