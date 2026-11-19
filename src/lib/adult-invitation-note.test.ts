import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * D-139: Path A's optional note is sealed for the one invitation mail it
 * belongs to and opens only there. The note text in this file is synthetic.
 */

const { adultInvitationNoteEnvelope, openAdultInvitationNote, sealAdultInvitationNote } = await import("./adult-invitation-note");
const { claimDataKey, newWrappedDocumentKey, sealDocumentBytes } = await import("@/lib/future-person/document-envelope");

const NOTE = "Synthetic note for a test.";
const KEY = "a".repeat(64);
const OTHER_KEY = "b".repeat(64);
const TEMPLATE = "adult-subject-invitation";

/** private.mail_provider_attempt_key_v1 for a token-bearing row, as the claim returns it. */
const attemptKey = (key: string, attempt: number) =>
  crypto.createHash("sha256").update(`mail-token-attempt-v1|${key}|${attempt}`, "utf8").digest("hex");
const claim = (key = KEY, attempt = 2, templateId = TEMPLATE) =>
  ({ templateId, attemptOrdinal: attempt, providerAttemptKey: attemptKey(key, attempt) });

beforeEach(() => vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64")));
afterEach(() => vi.unstubAllEnvs());

describe("sealing", () => {
  it("returns the closed envelope, bound to the key, with no trace of the note", () => {
    const envelope = sealAdultInvitationNote(NOTE, KEY);
    expect(adultInvitationNoteEnvelope.parse(envelope)).toEqual(envelope);
    expect(Object.keys(envelope)).toEqual(["version", "idempotencyKey", "wrappedKey", "ciphertext"]);
    expect(envelope).toMatchObject({ version: 1, idempotencyKey: KEY });
    expect(envelope.wrappedKey).toMatch(/^[0-9a-f]{144}$/);
    expect(envelope.ciphertext.length).toBe(2 * (28 + Buffer.byteLength(NOTE)));
    const serialized = JSON.stringify(envelope);
    expect(serialized).not.toContain(NOTE);
    expect(serialized).not.toContain(Buffer.from(NOTE).toString("hex"));
    expect(serialized).not.toContain(Buffer.from(NOTE).toString("base64"));
  });

  it("uses a fresh key and IV for every note, so equal notes do not look equal", () => {
    const [first, second] = [sealAdultInvitationNote(NOTE, KEY), sealAdultInvitationNote(NOTE, KEY)];
    expect(first.wrappedKey).not.toBe(second.wrappedKey);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it("fits the database's bounds for the shortest and the longest note the route accepts", () => {
    expect(sealAdultInvitationNote("x", KEY).ciphertext).toHaveLength(58);
    expect(sealAdultInvitationNote("€".repeat(500), KEY).ciphertext).toHaveLength(3056);
  });

  it("refuses what the route would refuse, and a key that is not an idempotency key", () => {
    for (const note of ["", "   ", "x".repeat(501), "line\u0000break", "bell\u0007"]) {
      expect(() => sealAdultInvitationNote(note, KEY)).toThrow();
    }
    expect(() => sealAdultInvitationNote(NOTE, "not-a-key")).toThrow("invitation_note_unavailable");
  });
});

describe("opening", () => {
  it("opens for the claimed attempt of the row it was sealed for, and only for this template", () => {
    const envelope = sealAdultInvitationNote(NOTE, KEY);
    expect(openAdultInvitationNote(envelope, claim())).toBe(NOTE);
    expect(openAdultInvitationNote(envelope, claim(KEY, 7))).toBe(NOTE);
    expect(openAdultInvitationNote(envelope, claim(KEY, 2, "co-parent-invitation"))).toBeNull();
    expect(openAdultInvitationNote(envelope, { ...claim(), attemptOrdinal: 3 })).toBeNull();
    expect(openAdultInvitationNote(envelope, { ...claim(), providerAttemptKey: KEY })).toBeNull();
  });

  it("refuses an envelope moved to another invitation's row, with or without its key rewritten", () => {
    const envelope = sealAdultInvitationNote(NOTE, KEY);
    // As it was sealed: the other row's attempt key is not this key's.
    expect(openAdultInvitationNote(envelope, claim(OTHER_KEY))).toBeNull();
    // Renamed to the other row's key: the key now matches, the sealed note does not.
    expect(openAdultInvitationNote({ ...envelope, idempotencyKey: OTHER_KEY }, claim(OTHER_KEY))).toBeNull();
  });

  it("refuses an envelope sealed under the right key for another template, or with no binding", () => {
    const wrappedKey = newWrappedDocumentKey().toString("hex");
    const key = claimDataKey(wrappedKey);
    const reseal = (binding: string) => ({ version: 1 as const, idempotencyKey: KEY, wrappedKey,
      ciphertext: sealDocumentBytes(key, binding, Buffer.from(NOTE)).toString("hex") });
    const named = (templateId: string) =>
      `adult-subject-invitation-note-v1|${JSON.stringify({ templateId, purpose: "adult-subject-invitation", idempotencyKey: KEY })}`;
    expect(openAdultInvitationNote(reseal(named(TEMPLATE)), claim())).toBe(NOTE);
    expect(openAdultInvitationNote(reseal(named("co-parent-invitation")), claim())).toBeNull();
    expect(openAdultInvitationNote(reseal("adult-subject-invitation-note-v1"), claim())).toBeNull();
    expect(openAdultInvitationNote(reseal(""), claim())).toBeNull();
    key.fill(0);
  });

  it("refuses a tampered sealed note, a swapped wrapped key and a truncated envelope", () => {
    const envelope = sealAdultInvitationNote(NOTE, KEY);
    const flipped = Buffer.from(envelope.ciphertext, "hex");
    flipped[flipped.length - 1] ^= 1;
    expect(openAdultInvitationNote({ ...envelope, ciphertext: flipped.toString("hex") }, claim())).toBeNull();
    const other = sealAdultInvitationNote(NOTE, KEY);
    expect(openAdultInvitationNote({ ...envelope, wrappedKey: other.wrappedKey }, claim())).toBeNull();
    expect(openAdultInvitationNote({ ...envelope, ciphertext: envelope.ciphertext.slice(0, 58) }, claim())).toBeNull();
  });

  it("never opens plain text or anything outside the closed shape", () => {
    const envelope = sealAdultInvitationNote(NOTE, KEY);
    for (const value of [NOTE, { note: NOTE }, { ...envelope, note: NOTE }, { ...envelope, version: 2 },
      { ...envelope, ciphertext: Buffer.from(NOTE).toString("hex") }, null, undefined, 1, []]) {
      expect(openAdultInvitationNote(value, claim())).toBeNull();
    }
  });

  it("fails closed when the deployment key cannot unwrap the note's key", () => {
    const envelope = sealAdultInvitationNote(NOTE, KEY);
    vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
    expect(openAdultInvitationNote(envelope, claim())).toBeNull();
  });

  it("reproduces the provider attempt key the database computes (pinned with the migration)", () => {
    // 20261119134500's predecessor and postflight blocks, and its pgTAP suite,
    // hold private.mail_provider_attempt_key_v1 to this value for key 'a'x64, attempt 3.
    expect(attemptKey("a".repeat(64), 3)).toBe("6f1e8bd33056fe66d4fcfd2b65ab888dae730da76626fa0bca5399fe944c4517");
    const envelope = sealAdultInvitationNote(NOTE, "a".repeat(64));
    expect(openAdultInvitationNote(envelope, { templateId: TEMPLATE, attemptOrdinal: 3,
      providerAttemptKey: "6f1e8bd33056fe66d4fcfd2b65ab888dae730da76626fa0bca5399fe944c4517" })).toBe(NOTE);
  });
});
