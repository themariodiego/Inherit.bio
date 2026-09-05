import { SENSITIVE_HEADERS, notFound } from "@/lib/embryos/api";
import { originDenied, readJson } from "@/lib/embryos/guards";
import { readPublicFormToken } from "@/lib/embryos/operation-token";
import { invitationTokenHash, newRightsSessionSecret, rightsCookie, rightsSessionHash } from "@/lib/embryos/rights-session";
import { rightsActivateBody } from "@/lib/embryos/routes";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * `POST /api/rights/activate` (register api.rights-activate; contract
 * §6.4). The page that opened a mailed co-parent link posts the token from
 * the URL fragment with the form token the page was served with. The token
 * is hashed here and looked up by the RPC, which consumes it once and opens
 * a rights session whose secret exists only in the host-only cookie set
 * below; the database keeps sha256 of both. Every failure is the same 404
 * with no session and no hint of which check failed. The destination is
 * fixed by the token's purpose, never by the request.
 */
export async function POST(request: Request) {
  const forbidden = originDenied(request);
  if (forbidden) return forbidden;

  const parsed = rightsActivateBody.safeParse(await readJson(request));
  if (!parsed.success) return notFound();
  if (!readPublicFormToken(parsed.data.nonce, "rights-activate")) return notFound();
  const tokenHash = invitationTokenHash(parsed.data.token);
  if (!tokenHash) return notFound();

  const secret = newRightsSessionSecret();
  const { data, error } = await createAdminClient().rpc("activate_rights_session_v1", {
    p_token_hash: tokenHash,
    p_session_hash: rightsSessionHash(secret),
  });
  const session = data?.[0];
  if (error || !session) return notFound();

  const headers = new Headers(SENSITIVE_HEADERS);
  headers.set("Location", "/withdraw/session");
  headers.set("Set-Cookie", rightsCookie(secret, new Date(session.expires_at)));
  return new Response(null, { status: 303, headers });
}
