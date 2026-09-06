begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select is((select tgenabled::text from pg_trigger where tgrelid='public.consent_artifacts'::regclass
 and tgname='consent_artifacts_immutable'),'O','artifact immutability is restored after the versioning migration');
select is((select count(*) from public.consent_artifacts where artifact_key in('consent.own-monogenic','consent.own-polygenic')
 and version=1 and superseded_at is not null),2::bigint,'both original artifact versions remain in immutable history');
select is((select count(*) from public.consent_artifacts where artifact_key in('consent.own-monogenic','consent.own-polygenic')
 and version=2 and superseded_at is null),2::bigint,'the two current artifacts describe actual result layers');
insert into auth.users(id,email,raw_user_meta_data) values
 ('76900000-0000-4000-8000-000000000001','own-report-purpose@e2e.local','{"display_name":"Synthetic report choices"}');
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('76900000-0000-4000-8000-000000000010','76900000-0000-4000-8000-000000000001',now(),now(),'aal1');
update public.profiles set date_of_birth=date '1990-01-01' where id='76900000-0000-4000-8000-000000000001';
create temporary table own_report_subject as select id from public.subjects
 where subject_account_id='76900000-0000-4000-8000-000000000001' and subject_class='self';
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 select repeat(letter,64),'76900000-0000-4000-8000-000000000001',
 '76900000-0000-4000-8000-000000000010','own_upload_artifact_sign',clock_timestamp()+interval '9 minutes'
 from unnest(array['a','b']) letter;
select public.sign_own_upload_artifact_v1('76900000-0000-4000-8000-000000000001',
 '76900000-0000-4000-8000-000000000010',(select id from own_report_subject),
 'disclosure.insurance-and-discrimination',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='disclosure.insurance-and-discrimination' and version=1),
 array['understood'],1,1,1,1,1,repeat('a',64));
select public.sign_own_upload_artifact_v1('76900000-0000-4000-8000-000000000001',
 '76900000-0000-4000-8000-000000000010',(select id from own_report_subject),
 'consent.upload-self',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.upload-self' and version=1),
 array['own-adult-dna'],1,1,1,1,1,repeat('b',64));
create temporary table own_report_snapshot as select public.own_report_context_v1(
 '76900000-0000-4000-8000-000000000001','76900000-0000-4000-8000-000000000010',(select id from own_report_subject)) snapshot;
create function pg_temp.grant_report(p_purpose text,p_nonce text,p_patch jsonb default '{}'::jsonb) returns jsonb language sql as $$
 select public.grant_own_report_purpose_v1('76900000-0000-4000-8000-000000000001',
 '76900000-0000-4000-8000-000000000010',(select id from own_report_subject),
 (select snapshot||p_patch from own_report_snapshot),p_purpose,
 (select version from public.consent_artifacts where artifact_key=case p_purpose
  when 'reports.monogenic' then 'consent.own-monogenic' when 'reports.polygenic' then 'consent.own-polygenic'
  else 'consent.own-ancestry' end and superseded_at is null),
 (select body_sha256 from public.consent_artifacts where artifact_key=case p_purpose
  when 'reports.monogenic' then 'consent.own-monogenic' when 'reports.polygenic' then 'consent.own-polygenic'
  else 'consent.own-ancestry' end and superseded_at is null),p_nonce,clock_timestamp()+interval '9 minutes');
$$;
select throws_ok($$select public.grant_own_report_purpose_v1('76900000-0000-4000-8000-000000000001',
 '76900000-0000-4000-8000-000000000010',(select id from own_report_subject),(select snapshot from own_report_snapshot),
 'reports.monogenic',1,'2d15be63b5ff226bcf9e5c2a57f35a9956dd20b37ef64955708278fd1efa779f',repeat('c',64),clock_timestamp()+interval '9 minutes')$$,
 '55000','consent_artifact_changed','a superseded presentation cannot grant the new layer permission');
select ok(not has_function_privilege('authenticated','public.own_report_context_v1(uuid,uuid,uuid)','EXECUTE'),
 'browser cannot resolve private report authority');
select ok(not has_function_privilege('inherit_upload_only','public.grant_own_report_purpose_v1(uuid,uuid,uuid,jsonb,text,integer,text,text,timestamptz)','EXECUTE'),
 'upload-only bearer cannot grant analysis');
select is((select count(*) from public.purpose_grants where target_id=(select id from own_report_subject)),0::bigint,
 'storing DNA does not create a report-purpose grant');
grant select on own_report_subject,own_report_snapshot to service_role;
set local role service_role;
select lives_ok($$select pg_temp.grant_report('reports.monogenic',repeat('c',64))$$,'service-only transaction can grant one own result');
reset role;
select is((select count(*) from public.purpose_grants where target_id=(select id from own_report_subject) and revoked_at is null),1::bigint,
 'one choice creates exactly one base grant');
select is((select count(*) from public.purpose_grants where target_id=(select id from own_report_subject) and purpose in('reports.polygenic','ancestry')),0::bigint,
 'monogenic does not imply polygenic or ancestry');
select is((select count(*) from public.purpose_grants pg join public.directional_grants dg
 on dg.grant_id=pg.grant_id and dg.grant_revision=pg.grant_revision
 where pg.target_id=(select id from own_report_subject) and dg.direction='self' and dg.recipient_principal_id=pg.data_subject_principal_id
 and dg.recipient_account_id='76900000-0000-4000-8000-000000000001' and dg.relationship_id is null and dg.pair_id is null
 and dg.relationship_or_pair_revision=1 and dg.self_principal_revision=1),1::bigint,'grant pair binds only this account and exact principal revision');
select throws_ok($$select pg_temp.grant_report('reports.monogenic',repeat('c',64))$$,'23505',null,'presentation nonce cannot be replayed');
select lives_ok($$select pg_temp.grant_report('reports.monogenic',repeat('d',64))$$,'fresh presentation reuses identical live grant');
select is((select count(*) from public.purpose_grants where target_id=(select id from own_report_subject)),1::bigint,'idempotent choice does not duplicate grants');
select throws_ok($$select pg_temp.grant_report('ancestry',repeat('e',64),'{"principalRevision":2}')$$,'42501','not_found','stale principal snapshot writes nothing');
select throws_ok($$select pg_temp.grant_report('ancestry',repeat('e',64),'{"recipientAccountId":"76900000-0000-4000-8000-000000000001"}')$$,
 '42501','not_found','snapshot rejects extra recipient overrides');
select lives_ok($$select pg_temp.grant_report('ancestry',repeat('e',64))$$,'another independent choice works after refused transaction');
select throws_ok($$select pg_temp.grant_report('copilot.cloud',repeat('f',64))$$,'22023','invalid_request','not an outside-AI permission shortcut');
savepoint revoked_store;
update public.subject_consents set revoked_at=clock_timestamp(),revocation_reason='withdrawn'
 where subject_id=(select id from own_report_subject) and consent_type='upload_class';
select throws_ok($$select pg_temp.grant_report('reports.polygenic',repeat('f',64))$$,'55000','upload_consent_required','live store withdrawal invalidates outstanding presentation');
rollback to revoked_store;
savepoint changed_principal;
update public.subject_principals set principal_revision=principal_revision+1 where id=(select (snapshot->>'principalId')::uuid from own_report_snapshot);
select throws_ok($$select pg_temp.grant_report('reports.polygenic',repeat('f',64))$$,'42501','not_found','current principal revision is rechecked in grant transaction');
rollback to changed_principal;
savepoint stopped_subject;
update public.subjects set lifecycle='restricted' where id=(select id from own_report_subject);
select throws_ok($$select pg_temp.grant_report('reports.polygenic',repeat('f',64))$$,'42501','not_found','restricted subject cannot grant a result');
rollback to stopped_subject;
select lives_ok($$select public.revoke_directional_purpose_v1('76900000-0000-4000-8000-000000000001',
 (select grant_id from public.purpose_grants where target_id=(select id from own_report_subject) and purpose='reports.monogenic'))$$,
 'existing self-signer revocation ends the canonical pair');
select is((select count(*) from public.purpose_grants pg join public.directional_grants dg
 on dg.grant_id=pg.grant_id and dg.grant_revision=pg.grant_revision where pg.target_id=(select id from own_report_subject)
 and pg.purpose='reports.monogenic' and pg.revoked_at is not null and dg.status='revoked'),1::bigint,'both self rows are revoked together');
select is((select count(*) from public.purpose_grants where target_id=(select id from own_report_subject) and purpose='ancestry' and revoked_at is null),1::bigint,
 'revoking genetic findings leaves ancestry choice unchanged');
set constraints all immediate;
select * from finish();
rollback;
