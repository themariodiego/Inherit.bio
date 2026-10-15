-- Exact whole-graph refusal, using the registered native synthetic producers.
-- Physical byte metadata comes only from the existing bounded source fixture;
-- no provider acknowledgement, job/result, source state or foreign owner is forged.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir fixtures/invitation_quota_keys.inc
\ir fixtures/path_b_source_setup.inc

create function pg_temp.path_b_graph_snapshot() returns jsonb language plpgsql security definer set search_path='' as $$
declare relation text; rows jsonb; graph jsonb:='{}';
begin
 for relation in select distinct store_name from public.purge_target_stores
  union select unnest(array['auth.users','auth.sessions','storage.objects']) loop
  if to_regclass(relation) is null then raise exception 'registered graph store missing: %',relation;end if;
  execute format('select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text collate "C"),''[]''::jsonb) from %s t',to_regclass(relation)) into rows;
  graph:=graph||jsonb_build_object(relation,rows);
 end loop;
 return graph;
end $$;
create function pg_temp.path_b_refusal_probe(p_label text,p_accounts uuid[],p_sessions uuid[])
returns setof text language plpgsql security invoker set search_path=public,extensions as $$
declare i integer; graph jsonb; nonce text;
begin
 if cardinality(p_accounts) is distinct from cardinality(p_sessions) then raise exception 'fixture scope mismatch';end if;
 return next is(current_user::text,'service_role',p_label||': probes run as the actual service role');
 for i in 1..cardinality(p_accounts) loop
  graph:=pg_temp.path_b_graph_snapshot();
  nonce:=encode(extensions.digest('account-path-b-refusal:'||p_label||p_accounts[i]::text,'sha256'),'hex');
  return next throws_ok(format('select public.request_account_deletion_v2(%L::uuid,%L::uuid,%L,clock_timestamp()+interval ''9 minutes'',decode(%L,''hex''),%L,%L)',
   p_accounts[i],p_sessions[i],nonce,repeat('ab',16),repeat('d',64),encode(extensions.digest('notice:'||nonce,'sha256'),'hex')),
   '55000','unsupported_account_graph',p_label||': exact owned/bound recipient graph refuses before deletion');
  return next is(pg_temp.path_b_graph_snapshot(),graph,
   p_label||': every registered person-store plus Auth/Storage row is byte-identical after refusal');
  return next is((select count(*) from jsonb_array_elements(pg_temp.path_b_graph_snapshot()->'public.account_operation_nonces')n
   where n->>'nonce_hash'=nonce),0::bigint,p_label||': no rendered deletion nonce is recorded or spent');
  return next ok((select bool_and(p->>'deletion_requested_at' is null) from
   jsonb_array_elements(pg_temp.path_b_graph_snapshot()->'public.profiles')p where p->>'id'=p_accounts[i]::text),
   p_label||': the actual account remains outside a deletion hold');
 end loop;
end $$;
grant execute on function pg_temp.path_b_graph_snapshot(),pg_temp.path_b_refusal_probe(text,uuid[],uuid[]) to service_role;

-- An unrelated ordinary account still commits the original exact seven-day phase.
set local role service_role;
create temporary table ordinary_deletion as select * from public.request_account_deletion_v2(
 '0b5e0000-0000-4000-8000-000000000004','0b5e0000-0000-4000-8000-000000000014',
 repeat('f',64),clock_timestamp()+interval '9 minutes',decode(repeat('ab',16),'hex'),repeat('f',64),repeat('9',64));
select is((select status from ordinary_deletion),'notice_period','ordinary account deletion still uses its actual service door');
reset role;
select ok((select notice_ends_at=requested_at+interval '7 days' from public.account_deletion_requests
 where id is not null and account_id='0b5e0000-0000-4000-8000-000000000004'),
 'the unrelated ordinary account retains its original seven-day notice deadline');

-- A real unsigned draft is sufficient to require an exact graph executor.
select pg_temp.draft('unsigned',repeat('d',64));
set local role service_role;
select * from pg_temp.path_b_refusal_probe('unsigned draft',array[pg_temp.a('1')],array[pg_temp.s('1')]);
reset role;
-- Genuine account signature leaves the uploader and recipient as distinct actors.
select pg_temp.requested('main','a',repeat('a',64));
select is(pg_temp.account_confirms('a','deletion-bound-aaaaaaaaaaaaaaaa','2',repeat('a',64)),
 'accepted','the refusal fixture uses the real invited account signature');
set local role service_role;
select * from pg_temp.path_b_refusal_probe('bound subject',array[pg_temp.a('1'),pg_temp.a('2')],array[pg_temp.s('1'),pg_temp.s('2')]);
reset role;
select pg_temp.hold('main',pg_temp.sid('main'),repeat('e',64));
select ok((select h.state='pending' and u.status='held' and h.uploader_account_id=pg_temp.a('1')
 and p.account_id=pg_temp.a('2') from public.other_adult_held_uploads h
 join public.upload_sessions u on u.id=h.upload_session_id join public.subject_principals p on p.id=h.confirmation_principal_id
 where h.id=pg_temp.fxv('main','revision')::uuid),'the held tuple comes from actual issuance/finalization with separate bound authority');
set local role service_role;
select * from pg_temp.path_b_refusal_probe('pending held original',array[pg_temp.a('1'),pg_temp.a('2')],array[pg_temp.s('1'),pg_temp.s('2')]);
reset role;

-- Real permission and normalization produce a genuine queued report binding.
update auth.users set created_at=now()-interval '1 day' where id::text like '0b5e0000-%';
update public.report_templates set status='review' where status='published';
insert into public.report_templates(slug,category,title,summary,status,evidence,layer,estimate_kind,variants)
 values('synthetic-account-path-b-variant','synthetic','Synthetic variant','Synthetic deletion-refusal fixture.',
 'published','emerging','variant_call',null,
 '[{"rsid":123,"gene":"SYNTHETIC","chrom":1,"pos38":100000,"ref":"A","alt":"G","interpretations":{"AG":"Synthetic covered genotype"}}]');
create function pg_temp.insurance(p_account text,p_nonce text) returns jsonb language plpgsql as $$
declare c jsonb; own_subject uuid; a public.consent_artifacts;
begin
 select id into strict own_subject from public.subjects where subject_class='self' and subject_account_id=pg_temp.a(p_account);
 c:=private.own_upload_context_v1(pg_temp.a(p_account),pg_temp.s(p_account),own_subject);
 select * into strict a from public.consent_artifacts where artifact_key='disclosure.insurance-and-discrimination' and superseded_at is null;
 insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 values(repeat(p_nonce,64),pg_temp.a(p_account),pg_temp.s(p_account),'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes');
 return public.sign_own_upload_artifact_v1(pg_temp.a(p_account),pg_temp.s(p_account),own_subject,a.artifact_key,a.version,a.body_sha256,array['understood'],
 (c->>'accountRevision')::bigint,(c->>'authSessionRevision')::bigint,(c->>'jurisdictionRevision')::bigint,
 (c->>'subjectBindingRevision')::bigint,(c->>'accountBindingRevision')::bigint,repeat(p_nonce,64));
end $$;
select pg_temp.insurance('1','9');
select pg_temp.insurance('2','0');
select public.grant_path_b_purpose_v1(pg_temp.a('2'),pg_temp.s('2'),pg_temp.sid('main'),'reports.monogenic','self',
 a.version,a.body_sha256,repeat('6',64),clock_timestamp()+interval '5 minutes',true)
 from public.consent_artifacts a where a.artifact_key='consent.own-monogenic' and a.superseded_at is null;
select pg_temp.notice_session('main','1');
select is(public.respond_adult_upload_revision_v1(repeat('1',64),'deletion-confirm-11111111111111','confirm',pg_temp.a('2')),
 'confirmed','the exact mailed held revision really admits normalization');
create temporary table normalization as select public.path_b_normalization_v1('claim',null,repeat('7',64),null,null,true)c;
select ok((select c is not null and c->>'fileId'=pg_temp.fxv('main','revision')
 and c->>'subjectId'=pg_temp.sid('main')::text and c->>'objectId'=pg_temp.fxv('main','object')
 and c->>'rawSha256'=repeat('e',64) and c->>'decodedSha256'=repeat('b',64)
 and (c->>'sourceRevision')::bigint=1 and (c->>'claimExpiresAt')::timestamptz>clock_timestamp()
 and exists(select 1 from public.worker_jobs j where j.id=(c->>'jobId')::uuid
  and j.status='running' and j.file_id=pg_temp.fxv('main','revision')::uuid
  and j.user_id=pg_temp.a('1') and j.subject_id=pg_temp.sid('main')
  and j.claim_token_hash=repeat('7',64) and j.claim_expires_at=(c->>'claimExpiresAt')::timestamptz
  and j.computation_revision='path-b-normalization-v1' and j.output_kind='ingest.normalize') from normalization),
 'the actual worker returns one current claimed uploader source under both genuine insurance signatures');
select is(public.path_b_normalization_v1('stage',(c->>'jobId')::uuid,repeat('7',64),(c->>'claim')::uuid,
 '{"kind":"variants","sequence":0,"rows":[{"rsid":123,"chrom":1,"pos":100000,"ref":"A","alt":"G","genotype":"A/G"}]}',true),
 'true'::jsonb,'the planted source passes through the actual normalization stage') from normalization;
select is(public.path_b_normalization_v1('complete',(c->>'jobId')::uuid,repeat('7',64),(c->>'claim')::uuid,
 jsonb_build_object('sourceBuild','GRCh38','rawSha256',repeat('e',64),'decodedSha256',repeat('b',64),'variantCount',1,'observedCallCount',0,
 'provenance',jsonb_build_object('version','path-b-normalization-v1','sourceRevision',1,'liftoverSha256',null,'attempted',0,'unmapped',0)),true)->>'analysisState',
 'not_generated','the genuine normalized source invents no analytic result') from normalization;
select ok((select count(*)=1 and bool_and(b.state='queued' and b.result is null and b.staged_result is null
 and b.recipient_account_id=pg_temp.a('2') and j.status='queued') from private.path_b_report_bindings b
 join public.worker_jobs j on j.id=b.job_id where b.subject_id=pg_temp.sid('main')),
 'the actual permission/publication producer queues exactly its bound report with no manufactured result');
select lives_ok('set constraints all immediate','all real deferred source/authority constraints pass before the deletion probes');
set constraints all deferred;
set local role service_role;
select * from pg_temp.path_b_refusal_probe('normalized queued report',array[pg_temp.a('1'),pg_temp.a('2')],array[pg_temp.s('1'),pg_temp.s('2')]);
select throws_ok($$select public.request_account_deletion_v2(pg_temp.a('1'),pg_temp.s('2'),repeat('2',64),
 clock_timestamp()+interval '9 minutes',decode(repeat('ab',16),'hex'),repeat('d',64),repeat('8',64))$$,
 '42501','recent_reauthentication_required','foreign Auth refuses before revealing any Path B graph condition');
select throws_ok($$select private.assert_account_path_b_deletion_supported_v1(pg_temp.a('1'))$$,'42501',null,
 'the Path B graph selector has no direct service execution door');
reset role;
select ok(not has_function_privilege(r,'private.assert_account_path_b_deletion_supported_v1(uuid)','execute'),
 r||' cannot call the internal graph selector') from unnest(array['anon','authenticated','inherit_upload_only','service_role'])r;
select * from finish();
rollback;
