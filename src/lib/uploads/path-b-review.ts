import "server-only";

import crypto from "node:crypto";
import { z } from "zod";
import { hmacSecret } from "@/lib/crypto";
import { mintPublicFormToken, readPublicFormToken } from "@/lib/embryos/operation-token";
import { readRightsSessionHash, RIGHTS_COOKIE_NAME } from "@/lib/embryos/rights-session";
import { adultSubjectRequestAllowed } from "@/lib/embryos/adult-subject-review";
import { isTestJurisdictionEnabled } from "@/lib/legal/jurisdictions";
import {
  currentJurisdictionAttestation,
  jurisdictionChoices,
  type JurisdictionAttestation,
  type JurisdictionChoice,
} from "@/lib/legal/jurisdiction-declaration";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  SUBJECT_ESIGNATURE_ARTIFACT_KEY,
  SUBJECT_ESIGNATURE_STATEMENT_KEYS,
  adultUploadRevisionView,
  artifactStatements,
  type AdultUploadRevisionView,
} from "./other-adult-upload";
import { heldUploadRpc, looseAdmin } from "./other-adult-upload-server";

/**
 * The person's side of the register's Path B, on `/withdraw/session`, read
 * from the rights session a mailed link opened. Nothing here reads a token:
 * the browser presents the host-only cookie the activation route set, and
 * the purpose stored on the session decides which of two screens this is.
 *
 *   - `adult-subject-invitation` on a Path B draft: the request to sign. The
 *     person signs their own artifact with no account; refusing and deleting
 *     are the shared adult controls.
 *   - `adult-upload-confirmation`: one held file revision. The person sees
 *     exactly what the uploader sees and confirms or refuses that file, or
 *     deletes everything.
 *
 * TEST-LOCAL only: both loaders return null anywhere else.
 */

function oneRightsCookie(request: Request): boolean {
  return (request.headers.get("cookie") ?? "").split(";")
    .filter(part => part.trim().split("=")[0] === RIGHTS_COOKIE_NAME).length === 1;
}

const PRESENTATION_CONTEXT = "path-b-subject-artifact-presentation-v1";
const PRESENTATION_LIFETIME_MS = 9 * 60 * 1000;
const presentationSchema = z.object({
  sessionHash: z.string().regex(/^[0-9a-f]{64}$/),
  artifactVersion: z.number().int().positive().safe(),
  artifactBodySha256: z.string().regex(/^[0-9a-f]{64}$/),
  issuedAt: z.number().int().positive().safe(),
  expiresAt: z.number().int().positive().safe(),
}).strict();
type SubjectPresentation = z.infer<typeof presentationSchema>;

/** The person's artifact, presented for this session: its version and exact hash, for nine minutes. */
export function mintSubjectPresentation(sessionHash: string, artifactVersion: number, artifactBodySha256: string,
  now = Date.now()): string {
  const claims = presentationSchema.parse({ sessionHash, artifactVersion, artifactBodySha256,
    issuedAt: now, expiresAt: now + PRESENTATION_LIFETIME_MS });
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${hmacSecret(payload, PRESENTATION_CONTEXT)}`;
}

export function readSubjectPresentation(token: string, now = Date.now()): SubjectPresentation | null {
  const parts = token.split(".");
  if (token.length > 4096 || parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]!)
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

export interface PathBRequestReview {
  nonce: string;
  /** The name the uploader typed for this person: part of what the uploader sees. */
  label: string;
  artifact: {
    version: number;
    effectiveOn: string;
    summary: string;
    body: string;
    bodySha256: string;
    presentationToken: string;
    statements: { key: string; text: string }[];
  };
  countries: JurisdictionChoice[];
  attestation: JurisdictionAttestation;
}

const sessionRow = z.object({
  token_hash_id: z.uuid(), purpose: z.string(), target_kind: z.string(), target_id: z.uuid(),
  principal_id: z.uuid(), authority_revision: z.number(), status: z.string(), expires_at: z.string(),
});

/** The Path B request this session was opened for, or null. */
export async function loadPathBRequestReview(request: Request, now = Date.now()): Promise<PathBRequestReview | null> {
  if (!isTestJurisdictionEnabled()) return null;
  const sessionHash = readRightsSessionHash(request);
  if (!sessionHash) return null;
  const admin = createAdminClient();
  const { data: sessionData } = await admin.from("rights_sessions")
    .select("token_hash_id, purpose, target_kind, target_id, principal_id, authority_revision, status, expires_at")
    .eq("session_hash", sessionHash).maybeSingle();
  const session = sessionRow.safeParse(sessionData);
  if (!session.success || session.data.purpose !== "adult-subject-invitation" || session.data.target_kind !== "subject"
    || session.data.status !== "active" || !(Date.parse(session.data.expires_at) > now)) return null;
  const nowIso = new Date(now).toISOString();
  const { data: draftData } = await looseAdmin(admin).from("adult_subject_drafts")
    .select("adult_flow, state, fixed_expires_at").eq("subject_id", session.data.target_id).maybeSingle();
  const draft = z.object({ adult_flow: z.literal("path-b-subject-esignature"), state: z.literal("invited"),
    fixed_expires_at: z.string() }).safeParse(draftData);
  if (!draft.success || !(Date.parse(draft.data.fixed_expires_at) > now)) return null;
  const [{ data: subject }, { data: invitation }] = await Promise.all([
    admin.from("subjects").select("display_label, lifecycle").eq("id", session.data.target_id).maybeSingle(),
    admin.from("subject_invitations").select("id").eq("target_kind", "subject").eq("target_id", session.data.target_id)
      .eq("invitee_principal_id", session.data.principal_id).eq("invitation_kind", "adult_subject")
      .eq("status", "pending").eq("invitation_revision", session.data.authority_revision).gt("expires_at", nowIso)
      .maybeSingle(),
  ]);
  if (!subject || subject.lifecycle !== "draft" || !invitation) return null;
  const [{ data: artifact }, attestation] = await Promise.all([
    admin.from("consent_artifacts").select("version, effective_on, summary_markdown, body_markdown, body_sha256")
      .eq("artifact_key", SUBJECT_ESIGNATURE_ARTIFACT_KEY).is("superseded_at", null).maybeSingle(),
    currentJurisdictionAttestation(),
  ]);
  if (!artifact || !attestation
    || crypto.createHash("sha256").update(artifact.body_markdown).digest("hex") !== artifact.body_sha256) return null;
  const texts = artifactStatements(artifact.body_markdown);
  if (texts.length !== SUBJECT_ESIGNATURE_STATEMENT_KEYS.length) return null;
  return {
    nonce: mintPublicFormToken("adult-subject-respond", now, sessionHash),
    label: subject.display_label,
    artifact: {
      version: artifact.version, effectiveOn: artifact.effective_on, summary: artifact.summary_markdown,
      body: artifact.body_markdown, bodySha256: artifact.body_sha256,
      presentationToken: mintSubjectPresentation(sessionHash, artifact.version, artifact.body_sha256, now),
      statements: SUBJECT_ESIGNATURE_STATEMENT_KEYS.map((key, index) => ({ key, text: texts[index]! })),
    },
    countries: jurisdictionChoices(),
    attestation,
  };
}

/** The session hash and one-time nonce of a revision form this deployment served for this session. */
export function readAdultUploadRevisionResponse(request: Request, nonce: string, now = Date.now()) {
  if (!adultSubjectRequestAllowed(request) || !oneRightsCookie(request)) return null;
  const sessionHash = readRightsSessionHash(request);
  if (!sessionHash) return null;
  const claims = readPublicFormToken(nonce, "adult-upload-respond", now, sessionHash);
  return claims ? { sessionHash, nonce: claims.nonce } : null;
}

export interface AdultUploadRevisionReview {
  nonce: string;
  revision: AdultUploadRevisionView;
}

/** The file revision this session was opened for, or null. */
export async function loadAdultUploadRevisionReview(request: Request, now = Date.now()):
  Promise<AdultUploadRevisionReview | null> {
  if (!isTestJurisdictionEnabled()) return null;
  const sessionHash = readRightsSessionHash(request);
  if (!sessionHash) return null;
  const { data, error } = await heldUploadRpc(createAdminClient(), "read_adult_upload_revision_v1",
    { p_session_hash: sessionHash });
  const revision = adultUploadRevisionView.safeParse(data);
  if (error || !revision.success) return null;
  return { nonce: mintPublicFormToken("adult-upload-respond", now, sessionHash), revision: revision.data };
}
