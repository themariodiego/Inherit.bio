/**
 * What the sign-in page says when the auth callback sends a reader there
 * (`src/app/auth/callback/route.ts`). Plain English, grade ≤ 9, second
 * person, typographic apostrophes (U+2019).
 *
 * The callback writes one fixed code into the query and the page looks the
 * sentence up here. Supabase’s own error text never reaches the page: it is
 * not written for a reader, and a query value anyone can edit must not be
 * able to put words on this page. A code not listed here shows nothing.
 */

/** `?notice=`: the link did its job, but no session came with it. */
export const SIGN_IN_STATUS = {
  email_confirmed: "Your email is confirmed. Sign in to continue.",
} as const;

/** `?error=`: the link or the provider could not sign the reader in. */
export const SIGN_IN_ERRORS = {
  link_expired:
    "That link has expired or was already used. Sign in, or create your account again if you never finished.",
  // Also where a failed GitHub sign-in lands, so it does not assume a link.
  verification_failed:
    "We could not finish signing you in. Try again, or sign in with your email and password.",
} as const;

export type SignInStatusCode = keyof typeof SIGN_IN_STATUS;
export type SignInErrorCode = keyof typeof SIGN_IN_ERRORS;

export interface SignInMessage {
  role: "status" | "alert";
  text: string;
}

/**
 * The one message for the sign-in query, or null. Only own keys count, so
 * `?error=toString` is as unknown as any other value.
 */
export function signInMessage(query: Pick<URLSearchParams, "get">): SignInMessage | null {
  const failure = query.get("error");
  if (failure && Object.hasOwn(SIGN_IN_ERRORS, failure)) {
    return { role: "alert", text: SIGN_IN_ERRORS[failure as SignInErrorCode] };
  }
  const notice = query.get("notice");
  if (notice && Object.hasOwn(SIGN_IN_STATUS, notice)) {
    return { role: "status", text: SIGN_IN_STATUS[notice as SignInStatusCode] };
  }
  return null;
}
