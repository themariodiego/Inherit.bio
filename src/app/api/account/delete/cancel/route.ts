import { NextResponse } from "next/server";
import { z } from "zod";
import {
  deletionErrorResponse,
  getSensitiveAccountContext,
  isSameOrigin,
  operationIdempotencyKey,
} from "@/lib/account-deletion";
import { ACCOUNT_OPERATION_NONCE_MAX_LENGTH, verifyAccountOperationNonce } from "@/lib/account-operation-nonce";
import { createAdminClient } from "@/lib/supabase/admin";

const requestBody = z
  .object({
    confirmation: z.literal("account.delete.cancel-confirmation"),
    nonce: z.string().min(32).max(ACCOUNT_OPERATION_NONCE_MAX_LENGTH),
  })
  .strict();

/** POST only, under the same rendered-nonce rule as POST /api/account/delete. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const parsed = requestBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const context = await getSensitiveAccountContext();
  if (!context) return new Response("Unauthorized", { status: 401 });

  const nonce = verifyAccountOperationNonce(parsed.data.nonce, {
    accountId: context.user.id, sessionId: context.sessionId, operation: "account_delete_cancel",
  });
  if (!nonce) return deletionErrorResponse("invalid_operation_nonce", 404);

  const { data, error } = await createAdminClient().rpc(
    "cancel_account_deletion_v2",
    {
      p_account_id: context.user.id,
      p_session_id: context.sessionId,
      p_nonce_hash: nonce.nonceHash,
      p_nonce_expires_at: new Date(nonce.expiresAt).toISOString(),
      p_notice_idempotency_key: operationIdempotencyKey(
        "cancelled",
        context.user.id,
        parsed.data.nonce,
      ),
    },
  );
  if (error || !data?.[0]) {
    return deletionErrorResponse(
      error?.message ?? "account_deletion_failed",
      404,
    );
  }

  return NextResponse.json(
    { status: "active", cancelledAt: data[0].cancelled_at },
    { headers: { "Cache-Control": "no-store" } },
  );
}
