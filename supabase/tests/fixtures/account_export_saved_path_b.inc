-- Exact first committed-source segment of path_b_queued_reports.sql; original assertions retained.
-- This include has no BEGIN/ROLLBACK: its caller owns the synthetic transaction.
-- Synthetic rollback-only queued report authority, publication and isolation.
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
\ir invitation_quota_keys.inc
\ir path_b_source_setup.inc

update auth.users set created_at=now()-interval '1 day' where id::text like '0b5e0000-%';
-- Isolate reference selection to two published, synthetic templates.
update public.report_templates set status='review' where status='published';
insert into public.report_templates(slug,category,title,summary,status,evidence,layer,estimate_kind,variants)
 values('synthetic-path-b-variant','synthetic','Synthetic variant','Synthetic queued-report fixture.',
  'published','emerging','variant_call',null,
  '[{"rsid":123,"gene":"SYNTHETIC","chrom":1,"pos38":100000,"ref":"A","alt":"G","interpretations":{"AG":"Synthetic covered genotype"}}]'),
 ('synthetic-path-b-estimate','synthetic','Synthetic estimate','Synthetic queued-report fixture.',
  'published','emerging','estimate','single_locus',
  '[{"rsid":123,"gene":"SYNTHETIC","chrom":1,"pos38":100000,"ref":"A","alt":"G","interpretations":{"AG":"Synthetic covered genotype"}}]');
create function pg_temp.insurance(p_account text,p_nonce text) returns jsonb language plpgsql as $$
declare c jsonb; v_subject uuid; a public.consent_artifacts%rowtype;
begin
 select id into strict v_subject from public.subjects where subject_class='self' and subject_account_id=pg_temp.a(p_account);
 c:=private.own_upload_context_v1(pg_temp.a(p_account),pg_temp.s(p_account),v_subject);
 select * into strict a from public.consent_artifacts where artifact_key='disclosure.insurance-and-discrimination' and superseded_at is null;
 insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
  values(repeat(p_nonce,64),pg_temp.a(p_account),pg_temp.s(p_account),'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes');
 return public.sign_own_upload_artifact_v1(pg_temp.a(p_account),pg_temp.s(p_account),v_subject,a.artifact_key,a.version,a.body_sha256,
  array['understood'],(c->>'accountRevision')::bigint,(c->>'authSessionRevision')::bigint,(c->>'jurisdictionRevision')::bigint,
  (c->>'subjectBindingRevision')::bigint,(c->>'accountBindingRevision')::bigint,repeat(p_nonce,64));
end;
$$;
select pg_temp.insurance('1','9');
select pg_temp.insurance('2','0');
select pg_temp.requested('main','a',repeat('a',64));
select is(pg_temp.account_confirms('a','queue-sign-aaaaaaaaaaaaaaaaaaa','2',repeat('a',64)),
 'accepted','the report source has actual subject confirmation');
select pg_temp.hold('main',pg_temp.sid('main'),repeat('e',64));
create temporary table report_grants(name text primary key,receipt jsonb);
insert into report_grants select 'self-variant',public.grant_path_b_purpose_v1(pg_temp.a('2'),pg_temp.s('2'),pg_temp.sid('main'),
 'reports.monogenic','self',a.version,a.body_sha256,repeat('6',64),clock_timestamp()+interval '5 minutes',true)
 from public.consent_artifacts a where a.artifact_key='consent.own-monogenic' and a.superseded_at is null;
select is((select path_b_originating_session_id from public.purpose_grants where grant_id=
 ((select receipt->>'recordId' from report_grants where name='self-variant'))::uuid),pg_temp.s('2'),
 'the grant records its actual signing session rather than selecting one later');
select is((select count(*) from private.path_b_report_bindings),0::bigint,'a purpose cannot queue analysis before exact normalization');
select pg_temp.notice_session('main','1');
select is(public.respond_adult_upload_revision_v1(repeat('1',64),'queue-confirm-11111111111111','confirm',pg_temp.a('2')),
 'confirmed','the exact source revision is confirmed for normalization');
select is((select count(*) from private.path_b_report_bindings),0::bigint,'queueing normalization creates no analytic binding');
create temporary table source_claim(c jsonb);
create temporary table stale_normalization(id uuid);
with stale as(insert into public.worker_jobs(user_id,file_id,subject_id,kind,output_kind,computation_revision,
 source_binding_kind,source_binding_id,source_binding_revision,file_sha256,idempotency_key,payload,created_at)
 select user_id,file_id,subject_id,kind,output_kind,computation_revision,source_binding_kind,source_binding_id,
 source_binding_revision,file_sha256,encode(extensions.digest('synthetic-stale-normalization','sha256'),'hex'),
 '{"authority":{}}',clock_timestamp()-interval '1 day' from public.worker_jobs where computation_revision='path-b-normalization-v1'
 returning id) insert into stale_normalization select id from stale;
insert into source_claim select public.path_b_normalization_v1('claim',null,repeat('7',64),null,null,true);
select is((select status from public.worker_jobs where id=(select id from stale_normalization)),'cancelled',
 'an oldest stale normalization snapshot is terminalized without source reads or generated rows');
select isnt((select(c->>'jobId')::uuid from source_claim),(select id from stale_normalization),
 'the same bounded claim reaches the next actually current source rather than starving behind stale admission');
select is(public.path_b_normalization_v1('stage',(c->>'jobId')::uuid,repeat('7',64),(c->>'claim')::uuid,
 '{"kind":"variants","sequence":0,"rows":[{"rsid":123,"chrom":1,"pos":100000,"ref":"A","alt":"G","genotype":"A/G"}]}',true),
 'true'::jsonb,'the source is normalized through its separate claim') from source_claim;
select is(public.path_b_normalization_v1('complete',(c->>'jobId')::uuid,repeat('7',64),(c->>'claim')::uuid,
 jsonb_build_object('sourceBuild','GRCh38','rawSha256',repeat('e',64),'decodedSha256',repeat('b',64),
  'variantCount',1,'observedCallCount',0,'provenance',jsonb_build_object('version','path-b-normalization-v1',
   'sourceRevision',1,'liftoverSha256',null,'attempted',0,'unmapped',0)),true)->>'analysisState',
 'not_generated','normalization still returns no analytic result receipt') from source_claim;
select is((select count(*) from private.path_b_report_bindings),1::bigint,'normalization reevaluates only the one current selected report grant');
select ok((select f.storage_object_id is null
 and b.authority->'source'->>'objectId'=n.manifest->>'objectId'
 and b.authority->'source'->>'objectKey'=f.bucket_path
 and (b.authority->'source'->>'sizeBytes')::bigint=f.size_bytes
 and b.authority->'source'->>'fileType'=f.file_type::text
 from private.path_b_report_bindings b join public.genome_files f on f.id=b.file_id
 join private.own_normalization_runs n on n.file_id=f.id),
 'the report binds the actual held original and complete descriptor without inventing an own-file storage binding');
select lives_ok('set constraints all immediate',
 'normalization and its genuine queued report satisfy every real deferred transaction constraint');
set constraints all deferred;
select is((select kind||'/'||output_kind from public.worker_jobs where computation_revision like 'path-b-reports-v1:%'),
 'compute_monogenic_report/report.monogenic','the exact purpose selects its registered distinct kind and output');
select is(public.enqueue_path_b_reports_v1(pg_temp.sid('main'),true),1,'an identical current snapshot reuses its one binding and job');
select is((select count(*) from private.path_b_report_bindings),1::bigint,'replay creates no second source binding');
select is((select count(*) from public.worker_jobs where computation_revision like 'path-b-reports-v1:%'),1::bigint,
 'replay creates no second worker row');
select throws_ok($$select public.enqueue_path_b_reports_v1(pg_temp.sid('main'),false)$$,'42501','not_found',
 'the production gate cannot enqueue report work');
select ok((private.claim_worker_job_v2('synthetic-generic',repeat('5',64),60)).id is null,
 'the generic worker cannot borrow another adult''s queued report');
select throws_ok($$update public.worker_jobs set output_kind='report.polygenic'
 where kind='compute_monogenic_report'$$,'23514','worker job dispatch binding is immutable',
 'an existing queued report cannot change its output to a weaker purpose');
select throws_ok($$update public.worker_jobs set payload='{}' where kind='compute_monogenic_report'$$,
 '23514','Path B report authority is immutable','a report cannot detach its exact binding snapshot');
select throws_ok($$update public.purpose_grants set path_b_originating_session_id=pg_temp.s('1')
 where grant_id=((select receipt->>'recordId' from report_grants where name='self-variant'))::uuid$$,
 '23514','Path B signing session is immutable','a report cannot replace the person''s signing session');
select throws_ok($$select public.path_b_report_v1('claim',null,repeat('8',64),null,null,false)$$,
 '42501','not_found','the production gate cannot claim or read report work');
create temporary table report_claim(c jsonb);
insert into report_claim select public.path_b_report_v1('claim',null,repeat('8',64),null,null,true);
create function pg_temp.report(p_operation text,p_payload jsonb default null) returns jsonb language sql as $$
 select public.path_b_report_v1(p_operation,(c->>'jobId')::uuid,repeat('8',64),(c->>'claim')::uuid,p_payload,true) from report_claim;
$$;
select is(pg_temp.report('check'),(select c from report_claim),'every checkpoint returns the exact current immutable claim');
select is((select c->>'purpose' from report_claim),'reports.monogenic','the claim cannot substitute a different report layer');
select throws_ok($$select public.path_b_report_v1('read-variants',(select(c->>'jobId')::uuid from report_claim),
 repeat('9',64),(select(c->>'claim')::uuid from report_claim),'{"loci":[{"chrom":1,"pos":100000}],"offset":0}',true)$$,
 '42501','not_found','a foreign claim hash cannot read genetic evidence');
select is(pg_temp.report('read-variants','{"loci":[{"chrom":1,"pos":100000}],"offset":0}'),
 jsonb_build_array(jsonb_build_object('file_id',pg_temp.fxv('main','revision'),'rsid',123,'chrom',1,'pos',100000,
  'ref','A','alt','G','genotype','A/G')),'the exact claim reads only its actual source locus');
select is(pg_temp.report('read-observed','{"loci":[{"chrom":1,"pos":100000}],"offset":0}'),'[]'::jsonb,
 'an absent observed call is not invented from the reference allele');
select throws_ok($$select pg_temp.report('read-variants','{"loci":[{"chrom":1,"pos":100000}],"offset":"0"}')$$,
 '22023','invalid_request','the page contract refuses string offsets');
select throws_ok($$select pg_temp.report('read-variants','{"loci":[{"chrom":"1","pos":100000}],"offset":0}')$$,
 '22023','invalid_request','the page contract refuses coerced locus coordinates');
create function pg_temp.result_payload(p_purpose text) returns jsonb language sql as $$
 select jsonb_build_object('reports',coalesce(jsonb_agg(jsonb_build_object('slug',t.slug,'covered',true,
  'catalogSnapshot',jsonb_build_object('schemaVersion',1,'template',jsonb_build_object('slug',t.slug,'category',t.category,
   'title',t.title,'summary',t.summary,'evidence',t.evidence,'variants',t.variants,'pgs_id',t.pgs_id,
   'citations',t.citations,'layer',t.layer,'estimate_kind',t.estimate_kind)),
  'variants',jsonb_build_array(jsonb_build_object('rsid',123,'outcome',jsonb_build_object('status','genotyped','genotype','AG',
   'interpretation','Synthetic covered genotype','strandFlipped',false))),'conflictingRsids','[]'::jsonb) order by t.slug),'[]'),
  'prs','[]'::jsonb) from public.report_templates t where status='published'
   and layer::text=case p_purpose when 'reports.monogenic' then 'variant_call' else 'estimate' end;
$$;
select throws_ok($$select pg_temp.report('stage',null)$$,'22023','invalid_request','a null result never stages a false completion');
select throws_ok($$select pg_temp.report('stage',jsonb_set(pg_temp.result_payload('reports.monogenic'),'{reports,0,covered}','false'))$$,
 '22023','invalid_request','covered must match the exact stored outcome schema');
select throws_ok($$select pg_temp.report('stage',pg_temp.result_payload('reports.polygenic'))$$,
 '22023','invalid_report_catalog','an estimate payload cannot satisfy a specific-variant claim');
select is(public.path_b_report_results_v1(pg_temp.a('2'),pg_temp.s('2'),pg_temp.sid('main'),'reports.monogenic',true),
 '[]'::jsonb,'no report can be read before atomic completion');
create function pg_temp.expire_report_stage() returns trigger language plpgsql as $$
begin
 update private.path_b_report_bindings set expires_at=clock_timestamp()-interval '1 second' where id=new.id;
 return new;
end;
$$;
create trigger synthetic_expire_report_stage after update of staged_result on private.path_b_report_bindings
 for each row when(new.staged_result is not null) execute function pg_temp.expire_report_stage();
select throws_ok($$select pg_temp.report('stage',pg_temp.result_payload('reports.monogenic'))$$,
 '42501','not_found','expiry inside staging rolls back the complete private write');
select ok((select staged_result is null and expires_at>clock_timestamp() from private.path_b_report_bindings),
 'the failed stage also rolls back its synthetic expiry mutation');
drop trigger synthetic_expire_report_stage on private.path_b_report_bindings;
select is(pg_temp.report('stage',pg_temp.result_payload('reports.monogenic')),'true'::jsonb,'a bounded exact-purpose result stages privately');
select throws_ok($$select pg_temp.report('stage',pg_temp.result_payload('reports.monogenic'))$$,
 '22023','invalid_request','an uncertain or duplicate stage is never replayed');
select is(public.path_b_report_results_v1(pg_temp.a('2'),pg_temp.s('2'),pg_temp.sid('main'),'reports.monogenic',true),
 '[]'::jsonb,'private staging remains unreadable to the person');
create trigger synthetic_expire_report_completion after update of state on private.path_b_report_bindings
 for each row when(new.state='complete') execute function pg_temp.expire_report_stage();
select throws_ok($$select pg_temp.report('complete')$$,'42501','not_found',
 'expiry during publication rolls back both result and worker completion');
select ok((select state='running' and staged_result is not null and result is null from private.path_b_report_bindings),
 'the failed publication preserves only the earlier private stage');
select is((select status from public.worker_jobs where id=(select(c->>'jobId')::uuid from report_claim)),'running',
 'the failed publication does not mark its worker done');
drop trigger synthetic_expire_report_completion on private.path_b_report_bindings;
select is(pg_temp.report('complete'),'{"status":"complete","purpose":"reports.monogenic"}'::jsonb,
 'only the exact completed queued report commits');
