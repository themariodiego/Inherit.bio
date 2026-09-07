import "server-only";
import { z } from "zod";
import { encryptSecret, hmacSecret } from "@/lib/crypto";
import { ANTHROPIC_MODELS } from "@/lib/llm";
import { currentOwnUploadAccount, ownUploadJson } from "@/lib/uploads/own-upload-context";
import { normalizeModelEndpoint, resolveModelEndpoint } from "./model-endpoint";
import { ownCopilotRpc } from "./own-provider-authority";

const bodySchema = z.object({ provider: z.enum(["anthropic", "openai_compatible"]), base_url: z.url().nullish(),
  model: z.string().trim().min(1).max(200), api_key: z.string().min(4).max(500).nullish(),
}).strict().refine(v => v.provider === "anthropic" ? (ANTHROPIC_MODELS as readonly string[]).includes(v.model) : Boolean(v.base_url));
export function sameOriginCopilot(request: Request) {
  return request.headers.get("origin") === new URL(request.url).origin && request.headers.get("sec-fetch-site") === "same-origin";
}
export async function saveOwnCopilotSettings(request: Request) {
  if (!sameOriginCopilot(request)) return ownUploadJson({ error: "forbidden" }, 403);
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return ownUploadJson({ error: "invalid_request" }, 422);
  try {
    const actor = await currentOwnUploadAccount();
    if (!actor) return ownUploadJson({ error: "unauthorized" }, 401);
    const endpoint = normalizeModelEndpoint(body.data.provider === "anthropic" ? "https://api.anthropic.com/v1" : body.data.base_url!);
    // DNS-only validation; saving never sends a credential or a model request.
    await resolveModelEndpoint(endpoint);
    const key = body.data.api_key;
    const result = await ownCopilotRpc("save_own_copilot_settings_v1", {
      p_account_id: actor.accountId, p_session_id: actor.sessionId,
      p_settings: { provider: body.data.provider, baseUrl: endpoint.baseUrl, model: body.data.model,
        origin: endpoint.origin, providerLabel: body.data.provider === "anthropic" ? "Anthropic" : new URL(endpoint.origin).host,
        providerClass: endpoint.providerClass, runtimeAttestationFingerprint: endpoint.runtimeAttestationFingerprint },
      p_encrypted_key: key ? `\\x${encryptSecret(key).toString("hex")}` : null,
      p_key_fingerprint: hmacSecret(key ?? "", "own-copilot-credential-v1"), p_key_last4: key?.slice(-4) ?? null,
    });
    if (result.error) return ownUploadJson({ error: result.error.message === "key_required" ? "key_required" : "unavailable" }, result.error.message === "key_required" ? 409 : 503);
    const saved = z.object({ saved: z.literal(true), settingsRevision: z.number().int().positive().safe() }).strict().safeParse(result.data);
    return saved.success ? ownUploadJson({ saved: true }) : ownUploadJson({ error: "unavailable" }, 503);
  } catch { return ownUploadJson({ error: "model_endpoint_unavailable" }, 422); }
}
export async function removeOwnCopilotSettings(request: Request) {
  if (!sameOriginCopilot(request)) return ownUploadJson({ error: "forbidden" }, 403);
  try {
    const actor = await currentOwnUploadAccount();
    if (!actor) return ownUploadJson({ error: "unauthorized" }, 401);
    const result = await ownCopilotRpc("remove_own_copilot_settings_v1", { p_account_id: actor.accountId, p_session_id: actor.sessionId });
    return !result.error && result.data === true ? ownUploadJson({ deleted: true }) : ownUploadJson({ error: "unavailable" }, 503);
  } catch { return ownUploadJson({ error: "unavailable" }, 503); }
}
