import "server-only";

/**
 * The three Supabase Auth calls the auth endpoints and the callback make,
 * from the server, with the public anon key: sign up, send a recovery link,
 * and exchange a PKCE code. Each carries the S256 challenge this server
 * generated (`pkce-state.ts`), so the verifier never reaches a browser.
 *
 * They are plain requests rather than supabase-js calls because supabase-js
 * keeps its own verifier in its own storage; here the verifier belongs to
 * the state cookie the callback checks. Nothing an auth-service answer says
 * is passed to a person: each call returns one closed outcome.
 *
 * The plaintext password travels only in the sign-up request body, to the
 * auth service, and is never logged.
 */

const TIMEOUT_MS = 10_000;

function authBase(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("auth_service_unconfigured");
  return { url: `${url.replace(/\/+$/u, "")}/auth/v1`, key };
}

async function authRequest(path: string, body: unknown, redirectTo?: string): Promise<{ status: number; json: unknown }> {
  const { url, key } = authBase();
  const target = new URL(`${url}${path}`);
  if (redirectTo) target.searchParams.set("redirect_to", redirectTo);
  const response = await fetch(target, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  let json: unknown = null;
  try { json = await response.json(); } catch { json = null; }
  return { status: response.status, json };
}

function errorCode(json: unknown): string | null {
  if (typeof json !== "object" || json === null) return null;
  const code = (json as { error_code?: unknown; code?: unknown }).error_code;
  return typeof code === "string" ? code : null;
}

/**
 * `sent` covers every answer that must look like it: a new account, an
 * existing confirmed or unconfirmed one, a rate limit, a disabled sign-up and
 * an outage. Only a refusal of the password or the address themselves, which
 * no identity changes, is told apart.
 */
export type SignUpOutcome = "sent" | "weak_password" | "email_invalid";

export async function signUpWithAuthService(input: {
  email: string; password: string; redirectTo: string; codeChallenge: string;
}): Promise<SignUpOutcome> {
  try {
    const { status, json } = await authRequest("/signup", {
      email: input.email, password: input.password, data: {},
      code_challenge: input.codeChallenge, code_challenge_method: "s256",
    }, input.redirectTo);
    if (status >= 200 && status < 300) return "sent";
    const code = errorCode(json);
    if (code === "weak_password") return "weak_password";
    if (code === "email_address_invalid") return "email_invalid";
    return "sent";
  } catch {
    return "sent";
  }
}

/** The recovery call's answer is never told apart (auth.forgot-password-submit.policy.enumeration). */
export async function sendRecoveryLink(input: { email: string; redirectTo: string; codeChallenge: string }): Promise<void> {
  try {
    await authRequest("/recover", {
      email: input.email, code_challenge: input.codeChallenge, code_challenge_method: "s256",
    }, input.redirectTo);
  } catch {
    // Same answer either way.
  }
}

export interface ExchangedSession {
  accessToken: string;
  refreshToken: string;
  userId: string;
  sessionId: string;
}

export type ExchangeResult = { ok: true; session: ExchangedSession } | { ok: false; code: string | null };

function claims(token: string): Record<string, unknown> | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const value = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as unknown;
    return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/**
 * One PKCE exchange. The session id comes from the access token the auth
 * service just signed for this server over TLS, and the database re-checks
 * it against `auth.sessions` before it is trusted for anything.
 */
export async function exchangePkceCode(code: string, verifier: string): Promise<ExchangeResult> {
  try {
    const { status, json } = await authRequest("/token?grant_type=pkce", { auth_code: code, code_verifier: verifier });
    if (status < 200 || status >= 300) return { ok: false, code: errorCode(json) };
    const body = json as { access_token?: unknown; refresh_token?: unknown; user?: { id?: unknown } } | null;
    const accessToken = typeof body?.access_token === "string" ? body.access_token : null;
    const refreshToken = typeof body?.refresh_token === "string" ? body.refresh_token : null;
    const userId = typeof body?.user?.id === "string" ? body.user.id : null;
    const payload = accessToken ? claims(accessToken) : null;
    const sessionId = typeof payload?.session_id === "string" ? payload.session_id : null;
    if (!accessToken || !refreshToken || !userId || !sessionId || payload?.sub !== userId
      || !UUID.test(userId) || !UUID.test(sessionId)) {
      return { ok: false, code: null };
    }
    return { ok: true, session: { accessToken, refreshToken, userId, sessionId } };
  } catch {
    return { ok: false, code: null };
  }
}
