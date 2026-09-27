-- Preserve the signed v1 bodies. Supersede only the two exact own-Copilot
-- artifacts; the shared cloud disclosure and every other scope are unchanged.
-- The table lock and one DO statement make the guarded metadata transition
-- atomic, including on fresh CLI replay, as for the existing own-report v2.
do $migration$
declare affected integer;
begin
 lock table public.consent_artifacts in access exclusive mode;
 alter table public.consent_artifacts disable trigger consent_artifacts_immutable;
 update public.consent_artifacts set superseded_at=clock_timestamp()
 where version=1 and superseded_at is null and ((artifact_key='consent.own-copilot-local' and body_sha256='20441dc48dc829d7582b3a1d91cd2bcfedb353a5e883925d7010d22c75be9a52') or
  (artifact_key='consent.own-copilot-cloud' and body_sha256='09e880afd799a8387d67d8776788db23925cb4dd00e274536a9ce5dc3ca23ceb'));
 get diagnostics affected=row_count;
 if affected<>2 then raise exception 'expected exactly two unchanged own-Copilot v1 artifacts'; end if;
 alter table public.consent_artifacts enable trigger consent_artifacts_immutable;
 insert into public.consent_artifacts(artifact_key,version,body_sha256,body_markdown,summary_markdown,effective_on,summary_of_changes)
 values('consent.own-copilot-local',2,'374e82c6e31ba00fe1e6e446cd9369373aed0c7e39bf3a997dfa46d598d82de5',$artifact$I allow the named model to answer my questions using my prepared DNA observations and the report types I have separately enabled.

The information used includes:

- Individual genotypes I ask about, with their rsIDs.
- Variant search results, with genes, positions and genotypes.
- Report titles, interpretations and coverage states, including saved ancestry estimates and lineage results.
- Score-panel coverage and why a validated score is unavailable.
- My chat messages.

Ancestry and other report types still need their own separate permission. My original DNA file is not sent. Saving a model does not grant this permission. I can withdraw it at any time.

This permission is for the named model and address shown to me, running beside my own Inherit server.$artifact$,'Only the named model may use the listed information. Saved ancestry results need separate ancestry permission.',date '2026-09-22',
 'Names saved ancestry estimates and lineage results in the report information disclosed to the chosen model. Requires fresh explicit permission.');
 insert into public.consent_artifacts(artifact_key,version,body_sha256,body_markdown,summary_markdown,effective_on,summary_of_changes)
 values('consent.own-copilot-cloud',2,'ec7f768f45e339e1554c59d4ac9760bc21cc4089a9d43bbbfa43659636e6cd5c',$artifact$I allow the named model to answer my questions using my prepared DNA observations and the report types I have separately enabled.

The information used includes:

- Individual genotypes I ask about, with their rsIDs.
- Variant search results, with genes, positions and genotypes.
- Report titles, interpretations and coverage states, including saved ancestry estimates and lineage results.
- Score-panel coverage and why a validated score is unavailable.
- My chat messages.

Ancestry and other report types still need their own separate permission. My original DNA file is not sent. Saving a model does not grant this permission. I can withdraw it at any time.

This permission is for the provider, model and address shown to me. This information goes to that external provider when I ask a question. I also give the separate cloud disclosure permission for the same named information and recipient.$artifact$,'Only the named model may use the listed information. Saved ancestry results need separate ancestry permission.',date '2026-09-22',
 'Names saved ancestry estimates and lineage results in the report information disclosed to the chosen model. Requires fresh explicit permission.');
end;
$migration$;

-- Captured ancestry shares the existing exact-purpose chat projection and purge.
-- Database-normalized source admission and the five model tools remain unchanged.
create or replace function private.own_copilot_projection_v1(a jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare f public.genome_files%rowtype; sources jsonb:='[]'; legacy_sources jsonb:='[]'; completed jsonb; g jsonb; v_purpose text;
begin
 for f in select * from public.genome_files cf where subject_id=(a->>'subjectId')::uuid
  and user_id=(a->>'accountId')::uuid and single_logical_sample_verified_at is not null
  and not exists(select 1 from private.genome_file_deletions d where d.file_id=cf.id)
  order by id for share loop
  if f.tier is distinct from 1 or f.status is null or f.status not in ('stored','annotated')
   or f.structural_validator_version is distinct from 'single-logical-sample-v1'
   or f.normalization_completed_at is null or f.normalization_source_revision is distinct from f.upload_revision
   or f.build is null or f.build not in ('GRCh37','GRCh38') then continue; end if;
  perform 1 from private.own_normalization_runs n join public.genome_storage_objects o on o.genome_file_id=f.id
   join storage.objects s on s.id=o.object_id where n.file_id=f.id and n.account_id=f.user_id and n.state='complete'
   and n.manifest->>'rawSha256'=f.sha256 and n.manifest->>'decodedSha256'=f.source_sha256
   and n.manifest->'sourceRevision'=to_jsonb(f.upload_revision)
   and n.manifest->>'objectId'=f.storage_object_id::text and n.manifest->>'objectKey'=f.bucket_path
   and o.object_id=f.storage_object_id and o.object_name=f.bucket_path and o.bucket_id='genomes'
   and o.sha256=f.sha256 and o.byte_count=f.size_bytes and o.object_revision=f.upload_revision
   and o.state='current' and o.revoked_at is null and s.bucket_id=o.bucket_id and s.name=o.object_name
   and (s.metadata->>'size')::numeric=f.size_bytes;
  if not found then continue; end if;
  completed:='[]';
  foreach v_purpose in array array['reports.monogenic','reports.polygenic','ancestry'] loop
   begin
    g:=private.current_own_report_grant_read_v1((a->>'accountId')::uuid,(a->>'sessionId')::uuid,f.id,v_purpose);
    if private.own_analysis_completion_matches_v1(f.id,v_purpose,g) is true then
     select completed||jsonb_build_array(jsonb_build_object('purpose',v_purpose,
      'authority',g #- '{context,authSessionRevision}' #- '{context,originatingSessionRevision}',
      'runId',r.id,'completedAt',r.completed_at,'resultHash',encode(extensions.digest(convert_to(r.result::text,'UTF8'),'sha256'),'hex')))
      into completed from private.own_analysis_runs r where r.file_id=f.id and r.purpose=v_purpose and r.state='complete';
    end if;
   exception when insufficient_privilege or object_not_in_prerequisite_state then null;
   end;
  end loop;
  sources:=sources||jsonb_build_array(jsonb_build_object('id',f.id,'revision',f.upload_revision,'sha256',f.sha256,
   'decodedSha256',f.source_sha256,'objectId',f.storage_object_id,'normalizedAt',f.normalization_completed_at,
   'build',f.build,'completed',completed));
 end loop;
 -- Compatibility uses the existing processed-file authority, explicitly
 -- without certifying a historical normalization manifest. Canonical source
 -- identity or a finalized restricted lease can never fall into this branch.
 for f in select * from public.genome_files lf where subject_id=(a->>'subjectId')::uuid
  and user_id=(a->>'accountId')::uuid and status='annotated'
  and single_logical_sample_verified_at is null and structural_validator_version is null
  and storage_object_id is null and source_sha256 is null and normalization_completed_at is null
  and sha256 ~ '^[0-9a-f]{64}$' and build in('GRCh37','GRCh38')
  and not exists(select 1 from private.genome_file_deletions d where d.file_id=lf.id)
  and not exists(select 1 from public.upload_sessions u where u.finalized_file_id=lf.id)
  and not exists(select 1 from private.own_normalization_runs n where n.file_id=lf.id)
  and not exists(select 1 from public.genome_storage_objects o where o.genome_file_id=lf.id)
  order by id for share loop
  legacy_sources:=legacy_sources||jsonb_build_array(jsonb_build_object('id',f.id,'sha256',f.sha256,'build',f.build,'createdAt',f.created_at));
 end loop;
 return jsonb_build_object('sources',sources,'legacySources',legacy_sources,'unavailableSources',coalesce((
  select jsonb_agg(jsonb_build_object('id',uf.id,'reason','source_unavailable') order by uf.id)
  from public.genome_files uf where uf.subject_id=(a->>'subjectId')::uuid
   -- Membership is already frozen at deletion prepare. A fresh context must
   -- not acquire a dependency on that target while Storage ACK is pending.
   and not exists(select 1 from private.genome_file_deletions d where d.file_id=uf.id)
   and not exists(select 1 from jsonb_array_elements(sources||legacy_sources) s where s->>'id'=uf.id::text)
 ),'[]'::jsonb));
end; $$;
revoke all on function private.own_copilot_projection_v1(jsonb) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.own_copilot_projection_v1(jsonb) to service_role;

create or replace function private.valid_own_copilot_citations_v1(value jsonb) returns boolean
language plpgsql immutable security invoker set search_path=pg_catalog as $$
begin
 if jsonb_typeof(value) is distinct from 'array' then return false; end if;
 if jsonb_array_length(value)>100 then return false; end if;
 return not exists(select 1 from jsonb_array_elements(value) c where jsonb_typeof(c) is distinct from 'object'
  or c-array['id','label','href']<>'{}'::jsonb or not(c ?& array['id','label','href'])
  or jsonb_typeof(c->'id') is distinct from 'string' or length(coalesce(c->>'id','')) not between 1 and 2000
  or jsonb_typeof(c->'label') is distinct from 'string' or length(coalesce(c->>'label','')) not between 1 and 100000
  or jsonb_typeof(c->'href') is distinct from 'string' or length(coalesce(c->>'href','')) not between 1 and 4000
  or coalesce(c->>'href','') !~ '^(/genome/me/ancestry|/genome/me/reports/[^/?#]+|https://pubmed\.ncbi\.nlm\.nih\.gov/[0-9]{6,9}/|https://doi\.org/[^[:space:]]+)$');
end; $$;
revoke all on function private.valid_own_copilot_citations_v1(jsonb) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.valid_own_copilot_citations_v1(jsonb) to service_role;

-- This is a data selector for the existing get_report tool, not a new model
-- tool or an ancestry permission. A bare ancestry grant cannot enter it.
create function private.own_copilot_ancestry_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,
 p_authority jsonb,p_projection jsonb,p_file_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare source jsonb; completion jsonb; captured jsonb; r private.own_analysis_runs%rowtype; result_hash text;
begin
 perform private.own_copilot_chat_v1('check',p_account_id,p_session_id,p_subject_id,p_authority,p_projection,null,'{}');
 -- The reserved identity cannot shadow even a currently published template
 -- with no captured completion. Ordinary template slugs cannot contain ':'.
 if exists(select 1 from public.report_templates where slug='inherit:ancestry' and status='published') then
  raise exception using errcode='42501',message='not_found'; end if;
 select s into source from jsonb_array_elements(p_projection->'sources') s where s->>'id'=p_file_id::text;
 select c into completion from jsonb_array_elements(source->'completed') c where c->>'purpose'='ancestry';
 if source is null or completion is null then raise exception using errcode='42501',message='not_found'; end if;
 captured:=private.own_ancestry_content_v1(p_account_id,p_session_id,p_file_id);
 select * into r from private.own_analysis_runs where id=(completion->>'runId')::uuid
  and file_id=p_file_id and account_id=p_account_id and subject_id=p_subject_id and purpose='ancestry' and state='complete';
 result_hash:=encode(extensions.digest(convert_to(r.result::text,'UTF8'),'sha256'),'hex');
 if r.id is null or result_hash is distinct from completion->>'resultHash'
  or r.result->'ancestry' is distinct from captured->'content'
  or r.completed_at is distinct from (completion->>'completedAt')::timestamptz
  or r.completed_at is distinct from (captured->>'completedAt')::timestamptz
  or captured->'content'->'source'->>'fileId' is distinct from source->>'id'
  or captured->'content'->'source'->>'subjectId' is distinct from p_subject_id::text
  or captured->'content'->'source'->'sourceRevision' is distinct from source->'revision'
  or captured->'content'->'source'->>'sourceSha256' is distinct from source->>'sha256'
  or (captured->'content'->'source'->>'normalizedAt')::timestamptz is distinct from (source->>'normalizedAt')::timestamptz then
  raise exception using errcode='42501',message='not_found'; end if;
 perform private.own_copilot_chat_v1('check',p_account_id,p_session_id,p_subject_id,p_authority,p_projection,null,'{}');
 return jsonb_build_object('fileId',p_file_id,'runId',r.id,'resultHash',result_hash,
  'completedAt',r.completed_at,'content',captured->'content');
end; $$;
revoke all on function private.own_copilot_ancestry_v1(uuid,uuid,uuid,jsonb,jsonb,uuid) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.own_copilot_ancestry_v1(uuid,uuid,uuid,jsonb,jsonb,uuid) to service_role;
create function public.own_copilot_ancestry_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,
 p_authority jsonb,p_projection jsonb,p_file_id uuid)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
 select private.own_copilot_ancestry_v1(p_account_id,p_session_id,p_subject_id,p_authority,p_projection,p_file_id);
$$;
revoke all on function public.own_copilot_ancestry_v1(uuid,uuid,uuid,jsonb,jsonb,uuid) from public,anon,authenticated,inherit_upload_only;
grant execute on function public.own_copilot_ancestry_v1(uuid,uuid,uuid,jsonb,jsonb,uuid) to service_role;
