import { describe, expect, it } from "vitest";
import {
  cohortOutcome,
  coParentArtifactsLeft,
  ownerArtifactsLeft,
  ownerStage,
  resolveUploadStage,
  type DraftFacts,
} from "./upload-stage-core";

/**
 * The stage decider against the rules `finalize_embryo_cohort_v1` and
 * `sign_embryo_artifact_v1` enforce. Every identifier is invented.
 */
const OWNER = "a0000000-0000-4000-8000-00000000000a";
const OTHER = "b0000000-0000-4000-8000-00000000000b";
const P_OWNER = "10000000-0000-4000-8000-000000000001";
const P_OTHER = "20000000-0000-4000-8000-000000000002";
const UPLOADER = "30000000-0000-4000-8000-000000000003";

function draft(overrides: Partial<DraftFacts> = {}): DraftFacts {
  return {
    id: "d0000000-0000-4000-8000-00000000000d",
    ownerAccountId: OWNER,
    uploaderPrincipalId: UPLOADER,
    uploadSituation: "own_embryos",
    basisCase: "true_two_parent",
    fixedExpiresAt: "2026-10-28T00:00:00.000Z",
    createdAt: "2026-09-28T10:00:00.000Z",
    slots: [
      { kind: "parent_a", principalId: P_OWNER, state: "current", principalAccountId: OWNER, principalActive: true, principalKind: "genetic_parent" },
      { kind: "parent_b", principalId: P_OTHER, state: "pending", principalAccountId: null, principalActive: false, principalKind: "genetic_parent" },
    ],
    signatures: [],
    invitations: [],
    ...overrides,
  };
}

let serial = 0;
const sig = (artifactKey: string, signerPrincipalId: string, purpose: string | null = null) =>
  ({ id: `sig-${++serial}`, artifactKey, signerPrincipalId, purpose, signedAt: `2026-09-28T11:00:${String(serial).padStart(2, "0")}.000Z` });
const ownerSigned = [
  sig("consent.upload-embryo", P_OWNER, "embryo-upload-parent-class"),
  sig("attestation.embryo-parentage", P_OWNER),
  sig("attestation.embryo-disposition-rights", P_OWNER),
];
const accepted = (d: DraftFacts): DraftFacts => ({
  ...d,
  slots: d.slots.map((slot) => slot.principalId === P_OTHER
    ? { ...slot, state: "current", principalAccountId: OTHER, principalActive: true } : slot),
  invitations: [{ inviteePrincipalId: P_OTHER, status: "accepted" }],
  signatures: [...d.signatures, sig("consent.upload-embryo", P_OTHER, "embryo-upload-parent-class"),
    sig("attestation.embryo-parentage", P_OTHER)],
});

describe("the owner's stages on a two-parent draft", () => {
  it("signs three statements, then invites, then waits, then acknowledges", () => {
    expect(ownerStage(draft())).toMatchObject({ kind: "owner-sign", artifacts: [
      { key: "consent.upload-embryo", role: "parent" }, { key: "attestation.embryo-parentage", role: "parent" },
      { key: "attestation.embryo-disposition-rights", role: "parent" }] });
    const signedByOwner = draft({ signatures: ownerSigned });
    expect(ownerStage(signedByOwner)).toMatchObject({ kind: "invite", count: 1 });
    const invited = { ...signedByOwner, invitations: [{ inviteePrincipalId: P_OTHER, status: "pending" }] };
    expect(ownerStage(invited)).toMatchObject({ kind: "waiting" });
    // Accepting signs two of the co-parent's three statements; the record still waits.
    const joined = accepted(signedByOwner);
    expect(ownerStage(joined)).toMatchObject({ kind: "waiting" });
    const complete = { ...joined, signatures: [...joined.signatures, sig("attestation.embryo-disposition-rights", P_OTHER)] };
    expect(ownerStage(complete)).toEqual({ kind: "acknowledge", draftId: complete.id, signed: {}, artifacts: [
      { key: "disclosure.insurance-and-discrimination", role: "owner" }, { key: "charter.future-person", role: "owner" }] });
  });

  it("carries acknowledgements already signed, so a reload finalizes without signing twice", () => {
    const joined = accepted(draft({ signatures: ownerSigned }));
    const insurance = sig("disclosure.insurance-and-discrimination", UPLOADER);
    const complete = { ...joined, signatures: [...joined.signatures, sig("attestation.embryo-disposition-rights", P_OTHER), insurance] };
    expect(ownerStage(complete)).toMatchObject({ kind: "acknowledge", signed: { "disclosure.insurance-and-discrimination": insurance.id },
      artifacts: [{ key: "charter.future-person" }] });
  });

  it("a refused or expired invitation leaves the slot to invite again", () => {
    const d = draft({ signatures: ownerSigned, invitations: [{ inviteePrincipalId: P_OTHER, status: "refused" }] });
    expect(ownerStage(d)).toMatchObject({ kind: "invite" });
  });

  it("an upload consent signed for the uploader class does not count for a parent", () => {
    const d = draft({ signatures: [sig("consent.upload-embryo", P_OWNER, "embryo-upload-uploader-class")] });
    expect(ownerArtifactsLeft(d).map((a) => a.key)).toContain("consent.upload-embryo");
  });
});

describe("single-parent bases", () => {
  const single = (basisCase: DraftFacts["basisCase"]) => draft({ basisCase, slots: [draft().slots[0]] });

  it("adds the single-parent statement, then acknowledges on an anonymous donor basis", () => {
    const d = single("anonymous_donor");
    expect(ownerStage(d)).toMatchObject({ kind: "owner-sign" });
    expect((ownerStage(d) as { artifacts: { key: string }[] }).artifacts.map((a) => a.key))
      .toContain("attestation.embryo-single-parent-basis");
    const signed = { ...d, signatures: [...ownerSigned, sig("attestation.embryo-single-parent-basis", P_OWNER)] };
    expect(ownerStage(signed)).toMatchObject({ kind: "acknowledge" });
  });

  it("stops at the evidence review a deceased-parent or sole-authority basis needs", () => {
    for (const basis of ["parent_deceased", "sole_legal_authority"] as const) {
      const d = single(basis);
      const signed = { ...d, signatures: [...ownerSigned, sig("attestation.embryo-single-parent-basis", P_OWNER)] };
      expect(ownerStage(signed)).toEqual({ kind: "evidence-review-unavailable", draftId: d.id });
    }
  });
});

describe("a third-party upload", () => {
  const third = draft({
    uploadSituation: "with_genetic_parents_permission",
    slots: [
      { kind: "parent_a", principalId: P_OWNER, state: "pending", principalAccountId: null, principalActive: false, principalKind: "genetic_parent" },
      { kind: "parent_b", principalId: P_OTHER, state: "pending", principalAccountId: null, principalActive: false, principalKind: "genetic_parent" },
    ],
  });
  it("signs the uploader-class consent, then invites both parents", () => {
    expect(ownerStage(third)).toMatchObject({ kind: "owner-sign", artifacts: [{ key: "consent.upload-embryo", role: "uploader" }] });
    const signed = { ...third, signatures: [sig("consent.upload-embryo", UPLOADER, "embryo-upload-uploader-class")] };
    expect(ownerStage(signed)).toMatchObject({ kind: "invite", count: 2 });
  });
});

describe("the co-parent", () => {
  it("is offered only what acceptance did not sign, and never the upload consent", () => {
    const joined = accepted(draft({ signatures: ownerSigned }));
    expect(coParentArtifactsLeft(joined, OTHER)).toEqual([{ key: "attestation.embryo-disposition-rights", role: "parent" }]);
    expect(coParentArtifactsLeft(joined, OWNER)).toEqual([]);
    expect(resolveUploadStage({ accountId: OTHER, ownedDraft: null, coParentDrafts: [joined], latestCohort: null }))
      .toEqual({ stage: { kind: "co-parent-sign", draftId: joined.id, artifacts: [{ key: "attestation.embryo-disposition-rights", role: "parent" }] }, notice: null });
    const done = { ...joined, signatures: [...joined.signatures, sig("attestation.embryo-disposition-rights", P_OTHER)] };
    expect(resolveUploadStage({ accountId: OTHER, ownedDraft: null, coParentDrafts: [done], latestCohort: null }))
      .toEqual({ stage: { kind: "start" }, notice: "co-parent-done" });
  });

  it("is offered nothing on a slot it has not accepted", () => {
    expect(coParentArtifactsLeft(draft({ signatures: ownerSigned }), OTHER)).toEqual([]);
  });
});

describe("after finalizing", () => {
  const cohort = (status: string, sessionStatus: string | null) =>
    ({ id: "c0000000-0000-4000-8000-00000000000c", createdAt: "2026-09-28T12:00:00.000Z", status, sessionStatus });

  it("reads the record's outcome from the cohort and its latest upload session", () => {
    expect(cohortOutcome(cohort("upload_pending", "open"))).toBe("upload-left");
    expect(cohortOutcome(cohort("upload_pending", "sanitization_pending"))).toBe("processing");
    expect(cohortOutcome(cohort("ingesting", "processing"))).toBe("processing");
    expect(cohortOutcome(cohort("upload_pending", "failure_pending"))).toBe("upload-failed");
    expect(cohortOutcome(cohort("restricted", "failed"))).toBe("upload-failed");
    expect(cohortOutcome(cohort("active", "published"))).toBeNull();
  });

  it("shows the checking panel while the latest record is processing, and a notice above a new start otherwise", () => {
    const base = { accountId: OWNER, ownedDraft: null, coParentDrafts: [] };
    expect(resolveUploadStage({ ...base, latestCohort: cohort("ingesting", "processing") }).stage).toMatchObject({ kind: "processing" });
    expect(resolveUploadStage({ ...base, latestCohort: cohort("upload_pending", "open") })).toEqual({ stage: { kind: "start" }, notice: "upload-left" });
    expect(resolveUploadStage({ ...base, latestCohort: cohort("active", "published") })).toEqual({ stage: { kind: "start" }, notice: null });
  });

  it("a newer open draft wins over an older record's outcome", () => {
    const newer = draft({ createdAt: "2026-09-28T13:00:00.000Z" });
    expect(resolveUploadStage({ accountId: OWNER, ownedDraft: newer, coParentDrafts: [],
      latestCohort: cohort("ingesting", "processing") }).stage).toMatchObject({ kind: "owner-sign" });
  });
});
