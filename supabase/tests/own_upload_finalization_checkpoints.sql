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
 ('76500000-0000-4000-8000-000000000001','checkpoint-upload@e2e.local','{"display_name":"Synthetic uploader"}'),
 ('76500000-0000-4000-8000-000000000002','checkpoint-other@e2e.local','{"display_name":"Synthetic neighbour"}');
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
create temporary table checkpoint_manifest as select public.begin_own_upload_finalization_v1(
 '76500000-0000-4000-8000-000000000001','76500000-0000-4000-8000-000000000010',
 (select (receipt->>'uploadId')::uuid from checkpoint_upload)) receipt;
select is((select receipt->>'status' from checkpoint_manifest),'authorized','the fixture holds an exclusive validation lease');

create function pg_temp.upload_id() returns uuid language sql as $$
 select (receipt->>'uploadId')::uuid from checkpoint_upload; $$;
create function pg_temp.claim() returns uuid language sql as $$
 select (receipt->>'claim')::uuid from checkpoint_manifest; $$;
create function pg_temp.mark(p_phase text,p_verified numeric default 0,p_state text default null,
 p_raw text default repeat('a',64),p_decoded text default repeat('b',64)) returns jsonb language sql as $$
 select jsonb_build_object('version','own-upload-finalization-checkpoint-v1','phase',p_phase,
  'rawSha256',p_raw,'decodedSha256',p_decoded,'verifiedBytes',p_verified,
  'digestState',case when p_state is null then 'null'::jsonb else to_jsonb(p_state) end); $$;
create function pg_temp.put(p_checkpoint jsonb,p_revision bigint,p_claim uuid default null,
 p_lease integer default 60,p_account uuid default '76500000-0000-4000-8000-000000000001',
 p_session uuid default '76500000-0000-4000-8000-000000000010') returns jsonb language sql as $$
 select public.write_own_upload_finalization_checkpoint_v1(p_account,p_session,pg_temp.upload_id(),
  coalesce(p_claim,pg_temp.claim()),p_revision,p_checkpoint,p_lease); $$;
create function pg_temp.get(p_claim uuid default null,
 p_account uuid default '76500000-0000-4000-8000-000000000001',
 p_session uuid default '76500000-0000-4000-8000-000000000010') returns jsonb language sql as $$
 select public.read_own_upload_finalization_checkpoint_v1(p_account,p_session,pg_temp.upload_id(),
  coalesce(p_claim,pg_temp.claim())); $$;

-- An absent checkpoint reads as revision zero, never as progress.
select is(pg_temp.get()->>'revision','0','an unstarted finalization has made no durable progress');
select is(pg_temp.get()->'checkpoint','null'::jsonb,'and carries no checkpoint body');

-- Authority is checked before any checkpoint is read or written.
select throws_ok($$select pg_temp.get(gen_random_uuid())$$,'42501','not_found',
 'a different claim cannot read this finalization''s progress');
select throws_ok($$select pg_temp.get(null,'76500000-0000-4000-8000-000000000002',
 '76500000-0000-4000-8000-000000000011')$$,'42501','not_found',
 'another account''s live session cannot read this finalization''s progress');
select throws_ok($$select pg_temp.put(pg_temp.mark('validated'),0,gen_random_uuid())$$,'42501','not_found',
 'a different claim cannot record progress');

-- A malformed checkpoint is refused before it can be stored.
select throws_ok($$select pg_temp.put(pg_temp.mark('validated')||'{"extra":1}'::jsonb,0)$$,
 '22023','invalid_checkpoint','an unknown key is refused');
select throws_ok($$select pg_temp.put(pg_temp.mark('validated')-'rawSha256',0)$$,
 '22023','invalid_checkpoint','a missing key is refused');
select throws_ok($$select pg_temp.put(pg_temp.mark('not-a-phase'),0)$$,
 '22023','invalid_checkpoint','an unknown phase is refused');
select throws_ok($$select pg_temp.put(pg_temp.mark('validated',0,null,repeat('A',64)),0)$$,
 '22023','invalid_checkpoint','an uppercase digest is not a hash this product writes');
select throws_ok($$select pg_temp.put(pg_temp.mark('validated',3),0)$$,
 '22023','invalid_checkpoint','a phase before verification cannot claim verified bytes');
select throws_ok($$select pg_temp.put(pg_temp.mark('verifying',3),0)$$,
 '22023','invalid_checkpoint','partial verification without resumable state is refused');
select throws_ok($$select pg_temp.put(pg_temp.mark('validated',0,repeat('Q',32)),0)$$,
 '22023','invalid_checkpoint','resumable state outside partial verification is refused');
select throws_ok($$select pg_temp.put(pg_temp.mark('verifying',99,repeat('Q',32)),0)$$,
 '22023','invalid_checkpoint','more verified bytes than the object holds is refused');
select throws_ok($$select pg_temp.put(pg_temp.mark('verified',3),0)$$,
 '22023','invalid_checkpoint','completed verification must cover the whole object');
select throws_ok($$select pg_temp.put(pg_temp.mark('validated',0,null,repeat('c',64)),0)$$,
 '22023','invalid_checkpoint','a raw hash unlike the browser declaration is refused');
select throws_ok($$select pg_temp.put(pg_temp.mark('validated'),0,null,0)$$,
 '22023','invalid_checkpoint','a lease outside the permitted window is refused');
select is((select count(*) from private.own_upload_finalization_checkpoints),0::bigint,
 'no refused checkpoint was stored');

-- Recording progress, and only forwards.
select is(pg_temp.put(pg_temp.mark('validated'),0)->>'revision','1','the validated pass is recorded once');
select is(pg_temp.get()->'checkpoint'->>'phase','validated','and reads back as the current phase');
select throws_ok($$select pg_temp.put(pg_temp.mark('copied'),0)$$,'40001','checkpoint_revision_conflict',
 'a stale revision cannot overwrite newer progress');
select throws_ok($$select pg_temp.put(pg_temp.mark('validated',0,null,repeat('a',64),repeat('d',64)),1)$$,
 '22023','checkpoint_regression','a different decoded hash is a different source, not a resumption');
select is(pg_temp.put(pg_temp.mark('copied'),1)->>'revision','2','the copy is recorded after validation');
select throws_ok($$select pg_temp.put(pg_temp.mark('validated'),2)$$,'22023','checkpoint_regression',
 'progress never moves back to an earlier phase');
select is(pg_temp.put(pg_temp.mark('verifying',4,repeat('Q',32)),2)->>'revision','3',
 'partial copy verification records its offset and resumable state');
select throws_ok($$select pg_temp.put(pg_temp.mark('verifying',2,repeat('Q',32)),3)$$,
 '22023','checkpoint_regression','a shorter verified prefix is refused');
select is(pg_temp.put(pg_temp.mark('verifying',8,repeat('Q',32)),3)->>'revision','4',
 'verification may advance to the whole object');
select is(pg_temp.put(pg_temp.mark('verified',8),4)->>'revision','5','completed verification drops its resumable state');
select is(pg_temp.get()->'checkpoint'->'digestState','null'::jsonb,'and stores no state it no longer needs');
select is(pg_temp.put(pg_temp.mark('staging-removed',8),5)->>'revision','6','staging removal is the last recorded phase');

-- The lease never outlives the session it belongs to.
select ok((select lease_expires_at<=(select expires_at from public.upload_sessions where id=pg_temp.upload_id())
 from private.own_upload_finalization_checkpoints where upload_id=pg_temp.upload_id()),
 'a checkpoint lease never outlives its upload session');

-- Reaching a terminal state retires the progress record and its hashes.
savepoint before_terminal;
update public.upload_sessions set status='rejected' where id=pg_temp.upload_id();
select is((select count(*) from private.own_upload_finalization_checkpoints where upload_id=pg_temp.upload_id()),
 0::bigint,'leaving validation retires the checkpoint and the hashes it held');
rollback to before_terminal;

-- Account deletion and the two-hour staging purge both remove the upload
-- session row. Declaring the cascade is what makes those existing manifests
-- sufficient, so no new purge target is needed; assert the declaration itself
-- rather than re-running a purge this test does not own.
select is((select confdeltype from pg_constraint
 where conrelid='private.own_upload_finalization_checkpoints'::regclass and contype='f'
  and confrelid='public.upload_sessions'::regclass),'c',
 'the checkpoint cascades with its upload session, so existing purges remove it');

-- No browser or upload role reaches any of this.
select ok(has_function_privilege('service_role','public.read_own_upload_finalization_checkpoint_v1(uuid,uuid,uuid,uuid)','execute')
 and has_function_privilege('service_role','public.write_own_upload_finalization_checkpoint_v1(uuid,uuid,uuid,uuid,bigint,jsonb,integer)','execute'),
 'the server role may record and read finalization progress');
select ok(not has_function_privilege('authenticated','public.read_own_upload_finalization_checkpoint_v1(uuid,uuid,uuid,uuid)','execute')
 and not has_function_privilege('anon','public.read_own_upload_finalization_checkpoint_v1(uuid,uuid,uuid,uuid)','execute')
 and not has_function_privilege('inherit_upload_only','public.read_own_upload_finalization_checkpoint_v1(uuid,uuid,uuid,uuid)','execute'),
 'no browser or upload role reads finalization progress');
select ok(not has_function_privilege('authenticated','public.write_own_upload_finalization_checkpoint_v1(uuid,uuid,uuid,uuid,bigint,jsonb,integer)','execute')
 and not has_function_privilege('anon','public.write_own_upload_finalization_checkpoint_v1(uuid,uuid,uuid,uuid,bigint,jsonb,integer)','execute')
 and not has_function_privilege('inherit_upload_only','public.write_own_upload_finalization_checkpoint_v1(uuid,uuid,uuid,uuid,bigint,jsonb,integer)','execute'),
 'no browser or upload role records finalization progress');
select ok((select relrowsecurity from pg_class where oid='private.own_upload_finalization_checkpoints'::regclass),
 'the checkpoint table keeps row level security enabled');
select is((select count(*) from public.genome_files where user_id='76500000-0000-4000-8000-000000000001'),0::bigint,
 'recording progress commits no file');

select * from finish();
rollback;
