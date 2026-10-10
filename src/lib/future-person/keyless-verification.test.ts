import crypto from "node:crypto";
import {afterAll,describe,expect,it,vi} from "vitest";
vi.stubEnv("BYOK_ENCRYPTION_KEY",crypto.randomBytes(32).toString("base64"));
vi.stubEnv("INHERIT_HMAC_KEYRING","");
const {sealClaimIntake}=await import("./claim-intake");
const {sealIdentityProfile}=await import("./identity-profile");
const {keylessVerificationIndexes,shapeKeylessVerification,keylessVerificationBody}=await import("./keyless-verification");
afterAll(()=>vi.unstubAllEnvs());
const id=(last:number)=>`7b000000-0000-4000-8000-${String(last).padStart(12,"0")}`;
const human={fullName:"Synthetic Claimant",dateOfBirth:"2000-01-01",photoIdentityReviewed:true as const,
  birthRecordReviewed:true as const,adultAgeConfirmed:true as const};
const intake={mode:"keyless-start" as const,claimantName:"Unverified claimant label",contactEmail:"synthetic@e2e.local",
  childDateOfBirth:"2001-01-01",childPlaceOfBirth:"Synthetic City",parentNames:["Synthetic Parent"],affirmed:true as const};
const sealed=sealClaimIntake(intake);
const expected={reviewId:id(1),accountId:id(2),sessionId:id(3),reviewRevision:1};
const scope={reviewId:id(1),reviewerAccountId:id(2),authSessionId:id(3),reviewRevision:1,assignmentRevision:2,
  accountAuthRevision:3,originatingSessionRevision:4,photoIdentity:{id:id(4),sha256:"a".repeat(64)},
  birthRecord:{id:id(5),sha256:"b".repeat(64)},comparisonReceiptDigest:"c".repeat(64)};
const row={claimId:id(1),mode:"keyless",state:"document_review_pending",reviewRevision:1,
  deadline:"2026-10-30T12:00:00.000Z",caseKind:"keyless_none",allowedDecisions:["reject","needs-more-information"],
  photoIdentityDocumentId:id(4),birthRecordDocumentId:id(5),identityCiphertext:sealed.identityCiphertext.toString("hex"),
  wrappedDataKey:sealed.wrappedDataKey.toString("hex"),parentIdentityCiphertext:null};
const raw={case:row,scope,profile:null};
const profileScope={profileId:id(6),embryoId:id(7),identityRevision:1};
function selected(overrides:Record<string,unknown>={}){
  const written=sealIdentityProfile({childDateOfBirth:human.dateOfBirth,childPlaceOfBirth:intake.childPlaceOfBirth,
    parentNames:intake.parentNames,consentSignatureId:id(8),...overrides},profileScope);
  return {...raw,case:{...row,caseKind:"unclaimed_keyless",allowedDecisions:["keyless-document-match","reject","needs-more-information"]},
    profile:{...profileScope,ciphertext:written.ciphertext.toString("hex"),wrappedKey:written.wrappedKey.toString("hex")}};
}

describe("human-verified keyless lookup projection",()=>{
  it("accepts only the closed documentary request and keeps intake dates out of adult proof",()=>{
    const body={reviewRevision:1,documentaryAttestation:human,nonce:"recent-proof"};
    expect(keylessVerificationBody.safeParse(body).success).toBe(true);
    for(const bad of [{...body,selectedSubject:id(7)},{...body,documentaryAttestation:{...human,parentLink:true}},
      {...body,documentaryAttestation:{...human,adultAgeConfirmed:false}},
      {...body,documentaryAttestation:{...human,dateOfBirth:"2020-01-01"}}])
      expect(keylessVerificationBody.safeParse(bad).success).toBe(false);
    const verified=keylessVerificationIndexes(intake,human)!;
    expect(verified).not.toEqual(keylessVerificationIndexes({...intake,childPlaceOfBirth:"Different City"},human));
    expect(verified).toEqual(keylessVerificationIndexes({...intake,childDateOfBirth:"2020-01-01"},human));
    expect(keylessVerificationIndexes(intake,{...human,adultAgeConfirmed:false} as never)).toBeNull();
  });
  it.each(["keyless_none","keyless_ambiguous"])("returns only the closed refusal projection for %s",kind=>{
    const shaped=shapeKeylessVerification({...raw,case:{...row,caseKind:kind}},expected,human)!;
    expect(shaped.reviewCase.case).toEqual({kind,selectorOutcome:"no_unique_candidate",allowedDecisions:["reject","needs-more-information"]});
    expect(Object.keys(shaped.scope).sort()).toEqual([...Object.keys(scope),"verifiedTupleDigest"].sort());
    for(const forbidden of ["contactEmail","candidateCount","profileId","embryoId","matchedSubject","ciphertext","wrappedKey"])
      expect(JSON.stringify(shaped.reviewCase)).not.toContain(`"${forbidden}"`);
  });
  it("projects exactly one prior claimant without opening a parent-controlled profile",()=>{
    const given={...raw,case:{...row,caseKind:"claimed_unbound_no_key_recovery",
      allowedDecisions:["approve-claimed-unbound-no-key-recovery","reject","needs-more-information"]}};
    expect(shapeKeylessVerification(given,expected,human)?.reviewCase.case).toEqual({kind:"claimed_unbound_no_key_recovery",
      claimantBinding:{candidateClass:"exactly_one",lifecycle:"claimed_unbound",identityHmacComparison:"pending_human_verified_document_tuple"}});
    expect(shapeKeylessVerification({...given,profile:selected().profile},expected,human)).toBeNull();
  });
  it("opens only the exact independently wrapped selected profile and proves its full indexed tuple",()=>{
    const actual=selected(),shaped=shapeKeylessVerification(actual,expected,human)!;
    expect(shaped.reviewCase.case).toEqual({kind:"unclaimed_keyless",candidateClass:"exactly_one",selectedProfile:{
      childDateOfBirth:human.dateOfBirth,childPlaceOfBirth:intake.childPlaceOfBirth,parentNames:intake.parentNames}});
    for(const bad of [selected({childDateOfBirth:"2001-01-01"}),selected({childPlaceOfBirth:"Different City"}),
      selected({parentNames:["Different Parent"]}),{...actual,profile:{...actual.profile,embryoId:id(99)}},
      {...actual,profile:{...actual.profile,identityRevision:2}},{...actual,profile:{...actual.profile,wrappedKey:"0".repeat(144)}},
      {...actual,profile:null}])expect(shapeKeylessVerification(bad,expected,human)).toBeNull();
    const normal=selected({childPlaceOfBirth:" SYNTHETIC  CITY ",parentNames:[" synthetic  parent "]});
    expect(shapeKeylessVerification(normal,expected,human)).not.toBeNull();
    expect(JSON.stringify(shaped.reviewCase)).not.toContain(intake.contactEmail);
    expect(JSON.stringify(shaped.reviewCase)).not.toContain(profileScope.profileId);
  });
  it("refuses altered own-JWT authority, document linkage, case matrix and recursive unknown fields",()=>{
    for(const bad of [{...raw,scope:{...scope,reviewerAccountId:id(99)}},{...raw,scope:{...scope,authSessionId:id(99)}},
      {...raw,scope:{...scope,reviewRevision:2}},{...raw,scope:{...scope,photoIdentity:{...scope.photoIdentity,id:id(99)}}},
      {...raw,scope:{...scope,assignmentRevision:0}},{...raw,scope:{...scope,verifiedTupleDigest:"d".repeat(64)}},
      {...raw,candidateCount:0},{...raw,case:{...row,matchedEmbryoId:id(7)}},
      {...raw,case:{...row,allowedDecisions:["keyless-document-match","reject","needs-more-information"]}},
      {...raw,case:{...row,mode:"record-key"}},{...raw,profile:selected().profile}])
      expect(shapeKeylessVerification(bad,expected,human)).toBeNull();
  });
});
