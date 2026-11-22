import { z } from "zod";
import { getSensitiveAccountContext } from "@/lib/account-deletion";
import { createAdminClient } from "@/lib/supabase/admin";
import { prepareFileCleanup, type FileCleanupSpend } from "@/lib/genome/prepared-source/cleanup-integration";
import {
  PERSON_OPERATION_NONCE_HEADER,
  isOperationNonceRefusal,
  mintPersonOperationNonce,
  personOperationNonceArgs,
  personOperationNonceFrom,
  type PersonOperationContext,
} from "@/lib/person-operation-nonce";
import { isStrictSameOrigin } from "@/lib/security/same-origin";
import { withAccountCsrf } from "@/lib/security/session-csrf";

export const maxDuration = 60;

const target = z.object({ token: z.string().uuid(), bucket: z.literal("genomes"), name: z.string().min(1) }).strict();
const headers = { "Cache-Control": "private, no-store" };
const failure = (error: string, status: number) => Response.json({ error }, { status, headers });
/** PostgREST's answer for a function the schema does not have, and Postgres's. */
const FUNCTION_ABSENT: ReadonlySet<string> = new Set(["PGRST202", "42883"]);
const codeOf = (error: unknown) => error && typeof error === "object" && "code" in error && typeof error.code === "string"
  ? error.code : "";

/**
 * `DELETE /api/files/[id]` (register api.file-delete).
 *
 * Order of refusals, as the register puts them: a request without the
 * browser's `Sec-Fetch-Site: same-origin`, or from another `Origin`, is
 * refused (`authenticated-mutation-v1`'s 403 `request_forbidden`; owner
 * decisions of 19 and 22 November 2026) before the account context is read or
 * the session's token is spent, by the proxy and again by the CSRF wrapper
 * (`policy.sameOriginRequired`, `@/lib/security/same-origin`); then the
 * session token; then here a route id that is not a UUID (404), no account
 * (401), and a missing, malformed, expired or foreign one-time value (403),
 * before anything is read from or written to the database.
 *
 * The one-time value (G8.5, 20 November 2026, "where the register is
 * stricter, engineering codes to it"; `authenticated-mutation-v1
 * .destructiveNonce`): the Files page renders it for this account, session,
 * operation and file, and the request carries it in
 * `X-Inherit-Operation-Nonce`. `prepare_own_prepared_file_cleanup_with_nonce_v1`
 * records its hash in the same transaction as the deletion's first write and
 * before it, so a replay is refused (403) and writes nothing, and a refused
 * deletion spends nothing. A pending answer carries the next value for the
 * same file, which the client's repeat spends.
 *
 * Until 20261120110000 is applied (code may be deployed first) that door is
 * absent, and the first call goes to the unchanged door it wraps: the value
 * is still verified for this account, session, operation and file and its
 * expiry, but not yet spent. Only the door's absence falls back.
 */
export const DELETE = withAccountCsrf("api.file-delete", handleDelete);
async function handleDelete(request: Request, context: { params: Promise<{ id: string }> }) {
  // `authenticated-mutation-v1`'s refusal, the same body the CSRF wrapper
  // gives (owner decision of 19 November 2026, "a cross-site file delete is
  // refused with the register's code"), under the strict rule of 22 November.
  if (!isStrictSameOrigin(request)) return failure("request_forbidden", 403);
  const { id } = await context.params;
  // `resource-not-found-v1` and `authenticated-api-v1.unauthenticated`.
  if (!z.string().uuid().safeParse(id).success) return failure("not_found", 404);
  const account = await getSensitiveAccountContext();
  if (!account) return failure("unauthenticated", 401);
  const operation: PersonOperationContext = { accountId: account.user.id, sessionId: account.sessionId,
    operation: "file_delete", targetId: id };
  const nonce = personOperationNonceFrom(request, operation);
  if (!nonce) return failure("request_forbidden", 403);
  const admin = createAdminClient();
  const args = { p_account_id: account.user.id, p_session_id: account.sessionId, p_file_id: id };
  const spend: FileCleanupSpend = { procedure: "prepare_own_prepared_file_cleanup_with_nonce_v1", args: personOperationNonceArgs(nonce) };
  try {
    let prepared = await prepareFileCleanup(admin, args, request.signal, undefined, spend);
    if (prepared.error && FUNCTION_ABSENT.has(codeOf(prepared.error))) prepared = await prepareFileCleanup(admin, args, request.signal);
    if (prepared.error) {
      if (isOperationNonceRefusal(prepared.error as { code?: string; message?: string })) return failure("request_forbidden", 403);
      const message = typeof prepared.error === "object" && "message" in prepared.error && typeof prepared.error.message === "string"
        ? prepared.error.message : "file_delete_failed";
      if (message.includes("file_delete_not_found")) return failure("not_found", 404);
      // The database refuses an auth session that is no longer live.
      if (message.includes("file_delete_unauthorized")) return failure("unauthenticated", 401);
      if (message.includes("file_delete_processing")) return failure("file_delete_processing", 409);
      if (message.includes("file_delete_shared_graph") || message.includes("file_delete_subject_unavailable")) {
        return failure("file_delete_subject_unavailable", 409);
      }
      return failure("file_delete_failed", 503);
    }
    if (!prepared.complete) {
      // The repeat the client makes spends a value too: this answer issues it.
      const pending = failure("file_delete_pending", 202);
      pending.headers.set(PERSON_OPERATION_NONCE_HEADER, mintPersonOperationNonce(operation));
      return pending;
    }
    const manifest = target.safeParse(prepared.original);
    if (!manifest.success) return failure("file_delete_failed", 503);
    const { data: removed, error } = await admin.storage.from(manifest.data.bucket).remove([manifest.data.name]);
    // A successful empty list is the Storage API's idempotent ACK when a
    // previous attempt removed the object but database completion failed.
    if (error || !Array.isArray(removed)) return failure("file_delete_failed", 503);
    const finished = await admin.rpc("finish_genome_file_deletion_v1", { ...args, p_token: manifest.data.token });
    if (finished.error) return failure("file_delete_failed", 503);
    return new Response(null, { status: 204, headers });
  } catch {
    return failure("file_delete_failed", 503);
  }
}
