-- Closed historical component bindings under the unchanged exact claimant
-- attempt/receipt/source checks. No provider, READY or retention change.
create or replace function public.future_person_export_members_v1(p_operation text,p_export_id uuid,p_attempt_id uuid,
 p_authority_receipt text,p_after_id text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.generated_exports;j private.export_archive_jobs;a private.export_archive_attempts;
 c jsonb;source uuid;embryo uuid;subject uuid;result jsonb;page jsonb;n integer;after_id uuid;last_id uuid;
begin
 if p_operation is null or p_operation not in ('context','agreements','quality','scores','figures','reports','variants')
  or (p_operation not in('scores','figures','reports','variants') and p_after_id is not null) then raise exception using errcode='22023',message='invalid_request';end if;
 if p_after_id is not null and p_operation<>'variants' then after_id:=p_after_id::uuid;end if;
 perform private.export_archive_current_v1(p_export_id,p_authority_receipt);
 select * into e from public.generated_exports where id=p_export_id;
 select * into j from private.export_archive_jobs where export_id=e.id;
 select * into a from private.export_archive_attempts where id=p_attempt_id and export_id=e.id;
 if e.id is null or e.origin_kind<>'independent-rights' or e.status<>'building' or j.route_id<>'api.future-person-export'
  or a.id is null or j.active_attempt is distinct from a.id or a.state<>'writing'
  or a.lease_expires_at<=clock_timestamp() or a.authority_receipt is distinct from p_authority_receipt then
   raise exception using errcode='42501',message='not_found';end if;
 c:=private.future_person_export_capture_v1(j.origin->>'sessionHash');
 subject:=(c#>>'{authority,subjectId}')::uuid;source:=(c#>>'{source,fileId}')::uuid;
 select embryo_id into embryo from private.embryo_canonical_sources where file_id=source;
 if p_operation='context' then result:=c;
 elsif p_operation='agreements' then select agreement_slice into result from private.future_person_custody_slices where subject_id=subject;
 elsif p_operation='variants' then
  if p_after_id is not null and (p_after_id!~'^[0-9]+$' or p_after_id::bigint<0) then raise exception using errcode='22023',message='invalid_request';end if;
  select jsonb_build_object('rows',coalesce(jsonb_agg(v.row order by v.id),'[]'),'count',count(*),'nextAfterId',max(v.id)::text) into result from (
   select id,jsonb_build_object('id',id::text,'chromosome',chromosome,'position',position,'referenceAllele',reference_allele,
    'alternateAllele',alternate_allele,'genotype',genotype) row from public.embryo_variants where source_file_id=source
    and (p_after_id is null or id>p_after_id::bigint) order by id limit 500)v;
 elsif p_operation='quality' then select coalesce(jsonb_agg(to_jsonb(q)-'embryo_id'),'[]') into result from public.embryo_qc q where q.embryo_id=embryo;
 else
  if p_operation='scores' then
   select coalesce(jsonb_agg(x.row order by x.id),'[]'),count(*),max(x.id::text)::uuid into page,n,last_id from (
    select score.id,to_jsonb(score)-'embryo_id' row from public.embryo_scores score where score.embryo_id=embryo
      and (after_id is null or score.id>after_id) order by score.id limit 500)x;
  elsif p_operation='figures' then
   select coalesce(jsonb_agg(x.row order by x.id),'[]'),count(*),max(x.id::text)::uuid into page,n,last_id from (
    select fig.id,to_jsonb(fig)||jsonb_build_object('findingRecord',to_jsonb(score)-'embryo_id') row from public.embryo_figures fig join public.embryo_scores score on score.id=fig.finding_id
     where score.embryo_id=embryo and (after_id is null or fig.id>after_id) order by fig.id limit 500)x;
  else
   select coalesce(jsonb_agg(x.row order by x.id),'[]'),count(*),max(x.id::text)::uuid into page,n,last_id from (
    select report.id,(to_jsonb(report)-'subject_id'-'cohort_id')||jsonb_build_object('embryoId',embryo) row from public.report_artifacts report where report.subject_id=subject
     and (after_id is null or report.id>after_id) order by report.id limit 500)x;
  end if;
  result:=jsonb_build_object('rows',page,'nextAfterId',last_id,'count',n);
 end if;
 if octet_length(result::text)>4000000 then raise exception using errcode='55000',message='export_source_unavailable';end if;
 perform private.export_archive_current_v1(p_export_id,p_authority_receipt);
 if not exists(select 1 from private.export_archive_attempts att where att.id=p_attempt_id and att.state='writing'
  and att.lease_expires_at>clock_timestamp()) then raise exception using errcode='42501',message='not_found';end if;
 return result;
end $$;
revoke all on function public.future_person_export_members_v1(text,uuid,uuid,text,text) from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.future_person_export_members_v1(text,uuid,uuid,text,text) to service_role;
