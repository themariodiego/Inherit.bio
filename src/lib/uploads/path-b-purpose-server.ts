import "server-only";

import crypto from "node:crypto";
import { z } from "zod";
import { hmacSecret } from "@/lib/crypto";
import { isTestJurisdictionEnabled } from "@/lib/legal/jurisdictions";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentPathBAccount, heldUploadRpc } from "./other-adult-upload-server";
import { ownUploadJson } from "./own-upload-context";
import {
  PATH_B_DIRECTIONS,
  PATH_B_GRANT_TEXT,
  PATH_B_PURPOSES,
  PATH_B_STATEMENTS,
  pathBPersonChoices,
  pathBPurposeBody,
  pathBUploaderShares,
  type PathBChoice,
  type PathBChoicesView,
  type PathBUploaderShares,
} from "./path-b-purpose";

/**
 * The server half of Path B's reading layer (TEST-LOCAL only). The page
 * mints one short-lived presentation per layer and direction the person may
 * turn on; the route accepts only a presentation it minted, for the same
 * account and session, and hands the database nothing the body could
 * retarget: the direction, the text and its hash come from the token.
 */

const CONTEXT = "path-b-purpose-presentation-v1";
const LIFETIME_MS = 540_000;
const uuid = z.uuid().regex(/^[0-9a-f-]+$/);
const presentation = z.object({
  accountId: uuid, sessionId: uuid, subjectId: uuid,
  purpose: z.enum(PATH_B_PURPOSES), direction: z.enum(PATH_B_DIRECTIONS),
  artifactKey: z.string().max(64), artifactVersion: z.number().int().positive().safe(),
  artifactBodySha256: z.string().regex(/^[0-9a-f]{64}$/),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{32}$/),
  issuedAt: z.number().int().positive().safe(), expiresAt: z.number().int().positive().safe(),
}).strict().refine(c => c.artifactKey === PATH_B_GRANT_TEXT[c.direction][c.purpose]);
export type PathBPurposePresentation = z.infer<typeof presentation>;

export function mintPathBPurposePresentation(input: Omit<PathBPurposePresentation, "nonce" | "issuedAt" | "expiresAt">,
  now = Date.now()) {
  const claims = presentation.parse({ ...input, nonce: crypto.randomBytes(24).toString("base64url"),
    issuedAt: now, expiresAt: now + LIFETIME_MS });
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return { claims, token: `${payload}.${hmacSecret(payload, CONTEXT)}` };
}

export function readPathBPurposePresentation(token: string, now = Date.now()): PathBPurposePresentation | null {
  if (token.length > 4096 || !Number.isSafeInteger(now)) return null;
  const [payload, signature, extra] = token.split(".");
  if (extra !== undefined || !payload || !/^[A-Za-z0-9_-]+$/.test(payload) || !/^[0-9a-f]{64}$/.test(signature ?? "")) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature!, "hex"), Buffer.from(hmacSecret(payload, CONTEXT), "hex"))) return null;
  try {
    const bytes = Buffer.from(payload, "base64url");
    if (bytes.toString("base64url") !== payload) return null;
    const parsed = presentation.safeParse(JSON.parse(bytes.toString("utf8")));
    if (!parsed.success) return null;
    const c = parsed.data;
    return c.issuedAt <= now && c.expiresAt > now && c.expiresAt - c.issuedAt === LIFETIME_MS ? c : null;
  } catch { return null; }
}

/** A grant body whose token is a Path B presentation: it never falls through to another grant. */
export function isPathBPurposeConsentPayload(value: unknown): boolean {
  return typeof value === "object" && value !== null && "action" in value && value.action === "grant-purpose"
    && "artifactPresentationToken" in value && typeof value.artifactPresentationToken === "string"
    && readPathBPurposePresentation(value.artifactPresentationToken) !== null;
}

const receipt = z.object({ recordKind: z.literal("purpose_grant"), recordId: z.uuid(), artifactKey: z.string(),
  artifactVersion: z.number().int().positive().safe(), purposeKey: z.string(),
  signedAt: z.iso.datetime({ offset: true }) }).strict();

/** `POST /api/consents`, one Path B layer in one direction. */
export async function pathBPurposeConsent(request: Request, payload: unknown): Promise<Response> {
  if (!isTestJurisdictionEnabled()) return ownUploadJson({ error: "not_found" }, 404);
  const parsed = pathBPurposeBody.safeParse(payload);
  if (!parsed.success) return ownUploadJson({ error: "invalid_request" }, 422);
  const body = parsed.data;
  if (request.headers.get("origin") !== new URL(request.url).origin
    || request.headers.get("sec-fetch-site") !== "same-origin"
    || request.headers.get("x-inherit-csrf") !== body.artifactPresentationToken) return ownUploadJson({ error: "forbidden" }, 403);
  const actor = await currentPathBAccount();
  if (!actor) return ownUploadJson({ error: "unauthorized" }, 401);
  const c = readPathBPurposePresentation(body.artifactPresentationToken);
  if (!c || c.accountId !== actor.accountId || c.sessionId !== actor.sessionId || c.subjectId !== body.subjectId
    || c.purpose !== body.purposeKey || c.artifactVersion !== body.artifactVersion
    || JSON.stringify(body.statementKeys) !== JSON.stringify(PATH_B_STATEMENTS[c.direction])) {
    return ownUploadJson({ error: "not_found" }, 404);
  }
  const { data, error } = await heldUploadRpc(createAdminClient(), "grant_path_b_purpose_v1", {
    p_account_id: actor.accountId, p_session_id: actor.sessionId, p_subject_id: c.subjectId,
    p_purpose: c.purpose, p_direction: c.direction, p_artifact_version: c.artifactVersion,
    p_artifact_body_sha256: c.artifactBodySha256,
    p_nonce_hash: crypto.createHash("sha256").update(c.nonce).digest("hex"),
    p_expires_at: new Date(c.expiresAt).toISOString(), p_test_jurisdiction: true,
  });
  if (error) {
    if (error.code === "42501" || error.code === "23505") return ownUploadJson({ error: "not_found" }, 404);
    if (error.code === "22023") return ownUploadJson({ error: "invalid_request" }, 422);
    if (error.code === "55000") {
      return ownUploadJson({ error: error.message === "consent_artifact_changed" ? "consent_artifact_changed" : "state_conflict" }, 409);
    }
    return ownUploadJson({ error: "unavailable" }, 503);
  }
  const recorded = receipt.safeParse(data);
  if (!recorded.success || recorded.data.artifactKey !== c.artifactKey || recorded.data.artifactVersion !== c.artifactVersion
    || recorded.data.purposeKey !== c.purpose) return ownUploadJson({ error: "unavailable" }, 503);
  return ownUploadJson(recorded.data, 201);
}

const artifactRow = z.object({ artifact_key: z.string(), version: z.number().int().positive(),
  body_markdown: z.string(), body_sha256: z.string() });

/**
 * The person's choices for each Path B subject bound to their account: each
 * layer in each direction, its current grant, and a presentation for every
 * row that can be turned on now. Null outside TEST-LOCAL or signed out.
 */
export async function preparePathBChoices(now = Date.now()): Promise<PathBChoicesView[] | null> {
  if (!isTestJurisdictionEnabled()) return null;
  const actor = await currentPathBAccount();
  if (!actor) return null;
  const admin = createAdminClient();
  const { data, error } = await heldUploadRpc(admin, "path_b_person_choices_v1", {
    p_account_id: actor.accountId, p_session_id: actor.sessionId, p_test_jurisdiction: true,
  });
  const people = pathBPersonChoices.safeParse(data);
  if (error || !people.success) return null;
  if (people.data.length === 0) return [];
  const keys = [...new Set(Object.values(PATH_B_GRANT_TEXT).flatMap(texts => Object.values(texts)))];
  const { data: rows } = await admin.from("consent_artifacts")
    .select("artifact_key, version, body_markdown, body_sha256").in("artifact_key", keys).is("superseded_at", null);
  const artifacts = new Map<string, z.infer<typeof artifactRow>>();
  for (const row of rows ?? []) {
    const parsed = artifactRow.safeParse(row);
    if (parsed.success && crypto.createHash("sha256").update(parsed.data.body_markdown).digest("hex") === parsed.data.body_sha256) {
      artifacts.set(parsed.data.artifact_key, parsed.data);
    }
  }
  return people.data.map(person => {
    const shareOpen = person.uploaderShare.decision === "allow";
    const choices: PathBChoice[] = [];
    for (const purpose of PATH_B_PURPOSES) {
      for (const direction of PATH_B_DIRECTIONS) {
        const grant = person.grants.find(g => g.purpose === purpose && g.direction === direction) ?? null;
        const artifact = artifacts.get(PATH_B_GRANT_TEXT[direction][purpose]);
        const canOffer = !grant && artifact && (direction === "self" || shareOpen);
        choices.push({ purpose, direction, grantId: grant?.grantId ?? null,
          offer: canOffer ? {
            token: mintPathBPurposePresentation({ accountId: actor.accountId, sessionId: actor.sessionId,
              subjectId: person.subjectId, purpose, direction, artifactKey: artifact.artifact_key,
              artifactVersion: artifact.version, artifactBodySha256: artifact.body_sha256 }, now).token,
            artifactVersion: artifact.version, artifactBody: artifact.body_markdown,
          } : null });
      }
    }
    return { subjectId: person.subjectId, label: person.label, shareOpen, choices, readGate: person.readGate };
  });
}

/** The layers each account-bound person shared with the signed-in uploader. Null outside TEST-LOCAL. */
export async function listPathBUploaderShares(): Promise<PathBUploaderShares | null> {
  if (!isTestJurisdictionEnabled()) return null;
  const actor = await currentPathBAccount();
  if (!actor) return null;
  const { data, error } = await heldUploadRpc(createAdminClient(), "path_b_uploader_shares_v1", {
    p_account_id: actor.accountId, p_session_id: actor.sessionId, p_test_jurisdiction: true,
  });
  const parsed = pathBUploaderShares.safeParse(data);
  return error || !parsed.success ? null : parsed.data;
}
