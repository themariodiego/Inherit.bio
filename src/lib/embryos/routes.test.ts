import { describe, expect, it } from "vitest";
import {
  EMBRYO_ANALYSIS_GRANT_STATEMENT_KEYS,
  EMBRYO_ARTIFACT_KEYS,
  EMBRYO_ARTIFACT_STATEMENT_KEYS,
  EMBRYO_UPLOAD_UPLOADER_STATEMENT_KEYS,
} from "./basis";
import {
  COHORT_DRAFT_CREATED_KEYS,
  DISPOSITIONS,
  acceptedJurisdictionCode,
  coParentAcceptBody,
  coParentInvitationBody,
  cohortDraftBody,
  cohortDraftCreated,
  dispositionBody,
  dispositionResponse,
  dispositionRpcArgs,
  draftContacts,
  draftRequestIssues,
  grantCohortPurposeBody,
  isAnalysisGrantStatementSet,
  isEmbryoArtifactKey,
  isEmbryoConsentPayload,
  isPublishedStatementSet,
  normalizeContact,
  recordKeyCardsBody,
  rightsActivateBody,
  sameStatementKeys,
  signDraftArtifactBody,
  signingJurisdictionCode,
  type CohortDraftRequest,
} from "./routes";

const DRAFT_ID = "11111111-1111-4111-8111-111111111111";
const COHORT_ID = "22222222-2222-4222-8222-222222222222";
const EMBRYO_ID = "33333333-3333-4333-8333-333333333333";
const PROPOSAL_ID = "44444444-4444-4444-8444-444444444444";
const TOKEN = "a".repeat(32);
const OWNER = "Owner@Example.org";

function ownDraft(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    uploadSituation: "own-embryos",
    basis: "two-evidenced-parents",
    donorAttributionIntent: "none",
    embryoCount: 3,
    otherRequiredPrincipalContacts: ["Other@Example.org"],
    ...overrides,
  };
}

function thirdPartyDraft(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    uploadSituation: "with-genetic-parents-permission",
    basis: "two-evidenced-parents",
    donorAttributionIntent: "none",
    embryoCount: 2,
    requiredGeneticPrincipalContacts: ["one@example.org", "two@example.org"],
    ...overrides,
  };
}

/**
 * The closed bodies and pure mappings of the embryo routes (contract §6):
 * every body refuses an unknown key, contacts are normalised before they
 * are counted, the draft issues follow §6.1 in order, the consents branch
 * is chosen by target key alone, and the disposition RPC's jsonb becomes
 * exactly one of the register's three shapes or throws.
 */
describe("api.embryo-cohort-drafts body", () => {
  it("accepts both situation bodies and normalises every contact", () => {
    const own = cohortDraftBody.parse(ownDraft());
    expect(draftContacts(own)).toEqual(["other@example.org"]);
    const third = cohortDraftBody.parse(thirdPartyDraft({ requiredGeneticPrincipalContacts: ["  One@Example.org ", "two@example.org"] }));
    expect(draftContacts(third)).toEqual(["one@example.org", "two@example.org"]);
  });

  it.each([
    ["an unknown key", ownDraft({ cycleLabel: "x" })],
    ["a forbidden label", ownDraft({ sex: "x" })],
    ["the other situation's contact field", ownDraft({ requiredGeneticPrincipalContacts: [] })],
    ["a zero count", ownDraft({ embryoCount: 0 })],
    ["a count above the maximum", ownDraft({ embryoCount: 65 })],
    ["a fractional count", ownDraft({ embryoCount: 1.5 })],
    ["an unknown basis", ownDraft({ basis: "surrogacy" })],
    ["an unknown intent", ownDraft({ donorAttributionIntent: "maybe" })],
    ["a malformed contact", ownDraft({ otherRequiredPrincipalContacts: ["not-an-address"] })],
    ["a contact over 254 bytes", ownDraft({ otherRequiredPrincipalContacts: [`${"a".repeat(250)}@x.org`] })],
    ["three contacts", thirdPartyDraft({ requiredGeneticPrincipalContacts: ["a@x.org", "b@x.org", "c@x.org"] })],
    ["no body", null],
  ])("refuses %s", (_name, body) => {
    expect(cohortDraftBody.safeParse(body).success).toBe(false);
  });

  it("refuses a contact whose bytes exceed 254 even when its characters do not", () => {
    const local = "é".repeat(130);
    expect(cohortDraftBody.safeParse(ownDraft({ otherRequiredPrincipalContacts: [`${local}@x.org`] })).success).toBe(false);
  });
});

describe("draftRequestIssues", () => {
  const parse = (body: Record<string, unknown>): CohortDraftRequest => cohortDraftBody.parse(body);

  it("names the identified-donor intent before anything else", () => {
    const body = parse(ownDraft({ donorAttributionIntent: "identified-donor-subject", otherRequiredPrincipalContacts: [] }));
    expect(draftRequestIssues(body, OWNER)).toEqual(["identified_donor_attribution_unavailable"]);
  });

  it.each([
    ["own/two-parent with one contact", ownDraft(), []],
    ["own/two-parent with no contact", ownDraft({ otherRequiredPrincipalContacts: [] }), ["contacts"]],
    ["own/single with no contact", ownDraft({ basis: "donor-gamete-anonymous", otherRequiredPrincipalContacts: [] }), []],
    ["own/single with one contact", ownDraft({ basis: "parent-deceased" }), ["contacts"]],
    ["third-party/two-parent with two contacts", thirdPartyDraft(), []],
    ["third-party/two-parent with one contact", thirdPartyDraft({ requiredGeneticPrincipalContacts: ["one@example.org"] }), ["contacts"]],
    ["third-party/single with one contact", thirdPartyDraft({ basis: "sole-legal-disposition-authority", requiredGeneticPrincipalContacts: ["one@example.org"] }), []],
    ["third-party/single with two contacts", thirdPartyDraft({ basis: "donor-gamete-anonymous" }), ["contacts"]],
    ["the owner's own address in any case", ownDraft({ otherRequiredPrincipalContacts: [" owner@example.ORG "] }), ["contacts"]],
    ["a repeated contact", thirdPartyDraft({ requiredGeneticPrincipalContacts: ["one@example.org", "ONE@example.org"] }), ["contacts"]],
  ])("%s", (_name, body, issues) => {
    expect(draftRequestIssues(parse(body), OWNER)).toEqual(issues);
  });

  it("builds the 201 body from the RPC row with no attribution slot", () => {
    const body = cohortDraftCreated({
      draft_id: DRAFT_ID,
      expires_at: "2026-10-05T10:00:00.000Z",
      required_principal_slots: ["other-genetic-parent"],
    });
    expect(body).toEqual({
      cohortDraftId: DRAFT_ID,
      state: "awaiting_uploader_artifacts",
      next: "sign_uploader_artifacts",
      requiredPrincipalSlots: ["other-genetic-parent"],
      optionalAttributionSlots: [],
      expiresAt: "2026-10-05T10:00:00.000Z",
    });
    expect(Object.keys(body).sort()).toEqual([...COHORT_DRAFT_CREATED_KEYS].sort());
  });

  it("normalises a contact by trimming and lower-casing only", () => {
    expect(normalizeContact("  A.B@Example.ORG ")).toBe("a.b@example.org");
  });
});

describe("api.consents embryo bodies", () => {
  const signature = {
    action: "sign-artifact",
    signatureClass: "tier2",
    cohortDraftId: DRAFT_ID,
    artifactVersion: 1,
    artifactPresentationToken: TOKEN,
    affirmed: true,
    statementKeys: [...EMBRYO_ARTIFACT_STATEMENT_KEYS["consent.upload-embryo"]],
    typedName: "Ada Lovelace",
  };
  const grant = {
    action: "grant-purpose",
    cohortId: COHORT_ID,
    purposeKey: "embryo.analysis",
    artifactVersion: 1,
    artifactPresentationToken: TOKEN,
    affirmed: true,
    statementKeys: [...EMBRYO_ANALYSIS_GRANT_STATEMENT_KEYS],
    typedName: "Ada Lovelace",
  };

  it("takes the embryo branch on the target key alone and leaves every adult body to the existing route", () => {
    expect(isEmbryoConsentPayload(signature)).toBe(true);
    expect(isEmbryoConsentPayload(grant)).toBe(true);
    expect(isEmbryoConsentPayload({ ...signature, cohortDraftId: undefined })).toBe(true);
    expect(isEmbryoConsentPayload({ action: "sign-artifact", subjectId: DRAFT_ID })).toBe(false);
    expect(isEmbryoConsentPayload({ action: "sign-artifact", subjectDraftId: DRAFT_ID })).toBe(false);
    expect(isEmbryoConsentPayload({ action: "grant-purpose", subjectId: DRAFT_ID, purposeKey: "embryo.analysis" })).toBe(false);
    expect(isEmbryoConsentPayload({ providerKey: "anthropic" })).toBe(false);
    expect(isEmbryoConsentPayload({ cohortId: COHORT_ID })).toBe(false);
    expect(isEmbryoConsentPayload(null)).toBe(false);
    expect(isEmbryoConsentPayload([signature])).toBe(false);
  });

  it("parses the two bodies and refuses every forbidden or missing field", () => {
    expect(signDraftArtifactBody.safeParse(signature).success).toBe(true);
    expect(grantCohortPurposeBody.safeParse(grant).success).toBe(true);
    for (const bad of [
      { ...signature, artifactKey: "consent.upload-embryo" },
      { ...signature, signatureClass: "tier1-self" },
      { ...signature, affirmed: false },
      { ...signature, cohortDraftId: "not-a-uuid" },
      { ...signature, statementKeys: [] },
      { ...signature, typedName: undefined },
    ]) {
      expect(signDraftArtifactBody.safeParse(bad).success).toBe(false);
    }
    for (const bad of [
      { ...grant, purposeKey: "family.portrait" },
      { ...grant, subjectId: DRAFT_ID },
      { ...grant, recipientRevision: 1 },
      { ...grant, affirmed: true, artifactVersion: 0 },
    ]) {
      expect(grantCohortPurposeBody.safeParse(bad).success).toBe(false);
    }
  });

  it("recognises the published statement sets for every artifact and the grant", () => {
    for (const key of EMBRYO_ARTIFACT_KEYS) {
      expect(isEmbryoArtifactKey(key)).toBe(true);
      expect(isPublishedStatementSet(key, EMBRYO_ARTIFACT_STATEMENT_KEYS[key])).toBe(true);
      expect(isPublishedStatementSet(key, [...EMBRYO_ARTIFACT_STATEMENT_KEYS[key]].reverse())).toBe(
        EMBRYO_ARTIFACT_STATEMENT_KEYS[key].length === 1,
      );
      expect(isPublishedStatementSet(key, [])).toBe(false);
    }
    expect(isPublishedStatementSet("consent.upload-embryo", EMBRYO_UPLOAD_UPLOADER_STATEMENT_KEYS)).toBe(true);
    expect(isPublishedStatementSet("attestation.embryo-parentage", EMBRYO_UPLOAD_UPLOADER_STATEMENT_KEYS)).toBe(false);
    expect(isEmbryoArtifactKey("consent.share-with-adult")).toBe(false);
    expect(isAnalysisGrantStatementSet(EMBRYO_ANALYSIS_GRANT_STATEMENT_KEYS)).toBe(true);
    expect(isAnalysisGrantStatementSet(EMBRYO_ARTIFACT_STATEMENT_KEYS["consent.upload-embryo"])).toBe(false);
    expect(sameStatementKeys(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameStatementKeys(["a", "b"], ["b", "a"])).toBe(false);
    expect(sameStatementKeys(["a"], ["a", "a"])).toBe(false);
  });

  it.each([
    [null, "ZZ"],
    [undefined, "ZZ"],
    ["", "ZZ"],
    ["gb", "GB"],
    [" DE ", "DE"],
    ["GB-ENG", "GB"],
    ["US-CA", "US"],
    ["TEST-LOCAL", "ZZ"],
    ["GBR", "ZZ"],
    ["G1", "ZZ"],
  ])("records %s as the signing jurisdiction %s", (raw, expected) => {
    expect(signingJurisdictionCode(raw)).toBe(expected);
  });

  it.each<[string, string | null]>([
    ["GB", "GB"],
    ["US", "US"],
    ["GB-ENG", "GB"],
    ["US-CA", "US"],
    ["gb", "GB"],
    [" de ", "DE"],
    ["XX", null],
    ["ZZ", null],
    ["XX-ABC", null],
    ["TEST-LOCAL", null],
    ["GBR", null],
    ["G1", null],
    ["", null],
    ["   ", null],
  ])("accepts %s for persistence as %s only when the register knows the country", (raw, expected) => {
    expect(acceptedJurisdictionCode(raw)).toBe(expected);
  });
});

describe("api.invitations and api.rights-activate bodies", () => {
  it("accepts only the co-parent body with a normalised contact", () => {
    const parsed = coParentInvitationBody.parse({ targetCohortDraftId: DRAFT_ID, contactEmail: " Parent@Example.org " });
    expect(parsed.contactEmail).toBe("parent@example.org");
    for (const bad of [
      { targetSubjectDraftId: DRAFT_ID, contactEmail: "parent@example.org" },
      { targetCohortDraftId: DRAFT_ID, contactEmail: "parent@example.org", note: "hello" },
      { targetCohortDraftId: DRAFT_ID, contactEmail: "parent@example.org", participantRole: "parent_b" },
      { targetCohortDraftId: DRAFT_ID },
      { kind: "other_adult", adultFlow: "path-a-own-account", email: "parent@example.org", adultAttestation: true, requestId: DRAFT_ID },
    ]) {
      expect(coParentInvitationBody.safeParse(bad).success).toBe(false);
    }
  });

  it("requires a 43-character token and a form nonce, nothing else", () => {
    const token = "b".repeat(43);
    expect(rightsActivateBody.safeParse({ token, nonce: TOKEN }).success).toBe(true);
    expect(rightsActivateBody.safeParse({ token: "b".repeat(42), nonce: TOKEN }).success).toBe(false);
    expect(rightsActivateBody.safeParse({ token, nonce: "short" }).success).toBe(false);
    expect(rightsActivateBody.safeParse({ token, nonce: TOKEN, next: "/x" }).success).toBe(false);
  });
});

describe("api.invitation-accept body", () => {
  const artifact = (artifactKey: string, statementKeys: readonly string[]) => ({
    artifactVersion: 1,
    artifactPresentationToken: TOKEN,
    affirmed: true,
    statementKeys: [...statementKeys],
    typedName: "Ada Lovelace",
    artifactKey,
  });
  const body = {
    nonce: TOKEN,
    coParentArtifacts: {
      uploadEmbryo: artifact("consent.upload-embryo", EMBRYO_ARTIFACT_STATEMENT_KEYS["consent.upload-embryo"]),
      parentageAttestation: artifact("attestation.embryo-parentage", EMBRYO_ARTIFACT_STATEMENT_KEYS["attestation.embryo-parentage"]),
    },
    jurisdictionCode: "GB",
  };

  it("accepts the co-parent body and refuses the adult body, swapped keys and a jurisdiction triple", () => {
    expect(coParentAcceptBody.safeParse(body).success).toBe(true);
    const swapped = {
      ...body,
      coParentArtifacts: {
        uploadEmbryo: body.coParentArtifacts.parentageAttestation,
        parentageAttestation: body.coParentArtifacts.uploadEmbryo,
      },
    };
    expect(coParentAcceptBody.safeParse(swapped).success).toBe(false);
    expect(coParentAcceptBody.safeParse({ ...body, jurisdictionCode: "gb" }).success).toBe(false);
    expect(coParentAcceptBody.safeParse({ ...body, jurisdictionCode: "GB-ENG" }).success).toBe(false);
    expect(coParentAcceptBody.safeParse({ ...body, jurisdictionAffirmed: true }).success).toBe(false);
    expect(coParentAcceptBody.safeParse({ ...body, cohortDraftId: DRAFT_ID }).success).toBe(false);
    expect(coParentAcceptBody.safeParse({ nonce: TOKEN, subjectArtifact: body.coParentArtifacts.uploadEmbryo, jurisdictionCode: "GB" }).success).toBe(false);
    expect(coParentAcceptBody.safeParse({ ...body, coParentArtifacts: { ...body.coParentArtifacts, donor: {} } }).success).toBe(false);
  });
});

describe("api.embryo-record-key-cards body", () => {
  it("takes the nonce and nothing else", () => {
    expect(recordKeyCardsBody.safeParse({ nonce: TOKEN }).success).toBe(true);
    expect(recordKeyCardsBody.safeParse({ nonce: TOKEN, embryoId: EMBRYO_ID }).success).toBe(false);
    expect(recordKeyCardsBody.safeParse({}).success).toBe(false);
  });
});

describe("api.embryo-disposition", () => {
  it("maps each action body to the RPC arguments, with a proposal id only on confirm", () => {
    expect(DISPOSITIONS).toEqual(["stored", "transferred", "donated", "discarded"]);
    expect(dispositionRpcArgs(dispositionBody.parse({ action: "propose", disposition: "stored", nonce: TOKEN }))).toEqual({
      p_action: "propose",
      p_disposition: "stored",
      p_proposal_id: null,
    });
    expect(
      dispositionRpcArgs(dispositionBody.parse({ action: "confirm", proposalId: PROPOSAL_ID, disposition: "transferred", nonce: TOKEN })),
    ).toEqual({ p_action: "confirm", p_disposition: "transferred", p_proposal_id: PROPOSAL_ID });
    expect(dispositionRpcArgs(dispositionBody.parse({ action: "commit-single-authority", disposition: "donated", nonce: TOKEN }))).toEqual({
      p_action: "commit-single-authority",
      p_disposition: "donated",
      p_proposal_id: null,
    });
  });

  it.each([
    ["propose with a proposal id", { action: "propose", proposalId: PROPOSAL_ID, disposition: "stored", nonce: TOKEN }],
    ["confirm without a proposal id", { action: "confirm", disposition: "stored", nonce: TOKEN }],
    ["an unknown disposition", { action: "propose", disposition: "kept", nonce: TOKEN }],
    ["a forbidden field", { action: "propose", disposition: "stored", nonce: TOKEN, transferredAt: "2026-01-01" }],
    ["a missing nonce", { action: "propose", disposition: "stored" }],
    ["an unknown action", { action: "veto", disposition: "stored", nonce: TOKEN }],
  ])("refuses %s", (_name, body) => {
    expect(dispositionBody.safeParse(body).success).toBe(false);
  });

  const AT = "2026-09-05T10:00:00.123Z";
  const LATER = "2028-09-05T10:00:00.123Z";

  it("turns the awaiting receipt into a 202", () => {
    expect(dispositionResponse({ status: "awaiting_other_parent", proposalId: PROPOSAL_ID, expiresAt: AT })).toEqual({
      status: 202,
      body: { status: "awaiting_other_parent", proposalId: PROPOSAL_ID, expiresAt: AT },
    });
  });

  it("turns a non-transfer commit into the four-key 200", () => {
    for (const disposition of ["stored", "donated", "discarded"]) {
      expect(dispositionResponse({ embryoId: EMBRYO_ID, disposition, effectiveAt: AT, retentionExpiresAt: LATER })).toEqual({
        status: 200,
        body: { embryoId: EMBRYO_ID, disposition, effectiveAt: AT, retentionExpiresAt: LATER },
      });
    }
  });

  it("turns a transfer into the delivery shape with the replacement card composed for the recipient", () => {
    const card = { record_key: "0123456789ABCDEFGHJK", closing_date_iso: "2047-06-05", closing_date_state: "definitive_transferred_claim_window" };
    const delivered = dispositionResponse(
      { embryoId: EMBRYO_ID, disposition: "transferred", effectiveAt: AT, retentionExpiresAt: LATER, recipientSetRevision: 2, callerState: "delivered_inline", card },
      "https://www.inherit.bio",
    );
    expect(delivered).toEqual({
      status: 200,
      body: {
        embryoId: EMBRYO_ID,
        disposition: "transferred",
        effectiveAt: AT,
        retentionExpiresAt: LATER,
        recordKeyDelivery: { recipientSetRevision: 2, callerState: "delivered_inline" },
        recordKeyCard: {
          recordKey: "0123456789ABCDEFGHJK",
          claimUrl: "https://www.inherit.bio/future-person/claim",
          closingDateWords: "5 June 2047",
          closingDateIso: "2047-06-05",
          closingDateState: "definitive_transferred_claim_window",
        },
      },
    });
    const withheld = dispositionResponse({
      embryoId: EMBRYO_ID,
      disposition: "transferred",
      effectiveAt: AT,
      retentionExpiresAt: LATER,
      recipientSetRevision: 2,
      callerState: "not_a_card_recipient",
      card: null,
    });
    expect(withheld.status).toBe(200);
    expect(withheld.body).toMatchObject({ recordKeyDelivery: { callerState: "not_a_card_recipient" }, recordKeyCard: null });
  });

  it.each([
    ["an extra key on the receipt", { status: "awaiting_other_parent", proposalId: PROPOSAL_ID, expiresAt: AT, parentId: DRAFT_ID }],
    ["an extra key on a commit", { embryoId: EMBRYO_ID, disposition: "stored", effectiveAt: AT, retentionExpiresAt: LATER, sex: "x" }],
    ["a transfer through the plain commit shape", { embryoId: EMBRYO_ID, disposition: "transferred", effectiveAt: AT, retentionExpiresAt: LATER }],
    ["a card for a non-recipient", { embryoId: EMBRYO_ID, disposition: "transferred", effectiveAt: AT, retentionExpiresAt: LATER, recipientSetRevision: 2, callerState: "not_a_card_recipient", card: { record_key: "0123456789ABCDEFGHJK", closing_date_iso: "2047-06-05", closing_date_state: "definitive_transferred_claim_window" } }],
    ["no card for a recipient", { embryoId: EMBRYO_ID, disposition: "transferred", effectiveAt: AT, retentionExpiresAt: LATER, recipientSetRevision: 2, callerState: "delivered_inline", card: null }],
    ["a key outside the alphabet", { embryoId: EMBRYO_ID, disposition: "transferred", effectiveAt: AT, retentionExpiresAt: LATER, recipientSetRevision: 2, callerState: "delivered_inline", card: { record_key: "0123456789ABCDEFGHIL", closing_date_iso: "2047-06-05", closing_date_state: "definitive_transferred_claim_window" } }],
    ["a provisional card date on a transfer", { embryoId: EMBRYO_ID, disposition: "transferred", effectiveAt: AT, retentionExpiresAt: LATER, recipientSetRevision: 2, callerState: "delivered_inline", card: { record_key: "0123456789ABCDEFGHJK", closing_date_iso: "2047-06-05", closing_date_state: "provisional_until_terminal_ordinal_resolution" } }],
    ["a timestamp without a zone", { embryoId: EMBRYO_ID, disposition: "stored", effectiveAt: "2026-09-05 10:00:00", retentionExpiresAt: LATER }],
    ["nothing", null],
  ])("throws on %s so the route blocks the response", (_name, result) => {
    expect(() => dispositionResponse(result)).toThrow();
  });
});
