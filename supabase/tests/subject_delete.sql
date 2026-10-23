begin;
select no_plan();
-- api.subject-delete, the self case and the door (migration
-- 20261016181000_subject_delete; owner decisions 2026-10-16, "The subjects
-- endpoints (G2.1)" and Q6). Also the narrowed per-file guard on the file
-- route's own door, public.prepare_own_prepared_file_cleanup_v1. Synthetic
-- accounts, files and rows only. Everything rolls back.

insert into auth.users (id, email, raw_user_meta_data) values
 ('7a200000-0000-4000-8000-000000000001', 'subject-delete-alpha@example.invalid', '{}'),
 ('7a200000-0000-4000-8000-000000000002', 'subject-delete-beta@example.invalid', '{}'),
 ('7a200000-0000-4000-8000-000000000003', 'subject-delete-gamma@example.invalid', '{}'),
 ('7a200000-0000-4000-8000-000000000004', 'subject-delete-delta@example.invalid', '{}'),
 ('7a200000-0000-4000-8000-000000000005', 'subject-delete-epsilon@example.invalid', '{}');
insert into auth.sessions (id, user_id, created_at, updated_at, aal) values
 ('7a200000-0000-4000-8000-000000000011', '7a200000-0000-4000-8000-000000000001', clock_timestamp(), clock_timestamp(), 'aal1'),
 ('7a200000-0000-4000-8000-000000000012', '7a200000-0000-4000-8000-000000000002', clock_timestamp(), clock_timestamp(), 'aal1'),
 ('7a200000-0000-4000-8000-000000000013', '7a200000-0000-4000-8000-000000000003', clock_timestamp(), clock_timestamp(), 'aal1'),
 ('7a200000-0000-4000-8000-000000000014', '7a200000-0000-4000-8000-000000000004', clock_timestamp(), clock_timestamp(), 'aal1');
insert into auth.sessions (id, user_id, created_at, updated_at, aal, not_after) values
 ('7a200000-0000-4000-8000-000000000019', '7a200000-0000-4000-8000-000000000001', clock_timestamp(), clock_timestamp(), 'aal1',
  clock_timestamp() - interval '1 minute');
insert into storage.buckets(id,name) values('genomes','genomes') on conflict do nothing;

create temporary table fx as select
 '7a200000-0000-4000-8000-000000000001'::uuid alpha,
 '7a200000-0000-4000-8000-000000000002'::uuid beta,
 '7a200000-0000-4000-8000-000000000003'::uuid gamma,
 '7a200000-0000-4000-8000-000000000004'::uuid delta,
 '7a200000-0000-4000-8000-000000000011'::uuid alpha_session,
 '7a200000-0000-4000-8000-000000000013'::uuid gamma_session,
 '7a200000-0000-4000-8000-000000000014'::uuid delta_session,
 '7a200000-0000-4000-8000-000000000019'::uuid alpha_ended_session,
 '7a200000-0000-4000-8000-000000000021'::uuid f1,
 '7a200000-0000-4000-8000-000000000022'::uuid f2,
 '7a200000-0000-4000-8000-000000000023'::uuid f3,
 (select id from public.subjects where subject_account_id='7a200000-0000-4000-8000-000000000001' and subject_class='self') alpha_subject,
 (select id from public.subjects where subject_account_id='7a200000-0000-4000-8000-000000000002' and subject_class='self') beta_subject,
 (select id from public.subjects where subject_account_id='7a200000-0000-4000-8000-000000000004' and subject_class='self') delta_subject,
 (select id from public.subjects where subject_account_id='7a200000-0000-4000-8000-000000000005' and subject_class='self') epsilon_subject,
 (select id from public.subject_principals where account_id='7a200000-0000-4000-8000-000000000001' and principal_kind='account_subject' and status='active') alpha_principal,
 (select id from public.subject_principals where account_id='7a200000-0000-4000-8000-000000000002' and principal_kind='account_subject' and status='active') beta_principal;
grant select on fx to service_role;

create function pg_temp.h(p text) returns text language sql immutable as
 $$ select encode(extensions.digest('subject-delete-test:'||p,'sha256'),'hex') $$;
create function pg_temp.del(p_account uuid, p_session uuid, p_subject uuid, p_code text,
 p_expires timestamptz default clock_timestamp() + interval '5 minutes')
returns jsonb language sql volatile as
 $$ select public.delete_subject_v1(p_account, p_session, p_subject, pg_temp.h(p_code), p_expires) $$;

-- Alpha's own record: two analysed files with derived rows, a chat, a share
-- with Beta, a current family pair with a joint result, and Beta's own chat
-- turn that drew on Alpha's record.
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,status)
select x.id,fx.alpha,fx.alpha_subject,fx.alpha::text||'/'||x.name,x.name||'.txt','array_ancestry',1,1,'annotated'
from fx, (values ((select f1 from fx),'synthetic-one'),((select f2 from fx),'synthetic-two')) x(id,name);
insert into storage.objects(bucket_id,name) select 'genomes',bucket_path from public.genome_files
 where id in ((select f1 from fx),(select f2 from fx));
insert into public.user_variants(user_id,subject_id,file_id,chrom,pos,genotype)
select user_id,subject_id,id,1,100,'AG' from public.genome_files where id in ((select f1 from fx),(select f2 from fx));
insert into public.ancestry_results(user_id,file_id,kind,result,support_note,subject_id)
select alpha,f1,'admixture','{}'::jsonb,'synthetic',alpha_subject from fx;
-- The fixture's own score row: a fresh database has no prs_scores rows.
insert into public.prs_scores(pgs_id,name,trait,n_variants,citation,source_url,ancestry_note)
 values('SUBJECT-DELETE-FIXTURE','Fixture','Fixture',1,'{}','https://example.invalid/fixture','Synthetic fixture only');
insert into public.user_prs(user_id,file_id,pgs_id,raw_score,coverage,matched,subject_id)
select alpha,f1,'SUBJECT-DELETE-FIXTURE',0.1,0.5,10,alpha_subject from fx;
insert into public.report_artifacts(subject_id,report_kind,report_revision,source_binding_fingerprint,artifact)
select alpha_subject,'synthetic-subject-delete',1,repeat('a',64),'{}' from fx;
insert into public.chats(id,user_id,title,scope_kind,subject_id,lifecycle_revision,
 provider_classification,runtime_attestation_revision,model_recipient_revision,authorization_fingerprint,legacy_unverified)
select '7a200000-0000-4000-8000-000000000031',alpha,'Synthetic own chat','self',alpha_subject,1,'local',1,1,repeat('a',64),false from fx;
select ok(private.persist_chat_turn_pair_v1('7a200000-0000-4000-8000-000000000031',(select alpha from fx),'"own question"','"own answer"') is not null,
 'fixture: Alpha has a turn on its own record');
set local role service_role;
create temporary table alpha_grant as select public.grant_directional_purpose_v1((select alpha from fx),(select alpha_subject from fx),
 (select beta_principal from fx),'reports.polygenic','consent.share-with-adult',1,'subject-delete-share-000000000000') id;
reset role;
insert into public.family_pairs(id,subject_a_id,subject_b_id,status)
select '7a200000-0000-4000-8000-000000000041',alpha_subject,beta_subject,'current' from fx;
insert into public.portrait_results(owner_account_id,parent_a_subject_id,parent_b_subject_id,family_pair_id,
 kind,trait_key,result,coverage,method_version,source_binding_fingerprint,computation_revision)
select alpha,alpha_subject,beta_subject,'7a200000-0000-4000-8000-000000000041','carrier_pair','abo','{}'::jsonb,1,
 'synthetic-v1',repeat('7',64),1 from fx;
insert into public.chats(id,user_id,title,scope_kind,subject_id,lifecycle_revision,
 provider_classification,runtime_attestation_revision,model_recipient_revision,authorization_fingerprint,legacy_unverified)
select '7a200000-0000-4000-8000-000000000032',beta,'Synthetic reader chat','self',beta_subject,1,'local',1,1,repeat('a',64),false from fx;
select ok(private.persist_chat_turn_pair_v1('7a200000-0000-4000-8000-000000000032',(select beta from fx),'"shared question"','"shared answer"') is not null,
 'fixture: Beta has a turn of its own');
update public.chat_messages set retrieved_subject_ids=array[(select alpha_subject from fx)]
 where chat_id='7a200000-0000-4000-8000-000000000032' and role='assistant';
select is((select count(*) from public.chat_messages where chat_id='7a200000-0000-4000-8000-000000000032'
 and retrieved_subject_ids && array[(select alpha_subject from fx)]),1::bigint,'fixture: Beta''s answer drew on Alpha''s record');

-- Privileges -------------------------------------------------------------------
select is(has_function_privilege('authenticated','public.delete_subject_v1(uuid,uuid,uuid,text,timestamptz)','execute'),false,
 'an authenticated client cannot reach the delete door');
select is(has_function_privilege('anon','public.delete_subject_v1(uuid,uuid,uuid,text,timestamptz)','execute'),false,
 'anon cannot reach the delete door');
select is(has_function_privilege('service_role','public.delete_subject_v1(uuid,uuid,uuid,text,timestamptz)','execute'),true,
 'only the service role reaches the delete door');
select is((select count(*) from unnest(array['private.empty_self_subject_v1(uuid,uuid)',
  'private.bar_path_b_subject_contact_v1(uuid)','private.delete_path_b_subject_for_route_v1(uuid,text)',
  'private.purge_path_a_subject_v1(uuid,uuid)','private.purge_transferred_embryo_subject_v1(uuid,uuid)',
  'private.record_subject_operation_nonce_v1(uuid,uuid,text,uuid,text,timestamptz)']) f
  where has_function_privilege('service_role',f,'execute') or has_function_privilege('authenticated',f,'execute')),0::bigint,
 'every case function is reachable only through the door');
select ok((select pg_get_constraintdef(oid) like '%subject_delete%' and pg_get_constraintdef(oid) like '%subject_sharing_stop%'
  and pg_get_constraintdef(oid) like '%other_adult_upload_artifact_sign%' and pg_get_constraintdef(oid) like '%account_delete_cancel%'
  from pg_constraint where conrelid='public.account_operation_nonces'::regclass and conname='account_operation_nonces_operation_check'),
 'the nonce store admits the delete operation and keeps every earlier one');

-- Refusals before any write ----------------------------------------------------
select throws_ok($$select pg_temp.del((select gamma from fx),(select gamma_session from fx),(select alpha_subject from fx),'foreign')$$,
 '42501','not_found','another account cannot delete this record');
select throws_ok($$select pg_temp.del((select alpha from fx),(select gamma_session from fx),(select alpha_subject from fx),'foreign-session')$$,
 '42501','not_found','another account''s session cannot delete it');
select throws_ok($$select pg_temp.del((select alpha from fx),(select alpha_ended_session from fx),(select alpha_subject from fx),'ended')$$,
 '42501','not_found','an ended session cannot delete it');
select throws_ok($$select pg_temp.del((select alpha from fx),(select alpha_session from fx),'7a200000-0000-4000-8000-0000000000ff','unknown')$$,
 '42501','not_found','an unknown record is not found');
select throws_ok($$select pg_temp.del((select alpha from fx),(select alpha_session from fx),(select alpha_subject from fx),'expired',
  clock_timestamp() - interval '1 second')$$,'22023','invalid_operation_nonce','an expired code is refused');
select throws_ok($$select pg_temp.del((select alpha from fx),(select alpha_session from fx),(select alpha_subject from fx),'too-long',
  clock_timestamp() + interval '11 minutes')$$,'22023','invalid_operation_nonce','a code claiming more than ten minutes is refused');
select throws_ok($$select public.delete_subject_v1((select alpha from fx),(select alpha_session from fx),(select alpha_subject from fx),
  'not-a-hash',clock_timestamp() + interval '5 minutes')$$,'22023','invalid_operation_nonce','only a code''s SHA-256 is accepted');
update public.genome_files set status='parsing' where id=(select f2 from fx);
select throws_ok($$select pg_temp.del((select alpha from fx),(select alpha_session from fx),(select alpha_subject from fx),'processing')$$,
 '55000','subject_delete_processing','a file still being processed keeps the record as it is');
update public.genome_files set status='annotated' where id=(select f2 from fx);
select is((select count(*) from public.account_operation_nonces where account_id=(select alpha from fx)),0::bigint,
 'a refused delete records no code');
select ok((select count(*) from private.genome_file_deletions where file_id in ((select f1 from fx),(select f2 from fx)))=0
  and (select count(*) from public.report_artifacts where subject_id=(select alpha_subject from fx))=1
  and (select count(*) from public.chats where subject_id=(select alpha_subject from fx))=1
  and (select revoked_at is null from public.purpose_grants where grant_id=(select id from alpha_grant)),
 'a refused delete changes no file, result, chat or grant');

-- Self: empty the record ---------------------------------------------------------
create temporary table before_self as select lifecycle_revision rev from public.subjects where id=(select alpha_subject from fx);
-- The actor context is transaction-local; clear it where production would
-- have committed, so only the delete's own code can name who acted.
select set_config('inherit.legal_audit_actor','',true);
set local role service_role;
create temporary table emptied as select pg_temp.del((select alpha from fx),(select alpha_session from fx),(select alpha_subject from fx),'self-1') body;
reset role;
select is((select body from emptied),jsonb_build_object('case','self','files',
  (select jsonb_agg(x order by x) from unnest(array[(select f1 from fx),(select f2 from fx)]) x)),
 'the self case answers with exactly the record''s files to drain');
select is((select count(*) from public.account_operation_nonces where account_id=(select alpha from fx) and operation='subject_delete'
  and nonce_hash=pg_temp.h('self-1') and consumed_at is not null),1::bigint,'the code''s hash is recorded as spent in the same transaction');
select ok((select subject_class='self' and lifecycle='active' and owner_account_id=(select alpha from fx)
  and subject_account_id=(select alpha from fx) and lifecycle_revision=(select rev from before_self)+1
  from public.subjects where id=(select alpha_subject from fx)),
 'the record stays the account''s one self record, with a new lifecycle revision');
select is((select count(*) from public.subjects where subject_account_id=(select alpha from fx) and subject_class='self'),1::bigint,
 'exactly one self record remains');
select is((select status from public.subject_principals where id=(select alpha_principal from fx)),'active',
 'the account''s own principal stays');
select is((select count(*) from private.genome_file_deletions where file_id in ((select f1 from fx),(select f2 from fx))),2::bigint,
 'both files are prepared through the shared per-file pipeline');
select ok((select bool_and(status='failed') from public.genome_files where id in ((select f1 from fx),(select f2 from fx))),
 'neither file is readable from here on');
select is((select count(*) from public.ancestry_results where subject_id=(select alpha_subject from fx))
  +(select count(*) from public.user_prs where subject_id=(select alpha_subject from fx))
  +(select count(*) from public.report_artifacts where subject_id=(select alpha_subject from fx)),0::bigint,
 'every result built from the record is deleted');
select is((select count(*) from public.chats where subject_id=(select alpha_subject from fx)),0::bigint,
 'every chat about the record is deleted');
select is((select count(*) from public.chat_messages where retrieved_subject_ids && array[(select alpha_subject from fx)]),0::bigint,
 'no turn that drew on the record remains, whoever owns the chat');
select is((select count(*) from public.chats where id='7a200000-0000-4000-8000-000000000032'),1::bigint,
 'the reader''s own chat itself stays');
select ok((select revoked_at is not null and revocation_reason='subject_deleted' from public.purpose_grants where grant_id=(select id from alpha_grant))
  and (select bool_and(status='revoked') from public.directional_grants where grant_id=(select id from alpha_grant)),
 'the share with Beta is revoked');
select is((select status from public.family_pairs where id='7a200000-0000-4000-8000-000000000041'),'revoked',
 'the family pair ends');
select is((select count(*) from public.portrait_results where family_pair_id='7a200000-0000-4000-8000-000000000041'),0::bigint,
 'the pair''s joint results are deleted');
select is((select count(*) from public.legal_audit_log where event_code='subject.emptied' and route_id='api.subject-delete'),1::bigint,
 'one audit event records the emptying');
-- 20261023120000: the code is recorded already consumed, which the insert
-- trigger now sees, and subject.emptied is a person's own event.
select is((select audit_principal_id from public.legal_audit_log where event_code='subject.emptied' and route_id='api.subject-delete'
  order by seq desc limit 1),(select audit_principal_id from private.legal_audit_account_principals where account_id=(select alpha from fx)),
 'the emptying names the account that asked for it');
select ok((select not (coded_context ?| array['account_id','subject_id']) from public.legal_audit_log
  where event_code='subject.emptied' order by seq desc limit 1),'the audit context names no account or record');
select throws_ok($$select pg_temp.del((select alpha from fx),(select alpha_session from fx),(select alpha_subject from fx),'self-1')$$,
 '22023','invalid_operation_nonce','a replayed code is refused');

-- The route then drains each file exactly as the file route does.
create temporary table drained as select public.prepare_own_prepared_file_cleanup_v1((select alpha from fx),(select alpha_session from fx),(select f1 from fx)) plan;
select is((select plan->>'preparedComplete' from drained),'true','the file route''s door returns the prepared file''s plan');
select is((select plan->'original'->>'name' from drained),(select alpha::text||'/synthetic-one' from fx),'with the exact database-owned target');
set local storage.allow_delete_query='true';
delete from storage.objects where bucket_id='genomes' and name=(select plan->'original'->>'name' from drained);
select lives_ok($$select public.finish_genome_file_deletion_v1((select alpha from fx),(select alpha_session from fx),(select f1 from fx),
  (select (plan->'original'->>'token')::uuid from drained))$$,'the acknowledged file finishes');
select is((select count(*) from public.genome_files where id=(select f1 from fx))
  +(select count(*) from public.user_variants where file_id=(select f1 from fx)),0::bigint,'the file and its variants are gone');
select is((select count(*) from public.genome_files where id=(select f2 from fx)),1::bigint,
 'a file the route did not finish waits for the seven-day backstop');

-- Q6: the shared per-file guard, on the file route's own door -------------------
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,status)
select f3,delta,delta_subject,delta::text||'/synthetic-q6','synthetic-q6.txt','array_ancestry',1,1,'annotated' from fx;
insert into storage.objects(bucket_id,name) select 'genomes',delta::text||'/synthetic-q6' from fx;
insert into public.family_pairs(id,subject_a_id,subject_b_id,status)
select '7a200000-0000-4000-8000-000000000042',delta_subject,epsilon_subject,'current' from fx;
create function pg_temp.file_delete() returns jsonb language sql volatile as
 $$ select public.prepare_own_prepared_file_cleanup_v1((select delta from fx),(select delta_session from fx),(select f3 from fx)) $$;
select throws_ok($$select pg_temp.file_delete()$$,'55000','file_delete_shared_graph','a current pair still blocks a file deletion');
update public.family_pairs set status='pending' where id='7a200000-0000-4000-8000-000000000042';
select throws_ok($$select pg_temp.file_delete()$$,'55000','file_delete_shared_graph','a pending pair still blocks a file deletion');
update public.family_pairs set status='revoked' where id='7a200000-0000-4000-8000-000000000042';
insert into public.portrait_results(owner_account_id,parent_a_subject_id,parent_b_subject_id,family_pair_id,
 kind,trait_key,result,coverage,method_version,source_binding_fingerprint,computation_revision)
select delta,delta_subject,epsilon_subject,'7a200000-0000-4000-8000-000000000042','carrier_pair','abo','{}'::jsonb,1,
 'synthetic-v1',repeat('7',64),1 from fx;
select throws_ok($$select pg_temp.file_delete()$$,'55000','file_delete_shared_graph','an ended pair that still has a joint result blocks it');
delete from public.portrait_results where family_pair_id='7a200000-0000-4000-8000-000000000042';
select is((select count(*) from private.genome_file_deletions where file_id=(select f3 from fx)),0::bigint,
 'a blocked file deletion writes nothing');
select lives_ok($$select pg_temp.file_delete()$$,'an ended pair with nothing left on it no longer blocks the owner''s file (Q6)');
select is((select count(*) from private.genome_file_deletions where file_id=(select f3 from fx)),1::bigint,
 'the file deletion is prepared');
select is((select status from public.family_pairs where id='7a200000-0000-4000-8000-000000000042'),'revoked',
 'the file route leaves the ended pair as it was');

select * from finish();
rollback;
