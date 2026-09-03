import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * `POST /api/consents/[id]/revoke` (register api.consent-revoke).
 *
 * The consent kind is resolved from the database, never from the request:
 * the id names either a directional purpose grant or a cloud-model provider
 * grant, and exactly one case must match. A directional revocation runs
 * `revoke_directional_purpose_v1`, which terminalises the base and direction
 * rows together, deletes the exact subject-and-purpose derived rows the
 * recipient held, returns a Portrait pair to pending and enqueues the
 * purpose.derived-60s purge job. Only the account that holds the data
 * subject principal may revoke; every other actor is answered as not found.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const admin = createAdminClient();
  const [{ data: purposeGrant }, { data: cloudGrant }] = await Promise.all([
    admin.from("purpose_grants").select("grant_id").eq("grant_id", id).maybeSingle(),
    admin.from("consent_grants").select("id").eq("id", id).maybeSingle(),
  ]);
  // One id, one consent kind: an id that names both, or neither, is refused
  // rather than resolved by order.
  if (Boolean(purposeGrant) === Boolean(cloudGrant)) {
    return new Response("Not found", { status: 404 });
  }

  if (purposeGrant) {
    const { data: revokedAt, error } = await admin.rpc("revoke_directional_purpose_v1", {
      p_account_id: user.id,
      p_grant_id: id,
    });
    if (error || !revokedAt) return new Response("Not found", { status: 404 });
    return NextResponse.json(
      { revoked: true, effectiveAt: new Date(revokedAt).toISOString() },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const { data: revoked, error } = await admin.rpc("revoke_cloud_model_consent", {
    p_account_id: user.id,
    p_grant_id: id,
  });
  if (error) return NextResponse.json({ error: "consent_unavailable" }, { status: 503 });
  if (!revoked) return new Response("Not found", { status: 404 });
  return NextResponse.json({ revoked: true });
}
