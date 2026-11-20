import crypto from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { accountCompletionBody, isAdultOnUtcDate } from "@/lib/uploads/account-completion";
import { readOwnAccountCompletionPresentation } from "@/lib/uploads/own-consent-token";
import { currentOwnUploadAccount, ownSnapshotArgs, ownUploadJson } from "@/lib/uploads/own-upload-context";
import { withAccountCsrf } from "@/lib/security/session-csrf";

/**
 * The shell's one-time X-Inherit-CSRF token for the account session is
 * verified and spent before this runs (G8.5). The completion presentation
 * token travels only in the body's presentationToken, as the register's
 * closed body names it, and is checked as before; until 19 November 2026 it
 * was also sent in X-Inherit-CSRF.
 */
export const POST = withAccountCsrf("api.account-completion", handlePost);
async function handlePost(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin
    || request.headers.get("sec-fetch-site") !== "same-origin") return ownUploadJson({ error: "forbidden" }, 403);
  const body = accountCompletionBody.safeParse(await request.json().catch(() => null));
  if (!body.success) return ownUploadJson({ error: "invalid_request" }, 422);
  if (!isAdultOnUtcDate(body.data.dateOfBirth)) {
    return ownUploadJson({ error: "adult_account_required" }, 422);
  }
  const context = await currentOwnUploadAccount();
  if (!context) return ownUploadJson({ error: "unauthorized" }, 401);
  const token = readOwnAccountCompletionPresentation(body.data.presentationToken);
  if (!token || token.accountId !== context.accountId || token.sessionId !== context.sessionId) {
    return ownUploadJson({ error: "not_found" }, 404);
  }
  // Brief X1.5: v2 records the nonce hash once, in the completion transaction.
  const { data, error } = await createAdminClient().rpc("complete_own_upload_account_v2", {
    ...ownSnapshotArgs(token), p_date_of_birth: body.data.dateOfBirth,
    p_nonce_hash: crypto.createHash("sha256").update(token.nonce).digest("hex"),
    p_nonce_expires_at: new Date(token.expiresAt).toISOString(),
  });
  if (error) {
    if (error.code === "42501" || error.code === "23505") return ownUploadJson({ error: "not_found" }, 404);
    if (error.code === "22023") return ownUploadJson({ error: "adult_account_required" }, 422);
    if (error.code === "55000") return ownUploadJson({ error: "account_already_completed" }, 409);
    return ownUploadJson({ error: "unavailable" }, 503);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)
    || Object.keys(data).length !== 1 || data.status !== "completed") return ownUploadJson({ error: "unavailable" }, 503);
  return ownUploadJson({ status: "completed" });
}
