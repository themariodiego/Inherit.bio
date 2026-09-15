begin;
select no_plan();
-- Durable progress for one in-flight finalization. A checkpoint must never
-- outrank the authority of the finalization it belongs to, never move
-- backwards, never restate a different source, and never outlive the lease.

insert into private.upload_authorization_config(singleton,auth_issuer)
 values(true,'http://127.0.0.1:54321/auth/v1')
 on conflict(singleton) do update set auth_issuer=excluded.auth_issuer;
update private.upload_authorization_config set maximum_array_bytes=52428800,maximum_vcf_bytes=52428800,
 maximum_account_bytes=1073741824,maximum_active_uploads=32 where singleton;
insert into auth.users(id,email,raw_user_meta_data) values
 ('76500000-0000-4000-8000-000000000001','fenced-upload@e2e.local','{"display_name":"Synthetic uploader"}'),
 ('76500000-0000-4000-8000-000000000002','fenced-other@e2e.local','{"display_name":"Synthetic neighbour"}');
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('76500000-0000-4000-8000-000000000010','76500000-0000-4000-8000-000000000001',now(),now(),'aal1'),
 ('76500000-0000-4000-8000-000000000011','76500000-0000-4000-8000-000000000002',now(),now(),'aal1');
update public.profiles set date_of_birth=date '1990-01-01'
 where id in('76500000-0000-4000-8000-000000000001','76500000-0000-4000-8000-000000000002');
create temporary table checkpoint_subject as select id from public.subjects
 where subject_account_id='76500000-0000-4000-8000-000000000001' and subject_class='self';
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 select repeat(letter,64),'76500000-0000-4000-8000-000000000001',
 '76500000-0000-4000-8000-000000000010','own_upload_artifact_sign',clock_timestamp()+interval '9 minutes'
 from unnest(array['a','b']) letter;
select public.sign_own_upload_artifact_v1('76500000-0000-4000-8000-000000000001',
 '76500000-0000-4000-8000-000000000010',(select id from checkpoint_subject),
 'disclosure.insurance-and-discrimination',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='disclosure.insurance-and-discrimination' and version=1),
 array['understood'],1,1,1,1,1,repeat('a',64));
select public.sign_own_upload_artifact_v1('76500000-0000-4000-8000-000000000001',
 '76500000-0000-4000-8000-000000000010',(select id from checkpoint_subject),
 'consent.upload-self',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.upload-self' and version=1),
 array['own-adult-dna'],1,1,1,1,1,repeat('b',64));
create temporary table checkpoint_upload as select public.issue_own_storage_upload_v1(
 '76500000-0000-4000-8000-000000000001','76500000-0000-4000-8000-000000000010',
 (select id from checkpoint_subject),'VCF',8,repeat('a',64)) receipt;
grant select on checkpoint_upload,checkpoint_subject to service_role;
-- The storage write guard reads the caller's role from the JWT claims, not from
-- the PostgreSQL session role, so both have to be set for the fixture insert.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
insert into storage.objects(bucket_id,name,owner_id,metadata)
 values('genomes',(select receipt->>'stagingKey' from checkpoint_upload),
  '76500000-0000-4000-8000-000000000001','{"size":8}');
reset role;
create temporary table attempts(label text primary key,receipt jsonb);
grant select,insert on attempts to service_role;
create function pg_temp.upload_id() returns uuid language sql as $$
 select (receipt->>'uploadId')::uuid from checkpoint_upload; $$;
create function pg_temp.begin_v2() returns jsonb language sql as $$
 select public.begin_own_upload_finalization_v2('76500000-0000-4000-8000-000000000001',
 '76500000-0000-4000-8000-000000000010',pg_temp.upload_id()); $$;
create function pg_temp.claim(p_label text) returns uuid language sql as $$
 select (receipt->>'claim')::uuid from attempts where label=p_label; $$;
create function pg_temp.authorize(p_claim uuid) returns jsonb language sql as $$
 select public.authorize_own_upload_finalization_v2('76500000-0000-4000-8000-000000000001',
 '76500000-0000-4000-8000-000000000010',pg_temp.upload_id(),p_claim); $$;
create function pg_temp.abort(p_claim uuid) returns jsonb language sql as $$
 select public.abort_own_upload_finalization_v1('76500000-0000-4000-8000-000000000001',
 '76500000-0000-4000-8000-000000000010',pg_temp.upload_id(),p_claim); $$;
create function pg_temp.get(p_claim uuid) returns jsonb language sql as $$
 select public.read_own_upload_finalization_checkpoint_v1('76500000-0000-4000-8000-000000000001',
 '76500000-0000-4000-8000-000000000010',pg_temp.upload_id(),p_claim); $$;
create function pg_temp.mark() returns jsonb language sql as $$
 select jsonb_build_object('version','own-upload-finalization-checkpoint-v1','phase','verifying',
 'rawSha256',repeat('a',64),'decodedSha256',repeat('b',64),'verifiedBytes',4,'digestState','c3RhdGU='); $$;
create function pg_temp.put(p_claim uuid,p_revision bigint default 0) returns jsonb language sql as $$
 select public.write_own_upload_finalization_checkpoint_v1('76500000-0000-4000-8000-000000000001',
 '76500000-0000-4000-8000-000000000010',pg_temp.upload_id(),p_claim,p_revision,pg_temp.mark(),60); $$;

-- An old deployment has no independent attempt lease. Drain its invocation
-- window before adopting even a checkpoint-free validation attempt.
savepoint legacy_attempt;
insert into attempts values('legacy',public.begin_own_upload_finalization_v1('76500000-0000-4000-8000-000000000001',
 '76500000-0000-4000-8000-000000000010',pg_temp.upload_id()));
select throws_ok($$select pg_temp.begin_v2()$$,'42501','not_found','v2 waits for a legacy invocation to drain');
update public.upload_sessions set finalization_started_at=clock_timestamp()-interval '301 seconds' where id=pg_temp.upload_id();
insert into attempts values('adopted',pg_temp.begin_v2());
select isnt(pg_temp.claim('legacy'),pg_temp.claim('adopted'),'legacy validation restart rotates the old claim');
select is(pg_temp.get(pg_temp.claim('adopted'))->'checkpoint','null'::jsonb,'legacy restart invents no progress');
select throws_ok($$select pg_temp.abort(pg_temp.claim('legacy'))$$,'42501','not_found','legacy abort cannot return keys after v2 takeover');
rollback to legacy_attempt;

set local role service_role;
insert into attempts values('first',pg_temp.begin_v2());
select is((select receipt->>'status' from attempts where label='first'),'authorized','first fenced attempt owns validation');
select is(pg_temp.get(pg_temp.claim('first'))->'checkpoint','null'::jsonb,'ownership exists before any validation checkpoint');
select throws_ok($$select pg_temp.begin_v2()$$,'42501','not_found','a second request cannot enter the live initial-validation attempt');
select throws_ok($$select public.begin_own_upload_finalization_v1('76500000-0000-4000-8000-000000000001',
 '76500000-0000-4000-8000-000000000010',pg_temp.upload_id())$$,'42501','not_found','old entry point cannot bypass v2 ownership');
reset role;
select ok((select lease_expires_at>clock_timestamp() and lease_expires_at<=(select expires_at from public.upload_sessions where id=upload_id)
 from private.own_upload_finalization_attempts where upload_id=pg_temp.upload_id()),'lease is live and bounded by immutable upload expiry');
update private.own_upload_finalization_attempts set lease_expires_at=clock_timestamp()-interval '1 second' where upload_id=pg_temp.upload_id();
set local role service_role;
select throws_ok($$select pg_temp.authorize(pg_temp.claim('first'))$$,'42501','not_found','expired owner cannot revive its lease');
select throws_ok($$select pg_temp.abort(pg_temp.claim('first'))$$,'42501','not_found','expired owner cannot acquire deletion targets');
insert into attempts values('second',pg_temp.begin_v2());
select isnt(pg_temp.claim('first'),pg_temp.claim('second'),'restart without checkpoint rotates the claim');
select is(pg_temp.get(pg_temp.claim('second'))->'checkpoint','null'::jsonb,'restart claims no validation evidence');
select throws_ok($$select pg_temp.begin_v2()$$,'42501','not_found','re-entry acquires lease atomically: next contender is refused');
select throws_ok($$select pg_temp.authorize(pg_temp.claim('first'))$$,'42501','not_found','superseded attempt cannot authorize or renew');
select throws_ok($$select pg_temp.get(pg_temp.claim('first'))$$,'42501','not_found','superseded attempt cannot read current progress');
select throws_ok($$select pg_temp.put(pg_temp.claim('first'))$$,'42501','not_found','superseded attempt cannot write current progress');
select throws_ok($$select pg_temp.abort(pg_temp.claim('first'))$$,'42501','not_found','the old v1 catch RPC returns no cleanup keys after takeover');
select throws_ok($$select public.complete_own_upload_finalization_v1('76500000-0000-4000-8000-000000000001',
 '76500000-0000-4000-8000-000000000010',pg_temp.upload_id(),pg_temp.claim('first'),
 '76500000-0000-4000-8000-000000000099',repeat('a',64),repeat('b',64))$$,'42501','not_found','superseded attempt cannot publish');
select throws_ok($$select public.ack_own_upload_finalization_cleanup_v1('76500000-0000-4000-8000-000000000001',
 '76500000-0000-4000-8000-000000000010',pg_temp.upload_id(),pg_temp.claim('first'))$$,'42501','not_found','superseded attempt cannot attest cleanup');
select is(pg_temp.put(pg_temp.claim('second'))->>'revision','1','current holder records exact partial progress');
reset role;
update private.own_upload_finalization_attempts set lease_expires_at=clock_timestamp()+interval '5 seconds' where upload_id=pg_temp.upload_id();
set local role service_role;
select is(pg_temp.authorize(pg_temp.claim('second'))->>'claim',pg_temp.claim('second')::text,'heartbeat rechecks full authority and retains current claim');
reset role;
select ok((select lease_expires_at>clock_timestamp()+interval '50 seconds' from private.own_upload_finalization_attempts where upload_id=pg_temp.upload_id()),'heartbeat renews lease during non-checkpoint work');
select is((select revision from private.own_upload_finalization_checkpoints where upload_id=pg_temp.upload_id()),1::bigint,'heartbeat does not race checkpoint CAS revision');
update private.own_upload_finalization_attempts set lease_expires_at=clock_timestamp()-interval '1 second' where upload_id=pg_temp.upload_id();
savepoint foreign_checkpoint;
update private.own_upload_finalization_checkpoints set finalization_claim=gen_random_uuid() where upload_id=pg_temp.upload_id();
select throws_ok($$select pg_temp.begin_v2()$$,'42501','not_found','takeover refuses evidence from an unrelated claim');
rollback to foreign_checkpoint;
set local role service_role;
insert into attempts values('third',pg_temp.begin_v2());
select isnt(pg_temp.claim('second'),pg_temp.claim('third'),'checkpoint-bearing takeover also rotates ownership');
select is(pg_temp.get(pg_temp.claim('third'))->'checkpoint',pg_temp.mark(),'takeover preserves exact checkpoint evidence');
select is(pg_temp.get(pg_temp.claim('third'))->>'revision','1','takeover preserves monotonic checkpoint revision');
select throws_ok($$select pg_temp.put(pg_temp.claim('second'),1)$$,'42501','not_found','old CAS revision cannot bypass the new claim');
select throws_ok($$select public.authorize_own_upload_finalization_v1('76500000-0000-4000-8000-000000000001',
 '76500000-0000-4000-8000-000000000010',pg_temp.upload_id(),pg_temp.claim('second'))$$,'42501','not_found','old authorization API is fenced too');
select throws_ok($$select public.authorize_own_upload_finalization_v2('76500000-0000-4000-8000-000000000002',
 '76500000-0000-4000-8000-000000000011',pg_temp.upload_id(),pg_temp.claim('third'))$$,'42501','not_found','claim possession cannot replace same-account/session authority');
reset role;
savepoint revoked_session;
delete from auth.sessions where id='76500000-0000-4000-8000-000000000010';
select throws_ok($$select pg_temp.authorize(pg_temp.claim('third'))$$,'42501','not_found','heartbeat never extends revoked originating authority');
select is(pg_temp.abort(pg_temp.claim('third'))->>'bucket','genomes','current holder can still claim terminal cleanup after revocation');
rollback to revoked_session;
savepoint expired_upload;
update public.upload_sessions set expires_at=created_at+interval '1 microsecond' where id=pg_temp.upload_id();
select throws_ok($$select pg_temp.begin_v2()$$,'42501','not_found','re-entry cannot extend an expired upload session');
rollback to expired_upload;
set local role service_role;
select is(pg_temp.abort(pg_temp.claim('third'))->>'stagingKey',(select receipt->>'stagingKey' from checkpoint_upload),'current holder receives only exact cleanup target');
select throws_ok($$select pg_temp.begin_v2()$$,'42501','not_found','terminal cleanup claim prevents takeover before provider removal');
reset role;
select is((select status::text from public.upload_sessions where id=pg_temp.upload_id()),'rejected','abort marks terminal state before returning keys');
select ok((select finalization_cleanup_pending from public.upload_sessions where id=pg_temp.upload_id()),'cleanup remains pending until provider evidence');
select ok(exists(select 1 from storage.objects where name=(select receipt->>'stagingKey' from checkpoint_upload)),'SQL ownership tests do not imply provider deletion');
select ok(not has_table_privilege('service_role','private.own_upload_finalization_attempts','update'),'worker cannot forge its lease by table write');
select ok(not has_function_privilege('authenticated','public.begin_own_upload_finalization_v2(uuid,uuid,uuid)','execute'),'browser cannot start privileged finalization');
select ok(not has_function_privilege('inherit_upload_only','public.authorize_own_upload_finalization_v2(uuid,uuid,uuid,uuid)','execute'),'upload token cannot renew finalization');
select ok((select relrowsecurity from pg_class where oid='private.own_upload_finalization_attempts'::regclass),'private lease table also enables RLS');
select ok(exists(select 1 from pg_constraint where conrelid='private.own_upload_finalization_attempts'::regclass
 and confrelid='public.upload_sessions'::regclass and contype='f' and confdeltype='c'),'lease cascades with registered upload-session cleanup');
select * from finish();
rollback;
