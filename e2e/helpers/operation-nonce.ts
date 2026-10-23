import type { APIRequestContext, BrowserContext } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { ANON_KEY, SUPABASE_URL } from "../helpers";

/**
 * The one-time operation nonces of the person-caused writers (G5.6, owner
 * decision of 23 October 2026; 20261023120000_legal_audit_attribution_completeness.sql).
 * A page renders the nonce and only the POST consumes it, so a test that
 * calls one of these routes directly first takes the nonce the page itself
 * rendered for the signed-in session.
 */

const NONCE = /^\d{13}\.[A-Za-z0-9_-]{43}\.[0-9a-f]{64}$/u;

/** The nonce `/settings` rendered on one of its two writers' sections, for this request context's session. */
export async function settingsOperationNonce(request: APIRequestContext, slot: "jurisdiction" | "chromosomal-sex"): Promise<string> {
  const response = await request.get("/settings");
  if (!response.ok()) throw new Error(`/settings answered ${response.status()}`);
  const match = new RegExp(`data-slot="${slot}" data-operation-nonce="([^"]+)"`, "u").exec(await response.text());
  if (!match || !NONCE.test(match[1])) throw new Error(`/settings rendered no ${slot} nonce`);
  return match[1];
}

/**
 * A nonce minted the way a page mints it, for a writer whose control no page
 * renders on its own, under the local server's own fixture key and the
 * context's actual auth session. The key is passed to the mint explicitly,
 * never set in this process's environment. Never a hosted key.
 */
export async function mintedOperationNonce(context: BrowserContext, accountId: string,
  operation: "consent_revoke" | "subject_download_open", targetId: string): Promise<string> {
  // Loaded here, not at the top: the configuration refuses to load outside a
  // browser run, and the density fixtures import this module for the
  // settings nonce alone.
  const { default: config } = await import("../../playwright.config");
  const servers = Array.isArray(config.webServer) ? config.webServer : [config.webServer];
  const fixtureKey = servers[0]?.env?.BYOK_ENCRYPTION_KEY;
  if (!fixtureKey) throw new Error("Local browser fixture key missing");
  const cookies = await context.cookies();
  const auth = createServerClient(SUPABASE_URL, ANON_KEY, { cookies: { getAll: () => cookies,
    setAll: () => { throw new Error("The nonce must be bound to the existing session"); } } });
  const current = await auth.auth.getClaims();
  const sessionId = current.data?.claims.session_id;
  if (current.error || current.data?.claims.sub !== accountId || typeof sessionId !== "string") {
    throw new Error("The context's own session is unavailable");
  }
  const { mintPersonOperationNonce } = await import("../../src/lib/person-operation-nonce-core");
  return mintPersonOperationNonce({ accountId, sessionId, operation, targetId }, Date.now(), fixtureKey);
}
