import "server-only";
import { z } from "zod";
import { decryptSecret, hmacSecret } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentOwnUploadAccount } from "@/lib/uploads/own-upload-context";
import { ownReportSnapshot } from "@/lib/uploads/own-report-token";
import { createPinnedModelFetch, modelRuntimeRevision, normalizeModelEndpoint } from "./model-endpoint";

const revision = z.number().int().positive().safe();
export const ownCopilotConfigurationSchema = z.object({
  accountId: z.uuid(), sessionId: z.uuid(), subjectId: z.uuid(), context: ownReportSnapshot,
  settingsRevision: revision, providerClass: z.enum(["local", "cloud"]),
  runtimeAttestationRevision: z.literal(1), runtimeAttestationFingerprint: z.string().regex(/^[0-9a-f]{64}$/), recipientRevision: revision,
}).strict();
export const ownCopilotAuthoritySchema = ownCopilotConfigurationSchema.extend({
  copilotGrantId: z.uuid(), copilotGrantRevision: revision,
  providerGrantId: z.uuid().nullable(), providerGrantRevision: revision.nullable(),
}).strict().refine(v => v.providerClass === "cloud"
  ? v.providerGrantId !== null && v.providerGrantRevision !== null
  : v.providerGrantId === null && v.providerGrantRevision === null);
export type OwnCopilotAuthority = z.infer<typeof ownCopilotAuthoritySchema>;
export type OwnCopilotActor = { accountId: string; sessionId: string };

export function ownCopilotRpc(name: string, args: Record<string, unknown>) {
  const admin = createAdminClient();
  const rpc = admin.rpc.bind(admin) as unknown as (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
  return rpc(name, args);
}

export async function assertOwnCopilotAuthority(actor: OwnCopilotActor, subjectId: string, expected: OwnCopilotAuthority): Promise<boolean> {
  try {
    if (expected.accountId !== actor.accountId || expected.sessionId !== actor.sessionId || expected.subjectId !== subjectId
      || expected.runtimeAttestationFingerprint !== modelRuntimeRevision()) return false;
    const result = await ownCopilotRpc("own_copilot_authority_v1", {
      p_account_id: actor.accountId, p_session_id: actor.sessionId, p_subject_id: subjectId, p_expected: expected,
    });
    const current = ownCopilotAuthoritySchema.safeParse(result.data);
    return !result.error && current.success && JSON.stringify(current.data) === JSON.stringify(expected);
  } catch { return false; }
}

const settingsSchema = z.object({ provider: z.enum(["anthropic", "openai_compatible"]), base_url: z.string().nullable(), model: z.string(),
  copilot_recipient: z.object({ providerLabel: z.string(), origin: z.string(), credentialFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    revision: revision, runtimeAttestationFingerprint: z.string(), providerClass: z.enum(["local", "cloud"]), baseUrl: z.string(),
    provider: z.string(), model: z.string(),
  }).strict(),
}).strict();

/** Server-only result includes a decrypted credential. RSC callers must only
 * expose their explicit public projection, never serialize this object. */
export async function prepareOwnCopilotProvider(subjectId: string) {
  try {
    const actor = await currentOwnUploadAccount();
    if (!actor) return null;
    const response = await ownCopilotRpc("own_copilot_authority_v1", {
      p_account_id: actor.accountId, p_session_id: actor.sessionId, p_subject_id: subjectId, p_expected: null,
    });
    const parsed = ownCopilotAuthoritySchema.safeParse(response.data);
    if (response.error || !parsed.success) return null;
    const authority = parsed.data;
    const admin = createAdminClient();
    const { data, error } = await admin.from("llm_settings").select("provider,base_url,model,copilot_recipient").eq("user_id", actor.accountId).maybeSingle();
    const checked = settingsSchema.safeParse(data);
    if (error || !checked.success || checked.data.copilot_recipient.revision !== authority.settingsRevision) return null;
    const stored = checked.data;
    const endpoint = normalizeModelEndpoint(stored.copilot_recipient.baseUrl);
    if (endpoint.runtimeAttestationFingerprint !== authority.runtimeAttestationFingerprint || endpoint.providerClass !== authority.providerClass
      || endpoint.origin !== stored.copilot_recipient.origin) return null;
    const { data: key, error: keyError } = await admin.from("llm_keys").select("encrypted_key").eq("user_id", actor.accountId).maybeSingle();
    if (keyError) return null;
    const apiKey = key?.encrypted_key ? decryptSecret(Buffer.from(String(key.encrypted_key).replace(/^\\x/, ""), "hex")) : undefined;
    if (hmacSecret(apiKey ?? "", "own-copilot-credential-v1") !== stored.copilot_recipient.credentialFingerprint) return null;
    if (stored.provider === "anthropic" && !apiKey) return null;
    if (!(await assertOwnCopilotAuthority(actor, subjectId, authority))) return null;
    return { actor, authority, settings: { provider: stored.provider, base_url: endpoint.baseUrl, model: stored.model,
      providerLabel: stored.copilot_recipient.providerLabel, origin: endpoint.origin }, apiKey,
      fetch: createPinnedModelFetch(endpoint, () => assertOwnCopilotAuthority(actor, subjectId, authority)),
      // The caller owns its exact source/purpose projection. Recheck it in the
      // same pinned connection boundary as provider permission, after DNS.
      createFetch: (authorizeData: () => Promise<boolean>) => createPinnedModelFetch(endpoint, async () =>
        await assertOwnCopilotAuthority(actor, subjectId, authority) && await authorizeData()) };
  } catch { return null; }
}

/** Safe UI diagnosis; no credential or recipient fingerprint is returned. */
export async function ownCopilotProviderStatus(subjectId: string): Promise<"ready" | "scope_unavailable" | "provider_unavailable" | "transport_unavailable" | "consent_required"> {
  try {
    const actor = await currentOwnUploadAccount();
    if (!actor) return "scope_unavailable";
    const admin = createAdminClient();
    const { data: subject } = await admin.from("subjects").select("subject_account_id,subject_class,lifecycle").eq("id", subjectId).maybeSingle();
    if (!subject || subject.subject_account_id !== actor.accountId || subject.subject_class !== "self" || subject.lifecycle !== "active") return "scope_unavailable";
    const { data, error } = await admin.from("llm_settings").select("provider,base_url,model,copilot_recipient").eq("user_id", actor.accountId).maybeSingle();
    if (error || !data) return "provider_unavailable";
    const settings = settingsSchema.safeParse(data);
    if (!settings.success) return "provider_unavailable";
    const endpoint = normalizeModelEndpoint(settings.data.copilot_recipient.baseUrl);
    if (endpoint.runtimeAttestationFingerprint !== settings.data.copilot_recipient.runtimeAttestationFingerprint
      || endpoint.providerClass !== settings.data.copilot_recipient.providerClass) return "transport_unavailable";
    const response = await ownCopilotRpc("own_copilot_authority_v1", { p_account_id: actor.accountId, p_session_id: actor.sessionId,
      p_subject_id: subjectId, p_expected: null });
    return !response.error && ownCopilotAuthoritySchema.safeParse(response.data).success ? "ready" : "consent_required";
  } catch { return "transport_unavailable"; }
}
