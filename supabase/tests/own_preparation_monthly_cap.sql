-- The monthly admission cap on prepared-genome preparations, proved on a
-- fresh database with rollback-only synthetic identities. Three finalized
-- sources and a limit of two show admission, replay, refusal and raising the
-- limit; nothing here prepares bytes, claims a worker or reads a provider.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(31);
insert into private.upload_authorization_config(singleton,auth_issuer,maximum_array_bytes,maximum_vcf_bytes,
 maximum_account_bytes,maximum_active_uploads) values(true,'http://127.0.0.1:54321/auth/v1',52428800,52428800,1073741824,32)
 on conflict(singleton) do update set maximum_array_bytes=excluded.maximum_array_bytes,maximum_vcf_bytes=excluded.maximum_vcf_bytes;
-- Entirely synthetic, rollback-only identity and compressed-source metadata.
insert into auth.users(id,email,email_confirmed_at) values('89c10000-0000-4000-8000-000000000001','preparation-cap@example.invalid',clock_timestamp());
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('89c10000-0000-4000-8000-000000000010','89c10000-0000-4000-8000-000000000001',now(),now(),'aal1');
update public.profiles set date_of_birth=date '1990-01-01' where id='89c10000-0000-4000-8000-000000000001';
create temporary table generation_subject as select id from public.subjects
 where subject_account_id='89c10000-0000-4000-8000-000000000001' and subject_class='self';
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 select repeat(letter,64),'89c10000-0000-4000-8000-000000000001','89c10000-0000-4000-8000-000000000010',
 'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes' from unnest(array['a','b']) letter;
select public.sign_own_upload_artifact_v1('89c10000-0000-4000-8000-000000000001','89c10000-0000-4000-8000-000000000010',
 (select id from generation_subject),'disclosure.insurance-and-discrimination',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='disclosure.insurance-and-discrimination' and version=1),
 array['understood'],1,1,1,1,1,repeat('a',64));
select public.sign_own_upload_artifact_v1('89c10000-0000-4000-8000-000000000001','89c10000-0000-4000-8000-000000000010',
 (select id from generation_subject),'consent.upload-self',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.upload-self' and version=1),
 array['own-adult-dna'],1,1,1,1,1,repeat('b',64));
-- Keep the actual consent-bound session created by issuance/finalization.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local storage.allow_delete_query='true';
-- One actually issued and finalized source per admission attempt, through the
-- real RPCs with metadata-only Storage rows: the same fixture shape the
-- sibling preparation tests use. Distinct hashes keep the three sources apart.
create function pg_temp.make_source(raw text,decoded text) returns uuid language plpgsql as $$
declare issued jsonb; finalizing jsonb; finalized jsonb; oid uuid;
begin
 issued:=public.issue_own_storage_upload_v1('89c10000-0000-4000-8000-000000000001','89c10000-0000-4000-8000-000000000010',
  (select id from generation_subject),'VCF',8,raw);
 insert into storage.objects(bucket_id,name,owner_id,metadata) values('genomes',issued->>'stagingKey',
  '89c10000-0000-4000-8000-000000000001','{"size":8}');
 finalizing:=public.begin_own_upload_finalization_v1('89c10000-0000-4000-8000-000000000001','89c10000-0000-4000-8000-000000000010',
  (issued->>'uploadId')::uuid);
 insert into storage.objects(bucket_id,name,metadata) values('genomes',finalizing->>'finalKey','{"size":8}') returning id into oid;
 delete from storage.objects where bucket_id='genomes' and name=issued->>'stagingKey';
 finalized:=public.complete_own_upload_finalization_v1('89c10000-0000-4000-8000-000000000001','89c10000-0000-4000-8000-000000000010',
  (issued->>'uploadId')::uuid,(finalizing->>'claim')::uuid,oid,raw,decoded);
 return (finalized->>'fileId')::uuid;
end; $$;
create temporary table sources(ordinal integer primary key,file_id uuid not null);
insert into sources values(1,pg_temp.make_source(repeat('a',64),repeat('b',64)));
insert into sources values(2,pg_temp.make_source(repeat('c',64),repeat('d',64)));
insert into sources values(3,pg_temp.make_source(repeat('e',64),repeat('f',64)));
create temporary table cap_receipts(label text primary key,value jsonb);
grant select on sources to service_role;
grant select,insert,update on cap_receipts to service_role;
create function pg_temp.enqueue(n integer,account uuid default '89c10000-0000-4000-8000-000000000001') returns jsonb language sql as $$
 select public.enqueue_own_preparation_v1(account,'89c10000-0000-4000-8000-000000000010',(select file_id from sources where ordinal=n)); $$;
create function pg_temp.this_month() returns date language sql as $$
 select date_trunc('month',clock_timestamp() at time zone 'UTC')::date; $$;
create function pg_temp.admitted_this_month() returns integer language sql as $$
 select admitted from private.own_preparation_monthly_admissions where month_start=pg_temp.this_month(); $$;

-- The configuration value and the ledger it governs.
select is((select monthly_admission_limit from private.own_preparation_config where singleton),100,
 'the default monthly admission limit is 100');
select ok((select relrowsecurity from pg_class where oid='private.own_preparation_monthly_admissions'::regclass)
 and not exists(select 1 from pg_policy where polrelid='private.own_preparation_monthly_admissions'::regclass),
 'the admission ledger has row-level security and no policy');
select ok(not has_table_privilege('service_role','private.own_preparation_monthly_admissions','SELECT')
 and not has_table_privilege('authenticated','private.own_preparation_monthly_admissions','SELECT')
 and not has_table_privilege('anon','private.own_preparation_monthly_admissions','SELECT')
 and not has_table_privilege('inherit_upload_only','private.own_preparation_monthly_admissions','SELECT'),
 'no browser, upload or service role reads the admission ledger directly');
select is((select string_agg(column_name,',' order by ordinal_position) from information_schema.columns
 where table_schema='private' and table_name='own_preparation_monthly_admissions'),'month_start,admitted',
 'the ledger carries a month and a count, nothing about a person');
select throws_ok($$update private.own_preparation_config set monthly_admission_limit=0 where singleton$$,
 '23514',null,'a limit of zero is refused');
select throws_ok($$update private.own_preparation_config set monthly_admission_limit=100001 where singleton$$,
 '23514',null,'a limit above 100000 is refused');
select throws_ok($$insert into private.own_preparation_monthly_admissions(month_start) values(date '2026-09-15')$$,
 '23514',null,'a ledger key must be the first day of a month');
select throws_ok($$insert into private.own_preparation_monthly_admissions(month_start,admitted) values(date '2030-01-01',-1)$$,
 '23514',null,'a negative count is refused');
select is((select count(*)::integer from private.own_preparation_monthly_admissions),0,
 'no month row exists before the first admission');

-- Two admissions fit; the third is refused and changes nothing.
-- Enabled with the r2 provider: the supabase provider has no cleanup
-- capability, and enabling with it is refused once D-126's constraint lands.
update private.own_preparation_config set enabled=true,artifact_provider='r2',r2_bucket='inherit-prepared-test',monthly_admission_limit=2 where singleton;
set local role service_role;
insert into cap_receipts values('first',pg_temp.enqueue(1));
reset role;
select is(pg_temp.admitted_this_month(),1,'the first admission of the month counts one');
select is((select count(*)::integer from private.own_preparation_monthly_admissions where month_start=pg_temp.this_month()),1,
 'the one ledger row is keyed by the current UTC month');
set local role service_role;
select is(pg_temp.enqueue(1),(select value from cap_receipts where label='first'),
 'a replay for the queued file returns the same job and deadline');
reset role;
select is(pg_temp.admitted_this_month(),1,'a replay consumes no admission');
set local role service_role;
select throws_ok($$select pg_temp.enqueue(2,'89c10000-0000-4000-8000-000000000099')$$,'42501','not_found',
 'a foreign account is refused by source authority before the ledger');
reset role;
select is(pg_temp.admitted_this_month(),1,'a refused source consumes no admission');
set local role service_role;
insert into cap_receipts values('second',pg_temp.enqueue(2));
reset role;
select is(pg_temp.admitted_this_month(),2,'the second admission counts two');
create temporary table refused_source as select md5(to_jsonb(f)::text) fingerprint from public.genome_files f
 where f.id=(select file_id from sources where ordinal=3);
set local role service_role;
select throws_ok($$select pg_temp.enqueue(3)$$,'53400','preparation_capacity_reached',
 'the admission past the limit is refused with the registered code and message');
reset role;
select is(pg_temp.admitted_this_month(),2,'a refusal leaves the count unchanged');
select is((select count(*)::integer from private.own_preparation_jobs where file_id=(select file_id from sources where ordinal=3)),0,
 'a refused file has no job');
select is((select md5(to_jsonb(f)::text) from public.genome_files f where f.id=(select file_id from sources where ordinal=3)),
 (select fingerprint from refused_source),'the refused source row is kept byte-identical');
set local role service_role;
select is(pg_temp.enqueue(1),(select value from cap_receipts where label='first'),
 'a queued file still replays after the month is full');
select throws_ok($$select pg_temp.enqueue(3)$$,'53400','preparation_capacity_reached',
 'the refusal repeats while the month stays full');
reset role;
select is(pg_temp.admitted_this_month(),2,'repeated refusals still change nothing');

-- The owner raises the private value; the next admission fits.
update private.own_preparation_config set monthly_admission_limit=3 where singleton;
set local role service_role;
insert into cap_receipts values('third',pg_temp.enqueue(3));
reset role;
select is(pg_temp.admitted_this_month(),3,'raising the limit admits the next file');
select is((select count(*)::integer from private.own_preparation_jobs where file_id in(select file_id from sources)),3,
 'one job exists per admitted file');

-- A new month starts from zero: no row until its first admission, then the default.
select is((select admitted from private.own_preparation_monthly_admissions
 where month_start=(pg_temp.this_month()+interval '1 month')::date),null::integer,
 'next month has no row until its first admission');
insert into private.own_preparation_monthly_admissions(month_start) values((pg_temp.this_month()+interval '1 month')::date);
select is((select admitted from private.own_preparation_monthly_admissions
 where month_start=(pg_temp.this_month()+interval '1 month')::date),0,'a new month row starts at zero');

-- Existing refusals keep their place ahead of the cap, and the service path is unchanged.
update private.own_preparation_config set enabled=false where singleton;
set local role service_role;
select throws_ok($$select pg_temp.enqueue(3)$$,'55000','preparation_disabled','the disabled gate still answers first');
reset role;
select is(pg_temp.admitted_this_month(),3,'the disabled gate consumes no admission');
select ok((select not prosecdef from pg_proc where oid='public.enqueue_own_preparation_v1(uuid,uuid,uuid)'::regprocedure)
 and (select prosecdef from pg_proc where oid='private.enqueue_own_preparation_v1(uuid,uuid,uuid)'::regprocedure),
 'the public invoker still delegates to the private definer');
select ok(has_function_privilege('service_role','public.enqueue_own_preparation_v1(uuid,uuid,uuid)','EXECUTE')
 and not has_function_privilege('anon','public.enqueue_own_preparation_v1(uuid,uuid,uuid)','EXECUTE')
 and not has_function_privilege('authenticated','public.enqueue_own_preparation_v1(uuid,uuid,uuid)','EXECUTE')
 and not has_function_privilege('inherit_upload_only','public.enqueue_own_preparation_v1(uuid,uuid,uuid)','EXECUTE'),
 'only the service role reaches enqueue');
select * from finish();
rollback;
