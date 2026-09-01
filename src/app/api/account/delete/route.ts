import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  deletionErrorResponse,
  getSensitiveAccountContext,
  hashOperationNonce,
  isSameOrigin,
  operationIdempotencyKey,
} from "@/lib/account-deletion";
import { encryptSecret, hmacSecret } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";

const requestBody = z
  .object({
    confirmation: z.literal("account.delete.confirmation"),
    nonce: z.string().min(32).max(256),
  })
  .strict();

async function activeRequest(accountId: string) {
  return createAdminClient()
    .from("account_deletion_requests")
    .select("id,state,notice_ends_at")
    .eq("account_id", accountId)
    .in("state", ["notice_period", "delete_started"])
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();
}

export async function GET(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const context = await getSensitiveAccountContext();
  if (!context) return new Response("Unauthorized", { status: 401 });

  const { data: active, error: activeError } = await activeRequest(
    context.user.id,
  );
  if (activeError) {
    return NextResponse.json(
      { error: "account_deletion_unavailable" },
      { status: 503 },
    );
  }

  const nonce = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const operation = active ? "account_delete_cancel" : "account_delete";
  const { error } = await createAdminClient().rpc(
    "issue_account_operation_nonce_v1",
    {
      p_account_id: context.user.id,
      p_session_id: context.sessionId,
      p_operation: operation,
      p_nonce_hash: hashOperationNonce(nonce),
      p_expires_at: expiresAt,
    },
  );
  if (error) return deletionErrorResponse(error.message, 403);

  return NextResponse.json(
    active
      ? {
          status: "notice_period" as const,
          noticeEndsAt: active.notice_ends_at,
          operationNonce: nonce,
        }
      : { status: "active" as const, operationNonce: nonce },
    { headers: { "Cache-Control": "no-store" } },
  );
}

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

  const normalizedEmail = context.user.email.trim().toLowerCase();
  const { data, error } = await createAdminClient().rpc(
    "request_account_deletion_v1",
    {
      p_account_id: context.user.id,
      p_session_id: context.sessionId,
      p_nonce_hash: hashOperationNonce(parsed.data.nonce),
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
