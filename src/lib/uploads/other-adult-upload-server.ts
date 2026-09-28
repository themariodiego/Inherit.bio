import "server-only";

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { hmacSecret } from "@/lib/crypto";
import { accountCapability, isTestJurisdictionEnabled } from "@/lib/legal/jurisdictions";
import { parseArtifactFile } from "@/lib/legal/artifact-file";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  OTHER_ADULT_UPLOAD_ARTIFACT_KEY,
  OTHER_ADULT_UPLOAD_DRAFT_STATUS,
  OTHER_ADULT_UPLOAD_STATEMENT_KEYS,
  artifactStatements,
  artifactWarning,
  otherAdultTargetState,
  type OtherAdultTarget,
  type OtherAdultTargetState,
} from "./other-adult-upload";
import { currentOwnUploadAccount } from "./own-upload-context";

/**
 * Server half of another adult's held upload (G2.6 adult half, G5.3).
 * TEST-LOCAL only, three times over: this module answers nothing unless
 * `INHERIT_TEST_JURISDICTION=1`, the acting account's jurisdiction must
 * resolve `third_party_adult_analysis` to permitted, and every database call
 * passes the flag the database itself requires.
 */

type Admin = ReturnType<typeof createAdminClient>;
type RpcResult = { data: unknown; error: { code?: string; message?: string } | null };

/** The held-upload RPCs are additive; their wire data stays behind closed schemas. */
export function heldUploadRpc(admin: Admin, name: string, args: Record<string, unknown>): PromiseLike<RpcResult> {
  const rpc = admin.rpc.bind(admin) as unknown as (name: string, args: Record<string, unknown>) => PromiseLike<RpcResult>;
  return rpc(name, args);
}

/** Every gate the routes and pages apply before touching the held branch. */
export async function otherAdultUploadAvailable(accountId: string): Promise<boolean> {
  if (!isTestJurisdictionEnabled()) return false;
  const decision = await accountCapability(accountId, "third_party_adult_analysis").catch(() => null);
  return decision?.status === "permitted";
}

/**
 * The draft artifact is not seeded by any migration. Under TEST-LOCAL the
 * server installs it from the committed file through the one installer,
 * which accepts only the exact text pinned by hash in the migration.
 */
export async function ensureDraftArtifactInstalled(admin: Admin): Promise<boolean> {
  if (!isTestJurisdictionEnabled()) return false;
  const { data: present } = await admin.from("consent_artifacts").select("version")
    .eq("artifact_key", OTHER_ADULT_UPLOAD_ARTIFACT_KEY).is("superseded_at", null).maybeSingle();
  if (present) return true;
  let source: string;
  try {
    source = fs.readFileSync(path.join(process.cwd(), "content/legal", OTHER_ADULT_UPLOAD_ARTIFACT_KEY, "v1.md"), "utf8");
  } catch { return false; }
  const file = parseArtifactFile(source);
  if (!file || file.meta.status !== OTHER_ADULT_UPLOAD_DRAFT_STATUS) return false;
  const { data, error } = await heldUploadRpc(admin, "install_test_local_other_adult_artifact_v1", {
    p_body: file.body, p_summary: file.summary, p_effective_on: file.meta.effective_on, p_test_jurisdiction: true,
  });
  return !error && data === true;
}

const PRESENTATION_CONTEXT = "other-adult-upload-artifact-presentation-v1";
// Below the database's ten-minute nonce ceiling, as the own-upload token is.
const PRESENTATION_LIFETIME_MS = 9 * 60 * 1000;
const uuid = z.uuid().regex(/^[0-9a-f-]+$/);
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
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return { claims, token: `${payload}.${hmacSecret(payload, PRESENTATION_CONTEXT)}`,
    nonceHash: crypto.createHash("sha256").update(claims.nonce).digest("hex") };
}

export function readOtherAdultPresentation(token: string, now = Date.now()): OtherAdultPresentation | null {
  if (token.length > 4096 || !Number.isSafeInteger(now)) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[0-9a-f]{64}$/.test(parts[1])) return null;
  const expected = hmacSecret(parts[0], PRESENTATION_CONTEXT);
  if (!crypto.timingSafeEqual(Buffer.from(parts[1], "hex"), Buffer.from(expected, "hex"))) return null;
  try {
    const payload = Buffer.from(parts[0], "base64url");
    if (payload.toString("base64url") !== parts[0]) return null;
    const parsed = presentationSchema.safeParse(JSON.parse(payload.toString("utf8")));
    if (!parsed.success) return null;
    const claims = parsed.data;
    return claims.issuedAt <= now && claims.expiresAt > now
      && claims.expiresAt - claims.issuedAt === PRESENTATION_LIFETIME_MS ? claims : null;
  } catch { return null; }
}

/** The uploader's own pending reservations, read-only. Null outside TEST-LOCAL. */
export async function listOtherAdultTargets(): Promise<OtherAdultTargetState[] | null> {
  const actor = await currentOwnUploadAccount();
  if (!actor || !(await otherAdultUploadAvailable(actor.accountId))) return null;
  const { data, error } = await heldUploadRpc(createAdminClient(), "other_adult_upload_targets_v1", {
    p_account_id: actor.accountId, p_session_id: actor.sessionId, p_test_jurisdiction: true,
  });
  const parsed = z.array(otherAdultTargetState).safeParse(data);
  return error || !parsed.success ? null : parsed.data;
}

/**
 * The same list for the upload page, with the draft artifact presented once
 * for each unsigned reservation: a sealed token bound to this account,
 * session, reservation and exact artifact hash, whose nonce the database
 * records now and consumes once at signing.
 */
export async function prepareOtherAdultUploads(): Promise<OtherAdultTarget[] | null> {
  const actor = await currentOwnUploadAccount();
  if (!actor || !(await otherAdultUploadAvailable(actor.accountId))) return null;
  const admin = createAdminClient();
  if (!(await ensureDraftArtifactInstalled(admin))) return null;
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
    if (target.state !== "unsigned") { result.push(target); continue; }
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
    result.push({ ...target, consent: { token: presentation.token, version: artifact.version,
      effectiveOn: artifact.effective_on, summary: artifact.summary_markdown, body: artifact.body_markdown, statements,
      warning } });
  }
  return result;
}

/** A reserved other-adult subject of this account's own pending invitation. */
export async function isHeldUploadTarget(accountId: string, subjectId: string): Promise<boolean> {
  if (!isTestJurisdictionEnabled() || !uuid.safeParse(subjectId).success) return false;
  try {
    const { data, error } = await createAdminClient().from("subjects")
      .select("subject_class, lifecycle, owner_account_id, subject_account_id").eq("id", subjectId).maybeSingle();
    return !error && data?.subject_class === "other_adult" && data.lifecycle === "draft"
      && data.owner_account_id === accountId && data.subject_account_id === null;
  } catch {
    // An unreadable subject is not a reservation; the own issuer then refuses it.
    return false;
  }
}
