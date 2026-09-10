-- Revocation is immediate at the row-level-security layer.
--
-- G1.6 and G5.3a both name the same guarantee in the same words: "a revoked
-- grant returns zero rows on the first request after the revocation commits."
-- That is an access-time promise, not a deletion promise -- G5.3a gives hard
-- deletion seven days -- so proving it means reading through the policy before
-- and after the withdrawal and getting one row and then none, with nothing in
-- between.
--
-- `own_analysis_read_authority.sql` already proves the *resolver* refuses after
-- withdrawal, by calling `private.current_own_report_grant_read_v1` directly.
-- This file asserts the layer above it: an ordinary `select` issued as the
-- signed-in owner, over `user_prs` and `ancestry_results`, through the real
-- `own_prs_live_purpose` and `own_ancestry_live_purpose` policies. The two are
-- not the same claim. A resolver can fail closed while a second permissive
-- policy on the same table keeps the rows visible -- `user_prs` carries
-- `user_prs_select_own` alongside the purpose policy, and permissive policies
-- OR together -- so the resolver returning "no" does not by itself mean the
-- reader sees nothing. The only way to know is to read the table.
--
-- The order matters and is the point. Every assertion after the revocation runs
-- in the same transaction, on the statement immediately following it, with no
-- reconnection, no cache flush and no job in between. If revocation depended on
-- a purge running later, the read below would still return a row.
--
-- Synthetic accounts, synthetic variants, a synthetic score. All rolls back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- Fixture: one prepared file, one granted purpose, one generated result --------
insert into private.upload_authorization_config(singleton,auth_issuer,maximum_array_bytes,
 maximum_vcf_bytes,maximum_account_bytes,maximum_active_uploads)
 values(true,'http://127.0.0.1:54321/auth/v1',52428800,52428800,1073741824,32)
 on conflict(singleton) do update set maximum_array_bytes=excluded.maximum_array_bytes,
 maximum_vcf_bytes=excluded.maximum_vcf_bytes;

insert into auth.users(id,email) values
 ('aa200000-0000-4000-8000-000000000001','revocation-owner@example.invalid'),
 ('aa200000-0000-4000-8000-000000000002','revocation-stranger@example.invalid');
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('aa200000-0000-4000-8000-000000000010','aa200000-0000-4000-8000-000000000001',now(),now(),'aal1'),
 ('aa200000-0000-4000-8000-000000000012','aa200000-0000-4000-8000-000000000002',now(),now(),'aal1');
update public.profiles set date_of_birth=date '1990-01-01'
 where id in('aa200000-0000-4000-8000-000000000001','aa200000-0000-4000-8000-000000000002');

create temporary table subj as select id from public.subjects
 where subject_account_id='aa200000-0000-4000-8000-000000000001' and subject_class='self';

insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 select repeat(letter,64),'aa200000-0000-4000-8000-000000000001','aa200000-0000-4000-8000-000000000010',
 'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes' from unnest(array['a','b']) letter;
select public.sign_own_upload_artifact_v1('aa200000-0000-4000-8000-000000000001',
 'aa200000-0000-4000-8000-000000000010',(select id from subj),
 'disclosure.insurance-and-discrimination',1,
 (select body_sha256 from public.consent_artifacts
   where artifact_key='disclosure.insurance-and-discrimination' and version=1),
 array['understood'],1,1,1,1,1,repeat('a',64));
select public.sign_own_upload_artifact_v1('aa200000-0000-4000-8000-000000000001',
 'aa200000-0000-4000-8000-000000000010',(select id from subj),
 'consent.upload-self',1,
 (select body_sha256 from public.consent_artifacts
   where artifact_key='consent.upload-self' and version=1),
 array['own-adult-dna'],1,1,1,1,1,repeat('b',64));

insert into storage.objects(id,bucket_id,name,metadata)
 values('aa200000-0000-4000-8000-000000000020','genomes','aa200000-0000-4000-8000-000000000030','{"size":8}');
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,
 size_bytes,sha256,status,upload_revision,structural_validator_version,
 single_logical_sample_verified_at,source_sha256,storage_object_id)
 select 'aa200000-0000-4000-8000-000000000040','aa200000-0000-4000-8000-000000000001',
 (select id from subj),'aa200000-0000-4000-8000-000000000030','owner.vcf','vcf',1,8,repeat('a',64),
 'uploaded',1,'single-logical-sample-v1',clock_timestamp(),repeat('b',64),
 'aa200000-0000-4000-8000-000000000020';
insert into public.genome_storage_objects(object_id,object_name,bucket_id,genome_file_id,
 sha256,byte_count,object_revision,state)
 values('aa200000-0000-4000-8000-000000000020','aa200000-0000-4000-8000-000000000030','genomes',
 'aa200000-0000-4000-8000-000000000040',repeat('a',64),8,1,'current');

create temporary table manifest(receipt jsonb);
create function pg_temp.normalize(op text,payload jsonb default null) returns jsonb language sql as $$
 select public.own_upload_normalization_v1(op,'aa200000-0000-4000-8000-000000000001',
 'aa200000-0000-4000-8000-000000000010','aa200000-0000-4000-8000-000000000040',
 case when op='begin' then null else (select (receipt->>'claim')::uuid from manifest) end,payload);
$$;
insert into manifest select pg_temp.normalize('begin');
select pg_temp.normalize('stage',
 '{"kind":"variants","sequence":0,"rows":[{"rsid":4242,"chrom":1,"pos":100000,"ref":"A","alt":"G","genotype":"A/G"}]}');
select pg_temp.normalize('complete',jsonb_build_object('sourceBuild','GRCh38','rawSha256',repeat('a',64),
 'decodedSha256',repeat('b',64),'variantCount',1,'observedCallCount',0,'provenance','{}'::jsonb));

insert into public.report_templates(slug,category,title,summary,evidence,estimate_kind,variants,citations)
 values('revocation-fixture','basic-traits','Fixture','Rollback-only revocation fixture.','emerging','single_locus',
 '[{"rsid":4242,"gene":"X","chrom":1,"pos38":100000,"ref":"A","alt":"G","interpretations":{"AA":"x","AG":"y","GG":"z"}}]',
 '[{"pmid":"12345678","label":"fixture"}]');
insert into public.prs_scores(pgs_id,name,trait,n_variants,citation,source_url,ancestry_note)
 values('REVOCATION-FIXTURE','Fixture','Fixture',1,'{}',
 'https://example.invalid/fixture','Synthetic fixture only, not a published score.')
 on conflict(pgs_id) do nothing;

select public.grant_own_report_purpose_v1('aa200000-0000-4000-8000-000000000001',
 'aa200000-0000-4000-8000-000000000010',(select id from subj),
 public.own_report_context_v1('aa200000-0000-4000-8000-000000000001',
  'aa200000-0000-4000-8000-000000000010',(select id from subj)),
 'reports.polygenic',2,
 (select body_sha256 from public.consent_artifacts
   where artifact_key='consent.own-polygenic' and version=2),
 repeat('c',64),clock_timestamp()+interval '9 minutes');

create temporary table generation as select public.own_report_generation_v1('begin',
 'aa200000-0000-4000-8000-000000000001','aa200000-0000-4000-8000-000000000010',
 'aa200000-0000-4000-8000-000000000040','reports.polygenic') as receipt;
select public.own_report_generation_v1('complete','aa200000-0000-4000-8000-000000000001',
 'aa200000-0000-4000-8000-000000000010','aa200000-0000-4000-8000-000000000040','reports.polygenic',
 (select (receipt->>'claim')::uuid from generation),
 '{"reports":[{"slug":"revocation-fixture","status":"resolved"}],
   "prs":[{"pgs_id":"REVOCATION-FIXTURE","raw_score":0,"coverage":1,"matched":1}]}');

create temporary table live_grant as select grant_id from public.purpose_grants
 where target_id=(select id from subj) and purpose='reports.polygenic' and revoked_at is null;
select is((select count(*)::integer from live_grant),1,'exactly one live polygenic purpose exists to revoke');

-- Before revocation: the owner reads, and only the owner ----------------------
-- If this block ever went quiet the file would still "pass" its post-revocation
-- zeroes while proving nothing, so it is the load-bearing half.
do $$ begin perform set_config('request.jwt.claims',
 '{"sub":"aa200000-0000-4000-8000-000000000001","session_id":"aa200000-0000-4000-8000-000000000010","role":"authenticated"}',
 true); end $$;
set local role authenticated;
select ok(private.own_stored_analysis_readable_v1('aa200000-0000-4000-8000-000000000040','reports.polygenic'),
 'before revocation the polygenic read predicate admits the owner');
select is((select count(*) from public.user_prs where file_id='aa200000-0000-4000-8000-000000000040'),1::bigint,
 'before revocation an ordinary select returns the owner''s polygenic row through the live policy');
reset role;

do $$ begin perform set_config('request.jwt.claims',
 '{"sub":"aa200000-0000-4000-8000-000000000002","session_id":"aa200000-0000-4000-8000-000000000012","role":"authenticated"}',
 true); end $$;
set local role authenticated;
select is(private.own_stored_analysis_readable_v1('aa200000-0000-4000-8000-000000000040','reports.polygenic'),false,
 'a live grant is the owner''s alone: a stranger is refused while it is live');
select is((select count(*) from public.user_prs where file_id='aa200000-0000-4000-8000-000000000040'),0::bigint,
 'and a stranger''s select over the same file returns nothing while the grant is live');
reset role;

do $$ begin perform set_config('request.jwt.claims','{"role":"anon"}',true); end $$;
set local role anon;
select throws_ok($$select count(*) from public.user_prs$$,'42501',null,
 'anon cannot reach polygenic results at all, granted or not');
select is((select count(*) from public.ancestry_results),0::bigint,
 'anon reads no ancestry result while the polygenic grant is live');
reset role;

-- Revoke ----------------------------------------------------------------------
select isnt(public.revoke_directional_purpose_v1('aa200000-0000-4000-8000-000000000001',
 (select grant_id from live_grant)),null,'the owner withdraws the purpose they granted');
select ok((select revoked_at is not null from public.purpose_grants
 where grant_id=(select grant_id from live_grant) order by grant_revision desc limit 1),
 'the grant is stamped revoked');

-- After revocation: the very next statement ------------------------------------
do $$ begin perform set_config('request.jwt.claims',
 '{"sub":"aa200000-0000-4000-8000-000000000001","session_id":"aa200000-0000-4000-8000-000000000010","role":"authenticated"}',
 true); end $$;
set local role authenticated;
select is(private.own_stored_analysis_readable_v1('aa200000-0000-4000-8000-000000000040','reports.polygenic'),false,
 'the first read after revocation is refused by the predicate');
select is((select count(*) from public.user_prs where file_id='aa200000-0000-4000-8000-000000000040'),0::bigint,
 'the first ordinary select after revocation returns zero rows, with no purge in between');
select is((select count(*) from public.user_prs),0::bigint,
 'and no polygenic row of any file is reachable by the previously authorised reader');
select is((select count(*) from public.ancestry_results where file_id='aa200000-0000-4000-8000-000000000040'),0::bigint,
 'the ancestry purpose was never granted, so it reads zero before and after');
reset role;

-- Revocation does not become a denial of everything ----------------------------
-- A revocation that also removed the owner's canonical source would pass every
-- zero above while being a data-loss bug, so the boundary is asserted too:
-- withdrawing the analytic purpose leaves the file and its variant calls alone.
select is((select count(*) from public.genome_files where id='aa200000-0000-4000-8000-000000000040'),1::bigint,
 'withdrawal leaves the owner''s genome file in place');
select is((select count(*) from public.user_variants where file_id='aa200000-0000-4000-8000-000000000040'),1::bigint,
 'withdrawal leaves the owner''s canonical variant calls in place');
do $$ begin perform set_config('request.jwt.claims',
 '{"sub":"aa200000-0000-4000-8000-000000000001","session_id":"aa200000-0000-4000-8000-000000000010","role":"authenticated"}',
 true); end $$;
set local role authenticated;
select is((select count(*) from public.genome_files where id='aa200000-0000-4000-8000-000000000040'),1::bigint,
 'and the owner can still read that file after withdrawing the analytic purpose');
reset role;

-- Re-granting is the other direction of the same switch ------------------------
-- Without this, a policy hard-wired to deny after any revocation would pass
-- every assertion above.
--
-- A fresh grant on its own is deliberately not enough, and finding that out is
-- worth recording: withdrawal purged the generated results, and the predicate
-- also requires a completed generation that matches the *current* grant, so
-- re-consenting does not resurrect what the withdrawal removed. The owner has
-- to grant and then generate again. That is the correct behaviour and it is
-- asserted in both halves below, so a future change that let a bare re-grant
-- expose the old rows would fail here.
select public.grant_own_report_purpose_v1('aa200000-0000-4000-8000-000000000001',
 'aa200000-0000-4000-8000-000000000010',(select id from subj),
 public.own_report_context_v1('aa200000-0000-4000-8000-000000000001',
  'aa200000-0000-4000-8000-000000000010',(select id from subj)),
 'reports.polygenic',2,
 (select body_sha256 from public.consent_artifacts
   where artifact_key='consent.own-polygenic' and version=2),
 repeat('d',64),clock_timestamp()+interval '9 minutes');
do $$ begin perform set_config('request.jwt.claims',
 '{"sub":"aa200000-0000-4000-8000-000000000001","session_id":"aa200000-0000-4000-8000-000000000010","role":"authenticated"}',
 true); end $$;
set local role authenticated;
select is(private.own_stored_analysis_readable_v1('aa200000-0000-4000-8000-000000000040','reports.polygenic'),false,
 're-consenting alone does not resurrect the purged results');
select is((select count(*) from public.user_prs where file_id='aa200000-0000-4000-8000-000000000040'),0::bigint,
 'and the purged polygenic rows stay gone under the fresh grant');
reset role;

create temporary table regeneration as select public.own_report_generation_v1('begin',
 'aa200000-0000-4000-8000-000000000001','aa200000-0000-4000-8000-000000000010',
 'aa200000-0000-4000-8000-000000000040','reports.polygenic') as receipt;
select public.own_report_generation_v1('complete','aa200000-0000-4000-8000-000000000001',
 'aa200000-0000-4000-8000-000000000010','aa200000-0000-4000-8000-000000000040','reports.polygenic',
 (select (receipt->>'claim')::uuid from regeneration),
 '{"reports":[{"slug":"revocation-fixture","status":"resolved"}],
   "prs":[{"pgs_id":"REVOCATION-FIXTURE","raw_score":0,"coverage":1,"matched":1}]}');
do $$ begin perform set_config('request.jwt.claims',
 '{"sub":"aa200000-0000-4000-8000-000000000001","session_id":"aa200000-0000-4000-8000-000000000010","role":"authenticated"}',
 true); end $$;
set local role authenticated;
select ok(private.own_stored_analysis_readable_v1('aa200000-0000-4000-8000-000000000040','reports.polygenic'),
 'granting again and generating again re-admits the owner, so the denial tracked the grant and not the clock');
select is((select count(*) from public.user_prs where file_id='aa200000-0000-4000-8000-000000000040'),1::bigint,
 'and an ordinary select returns the freshly generated row');
reset role;
do $$ begin perform set_config('request.jwt.claims',
 '{"sub":"aa200000-0000-4000-8000-000000000002","session_id":"aa200000-0000-4000-8000-000000000012","role":"authenticated"}',
 true); end $$;
set local role authenticated;
select is(private.own_stored_analysis_readable_v1('aa200000-0000-4000-8000-000000000040','reports.polygenic'),false,
 'and the stranger is still refused after the re-grant');
reset role;

-- The revocation entry points stay off the browser surface ---------------------
select is(has_function_privilege('authenticated','public.revoke_directional_purpose_v1(uuid,uuid)','execute'),false,
 'a browser session cannot call the revoker directly');
select is(has_function_privilege('anon','public.revoke_directional_purpose_v1(uuid,uuid)','execute'),false,
 'anon cannot call the revoker');
select is(has_function_privilege('anon','public.grant_own_report_purpose_v1(uuid,uuid,uuid,jsonb,text,integer,text,text,timestamptz)','execute'),false,
 'anon cannot grant itself a purpose');

select * from finish();
rollback;
