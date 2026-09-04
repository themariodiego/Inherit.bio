import { NextResponse } from "next/server";
import { TIER2_EMBRYO_COOKIE_NAME } from "@/lib/embryos/tier2";
import { TIER2_COOKIE_NAME } from "@/lib/family/tier2";

/** Every Tier-2 acknowledgement lasts exactly one signed-in session (brief §3 §7.2): both cookies end at sign-out. */
export const SESSION_SCOPED_COOKIES = [TIER2_COOKIE_NAME, TIER2_EMBRYO_COOKIE_NAME] as const;

/** The redirect home after sign-out, with every session-scoped acknowledgement cookie deleted. */
export function signOutResponse(origin: string): NextResponse {
  const response = NextResponse.redirect(new URL("/", origin), { status: 303 });
  for (const name of SESSION_SCOPED_COOKIES) response.cookies.delete(name);
  return response;
}
