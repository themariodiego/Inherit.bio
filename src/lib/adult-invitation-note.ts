import "server-only";

import crypto from "node:crypto";
import { z } from "zod";
import { claimDataKey, newWrappedDocumentKey, openDocumentBytes, sealDocumentBytes } from "@/lib/future-person/document-envelope";

/**
 * D-139: Path A's optional invitation note (brief §5 §5.2), sealed for the one
 * invitation mail it belongs to. The register's api.subject-drafts says the
 * note "is envelope-encrypted and may flow only to that invitation template",
 * and that its plaintext "exists only in bounded request and mail-worker
 * memory". So the route seals it before the invitation is created, the
 * database stores only this envelope, in the same transaction that creates
 * the invitation and queues its mail, and only the mail worker opens it, in
 * memory, for that template.
 *
 * The house document envelope (src/lib/future-person/document-envelope.ts):
 * a random 32-byte key for this one note, wrapped by the deployment key, and
 * AES-256-GCM under it. The additional authenticated data names the template,
 * the purpose and the invitation's mail idempotency key. That key is unique
 * on mail_outbox and the route derives it from the inviter, the address
 * digest and the request id before the invitation exists, so it is the one
 * name the route and the database share for that invitation. The worker never
 * takes the key from the envelope on trust: the claim hands it the provider
 * attempt key, sha256("mail-token-attempt-v1|key|attempt"), and the envelope
 * opens only when its key reproduces that value for the claimed attempt and
 * the template is this one. A note moved to another invitation's row, or to
 * another template, does not open, and the database refuses the move as well
 * (the envelope's key must equal the row's own).
 */

export const ADULT_INVITATION_TEMPLATE = "adult-subject-invitation";
const PURPOSE = "adult-subject-invitation";
const BINDING = "adult-subject-invitation-note-v1";

/** The note as the inviter may write it: plain words only, no control characters. */
export const adultInvitationNote = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .regex(/^[^\u0000-\u0008\u000b-\u001f\u007f]+$/);

/**
 * The stored shape, and the only one: the database holds the same closed
 * shape (mail_outbox_adult_invitation_note_sealed). 72 bytes of wrapped key
 * (12-byte IV, 16-byte tag, 44 characters of base64) are 144 hex digits; the
 * sealed note is the 28-byte envelope overhead and 1 to 1,500 bytes of UTF-8
 * (500 UTF-16 units at most three bytes each).
 */
export const adultInvitationNoteEnvelope = z
  .object({
    version: z.literal(1),
    idempotencyKey: z.string().regex(/^[0-9a-f]{64}$/u),
    wrappedKey: z.string().regex(/^[0-9a-f]{144}$/u),
    ciphertext: z.string().regex(/^(?:[0-9a-f]{2}){29,1528}$/u),
  })
  .strict();
export type AdultInvitationNoteEnvelope = z.infer<typeof adultInvitationNoteEnvelope>;

/** What the claim gave the worker for the one row it is preparing. */
export interface ClaimedInvitationMail {
  templateId: string;
  attemptOrdinal: number;
  /** The claim's `idempotency_key`: the provider attempt key, never the row's own. */
  providerAttemptKey: string;
}

function binding(templateId: string, idempotencyKey: string): string {
  return `${BINDING}|${JSON.stringify({ templateId, purpose: PURPOSE, idempotencyKey })}`;
}

/** private.mail_provider_attempt_key_v1 for a token-bearing row. */
function providerAttemptKey(idempotencyKey: string, attemptOrdinal: number): string {
  return crypto
    .createHash("sha256")
    .update(`mail-token-attempt-v1|${idempotencyKey}|${attemptOrdinal}`, "utf8")
    .digest("hex");
}

/** Seal the note for the invitation this idempotency key will create. */
export function sealAdultInvitationNote(note: string, idempotencyKey: string): AdultInvitationNoteEnvelope {
  const value = adultInvitationNote.parse(note);
  if (!/^[0-9a-f]{64}$/u.test(idempotencyKey)) throw new Error("invitation_note_unavailable");
  const wrapped = newWrappedDocumentKey();
  const bytes = Buffer.from(value, "utf8");
  let key: Buffer | undefined;
  try {
    key = claimDataKey(wrapped.toString("hex"));
    return adultInvitationNoteEnvelope.parse({
      version: 1,
      idempotencyKey,
      wrappedKey: wrapped.toString("hex"),
      ciphertext: sealDocumentBytes(key, binding(ADULT_INVITATION_TEMPLATE, idempotencyKey), bytes).toString("hex"),
    });
  } finally {
    key?.fill(0);
    wrapped.fill(0);
    bytes.fill(0);
  }
}

/**
 * The note, in worker memory, for the claimed attempt of the one row it was
 * sealed for; null when the template is another, the envelope is not the
 * closed shape, its key is not this row's, or it was altered, moved or sealed
 * under another key. The caller fails the mail on null: a note that cannot
 * be opened is never sent corrupted or silently left out.
 */
export function openAdultInvitationNote(envelope: unknown, claim: ClaimedInvitationMail): string | null {
  if (claim.templateId !== ADULT_INVITATION_TEMPLATE) return null;
  if (!Number.isInteger(claim.attemptOrdinal) || claim.attemptOrdinal < 1 || claim.attemptOrdinal > 10) return null;
  if (!/^[0-9a-f]{64}$/u.test(claim.providerAttemptKey)) return null;
  const parsed = adultInvitationNoteEnvelope.safeParse(envelope);
  if (!parsed.success) return null;
  const expected = Buffer.from(providerAttemptKey(parsed.data.idempotencyKey, claim.attemptOrdinal), "hex");
  const presented = Buffer.from(claim.providerAttemptKey, "hex");
  if (!crypto.timingSafeEqual(expected, presented)) return null;
  let key: Buffer | undefined;
  let bytes: Buffer | null = null;
  try {
    key = claimDataKey(parsed.data.wrappedKey);
    bytes = openDocumentBytes(key, binding(claim.templateId, parsed.data.idempotencyKey),
      Buffer.from(parsed.data.ciphertext, "hex"));
    if (!bytes) return null;
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const note = adultInvitationNote.safeParse(text);
    return note.success && note.data === text ? note.data : null;
  } catch {
    return null;
  } finally {
    key?.fill(0);
    bytes?.fill(0);
  }
}
