-- api.subject-delete, the adult cases (migration 20261016181000_subject_delete;
-- owner decision 2026-10-16, "The subjects endpoints (G2.1)"). A Path B
-- record is deleted by its uploader (withdrawn, no bar) or by the person's own
-- account (deleted, with the subject-controlled contact refusal bar); a Path A
-- record is deleted by its own account. Anyone else is not found and nothing
-- is written. Synthetic accounts, HMACs and files only. Everything rolls back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir fixtures/invitation_quota_keys.inc
\ir fixtures/path_b_source_setup.inc

update auth.users set created_at=now()-interval '1 day' where id::text like '0b5e0000-%';

-- Two Path B people: one signs with no account, one with their own account.
select pg_temp.requested('nb','a',repeat('a',64));
select is(pg_temp.token_confirms('a','del-token-aaaaaaaaaaaaaaaaaaa'),'accepted','fixture: (nb) the person signs with no account');
select pg_temp.requested('acct','c',repeat('c',64));
select is(pg_temp.account_confirms('c','del-sign-cccccccccccccccccccc','2',repeat('c',64)),'accepted',
 'fixture: (acct) the person signs with their own account');
select is((select h->>'status' from (select pg_temp.hold('nb',pg_temp.sid('nb'),repeat('d',64)) h) x),'stored_quarantined','fixture: (nb) a file is held');
select is((select h->>'status' from (select pg_temp.hold('acct',pg_temp.sid('acct'),repeat('f',64)) h) x),'stored_quarantined','fixture: (acct) a file is held');
select ok((select owner_account_id=pg_temp.a('1') and subject_account_id=pg_temp.a('2') from public.subjects where id=pg_temp.sid('acct'))
 and (select owner_account_id=pg_temp.a('1') and subject_account_id is null from public.subjects where id=pg_temp.sid('nb')),
 'fixture: the uploader owns both records and one is bound to the person''s account');

create function pg_temp.h(p text) returns text language sql immutable as
 $$ select encode(extensions.digest('subject-delete-adult:'||p,'sha256'),'hex') $$;
create function pg_temp.del(p_account text, p_subject uuid, p_code text) returns jsonb language sql volatile as
 $$ select public.delete_subject_v1(pg_temp.a(p_account), pg_temp.s(p_account), p_subject, pg_temp.h(p_code),
   clock_timestamp() + interval '5 minutes') $$;
create function pg_temp.bars(p_subject uuid) returns bigint language sql as
 $$ select count(*) from public.contact_refusal_bars where target_kind='subject' and target_id=p_subject $$;
create temporary table hmacs as select x.subject_id, x.contact_hmac from (
 select sp.subject_id, e.contact_hmac from public.encrypted_contact_references e
  join public.subject_principals sp on sp.id=e.principal_id where e.status='current'
 union select sp.subject_id, h.contact_hmac from public.contact_hmac_indexes h
  join public.encrypted_contact_references e on e.id=h.contact_reference_id
  join public.subject_principals sp on sp.id=e.principal_id where e.status='current' and h.status='current') x
 where x.subject_id in (pg_temp.sid('nb'),pg_temp.sid('acct'));
select ok((select count(*) from hmacs where subject_id=pg_temp.sid('acct'))>0,'fixture: the bound record holds a current contact HMAC');

-- Not found for anyone else -----------------------------------------------------
select throws_ok($$select pg_temp.del('9',pg_temp.sid('acct'),'outsider')$$,'42501','not_found',
 'an outsider cannot delete a Path B record');
select throws_ok($$select pg_temp.del('2',pg_temp.sid('nb'),'other-person')$$,'42501','not_found',
 'a person cannot delete someone else''s Path B record');
select throws_ok($$select pg_temp.del('4',pg_temp.sid('nb'),'another-account')$$,'42501','not_found',
 'another account cannot delete it either');
select ok((select count(*) from public.account_operation_nonces where operation='subject_delete')=0
 and (select lifecycle from public.subjects where id=pg_temp.sid('acct'))='active'
 and (select lifecycle from public.subjects where id=pg_temp.sid('nb'))='active'
 and pg_temp.bars(pg_temp.sid('acct'))=0,
 'a refused delete records no code, ends no record and writes no bar');

-- The person deletes their own Path B record: deleted, with the bar ----------------
set local role service_role;
create temporary table person_delete as select pg_temp.del('2',pg_temp.sid('acct'),'person') body;
reset role;
select is((select body from person_delete),'{"case":"adult"}'::jsonb,'the person''s delete is accepted');
select ok((select lifecycle='purged' and subject_account_id is null from public.subjects where id=pg_temp.sid('acct')),
 'the record is purged and no longer names the person''s account');
select is((select state from public.other_adult_held_uploads where id=pg_temp.fxv('acct','revision')::uuid),'deleted',
 'the held file ends as deleted by the person');
select ok(pg_temp.bars(pg_temp.sid('acct'))>0
 and (select bool_and(exists(select 1 from public.contact_refusal_bars b where b.target_kind='subject' and b.target_id=pg_temp.sid('acct')
   and b.contact_hmac=x.contact_hmac)) from hmacs x where x.subject_id=pg_temp.sid('acct')),
 'the subject-controlled refusal bar names every contact HMAC the record held');
select ok((select bool_and(exists(select 1 from public.invitation_refusal_hmacs r where r.email_hmac=x.contact_hmac
   and r.expires_at>clock_timestamp()+interval '364 days')) from hmacs x where x.subject_id=pg_temp.sid('acct')),
 'each HMAC refuses a new invitation for a year');
select is((select count(*) from public.encrypted_contact_references e join public.subject_principals sp on sp.id=e.principal_id
  where sp.subject_id=pg_temp.sid('acct') and (e.status<>'shredded' or e.contact_ciphertext is not null)),0::bigint,
 'the record''s contact is shredded');
select is((select count(*) from public.legal_audit_log where event_code='subject.deleted' and route_id='api.subject-delete'
  and outcome_code='deleted' and (coded_context->>'refusal_bars')::int>0),1::bigint,'the audit records the person''s delete and its bar');
select is((select count(*) from public.account_operation_nonces where operation='subject_delete' and nonce_hash=pg_temp.h('person')),1::bigint,
 'the person''s code is spent');
select throws_ok($$select pg_temp.del('2',pg_temp.sid('acct'),'person-again')$$,'42501','not_found',
 'a purged record is not found');

-- The uploader deletes the other Path B record: withdrawn, no bar --------------------
set local role service_role;
create temporary table uploader_delete as select pg_temp.del('1',pg_temp.sid('nb'),'uploader') body;
reset role;
select is((select body from uploader_delete),'{"case":"adult"}'::jsonb,'the uploader''s delete is accepted');
select is((select lifecycle from public.subjects where id=pg_temp.sid('nb')),'purged','the uploader''s record is purged');
select is((select state from public.other_adult_held_uploads where id=pg_temp.fxv('nb','revision')::uuid),'withdrawn',
 'the held file ends as withdrawn by the uploader');
select is(pg_temp.bars(pg_temp.sid('nb')),0::bigint,'an uploader''s delete never writes the subject-controlled bar');
select is((select count(*) from public.invitation_refusal_hmacs r join hmacs x on x.contact_hmac=r.email_hmac
  where x.subject_id=pg_temp.sid('nb') and x.contact_hmac not in (select contact_hmac from hmacs where subject_id=pg_temp.sid('acct'))),0::bigint,
 'and no invitation refusal for the uploader''s record');
select is((select count(*) from public.legal_audit_log where event_code='subject.deleted' and route_id='api.subject-delete'
  and outcome_code='withdrawn'),1::bigint,'the audit records the uploader''s withdrawal');

-- Path A: a record accepted into the person's own account ---------------------------
insert into auth.users(id,email,raw_user_meta_data) values
 ('7a300000-0000-4000-8000-000000000001','subject-delete-path-a@example.invalid','{}'),
 ('7a300000-0000-4000-8000-000000000002','subject-delete-path-a-inviter@example.invalid','{}');
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('7a300000-0000-4000-8000-000000000011','7a300000-0000-4000-8000-000000000001',now(),now(),'aal1'),
 ('7a300000-0000-4000-8000-000000000012','7a300000-0000-4000-8000-000000000002',now(),now(),'aal1');
insert into public.subjects(id,owner_account_id,subject_account_id,subject_class,upload_class,display_label,lifecycle)
 values('7a300000-0000-4000-8000-000000000021',null,'7a300000-0000-4000-8000-000000000001','other_adult','adult','Synthetic Path A','active');
insert into public.subject_principals(id,subject_id,account_id,principal_kind,status)
 values('7a300000-0000-4000-8000-000000000022','7a300000-0000-4000-8000-000000000021','7a300000-0000-4000-8000-000000000001','account_subject','active');
insert into public.subject_account_bindings(subject_id,subject_principal_id,account_id,account_principal_id,binding_kind,binding_revision,status)
 select '7a300000-0000-4000-8000-000000000021','7a300000-0000-4000-8000-000000000022','7a300000-0000-4000-8000-000000000001',
  sp.id,'adult_claim',1,'current' from public.subject_principals sp
 where sp.account_id='7a300000-0000-4000-8000-000000000001' and sp.principal_kind='account_subject' and sp.status='active'
  and sp.subject_id<>'7a300000-0000-4000-8000-000000000021';
insert into public.subject_relationships(subject_id,data_subject_principal_id,recipient_principal_id,recipient_account_id,
 relationship_kind,relationship_revision,status)
 select '7a300000-0000-4000-8000-000000000021','7a300000-0000-4000-8000-000000000022',sp.id,sp.account_id,'family_member',1,'current'
 from public.subject_principals sp where sp.account_id='7a300000-0000-4000-8000-000000000002' and sp.principal_kind='account_subject' and sp.status='active';
create function pg_temp.del_a(p_account uuid,p_session uuid,p_code text) returns jsonb language sql volatile as
 $$ select public.delete_subject_v1(p_account,p_session,'7a300000-0000-4000-8000-000000000021',pg_temp.h(p_code),
   clock_timestamp()+interval '5 minutes') $$;
select throws_ok($$select pg_temp.del_a('7a300000-0000-4000-8000-000000000002','7a300000-0000-4000-8000-000000000012','inviter')$$,
 '42501','not_found','the inviting account cannot delete a Path A record');
set local role service_role;
create temporary table path_a_delete as select pg_temp.del_a('7a300000-0000-4000-8000-000000000001','7a300000-0000-4000-8000-000000000011','path-a') body;
reset role;
select is((select body from path_a_delete),'{"case":"adult"}'::jsonb,'the person''s own account deletes its Path A record');
select is((select lifecycle from public.subjects where id='7a300000-0000-4000-8000-000000000021'),'purged','the Path A record is purged');
select ok((select bool_and(status='revoked') from public.subject_relationships where subject_id='7a300000-0000-4000-8000-000000000021')
 and (select bool_and(status='revoked') from public.subject_account_bindings where subject_id='7a300000-0000-4000-8000-000000000021')
 and (select bool_and(status='deleted') from public.subject_principals where subject_id='7a300000-0000-4000-8000-000000000021'),
 'its relationships, binding and principal end');
select ok((select lifecycle='active' from public.subjects where subject_account_id='7a300000-0000-4000-8000-000000000001' and subject_class='self'),
 'the person''s own self record is untouched');

select * from finish();
rollback;
