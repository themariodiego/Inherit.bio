import assert from "node:assert/strict";
import { assertClaimedProvenanceFixture } from "./claimed-provenance-lock-contract.mjs";

export const HISTORICAL_PROJECT = "inherit-integrator-20260930";
export const HISTORICAL_LINEAGE = "aborted-page-post+verified-sdk-and-app-nonce+owner-effective-history";
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u;
const hash = /^[0-9a-f]{64}$/u;
export const sqlLiteral = value => `'${value.replaceAll("'", "''")}'`;

export function historicalAccountOwnedTarget(config, env) {
  assert(env.NODE_ENV === "test" && env.INHERIT_TEST_JURISDICTION === "1"
    && !env.VERCEL && !env.VERCEL_ENV && !env.VERCEL_URL, "Historical request unavailable");
  assert(!config.includes('"""') && !config.includes("'''"), "Historical request unavailable");
  const projects = [...config.matchAll(/^project_id = "([A-Za-z0-9_-]+)"$/gmu)];
  const apis = [...config.matchAll(/^\[api\]([\s\S]*?)(?=^\[|$(?![\s\S]))/gmu)];
  assert(projects.length === 1 && projects[0][1] === HISTORICAL_PROJECT && apis.length === 1, "Historical request unavailable");
  const ports = [...apis[0][1].matchAll(/^port = (\d+)$/gmu)];
  assert(ports.length === 1 && Number(ports[0][1]) > 1024 && Number(ports[0][1]) < 65536, "Historical request unavailable");
  const apiOrigin = `http://127.0.0.1:${ports[0][1]}`;
  assert(env.NEXT_PUBLIC_SUPABASE_URL === apiOrigin && env.NEXT_PUBLIC_SITE_URL === "http://127.0.0.1:3105"
    && env.NEXT_PUBLIC_SUPABASE_ANON_KEY && env.BYOK_ENCRYPTION_KEY, "Historical request unavailable");
  return Object.freeze({ projectId: HISTORICAL_PROJECT, apiOrigin, dbContainer: `supabase_db_${HISTORICAL_PROJECT}` });
}

/** Closed evidence distinct from genuine dispatched HTTP202. SQL rechecks all
 * recorded facts; none of these caller fields can grant account authority. */
export function assertHistoricalParentReceipt(parent, project, head) {
  assert(parent && typeof parent === "object" && !Array.isArray(parent));
  assert.deepEqual(Object.keys(parent).sort(), ["version", "projectId", "sourceCommit", "lineage", "nativePost",
    "accountId", "authSessionId", "deletionId", "nonceHash", "effectiveRequestedAt", "noticeEndsAt", "recordedAt",
    "nonceIssuedAt", "nonceConsumedAt", "nonceExpiresAt", "envelopeSha256", "manifestIdentitySha256", "noticeIdentitySha256"].sort());
  assert.equal(project, HISTORICAL_PROJECT); assert.equal(parent.projectId, project);
  assert.match(head, /^[0-9a-f]{40}$/u); assert.equal(parent.sourceCommit, head);
  assert.equal(parent.version, "claimed-provenance-historical-parent-request-v1");
  assert.equal(parent.lineage, HISTORICAL_LINEAGE); assert.equal(parent.nativePost, "observed-aborted-before-dispatch");
  for (const id of [parent.accountId, parent.authSessionId, parent.deletionId]) assert.match(id, uuid);
  assert.equal(new Set([parent.accountId, parent.authSessionId, parent.deletionId]).size, 3);
  for (const value of [parent.nonceHash, parent.envelopeSha256, parent.manifestIdentitySha256, parent.noticeIdentitySha256]) assert.match(value, hash);
  for (const key of ["effectiveRequestedAt", "noticeEndsAt", "recordedAt", "nonceIssuedAt", "nonceConsumedAt", "nonceExpiresAt"])
    assert(typeof parent[key] === "string" && Number.isFinite(Date.parse(parent[key])) && !/[\r\n\u0000]/u.test(parent[key]));
  assert.equal(Date.parse(parent.noticeEndsAt) - Date.parse(parent.effectiveRequestedAt), 7 * 86_400_000);
  assert(Date.parse(parent.noticeEndsAt) < Date.parse(parent.recordedAt));
  assert(Date.parse(parent.nonceIssuedAt) <= Date.parse(parent.nonceConsumedAt));
  assert(Date.parse(parent.nonceConsumedAt) <= Date.parse(parent.recordedAt));
  assert(Date.parse(parent.nonceExpiresAt) > Date.parse(parent.recordedAt));
  assert(Date.parse(parent.nonceExpiresAt) - Date.parse(parent.nonceIssuedAt) <= 600_000);
  return parent;
}

export function assertHistoricalConcurrencyFixture(input, project, head) {
  assert(input && typeof input === "object" && !Array.isArray(input));
  assert.deepEqual(Object.keys(input).sort(), ["version", "projectId", "sourceCommit", "accountDeletionId",
    "claimantManifestId", "claimTokenHash", "historicalParentRequest", "evidence"].sort());
  assert.equal(input.version, "claimed-provenance-concurrency-historical-fixture-v1");
  assert.equal(input.evidence, "synthetic-provider-metadata-only");
  const parent = input.historicalParentRequest;
  assertClaimedProvenanceFixture({ version: "claimed-provenance-concurrency-fixture-v1", projectId: input.projectId,
    sourceCommit: input.sourceCommit, accountDeletionId: input.accountDeletionId,
    claimantManifestId: input.claimantManifestId, claimTokenHash: input.claimTokenHash }, project, head);
  assertHistoricalParentReceipt(parent, project, head);
  assert.equal(parent.deletionId, input.accountDeletionId);
  assert.notEqual(parent.accountId, input.claimantManifestId); assert.notEqual(parent.authSessionId, input.claimantManifestId);
  return input;
}

/** Hash exactly the immutable creation identity, excluding only actual worker
 * state/leases which legitimately advance. No plaintext enters the receipt. */
export function historicalRequestProjectionSql(accountId, deletionId, sessionId, nonceHash) {
  for (const id of [accountId, sessionId]) assert.match(id, uuid);
  if (deletionId !== null) assert.match(deletionId, uuid);
  const deletion = deletionId === null ? "(select deletion_id from pg_temp.historical_created_request)" : `${sqlLiteral(deletionId)}::uuid`;
  assert.match(nonceHash, hash);
  return `select jsonb_build_object('accountId',d.account_id,'authSessionId',n.session_id,'deletionId',d.id,
    'nonceHash',n.nonce_hash,'effectiveRequestedAt',d.requested_at,'noticeEndsAt',d.notice_ends_at,'recordedAt',d.created_at,
    'nonceIssuedAt',n.issued_at,'nonceConsumedAt',n.consumed_at,'nonceExpiresAt',n.expires_at,
    'envelopeSha256',encode(extensions.digest(convert_to(phase.immutable_envelope::text,'UTF8'),'sha256'),'hex'),
    'manifestIdentitySha256',encode(extensions.digest(convert_to(jsonb_build_object(
      'retentionRowId',manifest.retention_row_id,'phaseId',manifest.phase_id,'phaseRevision',manifest.phase_revision,
      'manifestClass',manifest.manifest_class,'manifestRevision',manifest.manifest_revision,
      'sourceBindingFingerprint',manifest.source_binding_fingerprint,'createdAt',manifest.created_at)::text,'UTF8'),'sha256'),'hex'),
    'noticeIdentitySha256',encode(extensions.digest(convert_to((select jsonb_agg(jsonb_build_object(
      'id',mail.id,'template',mail.template_id,'purpose',mail.purpose,'targetKind',mail.target_kind,'targetId',mail.target_id,
      'principalId',mail.recipient_principal_id,'contactId',mail.contact_reference_id,'authorityRevision',mail.recipient_authority_revision,
      'semanticRevision',mail.semantic_revision,'idempotencyKey',mail.idempotency_key,'payload',mail.template_payload,
      'expiresAt',mail.expires_at,'createdAt',mail.created_at,'notBefore',mail.not_before) order by mail.id)
      from public.mail_outbox mail where mail.target_id=d.id and mail.target_kind='account'
        and mail.template_id in('account-deletion-notice','account-deletion-affected'))::text,'UTF8'),'sha256'),'hex')) receipt
    from public.account_deletion_requests d join public.account_operation_nonces n on n.account_id=d.account_id
      and n.session_id=${sqlLiteral(sessionId)}::uuid and n.nonce_hash=${sqlLiteral(nonceHash)}
      and n.operation='account_delete' and n.consumed_at is not null
    join public.retention_due_phases phase on phase.immutable_envelope->>'deletionRequestId'=d.id::text
      and phase.phase_id='account-deletion-notice-deadline' and phase.phase_deadline=d.notice_ends_at
      and (phase.immutable_envelope->>'originalNoticeEndsAt')::timestamptz=d.notice_ends_at
    join public.retention_rows retention on retention.id=phase.retention_row_id and retention.fixed_deadline=d.notice_ends_at
    join public.purge_manifests manifest on manifest.retention_row_id=phase.retention_row_id
      and manifest.phase_id=phase.phase_id and manifest.phase_revision=phase.phase_revision
    where d.id=${deletion} and d.account_id=${sqlLiteral(accountId)}::uuid
      and d.notice_ends_at=d.requested_at+interval '7 days' and d.created_at>d.notice_ends_at`;
}

export function historicalRecordedFacts(parent) {
  const facts = { ...parent };
  for (const field of ["version", "projectId", "sourceCommit", "lineage", "nativePost"]) delete facts[field];
  return facts;
}

export function historicalReceiptCheckSql(parent, project, head) {
  assertHistoricalParentReceipt(parent, project, head);
  const query = historicalRequestProjectionSql(parent.accountId, parent.deletionId, parent.authSessionId, parent.nonceHash);
  return `(${query}) is not distinct from ${sqlLiteral(JSON.stringify(historicalRecordedFacts(parent)))}::jsonb`;
}
