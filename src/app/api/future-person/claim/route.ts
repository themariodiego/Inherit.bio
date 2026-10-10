import { closedResponse } from "@/lib/embryos/guards";
import { invalidRequest, notFound, sensitiveJson, unavailable } from "@/lib/embryos/api";
import { claimIntakeBody, claimIntakeIssues, sealClaimIntake } from "@/lib/future-person/claim-intake";
import { futurePersonClaimsOpen } from "@/lib/future-person/claims-open";
import { newClaimSession, readClaimForm, sha256Hex } from "@/lib/future-person/claim-session";
import { CLAIM_START_OPERATION, claimIdentifierDigests, networkBucketDigests } from "@/lib/rate-limit-keys";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * `POST /api/future-person/claim` (register api.future-person-claim), the
 * public start of a Future Person claim. No account, no jurisdiction.
 *
 * Every valid Record Key, Recovery Key and keyless request gets the same
 * answer and the same kind of cookie: 202 `{"status":"received"}` and a new
 * claim session (future-person-claim-acceptance-v1). Nothing on this path
 * looks for a record, a prior claimant or a candidate, so the answer cannot
 * depend on one; that lookup belongs to the named human review that follows.
 *
 * Limits are counted in the database before anything else is decided
 * (abuseControls). A refused start is the one shared 429 with no cookie and
 * no write but its counters (public-capacity-limited-v1). A request without
 * the served form, from another origin or with a stale token is the opaque
 * 404; a malformed body is invalid-request-v1 naming fields, never values.
 */

const RECEIVED_KEYS = ["status"] as const;
const BODY_LIMIT = 8 * 1024;
/** One coarse value for every limit and every mode (public-capacity-limited-v1). */
const RETRY_AFTER_SECONDS = "900";

/** At most 8 KiB of well-formed UTF-8 JSON, or null. */
async function readBoundedJson(request: Request): Promise<unknown> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let text = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > BODY_LIMIT) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } catch {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Every answer on this path is private and sends no referrer onward. */
function withoutReferrer(response: Response): Response {
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

function capacityLimited(): Response {
  return withoutReferrer(sensitiveJson({ error: "try_again_later" }, 429, { "Retry-After": RETRY_AFTER_SECONDS }));
}

export async function POST(request: Request) {
  return withoutReferrer(await start(request));
}

async function start(request: Request): Promise<Response> {
  if (!futurePersonClaimsOpen()) return notFound();
  const form = readClaimForm(request);
  if (!form) return notFound();

  const json = await readBoundedJson(request);
  if (json === null) return invalidRequest(["body"]);
  const parsed = claimIntakeBody().safeParse(json);
  if (!parsed.success) return invalidRequest(claimIntakeIssues(parsed.error));

  const intake = sealClaimIntake(parsed.data);
  const session = newClaimSession();
  const { data, error } = await createAdminClient().rpc("start_future_person_claim_v1", {
    p_session_hash: session.sessionHash,
    p_form_nonce_hash: sha256Hex(form.nonce),
    p_mode: intake.mode,
    p_key_hash: intake.keyHash,
    p_identity_ciphertext: `\\x${intake.identityCiphertext.toString("hex")}`,
    p_wrapped_data_key: `\\x${intake.wrappedDataKey.toString("hex")}`,
    p_identifier_digests: claimIdentifierDigests(intake.mode, intake.identifier),
    p_network_digests: networkBucketDigests(CLAIM_START_OPERATION, request.headers),
  });
  // A replayed form was already answered; it earns no second session.
  if (error?.code === "23505") return notFound();
  if (error) return unavailable();
  if (data === "capacity_limited") return capacityLimited();
  if (data !== "received") return unavailable();

  const response = await closedResponse("api.future-person-claim", RECEIVED_KEYS, { status: "received" }, 202);
  // A blocked (500) shape carries no credential.
  if (response.status === 202) {
    for (const setCookie of session.setCookies) response.headers.append("Set-Cookie", setCookie);
  }
  return response;
}
