import crypto from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export interface SensitiveAccountContext {
  user: User;
  sessionId: string;
}

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin !== null) return origin === new URL(request.url).origin;
  return request.headers.get("sec-fetch-site") === "same-origin";
}

function sessionIdFromToken(accessToken: string): string | null {
  try {
    const payload = JSON.parse(
      Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString(
        "utf8",
      ),
    ) as { session_id?: unknown };
    return typeof payload.session_id === "string" ? payload.session_id : null;
  } catch {
    return null;
  }
}

export async function getSensitiveAccountContext(): Promise<
  SensitiveAccountContext | null
> {
  const supabase = await createClient();
  const [userResult, sessionResult] = await Promise.all([
    supabase.auth.getUser(),
    supabase.auth.getSession(),
  ]);
  const user = userResult.data.user;
  const session = sessionResult.data.session;
  if (!user || !session) return null;
  const sessionId = sessionIdFromToken(session.access_token);
  return sessionId ? { user, sessionId } : null;
}

export function hashOperationNonce(nonce: string): string {
  return crypto.createHash("sha256").update(nonce, "utf8").digest("hex");
}

export function operationIdempotencyKey(
  operation: string,
  accountId: string,
  semanticId: string,
): string {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify(["account-deletion-v1", operation, accountId, semanticId]),
    )
    .digest("hex");
}

export function deletionErrorResponse(message: string, status = 400) {
  const known = [
    "recent_reauthentication_required",
    "mfa_required",
    "invalid_operation_nonce",
    "deletion_request_exists",
    "deletion_request_not_cancellable",
  ].find((code) => message.includes(code));
  return Response.json(
    { error: known ?? "account_deletion_failed" },
    { status },
  );
}
