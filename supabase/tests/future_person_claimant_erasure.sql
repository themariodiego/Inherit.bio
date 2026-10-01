begin;
select no_plan();
select is((select count(*) from unnest(array['anon','authenticated','service_role','inherit_upload_only']) role
 where has_function_privilege(role,'private.prepare_future_person_deletion_v1(text,text)','execute')
   or has_function_privilege(role,'private.assert_future_person_deletion_plan_v1(uuid)','execute')),0::bigint,
 'no API role can manufacture or widen a claimed-subject deletion plan');
select ok(has_function_privilege('service_role','public.future_person_deletion_parts_v1(text,uuid,text,jsonb,jsonb)','execute')
 and not has_function_privilege('authenticated','public.future_person_deletion_parts_v1(text,uuid,text,jsonb,jsonb)','execute')
 and not has_function_privilege('anon','public.future_person_deletion_parts_v1(text,uuid,text,jsonb,jsonb)','execute')
 and not has_function_privilege('inherit_upload_only','public.future_person_deletion_parts_v1(text,uuid,text,jsonb,jsonb)','execute'),
 'only the service worker can drain an already sealed exact source inventory');
select throws_ok($$select private.prepare_future_person_deletion_v1(null,'claimant-delete-nonce-aaaaaaaa')$$,
 '42501','claimant deletion unavailable','missing claimant authority cannot create a deletion plan');
select throws_ok($$select private.prepare_future_person_deletion_v1(repeat('a',64),'claimant-delete-nonce-aaaaaaaa')$$,
 '42501','claimant deletion unavailable','a hash with no live approved claimant session creates no plan');
select throws_ok($$select public.future_person_deletion_parts_v1('claim',gen_random_uuid(),repeat('a',64))$$,
 '42501','claimant deletion unavailable','a missing plan cannot claim a provider object');
select throws_ok($$select public.future_person_deletion_parts_v1('acknowledge',gen_random_uuid(),repeat('a',64),'{}','{}')$$,
 '42501','claimant deletion unavailable','invented provider evidence cannot acknowledge a missing plan');
select throws_ok($$select public.future_person_deletion_parts_v1('proof',gen_random_uuid(),repeat('a',64))$$,
 '42501','claimant deletion unavailable','absence of a plan is never completion');
select throws_ok($$select public.future_person_deletion_parts_v1('complete',gen_random_uuid(),repeat('a',64))$$,
 '42501','claimant deletion unavailable','source disposal cannot claim whole-subject deletion');
select throws_ok($$select public.future_person_deletion_parts_v1('claim',gen_random_uuid(),null)$$,
 '42501','claimant deletion unavailable','a missing claim binding refuses before any provider inventory');
select is((select count(*) from unnest(array['anon','authenticated','service_role','inherit_upload_only']) role
 where has_function_privilege(role,'private.assert_future_person_settled_source_v1(uuid)','execute')
 or has_function_privilege(role,'private.issue_future_person_audit_selector_v1()','execute')
 or has_function_privilege(role,'private.future_person_audit_selector_v1(uuid)','execute')),0::bigint,
 'no API role can issue an audit identity or broaden settled source authority');
\ir fixtures/future_person_deletion_authority.inc
select is((select purpose from activated),'approved-future-person-release','the positive fixture activates a genuine approved claimant release');
select ok((private.future_person_rights_session_v1(pg_temp.h('deletion-rights'),false)).id is not null,
 'the positive predecessor is an actual current rights session');
select ok((select min(a.write_expires_at)>clock_timestamp() from private.embryo_canonical_source_parts b
 join private.embryo_canonical_parts a on a.id=b.part_id where b.file_id=(select file from custody_ids)),
 'the actual publication retains its original still-live create-only write window');
select lives_ok($$select private.assert_future_person_settled_source_v1((select file from custody_ids))$$,
 'a genuine completed publication qualifies without changing its original clock');
select throws_ok($$select pg_temp.deletion_probe('update public.worker_jobs set status=''running'',claim_token_hash=pg_temp.h(''running-deletion-probe''),
 claimed_by=''claimant-erasure-test-worker'',claim_expires_at=clock_timestamp()+interval ''60 seconds'',
 finished_at=null where id=(select id from job)',
 'select private.prepare_future_person_deletion_v1(pg_temp.h(''deletion-rights''),''delete-refused-running-aaaaaaaa'')')$$,
 '42501','claimant deletion unavailable','a running publication cannot create a disposal plan');
select is((select count(*) from public.retention_rows where target_id=(select subject from custody_ids)
 and retention_id='future-person.claimant-reverification-until-request'),0::bigint,
 'a refused unsettled publication leaves no retention row or nonce effects');
select is((select count(*) from public.rights_nonces where rights_session_id=(select id from public.rights_sessions
 where session_hash=pg_temp.h('deletion-rights'))),0::bigint,'unsettled refusal consumes no claimant nonce');
create temporary table canonical_before as select jsonb_agg(to_jsonb(x) order by x.file_id) sources
 from private.embryo_canonical_sources x where x.cohort_id=(select cohort_id from live);
create temporary table sibling_before as select to_jsonb(s) subject,to_jsonb(e) embryo,to_jsonb(x) source
 from private.embryo_canonical_sources x join public.subjects s on s.id=x.subject_id join public.embryos e on e.id=x.embryo_id
 where x.cohort_id=(select cohort_id from live) and x.file_id<>(select file from custody_ids);
select public.issue_future_person_recovery_key_v1(pg_temp.h('deletion-rights'),'recovery-before-delete-aaaaaaaa',pg_temp.h('offline-recovery'));
select throws_ok($$select pg_temp.deletion_probe(
 'update public.purge_manifests set state=''executing'' where retention_row_id in(select id from public.retention_rows
  where retention_id=''future-person.claimed-unbound-24mo'' and target_id=(select claimant_principal_id from public.subjects
   where id=(select subject from custody_ids)))',
 'select private.prepare_future_person_deletion_v1(pg_temp.h(''deletion-rights''),''delete-refused-old-worker-aaaaaaaa'')')$$,
 '42501','claimant deletion unavailable','a conflicting older executor refuses the complete atomic request');
select ok((private.future_person_rights_session_v1(pg_temp.h('deletion-rights'),false)).id is not null
 and not exists(select 1 from public.retention_rows where target_id=(select subject from custody_ids)
  and retention_id='future-person.claimant-reverification-until-request'),
 'older-executor refusal rolls back revocation, new controls and all claimant nonce effects');
-- Real request/worker reservation doors, no provider bytes or fabricated ACK.
create function pg_temp.deletion_export(p_nonce text) returns jsonb language plpgsql as $$
declare c jsonb;n bigint;
begin
 c:=public.future_person_export_request_v1('capture',pg_temp.h('deletion-rights'));
 n:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
 return public.future_person_export_request_v1('create',pg_temp.h('deletion-rights'),jsonb_build_object(
  'exportCookieHash',pg_temp.h('deletion-export-cookie'),'envelope',jsonb_build_object(
   'routeId','api.future-person-export','origin','independent-rights','principalId',c->>'principalId',
   'targetKind','subject','targetId',(select subject from custody_ids)::text,'exportContract','approved-future-person-export-v1',
   'originBinding',c->>'originBinding','authorityReceipt',c->>'authorityReceipt','csrfBinding',pg_temp.h('deletion-export-csrf'),
   'operation','create','nonceHash',pg_temp.h(p_nonce),'issuedAt',n,'expiresAt',n+300000)),pg_temp.h('deletion-export-csrf'));
end $$;
create function pg_temp.refuse_uncertain_export_deletion() returns uuid language plpgsql as $$
declare body jsonb;attempt uuid:=gen_random_uuid();c jsonb;key text;
begin
 body:=pg_temp.deletion_export('deletion-uncertain-export');
 c:=public.export_archive_worker_v1('preflight',(body->>'exportId')::uuid,attempt,body->>'authorityReceipt');
 perform public.export_archive_worker_v1('begin',(body->>'exportId')::uuid,attempt,body->>'authorityReceipt');
 key:=(c->>'principalHash')||'/'||(body->>'exportId')||'/'||attempt||'-0.part';
 perform public.export_archive_worker_v1('reserve',(body->>'exportId')::uuid,attempt,body->>'authorityReceipt',
  jsonb_build_object('ordinal',0,'offset',0,'sizeBytes',1,'sha256',pg_temp.h('reserved-byte'),'objectKey',key));
 return private.prepare_future_person_deletion_v1(pg_temp.h('deletion-rights'),'delete-refused-export-reservation-aaaaaaaa');
end $$;
select throws_ok($$select pg_temp.refuse_uncertain_export_deletion()$$,'42501','claimant deletion unavailable',
 'a real unACKed archive reservation cannot disappear through the claimant deletion request');
select ok((private.future_person_rights_session_v1(pg_temp.h('deletion-rights'),false)).id is not null
 and not exists(select 1 from public.generated_exports where target_kind='subject' and target_id=(select subject from custody_ids))
 and exists(select 1 from public.embryo_qc where embryo_id=(select embryo from custody_ids)),
 'uncertain archive refusal rolls back the complete job/reservation/request and preserves genuine result/rights authority');
create temporary table queued_deletion_export as select pg_temp.deletion_export('queued-export-before-delete') body;
select lives_ok('set constraints public.independent_export_origin_complete immediate',
 'the actual queued export passes its deferred creation contract before the separate deletion request');
set constraints public.independent_export_origin_complete deferred;
select is((select count(*) from public.generated_exports where id=(select (body->>'exportId')::uuid from queued_deletion_export)
 and status='queued' and object_id is null and archive_sha256 is null and byte_count is null),1::bigint,
 'one actual claimant export is queued without an attempt, reservation or provider bytes before deletion');
create temporary table genuine_qc_before as select to_jsonb(q) value from public.embryo_qc q
 where q.embryo_id=(select embryo from custody_ids);
create temporary table sibling_qc_before as select to_jsonb(q) value from public.embryo_qc q
 where q.embryo_id<>(select embryo from custody_ids);
select is((select count(*) from genuine_qc_before),1::bigint,
 'the genuine published claimant has one measured QC result before its own deletion request');
create temporary table deletion_plan as select private.prepare_future_person_deletion_v1(pg_temp.h('deletion-rights'),
 'claimant-delete-nonce-positive-aaaaaaaa') id;
select is((select count(*) from deletion_plan where id is not null),1::bigint,'the real current claimant creates one sealed exact source plan');
select ok((select r.retention_id='future-person.claimant-reverification-until-request'
 and r.fixed_deadline=r.created_at+interval '7 days' and p.phase_deadline=r.created_at
 and (p.immutable_envelope->>'completionDeadline')::timestamptz=r.created_at+interval '30 days'
 from deletion_plan d join public.purge_manifests m on m.id=d.id join public.retention_rows r on r.id=m.retention_row_id
 join public.retention_due_phases p on p.retention_row_id=r.id and p.phase_id=m.phase_id),
 'the registered inline claimant trigger retains distinct original seven-day source and thirty-day completion deadlines');
select ok((select r.disposition_revision=e.disposition_revision and p.disposition_revision=e.disposition_revision
 and (p.immutable_envelope->>'embryoDispositionRevision')::bigint=e.disposition_revision
 and r.target_lifecycle_revision=s.lifecycle_revision and p.target_lifecycle_revision=s.lifecycle_revision
 from deletion_plan d join public.purge_manifests m on m.id=d.id join public.retention_rows r on r.id=m.retention_row_id
 join public.retention_due_phases p on p.retention_row_id=r.id and p.phase_id=m.phase_id
 join public.subjects s on s.id=r.target_id join public.embryos e on e.subject_id=s.id),
 'the exact plan binds actual embryo disposition and subject lifecycle revisions independently');
select is((select count(*) from public.embryo_qc where embryo_id=(select embryo from custody_ids)),0::bigint,
 'the actual measured QC result is hard-deleted in the request transaction before any source-provider claim');
select ok(exists(select 1 from public.purge_manifest_entries where manifest_id=(select id from deletion_plan)
 and store_name='public.embryo_qc' and status='deleted')
 and not exists(select 1 from public.purge_manifest_entries where manifest_id=(select id from deletion_plan)
  and entry_revision<=50 and status<>'pending'),
 'derived cleanup records only its own sealed exact key and leaves every canonical payload disposal pending');
select ok(not exists(select 1 from sibling_qc_before b where not exists(select 1 from public.embryo_qc q where to_jsonb(q)=b.value)),
 'immediate derived cleanup preserves every genuine sibling QC row byte-identically');
select is((select count(*) from unnest(array['anon','authenticated','service_role','inherit_upload_only']) role
 where has_function_privilege(role,'private.purge_future_person_derived_v1(uuid)','execute')),0::bigint,
 'no API role can supply derived cleanup authority or an arbitrary target');
select ok(not exists(select 1 from public.generated_exports where id=(select (body->>'exportId')::uuid from queued_deletion_export))
 and not exists(select 1 from private.export_archive_jobs where export_id=(select (body->>'exportId')::uuid from queued_deletion_export))
 and not exists(select 1 from private.export_archive_nonce_uses where export_id=(select (body->>'exportId')::uuid from queued_deletion_export)),
 'the real queued byte-free export and every exact job/nonce child are deleted in the same request transaction');
select is(public.future_person_rights_view_v1(pg_temp.h('deletion-rights')),null::jsonb,
 'request revokes every read through the genuine old claimant session');
select is((select count(*) from public.future_person_claim_release_credentials where subject_id=(select subject from custody_ids)
 and status in('current','consumed')),0::bigint,'request invalidates every previously issued claimant release credential immediately');
select is((select count(*) from public.token_candidates tc join public.mail_outbox o on o.id=tc.outbox_id
 where o.target_id=(select subject from custody_ids) and tc.state in('pending','issued')),0::bigint,
 'an old release mail candidate cannot mint another claimant session after request');
select is((select count(*) from public.future_person_recovery_key_hashes where claimant_principal_id=(select claimant_principal_id
 from public.subjects where id=(select subject from custody_ids))),0::bigint,'the optional Recovery Key is destroyed immediately');
select is((select count(*) from public.future_person_claimant_identity_hmacs where claimant_principal_id=(select claimant_principal_id
 from public.subjects where id=(select subject from custody_ids))),0::bigint,'the durable identity HMAC is destroyed immediately');
select is((select jsonb_agg(to_jsonb(x) order by x.file_id) from private.embryo_canonical_sources x
 where x.cohort_id=(select cohort_id from live)),(select sources from canonical_before),
 'request leaves all current immutable canonical source rows byte-identical');
select throws_ok($$select private.prepare_future_person_deletion_v1(pg_temp.h('deletion-rights'),'claimant-delete-nonce-positive-aaaaaaaa')$$,
 '42501','claimant deletion unavailable','the consumed and revoked request cannot manufacture another plan');
select throws_ok($$select pg_temp.deletion_probe('set local role service_role',
 format('update public.purge_manifest_entries set status=''deleted'' where manifest_id=%L',(select id from deletion_plan)))$$,
 '42501','claimant deletion unavailable','direct service table writes cannot manufacture a provider ACK');
select ok((private.claim_retention_phase_v1(pg_temp.h('generic-scheduled-worker'),60)).phase_id
 is distinct from 'future-person-claimed-source-disposal','the generic scheduled worker cannot claim the inline claimant continuation');
create temporary table claimed_parts as select public.future_person_deletion_parts_v1('claim',(select id from deletion_plan),pg_temp.h('disposal-lease')) receipt;
select is((select jsonb_array_length(receipt->'objects') from claimed_parts),2,'the worker receives only the two current parts of this claimant source');
select ok((select m.state='executing' and m.physical_purge_started_at is not null and m.frozen_manifest_hash~'^[0-9a-f]{64}$'
 from public.purge_manifests m where id=(select id from deletion_plan)),
 'the immutable purge start is durable before any irreversible provider action');
select throws_ok($$select private.purge_future_person_derived_v1((select id from deletion_plan))$$,
 '42501','claimant deletion unavailable','a claimed source-disposal phase cannot replay the private request-only derived executor');
select throws_ok($$select public.future_person_deletion_parts_v1('claim',(select id from deletion_plan),pg_temp.h('crossed-lease'))$$,
 '42501','claimant deletion unavailable','a second worker cannot cross the live exact disposal lease');
select throws_ok($$select public.future_person_deletion_parts_v1('acknowledge',(select id from deletion_plan),pg_temp.h('disposal-lease'),
 (select receipt->'objects'->0 from claimed_parts),'{}')$$,'42501','claimant deletion unavailable','missing permanent-marker evidence leaves the exact entry pending');
select is(public.future_person_deletion_parts_v1('proof',(select id from deletion_plan),pg_temp.h('disposal-lease'))->>'status',
 'source_pending','a leased inventory and no provider ACK never mean disposal');
do $$ declare r jsonb;begin
 for r in select jsonb_array_elements(receipt->'objects') from claimed_parts loop
  perform public.future_person_deletion_parts_v1('acknowledge',(select id from deletion_plan),pg_temp.h('disposal-lease'),r,
   jsonb_build_object('disposition','payload-tombstoned','bucket',r->>'bucket','objectKey',r->>'objectKey',
    'providerVersion',repeat('a',32),'etag','d41d8cd98f00b204e9800998ecf8427e','byteCount',0,
    'sha256','e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'));
 end loop;
end $$;
select is(public.future_person_deletion_parts_v1('proof',(select id from deletion_plan),pg_temp.h('disposal-lease'))->>'status',
 'source_tombstoned','both exact synthetic provider ACKs prove only source payload disposal');
select ok(exists(select 1 from public.subjects where id=(select subject from custody_ids))
 and exists(select 1 from private.future_person_custody_slices where subject_id=(select subject from custody_ids)),
 'source disposal does not silently claim whole-subject graph completion');
select ok(not exists(select 1 from sibling_before b join public.subjects s on s.id=(b.subject->>'id')::uuid
 join public.embryos e on e.id=(b.embryo->>'id')::uuid join private.embryo_canonical_sources x on x.file_id=(b.source->>'file_id')::uuid
 where (to_jsonb(s),to_jsonb(e),to_jsonb(x)) is distinct from (b.subject,b.embryo,b.source)),
 'the sibling subject, embryo and original source remain byte-identical');
select is((select count(*) from private.future_person_custody_slices where subject_id=(select subject from custody_ids)
 and audit_principal_id=private.future_person_audit_selector_v1(subject_id)),1::bigint,
 'new approved custody has one exact immutable random audit selector');
-- Whole-graph proof remains separate from the source marker protocol.
select is((select count(*) from public.purge_target_stores),158::bigint,
 'all six existing private archive children join the exact physical purge census');
\ir fixtures/purge_store_census_158.inc
select is((select count(*) from public.purge_target_stores where target_id='generated-artifacts'
 and store_name in('private.export_archive_jobs','private.export_archive_attempts','private.export_archive_downloads',
 'private.export_archive_manifest_pages','private.export_archive_segments','private.export_archive_nonce_uses')),6::bigint,
 'every durable archive child is classified without creating or omitting a store');
select is((select count(*) from unnest(array['anon','authenticated','service_role','inherit_upload_only']) role
 where has_function_privilege(role,'private.finish_future_person_deletion_v1(uuid,text)','execute')
 or has_function_privilege(role,'private.future_person_deletion_graph_rows_v1(uuid,uuid,uuid,uuid,uuid)','execute')
 or has_function_privilege(role,'private.future_person_deletion_cascade_pending_v1(text,jsonb)','execute')
 or has_function_privilege(role,'private.future_person_deletion_row_v1(text,jsonb,boolean)','execute')),0::bigint,
 'no API role can select a graph table or invoke the closed final transaction');
select throws_ok($$select private.future_person_deletion_row_v1('public.profiles','{}',true)$$,
 '42501','claimant deletion unavailable','a parent/account table is outside the claimant row executor');
select throws_ok($$select private.future_person_deletion_row_v1('public.subjects',jsonb_build_object('id',
 (select subject from custody_ids),'subject_id',(select subject from custody_ids)),true)$$,
 '42501','claimant deletion unavailable','a widened key shape is refused before any DELETE');
select throws_ok($$select private.future_person_deletion_row_v1('public.subjects',jsonb_build_object('id',null),true)$$,
 '42501','claimant deletion unavailable','a null primary key never widens the typed row executor');
select throws_ok($$select private.future_person_deletion_graph_rows_v1((select subject from custody_ids),
 (select claimant_principal_id from public.subjects where id=(select subject from custody_ids)),gen_random_uuid(),
 (select embryo from custody_ids),private.future_person_audit_selector_v1((select subject from custody_ids)))$$,
 '42501','claimant deletion unavailable','a crossed source cannot select even a metadata graph');
select ok(exists(select 1 from public.purge_manifest_entries where manifest_id=(select id from deletion_plan)
 and entry_revision>50 and store_name='public.subjects' and row_key=jsonb_build_object('id',(select subject from custody_ids)))
 and exists(select 1 from public.purge_manifest_entries where manifest_id=(select id from deletion_plan)
 and entry_revision>50 and store_name='private.claim_reviews'),
 'the whole subject and review graph is sealed before the part gateway is claimed');
select throws_ok($$delete from private.future_person_claim_intakes where id=(select review from custody_ids)$$,
 '42501','claimant deletion unavailable','generic cascading cleanup cannot erase a pending sealed review graph');
select throws_ok($$select private.finish_future_person_deletion_v1((select id from deletion_plan),pg_temp.h('disposal-lease'))$$,
 '42501','claimant deletion unavailable','source markers alone cannot stand in for claim-document disposal ACKs');
select ok(exists(select 1 from private.claim_documents where intake_id=(select review from custody_ids))
 and exists(select 1 from public.subjects where id=(select subject from custody_ids)),
 'missing document disposal evidence atomically preserves the complete claimed source graph');
create temporary table sealed_graph_keys as select store_name,row_key from public.purge_manifest_entries
 where manifest_id=(select id from deletion_plan) and entry_revision>50;
create temporary table prior_audit_chain as select to_jsonb(l) value from public.legal_audit_log l;
create temporary table previous_claimant_controls as select r.id,r.created_at,r.fixed_deadline,r.retention_revision,
 p.phase_id,p.phase_revision,p.phase_deadline,p.immutable_envelope original_envelope
 from public.retention_rows r join public.retention_due_phases p on p.retention_row_id=r.id
 where r.retention_id='future-person.claimed-unbound-24mo' and r.target_kind='claim'
 and r.target_id=(select claimant_principal_id from public.subjects where id=(select subject from custody_ids));
select is((select count(*) from previous_claimant_controls),1::bigint,
 'the genuine release owns one original temporary-contact timer and exact working envelope');
select ok((select original_envelope ?& array['subjectId','claimantPrincipalId','principalId','contactReferenceId','outboxId']
 from previous_claimant_controls),'the real predecessor timer carries the exact old privacy associations to be minimized');
create temporary table original_deletion_clocks as select r.created_at,r.fixed_deadline,p.phase_deadline,
 p.immutable_envelope->'completionDeadline' completion from public.purge_manifests m
 join public.retention_rows r on r.id=m.retention_row_id join public.retention_due_phases p on p.retention_row_id=r.id
 and p.phase_id=m.phase_id where m.id=(select id from deletion_plan);
-- Synthetic ACK after metadata absence exercises the actual existing callback;
-- it is a SQL protocol fixture, not a physical provider or hosted receipt.
select public.confirm_claim_document_objects_deleted_v1((select array_agg(d.object_key) from private.claim_documents d
 where d.intake_id=(select review from custody_ids)),'jobs.retention');
select is((select count(*) from private.claim_documents where intake_id=(select review from custody_ids)),0::bigint,
 'the real document disposal callback clears the exact ended claim documents');
select throws_ok($$select private.finish_future_person_deletion_v1((select id from deletion_plan),pg_temp.h('disposal-lease'))$$,
 '42501','claimant deletion unavailable','the original published ingest copies must also receive real disposal ACKs');
-- Drain the genuine published cleanup through its existing exact provider
-- doors. The original metadata fixture lands ingest fragments in Supabase,
-- while its canonical source parts use R2. Neither provider may be relabeled.
-- No Storage guard is disabled and no row or worker status is forged.
create temporary table original_upload_cleanup as select id from public.embryo_ingest_unwinds
 where purpose='published' and session_id=(select id from live);
create function pg_temp.original_copy_ack_before_delete() returns jsonb language plpgsql as $$
declare d private.embryo_ingest_object_disposals;claim jsonb;evidence jsonb;
begin
 claim:=public.claim_embryo_ingest_object_disposals_v1((select id from original_upload_cleanup),pg_temp.h('original-copy-disposal'));
 select * into d from private.embryo_ingest_object_disposals
  where unwind_id=(select id from original_upload_cleanup) and state='claimed' and backend='supabase' order by ordinal limit 1;
 if not found then raise exception 'the genuine original fixture must have its landed Supabase disposal';end if;
 evidence:=jsonb_build_object('version','embryo-ingest-object-delete-evidence-v1',
   'provider','supabase','disposition','object-deleted','bucket',d.bucket_id,'objectKey',d.object_name,
   'objectId',d.storage_object_id,'storageVersion',d.storage_version,'byteCount',d.byte_count);
 if private.embryo_ingest_disposal_evidence_ok_v1(d,evidence) is distinct from true then
  raise exception 'the negative fixture must carry the exact registered provider evidence';end if;
 return public.finish_embryo_ingest_object_disposal_v1(d.unwind_id,d.ordinal,pg_temp.h('original-copy-disposal'),
  private.embryo_ingest_disposal_receipt_v1(d),evidence);
end $$;
select throws_ok($$select pg_temp.original_copy_ack_before_delete()$$,'42501','embryo_unwind_unavailable',
 'an exact Supabase receipt cannot acknowledge the original copy while its real metadata still exists');
do $$ declare claim jsonb;d private.embryo_ingest_object_disposals;begin
 claim:=public.claim_embryo_ingest_object_disposals_v1((select id from original_upload_cleanup),pg_temp.h('original-copy-disposal'));
 for d in select * from private.embryo_ingest_object_disposals where unwind_id=(select id from original_upload_cleanup) and state='claimed' loop
  if d.backend='supabase' then
   perform set_config('storage.allow_delete_query','true',true);
   delete from storage.objects where id=d.storage_object_id and bucket_id=d.bucket_id
    and name=d.object_name and version=d.storage_version and metadata->'size'=to_jsonb(d.byte_count);
   if not found then raise exception 'the exact original Storage metadata must be deleted once';end if;
   perform public.finish_embryo_ingest_object_disposal_v1(d.unwind_id,d.ordinal,pg_temp.h('original-copy-disposal'),
    private.embryo_ingest_disposal_receipt_v1(d),jsonb_build_object('version','embryo-ingest-object-delete-evidence-v1',
     'provider','supabase','disposition','object-deleted','bucket',d.bucket_id,'objectKey',d.object_name,
     'objectId',d.storage_object_id,'storageVersion',d.storage_version,'byteCount',d.byte_count));
  elsif d.backend='r2' then
   perform public.finish_embryo_ingest_object_disposal_v1(d.unwind_id,d.ordinal,pg_temp.h('original-copy-disposal'),
    private.embryo_ingest_disposal_receipt_v1(d),jsonb_build_object('version','embryo-ingest-object-tombstone-evidence-v1','provider','r2',
     'disposition','payload-tombstoned','bucket',d.bucket_id,'objectKey',d.object_name,'providerVersion',lpad(d.ordinal::text,32,'9'),
     'etag','d41d8cd98f00b204e9800998ecf8427e','byteCount',0,'sha256','e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'));
  else raise exception 'unknown original provider cannot be acknowledged';end if;
 end loop;
end $$;
select is(public.confirm_embryo_ingest_unwind_storage_v1((select id from original_upload_cleanup))->>'status','storage_confirmed',
 'original upload copies have exact marker evidence before metadata cleanup');
select is(public.complete_embryo_ingest_unwind_v1((select id from original_upload_cleanup))->>'status','complete',
 'the actual published cleanup finishes without touching any sibling canonical part');
select throws_ok($$select pg_temp.deletion_probe(
 'update public.retention_due_phases set claim_expires_at=clock_timestamp()-interval ''1 microsecond''
  where retention_row_id=(select retention_row_id from public.purge_manifests where id=(select id from deletion_plan))
   and phase_id=''future-person-claimed-source-disposal''',
 'select private.finish_future_person_deletion_v1((select id from deletion_plan),pg_temp.h(''disposal-lease''))')$$,
 '42501','claimant deletion unavailable','an expired exact lease cannot enter the final atomic source deletion');
select ok(exists(select 1 from private.embryo_canonical_sources where file_id=(select file from custody_ids))
 and exists(select 1 from public.subjects where id=(select subject from custody_ids)),
 'expired finisher refusal preserves the complete source and subject graph');
select ok(exists(select 1 from public.purge_manifest_entries e where e.manifest_id=(select id from deletion_plan)
 and e.entry_revision>50 and e.store_name='private.claim_review_downloads'
 and private.future_person_deletion_cascade_pending_v1(e.store_name,e.row_key)),
 'the genuine review download waits for its existing protected receipt and chunk children');
select throws_ok($$select private.future_person_deletion_cascade_pending_v1('public.profiles','{}')$$,
 '42501','claimant deletion unavailable','dependency ordering cannot expand the closed row inventory');
select is(private.finish_future_person_deletion_v1((select id from deletion_plan),pg_temp.h('disposal-lease'))->>'status',
 'deleted','the exact ACK-backed private transaction deletes the genuine approved unbound claimant graph');
select is((select coalesce(sum(private.future_person_deletion_row_v1(store_name,row_key,false)),0) from sealed_graph_keys),0::numeric,
 'every original frozen physical key is absent after the final transaction');
select ok(not exists(select 1 from public.subjects where id=(select subject from custody_ids))
 and not exists(select 1 from private.future_person_custody_slices where subject_id=(select subject from custody_ids))
 and not exists(select 1 from public.genome_files where id=(select file from custody_ids)),
 'subject, identity custody and source are removed only together after complete proof');
select ok(not exists(select 1 from sibling_before b join public.subjects s on s.id=(b.subject->>'id')::uuid
 join public.embryos e on e.id=(b.embryo->>'id')::uuid join private.embryo_canonical_sources x on x.file_id=(b.source->>'file_id')::uuid
 where (to_jsonb(s),to_jsonb(e),to_jsonb(x)) is distinct from (b.subject,b.embryo,b.source)),
 'full deletion leaves the sibling subject, embryo and immutable canonical source byte-identical');
select ok(not exists(select 1 from prior_audit_chain a where not exists(select 1 from public.legal_audit_log l where to_jsonb(l)=a.value)),
 'all prior append-only audit events and chain fields remain byte-identical');
select ok((select m.state='complete' and m.batch_cursor=(select count(*) from public.purge_manifest_entries where manifest_id=m.id)
 and p.status='succeeded' and p.terminal_outcome_code='purged' and r.state='complete'
 and p.target_id=r.target_id and r.target_id<>(select subject from custody_ids)
 and p.immutable_envelope->>'version'='future-person-deletion-receipt-v1'
 and r.created_at=c.created_at and r.fixed_deadline=c.fixed_deadline and p.phase_deadline=c.phase_deadline
 and p.immutable_envelope->'completionDeadline'=c.completion
 from deletion_plan d join public.purge_manifests m on m.id=d.id join public.retention_rows r on r.id=m.retention_row_id
 join public.retention_due_phases p on p.retention_row_id=r.id and p.phase_id=m.phase_id cross join original_deletion_clocks c),
 'coded terminal controls retain original deadlines and counts without the subject association');
select ok(not exists(select 1 from public.purge_manifest_entries e where e.manifest_id=(select id from deletion_plan)
 and (e.status<>'deleted' or e.row_key is distinct from jsonb_build_object('version','future-person-deletion-entry-receipt-v1',
 'ordinal',e.entry_revision,'disposition','deleted'))),
 'terminal entry receipts contain no DNA, provider keys, names, contacts or original physical row identifiers');
select ok((select count(*)=1 and bool_and(r.state='complete' and r.target_id<>(c.original_envelope->>'claimantPrincipalId')::uuid
 and r.target_id=p.target_id and p.status in('cancelled','succeeded','failed')
 and p.immutable_envelope=jsonb_build_object('version','future-person-control-receipt-v1','outcome','subject-deleted')
 and r.created_at=c.created_at and r.fixed_deadline=c.fixed_deadline and r.retention_revision=c.retention_revision
 and p.phase_revision=c.phase_revision and p.phase_deadline=c.phase_deadline)
 from previous_claimant_controls c join public.retention_rows r on r.id=c.id
 join public.retention_due_phases p on p.retention_row_id=r.id and p.phase_id=c.phase_id),
 'older contact controls retain their original clocks and revisions but no subject/contact/outbox association');
select throws_ok($$update public.retention_due_phases set immutable_envelope=(select original_envelope from previous_claimant_controls)
 where retention_row_id=(select id from previous_claimant_controls)$$,'23514','claimant contact deadline is immutable',
 'an older minimized contact receipt cannot restore its destroyed private links');
select is((select count(*) from unnest(array['anon','authenticated','service_role','inherit_upload_only']) role
 where has_function_privilege(role,'private.future_person_deletion_controls_v1(uuid)','execute')
 or has_function_privilege(role,'private.future_person_control_minimization_allowed_v1(uuid)','execute')),0::bigint,
 'no API role can select older controls or manufacture their terminal minimization proof');
select throws_ok($$update public.retention_due_phases set immutable_envelope=jsonb_build_object('subjectId',
 (select subject from custody_ids)) where retention_row_id=(select retention_row_id from public.purge_manifests
 where id=(select id from deletion_plan))$$,'23514','claimant deletion plan immutable',
 'a completed anonymous receipt cannot be rewritten to restore an identity link');
select throws_ok($$select private.finish_future_person_deletion_v1((select id from deletion_plan),pg_temp.h('disposal-lease'))$$,
 '42501','claimant deletion unavailable','a completed plan cannot be replayed as new deletion authority');
set constraints all immediate;
select * from finish();
rollback;
