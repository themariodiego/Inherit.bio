import crypto from "node:crypto";
import {afterAll,describe,expect,it,vi} from "vitest";

vi.stubEnv("BYOK_ENCRYPTION_KEY",crypto.randomBytes(32).toString("base64"));
const {encryptSecret,decryptSecret}=await import("@/lib/crypto");
const {sealKeylessVerificationProof,keylessVerificationProofMatches}=await import("./keyless-verification-proof");
afterAll(()=>vi.unstubAllEnvs());
const id=(last:number)=>`7a000000-0000-4000-8000-${String(last).padStart(12,"0")}`;
const NOW=Date.UTC(2026,9,1);
const scope={reviewId:id(1),reviewerAccountId:id(2),authSessionId:id(3),reviewRevision:2,assignmentRevision:3,
  accountAuthRevision:4,originatingSessionRevision:5,photoIdentity:{id:id(4),sha256:"a".repeat(64)},
  birthRecord:{id:id(5),sha256:"b".repeat(64)},verifiedTupleDigest:"c".repeat(64),comparisonReceiptDigest:"d".repeat(64)};

describe("keyless verification is a bounded encrypted receipt, never independent approval",()=>{
  it("uses fresh encryption and remains valid only inside the original ten-minute boundary",()=>{
    const first=sealKeylessVerificationProof(scope,NOW),second=sealKeylessVerificationProof(scope,NOW);
    expect(first).not.toBe(second);
    expect(keylessVerificationProofMatches(first,scope,NOW)).toBe(true);
    expect(keylessVerificationProofMatches(first,scope,NOW+599999)).toBe(true);
    for(const clock of [NOW-1,NOW+600000,NOW+600001,NaN,Infinity,-1,1.5])
      expect(keylessVerificationProofMatches(first,scope,clock)).toBe(false);
    for(const field of [scope.reviewId,scope.reviewerAccountId,scope.authSessionId,scope.verifiedTupleDigest,scope.comparisonReceiptDigest])
      expect(Buffer.from(first,"base64url").toString("utf8")).not.toContain(field);
    expect(()=>decryptSecret(Buffer.from(first,"base64url"))).toThrow();
  });
  it.each(["reviewId","reviewerAccountId","authSessionId"] as const)("refuses changed %s",field=>{
    expect(keylessVerificationProofMatches(sealKeylessVerificationProof(scope,NOW),{...scope,[field]:id(99)},NOW)).toBe(false);
  });
  it.each(["reviewRevision","assignmentRevision","accountAuthRevision","originatingSessionRevision"] as const)("refuses rotated %s",field=>{
    expect(keylessVerificationProofMatches(sealKeylessVerificationProof(scope,NOW),{...scope,[field]:scope[field]+1},NOW)).toBe(false);
  });
  it.each(["photoIdentity","birthRecord"] as const)("refuses replaced or redigested %s",field=>{
    const token=sealKeylessVerificationProof(scope,NOW);
    expect(keylessVerificationProofMatches(token,{...scope,[field]:{...scope[field],id:id(99)}},NOW)).toBe(false);
    expect(keylessVerificationProofMatches(token,{...scope,[field]:{...scope[field],sha256:"e".repeat(64)}},NOW)).toBe(false);
    expect(keylessVerificationProofMatches(token,{...scope,photoIdentity:scope.birthRecord,birthRecord:scope.photoIdentity},NOW)).toBe(false);
  });
  it.each(["verifiedTupleDigest","comparisonReceiptDigest"] as const)("refuses different current %s",field=>{
    expect(keylessVerificationProofMatches(sealKeylessVerificationProof(scope,NOW),{...scope,[field]:"e".repeat(64)},NOW)).toBe(false);
  });
  it("refuses malformed scopes, duplicate documents, unknown authority and noncanonical encoding",()=>{
    const token=sealKeylessVerificationProof(scope,NOW);
    for(const bad of [{...scope,reviewRevision:0},{...scope,assignmentRevision:Number.MAX_SAFE_INTEGER+1},
      {...scope,photoIdentity:scope.birthRecord},{...scope,verifiedTupleDigest:"X".repeat(64)},
      {...scope,candidateCount:1},{...scope,photoIdentity:{...scope.photoIdentity,read:true}}]){
      expect(()=>sealKeylessVerificationProof(bad,NOW)).toThrow("claim verification unavailable");
      expect(keylessVerificationProofMatches(token,bad,NOW)).toBe(false);
    }
    const changedPrefix=`${token[0]==="x"?"y":"x"}${token.slice(1)}`;
    for(const bad of [null,{},"",`${token}=`,` ${token}`,changedPrefix,token.slice(1),"a".repeat(1025),
      encryptSecret("{} ").toString("base64url")]){
      expect(bad).not.toBe(token);
      expect(keylessVerificationProofMatches(bad,scope,NOW)).toBe(false);
    }
    for(const clock of [NaN,Infinity,-1,1.5,Number.MAX_SAFE_INTEGER])expect(()=>sealKeylessVerificationProof(scope,clock)).toThrow();
  });
  it("refuses deployment-key rotation without a historical proof fallback",()=>{
    const token=sealKeylessVerificationProof(scope,NOW),previous=process.env.BYOK_ENCRYPTION_KEY!;
    vi.stubEnv("BYOK_ENCRYPTION_KEY",crypto.randomBytes(32).toString("base64"));
    try{expect(keylessVerificationProofMatches(token,scope,NOW)).toBe(false);}finally{vi.stubEnv("BYOK_ENCRYPTION_KEY",previous);}
  });
});
