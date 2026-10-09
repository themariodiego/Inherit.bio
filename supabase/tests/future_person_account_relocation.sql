\ir fixtures/future_person_binding_authority.inc
-- Real SQL state machine with synthetic provider receipts. This fixture does
-- not establish hosted R2 acknowledgement or genuine browser authentication.
create temporary table relocation_rpc(signature) as values
 ('public.claim_future_person_relocation_v1(uuid,text)'),
 ('public.check_future_person_relocation_v1(uuid,text)'),
 ('public.swap_future_person_relocation_v1(uuid,text,jsonb,jsonb,integer,text)'),
 ('public.fence_future_person_relocation_v1(uuid,text)'),
 ('public.claim_future_person_relocation_cleanup_v1(uuid,text)'),
 ('public.check_future_person_relocation_cleanup_v1(uuid,text,jsonb)'),
 ('public.finish_future_person_relocation_v1(uuid,text,jsonb,jsonb)'),
 ('public.future_person_relocation_work_v1()');
select ok((select bool_and(has_function_privilege('service_role',signature,'execute')
 and not has_function_privilege('anon',signature,'execute')
 and not has_function_privilege('authenticated',signature,'execute')
 and not has_function_privilege('inherit_upload_only',signature,'execute')) from relocation_rpc),
 'every exact relocation door executes only as the registered service worker');
select ok((select bool_and(not has_table_privilege(role,store,'select')) from
 (values('anon'),('authenticated'),('inherit_upload_only'),('service_role')) roles(role) cross join
 (values('private.future_person_binding_config'),('private.future_person_account_bindings'),
 ('private.future_person_object_relocations'),('private.future_person_relocation_attempts')) stores(store)),
 'no API role can read private binding, source-locator or claim-token stores');
select ok(not has_function_privilege('service_role','private.future_person_canonical_part_location_v1(uuid)','execute')
 and not has_function_privilege('authenticated','private.future_person_canonical_part_location_v1(uuid)','execute'),
 'the physical overlay is private and is not an unscoped reading API');
create temporary table original_canonical as select p.id,to_jsonb(p) value
 from private.embryo_canonical_parts p;
create temporary table original_sources as select x.file_id,to_jsonb(x) value
 from private.embryo_canonical_sources x;
create temporary table relocation_ids as select id,part_id,source_file_id,old_key,old_version,old_etag,
 expected_bytes,expected_sha256,row_number() over(order by id) ordinal
 from private.future_person_object_relocations;
select is((select count(*) from relocation_ids),2::bigint,'the exact approved source has two independently owned parts');
select is(public.claim_future_person_relocation_v1(gen_random_uuid(),pg_temp.h('copy')),null::jsonb,
 'an unrelated object ID cannot select a source');
select is(public.claim_future_person_relocation_v1((select id from relocation_ids where ordinal=1),'bad!'),null::jsonb,
 'a malformed worker claim cannot reserve a destination');
select is(pg_temp.probe('update private.future_person_binding_config set enabled=false',
 'select public.claim_future_person_relocation_v1((select id from relocation_ids where ordinal=1),pg_temp.h(''copy''))::text'),
 null::text,'a closed binding gate cannot begin copy work');
select is(pg_temp.probe('update public.future_person_claimant_principals set claimant_revision=claimant_revision+1 where claim_id=(select review from custody_ids)',
 'select public.claim_future_person_relocation_v1((select id from relocation_ids where ordinal=1),pg_temp.h(''copy''))::text'),
 null::text,'a replaced claimant revision cannot issue object work');
select is(pg_temp.probe('update public.profiles set deletion_requested_at=clock_timestamp() where id=''7b100000-0000-4000-8000-000000000001''',
 'select public.claim_future_person_relocation_v1((select id from relocation_ids where ordinal=1),pg_temp.h(''copy''))::text'),
 null::text,'an account awaiting deletion cannot issue object work');
select is((select count(*) from private.future_person_relocation_attempts),0::bigint,
 'every refused initial claim leaves no temporary attempt');
create function pg_temp.expired_part() returns void language plpgsql as $$
declare attempt uuid:=gen_random_uuid();started timestamptz:=clock_timestamp()-interval '6 minutes';key text;begin
 key:='claimant/7b100000-0000-4000-8000-000000000001/'||attempt;
 insert into private.future_person_relocation_attempts(id,relocation_id,new_key,copy_token_hash,copy_expires_at,created_at)
 values(attempt,(select id from relocation_ids where ordinal=1),key,pg_temp.h('expired-copy'),started+interval '5 minutes',started);
 update private.future_person_object_relocations set state='copying',new_key=key,claim_token_hash=pg_temp.h('expired-copy'),
  claim_expires_at=started+interval '5 minutes' where id=(select id from relocation_ids where ordinal=1);
end $$;
select is(pg_temp.probe('select pg_temp.expired_part()',
 'select public.check_future_person_relocation_v1((select id from relocation_ids where ordinal=1),pg_temp.h(''expired-copy''))::text'),
 'false','an expired persisted claim cannot read or swap despite exact current ownership');
select is(pg_temp.probe('select pg_temp.expired_part()',
 'select public.fence_future_person_relocation_v1((select id from relocation_ids where ordinal=1),null)::text'),
 'true','the registered reaper can fence only a genuinely expired uncommitted attempt');
create temporary table copy_target as select public.claim_future_person_relocation_v1(
 (select id from relocation_ids where ordinal=1),pg_temp.h('copy')) value;
select ok((select value->>'newKey'='claimant/7b100000-0000-4000-8000-000000000001/'||(value->>'attemptId')
 and value->>'oldKey'=(select old_key from relocation_ids where ordinal=1)
 and value->>'oldVersion'=(select old_version from relocation_ids where ordinal=1)
 and value->>'oldEtag'=(select old_etag from relocation_ids where ordinal=1)
 and (value->>'byteCount')::integer=(select expected_bytes from relocation_ids where ordinal=1)
 and value->>'sha256'=(select expected_sha256 from relocation_ids where ordinal=1)
 from copy_target),'the service claim pins the exact source tuple and one fresh attempt-owned destination');
select ok(public.check_future_person_relocation_v1((select id from relocation_ids where ordinal=1),pg_temp.h('copy')),
 'the exact current copy claim is live');
select ok(not public.check_future_person_relocation_v1((select id from relocation_ids where ordinal=1),pg_temp.h('foreign-copy')),
 'another claim hash cannot read or swap the part');
select is(pg_temp.probe('update private.future_person_binding_config set enabled=false',
 'select public.check_future_person_relocation_v1((select id from relocation_ids where ordinal=1),pg_temp.h(''copy''))::text'),
 'false','closing the gate refuses existing copy authority before read or swap');
select is(pg_temp.probe('update public.future_person_claimant_principals set release_revision=release_revision+1 where claim_id=(select review from custody_ids)',
 'select public.check_future_person_relocation_v1((select id from relocation_ids where ordinal=1),pg_temp.h(''copy''))::text'),
 'false','a changed release revision refuses a running claim');
select is(public.claim_future_person_relocation_v1((select id from relocation_ids where ordinal=1),pg_temp.h('copy-other')),null::jsonb,
 'a second worker cannot create a competing destination');
select throws_ok($$update private.future_person_relocation_attempts set new_key='claimant/foreign/target'$$,
 '23514','claimant relocation attempt identity is immutable','an attempt locator cannot be enlarged or rewritten');
select throws_ok($$update private.future_person_object_relocations set new_key='claimant/foreign/target' where state='copying'$$,
 '23514','claimant relocation destination is unreserved','the logical row cannot swap to an unreserved key');
create function pg_temp.copy_identity(p_bytes integer) returns jsonb language sql as $$
 select jsonb_build_object('providerVersion',repeat('3',32),'etag',repeat('4',32),'byteCount',p_bytes);
$$;
create function pg_temp.swap(p_target jsonb,p_identity jsonb,p_bytes integer,p_sha text) returns boolean language sql as $$
 select public.swap_future_person_relocation_v1((select id from relocation_ids where ordinal=1),pg_temp.h('copy'),p_target,p_identity,p_bytes,p_sha);
$$;
select ok(not pg_temp.swap((select value||jsonb_build_object('newKey','claimant/foreign/target') from copy_target),
 pg_temp.copy_identity((select expected_bytes from relocation_ids where ordinal=1)),
 (select expected_bytes from relocation_ids where ordinal=1),(select expected_sha256 from relocation_ids where ordinal=1)),
 'a crossed target receipt cannot commit');
select ok(not pg_temp.swap((select value from copy_target),
 pg_temp.copy_identity((select expected_bytes from relocation_ids where ordinal=1)),
 (select expected_bytes-1 from relocation_ids where ordinal=1),(select expected_sha256 from relocation_ids where ordinal=1)),
 'incomplete readback cannot commit');
select ok(not pg_temp.swap((select value from copy_target),
 pg_temp.copy_identity((select expected_bytes from relocation_ids where ordinal=1)),
 (select expected_bytes from relocation_ids where ordinal=1),pg_temp.h('corrupt')),
 'a full-size corrupt readback cannot commit');
select ok(not pg_temp.swap((select value from copy_target),
 pg_temp.copy_identity((select expected_bytes from relocation_ids where ordinal=1))||jsonb_build_object('extra','unknown'),
 (select expected_bytes from relocation_ids where ordinal=1),(select expected_sha256 from relocation_ids where ordinal=1)),
 'an open provider receipt schema cannot commit');
select ok(not pg_temp.swap((select value from copy_target),
 pg_temp.copy_identity((select expected_bytes from relocation_ids where ordinal=1))||jsonb_build_object('providerVersion',
 (select old_version from relocation_ids where ordinal=1)),
 (select expected_bytes from relocation_ids where ordinal=1),(select expected_sha256 from relocation_ids where ordinal=1)),
 'the original provider version cannot stand in for an independently copied version');
select is((select state from private.future_person_object_relocations where id=(select id from relocation_ids where ordinal=1)),
 'copying','all refused swaps leave the original physical reference current');
select is(private.future_person_canonical_part_location_v1((select part_id from relocation_ids where ordinal=1))->>'objectKey',
 (select old_key from relocation_ids where ordinal=1),'before committed swap the old exact key remains the sole read location');
select is(public.claim_future_person_relocation_cleanup_v1((select (value->>'attemptId')::uuid from copy_target),pg_temp.h('old-cleanup')),
 null::jsonb,'old disposal cannot be authorized before a committed swap');
grant select on copy_target to service_role;
set local role service_role;
select ok(public.swap_future_person_relocation_v1((select (value->>'relocationId')::uuid from copy_target),pg_temp.h('copy'),
 (select value from copy_target),pg_temp.copy_identity((select (value->>'byteCount')::integer from copy_target)),
 (select (value->>'byteCount')::integer from copy_target),(select value->>'sha256' from copy_target)),
 'the actual service role atomically commits the independently verified exact target');
reset role;
select is(private.future_person_canonical_part_location_v1((select part_id from relocation_ids where ordinal=1))->>'objectKey',
 (select value->>'newKey' from copy_target),'the current-location overlay points only to the committed copy');
select ok(not public.fence_future_person_relocation_v1((select id from relocation_ids where ordinal=1),pg_temp.h('copy')),
 'an uncertain response after commit cannot fence or delete the new current copy');
create temporary table old_cleanup as select public.claim_future_person_relocation_cleanup_v1(
 (select (value->>'attemptId')::uuid from copy_target),pg_temp.h('old-cleanup')) value;
select ok((select value->>'kind'='old' and value->'target'->>'oldKey'=(select old_key from relocation_ids where ordinal=1)
 and value->'identity'->>'providerVersion'=repeat('3',32) from old_cleanup),
 'only the committed swap authorizes retiring the exact old source');
select is(public.claim_future_person_relocation_cleanup_v1((select (value->>'attemptId')::uuid from copy_target),pg_temp.h('other-cleanup')),
 null::jsonb,'the active disposal claim cannot be replaced');
select ok(not public.check_future_person_relocation_cleanup_v1((select (value->>'attemptId')::uuid from copy_target),
 pg_temp.h('foreign-cleanup'),(select value from old_cleanup)),'a foreign cleanup token cannot retire the old key');
select is(pg_temp.probe('update public.future_person_claimant_principals set claimant_revision=claimant_revision+1 where claim_id=(select review from custody_ids)',
 'select public.check_future_person_relocation_cleanup_v1((select (value->>''attemptId'')::uuid from copy_target),pg_temp.h(''old-cleanup''),(select value from old_cleanup))::text'),
 'false','old disposal refuses a changed subject authority after copy commit');
create function pg_temp.marker() returns jsonb language sql as $$
 select jsonb_build_object('disposition','payload-tombstoned','providerVersion',repeat('5',32),
 'etag','d41d8cd98f00b204e9800998ecf8427e','byteCount',0,
 'sha256','e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
$$;
select ok(not public.finish_future_person_relocation_v1((select (value->>'attemptId')::uuid from copy_target),
 pg_temp.h('old-cleanup'),(select value from old_cleanup),pg_temp.marker()-'sha256'),
 'a partial disposal acknowledgement cannot complete a part');
select ok(not public.finish_future_person_relocation_v1((select (value->>'attemptId')::uuid from copy_target),
 pg_temp.h('old-cleanup'),(select value from old_cleanup),pg_temp.marker()||jsonb_build_object('byteCount',1)),
 'a marker containing payload cannot complete a part');
select ok(public.finish_future_person_relocation_v1((select (value->>'attemptId')::uuid from copy_target),
 pg_temp.h('old-cleanup'),(select value from old_cleanup),pg_temp.marker()),
 'only exact complete empty-marker evidence completes the old disposition');
select ok(public.finish_future_person_relocation_v1((select (value->>'attemptId')::uuid from copy_target),
 pg_temp.h('old-cleanup'),(select value from old_cleanup),pg_temp.marker()),'an identical terminal acknowledgement is idempotent');
select ok(not public.finish_future_person_relocation_v1((select (value->>'attemptId')::uuid from copy_target),
 pg_temp.h('foreign-cleanup'),(select value from old_cleanup),pg_temp.marker()),'terminal replay does not accept another cleanup credential');
select throws_ok($$update private.future_person_relocation_attempts set disposal_evidence='{}' where state='complete'$$,
 '23514','claimant relocation attempt is terminal','terminal provider evidence cannot be rewritten');
select is((select state from private.future_person_object_relocations where id=(select id from relocation_ids where ordinal=1)),
 'complete','the logical part completes only after its old disposition acknowledgement');

-- Failure-path provider replies are synthetic protocol boundaries. A new
-- attempt is impossible until the prior capability has drained and the exact
-- temporary key has a persisted permanent-marker acknowledgement.
create temporary table failed_target as select public.claim_future_person_relocation_v1(
 (select id from relocation_ids where ordinal=2),pg_temp.h('failed-copy')) value;
select ok(not public.fence_future_person_relocation_v1((select id from relocation_ids where ordinal=2),pg_temp.h('foreign-copy')),
 'a live foreign lease cannot fence a copy');
select ok(public.fence_future_person_relocation_v1((select id from relocation_ids where ordinal=2),pg_temp.h('failed-copy')),
 'the exact failed copy persists temporary-only cleanup');
select is(public.claim_future_person_relocation_cleanup_v1((select (value->>'attemptId')::uuid from failed_target),pg_temp.h('failed-cleanup')),
 null::jsonb,'cleanup waits for every bounded copy capability to drain');
select is(public.claim_future_person_relocation_v1((select id from relocation_ids where ordinal=2),pg_temp.h('retry-copy')),
 null::jsonb,'no retry can race an unacknowledged temporary object');
select is(private.future_person_canonical_part_location_v1((select part_id from relocation_ids where ordinal=2))->>'objectKey',
 (select old_key from relocation_ids where ordinal=2),'a failed copy leaves the old read reference unchanged');
-- Advance only the test-owned delayed-cleanup timestamp; identity, claims,
-- provider receipts and every production guard stay in force.
update private.future_person_relocation_attempts set cleanup_not_before=clock_timestamp()-interval '1 second'
 where id=(select (value->>'attemptId')::uuid from failed_target);
create temporary table failed_cleanup as select public.claim_future_person_relocation_cleanup_v1(
 (select (value->>'attemptId')::uuid from failed_target),pg_temp.h('failed-cleanup')) value;
select ok((select value->>'kind'='new' and value->'identity'='null'::jsonb
 and value->'target'->>'newKey'=(select value->>'newKey' from failed_target) from failed_cleanup),
 'failed-copy cleanup selects only its exact uncommitted new key');
select ok(not public.finish_future_person_relocation_v1((select (value->>'attemptId')::uuid from failed_target),
 pg_temp.h('failed-cleanup'),(select value from failed_cleanup),pg_temp.marker()||jsonb_build_object('extra',true)),
 'an open cleanup schema cannot release a retry');
select is(public.claim_future_person_relocation_v1((select id from relocation_ids where ordinal=2),pg_temp.h('retry-copy')),
 null::jsonb,'a missing valid marker acknowledgement keeps retries closed');
select ok(public.finish_future_person_relocation_v1((select (value->>'attemptId')::uuid from failed_target),
 pg_temp.h('failed-cleanup'),(select value from failed_cleanup),pg_temp.marker()),
 'exact temporary marker evidence permits a fresh attempt');
create temporary table retry_target as select public.claim_future_person_relocation_v1(
 (select id from relocation_ids where ordinal=2),pg_temp.h('retry-copy')) value;
select ok((select value->>'attemptId'<>(select value->>'attemptId' from failed_target)
 and value->>'newKey'<>(select value->>'newKey' from failed_target) from retry_target),
 'a retry never reuses the prior permanently fenced key');
do $$declare target jsonb;cleanup jsonb;n integer;hash text;begin
 for n in 2..3 loop
  target:=case when n=2 then (select value from retry_target) else
   public.claim_future_person_relocation_v1((select id from relocation_ids where ordinal=2),pg_temp.h('third-copy')) end;
  hash:=pg_temp.h(case when n=2 then 'retry-copy' else 'third-copy' end);
  if target is null or not public.fence_future_person_relocation_v1((select id from relocation_ids where ordinal=2),hash) then
   raise exception 'synthetic retry fixture failed to reserve its exact attempt';end if;
  update private.future_person_relocation_attempts set cleanup_not_before=clock_timestamp()-interval '1 second'
   where id=(target->>'attemptId')::uuid;
  cleanup:=public.claim_future_person_relocation_cleanup_v1((target->>'attemptId')::uuid,pg_temp.h('cleanup:'||n));
  if cleanup is null or not public.finish_future_person_relocation_v1((target->>'attemptId')::uuid,
   pg_temp.h('cleanup:'||n),cleanup,pg_temp.marker()) then raise exception 'synthetic marker ACK fixture refused';end if;
 end loop;
end $$;
select is((select count(*) from private.future_person_relocation_attempts where relocation_id=(select id from relocation_ids where ordinal=2)),
 3::bigint,'each bounded retry has exactly one separately fenced and acknowledged attempt');
select is((select count(distinct new_key) from private.future_person_relocation_attempts where relocation_id=(select id from relocation_ids where ordinal=2)),
 3::bigint,'all three permanent cleanup markers own different server-derived keys');
select is((select state from private.future_person_object_relocations where id=(select id from relocation_ids where ordinal=2)),
 'cancelled','the third acknowledged copy failure exhausts the exact bounded retry policy');
select is(public.claim_future_person_relocation_v1((select id from relocation_ids where ordinal=2),pg_temp.h('fourth-copy')),
 null::jsonb,'a fourth copy cannot bypass the retry ceiling');
select is((select jsonb_agg(to_jsonb(p) order by p.id) from private.embryo_canonical_parts p),
 (select jsonb_agg(value order by id) from original_canonical),
 'both success and retry leave the complete historical part inventory byte-identical');
select is((select jsonb_agg(to_jsonb(x) order by x.file_id) from private.embryo_canonical_sources x),
 (select jsonb_agg(value order by file_id) from original_sources),
 'both success and retry preserve the complete source and sibling provenance inventory');
select * from finish();
rollback;
