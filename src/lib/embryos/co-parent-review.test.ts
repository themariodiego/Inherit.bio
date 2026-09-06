import crypto from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { encryptSecret, hmacSecret } from "@/lib/crypto";
import { loadCoParentReview } from "./co-parent-review";
import { RIGHTS_COOKIE_NAME, rightsSessionHash } from "./rights-session";
import { verifyEmbryoOperation } from "./operation-token";
import { readArtifactPresentation } from "@/lib/family/grant-token";

const mocks = vi.hoisted(() => ({ admin: vi.fn(), context: vi.fn(), artifact: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/account-deletion", () => ({ getSensitiveAccountContext: mocks.context }));
vi.mock("@/lib/legal/artifacts", () => ({ getCurrentArtifact: mocks.artifact }));

const NOW = 1_800_000_000_000;
const EXPIRY = new Date(NOW + 60_000).toISOString();
const IDS = { account: crypto.randomUUID(), auth: crypto.randomUUID(), draft: crypto.randomUUID(), principal: crypto.randomUUID(), inviter: crypto.randomUUID() };
const EMAIL = "invited@e2e.local";
let secret: string;
let rows: Record<string, Record<string, unknown>[]>;
let reads: { table: string; fields: string }[];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
  vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");
  secret = crypto.randomBytes(32).toString("base64url");
  reads = [];
  rows = {
    rights_sessions: [{ session_hash: rightsSessionHash(secret), purpose: "co-parent-invitation", target_kind: "cohort_draft", target_id: IDS.draft, principal_id: IDS.principal, authority_revision: 2, status: "active", expires_at: EXPIRY }],
    subject_invitations: [{ id: crypto.randomUUID(), invitee_principal_id: IDS.principal, inviter_principal_id: IDS.inviter, target_kind: "cohort_draft", target_id: IDS.draft, invitation_kind: "co_parent", status: "pending", invitation_revision: 2, email_hmac: hmacSecret(EMAIL, "contact-email-v1"), expires_at: EXPIRY }],
    embryo_cohort_drafts: [{ id: IDS.draft, embryo_count: 3, owner_account_id: crypto.randomUUID(), state: "draft", fixed_expires_at: EXPIRY, upload_situation: "own_embryos", basis_case: "true_two_parent" }],
    subject_principals: [{ id: IDS.principal, status: "pending", principal_kind: "genetic_parent" }],
    draft_participant_slots: [{ id: crypto.randomUUID(), embryo_draft_id: IDS.draft, principal_id: IDS.principal, state: "pending", slot_kind: "parent_b" }],
    profiles: [{ id: IDS.account, deletion_requested_at: null }],
    consent_signatures: [{ signer_principal_id: IDS.inviter, target_kind: "cohort_draft", target_id: IDS.draft, artifact_key: "consent.upload-embryo", signing_name_encrypted: `\\x${encryptSecret("Synthetic Inviter").toString("hex")}` }],
  };
  rows.consent_signatures[0].signer_account_id = rows.embryo_cohort_drafts[0].owner_account_id;
  mocks.context.mockResolvedValue({ user: { id: IDS.account, email: EMAIL, email_confirmed_at: EXPIRY }, sessionId: IDS.auth });
  mocks.artifact.mockImplementation(async (key: string) => ({ artifact_key: key, version: 1, body_sha256: "b".repeat(64), body_markdown: "Full signed body", summary_markdown: "Summary", effective_on: "2026-09-05", summary_of_changes: null }));
  mocks.admin.mockReturnValue({ from(table: string) {
    let matched = rows[table] ?? [];
    const query = {
      select(fields: string) { reads.push({ table, fields }); return query; },
      eq(field: string, value: unknown) { matched = matched.filter(row => row[field] === value); return query; },
      gt(field: string, value: string) { matched = matched.filter(row => String(row[field]) > value); return query; },
      in(field: string, values: unknown[]) { matched = matched.filter(row => values.includes(row[field])); return query; },
      order() { return query; }, limit() { return query; },
      async maybeSingle() { return { data: matched.length === 1 ? matched[0] : null, error: null }; },
    };
    return query;
  } });
});
afterEach(() => vi.unstubAllEnvs());

function request(cookie = `${RIGHTS_COOKIE_NAME}=${secret}`) {
  return new Request("https://inherit.bio/withdraw/session", { headers: { cookie } });
}

describe("co-parent invitation review authority", () => {
  it("does not create an admin client without a well-shaped cookie", async () => {
    expect(await loadCoParentReview(request(""), NOW)).toBeNull();
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it.each([
    ["purpose", "embryo-withdrawal"], ["target_kind", "subject"], ["status", "consumed"],
    ["status", "revoked"], ["expires_at", new Date(NOW).toISOString()], ["expires_at", "invalid"],
  ])("refuses session %s=%s before any target or account read", async (field, value) => {
    rows.rights_sessions[0][field] = value;
    expect(await loadCoParentReview(request(), NOW)).toBeNull();
    expect(reads.map(read => read.table)).toEqual(["rights_sessions"]);
    expect(mocks.context).not.toHaveBeenCalled();
  });

  it("serves only a generic sign-in state without target lookup to an anonymous holder", async () => {
    mocks.context.mockResolvedValue(null);
    expect(await loadCoParentReview(request(), NOW)).toEqual({ kind: "sign-in" });
    expect(reads.map(read => read.table)).toEqual(["rights_sessions"]);
    expect(mocks.artifact).not.toHaveBeenCalled();
  });

  it.each(["wrong-email", "unverified-email", "stale-revision", "expired-invitation", "wrong-target", "accepted"])("refuses %s without reading a draft or signing name", async mode => {
    if (mode === "wrong-email") mocks.context.mockResolvedValue({ user: { id: IDS.account, email: "other@e2e.local", email_confirmed_at: EXPIRY }, sessionId: IDS.auth });
    if (mode === "unverified-email") mocks.context.mockResolvedValue({ user: { id: IDS.account, email: EMAIL }, sessionId: IDS.auth });
    if (mode === "stale-revision") rows.subject_invitations[0].invitation_revision = 3;
    if (mode === "expired-invitation") rows.subject_invitations[0].expires_at = new Date(NOW).toISOString();
    if (mode === "wrong-target") rows.subject_invitations[0].target_id = crypto.randomUUID();
    if (mode === "accepted") rows.subject_invitations[0].status = "accepted";
    expect(await loadCoParentReview(request(), NOW)).toBeNull();
    expect(reads.some(read => read.table === "embryo_cohort_drafts" || read.table === "consent_signatures")).toBe(false);
    expect(mocks.artifact).not.toHaveBeenCalled();
  });

  it.each(["closed-draft", "own-draft", "filled-slot", "inactive-principal", "deleting-account"])("refuses %s before disclosing signatures", async mode => {
    if (mode === "closed-draft") rows.embryo_cohort_drafts[0].state = "finalized";
    if (mode === "own-draft") rows.embryo_cohort_drafts[0].owner_account_id = IDS.account;
    if (mode === "filled-slot") rows.draft_participant_slots[0].state = "current";
    if (mode === "inactive-principal") rows.subject_principals[0].status = "withdrawn";
    if (mode === "deleting-account") rows.profiles[0].deletion_requested_at = EXPIRY;
    expect(await loadCoParentReview(request(), NOW)).toBeNull();
    expect(reads.some(read => read.table === "consent_signatures")).toBe(false);
  });

  it("binds both full artifacts and the accept control to the exact account, auth session and draft", async () => {
    const review = await loadCoParentReview(request(), NOW);
    expect(review?.kind).toBe("review");
    if (review?.kind !== "review") throw new Error("review missing");
    expect(review.inviterName).toBe("Synthetic Inviter");
    expect(review.embryoCount).toBe(3);
    expect(review.artifacts).toHaveLength(2);
    for (const artifact of review.artifacts) {
      expect(readArtifactPresentation(artifact.presentationToken, NOW)).toMatchObject({
        accountId: IDS.account, targetKind: "cohort_draft", targetId: IDS.draft,
        artifactKey: artifact.artifact_key, artifactVersion: artifact.version,
        artifactBodySha256: artifact.body_sha256, statementKeys: artifact.statementKeys,
      });
    }
    expect(verifyEmbryoOperation(review.nonce, {
      accountId: IDS.account, sessionId: IDS.auth, operation: "invitation_accept",
      targetKind: "rights_session", targetId: rightsSessionHash(secret),
    }, NOW)).not.toBeNull();
    expect(JSON.stringify(review)).not.toContain(secret);
    expect(reads.map(read => read.table).sort()).toEqual([
      "consent_signatures", "draft_participant_slots", "embryo_cohort_drafts", "profiles",
      "rights_sessions", "subject_invitations", "subject_principals",
    ]);
  });

  it("does not enable real-jurisdiction acceptance while allowing the request to be reviewed", async () => {
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "");
    const review = await loadCoParentReview(request(), NOW);
    expect(review?.kind === "review" && review.acceptanceAvailable).toBe(false);
    expect(review?.kind === "review" && review.unavailableCopy.length).toBeGreaterThan(0);
  });

  it("does not mint a partial signing form when an artifact is absent", async () => {
    mocks.artifact.mockResolvedValueOnce(null);
    expect(await loadCoParentReview(request(), NOW)).toBeNull();
  });
});
