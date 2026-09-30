import "server-only";

import crypto from "node:crypto";
import { z } from "zod";
import { encryptSecret } from "@/lib/crypto";
import { RECORD_KEY_PATTERN } from "@/lib/embryos/record-key-cards";
import { normalizeContact } from "@/lib/embryos/routes";

/**
 * `POST /api/future-person/claim` (register api.future-person-claim), the body
 * and the sealed intake it becomes. Nothing here reads a header, a cookie or
 * the database; the route adds those.
 *
 * closed-future-person-claim-intake-v1 is three closed bodies, one per mode.
 * Every body is `.strict()` and carries its own `mode` literal, so no body
 * fits two shapes and a field the register does not list is refused.
 *
 * future-person-claim-intake-privacy-v1: the identity and contact fields are
 * sealed here with a random data key made for this one claim, and the data
 * key is sealed with the deployment key. The database stores both blobs and
 * can open neither. A Record Key or Recovery Key is kept only as its SHA-256,
 * the same hash the key tables hold, so a later review can resolve it without
 * the raw key ever being stored.
 */

/** Code points, not UTF-16 units: a name in any script is counted as written. */
function characterCount(value: string): number {
  return [...value].length;
}

// Whitespace, line and paragraph separators included, is collapsed before
// this runs; what is left of the control ranges is refused.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;

function boundedText(minimum: number, maximum: number) {
  return z
    .string()
    .max(maximum * 4)
    .transform((value) => value.normalize("NFC").trim().replace(/\s+/gu, " "))
    .refine((value) => characterCount(value) >= minimum && characterCount(value) <= maximum && !CONTROL.test(value));
}

const CONTACT_BYTE_LIMIT = 254;
const contactEmail = z
  .string()
  .max(1024)
  .transform(normalizeContact)
  .pipe(z.email().max(CONTACT_BYTE_LIMIT).refine((value) => new TextEncoder().encode(value).length <= CONTACT_BYTE_LIMIT));

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date as `YYYY-MM-DD`, or null. */
function calendarDate(value: string): Date | null {
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value && Number(match[1]) >= 1900 ? date : null;
}

/** The UTC date `years` after `date`, with 29 February landing on 1 March. */
function addYears(date: Date, years: number): Date {
  const result = new Date(date.getTime());
  result.setUTCFullYear(date.getUTCFullYear() + years);
  return result;
}

/** Today's UTC calendar date at midnight. */
function utcToday(now: number): Date {
  const today = new Date(now);
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
}

function adultDateOfBirth(now: () => number) {
  return z.string().max(10).refine((value) => {
    const date = calendarDate(value);
    return date !== null && addYears(date, 18).getTime() <= utcToday(now()).getTime();
  });
}

function pastOrTodayDate(now: () => number) {
  return z.string().max(10).refine((value) => {
    const date = calendarDate(value);
    return date !== null && date.getTime() <= utcToday(now()).getTime();
  });
}

/** tokenSecurityContract.futurePersonReadableKeyFormat, exactly. */
const readableKey = z.string().regex(RECORD_KEY_PATTERN);

export function claimIntakeBody(now: () => number = Date.now) {
  const identity = {
    claimantName: boundedText(2, 120),
    contactEmail,
    affirmed: z.literal(true),
  };
  return z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("record-key"), recordKey: readableKey, claimantDateOfBirth: adultDateOfBirth(now), ...identity }).strict(),
    z.object({ mode: z.literal("claimant-recovery-key"), recoveryKey: readableKey, claimantDateOfBirth: adultDateOfBirth(now), ...identity }).strict(),
    z.object({
      mode: z.literal("keyless-start"),
      childDateOfBirth: pastOrTodayDate(now),
      childPlaceOfBirth: boundedText(2, 160),
      parentNames: z.array(boundedText(2, 120)).min(1).max(4),
      ...identity,
    }).strict(),
  ]);
}

export type ClaimIntakeBody = z.infer<ReturnType<typeof claimIntakeBody>>;
export type ClaimMode = ClaimIntakeBody["mode"];

/** The closed, safe issue list of invalid-request-v1: field names only, never values. */
export function claimIntakeIssues(error: z.ZodError): string[] {
  const allowed = new Set([
    "mode", "recordKey", "recoveryKey", "claimantName", "claimantDateOfBirth", "contactEmail",
    "childDateOfBirth", "childPlaceOfBirth", "parentNames", "affirmed",
  ]);
  const issues = new Set<string>();
  for (const issue of error.issues) {
    const field = issue.path[0];
    issues.add(typeof field === "string" && allowed.has(field) ? field : "body");
  }
  return [...issues].sort();
}

export interface SealedClaimIntake {
  mode: ClaimMode;
  /** SHA-256 of the submitted key; null for a keyless start. */
  keyHash: string | null;
  /** The value the identifier limit keys: the key, or the normalized contact. */
  identifier: string;
  identityCiphertext: Buffer;
  wrappedDataKey: Buffer;
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

/** AES-256-GCM under a fresh key, laid out like `encryptSecret`: iv, tag, text. */
function sealWith(key: Buffer, plaintext: string): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const text = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), text]);
}

/**
 * The intake the database stores. The raw key leaves in no field: it is only
 * hashed and, for the identifier limit, keyed. The fields a reviewer will
 * need are sealed under a key made for this claim alone.
 */
export function sealClaimIntake(body: ClaimIntakeBody): SealedClaimIntake {
  const dataKey = crypto.randomBytes(32);
  try {
    const identity = body.mode === "keyless-start"
      ? {
          claimantName: body.claimantName,
          contactEmail: body.contactEmail,
          childDateOfBirth: body.childDateOfBirth,
          childPlaceOfBirth: body.childPlaceOfBirth,
          parentNames: body.parentNames,
        }
      : {
          claimantName: body.claimantName,
          claimantDateOfBirth: body.claimantDateOfBirth,
          contactEmail: body.contactEmail,
        };
    const key = body.mode === "record-key" ? body.recordKey
      : body.mode === "claimant-recovery-key" ? body.recoveryKey
      : null;
    return {
      mode: body.mode,
      keyHash: key === null ? null : sha256(key),
      identifier: key ?? body.contactEmail,
      identityCiphertext: sealWith(dataKey, JSON.stringify({ version: 1, ...identity })),
      wrappedDataKey: encryptSecret(dataKey.toString("base64")),
    };
  } finally {
    dataKey.fill(0);
  }
}
