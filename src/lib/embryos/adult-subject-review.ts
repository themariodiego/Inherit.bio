import "server-only";
import { z } from "zod";
import { getSensitiveAccountContext } from "@/lib/account-deletion";
import { hmacSecret } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { mintPublicFormToken, readPublicFormToken } from "./operation-token";
import { readRightsSessionHash, RIGHTS_COOKIE_NAME } from "./rights-session";
import { normalizeContact } from "./routes";

/**
 * The adult-subject invitation, read from the rights session its mailed
 * token opened (D-081). Nothing here reads a token: the browser presents the
 * host-only cookie the activation route set, and the purpose stored on the
 * session decides what this page is allowed to be about.
 *
 * Refusing and deleting need no account — the person holding the mailbox is
 * the person with the right. Accepting needs an account whose confirmed
 * address is the invited one, because acceptance binds the reserved subject
 * to it.
 */

export const adultSubjectResponseBody = z.object({
  operation: z.enum(["confirm", "refuse", "delete"]),
  nonce: z.string().min(1).max(2_048),
}).strict();

export type AdultSubjectOperation = z.infer<typeof adultSubjectResponseBody>["operation"];

export function adultSubjectRequestAllowed(request: Request): boolean {
  return request.method === "POST" && new URL(request.url).search === ""
    && request.headers.get("origin") === new URL(request.url).origin
    && request.headers.get("sec-fetch-site") === "same-origin"
    && request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() === "application/json";
}

/** The session hash and one-time nonce of a form this deployment served for this session. */
export function readAdultSubjectResponse(request: Request, nonce: string, now = Date.now()) {
  if (!adultSubjectRequestAllowed(request)) return null;
  const cookies = (request.headers.get("cookie") ?? "").split(";")
    .filter(part => part.trim().split("=")[0] === RIGHTS_COOKIE_NAME);
  if (cookies.length !== 1) return null;
  const sessionHash = readRightsSessionHash(request);
  if (!sessionHash) return null;
  const claims = readPublicFormToken(nonce, "adult-subject-respond", now, sessionHash);
  return claims ? { sessionHash, nonce: claims.nonce } : null;
}

export interface AdultSubjectReview {
  nonce: string;
  /** Why the accept control is not offered, or null when it is. */
  acceptanceBlockedBy: "sign-in" | "other-account" | null;
  artifact: {
    version: number;
    effectiveOn: string;
    summaryMarkdown: string;
    bodyMarkdown: string;
    bodySha256: string;
  };
}

/**
 * The invitation this session was opened for, or null. Nothing about a
 * target is read until the cookie resolves to an active, unexpired session
 * of the adult purpose, and the credential's own chain is followed from the
 * token the session consumed: a later invitation naming the same principal
 * and subject is never substituted for the one that was mailed.
 */
export async function loadAdultSubjectReview(
  request: Request,
  now = Date.now(),
): Promise<AdultSubjectReview | null> {
  const sessionHash = readRightsSessionHash(request);
  if (!sessionHash) return null;
  const admin = createAdminClient();
  const nowIso = new Date(now).toISOString();

  const { data: session, error: sessionError } = await admin.from("rights_sessions")
    .select("token_hash_id, purpose, target_kind, target_id, principal_id, authority_revision, status, expires_at")
    .eq("session_hash", sessionHash).maybeSingle();
  if (sessionError || !session || session.purpose !== "adult-subject-invitation"
    || session.target_kind !== "subject" || session.status !== "active"
    || !(Date.parse(session.expires_at) > now)) return null;

  const { data: token, error: tokenError } = await admin.from("token_hashes")
    .select("candidate_id, token_hash, token_revision")
    .eq("id", session.token_hash_id).eq("status", "consumed").maybeSingle();
  if (tokenError || !token) return null;
  const { data: candidate, error: candidateError } = await admin.from("token_candidates")
    .select("target_id")
    .eq("id", token.candidate_id).eq("purpose", "adult-subject-invitation")
    .eq("target_kind", "subject_invitation").eq("token_revision", token.token_revision)
    .eq("state", "issued").gt("expires_at", nowIso).maybeSingle();
  if (candidateError || !candidate) return null;

  const { data: invitation, error: invitationError } = await admin.from("subject_invitations")
    .select("id, email_hmac")
    .eq("id", candidate.target_id).eq("token_hash", token.token_hash)
    .eq("invitee_principal_id", session.principal_id)
    .eq("target_kind", "subject").eq("target_id", session.target_id)
    .eq("invitation_kind", "adult_subject").eq("status", "pending")
    .eq("invitation_revision", session.authority_revision)
    .gt("expires_at", nowIso).maybeSingle();
  if (invitationError || !invitation) return null;

  const [{ data: draft, error: draftError }, { data: principal, error: principalError },
    { data: artifact, error: artifactError }] = await Promise.all([
    admin.from("adult_subject_drafts").select("id, owner_account_id")
      .eq("subject_id", session.target_id).eq("state", "invited")
      .gt("fixed_expires_at", nowIso).maybeSingle(),
    admin.from("subject_principals").select("id")
      .eq("id", session.principal_id).eq("status", "pending")
      .eq("principal_kind", "non_account_subject").maybeSingle(),
    admin.from("consent_artifacts")
      .select("version, effective_on, summary_markdown, body_markdown, body_sha256")
      .eq("artifact_key", "consent.subject-adult").is("superseded_at", null).maybeSingle(),
  ]);
  if (draftError || principalError || artifactError || !draft || !principal || !artifact) return null;

  // Signing in is offered, never required: the two controls that need no
  // account are the ones a person without one came here to use.
  const context = await getSensitiveAccountContext();
  const email = context?.user.email;
  const acceptanceBlockedBy = !context ? "sign-in" as const
    : !email || !context.user.email_confirmed_at
      || context.user.id === draft.owner_account_id
      || hmacSecret(normalizeContact(email), "contact-email-v1") !== invitation.email_hmac
      ? "other-account" as const
      : null;

  return {
    nonce: mintPublicFormToken("adult-subject-respond", now, sessionHash),
    acceptanceBlockedBy,
    artifact: {
      version: artifact.version,
      effectiveOn: artifact.effective_on,
      summaryMarkdown: artifact.summary_markdown,
      bodyMarkdown: artifact.body_markdown,
      bodySha256: artifact.body_sha256,
    },
  };
}
