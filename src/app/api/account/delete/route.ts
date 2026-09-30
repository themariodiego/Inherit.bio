import { NextResponse } from "next/server";
import { z } from "zod";
import {
  deletionErrorResponse,
  getSensitiveAccountContext,
  isSameOrigin,
  operationIdempotencyKey,
} from "@/lib/account-deletion";
import { ACCOUNT_OPERATION_NONCE_MAX_LENGTH, verifyAccountOperationNonce } from "@/lib/account-operation-nonce";
import { encryptSecret, hmacSecret } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";

const requestBody = z
  .object({
    confirmation: z.literal("account.delete.confirmation"),
    nonce: z.string().min(32).max(ACCOUNT_OPERATION_NONCE_MAX_LENGTH),
  })
  .strict();

/**
 * POST only (brief X1.5). `/settings/data` renders the nonce; this route
 * verifies it against the live account and session, and the database records
 * its hash once in the same transaction that creates the deletion hold. There
 * is no GET: nothing on this path issues, stores or rotates a nonce.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const parsed = requestBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const context = await getSensitiveAccountContext();
  if (!context?.user.email) return new Response("Unauthorized", { status: 401 });

  const nonce = verifyAccountOperationNonce(parsed.data.nonce, {
    accountId: context.user.id, sessionId: context.sessionId, operation: "account_delete",
  });
  if (!nonce) return deletionErrorResponse("invalid_operation_nonce", 409);

  const normalizedEmail = context.user.email.trim().toLowerCase();
  const { data, error } = await createAdminClient().rpc(
    "request_account_deletion_v2",
    {
      p_account_id: context.user.id,
      p_session_id: context.sessionId,
      p_nonce_hash: nonce.nonceHash,
      p_nonce_expires_at: new Date(nonce.expiresAt).toISOString(),
      p_contact_ciphertext: `\\x${encryptSecret(normalizedEmail).toString("hex")}`,
      p_contact_hmac: hmacSecret(normalizedEmail, "contact-email-v1"),
      p_notice_idempotency_key: operationIdempotencyKey(
        "requested",
        context.user.id,
        parsed.data.nonce,
      ),
    },
  );
  if (error || !data?.[0]) {
    return deletionErrorResponse(
      error?.message ?? "account_deletion_failed",
      409,
    );
  }

  return NextResponse.json(
    { status: "notice_period", noticeEndsAt: data[0].notice_ends_at },
    { status: 202, headers: { "Cache-Control": "no-store" } },
  );
}
