import { NextResponse } from "next/server";
import { z } from "zod";
import {
  deletionErrorResponse,
  getSensitiveAccountContext,
  hashOperationNonce,
  isSameOrigin,
  operationIdempotencyKey,
} from "@/lib/account-deletion";
import { createAdminClient } from "@/lib/supabase/admin";

const requestBody = z
  .object({
    confirmation: z.literal("account.delete.cancel-confirmation"),
    nonce: z.string().min(32).max(256),
  })
  .strict();

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

  const { data, error } = await createAdminClient().rpc(
    "cancel_account_deletion_v1",
    {
      p_account_id: context.user.id,
      p_session_id: context.sessionId,
      p_nonce_hash: hashOperationNonce(parsed.data.nonce),
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
