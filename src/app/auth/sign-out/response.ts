import { NextResponse } from "next/server";
import { TIER2_EMBRYO_COOKIE_NAME } from "@/lib/embryos/tier2";
import { TIER2_COOKIE_NAME } from "@/lib/family/tier2";

/** Every Tier-2 acknowledgement lasts exactly one signed-in session (brief §3 §7.2): both cookies end at sign-out. */
export const SESSION_SCOPED_COOKIES = [TIER2_COOKIE_NAME, TIER2_EMBRYO_COOKIE_NAME] as const;

/**
 * sign-out-v1: a 303 to auth.sign-in, no body, `Cache-Control: no-store` and
 * `Referrer-Policy: no-referrer`, with every session-scoped acknowledgement
 * cookie deleted.
 */
export function signOutResponse(origin: string): NextResponse {
  const response = NextResponse.redirect(new URL("/auth/sign-in", origin), { status: 303 });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  for (const name of SESSION_SCOPED_COOKIES) response.cookies.delete(name);
  return response;
}
