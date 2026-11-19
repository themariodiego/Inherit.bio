import { AUTH_FORM_ERRORS } from "@/copy/auth";

/**
 * The browser half of the three auth endpoints: one same-origin JSON POST
 * carrying the page's CSRF value, and the one sentence a refusal shows.
 * Only the status and the closed issue codes are read; nothing the server or
 * the auth service says is put on the page.
 */

export type AuthEndpoint = "/api/auth/sign-up" | "/api/auth/forgot-password" | "/api/auth/reset-password";

export interface AuthEndpointAnswer {
  status: number;
  issues: string[];
}

export async function postAuthEndpoint(path: AuthEndpoint, csrf: string, body: Record<string, string>): Promise<AuthEndpointAnswer> {
  try {
    const response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json", "x-inherit-csrf": csrf },
      body: JSON.stringify(body),
    });
    let issues: string[] = [];
    if (response.status === 422) {
      const json = (await response.json().catch(() => null)) as { issues?: unknown } | null;
      issues = Array.isArray(json?.issues) ? json.issues.filter((issue): issue is string => typeof issue === "string") : [];
    }
    return { status: response.status, issues };
  } catch {
    return { status: 0, issues: [] };
  }
}

/** The sentence for a refused submission. `reset` reads a 404 as a spent link. */
export function authRefusal(answer: AuthEndpointAnswer, reset = false): string {
  if (answer.status === 422) {
    if (answer.issues.includes("email")) return AUTH_FORM_ERRORS.email;
    if (answer.issues.includes("password")) return AUTH_FORM_ERRORS.password;
    return AUTH_FORM_ERRORS.expired;
  }
  if (reset && answer.status === 404) return AUTH_FORM_ERRORS.resetExpired;
  return AUTH_FORM_ERRORS.unavailable;
}
