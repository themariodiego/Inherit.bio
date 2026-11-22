import { NextResponse } from "next/server";
import { z } from "zod";
import { getSensitiveAccountContext, isSameOrigin } from "@/lib/account-deletion";
import { embryoGateCookie } from "@/lib/embryos/tier2";
import { withAccountCsrf } from "@/lib/security/session-csrf";

/**
 * `POST /api/embryos/acknowledge` (register api.embryo-acknowledge).
 *
 * The Embryo domain's Tier-2 acknowledgement (design §1.5), built as its
 * Family twin `api.family-acknowledge` builds the `tier2-result-gate` case:
 * the same Origin check, the same closed body, the same signed-in account and
 * auth session, and the same cookie semantics. It sets one httpOnly, Secure,
 * SameSite=Lax session cookie whose value is a keyed digest of the account id
 * and the current auth session id under the Embryo domain's own digest
 * context, with no Max-Age (`embryoGateCookie`, shared with the reader). It
 * writes nothing to the database and nothing to device storage; a new auth
 * session cannot verify it, and it never opens the Family gate.
 *
 * It replaces the server action `acknowledgeEmbryoGate` (owner decision of
 * 23 October 2026, G8.5): an action is a POST entry point the register cannot
 * describe and that answered on every page that rendered it, and its origin
 * check let a request with no Origin through. Like the Family twin's gate
 * case it takes no operation nonce: it records a reading acknowledgement,
 * destroys nothing and grants no authority.
 *
 * The response carries no account id, jurisdiction or authority: only which
 * acknowledgement was recorded and when (embryo-acknowledged-v1).
 *
 * Like its twin, it carries the page's one-time X-Inherit-CSRF token
 * (`withAccountCsrf`), spent before the handler runs.
 *
 * Its refusals are the register's (G8.5, 24 October 2026): another origin is
 * `authenticated-mutation-v1`'s 403 `request_forbidden`, a body other than
 * the closed one is `invalid-request-v1` (422), and a request with no live
 * account and session is `authenticated-api-v1`'s JSON 401 `unauthenticated`.
 * They were a 400 `invalid_request` and a plain-text 401.
 */

const body = z
  .object({
    acknowledgement: z.literal("embryo-result-gate"),
    affirmed: z.literal(true),
  })
  .strict();

const NO_STORE = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
} as const;

export const POST = withAccountCsrf("api.embryo-acknowledge", handlePost);
async function handlePost(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "request_forbidden" }, { status: 403, headers: NO_STORE });
  }
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", issues: ["body"] }, { status: 422, headers: NO_STORE });
  }
  const context = await getSensitiveAccountContext();
  if (!context) return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers: NO_STORE });

  const response = NextResponse.json(
    { acknowledgement: "embryo-result-gate", acknowledgedAt: new Date().toISOString() },
    { headers: NO_STORE },
  );
  response.cookies.set(embryoGateCookie(context.user.id, context.sessionId));
  return response;
}
