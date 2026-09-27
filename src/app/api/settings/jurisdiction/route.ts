import { getSensitiveAccountContext, isSameOrigin } from "@/lib/account-deletion";
import { invalidRequest, notFound, sensitiveJson } from "@/lib/embryos/api";
import { isTestJurisdictionEnabled } from "@/lib/legal/jurisdictions";
import {
  declarableCode,
  declarableSubdivision,
  declarationResult,
  isHostedDeployment,
  jurisdictionWriteBody,
  readDeclaredJurisdiction,
} from "@/lib/legal/jurisdiction-declaration";
import { declarationRestriction, isPausedCountry } from "@/lib/legal/service-restrictions";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * `PUT /api/settings/jurisdiction` (register api.jurisdiction, G5.1a): the
 * one route that declares where the signed-in person lives.
 *
 * The code is the person's own choice from the catalogue, validated here
 * against `data/jurisdictions.json` and again by the database. A country with
 * committed states (today only the United States) also needs one of them; any
 * other country takes none (ADR 0032, 27 Sep 2026). Nothing about the request
 * (address, headers, locale) is consulted. The body is the register's closed
 * shape: the code, the state where one is asked, the attestation version and
 * hash the page showed, and `affirmed: true`. `declare_jurisdiction_v2` stores
 * the declaration with that attestation, appends one legal-audit event and
 * ends every restricted permission that bound the old answer, in one
 * transaction.
 *
 * Two kinds of country are held back (`service-restrictions.ts`): one under a
 * comprehensive US embargo is never recorded, and on the hosted deployment
 * one paused for new sign-ups is recorded only for an account that already
 * declared it. Both are refused like an unknown code; the page does not
 * offer them.
 *
 * The response is `jurisdiction-write-v1` and nothing else: no revoked count,
 * no account id. A stale or unknown attestation is `invalid-request-v1`, like
 * any other invalid field, so a caller learns nothing about which part failed.
 */
export async function PUT(request: Request) {
  if (!isSameOrigin(request)) return invalidRequest(["origin"]);
  const context = await getSensitiveAccountContext();
  if (!context) return new Response("Unauthorized", { status: 401 });

  const parsed = jurisdictionWriteBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalidRequest(["body"]);
  const code = declarableCode(parsed.data.code);
  if (!code) return invalidRequest(["code"]);
  const state = declarableSubdivision(code, parsed.data.subdivision);
  if (state === "invalid") return invalidRequest(["subdivision"]);
  // Only a paused code on the hosted deployment needs the current answer;
  // everything else is decided by the code alone, without a read.
  const pausesApply = isHostedDeployment();
  const current = pausesApply && isPausedCountry(code)
    ? await readDeclaredJurisdiction(context.user.id).catch(() => undefined)
    : null;
  if (current === undefined) return notFound();
  if (declarationRestriction(code, current, pausesApply)) return invalidRequest(["code"]);

  const { data, error } = await createAdminClient().rpc("declare_jurisdiction_v2", {
    p_account_id: context.user.id,
    p_session_id: context.sessionId,
    p_code: code,
    p_subdivision: state.subdivision,
    p_attestation_version: parsed.data.attestationVersion,
    p_attestation_sha256: parsed.data.attestationHash,
    p_test_jurisdiction: isTestJurisdictionEnabled(),
  });
  if (error) return error.code === "22023" ? invalidRequest(["attestation"]) : notFound();
  const result = declarationResult.safeParse(data);
  if (!result.success || result.data.jurisdiction !== code || result.data.subdivision !== state.subdivision) {
    return notFound();
  }
  return sensitiveJson({ status: "updated", jurisdiction: code, capabilityReevaluation: "complete" });
}
