import assert from "node:assert/strict";
import { assertHistoricalParentReceipt, historicalReceiptCheckSql, sqlLiteral as literal } from "../claimed-provenance-historical-contract.mjs";
import type { ClaimedProvenanceProducerInput } from "./claimed-provenance-fixture";

export type HistoricalParentReceipt = Readonly<{
  version: "claimed-provenance-historical-parent-request-v1";
  projectId: "inherit-integrator-20260930"; sourceCommit: string;
  lineage: "aborted-page-post+verified-sdk-and-app-nonce+owner-effective-history";
  nativePost: "observed-aborted-before-dispatch";
  accountId: string; authSessionId: string; deletionId: string; nonceHash: string;
  effectiveRequestedAt: string; noticeEndsAt: string; recordedAt: string;
  nonceIssuedAt: string; nonceConsumedAt: string; nonceExpiresAt: string;
  envelopeSha256: string; manifestIdentitySha256: string; noticeIdentitySha256: string;
}>;
export type HistoricalProducerInput = Omit<ClaimedProvenanceProducerInput, "parent"> & { parent: HistoricalParentReceipt };
export function validateHistoricalProducerInput(value: HistoricalProducerInput, project: string, head: string) {
  assert(value && typeof value === "object" && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), ["parent", "subjectId", "claimantSessionHash", "claimantOperationNonce",
    "claimantLeaseHash", "parentLeaseHash", "evidence"].sort());
  assertHistoricalParentReceipt(value.parent,project,head);
  assert.match(value.subjectId,/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u);
  assert.equal(new Set([value.subjectId,value.parent.accountId,value.parent.authSessionId,value.parent.deletionId]).size,4);
  for(const digest of [value.claimantSessionHash,value.claimantLeaseHash,value.parentLeaseHash])assert.match(digest,/^[0-9a-f]{64}$/u);
  assert.notEqual(value.claimantLeaseHash,value.parentLeaseHash);
  assert.match(value.claimantOperationNonce,/^[A-Za-z0-9_-]{16,256}$/u);
  assert.equal(value.evidence,"synthetic-provider-metadata-only");
  return value;
}

/** Separate historical lineage, actual shared protocol doors. The protected
 * disposal/current-custody body is copied exactly from frozen036 and pinned
 * by source equality tests. No native receipt coercion or rewritten row. */
export function historicalClaimedProvenanceProducerSql(input: HistoricalProducerInput, project: string, head: string): string {
  const value = validateHistoricalProducerInput(input, project, head);
  const p = value.parent;
  return `-- Owner-only synthetic-provider-metadata-only fixture; no elapsed or physical-provider credit.
begin;
set local search_path='';
set local statement_timeout='45s';
set local lock_timeout='5s';
create temporary table claimed_pair_fixture_result(receipt jsonb);
do $fixture$
declare d public.account_deletion_requests; rs public.rights_sessions; c private.future_person_custody_slices;
  phase public.retention_due_phases; r public.retention_rows; parent_claim record;
  manifest uuid; claimed jsonb; item jsonb; unwind jsonb; disposal private.embryo_ingest_object_disposals;
  evidence jsonb; documents text[]; original_candidate jsonb; after_candidate jsonb;
begin
  if current_user<>'postgres' then raise exception using errcode='42501',message='owner fixture only';end if;
  select * into strict d from public.account_deletion_requests where id=${literal(p.deletionId)}::uuid
    and account_id=${literal(p.accountId)}::uuid and state='notice_period' for update;
  if d.requested_at is distinct from ${literal(p.effectiveRequestedAt)}::timestamptz
    or d.notice_ends_at is distinct from ${literal(p.noticeEndsAt)}::timestamptz
    or d.notice_ends_at<>d.requested_at+interval '7 days'
    or not exists(select 1 from public.account_operation_nonces n where n.nonce_hash=${literal(p.nonceHash)}
      and n.account_id=d.account_id and n.session_id=${literal(p.authSessionId)}::uuid
      and n.operation='account_delete' and n.consumed_at is not null)
  then raise exception using errcode='42501',message='historical request receipt unavailable';end if;
  if not (${historicalReceiptCheckSql(p,project,head)}) then
    raise exception using errcode='42501',message='historical creation identity unavailable';end if;
  select q.* into strict r from public.retention_rows q join public.retention_due_phases f on f.retention_row_id=q.id
    where q.retention_id='account-deletion.notice-7d' and q.target_kind='account' and q.target_id=d.account_id
      and q.fixed_deadline=d.notice_ends_at and f.phase_id='account-deletion-notice-deadline'
      and f.immutable_envelope->>'deletionRequestId'=d.id::text for update of q;
  select * into strict phase from public.retention_due_phases where retention_row_id=r.id
    and phase_id='account-deletion-notice-deadline' for update;
  if phase.phase_deadline is distinct from d.notice_ends_at
    or (phase.immutable_envelope->>'originalNoticeEndsAt')::timestamptz is distinct from d.notice_ends_at
    or phase.status not in('pending','retry') or r.state<>'scheduled'
  then raise exception using errcode='42501',message='historical fixed clocks unavailable';end if;
  perform private.assert_account_affected_notice_receipt_v1(d.id,phase.immutable_envelope);
  if d.notice_ends_at>clock_timestamp() then
    raise exception using errcode='55000',message='historical seven-day notice is not due';end if;
  -- The global claim must select this exact receipt, once. Refuse another
  -- eligible queue member before calling it; never loop, retry or skip it.
  if exists(select 1 from public.account_deletion_requests other where other.id<>d.id and
    ((other.state='notice_period' and other.notice_ends_at<=clock_timestamp()) or
     (other.state='delete_started' and (other.claim_expires_at is null or other.claim_expires_at<=clock_timestamp()))))
  then raise exception using errcode='55000',message='synthetic queue is not isolated';end if;
  rs:=private.future_person_rights_session_v1(${literal(value.claimantSessionHash)},true);
  if rs.id is null or rs.target_id is distinct from ${literal(value.subjectId)}::uuid then
    raise exception using errcode='42501',message='current claimant authority unavailable';end if;
  select * into strict c from private.future_person_custody_slices where subject_id=rs.target_id for update;
  perform private.assert_future_person_subject_custody_v1(rs.target_id);
  if not exists(select 1 from public.embryo_cohorts where id=c.historical_cohort_id and owner_account_id=d.account_id)
  then raise exception using errcode='42501',message='crossed parent claimant fixture';end if;
  original_candidate:=private.claimed_provenance_candidate_v1(c.source_file_id);
  select * into parent_claim from public.claim_due_account_deletion_v1(${literal(value.parentLeaseHash)},300);
  if parent_claim.deletion_id is distinct from d.id or parent_claim.account_id is distinct from d.account_id
    or parent_claim.storage_objects is distinct from '[]'::jsonb or parent_claim.database_already_purged is distinct from false
  then raise exception using errcode='42501',message='exact parent claim unavailable';end if;
  after_candidate:=private.claimed_provenance_candidate_v1(c.source_file_id);
  if after_candidate is distinct from original_candidate then
    raise exception using errcode='42501',message='shared provenance changed during actual parent planning';end if;
  manifest:=private.prepare_future_person_deletion_v1(${literal(value.claimantSessionHash)},${literal(value.claimantOperationNonce)});
  claimed:=public.future_person_deletion_parts_v1('claim',manifest,${literal(value.claimantLeaseHash)});
  if claimed->>'status' is distinct from 'claimed' or jsonb_array_length(claimed->'objects') not between 1 and 25
  then raise exception using errcode='42501',message='actual claimant inventory unavailable';end if;
  for item in select jsonb_array_elements(claimed->'objects') loop
    perform public.future_person_deletion_parts_v1('acknowledge',manifest,${literal(value.claimantLeaseHash)},item,
      jsonb_build_object('disposition','payload-tombstoned','bucket',item->>'bucket','objectKey',item->>'objectKey',
        'providerVersion',lpad((item->>'ordinal'),32,'a'),'etag','d41d8cd98f00b204e9800998ecf8427e','byteCount',0,
        'sha256','e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'));
  end loop;
  select array_agg(document.object_key order by document.id) into documents from private.claim_documents document
    join public.purge_manifest_entries entry on entry.manifest_id=manifest and entry.store_name='private.claim_documents'
      and entry.row_key=jsonb_build_object('id',document.id);
  -- Provider absence is a prerequisite, not something this SQL can invent.
  if documents is null or exists(select 1 from storage.objects o where o.bucket_id='future-person-identity'
    and o.name=any(documents)) then
    raise exception using errcode='42501',message='prior exact identity-object disposal required';end if;
  perform public.confirm_claim_document_objects_deleted_v1(documents,'jobs.retention');
  for unwind in select jsonb_array_elements(public.account_embryo_unwinds_v1(d.id,${literal(value.parentLeaseHash)})) loop
    claimed:=public.claim_embryo_ingest_object_disposals_v1((unwind->>'unwindId')::uuid,${literal(value.parentLeaseHash)});
    for disposal in select * from private.embryo_ingest_object_disposals
      where unwind_id=(unwind->>'unwindId')::uuid order by ordinal loop
      if disposal.backend='supabase' then
        if exists(select 1 from storage.objects o where o.id=disposal.storage_object_id and o.bucket_id=disposal.bucket_id
          and o.name=disposal.object_name) then
          raise exception using errcode='42501',message='prior exact original-object disposal required';end if;
        evidence:=jsonb_build_object('version','embryo-ingest-object-delete-evidence-v1','provider','supabase',
          'disposition','object-deleted','bucket',disposal.bucket_id,'objectKey',disposal.object_name,
          'objectId',disposal.storage_object_id,'storageVersion',disposal.storage_version,'byteCount',disposal.byte_count);
      elsif disposal.backend='r2' then
        evidence:=jsonb_build_object('version','embryo-ingest-object-tombstone-evidence-v1','provider','r2',
          'disposition','payload-tombstoned','bucket',disposal.bucket_id,'objectKey',disposal.object_name,
          'providerVersion',lpad(disposal.ordinal::text,32,'b'),'etag','d41d8cd98f00b204e9800998ecf8427e','byteCount',0,
          'sha256','e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
      else raise exception using errcode='42501',message='unknown exact provider';end if;
      perform public.finish_embryo_ingest_object_disposal_v1(disposal.unwind_id,disposal.ordinal,${literal(value.parentLeaseHash)},
        private.embryo_ingest_disposal_receipt_v1(disposal),evidence);
    end loop;
    if public.confirm_embryo_ingest_unwind_storage_v1((unwind->>'unwindId')::uuid)->>'status' is distinct from 'storage_confirmed'
      or public.complete_embryo_ingest_unwind_v1((unwind->>'unwindId')::uuid)->>'status' is distinct from 'complete'
    then raise exception using errcode='42501',message='exact original disposal incomplete';end if;
  end loop;
  perform public.complete_account_deletion_storage_v1(d.id,${literal(value.parentLeaseHash)});
  if public.future_person_deletion_parts_v1('proof',manifest,${literal(value.claimantLeaseHash)})->>'status'
    is distinct from 'source_tombstoned' or private.claimed_provenance_candidate_v1(c.source_file_id) is distinct from original_candidate
  then raise exception using errcode='42501',message='exact prepared fixture unavailable';end if;
  if not (${historicalReceiptCheckSql(p,project,head)}) then
    raise exception using errcode='42501',message='historical immutable creation identity changed';end if;
  insert into pg_temp.claimed_pair_fixture_result values(jsonb_build_object(
    'version','claimed-provenance-concurrency-historical-fixture-v1','projectId',${literal(project)},'sourceCommit',${literal(head)},
    'accountDeletionId',d.id,'claimantManifestId',manifest,'claimTokenHash',${literal(value.claimantLeaseHash)},
    'historicalParentRequest',${literal(JSON.stringify(p))}::jsonb,'evidence','synthetic-provider-metadata-only'));
end $fixture$;
set constraints all immediate;
select receipt from pg_temp.claimed_pair_fixture_result;
commit;
`;
}
