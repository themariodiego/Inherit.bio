import {describe,expect,it} from "vitest";
import {reviewPageCase,reviewPageDecisions} from "./review-page-contract";
const row={claimId:"33333333-3333-4333-8333-333333333333",mode:"record-key",state:"document_review_pending",reviewRevision:1,
 deadline:"2026-10-30T00:00:00.000Z",claimant:{fullName:"Synthetic Claimant",dateOfBirth:"2000-01-31"},
 evidence:{photoIdentityDocumentId:"11111111-1111-4111-8111-111111111111",birthRecordDocumentId:"22222222-2222-4222-8222-222222222222"},
 case:{kind:"record_key",recordSelector:{matched:true},recordedParentLink:{evidencedParentRoles:["genetic-parent"],recordedParentNames:["Synthetic Parent"]}},
 notice:{state:"not_applicable",noticeRevision:null}};
describe("the named reviewer page contract",()=>{
 it("offers only the implemented attested Record Key approval",()=>{
  const parsed=reviewPageCase.parse(row);expect(reviewPageDecisions(parsed)).toEqual(["reject","needs-more-information","approve-record-key"]);
 });
 it("keeps recovery approval closed until its fresh recovery transaction exists",()=>{
  const parsed=reviewPageCase.parse({...row,mode:"claimant-recovery-key",case:{kind:"claimant_recovery_key",recoverySelector:{matched:true},
   claimantBinding:{lifecycle:"claimed_unbound",identityHmacComparison:"pending_human_verified_document_tuple"}}});
  expect(reviewPageDecisions(parsed)).toEqual(["reject","needs-more-information"]);
 });
 it("keeps ambiguous or unmatched keyless cases free of any release action",()=>{
  for(const kind of ["keyless_none","keyless_ambiguous"]){const parsed=reviewPageCase.parse({...row,mode:"keyless",case:{kind,selectorOutcome:"no_unique_candidate",allowedDecisions:["reject","needs-more-information"]}});
   expect(reviewPageDecisions(parsed)).toEqual(["reject","needs-more-information"]);}
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
