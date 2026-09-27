-- Guarded production apply of supabase/migrations/20260925130000_export_archive_content_reader.sql
-- (merged in #211; file SHA-256 52f06e25988c077e77ffb73d1c5c2d268bab25936d9258dfd185dc36f7e66ed5).
-- One DO statement, so it is atomic under any client protocol: predecessor checks,
-- the migration executed verbatim, postchecks against the definitions measured on
-- the tested local stack, and the ledger row under the repository's version and name.
do $inherit_reader_do$
declare
  migration constant text := $inherit_reader_migration$-- The first bounded slice of docs/export-member-selection-design.md: one
-- service-only, read-only content reader for an archive attempt. Every call
-- resolves origin, route, contract and target from the stored job, recomputes
-- the full authority graph against the pinned receipt, and requires the exact
-- active writing attempt with an unexpired lease; it rechecks all of that
-- before returning. It writes nothing: no nonce, lease renewal or row change.
-- It is not the complete member selector, and the publication hold stays.

create function public.export_archive_content_v1(p_operation text,p_export_id uuid,p_attempt_id uuid,
 p_authority_receipt text,p_payload jsonb default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare e public.generated_exports%rowtype; j private.export_archive_jobs%rowtype;
 att private.export_archive_attempts%rowtype; f public.genome_files%rowtype;
 authority jsonb; account_at uuid; session_at uuid; partitions uuid[]; file_at uuid; after_at uuid;
 offset_at integer; snapshot jsonb; page jsonb:='[]'; result jsonb; member uuid; last_at uuid;
 member_count integer:=0; purpose text; grant_authority jsonb; authorities jsonb:='{}';
begin
 if p_operation is null or p_operation not in ('context','files','check','variants','observed','reports','prs','ancestry')
  or p_export_id is null or p_attempt_id is null or p_authority_receipt is null
  or p_authority_receipt!~'^[0-9a-f]{64}$' then
  raise exception using errcode='22023',message='invalid_request'; end if;
 -- Closed payload shapes, validated before any authority or source read.
 if p_operation='context' then
  if p_payload is not null then raise exception using errcode='22023',message='invalid_request'; end if;
 elsif p_payload is null or jsonb_typeof(p_payload)<>'object' then
  raise exception using errcode='22023',message='invalid_request';
 elsif p_operation='files' then
  if (select count(*) from jsonb_object_keys(p_payload))<>1 or not(p_payload ? 'afterFileId')
   or jsonb_typeof(p_payload->'afterFileId') not in ('null','string') then
   raise exception using errcode='22023',message='invalid_request'; end if;
 elsif (select count(*) from jsonb_object_keys(p_payload))<>(case when p_operation='check' then 2 else 3 end)
  or not(p_payload ?& array['fileId','snapshot']) or jsonb_typeof(p_payload->'fileId') is distinct from 'string'
  or jsonb_typeof(p_payload->'snapshot') is distinct from 'object'
  or (p_operation<>'check' and (not(p_payload ? 'offset') or jsonb_typeof(p_payload->'offset') is distinct from 'number'
   or (p_payload->>'offset')!~'^[0-9]{1,9}$')) then
  raise exception using errcode='22023',message='invalid_request';
 end if;
 begin
  if p_operation='files' and jsonb_typeof(p_payload->'afterFileId')='string' then after_at:=(p_payload->>'afterFileId')::uuid; end if;
  if p_operation not in ('context','files') then file_at:=(p_payload->>'fileId')::uuid; end if;
 exception when invalid_text_representation then raise exception using errcode='22023',message='invalid_request';
 end;
 if p_operation not in ('context','files','check') then offset_at:=(p_payload->>'offset')::integer; end if;

 -- Source locks before job/attempt locks, as in every authority-capable RPC.
 authority:=private.export_archive_current_v1(p_export_id,p_authority_receipt);
 select * into e from public.generated_exports where id=p_export_id for share;
 select * into j from private.export_archive_jobs where export_id=p_export_id for share;
 select * into att from private.export_archive_attempts where id=p_attempt_id and export_id=p_export_id for share;
 if att.id is null or j.active_attempt is distinct from att.id or att.state<>'writing'
  or att.lease_expires_at<=clock_timestamp() or att.authority_receipt is distinct from p_authority_receipt
  or e.status is distinct from 'building' or j.origin->>'kind' is distinct from 'account' then
  raise exception using errcode='42501',message='not_found'; end if;
 account_at:=(j.origin->>'accountId')::uuid; session_at:=(j.origin->>'sessionId')::uuid;
 select coalesce(array_agg(x::uuid order by x),'{}') into partitions from jsonb_array_elements_text(e.subject_partitions) x;
 if file_at is not null and not exists(select 1 from public.genome_files where id=file_at and subject_id=any(partitions)) then
  raise exception using errcode='42501',message='not_found'; end if;

 if p_operation='context' then
  -- Worker-internal only: never an archive member or a client response.
  result:=jsonb_build_object('exportId',e.id,'attemptId',att.id,'routeId',j.route_id,'exportContract',j.export_contract,
   'targetKind',e.target_kind,'targetId',e.target_id,'subjectPartitions',e.subject_partitions,
   'origin',jsonb_build_object('kind','account','accountId',account_at,'sessionId',session_at),
   'authorityReceipt',j.authority_receipt,'fileCount',(authority->>'fileCount')::integer,
   'leaseExpiresAt',att.lease_expires_at,'deadline',j.deadline);
 elsif p_operation='files' then
  -- Every in-scope file, including ones the older list filtered out: a file
  -- without an exact current source refuses the whole page, never disappears.
  for member in select gf.id from public.genome_files gf where gf.subject_id=any(partitions)
   and (after_at is null or gf.id>after_at) order by gf.id limit 100 loop
   snapshot:=private.own_export_source_v1(account_at,session_at,member);
   if snapshot is null then raise exception using errcode='55000',message='export_source_unavailable'; end if;
   page:=page||jsonb_build_array(snapshot); last_at:=member; member_count:=member_count+1;
  end loop;
  result:=jsonb_build_object('files',page,'nextAfterFileId',case when member_count=100 and exists(
   select 1 from public.genome_files gf where gf.subject_id=any(partitions) and gf.id>last_at) then to_jsonb(last_at) else 'null'::jsonb end);
 elsif p_operation in ('check','variants','observed','ancestry') then
  -- The existing per-file projection keeps its own snapshot, source and grant
  -- checks; ancestry already requires a current grant on both backends.
  result:=private.own_subject_export_content_v1(p_operation,account_at,session_at,file_at,p_payload->'snapshot',coalesce(offset_at,0));
 else
  snapshot:=private.own_export_source_v1(account_at,session_at,file_at);
  if snapshot is null or snapshot is distinct from p_payload->'snapshot' then
   raise exception using errcode='42501',message='not_found'; end if;
  if snapshot ? 'preparedSource' then
   -- The prepared backend already applies the current-purpose gate.
   result:=private.own_subject_export_content_v1(p_operation,account_at,session_at,file_at,snapshot,offset_at);
  elsif not (snapshot->>'normalized')::boolean then result:='[]';
  else
   -- The database backend gets the same gate the older helper applies only to
   -- prepared sources: a completed run is exported only under its purpose's
   -- current grant. Saved results are returned verbatim, never regenerated.
   select * into f from public.genome_files where id=file_at;
   foreach purpose in array array['reports.monogenic','reports.polygenic'] loop
    if p_operation='prs' and purpose<>'reports.polygenic' then continue; end if;
    grant_authority:=null;
    begin
     grant_authority:=private.current_own_report_grant_read_v1(account_at,session_at,f.id,purpose);
     if private.own_analysis_completion_matches_v1(f.id,purpose,grant_authority) is not true then grant_authority:=null; end if;
    exception when insufficient_privilege or object_not_in_prerequisite_state then grant_authority:=null;
    end;
    if grant_authority is not null then authorities:=authorities||jsonb_build_object(purpose,grant_authority); end if;
   end loop;
   with completed as (select r.* from private.own_analysis_runs r where r.file_id=f.id and r.subject_id=f.subject_id
    and r.state='complete' and r.completed_at is not null and r.computation_revision='own-reports-v1'
    and r.source_revision=f.upload_revision and r.source_sha256=f.sha256
    and r.normalization_completed_at=f.normalization_completed_at
    and r.authority->'context'->'subjectBindingRevision'=snapshot->'binding'->'subjectBindingRevision'
    and authorities ? r.purpose and private.own_analysis_completion_matches_v1(f.id,r.purpose,authorities->r.purpose) is true)
   select case when p_operation='reports' then
    (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select r.purpose,r.completed_at,report.value as report
     from completed r cross join lateral jsonb_array_elements(r.result->'reports') with ordinality report(value,ordinality)
     where r.purpose in ('reports.monogenic','reports.polygenic') order by r.purpose,report.ordinality offset offset_at limit 1000) x)
    else (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select v.pgs_id,v.matched,v.computed_at,
     m.name,m.trait,m.ancestry_note,m.n_variants from public.user_prs v left join public.prs_scores m using(pgs_id)
     where v.file_id=f.id and v.subject_id=f.subject_id and v.user_id=f.user_id
      and exists(select 1 from completed r where r.purpose='reports.polygenic')
     order by v.id offset offset_at limit 1000) x) end into result;
   for purpose,grant_authority in select key,value from jsonb_each(authorities) loop
    if private.current_own_report_grant_read_v1(account_at,session_at,f.id,purpose) is distinct from grant_authority
     or private.own_analysis_completion_matches_v1(f.id,purpose,grant_authority) is not true then
     raise exception using errcode='42501',message='not_found'; end if;
   end loop;
   if private.own_export_source_v1(account_at,session_at,file_at) is distinct from snapshot then
    raise exception using errcode='42501',message='not_found'; end if;
  end if;
 end if;

 -- The same job, attempt, lease and full graph must still hold after the read.
 perform private.export_archive_current_v1(p_export_id,p_authority_receipt);
 if not exists(select 1 from private.export_archive_attempts a join private.export_archive_jobs job on job.active_attempt=a.id
   where a.id=att.id and a.export_id=p_export_id and a.state='writing' and a.lease_expires_at>clock_timestamp()
    and a.authority_receipt=p_authority_receipt) then
  raise exception using errcode='42501',message='not_found'; end if;
 return result;
end $$;
revoke all on function public.export_archive_content_v1(text,uuid,uuid,text,jsonb) from public,anon,authenticated,inherit_upload_only;
grant execute on function public.export_archive_content_v1(text,uuid,uuid,text,jsonb) to service_role;
$inherit_reader_migration$;
begin
  if md5(migration) <> 'e4e9a6e530ba8e883101e5474ab82f9d' then
    raise exception using message = 'integrity: the embedded migration text is not the reviewed file'; end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20260925130000') then
    raise exception using message = 'predecessor: 20260925130000 is already in the ledger'; end if;
  if not exists (select 1 from supabase_migrations.schema_migrations
      where version = '20260923123240' and name = 'export_archive_persistence') then
    raise exception using message = 'predecessor: the export persistence row is missing'; end if;
  if to_regprocedure('public.export_archive_content_v1(text,uuid,uuid,text,jsonb)') is not null then
    raise exception using message = 'predecessor: the content reader already exists'; end if;
  if md5(pg_get_functiondef('private.export_archive_current_v1(uuid,text)'::regprocedure)) <> '707ebdae8b497640dafeb37e666d01f6' then
    raise exception using message = 'predecessor: private.export_archive_current_v1(uuid,text) differs from the tested definition'; end if;
  if md5(pg_get_functiondef('private.own_export_source_v1(uuid,uuid,uuid)'::regprocedure)) <> '27abc582be0eb4a227a7cdeb57c29d6f' then
    raise exception using message = 'predecessor: private.own_export_source_v1(uuid,uuid,uuid) differs from the tested definition'; end if;
  if md5(pg_get_functiondef('private.own_subject_export_content_v1(text,uuid,uuid,uuid,jsonb,integer)'::regprocedure)) <> '17ea9257f1ef000372456000cf4771d2' then
    raise exception using message = 'predecessor: private.own_subject_export_content_v1(text,uuid,uuid,uuid,jsonb,integer) differs from the tested definition'; end if;
  if md5(pg_get_functiondef('private.current_own_report_grant_read_v1(uuid,uuid,uuid,text)'::regprocedure)) <> '9169efeb22713a26c85f638d8880ddf9' then
    raise exception using message = 'predecessor: private.current_own_report_grant_read_v1(uuid,uuid,uuid,text) differs from the tested definition'; end if;
  if md5(pg_get_functiondef('private.own_analysis_completion_matches_v1(uuid,text,jsonb)'::regprocedure)) <> '21fc418c1566f7e70241780a6c5e8d49' then
    raise exception using message = 'predecessor: private.own_analysis_completion_matches_v1(uuid,text,jsonb) differs from the tested definition'; end if;

  execute migration;

  if md5(pg_get_functiondef('public.export_archive_content_v1(text,uuid,uuid,text,jsonb)'::regprocedure)) <> '608ff467d38e2816af7375b4ffba7d07' then
    raise exception using message = 'postcheck: public.export_archive_content_v1(text,uuid,uuid,text,jsonb) differs from the tested definition'; end if;
  if not exists (select 1 from pg_proc where oid = 'public.export_archive_content_v1(text,uuid,uuid,text,jsonb)'::regprocedure
      and prosecdef and proconfig = array['search_path=pg_catalog, private']) then
    raise exception using message = 'postcheck: the content reader is not security definer with the tested search path'; end if;
  if has_function_privilege('anon', 'public.export_archive_content_v1(text,uuid,uuid,text,jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.export_archive_content_v1(text,uuid,uuid,text,jsonb)', 'execute')
     or has_function_privilege('inherit_upload_only', 'public.export_archive_content_v1(text,uuid,uuid,text,jsonb)', 'execute') then
    raise exception using message = 'postcheck: a browser role can execute the content reader'; end if;
  if not has_function_privilege('service_role', 'public.export_archive_content_v1(text,uuid,uuid,text,jsonb)', 'execute') then
    raise exception using message = 'postcheck: service_role cannot execute the content reader'; end if;
  if md5(pg_get_functiondef('private.export_archive_current_v1(uuid,text)'::regprocedure)) <> '707ebdae8b497640dafeb37e666d01f6' then
    raise exception using message = 'postcheck: private.export_archive_current_v1(uuid,text) differs from the tested definition'; end if;
  if md5(pg_get_functiondef('private.own_export_source_v1(uuid,uuid,uuid)'::regprocedure)) <> '27abc582be0eb4a227a7cdeb57c29d6f' then
    raise exception using message = 'postcheck: private.own_export_source_v1(uuid,uuid,uuid) differs from the tested definition'; end if;
  if md5(pg_get_functiondef('private.own_subject_export_content_v1(text,uuid,uuid,uuid,jsonb,integer)'::regprocedure)) <> '17ea9257f1ef000372456000cf4771d2' then
    raise exception using message = 'postcheck: private.own_subject_export_content_v1(text,uuid,uuid,uuid,jsonb,integer) differs from the tested definition'; end if;
  if md5(pg_get_functiondef('private.current_own_report_grant_read_v1(uuid,uuid,uuid,text)'::regprocedure)) <> '9169efeb22713a26c85f638d8880ddf9' then
    raise exception using message = 'postcheck: private.current_own_report_grant_read_v1(uuid,uuid,uuid,text) differs from the tested definition'; end if;
  if md5(pg_get_functiondef('private.own_analysis_completion_matches_v1(uuid,text,jsonb)'::regprocedure)) <> '21fc418c1566f7e70241780a6c5e8d49' then
    raise exception using message = 'postcheck: private.own_analysis_completion_matches_v1(uuid,text,jsonb) differs from the tested definition'; end if;

  insert into supabase_migrations.schema_migrations (version, name, statements)
  values ('20260925130000', 'export_archive_content_reader', array[migration]);
  raise exception using message = 'DRY_RUN_COMPLETE_ALL_CHECKS_PASSED';
end
$inherit_reader_do$;
