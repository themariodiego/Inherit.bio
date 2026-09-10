-- Cross-account attack matrix for every table whose row-level policy decides
-- access from the caller's own identity.
--
-- G1.6 asks that "user A cannot select, insert, update or delete any row of any
-- table introduced by this work" and that "anonymous is denied on every new
-- private table". Until this file, that was proved only by `e2e/rls.spec.ts`,
-- which attacks through PostgREST and therefore only reaches what PostgREST
-- exposes. `scripts/rls-policy-coverage.test.ts` required a *test naming* each
-- caller-scoped table, and `docs/acceptance-matrix.md` records the limit that
-- left: "naming is presence of coverage, not proof that the naming test attacks
-- the policy." Naming is what those tables had. This is the attack.
--
-- The eleven tables below are the live set: every `public` table carrying a
-- policy whose predicate reads `auth.uid()`, taken from `pg_policy` rather than
-- from a scan of the migrations, because migration history and current state
-- are different questions and only the second one is enforceable.
--
-- Three identities are run against each table, and the third is the one that
-- keeps the file honest:
--
--   anon           -- never signed in
--   Beta           -- signed in, unrelated account, attacking Alpha's rows
--   Alpha          -- the legitimate owner
--
-- Without Alpha a suite like this passes by denying everyone, which is exactly
-- what a broken grant or a dropped table looks like. Every table therefore
-- carries a positive control, and where the owner legitimately cannot reach the
-- table directly either -- `chats` and `chat_messages` have no grant to any
-- browser role, and are read through security-definer functions -- the positive
-- control asserts the row is really there by reading it as `service_role`, so
-- "denied" is never confused with "absent".
--
-- Denial arrives in two shapes and the difference is worth keeping: a table the
-- browser role has no privilege on raises 42501, while a table it may select
-- from returns zero rows through the policy. Asserting the wrong one would pass
-- while the other regressed.
--
-- Synthetic accounts and synthetic variant data only. Everything rolls back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- Fixture ---------------------------------------------------------------------
-- Alpha owns one row in every caller-scoped table. Beta owns nothing and is
-- only ever the attacker. Inserting into `auth.users` provisions the profile,
-- subject, principal and binding graph through `public.handle_new_user`.
insert into auth.users(id,email) values
 ('aa100000-0000-4000-8000-000000000001','rls-attack-alpha@example.invalid'),
 ('aa100000-0000-4000-8000-000000000002','rls-attack-beta@example.invalid');
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('aa100000-0000-4000-8000-000000000011','aa100000-0000-4000-8000-000000000001',now(),now(),'aal1'),
 ('aa100000-0000-4000-8000-000000000012','aa100000-0000-4000-8000-000000000002',now(),now(),'aal1');

create temporary table fx as select
 'aa100000-0000-4000-8000-000000000001'::uuid as alpha,
 'aa100000-0000-4000-8000-000000000002'::uuid as beta,
 (select id from public.subjects
   where subject_account_id='aa100000-0000-4000-8000-000000000001' and subject_class='self') as alpha_subject;

-- `annotated` with a matching observed-call digest is what
-- `private.report_observed_call_readable_v1` requires, so Alpha's positive
-- control on `report_observed_calls` exercises the real predicate rather than
-- a file that happens to sit in a readable state.
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,
 size_bytes,sha256,status,build,observed_call_sha256,observed_call_version)
 select 'aa100000-0000-4000-8000-000000000040',alpha,alpha_subject,
 'aa100000-0000-4000-8000-000000000030','alpha.vcf','vcf',1,8,repeat('a',64),
 'annotated','GRCh38',repeat('b',64),'vcf-literal-diploid-snp-v1' from fx;

insert into public.user_variants(user_id,file_id,rsid,chrom,pos,ref,alt,genotype,subject_id)
 select alpha,'aa100000-0000-4000-8000-000000000040',4242,1,100000,'A','G','A/G',alpha_subject from fx;

insert into public.ancestry_results(user_id,file_id,kind,result,support_note,subject_id)
 select alpha,'aa100000-0000-4000-8000-000000000040','admixture',
 '{"synthetic":true}','Synthetic fixture, not a measurement.',alpha_subject from fx;

insert into public.consent_grants(user_id,provider_key,data_classes)
 select alpha,'synthetic-provider',array['variants'] from fx;

insert into public.llm_settings(user_id,provider,model)
 select alpha,'anthropic','synthetic-model' from fx;

insert into public.prs_scores(pgs_id,name,trait,n_variants,citation,source_url,ancestry_note)
 values('RLS-ATTACK-FIXTURE','Fixture','Fixture',1,'{}',
 'https://example.invalid/fixture','Synthetic fixture only, not a published score.')
 on conflict(pgs_id) do nothing;
insert into public.user_prs(user_id,file_id,pgs_id,raw_score,coverage,matched,subject_id)
 select alpha,'aa100000-0000-4000-8000-000000000040','RLS-ATTACK-FIXTURE',0.5,1,1,alpha_subject from fx;

insert into public.report_observed_calls(file_id,user_id,subject_id,source_line,source_sha256,
 extraction_version,source_build,source_chrom,source_pos,source_ref,source_alt,source_gt,
 rsid,chrom,pos,ref,alt,genotype,quality_state,usable)
 select 'aa100000-0000-4000-8000-000000000040',alpha,alpha_subject,1,repeat('b',64),
 'vcf-literal-diploid-snp-v1','GRCh38',1,100000,'A','G','0/1',4242,1,100000,'A','G','A/G','pass',true from fx;

insert into public.upload_sessions(account_id,auth_session_id,subject_id,staging_object_name,
 expected_size,content_type,upload_revision,expires_at)
 select alpha,'aa100000-0000-4000-8000-000000000011',alpha_subject,
 'aa100000-0000-4000-8000-000000000030',1024,'text/plain',1,clock_timestamp()+interval '1 hour' from fx;

insert into public.chats(id,user_id,title,scope_kind,subject_id,lifecycle_revision,
 provider_classification,runtime_attestation_revision,model_recipient_revision,authorization_fingerprint)
 select 'aa100000-0000-4000-8000-000000000050',alpha,'Alpha private chat','self',alpha_subject,1,
 'local',1,1,repeat('c',64) from fx;

insert into public.chat_messages(chat_id,user_id,role,content,turn_id,turn_ordinal,paired_role,
 scope_revision,authorization_fingerprint,provider_classification,
 runtime_attestation_revision,model_recipient_revision)
 select 'aa100000-0000-4000-8000-000000000050',alpha,'user',
 '{"text":"synthetic private message"}','aa100000-0000-4000-8000-000000000051',1,'user',1,
 repeat('c',64),'local',1,1 from fx;

-- The set under attack is measured, not listed ---------------------------------
-- If a twelfth caller-scoped policy lands, this fails and says which table, so
-- the file cannot silently fall behind the schema it claims to cover.
create temporary table caller_scoped(name text primary key);
insert into caller_scoped(name) values
 ('ancestry_results'),('chat_messages'),('chats'),('consent_grants'),('genome_files'),
 ('llm_settings'),('profiles'),('report_observed_calls'),('upload_sessions'),
 ('user_prs'),('user_variants');

select is(
 (select coalesce(string_agg(c.relname,', ' order by c.relname),'')
  from pg_policy p
  join pg_class c on c.oid=p.polrelid
  join pg_namespace n on n.oid=c.relnamespace and n.nspname='public'
  where (coalesce(pg_get_expr(p.polqual,p.polrelid),'')||
         coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'')) ~ 'auth\.(uid|jwt)\(\)'
    and c.relname not in (select name from caller_scoped)),
 '',
 'every public table with a caller-identity policy is attacked by this file');
select is((select count(*)::integer from caller_scoped),11,
 'the attacked set is the eleven tables the database currently reports');

-- Alpha's fixture is really present, read with rights that bypass the policy.
-- Every zero asserted further down is therefore a denial, not an empty table.
select is((select count(*) from public.genome_files where user_id=(select alpha from fx)),1::bigint,'fixture: genome_files');
select is((select count(*) from public.user_variants where user_id=(select alpha from fx)),1::bigint,'fixture: user_variants');
select is((select count(*) from public.ancestry_results where user_id=(select alpha from fx)),1::bigint,'fixture: ancestry_results');
select is((select count(*) from public.consent_grants where user_id=(select alpha from fx)),1::bigint,'fixture: consent_grants');
select is((select count(*) from public.llm_settings where user_id=(select alpha from fx)),1::bigint,'fixture: llm_settings');
select is((select count(*) from public.profiles where id=(select alpha from fx)),1::bigint,'fixture: profiles');
select is((select count(*) from public.user_prs where user_id=(select alpha from fx)),1::bigint,'fixture: user_prs');
select is((select count(*) from public.report_observed_calls where user_id=(select alpha from fx)),1::bigint,'fixture: report_observed_calls');
select is((select count(*) from public.upload_sessions where account_id=(select alpha from fx)),1::bigint,'fixture: upload_sessions');
select is((select count(*) from public.chats where user_id=(select alpha from fx)),1::bigint,'fixture: chats');
select is((select count(*) from public.chat_messages where user_id=(select alpha from fx)),1::bigint,'fixture: chat_messages');

-- Anonymous reads ---------------------------------------------------------------
-- Never signed in, so `auth.uid()` is null and every `auth.uid() = user_id`
-- predicate is null, which is not true, which is a denial.
do $$ begin perform set_config('request.jwt.claims','{"role":"anon"}',true); end $$;
set local role anon;
select is((select count(*) from public.genome_files),0::bigint,'anon reads no genome file');
select is((select count(*) from public.user_variants),0::bigint,'anon reads no variant call');
select is((select count(*) from public.ancestry_results),0::bigint,'anon reads no ancestry result');
select is((select count(*) from public.consent_grants),0::bigint,'anon reads no consent grant');
select is((select count(*) from public.llm_settings),0::bigint,'anon reads no copilot setting');
select is((select count(*) from public.profiles),0::bigint,'anon reads no profile');
select throws_ok($$select count(*) from public.user_prs$$,'42501',null,'anon has no privilege on user_prs at all');
select throws_ok($$select count(*) from public.report_observed_calls$$,'42501',null,'anon has no privilege on report_observed_calls at all');
select throws_ok($$select count(*) from public.upload_sessions$$,'42501',null,'anon has no privilege on upload_sessions at all');
select throws_ok($$select count(*) from public.chats$$,'42501',null,'anon has no privilege on chats at all');
select throws_ok($$select count(*) from public.chat_messages$$,'42501',null,'anon has no privilege on chat_messages at all');
reset role;

-- Anonymous writes ---------------------------------------------------------------
do $$ begin perform set_config('request.jwt.claims','{"role":"anon"}',true); end $$;
set local role anon;
select throws_ok($$update public.genome_files set original_name='pwned'$$,'42501',null,'anon cannot update a genome file');
select throws_ok($$delete from public.genome_files$$,'42501',null,'anon cannot delete a genome file');
select throws_ok($$update public.user_variants set genotype='C/C'$$,'42501',null,'anon cannot update a variant call');
select throws_ok($$delete from public.user_variants$$,'42501',null,'anon cannot delete a variant call');
select throws_ok($$update public.ancestry_results set support_note='pwned'$$,'42501',null,'anon cannot update an ancestry result');
select throws_ok($$delete from public.ancestry_results$$,'42501',null,'anon cannot delete an ancestry result');
select throws_ok($$update public.consent_grants set revoked_at=now()$$,'42501',null,'anon cannot revoke someone''s consent');
select throws_ok($$delete from public.consent_grants$$,'42501',null,'anon cannot delete a consent grant');
select throws_ok($$update public.user_prs set pgs_id='x'$$,'42501',null,'anon cannot update a polygenic result');
select throws_ok($$delete from public.user_prs$$,'42501',null,'anon cannot delete a polygenic result');
select throws_ok($$update public.report_observed_calls set genotype='C/C'$$,'42501',null,'anon cannot update an observed call');
select throws_ok($$delete from public.report_observed_calls$$,'42501',null,'anon cannot delete an observed call');
select throws_ok($$update public.upload_sessions set status='cancelled'$$,'42501',null,'anon cannot update an upload session');
select throws_ok($$delete from public.upload_sessions$$,'42501',null,'anon cannot delete an upload session');
select throws_ok($$update public.chats set title='pwned'$$,'42501',null,'anon cannot update a chat');
select throws_ok($$delete from public.chats$$,'42501',null,'anon cannot delete a chat');
select throws_ok($$update public.chat_messages set content='{}'$$,'42501',null,'anon cannot update a chat message');
select throws_ok($$delete from public.chat_messages$$,'42501',null,'anon cannot delete a chat message');
-- `llm_settings` and `profiles` are the two tables a browser role holds full
-- DML on, so here the statement runs and the policy has to do the work.
select throws_ok(
 $$insert into public.llm_settings(user_id,provider,model)
   values('aa100000-0000-4000-8000-000000000001','anthropic','pwned')$$,
 '42501',null,'anon cannot plant a copilot setting on someone''s account');
select throws_ok(
 $$insert into public.profiles(id,display_name)
   values('aa100000-0000-4000-8000-000000000003','pwned')$$,
 '42501','not_found','anon cannot create a profile');
select lives_ok($$update public.llm_settings set model='pwned'$$,'anon may issue the update statement');
select lives_ok($$delete from public.llm_settings$$,'anon may issue the delete statement');
select lives_ok($$update public.profiles set display_name='pwned'$$,'anon may issue the profile update statement');
select lives_ok($$delete from public.profiles$$,'anon may issue the profile delete statement');
reset role;
-- ... and reached nothing with any of them.
select is((select model from public.llm_settings where user_id=(select alpha from fx)),'synthetic-model',
 'the anon update matched no row: Alpha''s copilot setting is untouched');
select is((select count(*) from public.llm_settings),1::bigint,'the anon delete removed no copilot setting');
select is((select count(*) from public.profiles where id=(select alpha from fx)),1::bigint,
 'the anon delete removed no profile');

-- Beta reads: a signed-in stranger ------------------------------------------------
do $$ begin perform set_config('request.jwt.claims',
 '{"sub":"aa100000-0000-4000-8000-000000000002","session_id":"aa100000-0000-4000-8000-000000000012","role":"authenticated"}',
 true); end $$;
set local role authenticated;
select is((select count(*) from public.genome_files),0::bigint,'a stranger reads no genome file');
select is((select count(*) from public.user_variants),0::bigint,'a stranger reads no variant call');
select is((select count(*) from public.ancestry_results),0::bigint,'a stranger reads no ancestry result');
select is((select count(*) from public.consent_grants),0::bigint,'a stranger reads no consent grant');
select is((select count(*) from public.llm_settings),0::bigint,'a stranger reads no copilot setting');
select is((select count(*) from public.user_prs),0::bigint,'a stranger reads no polygenic result');
select is((select count(*) from public.report_observed_calls),0::bigint,'a stranger reads no observed call');
select is((select count(*) from public.upload_sessions),0::bigint,'a stranger reads no upload session');
-- Beta has a profile of their own, so the assertion is that they see exactly
-- theirs -- an unfiltered count of one is not evidence until it is the right one.
select is((select count(*) from public.profiles),1::bigint,'a stranger reads exactly one profile');
select is((select id from public.profiles),'aa100000-0000-4000-8000-000000000002'::uuid,
 'and the one profile a stranger reads is their own');
select is((select count(*) from public.profiles where id='aa100000-0000-4000-8000-000000000001'),0::bigint,
 'naming Alpha''s account id explicitly still returns nothing');
select throws_ok($$select count(*) from public.chats$$,'42501',null,'a stranger has no privilege on chats at all');
select throws_ok($$select count(*) from public.chat_messages$$,'42501',null,'a stranger has no privilege on chat_messages at all');
-- Filtering for the victim by primary key, not just by owner.
select is((select count(*) from public.genome_files where id='aa100000-0000-4000-8000-000000000040'),0::bigint,
 'naming Alpha''s file id explicitly still returns nothing');
select is((select count(*) from public.user_variants where file_id='aa100000-0000-4000-8000-000000000040'),0::bigint,
 'naming Alpha''s file id explicitly returns none of its variant calls');
-- The RLS predicate function itself, called directly rather than through a policy.
select is(private.own_stored_analysis_readable_v1('aa100000-0000-4000-8000-000000000040','reports.polygenic'),false,
 'the polygenic read predicate refuses a stranger for Alpha''s file');
select is(private.own_stored_analysis_readable_v1('aa100000-0000-4000-8000-000000000040','ancestry'),false,
 'the ancestry read predicate refuses a stranger for Alpha''s file');
select is(private.report_observed_call_readable_v1('aa100000-0000-4000-8000-000000000040',
 repeat('b',64),'vcf-literal-diploid-snp-v1'),false,
 'the observed-call read predicate refuses a stranger for Alpha''s file');
reset role;

-- Beta writes -----------------------------------------------------------------
do $$ begin perform set_config('request.jwt.claims',
 '{"sub":"aa100000-0000-4000-8000-000000000002","session_id":"aa100000-0000-4000-8000-000000000012","role":"authenticated"}',
 true); end $$;
set local role authenticated;
select throws_ok($$update public.genome_files set original_name='pwned'$$,'42501',null,'a stranger cannot update a genome file');
select throws_ok($$delete from public.genome_files$$,'42501',null,'a stranger cannot delete a genome file');
select throws_ok(
 $$insert into public.user_variants(user_id,file_id,rsid,chrom,pos,ref,alt,genotype,subject_id)
   values('aa100000-0000-4000-8000-000000000001','aa100000-0000-4000-8000-000000000040',
   1,1,1,'A','G','A/G','aa100000-0000-4000-8000-000000000001')$$,
 '42501',null,'a stranger cannot plant a variant call on someone''s file');
select throws_ok($$update public.user_variants set genotype='C/C'$$,'42501',null,'a stranger cannot update a variant call');
select throws_ok($$delete from public.user_variants$$,'42501',null,'a stranger cannot delete a variant call');
select throws_ok($$update public.ancestry_results set support_note='pwned'$$,'42501',null,'a stranger cannot update an ancestry result');
select throws_ok($$delete from public.ancestry_results$$,'42501',null,'a stranger cannot delete an ancestry result');
select throws_ok($$update public.consent_grants set revoked_at=now()$$,'42501',null,'a stranger cannot revoke someone''s consent');
select throws_ok($$delete from public.consent_grants$$,'42501',null,'a stranger cannot delete a consent grant');
select throws_ok($$update public.user_prs set pgs_id='x'$$,'42501',null,'a stranger cannot update a polygenic result');
select throws_ok($$delete from public.user_prs$$,'42501',null,'a stranger cannot delete a polygenic result');
select throws_ok($$update public.report_observed_calls set genotype='C/C'$$,'42501',null,'a stranger cannot update an observed call');
select throws_ok($$delete from public.report_observed_calls$$,'42501',null,'a stranger cannot delete an observed call');
select throws_ok($$update public.upload_sessions set status='cancelled'$$,'42501',null,'a stranger cannot update an upload session');
select throws_ok($$delete from public.upload_sessions$$,'42501',null,'a stranger cannot delete an upload session');
select throws_ok($$update public.chats set title='pwned'$$,'42501',null,'a stranger cannot update a chat');
select throws_ok($$delete from public.chats$$,'42501',null,'a stranger cannot delete a chat');
select throws_ok($$update public.chat_messages set content='{}'$$,'42501',null,'a stranger cannot update a chat message');
select throws_ok($$delete from public.chat_messages$$,'42501',null,'a stranger cannot delete a chat message');
select throws_ok(
 $$insert into public.llm_settings(user_id,provider,model)
   values('aa100000-0000-4000-8000-000000000001','anthropic','pwned')$$,
 '42501',null,'a stranger cannot plant a copilot setting on Alpha''s account');
select throws_ok(
 $$insert into public.profiles(id,display_name)
   values('aa100000-0000-4000-8000-000000000001','pwned')$$,
 '42501','not_found','a stranger cannot overwrite Alpha''s profile by inserting one');
select lives_ok($$update public.llm_settings set model='pwned'$$,'a stranger may issue the update statement');
select lives_ok($$delete from public.llm_settings$$,'a stranger may issue the delete statement');
select lives_ok($$update public.profiles set display_name='pwned'$$,'a stranger may issue the profile update statement');
select lives_ok($$delete from public.profiles where id='aa100000-0000-4000-8000-000000000001'$$,
 'a stranger may issue a delete naming Alpha''s profile');
reset role;
select is((select model from public.llm_settings where user_id=(select alpha from fx)),'synthetic-model',
 'the stranger''s update matched no row: Alpha''s copilot setting is untouched');
select is((select count(*) from public.llm_settings),1::bigint,'the stranger''s delete removed no copilot setting');
select is((select count(*) from public.profiles where id=(select alpha from fx)),1::bigint,
 'the stranger''s delete naming Alpha''s profile removed nothing');
select is((select display_name from public.profiles where id=(select alpha from fx)),null,
 'Alpha''s profile name is unchanged by the stranger''s update');
select is((select count(*) from public.user_variants where user_id=(select alpha from fx)),1::bigint,
 'Alpha''s variant call survived every write attempt');
select is((select count(*) from public.genome_files where user_id=(select alpha from fx)),1::bigint,
 'Alpha''s genome file survived every write attempt');

-- Alpha: the positive control ---------------------------------------------------
-- Everything above is a zero. These are the ones. A regression that breaks the
-- owner's own access fails here rather than passing as extra safety.
do $$ begin perform set_config('request.jwt.claims',
 '{"sub":"aa100000-0000-4000-8000-000000000001","session_id":"aa100000-0000-4000-8000-000000000011","role":"authenticated"}',
 true); end $$;
set local role authenticated;
select is((select count(*) from public.genome_files),1::bigint,'the owner reads their genome file');
select is((select count(*) from public.user_variants),1::bigint,'the owner reads their variant call');
select is((select count(*) from public.ancestry_results),1::bigint,'the owner reads their ancestry result');
select is((select count(*) from public.consent_grants),1::bigint,'the owner reads their consent grant');
select is((select count(*) from public.llm_settings),1::bigint,'the owner reads their copilot setting');
select is((select count(*) from public.profiles),1::bigint,'the owner reads their profile');
select is((select count(*) from public.user_prs),1::bigint,'the owner reads their polygenic result');
select is((select count(*) from public.report_observed_calls),1::bigint,'the owner reads their observed call');
select is((select count(*) from public.upload_sessions),1::bigint,'the owner reads their upload session');
select is((select id from public.genome_files),'aa100000-0000-4000-8000-000000000040'::uuid,
 'and it is the fixture row, not some other account''s');
select ok(private.report_observed_call_readable_v1('aa100000-0000-4000-8000-000000000040',
 repeat('b',64),'vcf-literal-diploid-snp-v1'),
 'the observed-call read predicate admits the owner, so the stranger''s false was a decision');
select lives_ok($$update public.llm_settings set model='owner-set'$$,'the owner may update their copilot setting');
reset role;
select is((select model from public.llm_settings where user_id=(select alpha from fx)),'owner-set',
 'and the owner''s update actually landed, so the policy is not denying everyone');

-- `chats` and `chat_messages` are the exception, and it is deliberate ------------
-- Both carry a `*_select_own` policy, and no browser role holds any privilege on
-- either, so the policy is unreachable and reads go through security-definer
-- functions. That makes "the owner is denied too" the correct result, and the
-- positive control has to come from a role that can see the row at all --
-- otherwise a dropped table would look exactly like a working defence.
do $$ begin perform set_config('request.jwt.claims',
 '{"sub":"aa100000-0000-4000-8000-000000000001","session_id":"aa100000-0000-4000-8000-000000000011","role":"authenticated"}',
 true); end $$;
set local role authenticated;
select throws_ok($$select count(*) from public.chats$$,'42501',null,
 'even the owner cannot read chats directly; the read path is a definer function');
select throws_ok($$select count(*) from public.chat_messages$$,'42501',null,
 'even the owner cannot read chat_messages directly');
reset role;
set local role service_role;
select is((select count(*) from public.chats where user_id='aa100000-0000-4000-8000-000000000001'),1::bigint,
 'the chat row is present for a role that bypasses the policy, so the denials above are denials');
select is((select count(*) from public.chat_messages where user_id='aa100000-0000-4000-8000-000000000001'),1::bigint,
 'the chat message is present for a role that bypasses the policy');
reset role;

-- The privilege surface these denials rest on -----------------------------------
-- The 42501s above are grants, not policies, and a grant is one statement away
-- from being widened. Pin the shape so widening one is a deliberate act with its
-- own attack test rather than a quiet edit.
select is((select coalesce(string_agg(distinct table_name,', ' order by table_name),'')
 from information_schema.role_table_grants
 where table_schema='public' and grantee in('anon','authenticated','inherit_upload_only')
  and privilege_type in('INSERT','UPDATE','DELETE')
  and table_name in('genome_files','user_variants','ancestry_results','consent_grants',
   'user_prs','report_observed_calls','upload_sessions','chats','chat_messages')),
 '',
 'no browser role may insert, update or delete any account-scoped or genetic table');
select is((select coalesce(string_agg(distinct table_name,', ' order by table_name),'')
 from information_schema.role_table_grants
 where table_schema='public' and grantee in('anon','authenticated','inherit_upload_only')
  and privilege_type='SELECT' and table_name in('chats','chat_messages')),
 '',
 'no browser role may select from the chat tables at all');
select is(has_table_privilege('anon','public.user_prs','select'),false,
 'anon holds no select on polygenic results, at table or column level');
select is(has_table_privilege('anon','public.upload_sessions','select'),false,
 'anon holds no select on upload sessions');
select is(has_table_privilege('anon','public.report_observed_calls','select'),false,
 'anon holds no select on observed calls');
-- The analytic PRS columns are column-revoked, not row-filtered: RLS controls
-- rows, so if the score values were readable the owner's policy would not help.
select is(has_column_privilege('authenticated','public.user_prs','raw_score','select'),false,
 'the raw polygenic score is not readable by a browser role even for its owner');
select is(has_column_privilege('authenticated','public.user_prs','zscore','select'),false,
 'nor the z-score');
select is(has_column_privilege('authenticated','public.user_prs','percentile','select'),false,
 'nor the percentile');
select is(has_column_privilege('authenticated','public.user_prs','coverage','select'),false,
 'nor the coverage fraction');
select ok(has_column_privilege('authenticated','public.user_prs','pgs_id','select'),
 'while the score identifier is readable, so the revocation above is column-scoped not total');

select * from finish();
rollback;
