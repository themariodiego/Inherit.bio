import { NextResponse } from "next/server";
import { z } from "zod";
import { getSensitiveAccountContext, hashOperationNonce, isSameOrigin } from "@/lib/account-deletion";
import { permits, personCapability } from "@/lib/family/access";
import { resolveFamilyPerson } from "@/lib/family/graph";
import { readSharingOperation } from "@/lib/family/grant-token";
import {
  PERSON_OPERATION_NONCE_MAX_LENGTH,
  personOperationNonceArgs,
  verifyPersonOperationNonce,
} from "@/lib/person-operation-nonce";
import { createAdminClient } from "@/lib/supabase/admin";
import { withAccountCsrf } from "@/lib/security/session-csrf";

/**
 * `POST /api/family/[person]/sharing` (register api.family-sharing;
 * lifecycleDispositionContracts.family-sharing-state-v1).
 *
 * One operation per call, over the counterpart the route segment resolves
 * to through the Family graph. The counterpart account is server-resolved
 * and never a request field, so no body can retarget the operation.
 *
 *   - `pause` writes one current pause row. No grant row changes; the
 *     authorisation predicate denies every scoped grant and pair on the next
 *     check, so every derived surface is dark on the next request. It is a
 *     right, and bypasses the jurisdiction gate.
 *   - `resume` ends the pause. It is guarded, because resuming makes results
 *     visible again (register guardedActions.resume).
 *   - `stop` is the one destructive operation: it revokes every grant both
 *     ways, deletes the joint outputs and the chat context, revokes the
 *     pairs, writes the tombstone both accounts read and enqueues the
 *     purpose.derived-60s purge for each side. It carries the one-time
 *     operation nonce this session's permissions page minted for exactly
 *     this counterpart.
 *
 * Since 20261023120000 (G5.6, owner decision of 23 October 2026) every
 * operation records its one-time nonce in the database before the sharing
 * function runs, in the same transaction, so the legal audit names who acted
 * and a replay writes nothing: pause and resume carry a person operation
 * nonce minted for this route and this counterpart, and the stop's own
 * nonce is recorded too. The Family permissions page sends all three to the
 * UUID-addressed twin, api.subject-sharing, which does the same.
 */

const body = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("pause"), nonce: z.string().min(1).max(PERSON_OPERATION_NONCE_MAX_LENGTH) }).strict(),
  z.object({ operation: z.literal("resume"), nonce: z.string().min(1).max(PERSON_OPERATION_NONCE_MAX_LENGTH) }).strict(),
  z.object({ operation: z.literal("stop"), nonce: z.string().min(16).max(4096) }).strict(),
]);

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

export const POST = withAccountCsrf("api.family-sharing", handlePost);
async function handlePost(
  request: Request,
  context: { params: Promise<{ person: string }> },
) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const account = await getSensitiveAccountContext();
  if (!account) return new Response("Unauthorized", { status: 401 });
  const user = account.user;

  const { person: segment } = await context.params;
  const person = await resolveFamilyPerson(user.id, segment);
  // An unknown segment, a minor and someone else's person give the same
  // answer, so nothing signals that a record exists.
  if (!person) return new Response("Not found", { status: 404 });

  const admin = createAdminClient();

  if (parsed.data.operation === "stop") {
    const operation = readSharingOperation(parsed.data.nonce);
    if (
      !operation ||
      operation.accountId !== user.id ||
      operation.counterpartAccountId !== person.counterpartAccountId
    ) {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }
    const { data, error } = await admin.rpc("stop_family_sharing_with_nonce_v1", {
      p_account_id: user.id,
      p_session_id: account.sessionId,
      p_counterpart_account_id: person.counterpartAccountId,
      p_nonce_hash: hashOperationNonce(parsed.data.nonce),
      p_nonce_expires_at: new Date(operation.expiresAt).toISOString(),
    });
    const row = data?.[0];
    if (error || !row) {
      return NextResponse.json({ error: "sharing_unavailable" }, { status: 409 });
    }
    const counts = (row.deleted_counts ?? {}) as Record<string, unknown>;
    const deletedResultCount = Object.values(counts).reduce<number>(
      (total, value) => total + (typeof value === "number" ? value : 0),
      0,
    );
    return NextResponse.json(
      {
        state: "sharing_ended",
        effectiveAt: new Date(row.ended_at).toISOString(),
        deletedResultCount,
      },
      { headers: NO_STORE },
    );
  }

  const nonce = verifyPersonOperationNonce(parsed.data.nonce, {
    accountId: user.id,
    sessionId: account.sessionId,
    operation: parsed.data.operation === "resume" ? "family_sharing_resume" : "family_sharing_pause",
    targetId: person.counterpartAccountId,
  });
  if (!nonce) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const pair = {
    p_account_id: user.id,
    p_session_id: account.sessionId,
    p_counterpart_account_id: person.counterpartAccountId,
    ...personOperationNonceArgs(nonce),
  };

  if (parsed.data.operation === "resume") {
    const decision = await personCapability(user.id, person, "third_party_adult_analysis");
    if (!permits(decision)) {
      return NextResponse.json({ error: "jurisdiction_unavailable" }, { status: 409 });
    }
    const { error } = await admin.rpc("resume_family_sharing_with_nonce_v1", pair);
    if (error) {
      return NextResponse.json({ error: "sharing_unavailable" }, { status: 409 });
    }
    return NextResponse.json(
      { state: "sharing_active", effectiveAt: new Date().toISOString() },
      { headers: NO_STORE },
    );
  }

  const { error } = await admin.rpc("pause_family_sharing_with_nonce_v1", pair);
  if (error) {
    return NextResponse.json({ error: "sharing_unavailable" }, { status: 409 });
  }
  return NextResponse.json(
    { state: "sharing_paused", effectiveAt: new Date().toISOString() },
    { headers: NO_STORE },
  );
}
