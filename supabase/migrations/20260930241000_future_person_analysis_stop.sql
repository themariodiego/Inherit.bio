-- Irreversible claimant stop, current dispatch and derived-write fences.
-- This opens no claimant computation pipeline or raw-source read capability.
create function private.guard_future_person_analysis_stop_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.analysis_stopped_at is not null and new.analysis_stopped_at is distinct from old.analysis_stopped_at then
   raise exception using errcode='55000',message='claimant_analysis_stopped';
 end if;
 if new.analysis_stopped_at is not null and
   (new.claimant_principal_id is null or new.lifecycle not in('claimed_unbound','claimed_bound')) then
   raise exception using errcode='42501',message='claimant rights unavailable';
 end if;
 return new;
end $$;
revoke all on function private.guard_future_person_analysis_stop_v1() from public,anon,authenticated,service_role;
create trigger claimant_analysis_stop_irreversible before update on public.subjects
 for each row execute function private.guard_future_person_analysis_stop_v1();

-- Resolve ONLY live typed row bindings. Historical custody cohort UUIDs never
-- enlarge a target. For an update both old and new affected subjects are checked.
create function private.analysis_subjects_from_row_v1(p_row jsonb)
returns uuid[] language sql stable security definer set search_path='' as $$
 select coalesce(array_agg(distinct id order by id),'{}'::uuid[]) from (
   select (p_row->>'subject_id')::uuid id where p_row->>'subject_id' is not null
   union select e.subject_id from public.embryos e where e.id=(p_row->>'embryo_id')::uuid
   union select f.subject_id from public.genome_files f
     where f.id in((p_row->>'file_id')::uuid,(p_row->>'genome_file_id')::uuid,(p_row->>'source_file_id')::uuid)
   union select s.id from public.subjects s where s.cohort_id=(p_row->>'cohort_id')::uuid
 ) exact_subjects where id is not null;
$$;
revoke all on function private.analysis_subjects_from_row_v1(jsonb) from public,anon,authenticated,service_role;
create function private.assert_current_analysis_subjects_v1(p_subjects uuid[])
returns void language plpgsql security definer set search_path='' as $$
declare s public.subjects;
begin
 for s in select * from public.subjects where id=any(p_subjects) order by id for update loop
   if s.analysis_stopped_at is not null then
     raise exception using errcode='55000',message='claimant_analysis_stopped';
   end if;
 end loop;
end $$;
revoke all on function private.assert_current_analysis_subjects_v1(uuid[]) from public,anon,authenticated,service_role;

create function private.guard_stopped_claimant_job_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare ids uuid[];
begin
 -- Purge remains possible and invalidating/canceling old work is permitted.
 if new.kind in('revoke_purge','retention_purge') or new.status in('cancelled','failed') then return new;end if;
 ids:=private.analysis_subjects_from_row_v1(to_jsonb(new));
 if tg_op='UPDATE' then ids:=ids||private.analysis_subjects_from_row_v1(to_jsonb(old));end if;
 perform private.assert_current_analysis_subjects_v1(ids);
 return new;
end $$;
revoke all on function private.guard_stopped_claimant_job_v1() from public,anon,authenticated,service_role;
create trigger claimant_analysis_dispatch_fence before insert or update on public.worker_jobs
 for each row execute function private.guard_stopped_claimant_job_v1();

create function private.guard_stopped_claimant_result_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare ids uuid[];
begin
 ids:=private.analysis_subjects_from_row_v1(to_jsonb(new));
 if tg_op='UPDATE' then ids:=ids||private.analysis_subjects_from_row_v1(to_jsonb(old));end if;
 perform private.assert_current_analysis_subjects_v1(ids);
 return new;
end $$;
revoke all on function private.guard_stopped_claimant_result_v1() from public,anon,authenticated,service_role;
do $$declare store text;begin
 foreach store in array array['user_variants','user_prs','ancestry_results','ancestry_regions',
   'report_artifacts','report_observed_calls','embryo_variants','embryo_qc','embryo_scores'] loop
   execute format('create trigger claimant_analysis_result_fence before insert or update on public.%I '
     'for each row execute function private.guard_stopped_claimant_result_v1()',store);
 end loop;
end $$;

create or replace function public.stop_future_person_analysis_v1(p_session_hash text,p_nonce text)
returns timestamptz language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare rs public.rights_sessions;stopped timestamptz;audit uuid;
begin
 rs:=private.future_person_rights_session_v1(p_session_hash,true);
 if rs.id is null or not private.rights_action_permitted_v1(rs.purpose,'analysis-stop','api.future-person-analysis-stop')
   or exists(select 1 from public.subjects where id=rs.target_id and analysis_stopped_at is not null) then
   raise exception using errcode='42501',message='claimant rights unavailable';end if;
 perform private.consume_future_person_rights_nonce_v1(rs,p_nonce);
 update public.subjects set analysis_stopped_at=clock_timestamp() where id=rs.target_id
   returning analysis_stopped_at into stopped;
 update public.worker_jobs set status='cancelled',finished_at=clock_timestamp(),claim_token_hash=null,
   claim_expires_at=null,claimed_by=null where status in('queued','running')
   and (subject_id=rs.target_id or file_id in(select id from public.genome_files where subject_id=rs.target_id))
   and kind not in('revoke_purge','retention_purge');
 insert into public.audit_principals default values returning id into audit;
 perform private.append_legal_audit_event('claimant.analysis_stopped',audit,'api.future-person-analysis-stop','accepted','{}');
 return stopped;
end $$;
revoke all on function public.stop_future_person_analysis_v1(text,text) from public,anon,authenticated,service_role;
grant execute on function public.stop_future_person_analysis_v1(text,text) to service_role;
