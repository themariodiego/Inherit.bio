import "server-only";

import { z } from "zod";

/**
 * The closed request bodies of the three auth endpoints
 * (docs/route-register.json `requestContract.closedBody`):
 *
 *   auth.sign-up-submit          { email, password }
 *   auth.forgot-password-submit  { email }
 *   auth.reset-password-submit   { password }
 *
 * An email is trimmed and lower-cased, then must be a valid address of at
 * most 254 bytes of UTF-8. A password is 12 to 72 characters and at most 72
 * bytes of UTF-8 (owner decision 2026-10-16): the auth service refuses a
 * longer one and bcrypt reads only the first 72 bytes, so a longer password
 * is refused here, before any auth-service call, rather than silently
 * shortened or accepted and then lost.
 *
 * Issues name fields, never values. A body that is not one JSON object with
 * exactly the registered keys is the whole `body`.
 */

export const PASSWORD_MIN_CHARACTERS = 12;
export const PASSWORD_MAX_CHARACTERS = 72;
export const PASSWORD_MAX_BYTES = 72;
const EMAIL_MAX_BYTES = 254;
const BODY_LIMIT = 8 * 1024;

export type AuthField = "email" | "password";
export type AuthIssue = AuthField | "body";

const utf8Bytes = (value: string) => Buffer.byteLength(value, "utf8");

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

const email = z.string().max(1024).transform(normalizeEmail)
  .pipe(z.email().refine((value) => utf8Bytes(value) <= EMAIL_MAX_BYTES));

/** 12 to 72 Unicode characters and at most 72 bytes of UTF-8. */
export function passwordFits(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const characters = Array.from(value).length;
  return characters >= PASSWORD_MIN_CHARACTERS && characters <= PASSWORD_MAX_CHARACTERS
    && utf8Bytes(value) <= PASSWORD_MAX_BYTES;
}

/** At most 8 KiB of well-formed UTF-8 JSON, or null. */
export async function readBoundedJson(request: Request): Promise<unknown> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let text = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > BODY_LIMIT) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } catch {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type ParsedAuthBody<F extends AuthField> =
  | { ok: true; value: Record<F, string> }
  | { ok: false; issues: AuthIssue[] };

/** The body when it is exactly `fields`, each valid; otherwise the closed issue list. */
export function parseAuthBody<F extends AuthField>(json: unknown, fields: readonly F[]): ParsedAuthBody<F> {
  if (!isPlainObject(json)) return { ok: false, issues: ["body"] };
  const keys = Object.keys(json);
  if (keys.length !== fields.length || !keys.every((key) => (fields as readonly string[]).includes(key))) {
    return { ok: false, issues: ["body"] };
  }
  const value = {} as Record<F, string>;
  const issues: AuthIssue[] = [];
  for (const field of fields) {
    const raw = json[field];
    if (field === "email") {
      const parsed = email.safeParse(raw);
      if (parsed.success) value[field] = parsed.data;
      else issues.push("email");
    } else if (passwordFits(raw)) {
      value[field] = raw;
    } else {
      issues.push("password");
    }
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, value };
}
