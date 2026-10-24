import "server-only";
import crypto from "node:crypto";
import { z } from "zod";
import { ADULT_SUBJECT_STATEMENTS } from "@/copy/family/adult-subject-statements";
import { getSensitiveAccountContext, type SensitiveAccountContext } from "@/lib/account-deletion";
import { hmacSecret } from "@/lib/crypto";
import { contactDigestCandidates } from "@/lib/hmac-keyring";
import { createAdminClient } from "@/lib/supabase/admin";
import { looseAdmin } from "@/lib/uploads/other-adult-upload-server";
import { otherAdultTypedNameIsValid } from "@/lib/uploads/other-adult-upload";
import { mintEmbryoOperation, mintPublicFormToken, readPublicFormToken } from "./operation-token";
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
 * to it, the five signed statements of D-103, each ticked on its own
 * (`src/copy/family/adult-subject-statements.ts`), and the person's typed
 * name (owner decision of 23 October 2026). Accepting is
 * api.invitation-accept's (`src/lib/embryos/adult-subject-accept.ts`), as
 * the register's adult-subject-confirmation-v1 names it; api.withdraw keeps
 * refusing and deleting.
 */

const formNonce = z.string().min(1).max(2_048);

/** Refusing and deleting: the operation and the served form's nonce, nothing else. */
export const adultSubjectAnswerBody = z.object({
  operation: z.enum(["refuse", "delete"]),
  nonce: formNonce,
}).strict();

/**
 * Enough of an api.withdraw confirm body to find its authority before any
 * field is judged (invalid-request-v1.authorizationPrecedence): a body that
 * cannot be tied to this session's form is the opaque 404, never a list of
 * its faults. Path A is no longer confirmed there (see the route).
 */
export const adultSubjectConfirmEnvelope = z.object({
  operation: z.literal("confirm"),
  nonce: formNonce,
}).loose();

export type AdultSubjectOperation = "confirm" | "refuse" | "delete";

export const ADULT_SUBJECT_ARTIFACT_KEY = "consent.subject-adult";

/** The keys the server publishes, and the only list a confirm may carry, in this order. */
export const ADULT_SUBJECT_STATEMENT_KEYS: readonly string[] = ADULT_SUBJECT_STATEMENTS.map(statement => statement.key);

/** One digest over every published key and its sentence, in order. */
export function adultSubjectStatementsDigest(statements: readonly { key: string; text: string }[]): string {
  return crypto.createHash("sha256")
    .update(JSON.stringify(statements.map(statement => [statement.key, statement.text])), "utf8")
    .digest("hex");
}

/** The statements this deployment publishes. A page served under any other list carries another digest. */
export const ADULT_SUBJECT_STATEMENTS_SHA256 = adultSubjectStatementsDigest(ADULT_SUBJECT_STATEMENTS);

const hex64 = z.string().regex(/^[0-9a-f]{64}$/);
const PRESENTATION_CONTEXT = "adult-subject-artifact-presentation-v1";
/** One minute inside the ten-minute form nonce it is served with. */
const PRESENTATION_LIFETIME_MS = 9 * 60 * 1000;
const presentationSchema = z.object({
  sessionHash: hex64,
  artifactKey: z.literal(ADULT_SUBJECT_ARTIFACT_KEY),
  artifactVersion: z.number().int().positive().safe(),
  artifactBodySha256: hex64,
  statementsSha256: hex64,
  issuedAt: z.number().int().positive().safe(),
  expiresAt: z.number().int().positive().safe(),
}).strict();
export type AdultSubjectPresentation = z.infer<typeof presentationSchema>;

/**
 * What this page showed this session: the artifact's version and exact body
 * hash and the published statement list, for nine minutes. The list is
 * normally the current one; a test passes another to stand for a page that
 * was served before the published statements changed.
 */
export function mintAdultSubjectPresentation(input: {
  sessionHash: string;
  artifactVersion: number;
  artifactBodySha256: string;
  statementsSha256?: string;
}, now = Date.now()): string {
  const claims = presentationSchema.parse({
    sessionHash: input.sessionHash,
    artifactKey: ADULT_SUBJECT_ARTIFACT_KEY,
    artifactVersion: input.artifactVersion,
    artifactBodySha256: input.artifactBodySha256,
    statementsSha256: input.statementsSha256 ?? ADULT_SUBJECT_STATEMENTS_SHA256,
    issuedAt: now,
    expiresAt: now + PRESENTATION_LIFETIME_MS,
  });
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${hmacSecret(payload, PRESENTATION_CONTEXT)}`;
}

/** The presentation's claims when this deployment signed it and it is still fresh; null otherwise. */
export function readAdultSubjectPresentation(token: string, now = Date.now()): AdultSubjectPresentation | null {
  const parts = token.split(".");
  if (token.length > 4_096 || parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]!)
    || !/^[0-9a-f]{64}$/.test(parts[1]!)) return null;
  const expected = hmacSecret(parts[0]!, PRESENTATION_CONTEXT);
  if (!crypto.timingSafeEqual(Buffer.from(parts[1]!, "hex"), Buffer.from(expected, "hex"))) return null;
  try {
    const payload = Buffer.from(parts[0]!, "base64url");
    if (payload.toString("base64url") !== parts[0]) return null;
    const parsed = presentationSchema.safeParse(JSON.parse(payload.toString("utf8")));
    if (!parsed.success) return null;
    const claims = parsed.data;
    return claims.issuedAt <= now && claims.expiresAt > now
      && claims.expiresAt - claims.issuedAt === PRESENTATION_LIFETIME_MS ? claims : null;
  } catch { return null; }
}

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
  /** The rights-session form nonce refusing and deleting send to api.withdraw. */
  nonce: string;
  /** Why the accept control is not offered, or null when it is. */
  acceptanceBlockedBy: "sign-in" | "other-account" | null;
  artifact: AdultSubjectArtifact;
  /**
   * The five signed statements, as the server publishes them, the
   * presentation that binds them to this session, artifact and list (D-103),
   * and the one-time nonce api.invitation-accept takes from this account and
   * auth session for this rights session. Only when this account may accept:
   * the accept body names them back with the person's typed name.
   */
  confirmation: {
    nonce: string;
    presentationToken: string;
    statements: { key: string; text: string }[];
  } | null;
}

export interface AdultSubjectArtifact {
  version: number;
  effectiveOn: string;
  summaryMarkdown: string;
  bodyMarkdown: string;
  bodySha256: string;
}

/** What one rights session's pending Path A invitation offers, before any account is read. */
export interface AdultSubjectOffer {
  sessionHash: string;
  /** The reserved subject the invitation names; acceptance makes it the account's own. */
  subjectId: string;
  draftOwnerAccountId: string;
  invitationEmailHmac: string;
  artifact: AdultSubjectArtifact;
}

/**
 * The invitation this session was opened for, or null. Nothing about a
 * target is read until the cookie resolves to an active, unexpired session
 * of the adult purpose, and the credential's own chain is followed from the
 * token the session consumed: a later invitation naming the same principal
 * and subject is never substituted for the one that was mailed. The page
 * reads it to render, and the confirm reads it again to judge the body.
 */
export async function readAdultSubjectOffer(
  request: Request,
  now = Date.now(),
): Promise<AdultSubjectOffer | null> {
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
      .eq("artifact_key", ADULT_SUBJECT_ARTIFACT_KEY).is("superseded_at", null).maybeSingle(),
  ]);
  if (draftError || principalError || artifactError || !draft || !principal || !artifact) return null;
  // A Path B request ("I have their file") is answered on its own screen
  // (`src/lib/uploads/path-b-review.ts`), never by account acceptance. Only a
  // flow that reads back as Path B is turned away, so this page keeps working
  // on a database that predates the flow column.
  const { data: flow, error: flowError } = await looseAdmin(admin).from("adult_subject_drafts")
    .select("adult_flow").eq("id", draft.id).maybeSingle();
  if (!flowError && flow && flow.adult_flow !== "path-a-own-account") return null;

  return {
    sessionHash,
    subjectId: session.target_id,
    draftOwnerAccountId: draft.owner_account_id,
    invitationEmailHmac: invitation.email_hmac,
    artifact: {
      version: artifact.version,
      effectiveOn: artifact.effective_on,
      summaryMarkdown: artifact.summary_markdown,
      bodyMarkdown: artifact.body_markdown,
      bodySha256: artifact.body_sha256,
    },
  };
}

/**
 * Why this account may not accept this offer, or null when it may: signed
 * in, with a confirmed address that is the invited one under some held
 * contact key revision, and not the inviter. Only a choice of controls; the
 * database decides again.
 */
export function adultSubjectAcceptanceBlockedBy(
  context: SensitiveAccountContext | null,
  offer: AdultSubjectOffer,
): AdultSubjectReview["acceptanceBlockedBy"] {
  if (!context) return "sign-in";
  const email = context.user.email;
  return !email || !context.user.email_confirmed_at
    || context.user.id === offer.draftOwnerAccountId
    || !contactDigestCandidates(normalizeContact(email)).includes(offer.invitationEmailHmac)
    ? "other-account"
    : null;
}

/** The invitation this session was opened for, as the page renders it, or null. */
export async function loadAdultSubjectReview(
  request: Request,
  now = Date.now(),
): Promise<AdultSubjectReview | null> {
  const offer = await readAdultSubjectOffer(request, now);
  if (!offer) return null;
  // Signing in is offered, never required: the two controls that need no
  // account are the ones a person without one came here to use.
  const context = await getSensitiveAccountContext();
  const acceptanceBlockedBy = adultSubjectAcceptanceBlockedBy(context, offer);

  return {
    nonce: mintPublicFormToken("adult-subject-respond", now, offer.sessionHash),
    acceptanceBlockedBy,
    artifact: offer.artifact,
    confirmation: acceptanceBlockedBy === null && context ? {
      nonce: mintEmbryoOperation({
        accountId: context.user.id, sessionId: context.sessionId, operation: "invitation_accept",
        targetKind: "rights_session", targetId: offer.sessionHash,
      }, now),
      presentationToken: mintAdultSubjectPresentation({
        sessionHash: offer.sessionHash,
        artifactVersion: offer.artifact.version,
        artifactBodySha256: offer.artifact.bodySha256,
      }, now),
      statements: ADULT_SUBJECT_STATEMENTS.map(statement => ({ key: statement.key, text: statement.text })),
    } : null,
  };
}

/**
 * The Path A accept body (register api.invitation-accept, the
 * `subjectArtifact` body; owner decision of 23 October 2026, "D-103: Path A
 * acceptance includes a typed name"): the artifact key, the version and
 * presentation the page was served, the server-published statement keys,
 * each ticked on its own, in the published order, and the person's typed
 * name. The account's own current country declaration is the one the
 * database records, so no jurisdiction field is sent (D-083 keeps the
 * attestation fields with counsel), and nothing here can name an account, a
 * target or a purpose.
 */
export const adultSubjectAcceptBody = z.object({
  nonce: formNonce,
  subjectArtifact: z.object({
    artifactKey: z.literal(ADULT_SUBJECT_ARTIFACT_KEY),
    artifactVersion: z.number().int().positive().safe(),
    artifactPresentationToken: z.string().min(16).max(4_096),
    affirmed: z.literal(true),
    statementKeys: z.array(z.string().min(1).max(64)).min(1).max(16),
    typedName: z.string().min(1).max(200),
  }).strict(),
}).strict();
export type AdultSubjectAcceptRequest = z.infer<typeof adultSubjectAcceptBody>;

/** The adult-subject body of api.invitation-accept is the one that carries `subjectArtifact`. */
export function isAdultSubjectAcceptPayload(value: unknown): boolean {
  return typeof value === "object" && value !== null && "subjectArtifact" in value;
}

/**
 * Whether an accept body answers the offer it was served for: the current
 * artifact version, a presentation this deployment served to this session
 * for the current artifact and the list published now (so a page served
 * before either changed is refused), exactly the published keys in order
 * with nothing missing, added or repeated, and a typed name of at least two
 * whitespace-separated tokens of at least two characters (the register's
 * typedName rule, Path B's validator). Call it only once the session, the
 * nonce and the account have been found to be this offer's.
 */
export function adultSubjectAcceptMatchesOffer(body: AdultSubjectAcceptRequest, offer: AdultSubjectOffer,
  now = Date.now()): boolean {
  const artifact = body.subjectArtifact;
  const presentation = readAdultSubjectPresentation(artifact.artifactPresentationToken, now);
  return artifact.artifactVersion === offer.artifact.version
    && presentation !== null && presentation.sessionHash === offer.sessionHash
    && presentation.artifactVersion === offer.artifact.version
    && presentation.artifactBodySha256 === offer.artifact.bodySha256
    && presentation.statementsSha256 === ADULT_SUBJECT_STATEMENTS_SHA256
    && artifact.statementKeys.length === ADULT_SUBJECT_STATEMENT_KEYS.length
    && artifact.statementKeys.every((key, index) => key === ADULT_SUBJECT_STATEMENT_KEYS[index])
    && otherAdultTypedNameIsValid(artifact.typedName);
}
