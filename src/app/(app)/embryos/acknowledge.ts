"use server";

import { cookies } from "next/headers";
import { currentAuthSessionId, embryoGateCookie } from "@/lib/embryos/tier2";
import { createClient } from "@/lib/supabase/server";

/**
 * Records the Embryo domain's Tier-2 acknowledgement (design §1.5) as one
 * httpOnly, Secure, SameSite=Lax session cookie whose value is a keyed
 * digest of the account id and the current auth session id, with no
 * Max-Age. It writes nothing to the database and nothing to device storage;
 * a new session cannot verify it. A server function rather than a route:
 * it is reachable only from this domain's own pages and needs no register
 * row, and Next.js checks the request origin before it runs.
 */
export async function acknowledgeEmbryoGate(): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false };
  const sessionId = await currentAuthSessionId();
  if (!sessionId) return { ok: false };
  const store = await cookies();
  store.set(embryoGateCookie(user.id, sessionId));
  return { ok: true };
}
