import "server-only";

import crypto from "node:crypto";
import { z } from "zod";
import { decryptSecret, hmacSecret } from "@/lib/crypto";
import { encryptedLiteral } from "@/lib/embryos/guards";
import { contactDigestSet } from "@/lib/hmac-keyring";
import { accountCapability, isTestJurisdictionEnabled } from "@/lib/legal/jurisdictions";
import { invitationQuotaKeys } from "@/lib/rate-limit-keys";
import { createAdminClient } from "@/lib/supabase/admin";
import { readBoundedJson } from "@/lib/future-person/bounded-body";
import { newWrappedDocumentKey } from "@/lib/future-person/document-envelope";
import {
  EVIDENCE_COMPLETE_NONCE_HEADER,
  EVIDENCE_CSRF_HEADER,
  evidenceCompleteNonce,
  evidenceCookie,
  evidenceCsrf,
  newEvidenceSecret,
} from "@/lib/future-person/evidence-session";
import {
  isAdultOn,
  legalEvidenceSessionBody,
  pathBDraftReceipt,
  pathBReviewedDocumentDraftBody,
  reviewedDocumentTargetState,
  subjectCreatedReceipt,
  subjectFinalizeBody,
  type ReviewedDocumentTarget,
  type ReviewedDocumentTargetState,
} from "./other-adult-upload";
import { heldUploadRpc, otherAdultUploadAvailable, presentUploaderArtifactFor, verifyPathBOperation } from "./other-adult-upload-server";
import { currentOwnUploadAccount, ownUploadJson } from "./own-upload-context";

/**
 * The reviewed-document branch of Path B (owner decision 2026-10-16, "The
 * subjects endpoints (G2.1)"), TEST-LOCAL only. Three uploader requests:
 *
 *   - `POST /api/subject-drafts` with the path-b-reviewed-document body
 *     reserves the draft (closed-subject-draft-create-v1);
 *   - `POST /api/legal-evidence/upload-session` opens the one
 *     adult-signed-permission document session for it; the bytes then cross
 *     the existing api.evidence-chunk and api.evidence-complete doors;
 *   - `POST /api/subjects` (closed-subject-finalize-v1) asks the person to
 *     confirm once a named human approved the document. The body carries no
 *     address: the server opens the draft's own encrypted contact in this
 *     request's memory only, to digest it under every held key revision for
 *     the global refusal bar, and forgets it.
 *
 * The named review is not here: it is api.legal-evidence-review, which only
 * an assigned, MFA-stepped-up reviewer can reach. Nothing here approves.
 */

const uuid = z.uuid().regex(/^[0-9a-f-]+$/);
const forbidden = () => ownUploadJson({ error: "request_forbidden" }, 403);
const notFound = () => ownUploadJson({ error: "not_found" }, 404);
const unauthenticated = () => ownUploadJson({ error: "unauthenticated" }, 401);
const unavailable = () => ownUploadJson({ error: "unavailable" }, 503);
const invalid = (issues: string[]) => ownUploadJson({ error: "invalid_request", issues }, 422);

function sameOrigin(request: Request): boolean {
  const url = new URL(request.url);
  return request.headers.get("origin") === url.origin && request.headers.get("sec-fetch-site") === "same-origin";
}

function isJson(request: Request): boolean {
  return request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() === "application/json";
}

// --- One-time operation tokens (brief X1.5) -----------------------------------
// The page renders a stateless sealed token bound to the account, its auth
// session, the operation and the draft; its random nonce is spent once by
// the database in the operation's own transaction.

const OPERATION_CONTEXT = "path-b-reviewed-document-operation-v1";
const OPERATION_LIFETIME_MS = 10 * 60 * 1000;
export type ReviewedDocumentOperation = "document-session" | "finalize";
const operationSchema = z.object({
  accountId: uuid,
  sessionId: uuid,
  operation: z.enum(["document-session", "finalize"]),
  targetId: uuid,
  nonce: z.string().regex(/^[A-Za-z0-9_-]{32}$/),
  expiresAt: z.number().int().positive().safe(),
}).strict();

function seal(claims: unknown): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${hmacSecret(payload, OPERATION_CONTEXT)}`;
}

function unseal(token: string): unknown {
  if (token.length > 2048) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]!) || !/^[0-9a-f]{64}$/.test(parts[1]!)) return null;
  const expected = hmacSecret(parts[0]!, OPERATION_CONTEXT);
  if (!crypto.timingSafeEqual(Buffer.from(parts[1]!, "hex"), Buffer.from(expected, "hex"))) return null;
  try {
    const payload = Buffer.from(parts[0]!, "base64url");
    if (payload.toString("base64url") !== parts[0]) return null;
    return JSON.parse(payload.toString("utf8"));
  } catch { return null; }
}

export function mintReviewedDocumentOperation(accountId: string, sessionId: string,
  operation: ReviewedDocumentOperation, targetId: string, now = Date.now()): string {
  return seal(operationSchema.parse({ accountId, sessionId, operation, targetId,
    nonce: crypto.randomBytes(24).toString("base64url"), expiresAt: now + OPERATION_LIFETIME_MS }));
}

/** The token's nonce when it is exactly this account, session, operation and draft, unexpired; else null. */
export function readReviewedDocumentOperation(token: string | null, expected: { accountId: string; sessionId: string;
  operation: ReviewedDocumentOperation; targetId: string }, now = Date.now()): string | null {
  if (!token) return null;
  const parsed = operationSchema.safeParse(unseal(token));
  if (!parsed.success || parsed.data.expiresAt <= now || parsed.data.expiresAt - now > OPERATION_LIFETIME_MS
    || parsed.data.accountId !== expected.accountId || parsed.data.sessionId !== expected.sessionId
    || parsed.data.operation !== expected.operation || parsed.data.targetId !== expected.targetId) return null;
  return parsed.data.nonce;
}

/** api.subjects' X-Inherit-CSRF: bound to the account, its auth session and the draft. */
export function finalizeCsrf(accountId: string, sessionId: string, subjectDraftId: string): string {
  return hmacSecret(`${accountId}|${sessionId}|${subjectDraftId}`, "path-b-reviewed-document-csrf-v1");
}

function sameDigest(presented: string | null, expected: string): boolean {
  if (!presented || !/^[0-9a-f]{64}$/u.test(presented)) return false;
  return crypto.timingSafeEqual(Buffer.from(presented), Buffer.from(expected));
}

const sha256Hex = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

// --- POST /api/subject-drafts, path-b-reviewed-document --------------------------

export async function createPathBReviewedDocumentDraft(request: Request, payload: unknown): Promise<Response> {
  if (!sameOrigin(request)) return forbidden();
  const actor = await currentOwnUploadAccount();
  if (!actor) return unauthenticated();
  if (!(await otherAdultUploadAvailable(actor.accountId))) return notFound();
  // The same page token as the e-signature draft: one draft-create for this account.
  if (!verifyPathBOperation(request.headers.get("x-inherit-csrf"), { accountId: actor.accountId,
    sessionId: actor.sessionId, operation: "draft-create", targetId: actor.accountId })) return forbidden();
  const parsed = pathBReviewedDocumentDraftBody.safeParse(payload);
  if (!parsed.success || !isAdultOn(parsed.data.dateOfBirth)) return invalid(["body"]);
  const body = parsed.data;
  const { data, error } = await heldUploadRpc(createAdminClient(), "create_path_b_reviewed_document_draft_v1", {
    p_account_id: actor.accountId, p_session_id: actor.sessionId, p_display_name: body.displayName,
    p_date_of_birth: body.dateOfBirth, p_contact_ciphertext: encryptedLiteral(body.contactEmail),
    p_contact_hmac: null, p_contact_hmac_set: contactDigestSet(body.contactEmail),
    p_request_key: hmacSecret(JSON.stringify(["adult-path-b-reviewed-document-draft-v1", actor.accountId, body.requestId]),
      "mail-idempotency-v1"),
    p_test_jurisdiction: true,
  });
  if (error) {
    if (error.code === "42501") return notFound();
    if (error.code === "22023") return invalid(["body"]);
    if (error.code === "55000" && error.message === "adult_account_required") {
      return ownUploadJson({ error: "adult_account_required" }, 409);
    }
    return unavailable();
  }
  const receipt = pathBDraftReceipt.safeParse(data);
  return receipt.success ? ownUploadJson(receipt.data, 201) : unavailable();
}

// --- POST /api/legal-evidence/upload-session ---------------------------------------

const opened = z.object({ status: z.literal("open"), session: uuid, documentKind: z.literal("adult-signed-permission"),
  expiresAt: z.iso.datetime({ offset: true }) }).strict();
const capacityLimited = z.object({ status: z.literal("capacity_limited") }).strict();

/** evidence-session-v1 for the one built document kind. */
export async function openLegalEvidenceUploadSession(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== "POST" || !sameOrigin(request)) return forbidden();
  if (url.search !== "" || !isJson(request)) return invalid(["request"]);
  const actor = await currentOwnUploadAccount();
  if (!actor) return unauthenticated();
  const parsed = legalEvidenceSessionBody.safeParse(await readBoundedJson(request, 4096));
  if (!parsed.success) return invalid(["body"]);
  // The two embryo-basis kinds have no built cohort-draft target yet.
  if (parsed.data.documentKind !== "adult-signed-permission") return notFound();
  if (!(await otherAdultUploadAvailable(actor.accountId))) return notFound();
  const body = parsed.data;
  const nonce = readReviewedDocumentOperation(request.headers.get("x-inherit-csrf"), { accountId: actor.accountId,
    sessionId: actor.sessionId, operation: "document-session", targetId: body.subjectDraftId });
  if (!nonce) return forbidden();
  const evidence = newEvidenceSecret();
  const wrapped = newWrappedDocumentKey();
  try {
    const { data, error } = await heldUploadRpc(createAdminClient(), "open_permission_document_session_v1", {
      p_account_id: actor.accountId, p_session_id: actor.sessionId, p_subject_id: body.subjectDraftId,
      p_media_type: body.mediaType, p_size_bytes: body.sizeBytes, p_sha256: body.sha256,
      p_cookie_hash: evidence.hash, p_wrapped_document_key: `\\x${wrapped.toString("hex")}`,
      p_nonce_hash: sha256Hex(nonce), p_test_jurisdiction: true,
    });
    if (error) {
      if (error.code === "22023") return invalid(["body"]);
      return ["42501", "23505", "55000"].includes(error.code ?? "") ? notFound() : unavailable();
    }
    if (capacityLimited.safeParse(data).success) return invalid(["capacity"]);
    const session = opened.safeParse(data);
    if (!session.success) return unavailable();
    const expiry = new Date(session.data.expiresAt);
    if (expiry.getTime() <= Date.now()) return notFound();
    const id = session.data.session;
    const response = ownUploadJson({ session: id, documentKind: session.data.documentKind, chunkBytes: 4_000_000,
      maximumChunks: 5, maximumDocumentBytes: 20_000_000, chunkRoute: `/api/evidence/${id}/chunks/{sequence}`,
      completeRoute: `/api/evidence/${id}/complete`, expiresAt: expiry.toISOString() }, 201);
    response.headers.set("Set-Cookie", evidenceCookie(evidence.secret, expiry));
    response.headers.set(EVIDENCE_CSRF_HEADER, evidenceCsrf(id, evidence.hash));
    response.headers.set(EVIDENCE_COMPLETE_NONCE_HEADER, evidenceCompleteNonce(id, evidence.hash));
    return response;
  } finally {
    wrapped.fill(0);
  }
}

// --- POST /api/subjects ---------------------------------------------------------------

const contactRow = z.object({ contactCiphertext: z.string().regex(/^[0-9a-f]{58,4096}$/u) }).strict();

export interface FinalizeDependencies {
  /** The acting uploader's third_party_adult_analysis decision (api.subjects.policy.jurisdiction). */
  capability(accountId: string): ReturnType<typeof accountCapability>;
}

/** subject-created-v1 for an eligible or a barred contact alike. */
export async function finalizeReviewedDocumentSubject(request: Request, deps: FinalizeDependencies): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== "POST" || !sameOrigin(request)) return forbidden();
  if (url.search !== "" || !isJson(request)) return notFound();
  const actor = await currentOwnUploadAccount();
  if (!actor) return unauthenticated();
  const payload = await readBoundedJson(request, 4096);
  // api.subjects.policy.embryoCreation: an embryo attempt is told where embryos go.
  if (typeof payload === "object" && payload !== null && (payload as { kind?: unknown }).kind === "embryo") {
    return ownUploadJson({ error: "embryo_cohort_required" }, 422);
  }
  if (!isTestJurisdictionEnabled()) return notFound();
  const decision = await deps.capability(actor.accountId).catch(() => null);
  if (!decision) return unavailable();
  if (decision.status !== "permitted") {
    return ownUploadJson({ error: "jurisdiction_unavailable", message: decision.userFacingCopy }, 403);
  }
  const parsed = subjectFinalizeBody.safeParse(payload);
  if (!parsed.success) return notFound();
  const body = parsed.data;
  if (!sameDigest(request.headers.get("x-inherit-csrf"), finalizeCsrf(actor.accountId, actor.sessionId, body.subjectDraftId))) {
    return forbidden();
  }
  const nonce = readReviewedDocumentOperation(body.nonce, { accountId: actor.accountId, sessionId: actor.sessionId,
    operation: "finalize", targetId: body.subjectDraftId });
  if (!nonce) return notFound();
  const admin = createAdminClient();
  const contact = await heldUploadRpc(admin, "path_b_reviewed_document_contact_v1", {
    p_account_id: actor.accountId, p_session_id: actor.sessionId, p_subject_id: body.subjectDraftId,
    p_test_jurisdiction: true,
  });
  if (contact.error) return contact.error.code === "42501" ? notFound() : unavailable();
  const row = contactRow.safeParse(contact.data);
  if (!row.success) return unavailable();
  let digests: Record<string, string>;
  try {
    // Plaintext lives only here, for the length of one digest computation.
    const address = decryptSecret(Buffer.from(row.data.contactCiphertext, "hex"));
    digests = contactDigestSet(address);
  } catch {
    return unavailable();
  }
  const { data, error } = await heldUploadRpc(admin, "finalize_path_b_reviewed_document_v1", {
    p_account_id: actor.accountId, p_session_id: actor.sessionId, p_subject_id: body.subjectDraftId,
    p_document_id: body.permissionEvidenceDocumentId, p_review_id: body.legalReviewId, p_nonce_hash: sha256Hex(nonce),
    p_idempotency_key: hmacSecret(JSON.stringify(["adult-path-b-reviewed-document-request-v1", actor.accountId,
      body.subjectDraftId]), "mail-idempotency-v1"),
    p_test_jurisdiction: true, p_contact_hmac_set: digests,
    p_quota_keys: invitationQuotaKeys(actor.accountId, request.headers),
  });
  if (error) return ["42501", "23505", "22023"].includes(error.code ?? "") ? notFound() : unavailable();
  const receipt = subjectCreatedReceipt.safeParse(data);
  return receipt.success ? ownUploadJson(receipt.data, 202) : unavailable();
}

// --- The upload page ------------------------------------------------------------------

/** The uploader's reviewed-document people before activation, read-only. Null outside TEST-LOCAL. */
export async function listReviewedDocumentTargets(): Promise<ReviewedDocumentTargetState[] | null> {
  const actor = await currentOwnUploadAccount();
  if (!actor || !(await otherAdultUploadAvailable(actor.accountId))) return null;
  const { data, error } = await heldUploadRpc(createAdminClient(), "path_b_reviewed_document_targets_v1", {
    p_account_id: actor.accountId, p_session_id: actor.sessionId, p_test_jurisdiction: true,
  });
  const parsed = z.array(reviewedDocumentTargetState).safeParse(data);
  return error || !parsed.success ? null : parsed.data;
}

/**
 * The tokens the page renders for each person: the one-time document-session
 * token while a document is due, and the one-time api.subjects nonce with its
 * CSRF once a named human approved. The consent presentation (for a person
 * not yet signed for) comes from the shared Path B preparation.
 */
export function reviewedDocumentTokens(actor: { accountId: string; sessionId: string },
  target: ReviewedDocumentTargetState): Pick<ReviewedDocumentTarget, "documentToken" | "finalize"> {
  if (target.state === "awaiting-document" && target.signed) {
    return { documentToken: mintReviewedDocumentOperation(actor.accountId, actor.sessionId, "document-session", target.subjectId) };
  }
  if (target.state === "awaiting-request" && target.signed) {
    return { finalize: { nonce: mintReviewedDocumentOperation(actor.accountId, actor.sessionId, "finalize", target.subjectId),
      csrf: finalizeCsrf(actor.accountId, actor.sessionId, target.subjectId) } };
  }
  return {};
}

/**
 * The upload page's reviewed-document cards: each person before activation,
 * the uploader artifact presented once for a person not yet signed for, and
 * the one-time tokens of the step that is due. Null outside TEST-LOCAL.
 */
export async function prepareReviewedDocumentTargets(): Promise<ReviewedDocumentTarget[] | null> {
  const actor = await currentOwnUploadAccount();
  if (!actor) return null;
  const targets = await listReviewedDocumentTargets();
  if (!targets) return null;
  const unsigned = targets.filter((target) => target.state === "awaiting-document" && !target.signed);
  const presented = unsigned.length > 0 ? await presentUploaderArtifactFor(unsigned.map((target) => target.subjectId)) : new Map();
  if (!presented) return null;
  return targets.map((target) => ({ ...target, ...(presented.get(target.subjectId) ?? {}),
    ...reviewedDocumentTokens(actor, target) }));
}
