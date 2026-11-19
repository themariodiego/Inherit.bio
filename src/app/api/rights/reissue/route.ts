import { afterFloor, authInvalidRequest, authJson, authNotFound } from "@/lib/auth/auth-response";
import { readAuthForm } from "@/lib/auth/auth-form";
import { parseAuthBody, readBoundedJson } from "@/lib/auth/auth-request";
import { contactDigestSet } from "@/lib/hmac-keyring";
import { isTestJurisdictionEnabled } from "@/lib/legal/jurisdictions";
import { networkBucketDigests, RIGHTS_REISSUE_OPERATION, rightsReissueLimitDigests } from "@/lib/rate-limit-keys";
import { rightsReissueOpen } from "@/lib/rights/reissue-gate";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * `POST /api/rights/reissue` (register api.rights-reissue;
 * rights-credential-reissue-v1). A person with no account who lost the link
 * to their rights page asks for a new one by email address.
 *
 * CLOSED under the owner's 2026-10-22 rule for routes that need unapproved
 * mail or notice text: the recovery mail has no approved wording, so every
 * request answers resource-not-found-v1, TEST-LOCAL included, and nothing is
 * read, counted or written (`rightsReissueOpen`).
 *
 * Behind the door the route is ready. It checks the required signals: exact
 * origin, same-origin fetch metadata, JSON, and `X-Inherit-CSRF` carrying a
 * one-time public form token bound to the host-only form cookie. It then
 * reads the closed body `{email}`, normalized and at most 254 bytes. A
 * missing signal or a bad body is invalid-request-v1. The database counts 3
 * an hour per contact, 10 an hour per network and 1000 an hour for the
 * service before anything else, spends the form nonce, matches only
 * principals whose account_id is null, and writes at most one hash-only
 * candidate per principal (`request_rights_reissue_v1`). It enqueues no mail.
 * Match, no match, limited and failure all get opaque-public-acceptance-v1,
 * 202 `{"status":"received"}`, no sooner than the same floor.
 */

const RECEIVED = { status: "received" } as const;

export async function POST(request: Request) {
  if (!rightsReissueOpen()) return authNotFound();
  const startedAt = performance.now();
  if (!isTestJurisdictionEnabled()) return authNotFound();
  const form = readAuthForm(request, "rights-reissue");
  if (!form) return authInvalidRequest(["csrf"]);
  const json = await readBoundedJson(request);
  if (json === null) return authInvalidRequest(["body"]);
  const parsed = parseAuthBody(json, ["email"] as const);
  if (!parsed.ok) return authInvalidRequest(parsed.issues);
  const email = parsed.value.email;
  const limits = rightsReissueLimitDigests(email);
  try {
    const { data } = await createAdminClient().rpc("request_rights_reissue_v1", {
      p_form_nonce_hash: form.nonceHash,
      p_contact_digests: contactDigestSet(email),
      p_identifier_digests: limits.identifier,
      p_network_digests: networkBucketDigests(RIGHTS_REISSUE_OPERATION, request.headers),
      p_global_digests: limits.global,
      p_test_jurisdiction: true,
    });
    if (data === "replayed") return authInvalidRequest(["csrf"]);
  } catch {
    // Identical to every other outcome.
  }
  await afterFloor(startedAt);
  return authJson(RECEIVED, 202);
}
