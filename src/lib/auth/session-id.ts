import "server-only";

type ClaimsClient = {
  auth: { getClaims(): Promise<{ data: { claims?: Record<string, unknown> } | null }> };
};

/**
 * The auth session id of the verified JWT, when its subject is `accountId`.
 * A writer that records who acted (20260930220000) checks this session is the
 * account's own and live, in the same transaction, so a route passes it only
 * from cryptographically validated claims, never from a cookie or the body.
 */
export async function verifiedAuthSessionId(client: ClaimsClient, accountId: string): Promise<string | null> {
  const { data } = await client.auth.getClaims();
  const claims = data?.claims;
  if (!claims || claims.sub !== accountId || typeof claims.session_id !== "string") return null;
  return claims.session_id;
}
