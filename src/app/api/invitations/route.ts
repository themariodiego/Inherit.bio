import { getSensitiveAccountContext } from "@/lib/account-deletion";
import { hmacSecret } from "@/lib/crypto";
import { invalidRequest, unavailable } from "@/lib/embryos/api";
import {
  closedResponse,
  csrfOperation,
  jurisdictionDenied,
  originDenied,
  readJson,
  requestForbidden,
  unauthorized,
} from "@/lib/embryos/guards";
import { coParentInvitationBody } from "@/lib/embryos/routes";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * `POST /api/invitations` (register api.invitations; contract §6.3), the
 * co-parent body only: the adult bodies stay on `/api/subject-drafts`. The
 * typed address is normalised and keyed here; the RPC matches the key
 * against the one unfilled parent slot of the owner's draft and mails it.
 * A mismatch, a filled slot, a live refusal bar, a foreign draft or a
 * missing uploader artifact all return the same receipt in the same shape
 * with no write, so the response never says which addresses a draft names.
 * The RPC is idempotent on the outbox key derived below, so a repeat of the
 * same request re-sends nothing.
 */
export async function POST(request: Request) {
  const context = await getSensitiveAccountContext();
  if (!context) return unauthorized();
  const forbidden = originDenied(request);
  if (forbidden) return forbidden;
  const denied = jurisdictionDenied();
  if (denied) return denied;

  const parsed = coParentInvitationBody.safeParse(await readJson(request));
  if (!parsed.success) return invalidRequest(["body"]);

  const claims = csrfOperation(request, {
    accountId: context.user.id,
    sessionId: context.sessionId,
    operation: "invitation_create",
    targetKind: "cohort_draft",
    targetId: parsed.data.targetCohortDraftId,
  });
  if (!claims) return requestForbidden();

  const contactHmac = hmacSecret(parsed.data.contactEmail, "contact-email-v1");
  const idempotencyKey = hmacSecret(
    JSON.stringify(["co-parent-invitation-v1", context.user.id, parsed.data.targetCohortDraftId, contactHmac]),
    "mail-idempotency-v1",
  );
  const { error } = await createAdminClient().rpc("create_embryo_draft_invitation_v1", {
    p_account_id: context.user.id,
    p_draft_id: parsed.data.targetCohortDraftId,
    p_contact_hmac: contactHmac,
    p_idempotency_key: idempotencyKey,
    p_test_jurisdiction: true,
  });
  // An unreadable draft or a malformed key is the same opaque receipt; only
  // a database that could not record the invitation is reported.
  if (error && error.code !== "42501" && error.code !== "22023") return unavailable();

  return closedResponse("api.invitations", ["status"], { status: "received" }, 202);
}
