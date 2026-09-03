import { NextResponse } from "next/server";
import { z } from "zod";
import { isSameOrigin } from "@/lib/account-deletion";
import { DIRECTIONAL_PURPOSES } from "@/lib/family/graph";
import {
  SHARE_WITH_ADULT_ARTIFACT,
  SHARE_WITH_ADULT_STATEMENT_KEYS,
  readGrantPresentation,
} from "@/lib/family/grant-token";
import { LLM_DATA_CLASSES, providerKeyFor } from "@/lib/llm";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * `POST /api/consents` (register api.consents).
 *
 * Two closed bodies:
 *   - the cloud-model provider consent this route has always served;
 *   - `grant-purpose`, one directional purpose grant between two adults
 *     (policyContracts.directional-purpose-grant-v1).
 *
 * The grant body carries the opaque presentation token the permissions
 * column minted and nothing else that could retarget it: the signer, data
 * subject, recipient principal, purpose, artifact and revisions are
 * recomputed from the verified token, never copied from the request, and the
 * declared fields must agree with it or the request is refused with no
 * grant side effect. Only the token's nonce reaches
 * `grant_directional_purpose_v1`, which records its digest before any write,
 * so a second presentation of the same token fails closed.
 */

const PURPOSE_VALUES = DIRECTIONAL_PURPOSES.filter(
  (purpose) => purpose !== "raw.export",
) as unknown as [string, ...string[]];

const cloudModelBody = z.object({ providerKey: z.string().trim().min(1).max(255) }).strict();

const grantPurposeBody = z
  .object({
    action: z.literal("grant-purpose"),
    subjectId: z.uuid(),
    purposeKey: z.enum([...PURPOSE_VALUES, "raw.export"]),
    artifactVersion: z.number().int().positive(),
    artifactPresentationToken: z.string().min(16).max(8192),
    affirmed: z.literal(true),
    statementKeys: z.array(z.string().min(1).max(64)).min(1).max(16),
  })
  .strict();

function notFound() {
  return new Response("Not found", { status: 404 });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const payload: unknown = await request.json().catch(() => null);

  const grant = grantPurposeBody.safeParse(payload);
  if (grant.success) {
    if (!isSameOrigin(request)) {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }
    return grantPurpose(user.id, grant.data);
  }

  const cloud = cloudModelBody.safeParse(payload);
  if (!cloud.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const { data: settings } = await supabase
    .from("llm_settings")
    .select("provider, base_url")
    .maybeSingle();
  if (!settings) return NextResponse.json({ error: "provider_unavailable" }, { status: 409 });
  const currentKey = providerKeyFor(
    settings.provider as "anthropic" | "openai_compatible",
    settings.base_url,
  );
  if (cloud.data.providerKey !== currentKey) {
    return NextResponse.json({ error: "provider_changed" }, { status: 409 });
  }

  const { data: grantId, error } = await createAdminClient().rpc(
    "grant_cloud_model_consent",
    {
      p_account_id: user.id,
      p_provider_key: currentKey,
      p_data_classes: [...LLM_DATA_CLASSES],
    },
  );
  if (error || !grantId) {
    return NextResponse.json({ error: "consent_unavailable" }, { status: 503 });
  }
  return NextResponse.json({ grantId });
}

async function grantPurpose(
  accountId: string,
  body: z.infer<typeof grantPurposeBody>,
): Promise<Response> {
  const claims = readGrantPresentation(body.artifactPresentationToken);
  // A stale, foreign, cross-direction or mismatched token is answered like an
  // unknown resource, with zero grant side effect.
  if (!claims || claims.accountId !== accountId) return notFound();
  if (
    claims.dataSubjectId !== body.subjectId ||
    claims.purpose !== body.purposeKey ||
    claims.artifactVersion !== body.artifactVersion ||
    claims.artifactKey !== SHARE_WITH_ADULT_ARTIFACT
  ) {
    return notFound();
  }
  const published = [...SHARE_WITH_ADULT_STATEMENT_KEYS];
  if (
    body.statementKeys.length !== published.length ||
    body.statementKeys.some((key, index) => key !== published[index])
  ) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const admin = createAdminClient();
  // The artifact must still be the committed current one at the version the
  // token was minted against; a superseded artifact cannot be signed.
  const { data: artifact } = await admin
    .from("consent_artifacts")
    .select("artifact_key, version, body_sha256")
    .eq("artifact_key", claims.artifactKey)
    .eq("version", claims.artifactVersion)
    .is("superseded_at", null)
    .maybeSingle();
  if (!artifact || artifact.body_sha256 !== claims.artifactBodySha256) {
    return NextResponse.json({ error: "consent_artifact_changed" }, { status: 409 });
  }

  const { data: grantId, error } = await admin.rpc("grant_directional_purpose_v1", {
    p_account_id: accountId,
    p_data_subject_id: claims.dataSubjectId,
    p_recipient_principal_id: claims.recipientPrincipalId,
    p_purpose: claims.purpose,
    p_artifact_key: claims.artifactKey,
    p_artifact_version: claims.artifactVersion,
    p_token_nonce: claims.nonce,
  });
  if (error || !grantId) {
    return NextResponse.json({ error: "consent_unavailable" }, { status: 409 });
  }

  return NextResponse.json(
    {
      recordKind: "purpose_grant",
      recordId: grantId,
      artifactKey: artifact.artifact_key,
      artifactVersion: artifact.version,
      purposeKey: claims.purpose,
      signedAt: new Date().toISOString(),
    },
    { status: 201, headers: { "Cache-Control": "private, no-store" } },
  );
}
