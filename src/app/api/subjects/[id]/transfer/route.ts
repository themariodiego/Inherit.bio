import { z } from "zod";
import { getSensitiveAccountContext } from "@/lib/account-deletion";
import { invalidRequest, notFound, unavailable } from "@/lib/embryos/api";
import { closedResponse, originDenied, readJson, unauthorized } from "@/lib/embryos/guards";
import { SUBJECT_OPERATION_NONCE_MAX_LENGTH, verifySubjectOperationNonce } from "@/lib/subject-endpoints/operation-nonce";
import { isCanonicalSubjectId, isJsonRequest } from "@/lib/subject-endpoints/request";
import { createAdminClient } from "@/lib/supabase/admin";
import { withAccountCsrf } from "@/lib/security/session-csrf";

/**
 * `POST /api/subjects/[id]/transfer` (register api.subject-transfer;
 * lifecycleDispositionContracts.subject-ownership-transfer-v1). Owner
 * decisions of 2026-10-16 ("The subjects endpoints (G2.1)" and "Subjects
 * delete and transfer: four further cases"): a Path B record bound to the
 * person's own account becomes theirs. It stays a separate other-adult
 * record. Each confirmed file is detached into a person-owned file and
 * relocated by the subject-object-relocation worker, the person's existing
 * results stay readable under their own grants, and the uploader loses all
 * access. A record with a file still pending is not found.
 *
 * Built closed under the 2026-10-22 rule for wording nobody has approved:
 * the contract's three notices have no approved text, so the database door
 * answers not found and writes nothing until they do. This route is the
 * complete request contract in front of that door.
 *
 * The body is exactly `{"nonce": "..."}`: the one-time code the
 * confirmation page renders for this route and this subject. Its hash is
 * recorded in the transfer's own transaction, so a replay changes nothing.
 * The record is checked before the body (invalid-request-v1's
 * authorizationPrecedence), so an unknown or foreign record is the same
 * opaque 404 whatever the body holds.
 */

const body = z.object({ nonce: z.string().min(1).max(SUBJECT_OPERATION_NONCE_MAX_LENGTH) }).strict();

const transferred = z.object({
  status: z.literal("transferred"),
  subjectId: z.uuid(),
  effectiveAt: z.string().refine(value => !Number.isNaN(Date.parse(value))),
  relocations: z.number().int().nonnegative(),
}).strict();

const TRANSFER_KEYS = ["status", "subjectId", "effectiveAt"] as const;

export const POST = withAccountCsrf("api.subject-transfer", handlePost);
async function handlePost(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!isCanonicalSubjectId(id)) return notFound();
  const account = await getSensitiveAccountContext();
  if (!account) return unauthorized();
  const forbidden = originDenied(request);
  if (forbidden) return forbidden;

  const admin = createAdminClient();
  // Only the record's own person account can ever transfer it. Anything
  // else is not found before the body is read; the door rechecks it all.
  const target = await admin.from("subjects").select("id").eq("id", id).eq("subject_account_id", account.user.id)
    .eq("subject_class", "other_adult").eq("lifecycle", "active").maybeSingle();
  if (target.error) return unavailable();
  if (!target.data) return notFound();

  if (!isJsonRequest(request)) return invalidRequest(["content-type"]);
  const parsed = body.safeParse(await readJson(request));
  if (!parsed.success) return invalidRequest(["body"]);
  const nonce = verifySubjectOperationNonce(parsed.data.nonce, {
    accountId: account.user.id,
    sessionId: account.sessionId,
    operation: "subject_transfer",
    subjectId: id,
  });
  if (!nonce) return invalidRequest(["nonce"]);

  const { data, error } = await admin.rpc("transfer_subject_v1", {
    p_account_id: account.user.id,
    p_session_id: account.sessionId,
    p_subject_id: id,
    p_nonce_hash: nonce.nonceHash,
    p_nonce_expires_at: new Date(nonce.expiresAt).toISOString(),
  });
  if (error) {
    switch (error.code) {
      case "42501":
      case "55000":
        return notFound();
      case "22023":
      case "23505":
        return invalidRequest(["nonce"]);
      default:
        return unavailable();
    }
  }
  const result = transferred.safeParse(data);
  if (!result.success || result.data.subjectId !== id) return unavailable();
  return closedResponse("api.subject-transfer", TRANSFER_KEYS, {
    status: "transferred",
    subjectId: result.data.subjectId,
    effectiveAt: new Date(result.data.effectiveAt).toISOString(),
  }, 200);
}
