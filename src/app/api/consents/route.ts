import { currentOwnUploadAccount } from "@/lib/uploads/own-upload-context";
import { familyCapability } from "@/lib/family/access";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isSameOrigin } from "@/lib/account-deletion";
import { DIRECTIONAL_PURPOSES } from "@/lib/family/graph";
import {
  SHARE_WITH_ADULT_ARTIFACT,
  SHARE_WITH_ADULT_STATEMENT_KEYS,
  readGrantPresentation,
} from "@/lib/family/grant-token";
import { embryoConsent } from "@/lib/embryos/consents";
import { isEmbryoConsentPayload } from "@/lib/embryos/routes";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isOwnConsentPayload } from "@/lib/uploads/own-consent";
import { isOtherAdultConsentPayload } from "@/lib/uploads/other-adult-upload";
import { otherAdultUploadConsent } from "@/lib/uploads/other-adult-consent-route";
import { ownUploadConsent } from "@/lib/uploads/own-consent-route";
import { isOwnReportConsentPayload, ownReportConsent } from "@/lib/uploads/own-report-consent-route";
import { isPathBPurposeConsentPayload, pathBPurposeConsent } from "@/lib/uploads/path-b-purpose-server";
import { isOwnCopilotConsentPayload, ownCopilotConsent } from "@/lib/copilot/own-consent";
import { requireAccountCsrf } from "@/lib/security/session-csrf";
import { unauthenticated } from "@/lib/embryos/guards";

/**
 * `POST /api/consents` (register api.consents).
 *
 * Four closed bodies:
 *   - `grant-purpose`, one directional purpose grant between two adults
 *     (policyContracts.directional-purpose-grant-v1);
 *   - `sign-artifact` with `subjectDraftId`, the uploader's Tier-2
 *     `consent.upload-other-adult` for the register's Path B ("I have their
 *     file"), answered only under TEST-LOCAL
 *     (`src/lib/uploads/other-adult-consent-route.ts`);
 *   - `sign-artifact` with `cohortDraftId` and `grant-purpose` with
 *     `cohortId`, the embryo bodies of E0 (`src/lib/embryos/consents.ts`).
 *     They are told apart by their target key before any adult body is
 *     tried, so every adult body keeps exactly the behaviour below.
 *
 * The cloud-model provider body, `{ providerKey }`, is gone (owner decision
 * of 19 November 2026, G8.5): it recorded a cloud permission without showing
 * its text, and no screen sent it. It is refused like any other body this
 * route does not register. A grant made through it is still withdrawn by
 * `api.consent-revoke`.
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
  if (!user) return unauthenticated();
  // Every body carries the page's one-time X-Inherit-CSRF token for the
  // account session, spent before the body is read (G8.5). Since 19 November
  // 2026 that includes the bodies answered by their own modules below: each
  // keeps checking its own one-time value where it travels, the presentation
  // token in the body's artifactPresentationToken (it was also sent in
  // X-Inherit-CSRF), and the embryo operation token in X-Inherit-Operation-Nonce.
  const csrf = await requireAccountCsrf(request, "api.consents");
  if (csrf instanceof Response) return csrf;
  return csrf.rotate(await consentBody(request, user.id));
}

async function consentBody(request: Request, accountId: string): Promise<Response> {
  const payload: unknown = await request.json().catch(() => null);

  if (isOwnConsentPayload(payload)) return ownUploadConsent(request, payload);
  // The Tier-2 uploader body of the register's Path B (TEST-LOCAL only).
  if (isOtherAdultConsentPayload(payload)) return otherAdultUploadConsent(request, payload);
  // Path B's reading layer (TEST-LOCAL only): one layer for the person or the
  // uploader, under a presentation only this route's page could have minted.
  if (isPathBPurposeConsentPayload(payload)) return pathBPurposeConsent(request, payload);
  if (isOwnReportConsentPayload(payload)) return ownReportConsent(request, payload);
  if (isOwnCopilotConsentPayload(payload)) return ownCopilotConsent(request, payload);
  if (isEmbryoConsentPayload(payload)) return embryoConsent(request, payload);
  return accountConsent(request, payload, accountId);
}

async function accountConsent(request: Request, payload: unknown, accountId: string): Promise<Response> {
  const grant = grantPurposeBody.safeParse(payload);
  if (grant.success) {
    if (!isSameOrigin(request)) {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }
    return grantPurpose(accountId, grant.data);
  }

  return NextResponse.json({ error: "invalid_request" }, { status: 400 });
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

  const isAncestry = claims.purpose === "ancestry";
  const isReport = claims.purpose === "reports.monogenic" || claims.purpose === "reports.polygenic";
  const isPortrait = claims.purpose === "family.portrait";
  const isHealthPicture = claims.purpose === "family.heritability";
  const endpointReceipt = isAncestry ? claims.ancestryEndpointReceipt : isHealthPicture ? claims.healthPictureEndpointReceipt : isPortrait ? claims.portraitEndpointReceipt : claims.reportEndpointReceipt;
  const actor = isAncestry || isReport || isPortrait || isHealthPicture ? await currentOwnUploadAccount() : null;
  if ((isAncestry || isReport || isPortrait || isHealthPicture) && (!endpointReceipt || !actor || actor.accountId !== accountId
    || (await familyCapability(accountId, [claims.recipientAccountId], "third_party_adult_analysis")).status !== "permitted")) {
    return NextResponse.json({ error: "consent_unavailable" }, { status: 409 });
  }
  if (isPortrait && (await familyCapability(accountId, [claims.recipientAccountId], "family_portrait")).status !== "permitted") {
    return NextResponse.json({ error: "consent_unavailable" }, { status: 409 });
  }
  if (isHealthPicture && (await familyCapability(accountId, [claims.recipientAccountId], "family_heritability")).status !== "permitted") {
    return NextResponse.json({ error: "consent_unavailable" }, { status: 409 });
  }
  // `copilot.local` to another adult is read only by the Family group
  // Copilot scope, which needs both Family capabilities for both accounts.
  // Checked before any signature, as for the other analytic purposes.
  if (claims.purpose === "copilot.local") {
    for (const capability of ["third_party_adult_analysis", "family_heritability"] as const) {
      if ((await familyCapability(accountId, [claims.recipientAccountId], capability)).status !== "permitted") {
        return NextResponse.json({ error: "consent_unavailable" }, { status: 409 });
      }
    }
  }
  const rpc = admin.rpc.bind(admin) as unknown as (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
  const { data: grantId, error } = await rpc(isAncestry ? "grant_family_ancestry_purpose_v1" : isHealthPicture ? "grant_health_picture_purpose_v1" : isPortrait ? "grant_family_portrait_purpose_v1" : isReport ? "grant_family_report_purpose_v1" : "grant_directional_purpose_v1", {
    ...(isAncestry || isReport || isPortrait || isHealthPicture ? { p_session_id: actor!.sessionId, p_recipient_account_id: claims.recipientAccountId,
      p_endpoint_receipt: endpointReceipt!, p_artifact_body_sha256: claims.artifactBodySha256 }
      : { p_artifact_key: claims.artifactKey }),
    p_account_id: accountId,
    p_data_subject_id: claims.dataSubjectId,
    p_recipient_principal_id: claims.recipientPrincipalId,
    p_purpose: claims.purpose,
    p_artifact_version: claims.artifactVersion,
    p_token_nonce: claims.nonce,
  });
  if (error || !z.uuid().safeParse(grantId).success) {
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
