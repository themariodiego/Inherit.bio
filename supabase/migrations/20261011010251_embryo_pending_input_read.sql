-- Detail-only read: distinguish native untouched finalization from actual
-- ingest activity without changing any writer, authority, QC or result row.
-- One stable SELECT supplies every fact from the same MVCC snapshot. No
-- locks, retention renewal, configuration, mutation or private data output.
create function private.read_pending_embryo_input_v1(p_account uuid,p_cohort uuid,p_embryo uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $read$
declare result jsonb;
begin
 -- SECURITY DEFINER changes current_user; bind the actual invoking role instead.
 -- A direct service login and an authenticator SET ROLE service_role are the
 -- only admitted callers. The public invoker repeats its original role check.
 if (current_setting('role',true) is distinct from 'service_role'
     and session_user is distinct from 'service_role')
   or auth.jwt()->>'role' is distinct from 'service_role' then
  raise exception using errcode='42501',message='not_found';end if;
 if p_account is null or p_cohort is null or p_embryo is null then
  raise exception using errcode='22023',message='invalid_request';end if;
 -- The server already applied actor/co-parent jurisdiction and its authorized
 -- graph. Repeat its exact current cohort membership, rather than treating a
 -- passed UUID or parent account as authority. Client roles cannot call this.
 with scope as (
  select c.*, e.id as embryo_id,e.subject_id,e.status as embryo_status,sub.lifecycle as subject_lifecycle
  from public.embryo_cohorts c join public.embryos e on e.cohort_id=c.id
  join public.subjects sub on sub.id=e.subject_id and sub.cohort_id=c.id
    and sub.subject_class='embryo' and sub.owner_account_id=c.owner_account_id
  where c.id=p_cohort and e.id=p_embryo and c.status in('upload_pending','ingesting','active')
   and ((c.owner_account_id=p_account and c.upload_class='embryo_third_party') or exists(
    select 1 from public.embryo_participant_sets ps join public.subject_principals principal on principal.id=ps.principal_id
    where ps.cohort_id=c.id and ps.set_kind='required_upload_principals' and ps.revoked_at is null
     and principal.account_id=p_account and principal.status='active'))
 ), attempts as (
  select s.* from public.embryo_ingest_sessions s join scope c on c.id=s.cohort_id
 ), subject_ids as (
  select e.id,e.subject_id from public.embryos e join scope c on c.id=e.cohort_id
 ), files as (
  select f.id from public.genome_files f join subject_ids e on e.subject_id=f.subject_id
 ), work as (
  select w.id,w.status from public.worker_jobs w,scope c
  where w.cohort_id=c.id or w.subject_id in(select subject_id from subject_ids)
   or w.file_id in(select id from files)
   or (w.source_binding_kind='embryo-ingest-fragment-set' and w.source_binding_id in(select id from attempts))
 )
 select jsonb_build_object(
  'version',1,'accountId',p_account,'cohortId',c.id,'embryoId',c.embryo_id,'subjectId',c.subject_id,
  'cohortStatus',c.status,'embryoStatus',c.embryo_status,'subjectLifecycle',c.subject_lifecycle,
  'ingestRevision',c.ingest_revision,'lifecycleRevision',c.lifecycle_revision,'publicationRevision',c.publication_revision,
  'snapshotAt',statement_timestamp(),
  'sessions',(select coalesce(jsonb_agg(jsonb_build_object(
   'id',s.id,'ingestRevision',s.ingest_revision,'lifecycleRevision',s.cohort_lifecycle_revision,'status',s.status,
   'acceptedBytes',s.accepted_bytes,'acceptedChunks',s.accepted_chunks,'acceptedRecords',s.accepted_records,
   'expectedNextSequence',s.expected_next_sequence,'completedAt',s.completed_at,'workerJobId',s.worker_job_id,
   'expiresAt',s.expires_at) order by s.id),'[]'::jsonb) from attempts s),
  'fileCount',(select count(*) from files),
  'qcCount',(select count(*) from public.embryo_qc q where q.embryo_id in(select id from subject_ids)),
  'chunkCount',(select count(*) from public.embryo_ingest_chunks k where k.session_id in(select id from attempts)),
  'fragmentCount',(select count(*) from public.embryo_ingest_fragments f where f.session_id in(select id from attempts)),
  'workCount',(select count(*) from work),'activeWorkCount',(select count(*) from work where status in('queued','running'))
 ) into result from scope c;
 return result;
end $read$;
revoke all on function private.read_pending_embryo_input_v1(uuid,uuid,uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function private.read_pending_embryo_input_v1(uuid,uuid,uuid) to service_role;

-- Keep the client-facing door an invoker: it grants no table read. Only the
-- closed metadata helper owns the exact authorized SELECT above.
create function public.read_pending_embryo_input_v1(p_account uuid,p_cohort uuid,p_embryo uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $door$
begin
 if current_user is distinct from 'service_role' or auth.jwt()->>'role' is distinct from 'service_role' then
  raise exception using errcode='42501',message='not_found';end if;
 if p_account is null or p_cohort is null or p_embryo is null then
  raise exception using errcode='22023',message='invalid_request';end if;
 return private.read_pending_embryo_input_v1(p_account,p_cohort,p_embryo);
end $door$;
revoke all on function public.read_pending_embryo_input_v1(uuid,uuid,uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.read_pending_embryo_input_v1(uuid,uuid,uuid) to service_role;
