-- Registered synchronous own-account report operations. These are not queue
-- jobs and never turn on ancestry, family, embryo or outside-model work.
create table private.own_analysis_runs (
 id uuid primary key default gen_random_uuid(),
 file_id uuid not null references public.genome_files(id) on delete cascade,
 subject_id uuid not null references public.subjects(id) on delete cascade,
 account_id uuid not null references auth.users(id) on delete cascade,
 purpose text not null check(purpose in ('reports.monogenic','reports.polygenic','ancestry')),
 grant_id uuid not null references public.purpose_grants(grant_id) on delete cascade,
 grant_revision bigint not null,
 authority jsonb not null,
 source_revision bigint not null,
 source_sha256 text not null check(source_sha256~'^[0-9a-f]{64}$'),
 normalization_completed_at timestamptz not null,
 computation_revision text not null check(computation_revision='own-reports-v1'),
 state text not null check(state in ('running','complete','failed')),
 claim uuid not null,
 expires_at timestamptz not null,
 completed_at timestamptz,
 result jsonb,
 unique(file_id,purpose),
 check((state='complete')=(completed_at is not null and result is not null))
);
alter table private.own_analysis_runs enable row level security;
revoke all on private.own_analysis_runs from public,anon,authenticated,inherit_upload_only;
insert into public.purge_target_stores(target_id,store_name,store_order)
 values('generated-artifacts','private.own_analysis_runs',5);

create or replace function private.own_analysis_completion_matches_v1(p_file_id uuid,p_purpose text,p_authorization jsonb)
returns boolean language sql security definer set search_path=pg_catalog,private as $function$
 select exists(select 1 from private.own_analysis_runs r where r.file_id=p_file_id and r.purpose=p_purpose
  and r.state='complete' and r.completed_at is not null and r.computation_revision='own-reports-v1'
  and r.authority-'context'=p_authorization-'context'
  -- Session refresh is not a new source or grant; live session is independently
  -- checked by the caller. Durable consent/binding context must remain exact.
  and (r.authority->'context')-array['authSessionRevision','originatingSessionRevision']
   =(p_authorization->'context')-array['authSessionRevision','originatingSessionRevision']);
$function$;
revoke all on function private.own_analysis_completion_matches_v1(uuid,text,jsonb) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.own_analysis_completion_matches_v1(uuid,text,jsonb) to service_role;

create function private.own_report_generation_v1(p_operation text,p_account_id uuid,p_session_id uuid,
 p_file_id uuid,p_purpose text,p_claim uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $function$
declare a jsonb; r private.own_analysis_runs%rowtype; result jsonb; v_subject uuid; v_now timestamptz:=clock_timestamp();
begin
 if p_purpose is null or p_purpose not in ('reports.monogenic','reports.polygenic')
  or p_operation is null or p_operation not in ('begin','check','read-variants','read-observed','complete','fail') then
  raise exception using errcode='22023',message='invalid_request'; end if;
 if p_operation='fail' then
  update private.own_analysis_runs set state='failed',result=null,completed_at=null
   where file_id=p_file_id and account_id=p_account_id and purpose=p_purpose and claim=p_claim and state='running';
  return 'true'::jsonb;
 end if;
 begin
  a:=private.current_own_report_grant_v1(p_account_id,p_session_id,p_file_id,p_purpose);
 exception when insufficient_privilege or object_not_in_prerequisite_state then
  if p_operation='begin' then return jsonb_build_object('status','not_selected'); end if;
  raise exception using errcode='42501',message='not_found';
 end;
 v_subject:=(a->>'subjectId')::uuid;
 select * into r from private.own_analysis_runs where file_id=p_file_id and purpose=p_purpose for update;
 if p_operation='begin' then
  if p_payload is not null or p_claim is not null then raise exception using errcode='22023',message='invalid_request'; end if;
  if private.own_analysis_completion_matches_v1(p_file_id,p_purpose,a) then
   return jsonb_build_object('status','complete','purpose',p_purpose); end if;
  if r.state='running' and r.expires_at>v_now and r.authority=a then
   raise exception using errcode='55000',message='analysis_in_progress'; end if;
  p_claim:=gen_random_uuid();
  insert into private.own_analysis_runs(file_id,subject_id,account_id,purpose,grant_id,grant_revision,authority,
   source_revision,source_sha256,normalization_completed_at,computation_revision,state,claim,expires_at)
  values(p_file_id,v_subject,p_account_id,p_purpose,(a->>'grantId')::uuid,(a->>'grantRevision')::bigint,a,
   (a->>'sourceRevision')::bigint,a->>'sourceSha256',(a->>'normalizedAt')::timestamptz,'own-reports-v1','running',p_claim,v_now+interval '5 minutes')
  on conflict(file_id,purpose) do update set grant_id=excluded.grant_id,grant_revision=excluded.grant_revision,
   authority=excluded.authority,source_revision=excluded.source_revision,source_sha256=excluded.source_sha256,
   normalization_completed_at=excluded.normalization_completed_at,computation_revision=excluded.computation_revision,
   state='running',claim=excluded.claim,expires_at=excluded.expires_at,completed_at=null,result=null
  where private.own_analysis_runs.state<>'running' or private.own_analysis_runs.expires_at<=v_now
   or private.own_analysis_runs.authority is distinct from excluded.authority
  returning * into r;
  if not found then raise exception using errcode='55000',message='analysis_in_progress'; end if;
  return jsonb_build_object('status','authorized','claim',r.claim,'purpose',r.purpose,'authorization',a);
 end if;
 if p_operation='check' and p_claim is null and private.own_analysis_completion_matches_v1(p_file_id,p_purpose,a) then
  return jsonb_build_object('status','complete','purpose',p_purpose); end if;
 if r.id is null or r.state<>'running' or r.account_id<>p_account_id or r.claim is distinct from p_claim
  or r.authority is distinct from a or r.expires_at<=v_now then
  raise exception using errcode='42501',message='not_found'; end if;
 if p_operation='check' then return jsonb_build_object('status','authorized','claim',r.claim,'purpose',r.purpose,'authorization',a); end if;
 if p_operation in ('read-variants','read-observed') then
  if jsonb_typeof(p_payload) is distinct from 'object' or not(p_payload ?& array['loci','offset'])
   or p_payload-array['loci','offset']<>'{}'::jsonb or jsonb_typeof(p_payload->'loci') is distinct from 'array'
   or jsonb_array_length(p_payload->'loci') not between 1 and 200
   or p_payload->>'offset'!~'^(0|[1-9][0-9]*)$' then raise exception using errcode='22023',message='invalid_request'; end if;
  if p_operation='read-variants' then
   select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into result from (
    select v.file_id,v.rsid,v.chrom,v.pos,v.ref,v.alt,v.genotype from public.user_variants v
    where v.file_id=p_file_id and v.user_id=p_account_id and v.subject_id=v_subject
     and exists(select 1 from jsonb_to_recordset(p_payload->'loci') as p(chrom integer,pos integer) where p.chrom=v.chrom and p.pos=v.pos)
    order by v.id offset (p_payload->>'offset')::integer limit 1000) x;
  else
   select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into result from (
    select v.file_id,v.rsid,v.chrom,v.pos,v.ref,v.alt,v.genotype,v.usable from public.report_observed_calls v
    where v.file_id=p_file_id and v.user_id=p_account_id and v.subject_id=v_subject
     and v.source_sha256=a->>'sourceSha256' and v.extraction_version='vcf-literal-diploid-snp-v1'
     and v.source_build=(select build from public.genome_files where id=p_file_id)
     and exists(select 1 from jsonb_to_recordset(p_payload->'loci') as p(chrom integer,pos integer) where p.chrom=v.chrom and p.pos=v.pos)
    order by v.source_line offset (p_payload->>'offset')::integer limit 1000) x;
  end if;
  return result;
 end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or not(p_payload ?& array['reports','prs'])
  or p_payload-array['reports','prs']<>'{}'::jsonb or jsonb_typeof(p_payload->'reports') is distinct from 'array'
  or jsonb_typeof(p_payload->'prs') is distinct from 'array' or octet_length(p_payload::text)>4000000
  or jsonb_array_length(p_payload->'reports') not between 1 and 1000 or jsonb_array_length(p_payload->'prs')>100
  or (p_purpose='reports.monogenic' and p_payload->'prs'<>'[]'::jsonb) then
  raise exception using errcode='22023',message='invalid_request'; end if;
 if exists(select 1 from jsonb_array_elements(p_payload->'reports') x where not exists(
  select 1 from public.report_templates t where t.slug=x->>'slug' and t.status='published'
   and t.layer::text=case when p_purpose='reports.monogenic' then 'variant_call' else 'estimate' end)) then
  raise exception using errcode='22023',message='invalid_request'; end if;
 if p_purpose='reports.polygenic' then
  delete from public.user_prs where file_id=p_file_id;
  insert into public.user_prs(user_id,subject_id,file_id,pgs_id,raw_score,zscore,percentile,coverage,matched)
  select p_account_id,v_subject,p_file_id,x.pgs_id,x.raw_score,null,null,x.coverage,x.matched
  from jsonb_to_recordset(p_payload->'prs') as x(pgs_id text,raw_score real,coverage real,matched integer);
 end if;
 -- No global annotated flag. Existing coverage-only numeric output boundaries
 -- remain unchanged; the stored summary contains no raw score or percentile.
 update private.own_analysis_runs set state='complete',completed_at=v_now,
  result=jsonb_build_object('reports',p_payload->'reports','prsCount',jsonb_array_length(p_payload->'prs')) where id=r.id;
 return jsonb_build_object('status','complete','purpose',p_purpose);
end;
$function$;
revoke all on function private.own_report_generation_v1(text,uuid,uuid,uuid,text,uuid,jsonb) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.own_report_generation_v1(text,uuid,uuid,uuid,text,uuid,jsonb) to service_role;
create function public.own_report_generation_v1(p_operation text,p_account_id uuid,p_session_id uuid,
 p_file_id uuid,p_purpose text,p_claim uuid default null,p_payload jsonb default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $function$
 select private.own_report_generation_v1(p_operation,p_account_id,p_session_id,p_file_id,p_purpose,p_claim,p_payload);
$function$;
revoke all on function public.own_report_generation_v1(text,uuid,uuid,uuid,text,uuid,jsonb) from public,anon,authenticated,inherit_upload_only;
grant execute on function public.own_report_generation_v1(text,uuid,uuid,uuid,text,uuid,jsonb) to service_role;

create function private.clear_revoked_own_report_outputs_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog,private as $function$
declare v_ended boolean;
begin
 if tg_table_name='purpose_grants' then v_ended:=new.revoked_at is not null;
 else v_ended:=new.status<>'current'; end if;
 if v_ended then
  delete from public.user_prs where file_id in(select file_id from private.own_analysis_runs
   where grant_id=new.grant_id and purpose='reports.polygenic');
  delete from private.own_analysis_runs where grant_id=new.grant_id;
 end if;
 return new;
end;
$function$;
revoke all on function private.clear_revoked_own_report_outputs_v1() from public,anon,authenticated,inherit_upload_only;
create trigger clear_revoked_own_report_outputs after update of revoked_at on public.purpose_grants
 for each row execute function private.clear_revoked_own_report_outputs_v1();
create trigger clear_ended_own_report_outputs after update of status on public.directional_grants
 for each row execute function private.clear_revoked_own_report_outputs_v1();
