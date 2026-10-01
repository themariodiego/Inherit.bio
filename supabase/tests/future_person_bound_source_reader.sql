\ir fixtures/future_person_binding_authority.inc
-- All predecessor documentary decision, genuine SQL credential activation and
-- separate own account binding assertions remain. Provider receipts below are
-- synthetic SQL protocol boundaries, never hosted R2/browser evidence.
select ok(has_function_privilege('authenticated','public.future_person_bound_source_manifest_v1(uuid)','execute')
 and has_function_privilege('authenticated','public.check_future_person_bound_source_v1(uuid,jsonb)','execute')
 and not has_function_privilege('service_role','public.future_person_bound_source_manifest_v1(uuid)','execute')
 and not has_function_privilege('anon','public.future_person_bound_source_manifest_v1(uuid)','execute')
 and not has_function_privilege('inherit_upload_only','public.check_future_person_bound_source_v1(uuid,jsonb)','execute'),
 'only the actual authenticated claimant context can invoke the two scoped reading doors');
select ok(not has_function_privilege('authenticated','private.future_person_bound_source_manifest_v1(uuid,timestamptz)','execute')
 and not has_function_privilege('service_role','private.future_person_bound_source_manifest_v1(uuid,timestamptz)','execute'),
 'the private current-location builder gives no API role an arbitrary target/expiry shortcut');
create temporary table reader_auth as select current_setting('request.jwt.claims') value;
create temporary table reader_original as select jsonb_build_object('parts',
 (select jsonb_agg(to_jsonb(p) order by p.id) from private.embryo_canonical_parts p),'sources',
 (select jsonb_agg(to_jsonb(s) order by s.file_id) from private.embryo_canonical_sources s)) value;
select is(public.future_person_bound_source_manifest_v1((select subject from custody_ids)),null::jsonb,
 'binding alone never reads the parent location while the move is queued');
create temporary table reader_targets as select id,source_file_id from private.future_person_object_relocations;
create temporary table reader_copies(target jsonb,identity jsonb);
grant select on reader_targets to service_role;grant insert,select on reader_copies to service_role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$declare r record;target jsonb;identity jsonb;begin
 for r in select id from reader_targets loop
  target:=public.claim_future_person_relocation_v1(r.id,pg_temp.h(r.id::text));
  identity:=jsonb_build_object('providerVersion',replace(gen_random_uuid()::text,'-',''),'etag',repeat('4',32),
   'byteCount',(target->>'byteCount')::integer);
  if target is null or public.swap_future_person_relocation_v1(r.id,pg_temp.h(r.id::text),target,identity,
   (target->>'byteCount')::integer,target->>'sha256') is distinct from true then raise exception 'exact synthetic copy receipt refused';end if;
  insert into reader_copies values(target,identity);
 end loop;
end $$;
reset role;
select set_config('request.jwt.claims',(select value from reader_auth),true);
select is(public.future_person_bound_source_manifest_v1((select subject from custody_ids)),null::jsonb,
 'even complete full-byte swaps refuse reading until every old disposition has a persisted ACK');
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$declare r record;receipt jsonb;begin
 for r in select target from reader_copies loop
  receipt:=public.claim_future_person_relocation_cleanup_v1((r.target->>'attemptId')::uuid,pg_temp.h(r.target->>'attemptId'));
  if receipt->>'kind' is distinct from 'old' or public.finish_future_person_relocation_v1((r.target->>'attemptId')::uuid,
   pg_temp.h(r.target->>'attemptId'),receipt,jsonb_build_object('disposition','payload-tombstoned',
   'providerVersion',replace(gen_random_uuid()::text,'-',''),'etag','d41d8cd98f00b204e9800998ecf8427e','byteCount',0,
   'sha256','e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')) is distinct from true
   then raise exception 'exact synthetic old disposition refused';end if;
 end loop;
end $$;
reset role;
select set_config('request.jwt.claims',(select value from reader_auth),true);
create temporary table reader_manifest(value jsonb);
grant select on custody_ids,reader_manifest to authenticated;grant insert on reader_manifest to authenticated;
set local role authenticated;
insert into reader_manifest select public.future_person_bound_source_manifest_v1((select subject from custody_ids));
select ok((select value->>'purpose'='approved-future-person-export-v1' and value->>'subjectId'=(select subject::text from custody_ids)
 and value->'actor'->>'accountId'='7b100000-0000-4000-8000-000000000001' and jsonb_array_length(value->'parts')=2 from reader_manifest),
 'the actual own authenticated role resolves only its fully moved published source and fixed non-analytical access purpose');
select ok(public.check_future_person_bound_source_v1((select subject from custody_ids),(select value from reader_manifest)),
 'the actual authenticated caller can recheck the exact complete source receipt without private-table grants');
select is(public.future_person_bound_source_manifest_v1((select id from claimant_account_self)),null::jsonb,
 'the same accounts unrelated ordinary self subject cannot choose a claimed canonical source');
select is(public.future_person_bound_source_manifest_v1(gen_random_uuid()),null::jsonb,
 'an unknown or foreign subject names no private source or provider key');
select ok(not public.check_future_person_bound_source_v1((select subject from custody_ids),
 (select value||jsonb_build_object('purpose','embryo.analysis') from reader_manifest)), 'another purpose cannot reuse own-access source proof');
select ok(not public.check_future_person_bound_source_v1((select subject from custody_ids),
 (select value||jsonb_build_object('extra','unregistered') from reader_manifest)), 'an open SDK DTO refuses rather than accepting unknown authority');
select ok(not public.check_future_person_bound_source_v1((select subject from custody_ids),
 (select value||jsonb_build_object('parts',jsonb_build_array(value->'parts'->0)) from reader_manifest)), 'a partial member set cannot authorize any read');
select ok(not public.check_future_person_bound_source_v1((select subject from custody_ids),
 (select value||jsonb_build_object('expiresAt',clock_timestamp()-interval '1 second') from reader_manifest)), 'an expired source receipt refuses');
select ok(not public.check_future_person_bound_source_v1((select subject from custody_ids),
 (select value||jsonb_build_object('expiresAt','bad') from reader_manifest)), 'an invalid receipt deadline refuses without data');
reset role;
select is(pg_temp.probe('update private.future_person_binding_config set enabled=false',
 'select public.future_person_bound_source_manifest_v1((select subject from custody_ids))::text'),null::text,
 'closing the private binding configuration immediately refuses previously moved reads');
select is(pg_temp.probe('update public.future_person_claimant_principals set claimant_revision=claimant_revision+1 where claim_id=(select review from custody_ids)',
 'select public.future_person_bound_source_manifest_v1((select subject from custody_ids))::text'),null::text,
 'a replaced claimant revision refuses completed old object receipts');
select is(pg_temp.probe('update public.subjects set lifecycle_revision=lifecycle_revision+1 where id=(select subject from custody_ids)',
 'select public.check_future_person_bound_source_v1((select subject from custody_ids),(select value from reader_manifest))::text'),'false',
 'a changed subject lifecycle revision refuses the entire already issued source receipt');
select is(pg_temp.probe('update public.profiles set deletion_requested_at=clock_timestamp() where id=''7b100000-0000-4000-8000-000000000001''',
 'select public.future_person_bound_source_manifest_v1((select subject from custody_ids))::text'),null::text,
 'a claimant account awaiting deletion receives no source');
select is(pg_temp.probe('delete from auth.sessions where id=''7b100000-0000-4000-8000-000000000002''',
 'select public.check_future_person_bound_source_v1((select subject from custody_ids),(select value from reader_manifest))::text'),'false',
 'a revoked originating Auth session cannot recheck buffered bytes');
select ok((select value=jsonb_build_object('parts',
 (select jsonb_agg(to_jsonb(p) order by p.id) from private.embryo_canonical_parts p),'sources',
 (select jsonb_agg(to_jsonb(s) order by s.file_id) from private.embryo_canonical_sources s)) from reader_original),
 'copy, cleanup and every reading refusal preserve every original source/part descriptor including siblings');
select * from finish();rollback;
