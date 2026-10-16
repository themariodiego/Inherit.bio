import { z } from "zod";
import { getSensitiveAccountContext } from "@/lib/account-deletion";
import { invalidRequest, notFound, sensitiveJson, unavailable } from "@/lib/embryos/api";
import { closedResponse, originDenied, readJson, unauthorized } from "@/lib/embryos/guards";
import { permits, personCapability } from "@/lib/family/access";
import { resolveFamilyPerson } from "@/lib/family/graph";
import { isCanonicalSubjectId, isJsonRequest } from "@/lib/subject-endpoints/request";
import { SUBJECT_OPERATION_NONCE_MAX_LENGTH, verifySubjectOperationNonce } from "@/lib/subject-endpoints/operation-nonce";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * `POST /api/subjects/[id]/sharing` (register api.subject-sharing;
 * lifecycleDispositionContracts.family-sharing-state-v1). The owner's
 * decision of 2026-10-16 ("The subjects endpoints (G2.1)") makes it the
 * UUID-addressed twin of `api.family-sharing`:
 *
 *   - The route subject is a Family handle: it resolves through the Family
 *     graph to exactly one person, the same resolution `/family/s-{uuid}`
 *     uses. Anything else (an unknown, foreign, minor or own record) is the
 *     same opaque 404, decided before the body is read.
 *   - The three operations run the three existing sharing functions over the
 *     counterpart account the subject resolves to, which is never a request
 *     field. Pause and stop are rights and bypass the jurisdiction gate;
 *     resume rechecks it first (purpose-to-capability-v1).
 *   - Stop takes the single-use stop code the Family permissions page issues
 *     for this route and this subject. The database records its hash in the
 *     same transaction as the stop, so a replay changes nothing.
 */

const body = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("pause") }).strict(),
  z.object({ operation: z.literal("resume") }).strict(),
  z.object({ operation: z.literal("stop"), nonce: z.string().min(1).max(SUBJECT_OPERATION_NONCE_MAX_LENGTH) }).strict(),
]);

const SHARING_KEYS = ["state", "effectiveAt"] as const;
const STOP_KEYS = ["state", "effectiveAt", "deletedResultCount"] as const;

type RpcError = { code?: string } | null;

/** The register's bindings for this route have no conflict status: a missing pair or pause is a target the caller cannot act on. */
function rpcFailure(error: RpcError): Response {
  switch (error?.code) {
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

function deletedTotal(counts: unknown): number {
  if (!counts || typeof counts !== "object") return 0;
  return Object.values(counts as Record<string, unknown>).reduce<number>(
    (total, value) => total + (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0),
    0,
  );
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!isCanonicalSubjectId(id)) return notFound();
  const account = await getSensitiveAccountContext();
  if (!account) return unauthorized();
  const forbidden = originDenied(request);
  if (forbidden) return forbidden;

  const person = await resolveFamilyPerson(account.user.id, `s-${id}`);
  // An unknown record, a minor and someone else's person give the same
  // answer, so nothing signals that a record exists.
  if (!person || person.handle.id !== id) return notFound();

  if (!isJsonRequest(request)) return invalidRequest(["content-type"]);
  const parsed = body.safeParse(await readJson(request));
  if (!parsed.success) return invalidRequest(["body"]);

  const admin = createAdminClient();
  const pair = { p_account_id: account.user.id, p_counterpart_account_id: person.counterpartAccountId };

  if (parsed.data.operation === "stop") {
    const nonce = verifySubjectOperationNonce(parsed.data.nonce, {
      accountId: account.user.id,
      sessionId: account.sessionId,
      operation: "subject_sharing_stop",
      subjectId: id,
    });
    if (!nonce) return invalidRequest(["nonce"]);
    const { data, error } = await admin.rpc("stop_subject_sharing_v1", {
      ...pair,
      p_session_id: account.sessionId,
      p_subject_id: id,
      p_nonce_hash: nonce.nonceHash,
      p_nonce_expires_at: new Date(nonce.expiresAt).toISOString(),
    });
    const row = Array.isArray(data) ? data[0] : null;
    if (error || !row) return rpcFailure(error);
    const endedAt = new Date(row.ended_at);
    if (Number.isNaN(endedAt.getTime())) return unavailable();
    return closedResponse("api.subject-sharing", STOP_KEYS, {
      state: "sharing_ended",
      effectiveAt: endedAt.toISOString(),
      deletedResultCount: deletedTotal(row.deleted_counts),
    }, 200);
  }

  if (parsed.data.operation === "resume") {
    const decision = await personCapability(account.user.id, person, "third_party_adult_analysis");
    if (!permits(decision)) {
      return sensitiveJson({ error: "jurisdiction_unavailable", message: decision.userFacingCopy }, 403);
    }
    const { error } = await admin.rpc("resume_family_sharing_v1", pair);
    if (error) return rpcFailure(error);
    return closedResponse("api.subject-sharing", SHARING_KEYS,
      { state: "sharing_active", effectiveAt: new Date().toISOString() }, 200);
  }

  const { error } = await admin.rpc("pause_family_sharing_v1", pair);
  if (error) return rpcFailure(error);
  return closedResponse("api.subject-sharing", SHARING_KEYS,
    { state: "sharing_paused", effectiveAt: new Date().toISOString() }, 200);
}
