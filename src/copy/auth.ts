/**
 * What the sign-up, forgot-password and reset-password forms say when their
 * endpoint refuses a submission (`/api/auth/*`). Plain English, grade ≤ 9,
 * second person, typographic apostrophes (U+2019).
 *
 * The endpoints answer with closed codes and field names only; the form
 * looks the sentence up here. No auth-service wording ever reaches a page,
 * and no message says whether an address has an account.
 */
export const AUTH_FORM_ERRORS = {
  email: "Check your email address.",
  password: "Use a password of 12 to 72 characters.",
  expired: "This page has expired. Try again.",
  resetExpired: "This reset link has expired or was used. Ask for a new link.",
  unavailable: "This did not work. Try again in a few hours.",
} as const;

export type AuthFormError = keyof typeof AUTH_FORM_ERRORS;
