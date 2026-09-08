begin;
select no_plan();
-- All synthetic fixtures roll back. No large insert, sleep, timeout changes,
-- provider calls, or writes to pre-existing sources are part of this proof.

select is((select setting from pg_proc p cross join lateral unnest(p.proconfig) setting
 where p.oid='public.own_upload_normalization_v1(text,uuid,uuid,uuid,uuid,jsonb)'::regprocedure
 and setting like 'statement_timeout=%'),'statement_timeout=45s',
 'only the exposed normalization wrapper advertises the finite 45-second API budget');
select ok(not exists(select 1 from pg_proc p cross join lateral unnest(p.proconfig) setting
 where p.oid='private.own_upload_normalization_v1(text,uuid,uuid,uuid,uuid,jsonb)'::regprocedure
 and setting like 'statement_timeout=%'),
 'the private dispatcher has no timeout override or changed claim budget');
select ok((select not prosecdef and 'search_path=pg_catalog'=any(proconfig) from pg_proc
 where oid='public.own_upload_normalization_v1(text,uuid,uuid,uuid,uuid,jsonb)'::regprocedure),
 'the exposed wrapper remains invoker with its fixed search path');
select ok((select prosecdef and 'search_path=pg_catalog, private'=any(proconfig) from pg_proc
 where oid='private.own_upload_normalization_v1(text,uuid,uuid,uuid,uuid,jsonb)'::regprocedure),
 'the private authority dispatcher retains its definer boundary and fixed search path');
select ok((select prosecdef and 'search_path=""'=any(proconfig) from pg_proc
 where oid='private.enforce_subject_variant_chromosome()'::regprocedure),
 'the chromosome guard retains its definer boundary and empty search path');
select ok(has_function_privilege('service_role','public.own_upload_normalization_v1(text,uuid,uuid,uuid,uuid,jsonb)','EXECUTE'),
 'service retains the existing normalization entrypoint');
select ok(not has_function_privilege(role_name,'public.own_upload_normalization_v1(text,uuid,uuid,uuid,uuid,jsonb)','EXECUTE'),
 role_name||' still cannot call the normalization API')
 from unnest(array['anon','authenticated','inherit_upload_only']) role_name;
select ok(not has_function_privilege(role_name,'private.own_upload_normalization_v1(text,uuid,uuid,uuid,uuid,jsonb)','EXECUTE'),
 role_name||' still cannot call the private normalization dispatcher')
 from unnest(array['anon','authenticated','inherit_upload_only']) role_name;
select ok((select tgfoid='private.enforce_subject_variant_chromosome()'::regprocedure
 and tgtype=23 and tgenabled='O' from pg_trigger
 where tgrelid='public.user_variants'::regclass and tgname='user_variants_embryo_autosomal_only'),
 'the real variant table retains its enabled BEFORE INSERT/UPDATE row trigger');

insert into auth.users(id,email) values
 ('77980000-0000-4000-8000-000000000001','normalization-budget@e2e.local');
create temporary table capacity_subject as select id from public.subjects
 where subject_account_id='77980000-0000-4000-8000-000000000001' and subject_class='self';
insert into public.embryo_cohort_drafts(id,owner_account_id,uploader_principal_id,upload_class,basis_case,embryo_count,state,fixed_expires_at)
 select '77980000-0000-4000-8000-000000000003','77980000-0000-4000-8000-000000000001',id,
 'embryo_own','true_two_parent',1,'ready',clock_timestamp()+interval '30 days'
 from public.subject_principals where account_id='77980000-0000-4000-8000-000000000001' and principal_kind='account_subject';
insert into public.embryo_cohorts(id,draft_id,owner_account_id,upload_class,basis_case,basis_revision,participant_set_revision,donor_attribution_revision,embryo_count,retention_expires_at)
 values('77980000-0000-4000-8000-000000000004','77980000-0000-4000-8000-000000000003','77980000-0000-4000-8000-000000000001',
 'embryo_own','true_two_parent',1,1,1,1,clock_timestamp()+interval '30 days');
insert into public.subjects(id,owner_account_id,subject_class,upload_class,display_label,lifecycle,cohort_id)
 values('77980000-0000-4000-8000-000000000005','77980000-0000-4000-8000-000000000001','embryo','embryo_own','Synthetic embryo','active',
 '77980000-0000-4000-8000-000000000004');

-- Exercise the actual unchanged trigger ABI with real subject rows. The temp
-- table isolates the chromosome rule; actual source FK/ownership/normalization
-- publication is covered by own_upload_normalization.sql and its live journey.
create temporary table capacity_guard_rows(id integer primary key,subject_id uuid,chrom smallint);
create trigger capacity_chromosome_guard before insert or update of subject_id,chrom on capacity_guard_rows
 for each row execute function private.enforce_subject_variant_chromosome();
select lives_ok($$insert into capacity_guard_rows select n,(select id from capacity_subject),n::smallint from generate_series(1,25) n$$,
 'self-source chromosomes1 through25 retain the existing allowed behavior');
select lives_ok($$insert into capacity_guard_rows select 100+n,'77980000-0000-4000-8000-000000000005',n::smallint from generate_series(1,22) n$$,
 'every autosome remains allowed for embryo rows');
select throws_ok(format('insert into capacity_guard_rows values (%s,%L,%s)',200+chrom,'77980000-0000-4000-8000-000000000005',chrom),
 '23514','non-autosomal embryo variant forbidden','embryo chromosome'||chrom||' remains rejected')
 from unnest(array[-1,0,23,24,25,26]) chrom;
select throws_ok($$update capacity_guard_rows set chrom=23 where id=101$$,
 '23514','non-autosomal embryo variant forbidden','updating an embryo row to chromosomeX remains rejected');
select is((select chrom::integer from capacity_guard_rows where id=101),1,
 'a rejected chromosome update preserves the original row');
select throws_ok($$update capacity_guard_rows set subject_id='77980000-0000-4000-8000-000000000005' where id=23$$,
 '23514','non-autosomal embryo variant forbidden','changing a non-autosomal self row to an embryo remains rejected');
select is((select subject_id from capacity_guard_rows where id=23),(select id from capacity_subject),
 'a rejected subject update preserves the original subject');
select lives_ok($$update capacity_guard_rows set subject_id='77980000-0000-4000-8000-000000000005' where id=1$$,
 'changing an autosomal row to an embryo still passes the chromosome rule');
select throws_ok($$insert into capacity_guard_rows values
 (301,'77980000-0000-4000-8000-000000000005',2),(302,'77980000-0000-4000-8000-000000000005',24)$$,
 '23514','non-autosomal embryo variant forbidden','a mixed bulk insert rejects its non-autosomal embryo member');
select is((select count(*) from capacity_guard_rows where id in(301,302)),0::bigint,
 'a mixed bulk failure publishes none of the statement rows');

-- Genuine store-authorized one-row preparation; only test deadlines are short.
insert into private.upload_authorization_config(singleton,auth_issuer,maximum_array_bytes,maximum_vcf_bytes,
 maximum_account_bytes,maximum_active_uploads) values(true,'http://127.0.0.1:54321/auth/v1',52428800,52428800,1073741824,32)
 on conflict(singleton) do update set maximum_array_bytes=excluded.maximum_array_bytes,maximum_vcf_bytes=excluded.maximum_vcf_bytes;
insert into auth.users(id,email) values('77990000-0000-4000-8000-000000000001','normalization-deadline@e2e.local');
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('77990000-0000-4000-8000-000000000010','77990000-0000-4000-8000-000000000001',now(),now(),'aal1');
update public.profiles set date_of_birth=date '1990-01-01' where id='77990000-0000-4000-8000-000000000001';
create temporary table normalization_subject as select id from public.subjects
 where subject_account_id='77990000-0000-4000-8000-000000000001' and subject_class='self';
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 select repeat(letter,64),'77990000-0000-4000-8000-000000000001','77990000-0000-4000-8000-000000000010',
 'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes' from unnest(array['a','b']) letter;
select public.sign_own_upload_artifact_v1('77990000-0000-4000-8000-000000000001','77990000-0000-4000-8000-000000000010',
 (select id from normalization_subject),'disclosure.insurance-and-discrimination',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='disclosure.insurance-and-discrimination' and version=1),
 array['understood'],1,1,1,1,1,repeat('a',64));
select public.sign_own_upload_artifact_v1('77990000-0000-4000-8000-000000000001','77990000-0000-4000-8000-000000000010',
 (select id from normalization_subject),'consent.upload-self',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.upload-self' and version=1),
 array['own-adult-dna'],1,1,1,1,1,repeat('b',64));
insert into storage.objects(id,bucket_id,name,metadata) values('77990000-0000-4000-8000-000000000020',
 'genomes','77990000-0000-4000-8000-000000000030','{"size":8}');
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,sha256,status,
 upload_revision,structural_validator_version,single_logical_sample_verified_at,source_sha256,storage_object_id)
 values('77990000-0000-4000-8000-000000000040','77990000-0000-4000-8000-000000000001',(select id from normalization_subject),
 '77990000-0000-4000-8000-000000000030','Genome file','vcf',1,8,repeat('a',64),'uploaded',1,
 'single-logical-sample-v1',clock_timestamp(),repeat('b',64),'77990000-0000-4000-8000-000000000020');
insert into public.genome_storage_objects(object_id,object_name,bucket_id,genome_file_id,sha256,byte_count,object_revision,state)
 values('77990000-0000-4000-8000-000000000020','77990000-0000-4000-8000-000000000030','genomes',
 '77990000-0000-4000-8000-000000000040',repeat('a',64),8,1,'current');
create temporary table normalization_manifest(receipt jsonb);
create function pg_temp.normalize(op text,payload jsonb default null) returns jsonb language sql as $$
 select public.own_upload_normalization_v1(op,'77990000-0000-4000-8000-000000000001',
 '77990000-0000-4000-8000-000000000010','77990000-0000-4000-8000-000000000040',
 case when op='begin' then null else (select (receipt->>'claim')::uuid from normalization_manifest) end,payload);
$$;
insert into normalization_manifest select pg_temp.normalize('begin');

select pg_temp.normalize('stage','{"kind":"variants","sequence":0,"rows":[{"rsid":123,"chrom":1,"pos":100000,"ref":"A","alt":"G","genotype":"A/G"}]}');
create temporary table capacity_deadline_mode(kind text not null);
insert into capacity_deadline_mode values('lease');
create temporary sequence capacity_insert_entered;
create function pg_temp.wait_past_capacity_deadline() returns trigger language plpgsql as $$
declare deadline timestamptz; wait_seconds double precision;
begin
 case (select kind from capacity_deadline_mode)
 when 'lease' then select expires_at into deadline from private.own_normalization_runs where file_id=new.file_id;
 when 'session' then select not_after into deadline from auth.sessions where id='77990000-0000-4000-8000-000000000010';
 when 'consent' then null;
 end case;
 if (select kind from capacity_deadline_mode)='consent' then
  select sc.expires_at into deadline from private.own_normalization_runs r join public.subject_consents sc
   on sc.id=(r.authority->>'uploadConsentId')::uuid where r.file_id=new.file_id;
 end if;
 wait_seconds:=extract(epoch from deadline-clock_timestamp());
 if deadline is null or wait_seconds<0 or wait_seconds>3 then
  raise exception 'capacity deadline fixture did not enter before its bounded deadline'; end if;
 -- Sequence advancement survives throws_ok's subtransaction rollback, proving
 -- this failed inside publication rather than at the initial expired guard.
 perform nextval('pg_temp.capacity_insert_entered');
 perform pg_sleep(wait_seconds+0.01);
 return new;
end;
$$;
create trigger capacity_complete_deadline_probe after insert on public.user_variants
 for each row when (new.file_id='77990000-0000-4000-8000-000000000040'::uuid)
 execute function pg_temp.wait_past_capacity_deadline();
create function pg_temp.complete_capacity_source() returns jsonb language sql as $$
 select pg_temp.normalize('complete',jsonb_build_object('sourceBuild','GRCh38','rawSha256',repeat('a',64),
 'decodedSha256',repeat('b',64),'variantCount',1,'observedCallCount',0,'provenance','{}'::jsonb));
$$;

update private.own_normalization_runs set expires_at=clock_timestamp()+interval '5 minutes' where file_id='77990000-0000-4000-8000-000000000040';
update auth.sessions set not_after=null where id='77990000-0000-4000-8000-000000000010';
update public.subject_consents set expires_at=null where account_id='77990000-0000-4000-8000-000000000001' and consent_type='upload_class';
update capacity_deadline_mode set kind='lease';
select setval('pg_temp.capacity_insert_entered',1,false);
update private.own_normalization_runs set expires_at=clock_timestamp()+interval '2 seconds' where file_id='77990000-0000-4000-8000-000000000040';
select throws_ok($$select pg_temp.complete_capacity_source()$$,'42501','not_found',
 'lease expiry crossed during publication prevents completion');
select ok((select is_called from capacity_insert_entered),'lease expiry test reached the real bulk insertion before expiring');
select is((select count(*) from public.user_variants where file_id='77990000-0000-4000-8000-000000000040'),0::bigint,
 'lease expiry rolls back every provisional public row');
select ok((select status='parsing' and normalization_completed_at is null from public.genome_files where id='77990000-0000-4000-8000-000000000040'),
 'lease expiry cannot mark the source prepared');
select is((select count(*) from private.own_normalization_batches where file_id='77990000-0000-4000-8000-000000000040'),1::bigint,
 'lease expiry leaves the exact private staged batch for ordinary failure cleanup');

update private.own_normalization_runs set expires_at=clock_timestamp()+interval '5 minutes' where file_id='77990000-0000-4000-8000-000000000040';
update auth.sessions set not_after=null where id='77990000-0000-4000-8000-000000000010';
update public.subject_consents set expires_at=null where account_id='77990000-0000-4000-8000-000000000001' and consent_type='upload_class';
update capacity_deadline_mode set kind='session';
select setval('pg_temp.capacity_insert_entered',1,false);
update auth.sessions set not_after=clock_timestamp()+interval '2 seconds' where id='77990000-0000-4000-8000-000000000010';
select throws_ok($$select pg_temp.complete_capacity_source()$$,'42501','not_found',
 'session expiry crossed during publication prevents completion');
select ok((select is_called from capacity_insert_entered),'session expiry test reached the real bulk insertion before expiring');
select is((select count(*) from public.user_variants where file_id='77990000-0000-4000-8000-000000000040'),0::bigint,
 'session expiry rolls back every provisional public row');
select ok((select status='parsing' and normalization_completed_at is null from public.genome_files where id='77990000-0000-4000-8000-000000000040'),
 'session expiry cannot mark the source prepared');
select is((select count(*) from private.own_normalization_batches where file_id='77990000-0000-4000-8000-000000000040'),1::bigint,
 'session expiry leaves the exact private staged batch for ordinary failure cleanup');

update private.own_normalization_runs set expires_at=clock_timestamp()+interval '5 minutes' where file_id='77990000-0000-4000-8000-000000000040';
update auth.sessions set not_after=null where id='77990000-0000-4000-8000-000000000010';
update public.subject_consents set expires_at=null where account_id='77990000-0000-4000-8000-000000000001' and consent_type='upload_class';
update capacity_deadline_mode set kind='consent';
select setval('pg_temp.capacity_insert_entered',1,false);
update public.subject_consents set expires_at=clock_timestamp()+interval '2 seconds' where account_id='77990000-0000-4000-8000-000000000001' and consent_type='upload_class';
select throws_ok($$select pg_temp.complete_capacity_source()$$,'55000','upload_consent_required',
 'consent expiry crossed during publication prevents completion');
select ok((select is_called from capacity_insert_entered),'consent expiry test reached the real bulk insertion before expiring');
select is((select count(*) from public.user_variants where file_id='77990000-0000-4000-8000-000000000040'),0::bigint,
 'consent expiry rolls back every provisional public row');
select ok((select status='parsing' and normalization_completed_at is null from public.genome_files where id='77990000-0000-4000-8000-000000000040'),
 'consent expiry cannot mark the source prepared');
select is((select count(*) from private.own_normalization_batches where file_id='77990000-0000-4000-8000-000000000040'),1::bigint,
 'consent expiry leaves the exact private staged batch for ordinary failure cleanup');

-- Remove only the rollback fixture trigger, then prove the very same staged
-- source can publish under its still-matching live authority and claim.
drop trigger capacity_complete_deadline_probe on public.user_variants;
update private.own_normalization_runs set expires_at=clock_timestamp()+interval '5 minutes' where file_id='77990000-0000-4000-8000-000000000040';
update auth.sessions set not_after=null where id='77990000-0000-4000-8000-000000000010';
update public.subject_consents set expires_at=null where account_id='77990000-0000-4000-8000-000000000001' and consent_type='upload_class';
select is(pg_temp.complete_capacity_source()->>'status','normalization_complete','a live exact source still completes after the terminal recheck');
select is((select count(*) from public.user_variants where file_id='77990000-0000-4000-8000-000000000040'),1::bigint,
 'successful publication retains the original one-row completion behavior');
select * from finish();
rollback;
