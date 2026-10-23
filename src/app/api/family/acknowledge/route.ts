import { NextResponse } from "next/server";
import { z } from "zod";
import { getSensitiveAccountContext, isSameOrigin } from "@/lib/account-deletion";
import {
  TIER2_COOKIE_NAME,
  tier2CookieAttributes,
  tier2Digest,
} from "@/lib/family/tier2";
import { isOperationNonceRefusal, personOperationNonceArgs, personOperationNonceFrom } from "@/lib/person-operation-nonce";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * `POST /api/family/acknowledge` (register api.family-acknowledge).
 *
 * Two closed bodies, one operation each:
 *   - `tier2-result-gate` sets one httpOnly, Secure, SameSite=Lax session
 *     cookie whose value is a keyed digest of the account id and the current
 *     auth session id, with no Max-Age. It writes nothing to the database,
 *     and `/auth/sign-out` clears it. `localStorage` is forbidden, so the
 *     acknowledgement is never readable by script and never survives the
 *     session it was given in;
 *   - `portrait` stamps `subjects.portrait_acknowledged_at` once through
 *     `acknowledge_portrait_v1`, on a subject bound to the acting account;
 *     any other subject is refused with no existence signal. It carries, in
 *     the `X-Inherit-Operation-Nonce` header, the one-time nonce the Portrait
 *     page rendered for this account, session and subject (G5.6, 23 Oct
 *     2026); `acknowledge_portrait_with_nonce_v1` records its hash first, in
 *     the same transaction, so the audit event names the person and a replay
 *     writes nothing.
 *
 * The response never carries a jurisdiction, an authority or an account id:
 * only which acknowledgement was recorded and when (family-acknowledged-v1).
 */

const body = z.discriminatedUnion("acknowledgement", [
  z
    .object({
      acknowledgement: z.literal("tier2-result-gate"),
      affirmed: z.literal(true),
    })
    .strict(),
  z
    .object({
      acknowledgement: z.literal("portrait"),
      subjectId: z.uuid(),
      affirmed: z.literal(true),
    })
    .strict(),
]);

const NO_STORE = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
} as const;

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const context = await getSensitiveAccountContext();
  if (!context) return new Response("Unauthorized", { status: 401 });

  if (parsed.data.acknowledgement === "portrait") {
    const nonce = personOperationNonceFrom(request, { accountId: context.user.id, sessionId: context.sessionId,
      operation: "portrait_acknowledge", targetId: parsed.data.subjectId });
    if (!nonce) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    const { data, error } = await createAdminClient().rpc("acknowledge_portrait_with_nonce_v1", {
      p_account_id: context.user.id,
      p_session_id: context.sessionId,
      p_subject_id: parsed.data.subjectId,
      ...personOperationNonceArgs(nonce),
    });
    if (isOperationNonceRefusal(error)) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    if (error || !data) return new Response("Not found", { status: 404 });
    return NextResponse.json(
      { acknowledgement: "portrait", acknowledgedAt: new Date(data).toISOString() },
      { headers: NO_STORE },
    );
  }

  const response = NextResponse.json(
    {
      acknowledgement: "tier2-result-gate",
      acknowledgedAt: new Date().toISOString(),
    },
    { headers: NO_STORE },
  );
  response.cookies.set({
    name: TIER2_COOKIE_NAME,
    value: tier2Digest(context.user.id, context.sessionId),
    ...tier2CookieAttributes(),
  });
  return response;
}
