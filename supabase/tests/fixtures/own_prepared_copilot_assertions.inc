-- Extends the actual publication, completion and DB recovery fixtures in
-- own_prepared_report_authority.sql. Synthetic metadata is not provider proof.
create temporary table prepared_copilot_binding as select user_id account_id,
 '90000000-0000-4000-8000-000000000010'::uuid session_id,subject_id from public.genome_files where id=pg_temp.file_id();
\ir own_prepared_copilot_context.inc
create temporary table prepared_chat_source as select s value
 from prepared_chat_projection cross join lateral jsonb_array_elements(value->'sources') s where s->>'id'=pg_temp.file_id()::text;
select is(jsonb_array_length((select value->'sources' from prepared_chat_projection)),2,'Copilot admits the real prepared and recovered DB sources');
select is((select value->'unavailableSources' from prepared_chat_projection),'[]'::jsonb,'both independently valid backends are available');
select is((select value->'preparedSource' from prepared_chat_source),
 (select receipt#>'{authorization,preparedSource}' from report_claims where purpose='reports.polygenic'),
 'Copilot pins exactly the manifest, membership digest and root used by the completed report');
select is((select value-'completed'-'preparedSource' from prepared_chat_source),
 (select jsonb_build_object('id',id,'revision',upload_revision,'sha256',sha256,'decodedSha256',source_sha256,
 'objectId',storage_object_id,'normalizedAt',normalization_completed_at,'build',build) from public.genome_files where id=pg_temp.file_id()),
 'prepared source keeps every existing file identity used by history and purge');
select is((select s-'completed' from prepared_chat_projection cross join lateral jsonb_array_elements(value->'sources') s
 where s->>'id'=(select id::text from db_source)),
 (select jsonb_build_object('id',id,'revision',upload_revision,'sha256',sha256,'decodedSha256',source_sha256,
 'objectId',storage_object_id,'normalizedAt',normalization_completed_at,'build',build) from public.genome_files where id=(select id from db_source)),
 'DB source preserves the exact prior shape with no new or null backend property');
select is((select value->'completed' from prepared_chat_source),
 (select jsonb_agg(jsonb_build_object('purpose',r.purpose,'authority',r.authority #- '{context,authSessionRevision}' #- '{context,originatingSessionRevision}',
 'runId',r.id,'completedAt',r.completed_at,'resultHash',encode(digest(convert_to(r.result::text,'UTF8'),'sha256'),'hex'))
 order by case r.purpose when 'reports.monogenic' then 0 when 'reports.polygenic' then 1 else 2 end)
 from private.own_analysis_runs r where r.file_id=pg_temp.file_id() and r.state='complete'),
 'prepared reports and ancestry retain exact completed journal, authority and content hashes');
set local role service_role;
select is(pg_temp.prepared_chat('check','{}',null,(select value from prepared_chat_projection)),'true'::jsonb,'application role can revalidate the full prepared projection');
select is(jsonb_array_length(pg_temp.prepared_chat('calls','{"rsids":[762551],"offset":0}',null,(select value from prepared_chat_projection))),1,
 'SQL calls include only the genuinely normalized DB source');
select is(pg_temp.prepared_chat('calls','{"rsids":[762551],"offset":0}',null,(select value from prepared_chat_projection))->0->>'file_id',
 (select id::text from db_source),'SQL calls never pretend to have read prepared bytes');
select is((select count(*) from jsonb_array_elements(pg_temp.prepared_chat('reports','{"offset":0}',null,(select value from prepared_chat_projection))) r
 where r->>'file_id'=pg_temp.file_id()::text),1::bigint,'existing report tool reads the completed prepared report');
select is((select public.own_copilot_ancestry_v1(account_id,session_id,subject_id,(select value from prepared_copilot_authority),
 (select value from prepared_chat_projection),pg_temp.file_id())->'content' from prepared_copilot_binding),
 (select payload->'ancestry' from ancestry_output),'existing ancestry facade returns exactly the captured prepared result');
create temporary table prepared_chat_id as select (pg_temp.prepared_turn(repeat('c2',32))->>'chatId')::uuid id;
select pg_temp.prepared_turn(null,(select id from prepared_chat_id),1);
select is(jsonb_array_length(pg_temp.prepared_chat('history','{}',(select id from prepared_chat_id))->'messages'),4,
 'prepared-dependent first pair and later pair remain atomically readable');
reset role;
-- Regression data deliberately simulates stale historical SQL rows. It cannot
-- give an object source a fallback, and all such rows are rolled back here.
savepoint copilot_stale_sql_rows;
insert into public.user_variants(user_id,subject_id,file_id,rsid,chrom,pos,ref,alt,genotype)
 select user_id,subject_id,id,762551,15,74749576,'C','A','C/C' from public.genome_files where id=pg_temp.file_id();
insert into public.report_observed_calls(file_id,user_id,subject_id,source_line,source_sha256,extraction_version,source_build,
 source_chrom,source_pos,source_ref,source_alt,source_gt,rsid,chrom,pos,ref,alt,genotype,quality_state,usable)
 select pg_temp.file_id(),user_id,subject_id,source_line,repeat('a',64),extraction_version,source_build,
 source_chrom,source_pos,source_ref,source_alt,source_gt,rsid,chrom,pos,ref,alt,'C/C',quality_state,usable
 from public.report_observed_calls where file_id=(select id from db_source);
select is(pg_temp.prepared_chat('calls','{"rsids":[762551],"offset":0}',null,(select value from prepared_chat_projection)),
 jsonb_build_array(jsonb_build_object('file_id',(select id from db_source),'rsid',762551,'chrom',15,'pos',74749576,
 'ref','C','alt','A','genotype','A/C','usable',true)),'both stale prepared SQL selectors are excluded while the DB call is unchanged');
rollback to copilot_stale_sql_rows;
savepoint copilot_source_revision;
update public.genome_files set upload_revision=upload_revision+1,normalization_source_revision=normalization_source_revision+1 where id=pg_temp.file_id();
select throws_ok($$select pg_temp.prepared_chat('check','{}',null,(select value from prepared_chat_projection))$$,
 '42501','not_found','coherent source revision change rejects the whole captured union');
select is(pg_temp.prepared_chat('prepare')->'unavailableSources',jsonb_build_array(jsonb_build_object('id',pg_temp.file_id(),'reason','source_unavailable')),
 'changed prepared source is unavailable rather than silently missing');
rollback to copilot_source_revision;
savepoint copilot_nonroot_loss;
delete from storage.objects where id=(select storage_object_id from private.own_preparation_artifacts
 where id=(select (value->>'artifactId')::uuid from pub_receipts where label='artifact1'));
select is(pg_temp.prepared_chat('prepare')->'unavailableSources',jsonb_build_array(jsonb_build_object('id',pg_temp.file_id(),'reason','source_unavailable')),
 'unread non-root member loss prevents prepared admission');
select throws_ok($$select pg_temp.prepared_chat('check','{}',null,(select value from prepared_chat_projection))$$,
 '42501','not_found','full projection check detects unread member loss');
select throws_ok($$select pg_temp.prepared_chat('history','{}',(select id from prepared_chat_id))$$,
 '42501','not_found','member loss invalidates dependent history');
select throws_ok($$select pg_temp.prepared_turn(null,(select id from prepared_chat_id),2)$$,
 '42501','not_found','member loss refuses atomic response commit');
rollback to copilot_nonroot_loss;
savepoint copilot_root_loss;
delete from storage.objects where id=(select (value#>>'{root,storageObjectId}')::uuid from pub_receipts where label='published');
select throws_ok($$select pg_temp.prepared_chat('check','{}',null,(select value from prepared_chat_projection))$$,
 '42501','not_found','lost published root cannot retain prior Copilot authority');
rollback to copilot_root_loss;
savepoint copilot_store_withdrawal;
update public.subject_consents set revoked_at=clock_timestamp(),revocation_reason='withdrawn'
 where id=(select (authority->>'uploadConsentId')::uuid from private.own_preparation_jobs where id=pg_temp.job_id());
select throws_ok($$select pg_temp.prepared_chat('check','{}',null,(select value from prepared_chat_projection))$$,
 '42501','not_found','source store withdrawal rejects prepared Copilot authority');
rollback to copilot_store_withdrawal;
savepoint copilot_prepared_file_delete;
select public.prepare_genome_file_deletion_v1(account_id,session_id,pg_temp.file_id()) from prepared_copilot_binding;
select is((select jsonb_array_length(canonical_chat_manifest) from private.genome_file_deletions where file_id=pg_temp.file_id()),4,
 'selected prepared-file deletion freezes both exact pairs and their dependent suffix');
select ok((select bool_and(m.id is not null and m.turn_id=(e->>'turnId')::uuid
 and encode(digest(convert_to(m.canonical_projection::text,'UTF8'),'sha256'),'hex')=e->>'projectionHash')
 from private.genome_file_deletions d cross join lateral jsonb_array_elements(d.canonical_chat_manifest) e
 left join public.chat_messages m on m.id=(e->>'id')::uuid where d.file_id=pg_temp.file_id()),
 'frozen prepared-file membership preserves message, turn and whole-projection hash');
select throws_ok($$select pg_temp.prepared_chat('check','{}',null,(select value from prepared_chat_projection))$$,
 '42501','not_found','deletion prepare rejects the previous projection');
update prepared_chat_projection set value=pg_temp.prepared_chat('prepare');
select is((select value->'unavailableSources' from prepared_chat_projection),'[]'::jsonb,'fresh contexts cannot acquire a dependency on the pending deletion');
create temporary table independent_prepared_chat as select (pg_temp.prepared_turn(repeat('c3',32))->>'chatId')::uuid id;
select is((select jsonb_array_length(canonical_chat_manifest) from private.genome_file_deletions where file_id=pg_temp.file_id()),4,
 'new DB-only conversation is outside the immutable prepared-file deletion manifest');
rollback to copilot_prepared_file_delete;
savepoint copilot_prepared_ancestry_withdrawal;
create temporary table withdrawn_prepared_ancestry as select grant_id id from public.purpose_grants
 where target_id=(select id from generation_subject) and purpose='ancestry' and revoked_at is null;
select public.revoke_directional_purpose_v1(account_id,(select id from withdrawn_prepared_ancestry)) from prepared_copilot_binding;
select is((select count(*) from public.purge_manifest_entries e join public.purge_manifests m on m.id=e.manifest_id
 join public.retention_due_phases d on d.retention_row_id=m.retention_row_id
 where d.immutable_envelope->>'grantId'=(select id::text from withdrawn_prepared_ancestry) and e.store_name='public.chat_messages'),4::bigint,
 'prepared ancestry withdrawal freezes both pairs under the exact completed grant');
select is((select count(*) from public.chat_messages where chat_id=(select id from prepared_chat_id)),0::bigint,
 'prepared ancestry withdrawal removes its dependent paired history');
select throws_ok($$select pg_temp.prepared_chat('history','{}',(select id from prepared_chat_id))$$,
 '42501','not_found','withdrawn prepared history cannot be revived');
select is((select count(*) from private.own_analysis_runs where file_id=pg_temp.file_id() and purpose='reports.polygenic'),1::bigint,
 'ancestry history cleanup preserves the independently completed prepared report');
select is((select count(*) from private.own_prepared_manifest_members where manifest_id=(select (value->>'manifestId')::uuid from pub_receipts where label='published')),2::bigint,
 'purpose-derived history cleanup does not delete the prepared source');
rollback to copilot_prepared_ancestry_withdrawal;
select is((select count(*) from private.own_normalization_runs where file_id=pg_temp.file_id()),0::bigint,'Copilot never invents a DB normalization for a prepared file');
select is((select count(*) from public.user_variants where file_id=pg_temp.file_id()),0::bigint,'Copilot integration leaves no prepared SQL variant fallback');
select is((select count(*) from public.report_observed_calls where file_id=pg_temp.file_id()),0::bigint,'Copilot integration leaves no prepared SQL observation fallback');
