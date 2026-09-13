import { getSensitiveAccountContext } from "@/lib/account-deletion";
import { hmacSecret } from "@/lib/crypto";
import { adultSubjectResponseBody, readAdultSubjectResponse } from "@/lib/embryos/adult-subject-review";
import { notFound } from "@/lib/embryos/api";
import { closedResponse } from "@/lib/embryos/guards";
import { invitationRefusalBody, readInvitationRefusal, refusalRequestAllowed } from "@/lib/embryos/invitation-refusal";
import { normalizeContact } from "@/lib/embryos/routes";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * `POST /api/withdraw/[token]` with the segment pinned to `session`
 * (register api.withdraw). Two rights holders answer here, and which one is
 * answering is decided by the form token the page served, never by a field
 * in the body: an adult-subject form token cannot drive a co-parent refusal
 * and the reverse is equally impossible.
 *
 * The registered receipt is `{status, operation}` and nothing else. An
 * invitation that has expired, been answered or was never this session's is
 * the same 404 as one that does not exist.
 */

const RECEIPT_KEYS = ["status", "operation"] as const;

/** At most 4 KiB of well-formed UTF-8 JSON, or null. */
async function readBoundedJson(request: Request): Promise<unknown> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  let size = 0;
  let text = "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 4_096) { await reader.cancel(); return null; }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } catch { return null; }
  try { return JSON.parse(text); } catch { return null; }
}

export async function POST(request: Request) {
  if (!refusalRequestAllowed(request)) return notFound();
  const json = await readBoundedJson(request);
  if (json === null) return notFound();

  const adult = adultSubjectResponseBody.safeParse(json);
  if (adult.success) {
    const authority = readAdultSubjectResponse(request, adult.data.nonce);
    if (authority) return answerAdultSubject(authority, adult.data.operation);
  }

  const body = invitationRefusalBody.safeParse(json);
  if (!body.success) return notFound();
  const authority = readInvitationRefusal(request, body.data.nonce);
  if (!authority) return notFound();
  const { error } = await createAdminClient().rpc("refuse_co_parent_invitation_session_v1", {
    p_session_hash: authority.sessionHash, p_nonce: authority.nonce,
  });
  if (error) return notFound();
  return closedResponse("api.withdraw", RECEIPT_KEYS,
    { status: "accepted", operation: "refuse" }, 202);
}

/**
 * Refusing and deleting need no account. Accepting binds the reserved
 * subject to one, so the account is read here and its address is passed as
 * an HMAC; the RPC compares it with the invited address again and refuses
 * every mismatch itself.
 */
async function answerAdultSubject(
  authority: { sessionHash: string; nonce: string },
  operation: "confirm" | "refuse" | "delete",
) {
  let accountId: string | null = null;
  let accountEmailHmac: string | null = null;
  if (operation === "confirm") {
    const context = await getSensitiveAccountContext();
    const email = context?.user.email;
    if (!context || !email || !context.user.email_confirmed_at) return notFound();
    accountId = context.user.id;
    accountEmailHmac = hmacSecret(normalizeContact(email), "contact-email-v1");
  }

  const { data, error } = await createAdminClient().rpc(
    "respond_adult_subject_invitation_session_v1",
    {
      p_session_hash: authority.sessionHash,
      p_action: operation,
      p_nonce: authority.nonce,
      ...(accountId && accountEmailHmac
        ? { p_account_id: accountId, p_account_email_hmac: accountEmailHmac }
        : {}),
    },
  );
  const expected = operation === "confirm" ? "accepted"
    : operation === "refuse" ? "refused" : "deleted";
  if (error || data !== expected) return notFound();
  return closedResponse("api.withdraw", RECEIPT_KEYS,
    { status: "accepted", operation }, 202);
}
