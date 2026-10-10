-- TEST-LOCAL bounded QC representation correction. No global/role/database
-- setting, stored number, producer receipt, body, source authority or ACL change.
-- The native seed-B worker stores 1184/1200 exactly. extra_float_digits=0
-- rounds that value during JSON formation, so pin shortest-precise output at
-- the exact readers/captures instead of accepting a changed measured ratio.
do $predecessor$
begin
 if exists(select 1 from (values
  ('private.future_person_export_snapshot_v1(text)','7ae505cb92d301a41a2a263be1702547',false),
  ('private.future_person_bound_export_snapshot_v1(jsonb,uuid)','6f202bda0cc049ed12306e4ef5916352',false),
  ('public.future_person_export_members_v1(text,uuid,uuid,text,text)','8510090f140b1680cca24da74fdc48c5',true),
  ('public.export_archive_account_members_v1(text,uuid,uuid,text,uuid,text)','36f818dc8b24f0f7ff9ceb431eb7ce46',true)
 )expected(signature,body_md5,service_execute) left join pg_catalog.pg_proc p on p.oid=to_regprocedure(expected.signature)
 where p.oid is null or md5(p.prosrc) is distinct from expected.body_md5
  or not p.prosecdef or pg_get_userbyid(p.proowner) is distinct from 'postgres'
  or p.proconfig is distinct from array['search_path=""']::text[]
  or has_function_privilege('service_role',p.oid,'execute') is distinct from expected.service_execute
  or exists(select 1 from (values('anon'),('authenticated'),('inherit_upload_only'))roles(role)
    where has_function_privilege(roles.role,p.oid,'execute'))) then
  raise exception using errcode='55000',message='QC serializer predecessor mismatch';
 end if;
end $predecessor$;

-- Captures also pin the representation: request/current/worker fingerprints
-- cannot vary with the caller's setting. Earlier precision-bound captures keep
-- their exact stale refusal; no historical receipt is relabeled or reissued.
alter function private.future_person_export_snapshot_v1(text) set extra_float_digits=3;
alter function private.future_person_bound_export_snapshot_v1(jsonb,uuid) set extra_float_digits=3;
alter function public.future_person_export_members_v1(text,uuid,uuid,text,text) set extra_float_digits=3;
alter function public.export_archive_account_members_v1(text,uuid,uuid,text,uuid,text) set extra_float_digits=3;

-- docs/route-register.json payloadBoundaryContract.embryoIngestSessionLimits
-- and src/lib/genome/ingest-limits.ts maximumSampleColumns are 64;
-- ingest-binding validates that bound before any accepted upload. Every caller resolved
-- its authorized cohort and result gate before supplying these exact identities.
-- This internal service reader preserves that boundary and refuses a partial or
-- cross-cohort selection. Invoker mode adds no table privilege or bypass.
create function public.read_embryo_qc_rows_v1(p_cohort_id uuid,p_embryo_ids uuid[])
returns jsonb language plpgsql stable security invoker
 set search_path='' set extra_float_digits=3 as $reader$
declare result jsonb;n integer;
begin
 if current_user is distinct from 'service_role' or auth.jwt()->>'role' is distinct from 'service_role' then
  raise exception using errcode='42501',message='not_found';
 end if;
 if p_cohort_id is null or p_embryo_ids is null or cardinality(p_embryo_ids) not between 1 and 64
  or array_ndims(p_embryo_ids) is distinct from 1 then
  raise exception using errcode='22023',message='invalid_request';
 end if;
 if array_position(p_embryo_ids,null) is not null
  or (select count(distinct id) from unnest(p_embryo_ids)id)<>cardinality(p_embryo_ids) then
  raise exception using errcode='22023',message='invalid_request';
 end if;
 if (select count(*) from public.embryos e where e.id=any(p_embryo_ids) and e.cohort_id=p_cohort_id)
   <>cardinality(p_embryo_ids) then raise exception using errcode='42501',message='not_found';end if;
 select jsonb_agg(jsonb_build_object(
  'embryo_id',q.embryo_id,'sites_expected',q.sites_expected,'sites_called',q.sites_called,'call_rate',q.call_rate,
  'autosomal_het_rate',q.autosomal_het_rate,'mean_depth',q.mean_depth,'parent_a_concordance',q.parent_a_concordance,
  'parent_b_concordance',q.parent_b_concordance,'allelic_dropout_estimate',q.allelic_dropout_estimate,
  'allelic_dropout_interval_low',q.allelic_dropout_interval_low,'allelic_dropout_interval_high',q.allelic_dropout_interval_high,
  'allelic_dropout_method',q.allelic_dropout_method,'amplification_method',q.amplification_method,
  'source_laboratory',q.source_laboratory,'source_assay',q.source_assay,'imputation_performed',q.imputation_performed,
  'imputation_panel',q.imputation_panel,'contamination_estimate',q.contamination_estimate,
  'qc_verdict',q.qc_verdict,'qc_reasons',q.qc_reasons,'computed_at',q.computed_at,'figure_basis',q.figure_basis
 )order by q.embryo_id),count(*) into result,n from public.embryo_qc q
 where q.embryo_id=any(p_embryo_ids);
 if n<>cardinality(p_embryo_ids) then raise exception using errcode='42501',message='not_found';end if;
 return result;
end $reader$;
revoke all on function public.read_embryo_qc_rows_v1(uuid,uuid[]) from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.read_embryo_qc_rows_v1(uuid,uuid[]) to service_role;
