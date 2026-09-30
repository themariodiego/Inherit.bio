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
select throws_ok($$select pg_temp.deletion_probe('update public.worker_jobs set status=''running'' where id=(select id from job)',
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
create temporary table deletion_plan as select private.prepare_future_person_deletion_v1(pg_temp.h('deletion-rights'),
 'claimant-delete-nonce-positive-aaaaaaaa') id;
select is((select count(*) from deletion_plan where id is not null),1::bigint,'the real current claimant creates one sealed exact source plan');
select ok((select r.retention_id='future-person.claimant-reverification-until-request'
 and r.fixed_deadline=r.created_at+interval '7 days' and p.phase_deadline=r.created_at
 and (p.immutable_envelope->>'completionDeadline')::timestamptz=r.created_at+interval '30 days'
 from deletion_plan d join public.purge_manifests m on m.id=d.id join public.retention_rows r on r.id=m.retention_row_id
 join public.retention_due_phases p on p.retention_row_id=r.id and p.phase_id=m.phase_id),
 'the registered inline claimant trigger retains distinct original seven-day source and thirty-day completion deadlines');
select is(public.future_person_rights_view_v1(pg_temp.h('deletion-rights')),null::jsonb,
 'request revokes every read through the genuine old claimant session');
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
select * from finish();
rollback;
