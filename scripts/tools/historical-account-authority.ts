import assert from "node:assert/strict";
import { z } from "zod";
import { getSensitiveAccountContextFromClient, isSameOrigin, operationIdempotencyKey } from "../../src/lib/account-deletion";
import { ACCOUNT_OPERATION_NONCE_MAX_LENGTH, verifyAccountOperationNonce } from "../../src/lib/account-operation-nonce";
import { encryptSecret, hmacSecret } from "../../src/lib/crypto";
import { sqlLiteral } from "../claimed-provenance-historical-contract.mjs";

const uuid = z.string().regex(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u);
export const historicalAccountObservation = z.object({
  accountId: uuid,
  observation: z.object({
    method: z.literal("POST"), url: z.literal("http://127.0.0.1:3105/api/account/delete"),
    headers: z.object({ origin: z.string().nullable(), fetchSite: z.string().nullable(), contentType: z.literal("application/json") }).strict(),
    body: z.object({ confirmation: z.literal("account.delete.confirmation"), nonce: z.string().min(32).max(ACCOUNT_OPERATION_NONCE_MAX_LENGTH) }).strict(),
    outcome: z.literal("observed-aborted-before-dispatch"),
  }).strict(),
  cookies: z.array(z.object({ name: z.string().min(1).max(256), value: z.string().max(8192) }).strict()).min(1).max(50),
}).strict();

/** Actual shared SDK context plus the genuine application verifier. No caller
 * clock, decoded JWT stand-in, asserted MFA, raw SQL nonce or contact input. */
export async function verifyHistoricalAccountAuthority(
  value: unknown, client: Parameters<typeof getSensitiveAccountContextFromClient>[0] & {
    auth: Parameters<typeof getSensitiveAccountContextFromClient>[0]["auth"];
  },
) {
  const input = historicalAccountObservation.parse(value);
  const headers = new Headers({ "content-type": input.observation.headers.contentType });
  if (input.observation.headers.origin !== null) headers.set("origin", input.observation.headers.origin);
  if (input.observation.headers.fetchSite !== null) headers.set("sec-fetch-site", input.observation.headers.fetchSite);
  assert(isSameOrigin(new Request(input.observation.url, { method: input.observation.method, headers })), "Historical request unavailable");
  const context = await getSensitiveAccountContextFromClient(client);
  const claims = await client.auth.getClaims();
  assert(context?.user.email && context.user.id === input.accountId && !claims.error && claims.data
    && claims.data.claims.sub === context.user.id && claims.data.claims.role === "authenticated"
    && claims.data.claims.session_id === context.sessionId, "Historical request unavailable");
  const nonce = verifyAccountOperationNonce(input.observation.body.nonce, {
    accountId: context.user.id, sessionId: context.sessionId, operation: "account_delete",
  });
  assert(nonce, "Historical request unavailable");
  const email = context.user.email.trim().toLowerCase();
  return Object.freeze({ accountId: context.user.id, sessionId: context.sessionId, nonceHash: nonce.nonceHash,
    nonceExpiresAt: new Date(nonce.expiresAt).toISOString(), ciphertextHex: encryptSecret(email).toString("hex"),
    contactHmac: hmacSecret(email, "contact-email-v1"),
    idempotencyKey: operationIdempotencyKey("requested", context.user.id, input.observation.body.nonce) });
}

export function historicalAccountCreationSql(value: Awaited<ReturnType<typeof verifyHistoricalAccountAuthority>>) {
  assert.deepEqual(Object.keys(value).sort(), ["accountId", "sessionId", "nonceHash", "nonceExpiresAt", "ciphertextHex", "contactHmac", "idempotencyKey"].sort());
  for (const id of [value.accountId, value.sessionId]) assert(uuid.safeParse(id).success, "Historical request unavailable");
  for (const digest of [value.nonceHash, value.contactHmac, value.idempotencyKey]) assert(/^[0-9a-f]{64}$/u.test(digest), "Historical request unavailable");
  assert(/^(?:[0-9a-f]{2}){28,4096}$/u.test(value.ciphertextHex), "Historical request unavailable");
  assert(Number.isFinite(Date.parse(value.nonceExpiresAt)) && !/[\r\n\u0000]/u.test(value.nonceExpiresAt), "Historical request unavailable");
  return `begin;
set local search_path=''; set local statement_timeout='45s'; set local lock_timeout='5s';
create temporary table historical_request_clock as select actual_at,actual_at-interval '7 days 10 minutes' effective_at
  from(select clock_timestamp() actual_at) captured;
create temporary table historical_created_request as select result.* from private.request_account_deletion_at_v1(
  ${sqlLiteral(value.accountId)}::uuid,${sqlLiteral(value.sessionId)}::uuid,${sqlLiteral(value.nonceHash)},
  ${sqlLiteral(value.nonceExpiresAt)}::timestamptz,decode(${sqlLiteral(value.ciphertextHex)},'hex'),
  ${sqlLiteral(value.contactHmac)},${sqlLiteral(value.idempotencyKey)},(select effective_at from historical_request_clock)) result;
do $created$ begin
  if current_user<>'postgres' or not exists(select 1 from historical_created_request result
    join public.account_deletion_requests d on d.id=result.deletion_id cross join historical_request_clock captured
    where result.status='notice_period' and d.state='notice_period' and d.account_id=${sqlLiteral(value.accountId)}::uuid
      and d.requested_at=captured.effective_at and d.notice_ends_at=d.requested_at+interval '7 days'
      and d.notice_ends_at<captured.actual_at and d.created_at>=captured.actual_at
      and d.notice_ends_at+interval '1 day'>clock_timestamp()) then
    raise exception using errcode='42501',message='historical request unavailable';end if;
  perform private.assert_account_affected_notice_receipt_v1((select deletion_id from historical_created_request),
    (select immutable_envelope from public.retention_due_phases where phase_id='account-deletion-notice-deadline'
      and immutable_envelope->>'deletionRequestId'=(select deletion_id::text from historical_created_request)));
end $created$;
set constraints all immediate;
`;
}
