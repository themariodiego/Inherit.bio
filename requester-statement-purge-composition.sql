-- SOURCE ONLY. Exact literal PK census; no arbitrary predicate/SQL from callers.
create function private.requester_statement_archive_row_count_v1(p_store text,p_key jsonb)
returns bigint language plpgsql security definer set search_path='' as $body$
declare keys text[];n bigint;predicate text;
begin
 case p_store
 when 'private.new_correction_archive_cases' then keys:=array['export_id','correction_id'];
 when 'private.new_correction_archive_runs' then keys:=array['id'];
 when 'private.new_correction_archive_r2_allocations' then keys:=array['id'];
 when 'private.new_correction_archive_provider_dispositions' then keys:=array['attempt_id','ordinal'];
 when 'private.export_archive_jobs' then keys:=array['export_id'];
 when 'private.export_archive_attempts' then keys:=array['id'];
 when 'private.export_archive_downloads' then keys:=array['id'];
 when 'private.export_archive_manifest_pages' then keys:=array['attempt_id','page'];
 when 'private.export_archive_segments' then keys:=array['attempt_id','ordinal'];
 when 'private.export_archive_nonce_uses' then keys:=array['nonce_hash'];
 when 'public.generated_exports' then keys:=array['id'];
 when 'public.download_sessions' then keys:=array['id'];
 when 'public.download_ranges' then keys:=array['session_id','range_sequence'];
 when 'storage.objects' then keys:=array['id','bucket_id','name'];
 else raise exception using errcode='42501',message='correction_archive_disposal_unavailable';end case;
 if p_key is null or jsonb_typeof(p_key)<>'object' or exists(select 1 from jsonb_each(p_key) where value='null'::jsonb)
  or(select array_agg(k order by k) from jsonb_object_keys(p_key)k) is distinct from(select array_agg(k order by k) from unnest(keys)k) then
  raise exception using errcode='42501',message='correction_archive_disposal_unavailable';end if;
 select string_agg(format('t.%I=k.%I',key,key),' and ') into predicate from unnest(keys)key;
 execute format('select count(*) from %s t,jsonb_populate_record(null::%s,$1)k where %s',p_store,p_store,predicate) into n using p_key;
 if n>1 then raise exception using errcode='55000',message='correction_archive_disposal_unavailable';end if;
 return n;
end $body$;
revoke all on function private.requester_statement_archive_row_count_v1(text,jsonb)
 from public,anon,authenticated,service_role,inherit_upload_only;

-- Current native claimant/account graph receives all NEW dependent stores;
-- actual pre-existing account Path-B unsupported authority stays unchanged.
alter function private.new_correction_subject_graph_v1(uuid[],uuid[])
 rename to new_correction_subject_graph_before_requester_statement_v1;
revoke all on function private.new_correction_subject_graph_before_requester_statement_v1(uuid[],uuid[])
 from public,anon,authenticated,service_role,inherit_upload_only;
create function private.new_correction_subject_graph_v1(p_subjects uuid[],p_principals uuid[])
returns table(target_id text,store_name text,row_key jsonb)
language sql stable security definer set search_path='' as $body$
 select * from private.new_correction_subject_graph_before_requester_statement_v1(p_subjects,p_principals)
 union select graph.* from public.correction_requests c cross join lateral private.new_correction_archive_graph_v1(c.id)graph
 where c.review_case_format='reviewer-only-case-statement-v1'
  and(c.subject_id=any(p_subjects) or c.claimant_principal_id=any(p_principals))
$body$;
revoke all on function private.new_correction_subject_graph_v1(uuid[],uuid[])
 from public,anon,authenticated,service_role,inherit_upload_only;

-- V3 closes each own case before claimant erasure freezes its graph. Closing
-- now also revokes all its exact archives. Native dispose remains a required
-- precondition: no new stores escape the actual sealed subject graph.
alter function private.future_person_deletion_row_v1(text,jsonb,boolean)
 rename to future_person_deletion_row_before_requester_statement_v1;
revoke all on function private.future_person_deletion_row_before_requester_statement_v1(text,jsonb,boolean)
 from public,anon,authenticated,service_role,inherit_upload_only;
create function private.future_person_deletion_row_v1(p_store text,p_key jsonb,p_delete boolean default false)
returns bigint language plpgsql security definer set search_path='' as $body$
declare n bigint; permitted boolean;
begin
 if p_store not in('private.new_correction_archive_cases','private.new_correction_archive_runs',
  'private.new_correction_archive_r2_allocations','private.new_correction_archive_provider_dispositions') then
  return private.future_person_deletion_row_before_requester_statement_v1(p_store,p_key,p_delete);end if;
 n:=private.requester_statement_archive_row_count_v1(p_store,p_key);
 if p_delete and n<>0 then
  -- Actual V3 preparation must finish copy disposal before issuing its original
  -- immutable whole-subject manifest. Remaining rows are a real source defect,
  -- never an arbitrary deletion capability or guessed provider absence.
  raise exception using errcode='42501',message='claimant deletion archive disposal incomplete';end if;
 return n;
end $body$;
revoke all on function private.future_person_deletion_row_v1(text,jsonb,boolean)
 from public,anon,authenticated,service_role,inherit_upload_only;
do $sealed_graph$
declare name text;
begin
 foreach name in array array['new_correction_archive_cases','new_correction_archive_runs',
  'new_correction_archive_r2_allocations','new_correction_archive_provider_dispositions'] loop
  execute format('create trigger guard_requester_statement_sealed_graph_delete before delete on private.%I
   for each row execute function private.guard_future_person_sealed_graph_delete_v1()',name);
 end loop;
end $sealed_graph$;
