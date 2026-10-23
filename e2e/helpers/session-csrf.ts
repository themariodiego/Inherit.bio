import { createHash } from "node:crypto";
import type { APIResponse, BrowserContext, Page } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { ANON_KEY, SUPABASE_URL } from "../helpers";
import type { CsrfRoute } from "../../src/lib/security/session-csrf-core";

/**
 * The one-time `X-Inherit-CSRF` token (src/lib/security/session-csrf-core.ts;
 * owner decision of 23 October 2026, "CSRF: build the token everywhere"). The
 * signed-in shell or the page renders it and the route spends it once, so a
 * test that calls a guarded route directly mints one the way the shell does:
 * for the context's own live session and that route, under the local server's
 * fixture key, which is passed to the mint and never set in this process's
 * environment. Never a hosted key.
 */

type Cookies = Awaited<ReturnType<BrowserContext["cookies"]>>;

async function fixtureKey(): Promise<string> {
  // Loaded here, not at the top: the configuration refuses to load outside a browser run.
  const { default: config } = await import("../../playwright.config");
  const servers = Array.isArray(config.webServer) ? config.webServer : [config.webServer];
  const key = servers[0]?.env?.BYOK_ENCRYPTION_KEY;
  if (!key) throw new Error("Local browser fixture key missing");
  return key;
}

async function mint(session: Parameters<typeof import("../../src/lib/security/session-csrf-core").mintSessionCsrf>[0],
  route: CsrfRoute): Promise<string> {
  const { mintSessionCsrf } = await import("../../src/lib/security/session-csrf-core");
  return mintSessionCsrf(session, route, Date.now(), await fixtureKey());
}

/** The context's own account and auth session, read from its cookies; null when it is signed out. */
async function accountSession(cookies: Cookies): Promise<{ accountId: string; sessionId: string } | null> {
  const auth = createServerClient(SUPABASE_URL, ANON_KEY, { cookies: { getAll: () => cookies,
    setAll: () => { throw new Error("The token must be bound to the existing session"); } } });
  const current = await auth.auth.getClaims();
  const accountId = current.data?.claims.sub, sessionId = current.data?.claims.session_id;
  return !current.error && typeof accountId === "string" && typeof sessionId === "string" ? { accountId, sessionId } : null;
}

const contextOf = (target: Page | BrowserContext): BrowserContext => "context" in target ? target.context() : target;

/** A token for `route` bound to the context's signed-in session. */
export async function accountCsrf(target: Page | BrowserContext, route: CsrfRoute): Promise<string> {
  const session = await accountSession(await contextOf(target).cookies());
  if (!session) throw new Error("The context's own session is unavailable");
  return mint({ kind: "authenticated", ...session }, route);
}

/** A token for `route` bound to the context's rights session (its rights cookie). */
export async function rightsCsrf(target: Page | BrowserContext, route: CsrfRoute): Promise<string> {
  const cookie = (await contextOf(target).cookies()).find(item => item.name === "__Host-inherit-rights" || item.name === "inherit-rights");
  if (!cookie) throw new Error("The context holds no rights session");
  return mint({ kind: "token", sessionHash: createHash("sha256").update(cookie.value, "utf8").digest("hex") }, route);
}

/**
 * Signs the page's context out as the shell's scripted form does: an empty
 * POST from this origin with the session's one-time sign-out token. `base`
 * names another origin than the project's, as `page.request.post` with a full
 * URL did. A context that is already signed out posts without a token, which
 * the route answers the same way.
 */
export async function signOut(page: Page, base?: string): Promise<APIResponse> {
  const origin = base ? new URL(base).origin
    : new URL((await page.request.fetch("/auth/sign-out", { method: "OPTIONS", maxRedirects: 0 })).url()).origin;
  const session = await accountSession(await page.context().cookies());
  const headers: Record<string, string> = { origin };
  if (session) headers["x-inherit-csrf"] = await mint({ kind: "authenticated", ...session }, "auth.sign-out");
  return page.request.post(`${origin}/auth/sign-out`, { headers });
}
