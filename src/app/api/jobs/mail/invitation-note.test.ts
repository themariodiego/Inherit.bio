import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * D-139: the mail worker opens Path A's sealed note in memory, only for the
 * adult-subject-invitation template and only for the claimed row it was
 * sealed for, and fails the mail (retried, then failed) when it cannot: an
 * invitation is never sent with a corrupted note, without its note, or with
 * a plain note read from a row. The worker's other behaviour is covered in
 * ./route.test.ts; this file keeps the real envelope crypto, under a
 * synthetic deployment key, and a synthetic note.
 */

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), submit: vi.fn(), from: vi.fn(), contact: vi.fn() }));
vi.mock("@/lib/embryo/terminal-mail", () => ({ drainEmbryoTerminalMail: async () => ({ processed: 0, failed: 0 }) }));
vi.mock("@/lib/embryos/invitation-terminal-mail", () => ({ drainInvitationTerminalMail: async () => ({ processed: 0, failed: 0 }) }));
vi.mock("@/lib/email", () => ({ submitMail: mocks.submit }));
vi.mock("@/lib/future-person/claimant-contact", () => ({ openMailContact: mocks.contact }));
vi.mock("@/lib/future-person/new-public-appeal-mail", () => ({ readNewPublicAppealMailContact: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc, from: mocks.from }) }));

const { POST } = await import("./route");
const { sealAdultInvitationNote } = await import("@/lib/adult-invitation-note");

const NOTE = "Synthetic note from the inviter.";
const KEY = crypto.createHash("sha256").update("d139-worker-row", "utf8").digest("hex");
const OTHER_KEY = crypto.createHash("sha256").update("d139-worker-other-row", "utf8").digest("hex");
const TOKEN = "a".repeat(43);

/** private.mail_provider_attempt_key_v1 for a token-bearing row. */
const attemptKey = (key: string, attempt: number) =>
  crypto.createHash("sha256").update(`mail-token-attempt-v1|${key}|${attempt}`, "utf8").digest("hex");

/** The row claim_mail_outbox hands the worker for the invitation mail whose key is `key`. */
function claimed(payload: unknown, key = KEY, attempt = 1, templateId = "adult-subject-invitation") {
  return { outbox_id: "d1390000-0000-4000-8000-0000000000aa", attempt_ordinal: attempt, contact_ciphertext: "\\x00",
    template_id: templateId, template_payload: payload, delivery_token: TOKEN, idempotency_key: attemptKey(key, attempt) };
}

function queue(row: Record<string, unknown>) {
  let done = false;
  mocks.rpc.mockImplementation(async (name: string) => {
    if (name === "claim_mail_outbox") { const data = done ? [] : [row]; done = true; return { data, error: null }; }
    if (name === "authorize_mail_submission_v1") return { data: true, error: null };
    if (name === "complete_mail_attempt") return { data: null, error: null };
    throw new Error(`Unexpected RPC ${name}`);
  });
}

async function drain() {
  const response = await POST(new Request("http://localhost/api/jobs/mail", {
    method: "POST", headers: { authorization: "Bearer test-job-secret" },
  }));
  return (await response.json()) as { outcome: string };
}

const completions = () => mocks.rpc.mock.calls.filter(([name]) => name === "complete_mail_attempt").map(([, args]) => args);

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
  vi.stubEnv("JOBS_SECRET", "test-job-secret");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  mocks.from.mockImplementation((table: string) => { throw new Error(`the drain must not read ${table}`); });
  mocks.contact.mockReturnValue("invited-person@example.invalid");
  mocks.submit.mockResolvedValue("synthetic-provider-id");
});
afterEach(() => vi.unstubAllEnvs());

describe("the sealed invitation note in the mail worker (D-139)", () => {
  it("opens the note for its own row and template, renders it, and records acceptance", async () => {
    queue(claimed({ noteEnvelope: sealAdultInvitationNote(NOTE, KEY) }));
    expect(await drain()).toEqual({ status: "complete", outcome: "completed" });
    expect(mocks.submit).toHaveBeenCalledExactlyOnceWith("invited-person@example.invalid", {
      id: "adult-subject-invitation",
      payload: { invitationUrl: `http://localhost:3000/withdraw/request#${TOKEN}`, note: NOTE, request: undefined },
    }, attemptKey(KEY, 1));
    expect(completions()).toEqual([expect.objectContaining({ p_success: true, p_outcome_code: "accepted" })]);
    // The opened note goes to the provider and nowhere else: no RPC, no table.
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain(NOTE);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("opens on a retry too, under the next attempt's provider key", async () => {
    queue(claimed({ noteEnvelope: sealAdultInvitationNote(NOTE, KEY) }, KEY, 4));
    expect(await drain()).toEqual({ status: "complete", outcome: "completed" });
    expect(mocks.submit.mock.calls[0]![1].payload.note).toBe(NOTE);
  });

  it("refuses an envelope moved to another invitation's row, as sealed or with its key renamed", async () => {
    const envelope = sealAdultInvitationNote(NOTE, KEY);
    for (const moved of [envelope, { ...envelope, idempotencyKey: OTHER_KEY }]) {
      vi.clearAllMocks();
      queue(claimed({ noteEnvelope: moved }, OTHER_KEY));
      expect(await drain()).toEqual({ status: "complete", outcome: "completed_with_failures" });
      expect(mocks.submit).not.toHaveBeenCalled();
      expect(completions()).toEqual([expect.objectContaining({ p_success: false, p_outcome_code: "provider_or_payload_error" })]);
    }
  });

  it("opens only for the invitation template: the same envelope in another template's row is refused", async () => {
    queue(claimed({ noteEnvelope: sealAdultInvitationNote(NOTE, KEY) }, KEY, 1, "co-parent-invitation"));
    expect(await drain()).toEqual({ status: "complete", outcome: "completed_with_failures" });
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("refuses a tampered sealed note or a swapped wrapped key, and never sends the mail without its note", async () => {
    const envelope = sealAdultInvitationNote(NOTE, KEY);
    const flipped = Buffer.from(envelope.ciphertext, "hex");
    flipped[20] ^= 1;
    for (const tampered of [{ ...envelope, ciphertext: flipped.toString("hex") },
      { ...envelope, wrappedKey: sealAdultInvitationNote(NOTE, KEY).wrappedKey }]) {
      vi.clearAllMocks();
      queue(claimed({ noteEnvelope: tampered }));
      expect(await drain()).toEqual({ status: "complete", outcome: "completed_with_failures" });
      expect(mocks.submit).not.toHaveBeenCalled();
      expect(completions()).toEqual([expect.objectContaining({ p_success: false })]);
    }
  });

  it("fails closed when the deployment key cannot open the note, so a later attempt can", async () => {
    const envelope = sealAdultInvitationNote(NOTE, KEY);
    vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
    queue(claimed({ noteEnvelope: envelope }));
    expect(await drain()).toEqual({ status: "complete", outcome: "completed_with_failures" });
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(completions()).toEqual([expect.objectContaining({ p_success: false, p_outcome_code: "provider_or_payload_error" })]);
  });

  it.each([
    ["a plain note", { note: NOTE }],
    ["a plain note beside a sealed one", { note: NOTE, noteEnvelope: "sealed" }],
    ["a plain string where the envelope goes", { noteEnvelope: NOTE }],
    ["an envelope with its note in clear", { noteEnvelope: { version: 1, idempotencyKey: KEY, wrappedKey: "ab".repeat(72),
      ciphertext: Buffer.from(NOTE).toString("hex"), note: NOTE } }],
    ["a note on Path B's request", { request: "esignature", noteEnvelope: "sealed" }],
  ])("refuses %s: it is never rendered, and the mail is never sent without it", async (_case, payload) => {
    const sealed = sealAdultInvitationNote(NOTE, KEY);
    const resolved = JSON.parse(JSON.stringify(payload).replaceAll("\"sealed\"", JSON.stringify(sealed)));
    queue(claimed(resolved));
    expect(await drain()).toEqual({ status: "complete", outcome: "completed_with_failures" });
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(completions()).toEqual([expect.objectContaining({ p_success: false, p_outcome_code: "provider_or_payload_error" })]);
  });

  it("sends an invitation without a note exactly as before", async () => {
    queue(claimed({}));
    expect(await drain()).toEqual({ status: "complete", outcome: "completed" });
    expect(mocks.submit.mock.calls[0]![1]).toEqual({ id: "adult-subject-invitation",
      payload: { invitationUrl: `http://localhost:3000/withdraw/request#${TOKEN}`, note: undefined, request: undefined } });
  });
});
