import "server-only";
import { z } from "zod";
import { encryptSecret, hmacSecret } from "@/lib/crypto";
import { ANTHROPIC_MODELS, providerKeyFor } from "@/lib/llm";
import { isOperationNonceRefusal, personOperationNonceArgs, personOperationNonceFrom } from "@/lib/person-operation-nonce";
import { currentOwnUploadAccount, ownUploadJson } from "@/lib/uploads/own-upload-context";
import { normalizeModelEndpoint, resolveModelEndpoint } from "./model-endpoint";
import { ownCopilotRpc } from "./own-provider-authority";

/**
 * `api.llm-settings` (owner decision of 23 October 2026, G8.5: the code
 * moves to the register). The POST takes the register's three closed bodies,
 * discriminated by `mode`, and answers `llm-settings-v1`; the DELETE takes no
 * body, reads the one-time nonce /settings/copilot rendered for this account
 * and session in `X-Inherit-Operation-Nonce`, and the database records its
 * hash in the same transaction that deletes the setting and its key and
 * revokes the permission (remove_own_copilot_settings_with_nonce_v1).
 *
 * What is stored is unchanged: `hosted` is the stored provider `anthropic`,
 * the other two are `openai_compatible`, and the classification is the
 * server's own (`normalizeModelEndpoint`), which the declared mode must
 * match. `apiKey` may be left out to keep the stored key for the same
 * destination, or for a key-free endpoint, as before; the register's hosted
 * and remote bodies require it, which is recorded in
 * docs/register-contract-divergence.json as the owner's question.
 */
const secret = z.string().min(4).max(500);
const model = z.string().trim().min(1).max(200);
const bodySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("hosted"), provider: z.literal("anthropic"),
    model: z.enum(ANTHROPIC_MODELS), apiKey: secret.optional() }).strict(),
  z.object({ mode: z.literal("remote-openai-compatible"), provider: z.literal("openai-compatible"),
    model, baseUrl: z.url().refine(value => value.startsWith("https://")), apiKey: secret.optional() }).strict(),
  z.object({ mode: z.literal("same-host-local"), provider: z.literal("openai-compatible-local"),
    model, baseUrl: z.url(), apiKey: secret.optional() }).strict(),
]);
const HOSTED_BASE_URL = "https://api.anthropic.com/v1";

export function sameOriginCopilot(request: Request) {
  return request.headers.get("origin") === new URL(request.url).origin && request.headers.get("sec-fetch-site") === "same-origin";
}
export async function saveOwnCopilotSettings(request: Request) {
  if (!sameOriginCopilot(request)) return ownUploadJson({ error: "forbidden" }, 403);
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return ownUploadJson({ error: "invalid_request" }, 422);
  const stored = body.data.mode === "hosted" ? "anthropic" as const : "openai_compatible" as const;
  try {
    const actor = await currentOwnUploadAccount();
    if (!actor) return ownUploadJson({ error: "unauthorized" }, 401);
    const endpoint = normalizeModelEndpoint(body.data.mode === "hosted" ? HOSTED_BASE_URL : body.data.baseUrl);
    // The mode is the client's claim; the classification is the server's.
    if ((body.data.mode === "same-host-local") !== (endpoint.providerClass === "local")) {
      return ownUploadJson({ error: "invalid_request" }, 422);
    }
    // DNS-only validation; saving never sends a credential or a model request.
    await resolveModelEndpoint(endpoint);
    const key = body.data.apiKey;
    const result = await ownCopilotRpc("save_own_copilot_settings_v1", {
      p_account_id: actor.accountId, p_session_id: actor.sessionId,
      p_settings: { provider: stored, baseUrl: endpoint.baseUrl, model: body.data.model,
        origin: endpoint.origin, providerLabel: stored === "anthropic" ? "Anthropic" : new URL(endpoint.origin).host,
        providerClass: endpoint.providerClass, runtimeAttestationFingerprint: endpoint.runtimeAttestationFingerprint },
      p_encrypted_key: key ? `\\x${encryptSecret(key).toString("hex")}` : null,
      p_key_fingerprint: hmacSecret(key ?? "", "own-copilot-credential-v1"), p_key_last4: key?.slice(-4) ?? null,
    });
    if (result.error) return ownUploadJson({ error: result.error.message === "key_required" ? "key_required" : "unavailable" }, result.error.message === "key_required" ? 409 : 503);
    const saved = z.object({ saved: z.literal(true), settingsRevision: z.number().int().positive().safe() }).strict().safeParse(result.data);
    if (!saved.success) return ownUploadJson({ error: "unavailable" }, 503);
    // llm-settings-v1.post: server-normalized values only, never the key.
    return ownUploadJson({ status: "saved", provider: providerKeyFor(stored, stored === "anthropic" ? null : endpoint.baseUrl),
      endpointOrigin: endpoint.origin, classification: endpoint.providerClass });
  } catch { return ownUploadJson({ error: "model_endpoint_unavailable" }, 422); }
}
export async function removeOwnCopilotSettings(request: Request) {
  if (!sameOriginCopilot(request)) return ownUploadJson({ error: "forbidden" }, 403);
  // methodRequestContracts.DELETE.body is forbidden.
  if ((await request.text().catch(() => "x")) !== "") return ownUploadJson({ error: "invalid_request" }, 422);
  try {
    const actor = await currentOwnUploadAccount();
    if (!actor) return ownUploadJson({ error: "unauthorized" }, 401);
    const nonce = personOperationNonceFrom(request, { accountId: actor.accountId, sessionId: actor.sessionId,
      operation: "provider_setting_delete", targetId: actor.accountId });
    if (!nonce) return ownUploadJson({ error: "invalid_request" }, 422);
    const result = await ownCopilotRpc("remove_own_copilot_settings_with_nonce_v1", {
      p_account_id: actor.accountId, p_session_id: actor.sessionId, ...personOperationNonceArgs(nonce),
    });
    if (isOperationNonceRefusal(result.error)) return ownUploadJson({ error: "invalid_request" }, 422);
    // llm-settings-v1.delete.
    return !result.error && result.data === true ? ownUploadJson({ status: "deleted" }) : ownUploadJson({ error: "unavailable" }, 503);
  } catch { return ownUploadJson({ error: "unavailable" }, 503); }
}
