import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { authIdentifierDigests, networkBucketDigests, type AuthLimitedOperation } from "@/lib/rate-limit-keys";
import { readAuthForm, type AuthForm } from "./auth-form";
import { parseAuthBody, readBoundedJson, type AuthField } from "./auth-request";
import { authInvalidRequest } from "./auth-response";

/**
 * The shared front half of `POST /api/auth/sign-up` and
 * `POST /api/auth/forgot-password`, in the registered order:
 *
 * 1. Required signals: exact origin, same-origin fetch metadata, JSON and a
 *    fresh form token bound to this browser's form cookie. Anything missing
 *    is invalid-request-v1 `csrf`, before the body is read.
 * 2. The closed body, bounded to 8 KiB: invalid-request-v1 naming fields.
 * 3. The database counts the email and network buckets first, then spends
 *    the form nonce (`private.admit_auth_public_request_v1`). A spent nonce
 *    is a stale page, `csrf` again. A limited request, and one the database
 *    could not count, goes no further than the caller's identical answer.
 */

export type PublicAuthAdmission<F extends AuthField> =
  | { kind: "refused"; response: Response }
  | { kind: "admitted"; value: Record<F, string> }
  | { kind: "withheld" };

export async function admitPublicAuthRequest<F extends AuthField>(
  request: Request,
  form: AuthForm,
  operation: AuthLimitedOperation,
  fields: readonly F[],
): Promise<PublicAuthAdmission<F>> {
  const formNonce = readAuthForm(request, form);
  if (!formNonce) return { kind: "refused", response: authInvalidRequest(["csrf"]) };
  const json = await readBoundedJson(request);
  if (json === null) return { kind: "refused", response: authInvalidRequest(["body"]) };
  const parsed = parseAuthBody(json, fields);
  if (!parsed.ok) return { kind: "refused", response: authInvalidRequest(parsed.issues) };

  const email = (parsed.value as Partial<Record<AuthField, string>>).email;
  if (email === undefined) return { kind: "withheld" };
  try {
    const { data, error } = await createAdminClient().rpc("admit_auth_public_request_v1", {
      p_route_id: operation,
      p_form_nonce_hash: formNonce.nonceHash,
      p_identifier_digests: authIdentifierDigests(operation, email),
      p_network_digests: networkBucketDigests(operation, request.headers),
    });
    if (error) return { kind: "withheld" };
    if (data === "replayed") return { kind: "refused", response: authInvalidRequest(["csrf"]) };
    if (data === "admitted") return { kind: "admitted", value: parsed.value };
    return { kind: "withheld" };
  } catch {
    return { kind: "withheld" };
  }
}
