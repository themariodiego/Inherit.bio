import crypto from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
const { encryptSecret, decryptSecret } = await import("@/lib/crypto");
const { claimDataKey,openDocumentBytes } = await import("./document-envelope");
const { sealClaimIntake } = await import("./claim-intake");
const { reviewCsrf, reviewCsrfMatches, mintReviewNonce, readReviewNonce,
  reviewDecisionBody, reviewCaseBody, sealReason,verifiedDocumentIdentity,verifiedIdentityDigestSet, downloadCookieHash, DOWNLOAD_COOKIE } = await import("./review");
afterAll(() => vi.unstubAllEnvs());

const ID = "7e000000-0000-4000-8000-000000000001";
const ACCOUNT = "7e000000-0000-4000-8000-000000000002";
const SESSION = "5e000000-0000-4000-8000-000000000001";
const NOW = Date.UTC(2026, 8, 30, 12);

describe("review decision authority binds the case, reviewer and session", () => {
  it("refuses each changed binding and malformed CSRF", () => {
    const csrf = reviewCsrf(ID, ACCOUNT, SESSION);
    expect(reviewCsrfMatches(csrf, ID, ACCOUNT, SESSION)).toBe(true);
    expect(reviewCsrfMatches(csrf, ACCOUNT, ACCOUNT, SESSION)).toBe(false);
    expect(reviewCsrfMatches(csrf, ID, ID, SESSION)).toBe(false);
    expect(reviewCsrfMatches(csrf, ID, ACCOUNT, ID)).toBe(false);
    for (const bad of [null, "", csrf.toUpperCase(), `${csrf}0`])
      expect(reviewCsrfMatches(bad, ID, ACCOUNT, SESSION)).toBe(false);
  });
  it("refuses a nonce for another case, reviewer, session, expired time or modified ciphertext", () => {
    const nonce = mintReviewNonce(ID, ACCOUNT, SESSION, NOW);
    expect(readReviewNonce(nonce, ID, ACCOUNT, SESSION, NOW)).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(readReviewNonce(nonce, ACCOUNT, ACCOUNT, SESSION, NOW)).toBeNull();
    expect(readReviewNonce(nonce, ID, ID, SESSION, NOW)).toBeNull();
    expect(readReviewNonce(nonce, ID, ACCOUNT, ID, NOW)).toBeNull();
    expect(readReviewNonce(nonce, ID, ACCOUNT, SESSION, NOW + 600001)).toBeNull();
    expect(readReviewNonce(`x${nonce.slice(1)}`, ID, ACCOUNT, SESSION, NOW)).toBeNull();
    expect(readReviewNonce("x".repeat(2049), ID, ACCOUNT, SESSION, NOW)).toBeNull();
  });
  it("accepts only a closed decision body and seals its professional basis", () => {
    const good = { decision: "reject", reviewRevision: 1,
      reason: "The synthetic evidence does not establish the required relationship.", nonce: "synthetic" };
    expect(reviewDecisionBody.safeParse(good).success).toBe(true);
    for (const bad of [{ ...good, matched: true }, { ...good, decision: "release" },
      { ...good, reviewRevision: 0 }, { ...good, reason: "short" }, { ...good, reason: `${good.reason}\u0000` }])
      expect(reviewDecisionBody.safeParse(bad).success).toBe(false);
    const intake=sealClaimIntake({mode:"record-key",recordKey:"0123456789ABCDEFGHJK",claimantName:"Synthetic Claimant",
      claimantDateOfBirth:"2000-01-31",contactEmail:"claimant@e2e.local",affirmed:true});
    const nonceHash="a".repeat(64);const wrapped=intake.wrappedDataKey.toString("hex");
    const sealed=sealReason(good.reason,wrapped,ID,nonceHash);const key=claimDataKey(wrapped);
    try {
      expect(openDocumentBytes(key,`claim-review-v1|${ID}|${nonceHash}|reason`,Buffer.from(sealed.slice(2),"hex"))?.toString("utf8")).toBe(good.reason);
      expect(openDocumentBytes(key,`claim-review-v1|${ID}|${nonceHash}|attestation`,Buffer.from(sealed.slice(2),"hex"))).toBeNull();
      expect(()=>decryptSecret(Buffer.from(sealed.slice(2),"hex"))).toThrow();
    } finally {key.fill(0);}
    expect(sealed).not.toContain(good.reason);
  });
});

describe("review case serialization withholds selectors and fails closed on sealed fields", () => {
  const sealed = sealClaimIntake({ mode: "record-key", recordKey: "0123456789ABCDEFGHJK",
    claimantName: "Synthetic Claimant", claimantDateOfBirth: "2000-01-31",
    contactEmail: "claimant@e2e.local", affirmed: true });
  const row = { claimId: ID, mode: "record-key", state: "document_review_pending", reviewRevision: 1,
    deadline: "2026-10-30T12:00:00.000Z", caseKind: "record_key_unmatched_or_ineligible",
    allowedDecisions: ["reject", "needs-more-information"], photoIdentityDocumentId: ACCOUNT,
    birthRecordDocumentId: SESSION, identityCiphertext: sealed.identityCiphertext.toString("hex"),
    wrappedDataKey: sealed.wrappedDataKey.toString("hex"), parentIdentityCiphertext: null };
  it("projects only registered fields and the opaque unmatched selector", () => {
    const body = reviewCaseBody(row);
    expect(body).toEqual({ claimId: ID, mode: "record-key", state: "document_review_pending", reviewRevision: 1,
      deadline: row.deadline, claimant: { fullName: "Synthetic Claimant", dateOfBirth: "2000-01-31" },
      evidence: { photoIdentityDocumentId: ACCOUNT, birthRecordDocumentId: SESSION },
      case: { kind: "record_key_unmatched_or_ineligible", selectorOutcome: "non_enumerating_unmatched_or_ineligible",
        allowedDecisions: ["reject", "needs-more-information"] }, notice: { state: "not_applicable", noticeRevision: null } });
    expect(JSON.stringify(body)).not.toMatch(/ciphertext|wrappedDataKey|keyHash|network|e2e.local/u);
  });
  it("uses genuine prior signed names for a Card without optional profile data and withholds the ciphertext",()=>{
    const signed={...row,caseKind:"record_key",allowedDecisions:["approve-record-key","reject","needs-more-information"],
      recordedParentSigningEvidence:[{nameCiphertext:encryptSecret("Synthetic Signed Parent A").toString("hex"),role:"genetic-parent"},
        {nameCiphertext:encryptSecret("Synthetic Signed Parent B").toString("hex"),role:"genetic-parent"}]};
    const body=reviewCaseBody(signed);
    expect(body?.case).toEqual({kind:"record_key",recordSelector:{matched:true},recordedParentLink:{
      evidencedParentRoles:["genetic-parent"],recordedParentNames:["Synthetic Signed Parent A","Synthetic Signed Parent B"]}});
    expect(JSON.stringify(body)).not.toMatch(/nameCiphertext|recordedParentSigningEvidence|wrappedDataKey|email/u);
    expect(reviewCaseBody({...signed,recordedParentSigningEvidence:[{...signed.recordedParentSigningEvidence[0],extra:"forbidden"}]})).toBeNull();
    expect(reviewCaseBody({...signed,recordedParentSigningEvidence:[{nameCiphertext:"aa".repeat(60),role:"genetic-parent"}]})).toBeNull();
    expect(reviewCaseBody({...signed,parentIdentityCiphertext:encryptSecret("ambiguous source").toString("hex")})).toBeNull();
    for(const caseKind of ["record_key_unmatched_or_ineligible","claimant_recovery_key","recovery_key_unmatched_or_ineligible","keyless_none","keyless_ambiguous"])
      expect(reviewCaseBody({...signed,caseKind})).toBeNull();
  });
  it("returns no case for unknown columns, malformed deadlines or unreadable encryption", () => {
    for (const bad of [{ ...row, matchedEmbryoId: ACCOUNT }, { ...row, deadline: "invalid" },
      { ...row, wrappedDataKey: "aa" }, { ...row, wrappedDataKey: encryptSecret("short").toString("hex") },
      { ...row, identityCiphertext: "aa" }, { ...row, caseKind: "record_key", parentIdentityCiphertext: "aa" }])
      expect(reviewCaseBody(bad)).toBeNull();
  });
});

it("download cookies identify exactly one well-formed secret", () => {
  const secret = crypto.randomBytes(32).toString("base64url");
  const cookie = `${DOWNLOAD_COOKIE}=${secret}`;
  const hash = crypto.createHash("sha256").update(secret).digest("hex");
  expect(downloadCookieHash(new Request("http://localhost", { headers: { cookie } }))).toBe(hash);
  for (const bad of ["", `${DOWNLOAD_COOKIE}=short`, `${cookie}; ${cookie}`])
    expect(downloadCookieHash(new Request("http://localhost", { headers: { cookie: bad } }))).toBeNull();
});

describe("verified document identity requires an adult named-human attestation",()=>{
  const identity={fullName:"Synthetic Claimant",dateOfBirth:"2000-01-31",photoIdentityReviewed:true as const,birthRecordReviewed:true as const,adultAgeConfirmed:true as const};
  it("refuses missing or false attestations and unknown fields on every approval",()=>{
    for(const decision of ["approve-record-key","approve-recovery-key","approve-claimed-unbound-no-key-recovery","keyless-document-match"]){
      const linked=decision==="approve-record-key"||decision==="keyless-document-match";
      const attestation={...identity,...(linked?{recordedParentLinkConfirmed:true}:{})};
      const keyless=decision==="approve-claimed-unbound-no-key-recovery"||decision==="keyless-document-match";
      const body={decision,reviewRevision:1,reason:"I reviewed both complete synthetic documents and their required link.",nonce:"synthetic",documentaryAttestation:attestation,
        ...(keyless?{verificationProof:"a".repeat(300)}:{})};
      expect(reviewDecisionBody.safeParse(body).success).toBe(true);
      for(const bad of [{...body,documentaryAttestation:undefined},{...body,documentaryAttestation:{...attestation,photoIdentityReviewed:false}},
        {...body,documentaryAttestation:{...attestation,guessedSubject:"forbidden"}}])expect(reviewDecisionBody.safeParse(bad).success).toBe(false);
      if(keyless)for(const verificationProof of [undefined,null,"short","a".repeat(1025),"a=".repeat(150)])
        expect(reviewDecisionBody.safeParse({...body,verificationProof}).success).toBe(false);
    }
  });
  it("uses calendar majority including the non-leap eighteenth birthday",()=>{
    vi.useFakeTimers();try {
      vi.setSystemTime(new Date("2026-02-27T23:59:59Z"));expect(verifiedDocumentIdentity.safeParse({...identity,dateOfBirth:"2008-02-29"}).success).toBe(false);
      vi.setSystemTime(new Date("2026-02-28T00:00:00Z"));expect(verifiedDocumentIdentity.safeParse({...identity,dateOfBirth:"2008-02-29"}).success).toBe(true);
      expect(verifiedDocumentIdentity.safeParse({...identity,dateOfBirth:"2008-03-01"}).success).toBe(false);
      for(const dateOfBirth of ["2000-02-30","1899-01-01","2020-01-01"])expect(verifiedDocumentIdentity.safeParse({...identity,dateOfBirth}).success).toBe(false);
    } finally{vi.useRealTimers();}
  });
  it("keeps purpose and held revisions distinct and keys the normalized exact tuple",()=>{
    const originalKey=process.env.BYOK_ENCRYPTION_KEY;
    vi.stubEnv("INHERIT_HMAC_KEYRING",`2:${crypto.randomBytes(32).toString("base64")}`);
    try {
      const digests=verifiedIdentityDigestSet(identity);
      expect(Object.keys(digests)).toEqual(["1","2"]);expect(digests["1"]).not.toBe(digests["2"]);
      expect(verifiedIdentityDigestSet({...identity,fullName:" Synthetic   CLAIMANT "})).toEqual(digests);
      expect(verifiedIdentityDigestSet({...identity,dateOfBirth:"2000-02-01"})["1"]).not.toBe(digests["1"]);
      const contact=crypto.createHash("sha256").update("synthetic claimant").digest("hex");
      expect(contact).not.toBe(digests["1"]);
    } finally{vi.unstubAllEnvs();vi.stubEnv("BYOK_ENCRYPTION_KEY",originalKey);}
  });
});
