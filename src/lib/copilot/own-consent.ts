import "server-only";
import crypto from "node:crypto";
import { z } from "zod";
import { hmacSecret } from "@/lib/crypto";
import { currentOwnUploadAccount, ownUploadJson } from "@/lib/uploads/own-upload-context";
import { resolveSubjectForAccount } from "@/lib/subjects";
import { createAdminClient } from "@/lib/supabase/admin";
import { modelRuntimeRevision } from "./model-endpoint";
import { ownCopilotAuthoritySchema, ownCopilotConfigurationSchema, ownCopilotRpc } from "./own-provider-authority";
import { sameOriginCopilot } from "./own-settings";

const CONTEXT = "own-copilot-permission-presentation-v1";
const artifactsSchema = z.array(z.object({ key: z.string(), version: z.number().int().positive().safe(), body: z.string().max(4096), sha256: z.string().regex(/^[0-9a-f]{64}$/) }).strict()).min(1).max(2);
const presentationSchema = z.object({ snapshot: ownCopilotConfigurationSchema, artifacts: artifactsSchema,
  nonce: z.string().regex(/^[A-Za-z0-9_-]{32}$/), issuedAt: z.number().int().positive().safe(), expiresAt: z.number().int().positive().safe(),
}).strict();
export function mintOwnCopilotConsent(input: Pick<z.infer<typeof presentationSchema>, "snapshot" | "artifacts">, now = Date.now()) {
  const value = presentationSchema.parse({ ...input, nonce: crypto.randomBytes(24).toString("base64url"), issuedAt: now, expiresAt: now + 540_000 });
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${payload}.${hmacSecret(payload, CONTEXT)}`;
}
export function readOwnCopilotConsent(token: string, now = Date.now()) {
  if (token.length > 8192) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !/^[A-Za-z0-9_-]+$/.test(payload) || !/^[0-9a-f]{64}$/.test(signature ?? "") || extra !== undefined) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(hmacSecret(payload, CONTEXT), "hex"))) return null;
  try {
    const decoded = Buffer.from(payload, "base64url");
    if (decoded.toString("base64url") !== payload) return null;
    const result = presentationSchema.safeParse(JSON.parse(decoded.toString("utf8")));
    if (!result.success || result.data.issuedAt > now || result.data.expiresAt <= now || result.data.expiresAt - result.data.issuedAt !== 540_000) return null;
    return result.data;
  } catch { return null; }
}
export function isOwnCopilotConsentPayload(value: unknown): boolean {
  return typeof value === "object" && value !== null && "action" in value && value.action === "grant-purpose"
    && "artifactPresentationToken" in value && typeof value.artifactPresentationToken === "string"
    && readOwnCopilotConsent(value.artifactPresentationToken) !== null;
}
const bodySchema = z.object({ action: z.literal("grant-purpose"), subjectId: z.uuid(), purposeKey: z.enum(["copilot.local", "copilot.cloud"]),
  artifactVersion: z.number().int().positive().safe(), artifactPresentationToken: z.string().max(8192), affirmed: z.literal(true),
  statementKeys: z.tuple([z.literal("model-named"), z.literal("data-classes-named"), z.literal("raw-file-excluded"), z.literal("revocable")]),
}).strict();
export async function ownCopilotConsent(request: Request, payload: unknown): Promise<Response> {
  const body = bodySchema.safeParse(payload);
  if (!body.success) return ownUploadJson({ error: "invalid_request" }, 422);
  if (!sameOriginCopilot(request) || request.headers.get("x-inherit-csrf") !== body.data.artifactPresentationToken) return ownUploadJson({ error: "forbidden" }, 403);
  try {
    const actor = await currentOwnUploadAccount();
    if (!actor) return ownUploadJson({ error: "unauthorized" }, 401);
    const presentation = readOwnCopilotConsent(body.data.artifactPresentationToken);
    const c = presentation?.snapshot;
    if (!presentation || !c || c.accountId !== actor.accountId || c.sessionId !== actor.sessionId || c.subjectId !== body.data.subjectId
      || c.runtimeAttestationFingerprint !== modelRuntimeRevision() || body.data.purposeKey !== `copilot.${c.providerClass}`
      || !presentation.artifacts.some(a => a.key === `consent.own-copilot-${c.providerClass}` && a.version === body.data.artifactVersion)) return ownUploadJson({ error: "not_found" }, 404);
    const result = await ownCopilotRpc("grant_own_copilot_v1", { p_account_id: actor.accountId, p_session_id: actor.sessionId,
      p_subject_id: c.subjectId, p_snapshot: c, p_artifacts: presentation.artifacts,
      p_nonce_hash: crypto.createHash("sha256").update(presentation.nonce).digest("hex"), p_expires_at: new Date(presentation.expiresAt).toISOString() });
    const authority = ownCopilotAuthoritySchema.safeParse(result.data);
    if (result.error || !authority.success) return ownUploadJson({ error: "permission_changed" }, 409);
    return ownUploadJson({ granted: true }, 201);
  } catch { return ownUploadJson({ error: "unavailable" }, 503); }
}

export type OwnCopilotPermissionView = { kind: "unavailable" } | { kind: "ready"; subjectId: string;
  providerClass: "local" | "cloud"; providerLabel: string; origin: string; model: string; granted: boolean; grantId: string | null;
  purposeKey: "copilot.local" | "copilot.cloud"; token: string; artifacts: z.infer<typeof artifactsSchema> };
export async function prepareOwnCopilotPermission(): Promise<OwnCopilotPermissionView> {
  try {
    const actor = await currentOwnUploadAccount();
    if (!actor) return { kind: "unavailable" };
    const target = await resolveSubjectForAccount(actor.accountId, "me");
    if (!target || target.subjectClass !== "self" || target.subjectAccountId !== actor.accountId) return { kind: "unavailable" };
    const args = { p_account_id: actor.accountId, p_session_id: actor.sessionId, p_subject_id: target.id };
    const response = await ownCopilotRpc("own_copilot_presentation_v1", args);
    const presentation = z.object({ snapshot: ownCopilotConfigurationSchema, artifacts: artifactsSchema }).strict().safeParse(response.data);
    if (response.error || !presentation.success || presentation.data.snapshot.runtimeAttestationFingerprint !== modelRuntimeRevision()) return { kind: "unavailable" };
    const { snapshot, artifacts } = presentation.data;
    if (artifacts.some(a => crypto.createHash("sha256").update(a.body).digest("hex") !== a.sha256)) return { kind: "unavailable" };
    const { data, error } = await createAdminClient().from("llm_settings").select("model,copilot_recipient").eq("user_id", actor.accountId).maybeSingle();
    const settings = z.object({ model: z.string(), copilot_recipient: z.object({ revision: z.number(), providerLabel: z.string(), origin: z.string() }) }).safeParse(data);
    if (error || !settings.success || settings.data.copilot_recipient.revision !== snapshot.settingsRevision) return { kind: "unavailable" };
    const current = await ownCopilotRpc("own_copilot_authority_v1", { ...args, p_expected: null });
    return { kind: "ready", subjectId: target.id, providerClass: snapshot.providerClass,
      providerLabel: settings.data.copilot_recipient.providerLabel, origin: settings.data.copilot_recipient.origin, model: settings.data.model,
      granted: !current.error && ownCopilotAuthoritySchema.safeParse(current.data).success,
      grantId: !current.error ? ownCopilotAuthoritySchema.safeParse(current.data).data?.copilotGrantId ?? null : null, purposeKey: `copilot.${snapshot.providerClass}`,
      token: mintOwnCopilotConsent(presentation.data), artifacts };
  } catch { return { kind: "unavailable" }; }
}

export async function revokeOwnCopilotConsent(request: Request, grantId: string, subjectId: string) {
  if (!sameOriginCopilot(request)) return ownUploadJson({ error: "forbidden" }, 403);
  try {
    const actor = await currentOwnUploadAccount();
    if (!actor) return ownUploadJson({ error: "unauthorized" }, 401);
    const args = { p_account_id: actor.accountId, p_session_id: actor.sessionId, p_subject_id: subjectId };
    const current = await ownCopilotRpc("own_copilot_authority_v1", { ...args, p_expected: null });
    const authority = ownCopilotAuthoritySchema.safeParse(current.data);
    if (current.error || !authority.success || authority.data.copilotGrantId !== grantId) return ownUploadJson({ error: "not_found" }, 404);
    const result = await ownCopilotRpc("revoke_own_copilot_v1", { ...args, p_expected: authority.data });
    return !result.error && result.data === true ? ownUploadJson({ revoked: true }) : ownUploadJson({ error: "not_found" }, 404);
  } catch { return ownUploadJson({ error: "unavailable" }, 503); }
}
