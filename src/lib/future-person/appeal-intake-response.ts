import crypto from "node:crypto";

/** The registered authOrRecovery profile plus sensitive-data cache headers.
 * This also runs in the exact appeal proxy branch, including its refusals.
 * The embryo helper remains unchanged and cannot overwrite this policy. */
export function applyAppealIntakeHeaders<T extends { headers: Headers }>(response: T): T {
  const nonceBytes = crypto.randomBytes(16);
  let nonce: string;
  try { nonce = nonceBytes.toString("base64"); } finally { nonceBytes.fill(0); }
  const headers: Record<string, string> = {
    "Cache-Control": "private, no-store",
    "CDN-Cache-Control": "no-store",
    "Vercel-CDN-Cache-Control": "no-store",
    Pragma: "no-cache",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'nonce-${nonce}'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
  };
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  return response;
}
export function appealIntakeJson(body: unknown, status: number): Response {
  return applyAppealIntakeHeaders(Response.json(body, { status }));
}
export const appealIntakeNotFound = () => appealIntakeJson({ error: "not_found" }, 404);
