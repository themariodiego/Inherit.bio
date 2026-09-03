import { NextResponse } from "next/server";
import { z } from "zod";
import { isSameOrigin } from "@/lib/account-deletion";
import { permits, personCapability } from "@/lib/family/access";
import { resolveFamilyPerson } from "@/lib/family/graph";
import { readSharingOperation } from "@/lib/family/grant-token";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

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
 */

const body = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("pause") }).strict(),
  z.object({ operation: z.literal("resume") }).strict(),
  z.object({ operation: z.literal("stop"), nonce: z.string().min(16).max(4096) }).strict(),
]);

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

export async function POST(
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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

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
    const { data, error } = await admin.rpc("stop_family_sharing_v1", {
      p_account_id: user.id,
      p_counterpart_account_id: person.counterpartAccountId,
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

  if (parsed.data.operation === "resume") {
    const decision = await personCapability(user.id, person, "third_party_adult_analysis");
    if (!permits(decision)) {
      return NextResponse.json({ error: "jurisdiction_unavailable" }, { status: 409 });
    }
    const { error } = await admin.rpc("resume_family_sharing_v1", {
      p_account_id: user.id,
      p_counterpart_account_id: person.counterpartAccountId,
    });
    if (error) {
      return NextResponse.json({ error: "sharing_unavailable" }, { status: 409 });
    }
    return NextResponse.json(
      { state: "sharing_active", effectiveAt: new Date().toISOString() },
      { headers: NO_STORE },
    );
  }

  const { error } = await admin.rpc("pause_family_sharing_v1", {
    p_account_id: user.id,
    p_counterpart_account_id: person.counterpartAccountId,
  });
  if (error) {
    return NextResponse.json({ error: "sharing_unavailable" }, { status: 409 });
  }
  return NextResponse.json(
    { state: "sharing_paused", effectiveAt: new Date().toISOString() },
    { headers: NO_STORE },
  );
}
