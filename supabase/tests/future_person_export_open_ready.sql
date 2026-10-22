begin;
select no_plan();
-- The claimant export's READY read and explicit open-ready POST
-- (api.future-person-export). Synthetic data only; everything rolls back.
select ok(has_function_privilege('service_role','public.future_person_export_ready_v1(text,jsonb)','execute')
 and has_function_privilege('service_role','public.future_person_export_open_ready_v1(text,jsonb,text)','execute')
 and not has_function_privilege('authenticated','public.future_person_export_open_ready_v1(text,jsonb,text)','execute')
 and not has_function_privilege('anon','public.future_person_export_ready_v1(text,jsonb)','execute')
 and not has_function_privilege('inherit_upload_only','public.future_person_export_open_ready_v1(text,jsonb,text)','execute')
 and not has_function_privilege('service_role','private.future_person_ready_export_v1(text,uuid,text)','execute'),
 'only the server route reaches the two claimant delivery doors');
\ir fixtures/future_person_export_authority.inc
\ir fixtures/future_person_recorded_scientific_members.inc
create temporary table fp_authority as select public.future_person_export_request_v1('capture',pg_temp.h('rights')) body;
create function pg_temp.envelope(p_operation text,p_nonce text,p_export uuid) returns jsonb language sql as $$
 select jsonb_build_object(
   'routeId','api.future-person-export','origin','independent-rights','principalId',body->>'principalId',
   'targetKind','subject','targetId',(select subject from custody_ids)::text,'exportContract','approved-future-person-export-v1',
   'originBinding',body->>'originBinding','authorityReceipt',body->>'authorityReceipt','csrfBinding',pg_temp.h('csrf'),
   'operation',p_operation,'nonceHash',pg_temp.h(p_nonce),'issuedAt',n,'expiresAt',n+300000)
  ||case when p_operation='open-ready' then jsonb_build_object('exportId',p_export,'exportRevision',1) else '{}'::jsonb end
 from fp_authority cross join lateral (select floor(extract(epoch from clock_timestamp())*1000)::bigint n) clock;
$$;
create temporary table fp_export as select (public.future_person_export_request_v1('create',pg_temp.h('rights'),
 jsonb_build_object('exportCookieHash',pg_temp.h('export-cookie'),'envelope',pg_temp.envelope('create','create-1',null)),
 pg_temp.h('csrf'))->>'exportId')::uuid id;
set constraints all immediate;
set constraints all deferred;
create function pg_temp.ready(p_session text,p_cookie text) returns jsonb language sql as $$
 select public.future_person_export_ready_v1(pg_temp.h(p_session),jsonb_build_object('exportId',(select id from fp_export),
  'exportCookieHash',pg_temp.h(p_cookie)));
$$;
create function pg_temp.open(p_nonce text,p_cookie text,p_download text) returns jsonb language sql as $$
 select public.future_person_export_open_ready_v1(pg_temp.h('rights'),jsonb_build_object('exportId',(select id from fp_export),
  'envelope',pg_temp.envelope('open-ready',p_nonce,(select id from fp_export)),'downloadCookieHash',pg_temp.h(p_download),
  'exportCookieHash',pg_temp.h(p_cookie)),pg_temp.h('csrf'));
$$;
select throws_ok($$select pg_temp.ready('rights','export-cookie')$$,'42501','not_found','a queued export has no READY metadata');
select throws_ok($$select pg_temp.open('open-queued','export-cookie','download-1')$$,'42501','not_found',
 'a queued export cannot open a download session');
select is((select count(*) from private.export_archive_downloads where export_id=(select id from fp_export)),0::bigint,
 'no download session exists before READY');
select is((select count(*) from private.export_archive_nonce_uses where nonce_hash=pg_temp.h('open-queued')),0::bigint,
 'a refused open consumes no nonce');
select throws_ok($$select public.future_person_export_ready_v1(pg_temp.h('rights'),jsonb_build_object('exportId','x','exportCookieHash',pg_temp.h('export-cookie')))$$,
 '22023','invalid_request','a malformed poll body is invalid');
-- Bring the attempt to bytes_complete through the real worker doors.
create temporary table fp_attempt as select extensions.gen_random_uuid() id;
select public.export_archive_worker_v1('preflight',(select id from fp_export),(select id from fp_attempt),(select body->>'authorityReceipt' from fp_authority));
select public.export_archive_worker_v1('begin',(select id from fp_export),(select id from fp_attempt),(select body->>'authorityReceipt' from fp_authority));
update private.export_archive_attempts set state='bytes_complete',stopped_at=clock_timestamp(),
 cleanup_not_before=lease_expires_at+interval '30 seconds',segment_count=1,byte_count=1000,page_count=1,
 archive_sha256=pg_temp.h('archive'),manifest_sha256=pg_temp.h('manifest') where id=(select id from fp_attempt);
select throws_ok($$update public.generated_exports set status='ready',completed_at=clock_timestamp(),
 expires_at=clock_timestamp()+interval '23 hours',archive_sha256=pg_temp.h('archive'),manifest_sha256=pg_temp.h('manifest'),byte_count=1000
 where id=(select id from fp_export)$$,'55000','export_publication_not_integrated',
 'READY stays closed for a claimant archive: no claimant publication path exists');
-- Below, READY is synthesized with the publication guard switched off inside
-- this rolled-back transaction, only to prove the two doors' own checks.
alter table public.generated_exports disable trigger guard_segmented_export_publication;
update public.generated_exports set status='ready',completed_at=clock_timestamp(),
 expires_at=clock_timestamp()+interval '23 hours',archive_sha256=pg_temp.h('archive'),manifest_sha256=pg_temp.h('manifest'),byte_count=1000
 where id=(select id from fp_export);
alter table public.generated_exports enable trigger guard_segmented_export_publication;
create temporary table fp_counts as select (select count(*) from private.export_archive_downloads) d,
 (select count(*) from private.export_archive_nonce_uses) n,(select count(*) from public.generated_exports) e;
select is((select pg_temp.ready('rights','export-cookie')-'expiresAt'-'authorityReceipt'),
 jsonb_build_object('exportId',(select id from fp_export),'exportRevision',1,'sizeBytes',1000,'sha256',pg_temp.h('archive'),
  'segmentCount',1,'pageCount',1),'READY metadata is the exact cookie-bound archive');
select is((select pg_temp.ready('rights','export-cookie')->>'authorityReceipt'),(select body->>'authorityReceipt' from fp_authority),
 'READY rechecks the unchanged authority receipt');
select is((select row((select count(*) from private.export_archive_downloads),(select count(*) from private.export_archive_nonce_uses),
 (select count(*) from public.generated_exports))::text),(select row(d,n,e)::text from fp_counts),'a READY poll writes nothing');
select throws_ok($$select pg_temp.ready('rights','other-cookie')$$,'42501','not_found','another export cookie reads nothing');
select throws_ok($$select pg_temp.ready('other-rights','export-cookie')$$,'42501','not_found','another rights session reads nothing');
select throws_ok($$select pg_temp.probe('update public.rights_sessions set status=''revoked'' where session_hash=pg_temp.h(''rights'')',
 'select pg_temp.ready(''rights'',''export-cookie'')::text')$$,'42501','not_found','a revoked rights session reads nothing');
select throws_ok($$select pg_temp.probe('update public.embryo_scores set source_binding_fingerprint=pg_temp.h(''changed'')
 where id=''7a100000-0000-4000-8000-000000000001''','select pg_temp.ready(''rights'',''export-cookie'')::text')$$,
 '55000','export_source_unavailable','a changed source refuses READY');
select throws_ok($$select pg_temp.probe('update private.export_archive_jobs set deadline=created_at+interval ''1 millisecond'' where export_id=(select id from fp_export)',
 'select pg_temp.ready(''rights'',''export-cookie'')::text')$$,'42501','not_found','an expired export reads nothing');
select throws_ok($$select pg_temp.probe('update public.generated_exports set status=''building'',completed_at=null,expires_at=null where id=(select id from fp_export)',
 'select pg_temp.ready(''rights'',''export-cookie'')::text')$$,'42501','not_found','an export that is no longer READY reads nothing');
select throws_ok($$select public.future_person_export_open_ready_v1(pg_temp.h('rights'),jsonb_build_object('exportId',(select id from fp_export),
 'envelope',pg_temp.envelope('create','wrong-operation',null),'downloadCookieHash',pg_temp.h('download-1'),
 'exportCookieHash',pg_temp.h('export-cookie')),pg_temp.h('csrf'))$$,'42501','not_found','a create envelope cannot open a download');
select throws_ok($$select public.future_person_export_open_ready_v1(pg_temp.h('rights'),jsonb_build_object('exportId',(select id from fp_export),
 'envelope',pg_temp.envelope('open-ready','csrf-foreign',(select id from fp_export)),'downloadCookieHash',pg_temp.h('download-1'),
 'exportCookieHash',pg_temp.h('export-cookie')),pg_temp.h('other-csrf'))$$,'42501','not_found','a different CSRF binding refuses');
select throws_ok($$select pg_temp.open('open-cookie','other-cookie','download-1')$$,'42501','not_found','another export cookie opens nothing');
select is((select count(*) from private.export_archive_downloads where export_id=(select id from fp_export)),0::bigint,
 'no refused open created a download session');
create temporary table fp_opened as select pg_temp.open('open-1','export-cookie','download-1') body;
select is((select body-'downloadSessionId'-'expiresAt' from fp_opened),
 jsonb_build_object('chunkBytes',4000000,'sizeBytes',1000,'sha256',pg_temp.h('archive')),'open-ready returns the exact delivery metadata');
select ok((select (body->>'expiresAt')::timestamptz<=clock_timestamp()+interval '1 hour' from fp_opened),'the download session lasts at most one hour');
select is((select count(*) from private.export_archive_downloads where id=(select (body->>'downloadSessionId')::uuid from fp_opened)
 and export_id=(select id from fp_export) and cookie_hash=pg_temp.h('download-1') and attempt_id=(select id from fp_attempt)),1::bigint,
 'exactly one download session is bound to the archive and its cookie');
select is((select operation from private.export_archive_nonce_uses where nonce_hash=pg_temp.h('open-1')),'open-ready',
 'the open-ready nonce is consumed in the same transaction');
select is((select status from public.generated_exports where id=(select id from fp_export)),'ready','opening enqueues nothing and keeps the export READY');
select throws_ok($$select pg_temp.open('open-1','export-cookie','download-2')$$,'23505',null,'an open-ready nonce is used once');
select finish();
rollback;
