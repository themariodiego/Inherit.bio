import { createHash } from "node:crypto";
import type { APIResponse, BrowserContext, Page } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { ANON_KEY, SUPABASE_URL } from "../helpers";
import type { CsrfRoute } from "../../src/lib/security/session-csrf-core";
import { loadPlaywrightConfig } from "./playwright-config";

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
  const config = await loadPlaywrightConfig();
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

/*
 * G8.5, the migration stage (19 November 2026): one minter per session kind
 * public.consume_session_csrf_v2 added. Each binds what the route's own
 * wrapper reads from the live request: the reviewer's account and auth
 * session, or one purpose cookie's hash (with the session id where the
 * cookie belongs to one upload or evidence session).
 */

/** A token for a reviewer `route`, bound to the context's signed-in session under the reviewer's own kind. */
export async function reviewerCsrf(target: Page | BrowserContext, route: CsrfRoute): Promise<string> {
  const session = await accountSession(await contextOf(target).cookies());
  if (!session) throw new Error("The context's own session is unavailable");
  return mint({ kind: "reviewer", ...session }, route);
}

/** The SHA-256 of the context's one cookie of `name`, with or without its `__Host-` prefix. */
async function cookieHash(target: Page | BrowserContext, name: string): Promise<string> {
  const cookies = (await contextOf(target).cookies()).filter(item => item.name === `__Host-${name}` || item.name === name);
  if (cookies.length !== 1) throw new Error(`The context holds ${cookies.length} ${name} cookies`);
  return createHash("sha256").update(cookies[0]!.value, "utf8").digest("hex");
}

/** A token for an embryo upload session's `route`, bound to its `inherit-ingest-<session>` cookie and id. */
export async function uploadCsrf(target: Page | BrowserContext, session: string, route: CsrfRoute): Promise<string> {
  return mint({ kind: "upload-session", sessionHash: await cookieHash(target, `inherit-ingest-${session}`), sessionId: session }, route);
}

/** A token for an evidence session's `route`, bound to the evidence cookie and the session id. */
export async function evidenceCsrf(target: Page | BrowserContext, session: string, route: CsrfRoute): Promise<string> {
  return mint({ kind: "evidence-session", sessionHash: await cookieHash(target, "inherit-evidence"), sessionId: session }, route);
}

/** A token for a claim session's `route`, bound to the claim cookie. */
export async function claimCsrf(target: Page | BrowserContext, route: CsrfRoute): Promise<string> {
  return mint({ kind: "claim-session", sessionHash: await cookieHash(target, "inherit-claim") }, route);
}

/** A token for auth.reset-password-submit, bound to the reset session's cookie. */
export async function resetCsrf(target: Page | BrowserContext): Promise<string> {
  return mint({ kind: "reset-session", sessionHash: await cookieHash(target, "inherit-reset") }, "auth.reset-password-submit");
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
