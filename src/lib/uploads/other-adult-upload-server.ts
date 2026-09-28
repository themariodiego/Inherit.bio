import "server-only";

import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { hmacSecret } from "@/lib/crypto";
import { accountCapability, isTestJurisdictionEnabled } from "@/lib/legal/jurisdictions";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  OTHER_ADULT_UPLOAD_ARTIFACT_KEY,
  OTHER_ADULT_UPLOAD_STATEMENT_KEYS,
  artifactStatements,
  artifactWarning,
  otherAdultTargetState,
  type OtherAdultTarget,
  type OtherAdultTargetState,
} from "./other-adult-upload";
import { currentOwnUploadAccount } from "./own-upload-context";

/**
 * Server half of the register's Path B (G2.6 adult half, G5.3). TEST-LOCAL
 * only, three times over: this module answers nothing unless
 * `INHERIT_TEST_JURISDICTION=1`, the acting account's jurisdiction must
 * resolve `third_party_adult_analysis` to permitted, and every database call
 * passes the flag the database itself requires.
 */

type Admin = ReturnType<typeof createAdminClient>;
type RpcResult = { data: unknown; error: { code?: string; message?: string } | null };

/** The Path B RPCs are additive; their wire data stays behind closed schemas. */
export function heldUploadRpc(admin: Admin, name: string, args: Record<string, unknown>): PromiseLike<RpcResult> {
  const rpc = admin.rpc.bind(admin) as unknown as (name: string, args: Record<string, unknown>) => PromiseLike<RpcResult>;
  return rpc(name, args);
}

/** The same client, for the columns and tables this migration adds; every row read is parsed. */
export function looseAdmin(admin: Admin): SupabaseClient {
  return admin as unknown as SupabaseClient;
}

/** Every gate the routes and pages apply before touching Path B. */
export async function otherAdultUploadAvailable(accountId: string): Promise<boolean> {
  if (!isTestJurisdictionEnabled()) return false;
  const decision = await accountCapability(accountId, "third_party_adult_analysis").catch(() => null);
  return decision?.status === "permitted";
}

const uuid = z.uuid().regex(/^[0-9a-f-]+$/);

/** A sealed, short-lived envelope: base64url JSON, a dot, a keyed digest. */
function seal(claims: unknown, context: string): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${hmacSecret(payload, context)}`;
}

function unseal(token: string, context: string): unknown {
  if (token.length > 4096) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]!) || !/^[0-9a-f]{64}$/.test(parts[1]!)) return null;
  const expected = hmacSecret(parts[0]!, context);
  if (!crypto.timingSafeEqual(Buffer.from(parts[1]!, "hex"), Buffer.from(expected, "hex"))) return null;
  try {
    const payload = Buffer.from(parts[0]!, "base64url");
    if (payload.toString("base64url") !== parts[0]) return null;
    return JSON.parse(payload.toString("utf8"));
  } catch { return null; }
}

const PRESENTATION_CONTEXT = "other-adult-upload-artifact-presentation-v1";
// Below the database's ten-minute nonce ceiling, as the own-upload token is.
const PRESENTATION_LIFETIME_MS = 9 * 60 * 1000;
const presentationSchema = z.object({
  accountId: uuid,
  sessionId: uuid,
  subjectId: uuid,
  artifactVersion: z.number().int().positive().safe(),
  artifactBodySha256: z.string().regex(/^[0-9a-f]{64}$/),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{32}$/),
  issuedAt: z.number().int().positive().safe(),
  expiresAt: z.number().int().positive().safe(),
}).strict();
export type OtherAdultPresentation = z.infer<typeof presentationSchema>;

export function mintOtherAdultPresentation(
  input: Omit<OtherAdultPresentation, "nonce" | "issuedAt" | "expiresAt">,
  now = Date.now(),
): { token: string; claims: OtherAdultPresentation; nonceHash: string } {
  const claims = presentationSchema.parse({ ...input, nonce: crypto.randomBytes(24).toString("base64url"),
    issuedAt: now, expiresAt: now + PRESENTATION_LIFETIME_MS });
  return { claims, token: seal(claims, PRESENTATION_CONTEXT),
    nonceHash: crypto.createHash("sha256").update(claims.nonce).digest("hex") };
}

export function readOtherAdultPresentation(token: string, now = Date.now()): OtherAdultPresentation | null {
  if (!Number.isSafeInteger(now)) return null;
  const parsed = presentationSchema.safeParse(unseal(token, PRESENTATION_CONTEXT));
  if (!parsed.success) return null;
  const claims = parsed.data;
  return claims.issuedAt <= now && claims.expiresAt > now
    && claims.expiresAt - claims.issuedAt === PRESENTATION_LIFETIME_MS ? claims : null;
}

/**
 * The page's operation token for the two uploader mutations that are not
 * signatures: reserving a draft (target: the account) and sending the
 * request (target: the draft). It travels in `x-inherit-csrf` and binds the
 * account, its session, the operation and the target.
 */
const OPERATION_CONTEXT = "path-b-operation-v1";
const OPERATION_LIFETIME_MS = 10 * 60 * 1000;
export type PathBOperation = "draft-create" | "request-send";
const operationSchema = z.object({
  accountId: uuid,
  sessionId: uuid,
  operation: z.enum(["draft-create", "request-send"]),
  targetId: uuid,
  expiresAt: z.number().int().positive().safe(),
}).strict();

export function mintPathBOperation(accountId: string, sessionId: string, operation: PathBOperation, targetId: string,
  now = Date.now()): string {
  return seal(operationSchema.parse({ accountId, sessionId, operation, targetId, expiresAt: now + OPERATION_LIFETIME_MS }),
    OPERATION_CONTEXT);
}

export function verifyPathBOperation(token: string | null, expected: { accountId: string; sessionId: string;
  operation: PathBOperation; targetId: string }, now = Date.now()): boolean {
  if (!token) return false;
  const parsed = operationSchema.safeParse(unseal(token, OPERATION_CONTEXT));
  return parsed.success && parsed.data.expiresAt > now && parsed.data.expiresAt - now <= OPERATION_LIFETIME_MS
    && parsed.data.accountId === expected.accountId && parsed.data.sessionId === expected.sessionId
    && parsed.data.operation === expected.operation && parsed.data.targetId === expected.targetId;
}

/** The uploader's own Path B people, read-only. Null outside TEST-LOCAL. */
export async function listOtherAdultTargets(): Promise<OtherAdultTargetState[] | null> {
  const actor = await currentOwnUploadAccount();
  if (!actor || !(await otherAdultUploadAvailable(actor.accountId))) return null;
  const { data, error } = await heldUploadRpc(createAdminClient(), "other_adult_upload_targets_v1", {
    p_account_id: actor.accountId, p_session_id: actor.sessionId, p_test_jurisdiction: true,
  });
  const parsed = z.array(otherAdultTargetState).safeParse(data);
  return error || !parsed.success ? null : parsed.data;
}

export interface OtherAdultUploads {
  /** Sealed for reserving a new Path B draft from this account. */
  draftToken: string;
  targets: OtherAdultTarget[];
}

/**
 * The upload page's Path B section: the people, and for each one still to
 * sign for, the approved artifact presented once — a sealed token bound to
 * this account, session, person and exact artifact hash, whose nonce the
 * database records now and consumes once at signing.
 */
export async function prepareOtherAdultUploads(): Promise<OtherAdultUploads | null> {
  const actor = await currentOwnUploadAccount();
  if (!actor || !(await otherAdultUploadAvailable(actor.accountId))) return null;
  const admin = createAdminClient();
  const targets = await listOtherAdultTargets();
  if (!targets) return null;
  const { data: artifact } = await admin.from("consent_artifacts")
    .select("version, effective_on, summary_markdown, body_markdown, body_sha256")
    .eq("artifact_key", OTHER_ADULT_UPLOAD_ARTIFACT_KEY).is("superseded_at", null).maybeSingle();
  if (!artifact || crypto.createHash("sha256").update(artifact.body_markdown).digest("hex") !== artifact.body_sha256) {
    return null;
  }
  const texts = artifactStatements(artifact.body_markdown);
  if (texts.length !== OTHER_ADULT_UPLOAD_STATEMENT_KEYS.length) return null;
  const statements = OTHER_ADULT_UPLOAD_STATEMENT_KEYS.map((key, index) => ({ key, text: texts[index]! }));
  const warning = artifactWarning(artifact.body_markdown);
  if (!warning) return null;
  const result: OtherAdultTarget[] = [];
  for (const target of targets) {
    const operationToken = target.state === "awaiting-request"
      ? mintPathBOperation(actor.accountId, actor.sessionId, "request-send", target.subjectId) : undefined;
    const needsSignature = !target.signed && (target.state === "awaiting-request" || target.state === "ready");
    if (!needsSignature) { result.push({ ...target, operationToken }); continue; }
    const presentation = mintOtherAdultPresentation({ accountId: actor.accountId, sessionId: actor.sessionId,
      subjectId: target.subjectId, artifactVersion: artifact.version, artifactBodySha256: artifact.body_sha256 });
    const { data, error } = await heldUploadRpc(admin, "present_other_adult_upload_artifact_v1", {
      p_account_id: actor.accountId, p_session_id: actor.sessionId, p_subject_id: target.subjectId,
      p_nonce_hash: presentation.nonceHash, p_expires_at: new Date(presentation.claims.expiresAt).toISOString(),
      p_test_jurisdiction: true,
    });
    const presented = z.object({ artifactKey: z.literal(OTHER_ADULT_UPLOAD_ARTIFACT_KEY),
      artifactVersion: z.literal(artifact.version), artifactBodySha256: z.literal(artifact.body_sha256) }).strict()
      .safeParse(data);
    if (error || !presented.success) {
      result.push({ ...target, blockedBy: error?.message === "adult_account_required" ? "account-completion" : "unavailable" });
      continue;
    }
    result.push({ ...target, operationToken, consent: { token: presentation.token, version: artifact.version,
      effectiveOn: artifact.effective_on, summary: artifact.summary_markdown, body: artifact.body_markdown, statements,
      warning } });
  }
  return { draftToken: mintPathBOperation(actor.accountId, actor.sessionId, "draft-create", actor.accountId), targets: result };
}

/**
 * A confirmed Path B subject this account owns: the only kind of subject the
 * held-upload issuer is asked about. The database decides; this only routes.
 */
export async function isHeldUploadTarget(accountId: string, subjectId: string): Promise<boolean> {
  if (!isTestJurisdictionEnabled() || !uuid.safeParse(subjectId).success) return false;
  try {
    const { data, error } = await createAdminClient().from("subjects")
      .select("subject_class, lifecycle, owner_account_id, subject_account_id").eq("id", subjectId).maybeSingle();
    return !error && data?.subject_class === "other_adult" && data.lifecycle === "active"
      && data.owner_account_id === accountId && data.subject_account_id === null;
  } catch {
    // An unreadable subject is not a Path B subject; the own issuer then refuses it.
    return false;
  }
}
