begin;
select no_plan();
-- The registered claimant request, end to end in its exact call order:
-- prepare, source lease, permanent source markers, identity documents,
-- the source session's planned published cleanup, then the final graph.
-- Provider answers are SQL protocol fixtures (metadata removal and exact
-- synthetic markers), never hosted provider or browser acceptance.
select ok(has_function_privilege('service_role','public.future_person_deletion_objects_v1(text,uuid,text,text[])','execute')
 and not has_function_privilege('anon','public.future_person_deletion_objects_v1(text,uuid,text,text[])','execute')
 and not has_function_privilege('authenticated','public.future_person_deletion_objects_v1(text,uuid,text,text[])','execute')
 and not has_function_privilege('inherit_upload_only','public.future_person_deletion_objects_v1(text,uuid,text,text[])','execute'),
 'only the service worker can reach the closed claimant object door');
select is((select count(*) from unnest(array['anon','authenticated','service_role','inherit_upload_only']) role
 where has_function_privilege(role,'private.future_person_deletion_lease_v1(uuid,text)','execute')
  or has_function_privilege(role,'private.future_person_deletion_document_keys_v1(uuid)','execute')),0::bigint,
 'no API role can read a lease or select identity keys directly');
select throws_ok($$select public.future_person_deletion_objects_v1('documents',gen_random_uuid(),repeat('a',64))$$,
 '42501','claimant deletion unavailable','a missing plan lists no identity object');
select throws_ok($$select public.future_person_deletion_objects_v1('unwind',gen_random_uuid(),repeat('a',64))$$,
 '42501','claimant deletion unavailable','a missing plan selects no published cleanup');
select throws_ok($$select public.future_person_deletion_objects_v1('purge',gen_random_uuid(),repeat('a',64))$$,
 '42501','claimant deletion unavailable','an unknown operation is refused before any plan lookup');
select throws_ok($$select public.future_person_deletion_objects_v1('documents',gen_random_uuid(),repeat('a',64),array['x'])$$,
 '42501','claimant deletion unavailable','a listing never accepts caller-supplied keys');
select throws_ok($$select public.confirm_claim_document_objects_deleted_v1(array[gen_random_uuid()||'/'||gen_random_uuid()||'/'||gen_random_uuid()],
 'api.future-person-delete')$$,'42501','claimant deletion unavailable',
 'the claimant route cannot confirm an object outside an executing sealed claimant plan');
select throws_ok($$select public.confirm_claim_document_objects_deleted_v1('{}'::text[],'api.future-person-delete')$$,
 '42501','claimant deletion unavailable','the claimant route cannot confirm an empty key set');
select throws_ok($$select public.confirm_claim_document_objects_deleted_v1(array['a'],'api.unregistered')$$,
 '22023','claim document deletion invalid','an unregistered route is still refused by the original allowlist');

\ir fixtures/future_person_deletion_authority.inc
select ok((private.future_person_rights_session_v1(pg_temp.h('deletion-rights'),false)).id is not null,
 'the genuine approved claimant holds a current rights session');
-- Give each ended-claim identity document its Storage metadata, as the real
-- create-only upload does, so absence can never be inferred.
insert into storage.objects(bucket_id,name,metadata)
 select 'future-person-identity',d.object_key,jsonb_build_object('size',d.byte_count)
 from private.claim_documents d where d.intake_id=(select review from custody_ids);
create temporary table identity_keys as select d.object_key from private.claim_documents d
 where d.intake_id=(select review from custody_ids);
select is((select count(*) from identity_keys),2::bigint,'the genuine claim holds exactly two identity documents');
select ok(not exists(select 1 from private.claim_documents d where d.intake_id=(select review from custody_ids)
 and private.claim_document_retained_v1(d)),'the approved and released claim no longer retains its documents');
create temporary table original_unwind as select id from public.embryo_ingest_unwinds
 where purpose='published' and session_id=(select id from live) and state<>'complete';
select is((select count(*) from original_unwind),1::bigint,
 'the original upload still has its planned published cleanup outstanding');
create temporary table sibling_snapshot as select to_jsonb(s) subject,to_jsonb(e) embryo,to_jsonb(x) source
 from private.embryo_canonical_sources x join public.subjects s on s.id=x.subject_id join public.embryos e on e.id=x.embryo_id
 where x.cohort_id=(select cohort_id from live) and x.file_id<>(select file from custody_ids);
create temporary table sibling_parts as select to_jsonb(a) part from private.embryo_canonical_parts a
 join private.embryo_canonical_source_parts b on b.part_id=a.id
 join private.embryo_canonical_sources x on x.file_id=b.file_id
 where x.cohort_id=(select cohort_id from live) and x.file_id<>(select file from custody_ids);
select ok((select count(*) from sibling_snapshot)>=1 and (select count(*) from sibling_parts)>=1,
 'a genuine sibling source and its parts exist before the claimant deletion');
create temporary table audit_before as select to_jsonb(l) value from public.legal_audit_log l;
create temporary table selector as select private.future_person_audit_selector_v1((select subject from custody_ids)) id;
create temporary table claimant_before as select claimant_principal_id id from public.subjects where id=(select subject from custody_ids);
-- A synthetic envelope-encrypted subject link and its key under the issued
-- selector, so the unlinkability check below has a real row to remove.
insert into public.audit_principal_links(audit_principal_id,subject_ciphertext,key_revision)
 select id,extensions.gen_random_bytes(48),1 from selector;
insert into public.audit_principal_link_keys(audit_principal_id,key_ciphertext,key_revision)
 select id,extensions.gen_random_bytes(48),1 from selector;

select throws_ok($$select pg_temp.deletion_probe(
 'update public.encrypted_contact_references set status=''shredded'',contact_ciphertext=null
  where principal_id=(select principal_id from public.rights_sessions where session_hash=pg_temp.h(''deletion-rights''))',
 'select private.prepare_future_person_deletion_v1(pg_temp.h(''deletion-rights''),''claimant-delete-no-contact-aaaaaaaa'')::text')$$,
 '42501','claimant deletion unavailable','a claimant whose rights contact is gone cannot create a deletion plan');
select ok(not exists(select 1 from public.retention_rows where target_id=(select subject from custody_ids)
 and retention_id='future-person.claimant-reverification-until-request')
 and (private.future_person_rights_session_v1(pg_temp.h('deletion-rights'),false)).id is not null,
 'the missing-contact refusal leaves no plan and the rights session unchanged');
create temporary table completion_plan as select private.prepare_future_person_deletion_v1(pg_temp.h('deletion-rights'),
 'claimant-delete-complete-aaaaaaaa') id;
select is((select count(*) from public.purge_manifest_entries where manifest_id=(select id from completion_plan) and entry_revision>50
 and store_name='storage.objects' and row_key->>'bucket_id'='future-person-identity'
 and row_key->>'name' in(select object_key from identity_keys)),2::bigint,
 'the sealed graph holds both identity objects with their exact Storage metadata keys');
create temporary table original_clocks as select r.created_at,r.fixed_deadline,p.phase_deadline,
 p.immutable_envelope->'completionDeadline' completion from public.purge_manifests m
 join public.retention_rows r on r.id=m.retention_row_id
 join public.retention_due_phases p on p.retention_row_id=r.id and p.phase_id=m.phase_id where m.id=(select id from completion_plan);
select is((select count(*) from public.purge_manifest_entries where manifest_id=(select id from completion_plan) and entry_revision>50
 and store_name in('public.audit_principal_links','public.audit_principal_link_keys')
 and row_key=jsonb_build_object('audit_principal_id',(select id from selector))),2::bigint,
 'the sealed graph holds the selector''s subject link and its key');
select ok((select fixed_deadline=created_at+interval '7 days' and (completion#>>'{}')::timestamptz=created_at+interval '30 days'
 from original_clocks),'the request fixes the original seven-day source and thirty-day completion clocks');
select throws_ok($$select public.future_person_deletion_objects_v1('documents',(select id from completion_plan),pg_temp.h('complete-lease'))$$,
 '42501','claimant deletion unavailable','an unclaimed plan has no live lease for the object door');

create temporary table completion_source_claim as select public.future_person_deletion_parts_v1('claim',(select id from completion_plan),
 pg_temp.h('complete-lease')) receipt;
select throws_ok($$select public.future_person_deletion_objects_v1('documents',(select id from completion_plan),pg_temp.h('complete-lease'))$$,
 '42501','claimant deletion unavailable','the object door stays closed until every source part has its permanent marker');
do $$ declare r jsonb;begin
 for r in select jsonb_array_elements(receipt->'objects') from completion_source_claim loop
  perform public.future_person_deletion_parts_v1('acknowledge',(select id from completion_plan),pg_temp.h('complete-lease'),r,
   jsonb_build_object('disposition','payload-tombstoned','bucket',r->>'bucket','objectKey',r->>'objectKey',
    'providerVersion',repeat('b',32),'etag','d41d8cd98f00b204e9800998ecf8427e','byteCount',0,
    'sha256','e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'));
 end loop;
end $$;
select is(public.future_person_deletion_parts_v1('proof',(select id from completion_plan),pg_temp.h('complete-lease'))->>'status',
 'source_tombstoned','both exact source markers are acknowledged');
select throws_ok($$select public.future_person_deletion_objects_v1('documents',(select id from completion_plan),pg_temp.h('crossed-lease'))$$,
 '42501','claimant deletion unavailable','a crossed lease cannot list the identity objects');
select throws_ok($$select pg_temp.deletion_probe(
 'update public.retention_due_phases set claim_expires_at=clock_timestamp()-interval ''1 microsecond''
  where retention_row_id=(select retention_row_id from public.purge_manifests where id=(select id from completion_plan))
   and phase_id=''future-person-claimed-source-disposal''',
 'select public.future_person_deletion_objects_v1(''documents'',(select id from completion_plan),pg_temp.h(''complete-lease''))::text')$$,
 '42501','claimant deletion unavailable','an expired lease cannot reach the object door');

select is(pg_temp.deletion_probe(
 'update private.claim_reviews set state=''release_queued'',resolved_at=null where id=(select review from custody_ids)',
 'select (public.future_person_deletion_objects_v1(''documents'',(select id from completion_plan),pg_temp.h(''complete-lease''))->''objectKeys'')::text'),
 '[]','a document that an open review still holds is never listed for removal');
create temporary table listed as select public.future_person_deletion_objects_v1('documents',(select id from completion_plan),
 pg_temp.h('complete-lease')) body;
select is((select array(select jsonb_array_elements_text(body->'objectKeys') order by 1) from listed),
 (select array_agg(object_key order by object_key) from identity_keys),
 'the door lists exactly the two sealed ended-claim identity objects and nothing else');
select is((select array(select jsonb_object_keys(body) order by 1) from listed),array['manifestId','objectKeys','status'],
 'the listing carries keys only: no body, hash, kind or claimant field');
select throws_ok($$select public.future_person_deletion_objects_v1('confirm-documents',(select id from completion_plan),
 pg_temp.h('complete-lease'),(select array_agg(object_key) from identity_keys))$$,
 '42501','claimant deletion unavailable','a still-present Storage object is never confirmed as deleted');
select is((select count(*) from public.purge_manifest_entries where manifest_id=(select id from completion_plan) and entry_revision>50
 and store_name in('private.claim_documents','storage.objects') and status='pending'),4::bigint,
 'the refused confirmation leaves every identity entry pending');
-- The actual Storage API removal deletes the object metadata. This SQL
-- fixture removes exactly those two rows; no guard is disabled.
do $$ begin
 perform set_config('storage.allow_delete_query','true',true);
 delete from storage.objects where bucket_id='future-person-identity' and name in(select object_key from identity_keys);
 if (select count(*) from storage.objects where bucket_id='future-person-identity'
   and name in(select object_key from identity_keys))<>0 then raise exception 'identity metadata must be removed';end if;
end $$;
select throws_ok($$select public.future_person_deletion_objects_v1('confirm-documents',(select id from completion_plan),
 pg_temp.h('complete-lease'),(select array_agg(object_key) from identity_keys)||array[gen_random_uuid()||'/'||gen_random_uuid()||'/'||gen_random_uuid()])$$,
 '42501','claimant deletion unavailable','a key outside the sealed plan cannot ride along');
select throws_ok($$select public.future_person_deletion_objects_v1('confirm-documents',(select id from completion_plan),
 pg_temp.h('complete-lease'),(select array_agg(object_key)||array_agg(object_key) from identity_keys))$$,
 '42501','claimant deletion unavailable','a duplicated key is refused');
select throws_ok($$select public.future_person_deletion_objects_v1('confirm-documents',(select id from completion_plan),
 pg_temp.h('complete-lease'),'{}'::text[])$$,'42501','claimant deletion unavailable','an empty confirmation is refused');
select throws_ok($$select public.future_person_deletion_objects_v1('confirm-documents',(select id from completion_plan),
 pg_temp.h('crossed-lease'),(select array_agg(object_key) from identity_keys))$$,
 '42501','claimant deletion unavailable','a crossed lease cannot confirm the identity objects');
select is((select body from (select public.future_person_deletion_objects_v1('confirm-documents',(select id from completion_plan),
 pg_temp.h('complete-lease'),(select array_agg(object_key) from identity_keys)) body) z),
 jsonb_build_object('status','documents_confirmed','manifestId',(select id from completion_plan),'remaining',0),
 'after actual metadata removal the existing callback confirms both identity objects');
select is((select count(*) from private.claim_documents where intake_id=(select review from custody_ids)),0::bigint,
 'the ended-claim identity documents are deleted');
select is((select count(*) from public.purge_manifest_entries where manifest_id=(select id from completion_plan) and entry_revision>50
 and store_name in('private.claim_documents','storage.objects') and status<>'deleted'),0::bigint,
 'every sealed identity entry carries its disposal acknowledgement');
select is((select count(*) from public.legal_audit_log where event_code='claim.document.deleted'
 and route_id='api.future-person-delete' and outcome_code='purged' and audit_principal_id is null
 and coded_context=jsonb_build_object('reason','claim-ended')),2::bigint,
 'each identity deletion is audited under the claimant route with no identity in its context');
select is(public.future_person_deletion_objects_v1('documents',(select id from completion_plan),pg_temp.h('complete-lease'))->'objectKeys',
 '[]'::jsonb,'no identity object remains to list');

select is((select body from (select public.future_person_deletion_objects_v1('unwind',(select id from completion_plan),
 pg_temp.h('complete-lease')) body) z),jsonb_build_object('status','unwind','manifestId',(select id from completion_plan),
 'unwindId',(select id from original_unwind),'state','storage_pending'),
 'the door names only this source session''s outstanding published cleanup');
select throws_ok($$select public.future_person_deletion_objects_v1('unwind',(select id from completion_plan),pg_temp.h('complete-lease'),array['x'])$$,
 '42501','claimant deletion unavailable','the cleanup selector never accepts caller keys');
select throws_ok($$select private.finish_future_person_deletion_v1((select id from completion_plan),pg_temp.h('complete-lease'))$$,
 '42501','claimant deletion unavailable','the final transaction still refuses while the original upload copies remain');
-- Drain the named cleanup through its existing exact doors. Supabase copies
-- lose their metadata first; R2 copies receive exact synthetic markers.
do $$ declare claim jsonb;d private.embryo_ingest_object_disposals;begin
 claim:=public.claim_embryo_ingest_object_disposals_v1((select id from original_unwind),pg_temp.h('complete-copy-disposal'));
 if claim->>'status' is distinct from 'claimed' then raise exception 'the original copies must be claimable';end if;
 for d in select * from private.embryo_ingest_object_disposals where unwind_id=(select id from original_unwind) and state='claimed' loop
  if d.backend='supabase' then
   perform set_config('storage.allow_delete_query','true',true);
   delete from storage.objects where id=d.storage_object_id and bucket_id=d.bucket_id
    and name=d.object_name and version=d.storage_version and metadata->'size'=to_jsonb(d.byte_count);
   if not found then raise exception 'the exact original Storage metadata must be deleted once';end if;
   perform public.finish_embryo_ingest_object_disposal_v1(d.unwind_id,d.ordinal,pg_temp.h('complete-copy-disposal'),
    private.embryo_ingest_disposal_receipt_v1(d),jsonb_build_object('version','embryo-ingest-object-delete-evidence-v1',
     'provider','supabase','disposition','object-deleted','bucket',d.bucket_id,'objectKey',d.object_name,
     'objectId',d.storage_object_id,'storageVersion',d.storage_version,'byteCount',d.byte_count));
  elsif d.backend='r2' then
   perform public.finish_embryo_ingest_object_disposal_v1(d.unwind_id,d.ordinal,pg_temp.h('complete-copy-disposal'),
    private.embryo_ingest_disposal_receipt_v1(d),jsonb_build_object('version','embryo-ingest-object-tombstone-evidence-v1','provider','r2',
     'disposition','payload-tombstoned','bucket',d.bucket_id,'objectKey',d.object_name,'providerVersion',lpad(d.ordinal::text,32,'8'),
     'etag','d41d8cd98f00b204e9800998ecf8427e','byteCount',0,'sha256','e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'));
  else raise exception 'unknown original provider cannot be acknowledged';end if;
 end loop;
end $$;
select is(public.confirm_embryo_ingest_unwind_storage_v1((select id from original_unwind))->>'status','storage_confirmed',
 'every original upload copy has exact disposal evidence');
select is(public.complete_embryo_ingest_unwind_v1((select id from original_unwind))->>'status','complete',
 'the existing published cleanup completes');
select is((select body from (select public.future_person_deletion_objects_v1('unwind',(select id from completion_plan),
 pg_temp.h('complete-lease')) body) z),jsonb_build_object('status','unwind','manifestId',(select id from completion_plan),
 'unwindId',null,'state',null),'no outstanding cleanup remains for this source session');
select is((select count(*) from public.embryo_ingest_fragments where session_id=(select id from live)),0::bigint,
 'the original upload fragments are gone');
select ok(not exists(select 1 from sibling_snapshot b join public.subjects s on s.id=(b.subject->>'id')::uuid
 join public.embryos e on e.id=(b.embryo->>'id')::uuid join private.embryo_canonical_sources x on x.file_id=(b.source->>'file_id')::uuid
 where (to_jsonb(s),to_jsonb(e),to_jsonb(x)) is distinct from (b.subject,b.embryo,b.source))
 and not exists(select 1 from sibling_parts b where not exists(select 1 from private.embryo_canonical_parts a where to_jsonb(a)=b.part)),
 'the published cleanup leaves every sibling subject, embryo, source and part byte-identical');

create temporary table sealed_keys as select store_name,row_key from public.purge_manifest_entries
 where manifest_id=(select id from completion_plan) and entry_revision>50;
select is(private.finish_future_person_deletion_v1((select id from completion_plan),pg_temp.h('complete-lease'))->>'status','deleted',
 'the registered request order completes the whole claimed-subject deletion inside its live lease');
select is((select coalesce(sum(private.future_person_deletion_row_v1(store_name,row_key,false)),0) from sealed_keys),0::numeric,
 'every sealed physical key is absent');
select ok(not exists(select 1 from public.subjects where id=(select subject from custody_ids))
 and not exists(select 1 from private.future_person_custody_slices where subject_id=(select subject from custody_ids))
 and not exists(select 1 from public.genome_files where id=(select file from custody_ids))
 and not exists(select 1 from private.embryo_canonical_sources where file_id=(select file from custody_ids))
 and not exists(select 1 from public.embryos where id=(select embryo from custody_ids))
 and not exists(select 1 from private.claim_reviews where id=(select review from custody_ids))
 and not exists(select 1 from public.future_person_claimant_principals where id=(select id from claimant_before)),
 'the subject, embryo, custody, canonical source, review and claimant principal are deleted');
select is((select count(*) from storage.objects where bucket_id='future-person-identity'
 and name in(select object_key from identity_keys)),0::bigint,'no identity object metadata remains');
select ok(not exists(select 1 from sibling_snapshot b join public.subjects s on s.id=(b.subject->>'id')::uuid
 join public.embryos e on e.id=(b.embryo->>'id')::uuid join private.embryo_canonical_sources x on x.file_id=(b.source->>'file_id')::uuid
 where (to_jsonb(s),to_jsonb(e),to_jsonb(x)) is distinct from (b.subject,b.embryo,b.source))
 and (select count(*) from sibling_snapshot)=(select count(*) from private.embryo_canonical_sources x
  where x.cohort_id=(select cohort_id from live)),
 'the whole deletion leaves the sibling records intact and byte-identical');
select ok(not exists(select 1 from audit_before a where not exists(select 1 from public.legal_audit_log l where to_jsonb(l)=a.value)),
 'every prior append-only audit event is retained byte-identically');
select is((select count(*) from public.legal_audit_log where event_code='claimant.deletion_requested'
 and route_id='api.future-person-delete' and audit_principal_id=(select id from selector)),1::bigint,
 'the request is audited once under the random claimant selector');
select is((select count(*) from public.legal_audit_log where event_code='claimant.deleted'
 and route_id='api.future-person-delete' and outcome_code='purged' and audit_principal_id=(select id from selector)
 and coded_context='{}'::jsonb),1::bigint,'the completed deletion is audited once with an empty coded context');
select ok(not exists(select 1 from public.audit_principal_links where audit_principal_id=(select id from selector))
 and not exists(select 1 from public.audit_principal_link_keys where audit_principal_id=(select id from selector)),
 'the retained audit events lose every link back to the deleted claimant');
select ok((select m.state='complete' and p.status='succeeded' and p.terminal_outcome_code='purged' and r.state='complete'
 and r.target_id<>(select subject from custody_ids) and r.created_at=c.created_at and r.fixed_deadline=c.fixed_deadline
 and p.phase_deadline=c.phase_deadline and p.immutable_envelope->'completionDeadline'=c.completion
 from completion_plan d join public.purge_manifests m on m.id=d.id join public.retention_rows r on r.id=m.retention_row_id
 join public.retention_due_phases p on p.retention_row_id=r.id and p.phase_id=m.phase_id cross join original_clocks c),
 'the anonymous terminal receipt keeps the original seven-day and thirty-day clocks unchanged');
select throws_ok($$select public.future_person_deletion_objects_v1('documents',(select id from completion_plan),pg_temp.h('complete-lease'))$$,
 '42501','claimant deletion unavailable','a completed plan has no object door');
select throws_ok($$select public.future_person_deletion_objects_v1('unwind',(select id from completion_plan),pg_temp.h('complete-lease'))$$,
 '42501','claimant deletion unavailable','a completed plan selects no further cleanup');
set constraints all immediate;
select * from finish();
rollback;
