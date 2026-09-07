-- Own-report revocations are database-only, exact-grant dispositions. This
-- migration never drains work or converts historical jobs during deployment.
insert into public.retention_phase_registry(retention_id,phase_id,phase_kind)
 values('purpose.derived-60s','own-report-purpose-purge','purge');
alter table public.purge_manifests
 add column physical_purge_started_at timestamptz,
 add column batch_cursor integer not null default 0 check(batch_cursor>=0),
 add column frozen_manifest_hash text check(frozen_manifest_hash is null or frozen_manifest_hash~'^[0-9a-f]{64}$');

create function private.own_report_purge_hash_matches_v1(a text,b text)
returns boolean language plpgsql immutable security invoker set search_path=pg_catalog as $fn$
declare ab bytea; bb bytea; diff integer:=0;
begin
 if a is null or b is null or a!~'^[0-9a-f]{64}$' or b!~'^[0-9a-f]{64}$' then return false; end if;
 ab:=decode(a,'hex'); bb:=decode(b,'hex');
 for i in 0..31 loop diff:=diff | (get_byte(ab,i) # get_byte(bb,i)); end loop;
 return diff=0;
end;
$fn$;
revoke all on function private.own_report_purge_hash_matches_v1(text,text) from public,anon,authenticated,inherit_upload_only;

create function private.own_report_purge_scope_v1(p_grant uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog as $fn$
 select jsonb_build_object('accountId',d.recipient_account_id,'subjectId',g.target_id,
  'principalId',g.data_subject_principal_id,'grantId',g.grant_id,'grantRevision',g.grant_revision,
  'purpose',g.purpose,'revokedAt',g.revoked_at,'directionStatus',d.status,'lifecycleRevision',s.lifecycle_revision)
 from public.purpose_grants g join public.directional_grants d on d.grant_id=g.grant_id and d.grant_revision=g.grant_revision
 join public.subjects s on s.id=g.target_id
 join public.subject_principals sp on sp.id=g.data_subject_principal_id
 join public.consent_signatures cs on cs.id=g.signature_id
 where g.grant_id=p_grant and g.target_kind='subject' and s.subject_class='self'
 and s.subject_account_id=d.recipient_account_id and sp.account_id=d.recipient_account_id and sp.subject_id=s.id
 and g.signer_principal_id=g.data_subject_principal_id and d.recipient_principal_id=g.data_subject_principal_id
 and d.direction='self' and d.relationship_id is null and d.pair_id is null
 and g.purpose in('reports.monogenic','reports.polygenic')
 and g.artifact_key=case g.purpose when 'reports.monogenic' then 'consent.own-monogenic' else 'consent.own-polygenic' end
 and cs.signer_account_id=d.recipient_account_id and cs.signer_principal_id=g.signer_principal_id
 and cs.target_kind='subject' and cs.target_id=g.target_id and cs.purpose=g.purpose
 and cs.artifact_key=g.artifact_key and cs.artifact_version=g.artifact_version and cs.artifact_body_sha256=g.artifact_body_sha256
 and d.status in('current','revoked','superseded');
$fn$;
revoke all on function private.own_report_purge_scope_v1(uuid) from public,anon,authenticated,inherit_upload_only;

create function private.prepare_own_report_purge_v1(p_grant uuid,p_revoked_at timestamptz default null)
returns uuid language plpgsql security definer set search_path=pg_catalog as $fn$
declare c jsonb; r public.retention_rows%rowtype; m uuid; w public.worker_jobs%rowtype;
 e jsonb; fp text; rev bigint;
begin
 c:=private.own_report_purge_scope_v1(p_grant);
 if c is null then raise exception using errcode='55000',message='own_report_purge_unsupported'; end if;
 -- Same account/subject lock order as canonical grant and generation. No live
 -- consent, session, active-subject or analysis-eligibility gate is used.
 perform 1 from public.profiles where id=(c->>'accountId')::uuid for update;
 perform 1 from public.subjects where id=(c->>'subjectId')::uuid for update;
 perform 1 from public.purpose_grants where grant_id=p_grant for update;
 c:=private.own_report_purge_scope_v1(p_grant);
 if c is null then raise exception using errcode='55000',message='own_report_purge_unsupported'; end if;
 if c->>'revokedAt' is null then
  if p_revoked_at is null or c->>'directionStatus'<>'current' then
   raise exception using errcode='55000',message='own_report_purge_unsupported'; end if;
  c:=jsonb_set(c,'{revokedAt}',to_jsonb(p_revoked_at));
 elsif p_revoked_at is not null and p_revoked_at is distinct from (c->>'revokedAt')::timestamptz then
  raise exception using errcode='55000',message='own_report_purge_binding_invalid';
 end if;
 c:=c-'directionStatus';
 select j.* into w from public.worker_jobs j join public.retention_due_phases d on d.retention_row_id=j.source_binding_id
 where j.computation_revision='own-report-revocation-v1' and d.phase_id='own-report-purpose-purge'
 and d.immutable_envelope->>'grantId'=p_grant::text;
 if w.id is not null then return w.id; end if;
 select coalesce(max(retention_revision),0)+1 into rev from public.retention_rows
 where retention_id='purpose.derived-60s' and target_kind='subject' and target_id=(c->>'subjectId')::uuid;
 insert into public.retention_rows(retention_id,target_kind,target_id,retention_revision,target_lifecycle_revision,
 disposition_revision,fixed_deadline)
 values('purpose.derived-60s','subject',(c->>'subjectId')::uuid,rev,(c->>'lifecycleRevision')::bigint,1,
 (c->>'revokedAt')::timestamptz+interval '60 seconds') returning * into r;
 m:=gen_random_uuid();
 e:=c||jsonb_build_object('version','own-report-revocation-v1','dispositionId',r.id,'dispositionRevision',1,
  'retentionId','purpose.derived-60s','phaseId','own-report-purpose-purge','phaseRevision',1,
  'targetKind','subject','manifestId',m,'manifestRevision',1,'claimRevision',0,'holdRevision',0,
  'deadline',r.fixed_deadline,'manifestClass','purpose-derived-only');
 fp:=encode(extensions.digest(convert_to(e::text,'UTF8'),'sha256'),'hex');
 insert into public.retention_due_phases(retention_row_id,retention_id,phase_id,phase_kind,phase_revision,phase_deadline,
 target_kind,target_id,target_lifecycle_revision,disposition_revision,recipient_authority_kind,recipient_authority_revision,immutable_envelope)
 values(r.id,r.retention_id,'own-report-purpose-purge','purge',1,r.fixed_deadline,'subject',r.target_id,
 r.target_lifecycle_revision,1,'exact-revoked-self-report-grant',(c->>'grantRevision')::bigint,e);
 insert into public.purge_manifests(id,retention_row_id,phase_id,phase_revision,manifest_class,manifest_revision,source_binding_fingerprint)
 values(m,r.id,'own-report-purpose-purge',1,'purpose-derived-only',1,fp);
 -- Own reports persist only the selected journal and its coverage rows. Store
 -- primary keys AND the old grant binding: a reused journal id under a new
 -- grant is not an old output. Raw variants/source objects are never members.
 insert into public.purge_manifest_entries(manifest_id,target_id,store_name,row_key,entry_revision)
 select m,'polygenic-results','public.user_prs',jsonb_build_object('id',p.id,'fileId',p.file_id,'grantId',p_grant),
 row_number() over(order by p.id) from public.user_prs p join private.own_analysis_runs a on a.file_id=p.file_id
 where a.grant_id=p_grant and a.grant_revision=(c->>'grantRevision')::bigint and a.purpose='reports.polygenic'
 and a.account_id=(c->>'accountId')::uuid and a.subject_id=(c->>'subjectId')::uuid
 and p.user_id=a.account_id and p.subject_id=a.subject_id;
 insert into public.purge_manifest_entries(manifest_id,target_id,store_name,row_key,entry_revision)
 select m,'generated-artifacts','private.own_analysis_runs',jsonb_build_object('id',a.id,'fileId',a.file_id,'grantId',p_grant),
 row_number() over(order by a.id) from private.own_analysis_runs a
 where a.grant_id=p_grant and a.grant_revision=(c->>'grantRevision')::bigint
 and a.account_id=(c->>'accountId')::uuid and a.subject_id=(c->>'subjectId')::uuid and a.purpose=c->>'purpose';
 -- The immutable disposition/phase/manifest precede the compliant enqueue.
 w:=private.enqueue_worker_job_v2((c->>'accountId')::uuid,'revoke_purge','lifecycle.revoke-purge',r.target_id,null,
 'revocation-disposition',r.id,1,fp,'own-report-revocation-v1',null,jsonb_build_object('dispositionId',r.id));
 perform private.append_legal_audit_event('purpose.purge-enqueued',null,'api.consent-revoke','accepted',
 jsonb_build_object('purpose',c->>'purpose','revision',c->'grantRevision'));
 return w.id;
end;
$fn$;
revoke all on function private.prepare_own_report_purge_v1(uuid,timestamptz) from public,anon,authenticated,inherit_upload_only;

-- Freeze the envelope and dispatch manifest after enqueue. Progress is separate
-- from membership, and changes in generic retention workflows are unaffected.
create function private.guard_own_report_purge_control_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog as $fn$
begin
 if old.phase_id='own-report-purpose-purge' then
  if tg_table_name='retention_due_phases' then
   if to_jsonb(new)-array['status','claim_token_hash','claim_expires_at','attempts','terminal_outcome_code','completed_at']
    is distinct from to_jsonb(old)-array['status','claim_token_hash','claim_expires_at','attempts','terminal_outcome_code','completed_at'] then
    raise exception using errcode='23514',message='own_report_purge_binding_immutable'; end if;
  elsif to_jsonb(new)-array['state','physical_purge_started_at','batch_cursor','frozen_manifest_hash']
   is distinct from to_jsonb(old)-array['state','physical_purge_started_at','batch_cursor','frozen_manifest_hash']
   or (old.physical_purge_started_at is not null and new.physical_purge_started_at is distinct from old.physical_purge_started_at)
   or (old.frozen_manifest_hash is not null and new.frozen_manifest_hash is distinct from old.frozen_manifest_hash)
   or new.batch_cursor<old.batch_cursor then
   raise exception using errcode='23514',message='own_report_purge_binding_immutable';
  end if;
 end if;
 return new;
end;
$fn$;
revoke all on function private.guard_own_report_purge_control_v1() from public,anon,authenticated,inherit_upload_only;
create trigger own_report_purge_phase_immutable before update on public.retention_due_phases
 for each row execute function private.guard_own_report_purge_control_v1();
create trigger own_report_purge_manifest_immutable before update on public.purge_manifests
 for each row execute function private.guard_own_report_purge_control_v1();

create or replace function private.enqueue_family_revoke_purge_v1(
  p_account_id uuid,
  p_disposition_id uuid,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subject_id uuid;
  v_job public.worker_jobs;
begin
  if p_payload->>'disposition'='purpose-revocation'
    and p_payload->>'grant_id'=p_disposition_id::text
    and private.own_report_purge_scope_v1(p_disposition_id)->>'accountId'=p_account_id::text then
    return private.prepare_own_report_purge_v1(p_disposition_id);
  end if;
  select s.id into v_subject_id
  from public.subjects s
  where s.subject_account_id = p_account_id
    and s.subject_class = 'self'
    and s.lifecycle in ('active', 'claimed_bound')
  order by s.created_at, s.id
  limit 1;
  if v_subject_id is null then
    return null;
  end if;

  v_job := private.enqueue_worker_job_v2(
    p_account_id,
    'revoke_purge',
    'lifecycle.revoke-purge',
    v_subject_id,
    null,
    'revocation-disposition',
    p_disposition_id,
    1,
    encode(extensions.digest(convert_to(
      concat_ws(':', 'family-revoke-purge-v1', p_disposition_id::text,
        v_subject_id::text, p_payload::text),
      'UTF8'
    ), 'sha256'), 'hex'),
    'family-revoke-purge-v1',
    null,
    p_payload || jsonb_build_object('retention_id', 'purpose.derived-60s',
      'manifest_class', 'purpose-derived-only')
  );
  return v_job.id;
end;
$$;

revoke all on function private.enqueue_family_revoke_purge_v1(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function private.enqueue_family_revoke_purge_v1(uuid, uuid, jsonb)
  to service_role;


create or replace function public.revoke_directional_purpose_v1(
  p_account_id uuid,
  p_grant_id uuid
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_base public.purpose_grants%rowtype;
  v_direction public.directional_grants%rowtype;
  v_signer_account_id uuid;
  v_pair_ids uuid[] := '{}'::uuid[];
  v_counts jsonb;
  v_own_job uuid;
begin
  -- Canonical self reports serialize with grant/generation before taking the
  -- grant row lock; unrelated family/other-adult revocations retain their path.
  if exists(select 1 from public.purpose_grants g join public.directional_grants d on d.grant_id=g.grant_id
   where g.grant_id=p_grant_id and d.direction='self' and d.recipient_account_id=p_account_id
   and g.artifact_key in('consent.own-monogenic','consent.own-polygenic')) then
   perform 1 from public.profiles where id=p_account_id for update;
   perform 1 from public.subjects where id=(select target_id from public.purpose_grants where grant_id=p_grant_id) for update;
  end if;
  select pg.* into v_base
  from public.purpose_grants pg
  where pg.grant_id = p_grant_id
  for update;
  select dg.* into v_direction
  from public.directional_grants dg
  where dg.grant_id = p_grant_id
  for update;
  if v_base.grant_id is null or v_direction.grant_id is null
    or v_base.grant_revision <> v_direction.grant_revision
    or v_base.revoked_at is not null
    or v_direction.status <> 'current' then
    raise exception using errcode = '42501', message = 'grant authority is unavailable';
  end if;

  select sp.account_id into v_signer_account_id
  from public.subject_principals sp
  where sp.id = v_base.data_subject_principal_id;
  if v_signer_account_id is null or v_signer_account_id <> p_account_id then
    raise exception using errcode = '42501', message = 'grant authority is unavailable';
  end if;

  if private.own_report_purge_scope_v1(p_grant_id)->>'accountId'=p_account_id::text then
   v_own_job:=private.prepare_own_report_purge_v1(p_grant_id,v_now);
  end if;

  update public.purpose_grants
  set revoked_at = v_now, revocation_reason = 'withdrawn'
  where grant_id = p_grant_id;
  update public.directional_grants
  set status = 'revoked', ended_at = v_now
  where grant_id = p_grant_id;

  if v_base.purpose = 'family.portrait' and v_direction.pair_id is not null then
    v_pair_ids := array[v_direction.pair_id];
    update public.family_pairs
    set status = 'pending'
    where id = v_direction.pair_id and status = 'current';
  end if;

  if v_own_job is null then
   v_counts := private.delete_pair_derived_rows_v1(
    v_pair_ids, v_direction.recipient_account_id, array[v_base.target_id], v_base.purpose);
  else
   v_counts:='{}'::jsonb;
  end if;

  perform private.enqueue_family_revoke_purge_v1(
    p_account_id, v_base.grant_id,
    jsonb_build_object('disposition', 'purpose-revocation', 'purpose', v_base.purpose,
      'grant_id', v_base.grant_id, 'pair_ids', to_jsonb(v_pair_ids))
  );

  perform private.append_legal_audit_event(
    'purpose.revoked', null, 'api.consent-revoke', 'accepted',
    jsonb_build_object('purpose', v_base.purpose, 'revision', v_base.grant_revision,
      'deleted', v_counts)
  );

  if v_own_job is not null then
   -- Bounded database-only work normally completes within this revoke request.
   -- A failed attempt rolls back its physical writes while logical withdrawal
   -- and the frozen pending disposition survive for the scheduled executor.
   begin
    perform private.execute_own_report_purge_v1(v_own_job);
   exception when others then
    perform private.append_legal_audit_event('purpose.purge-pending',null,'api.consent-revoke','accepted',
     jsonb_build_object('purpose',v_base.purpose,'cleanupComplete',false));
   end;
  end if;
  return v_now;
end;
$$;

revoke all on function public.revoke_directional_purpose_v1(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.revoke_directional_purpose_v1(uuid, uuid) to service_role;


create function private.guard_own_report_purge_entries_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog as $fn$
declare mid uuid:=case when tg_op='DELETE' then old.manifest_id else new.manifest_id end;
 old_mid uuid:=case when tg_op='INSERT' then null else old.manifest_id end;
begin
 if exists(select 1 from public.purge_manifests m join public.worker_jobs w on w.source_binding_id=m.retention_row_id
  where (m.id=mid or m.id=old_mid) and m.phase_id='own-report-purpose-purge' and w.computation_revision='own-report-revocation-v1') then
  if tg_op<>'UPDATE' or (to_jsonb(new)-'status') is distinct from (to_jsonb(old)-'status') then
   raise exception using errcode='23514',message='own_report_purge_membership_immutable'; end if;
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end;
$fn$;
revoke all on function private.guard_own_report_purge_entries_v1() from public,anon,authenticated,inherit_upload_only;
create trigger own_report_purge_entries_immutable before insert or update or delete on public.purge_manifest_entries
 for each row execute function private.guard_own_report_purge_entries_v1();

create function private.execute_own_report_purge_v1(p_job uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog set lock_timeout='2s' as $fn$
declare j public.worker_jobs%rowtype; d public.retention_due_phases%rowtype; m public.purge_manifests%rowtype;
 c jsonb; e public.purge_manifest_entries%rowtype; fp text; mh text; token text; replacement uuid;
 deleted integer:=0; changed integer; cursor_value integer:=0;
begin
 -- No generic claim and no caller-selected account/job/source. Arbitrary jobs
 -- remain untouched. Validated historical jobs receive a replacement, never
 -- a fabricated cleanup success or a rewritten immutable dispatch binding.
 select w.* into j from public.worker_jobs w
 where w.id=p_job and w.kind='revoke_purge' and w.output_kind='lifecycle.revoke-purge'
 and w.source_binding_kind='revocation-disposition' and w.target_kind='subject' and w.cohort_id is null
 and w.status='queued' and w.not_before<=clock_timestamp() and w.attempts<w.max_attempts
 and (w.computation_revision='own-report-revocation-v1'
  or (w.computation_revision='family-revoke-purge-v1'
   and private.own_report_purge_scope_v1(w.source_binding_id)->>'accountId'=w.user_id::text))
 order by w.created_at,w.id limit 1;
 if j.id is null then return null; end if;
 perform 1 from public.profiles where id=j.user_id for update;
 perform 1 from public.subjects where id=j.subject_id for update;
 select * into j from public.worker_jobs where id=j.id and status='queued' for update skip locked;
 if j.id is null then return null; end if;
 if j.computation_revision='family-revoke-purge-v1' then
  c:=private.own_report_purge_scope_v1(j.source_binding_id);
  fp:=encode(extensions.digest(convert_to(concat_ws(':','family-revoke-purge-v1',j.source_binding_id::text,
   j.subject_id::text,(j.payload-array['retention_id','manifest_class'])::text),'UTF8'),'sha256'),'hex');
  if c is null or c->>'revokedAt' is null or c->>'accountId' is distinct from j.user_id::text or c->>'subjectId' is distinct from j.subject_id::text
   or j.source_binding_revision<>1 or j.file_id is not null or not private.own_report_purge_hash_matches_v1(j.file_sha256,fp)
   or j.payload is distinct from jsonb_build_object('disposition','purpose-revocation','purpose',c->>'purpose',
    'grant_id',j.source_binding_id,'pair_ids','[]'::jsonb,'retention_id','purpose.derived-60s','manifest_class','purpose-derived-only') then
   raise exception using errcode='55000',message='own_report_purge_binding_invalid'; end if;
  replacement:=private.prepare_own_report_purge_v1(j.source_binding_id);
  update public.worker_jobs set status='cancelled',finished_at=clock_timestamp(),
   result=jsonb_build_object('outcome','superseded','replacementJobId',replacement,'cleanupComplete',false)
   where id=j.id;
  perform private.append_legal_audit_event('purpose.purge-superseded',null,'api.jobs.retention','accepted',
   jsonb_build_object('purpose',c->>'purpose','cleanupComplete',false));
  return jsonb_build_object('outcome','superseded','deletedRows',0);
 end if;
 select * into d from public.retention_due_phases where retention_row_id=j.source_binding_id
  and phase_id='own-report-purpose-purge' and phase_revision=1 for update;
 select * into m from public.purge_manifests where retention_row_id=d.retention_row_id
  and phase_id=d.phase_id and phase_revision=d.phase_revision and manifest_revision=1 for update;
 c:=private.own_report_purge_scope_v1((d.immutable_envelope->>'grantId')::uuid);
 fp:=encode(extensions.digest(convert_to(d.immutable_envelope::text,'UTF8'),'sha256'),'hex');
 if d.retention_row_id is null or m.id is null or c is null
  or c->>'revokedAt' is null or c->>'directionStatus' not in('revoked','superseded')
  or d.retention_id<>'purpose.derived-60s' or d.phase_kind<>'purge' or d.status<>'pending'
  or d.immutable_envelope->>'accountId' is distinct from j.user_id::text
  or d.target_id is distinct from j.subject_id or d.target_kind<>'subject'
  or d.immutable_envelope->>'grantId' is distinct from c->>'grantId'
  or d.immutable_envelope->>'grantRevision' is distinct from c->>'grantRevision'
  or d.immutable_envelope->>'principalId' is distinct from c->>'principalId'
  or d.immutable_envelope->>'purpose' is distinct from c->>'purpose'
  or d.immutable_envelope->>'lifecycleRevision' is distinct from c->>'lifecycleRevision'
  or d.phase_deadline is distinct from (c->>'revokedAt')::timestamptz+interval '60 seconds'
  or d.immutable_envelope->>'manifestId' is distinct from m.id::text
  or m.state<>'frozen' or m.manifest_class<>'purpose-derived-only' or not private.own_report_purge_hash_matches_v1(m.source_binding_fingerprint,fp)
  or not private.own_report_purge_hash_matches_v1(j.file_sha256,fp) or j.source_binding_revision<>1 or j.file_id is not null
  or j.payload is distinct from jsonb_build_object('dispositionId',d.retention_row_id) then
  raise exception using errcode='55000',message='own_report_purge_binding_invalid'; end if;
 -- This synchronous executor has no genetic/Storage transport and supports
 -- the two stores written by canonical own reports. Fail closed if attribution
 -- requires another workflow, rather than infer grant ownership from account.
 if exists(select 1 from public.chats where user_id=j.user_id and subject_id=j.subject_id)
  or exists(select 1 from public.copilot_context_tokens where account_id=j.user_id and target_id=j.subject_id)
  or exists(select 1 from public.chat_messages where user_id=j.user_id and retrieved_subject_ids @> array[j.subject_id]) then
  raise exception using errcode='55000',message='own_report_purge_unsupported_outputs'; end if;
 if exists(select 1 from public.purge_manifest_entries x where x.manifest_id=m.id and
  (x.object_id is not null or x.row_key->>'grantId' is distinct from c->>'grantId'
   or not((x.target_id='polygenic-results' and x.store_name='public.user_prs' and c->>'purpose'='reports.polygenic')
     or (x.target_id='generated-artifacts' and x.store_name='private.own_analysis_runs')))) then
  raise exception using errcode='55000',message='own_report_purge_membership_invalid'; end if;
 select encode(extensions.digest(convert_to(coalesce(jsonb_agg(jsonb_build_object('target',x.target_id,
  'store',x.store_name,'key',x.row_key,'revision',x.entry_revision) order by t.delete_order,x.store_name,x.entry_revision),'[]'::jsonb)::text,'UTF8'),'sha256'),'hex')
 into mh from public.purge_manifest_entries x join public.purge_targets t on t.target_id=x.target_id where x.manifest_id=m.id;
 token:=encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex');
 update public.worker_jobs set status='running',attempts=attempts+1,started_at=coalesce(started_at,clock_timestamp()),
  claim_token_hash=token,claim_expires_at=clock_timestamp()+interval '5 minutes',claimed_by='own-report-revocation-v1',progress_note='purging' where id=j.id;
 update public.retention_due_phases set status='claimed',claim_token_hash=token,claim_expires_at=clock_timestamp()+interval '5 minutes',attempts=attempts+1
  where retention_row_id=d.retention_row_id and phase_id=d.phase_id and phase_revision=d.phase_revision;
 update public.retention_rows set state='active' where id=d.retention_row_id;
 update public.purge_manifests set state='executing',physical_purge_started_at=clock_timestamp(),frozen_manifest_hash=mh where id=m.id;
 -- One database transaction holds the common locks from start through residual
 -- receipt. A crash rolls back all progress; regrant/generation cannot interleave.
 for e in select x.* from public.purge_manifest_entries x join public.purge_targets t on t.target_id=x.target_id
  where x.manifest_id=m.id order by t.delete_order,x.store_name,x.entry_revision
 loop
  if e.store_name='public.user_prs' then
   delete from public.user_prs p using private.own_analysis_runs a
   where p.id=(e.row_key->>'id')::uuid and p.file_id=(e.row_key->>'fileId')::uuid
    and p.user_id=j.user_id and p.subject_id=j.subject_id and a.file_id=p.file_id
    and a.grant_id=(c->>'grantId')::uuid and a.grant_revision=(c->>'grantRevision')::bigint
    and a.account_id=j.user_id and a.subject_id=j.subject_id and a.purpose='reports.polygenic';
  else
   delete from private.own_analysis_runs a where a.id=(e.row_key->>'id')::uuid and a.file_id=(e.row_key->>'fileId')::uuid
    and a.grant_id=(c->>'grantId')::uuid and a.grant_revision=(c->>'grantRevision')::bigint
    and a.account_id=j.user_id and a.subject_id=j.subject_id and a.purpose=c->>'purpose';
  end if;
  get diagnostics changed=row_count; deleted:=deleted+changed; cursor_value:=cursor_value+1;
  update public.purge_manifest_entries set status=case when changed=0 then 'missing' else 'deleted' end
   where manifest_id=e.manifest_id and target_id=e.target_id and store_name=e.store_name and entry_revision=e.entry_revision;
 end loop;
 if exists(select 1 from private.own_analysis_runs where grant_id=(c->>'grantId')::uuid)
  or (c->>'purpose'='reports.polygenic' and exists(select 1 from public.user_prs p where p.user_id=j.user_id and p.subject_id=j.subject_id
    and not exists(select 1 from private.own_analysis_runs a join public.purpose_grants g on g.grant_id=a.grant_id and g.grant_revision=a.grant_revision
     where a.file_id=p.file_id and a.purpose='reports.polygenic' and a.account_id=p.user_id and a.subject_id=p.subject_id
      and exists(select 1 from public.subjects ns where ns.id=a.subject_id
       and (a.authority->'context'->>'subjectBindingRevision')::bigint=ns.subject_binding_revision
       and g.subject_binding_revision=ns.subject_binding_revision)
      and a.grant_id<>(c->>'grantId')::uuid and g.revoked_at is null and (g.expires_at is null or g.expires_at>clock_timestamp()) and a.state='complete'
      and exists(select 1 from public.genome_files f join private.own_normalization_runs n on n.file_id=f.id
       join public.genome_storage_objects o on o.genome_file_id=f.id and o.object_id=f.storage_object_id
       join storage.objects so on so.id=o.object_id join public.directional_grants dg on dg.grant_id=g.grant_id and dg.grant_revision=g.grant_revision
       where f.id=a.file_id and f.user_id=a.account_id and f.subject_id=a.subject_id and f.single_logical_sample_verified_at is not null
       and a.source_sha256=f.sha256 and a.source_revision=f.upload_revision and a.normalization_completed_at=f.normalization_completed_at
       and f.normalization_source_revision=f.upload_revision and n.state='complete' and n.account_id=f.user_id
       and n.manifest->>'objectId'=f.storage_object_id::text and n.manifest->>'objectKey'=f.bucket_path
       and n.manifest->>'rawSha256'=f.sha256
       and n.manifest->>'decodedSha256'=f.source_sha256 and (n.manifest->>'sourceRevision')::bigint=f.upload_revision
       and o.bucket_id='genomes' and o.state='current' and o.revoked_at is null and o.sha256=f.sha256 and o.byte_count=f.size_bytes
       and o.object_revision=f.upload_revision and o.object_name=f.bucket_path and so.bucket_id=o.bucket_id and so.name=o.object_name
       and (so.metadata->>'size')::bigint=f.size_bytes and dg.status='current' and dg.direction='self' and dg.recipient_account_id=a.account_id)))) then
  raise exception using errcode='55000',message='own_report_purge_residuals'; end if;
 update public.purge_manifests set state='complete',batch_cursor=cursor_value where id=m.id;
 update public.retention_due_phases set status='succeeded',claim_token_hash=null,claim_expires_at=null,
  terminal_outcome_code='exact_grant_residuals_zero',completed_at=clock_timestamp()
  where retention_row_id=d.retention_row_id and phase_id=d.phase_id and phase_revision=d.phase_revision;
 update public.retention_rows set state='complete',ended_at=clock_timestamp() where id=d.retention_row_id;
 update public.worker_jobs set status='done',claim_token_hash=null,claim_expires_at=null,claimed_by=null,
  finished_at=clock_timestamp(),progress=100,progress_note='complete',
  result=jsonb_build_object('outcome','exact_grant_residuals_zero','deletedRows',deleted,'manifestId',m.id,
   'completedWithinDeadline',clock_timestamp()<=d.phase_deadline) where id=j.id;
 perform private.append_legal_audit_event('purpose.purge-complete',null,'api.jobs.retention','accepted',
  jsonb_build_object('purpose',c->>'purpose','deletedRows',deleted,'completedWithinDeadline',clock_timestamp()<=d.phase_deadline));
 return jsonb_build_object('outcome','complete','deletedRows',deleted);
end;
$fn$;
revoke all on function private.execute_own_report_purge_v1(uuid) from public,anon,authenticated,inherit_upload_only;
-- Internal exact-job execution is not an exposed caller-selected API.
-- Separate the exact internal dispatch step from provider-facing selection so
-- failure handling is testable without claiming unrelated queued work.
create function private.dispatch_own_report_purge_v1(jid uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog set lock_timeout='2s' as $fn$
declare code text;
begin
 begin
  return private.execute_own_report_purge_v1(jid);
 exception when query_canceled or others then
  get stacked diagnostics code=returned_sqlstate;
  -- Transient contention is retryable; failed attempts never renew the
  -- original disposition deadline. No generic error text enters a receipt.
  if code in('55P03','40P01','40001','57014') then
   perform 1 from public.worker_jobs where id=jid and status='queued' for update skip locked;
   if found then
    update public.worker_jobs set attempts=attempts+1,
     status=case when attempts+1>=max_attempts then 'failed' else 'queued' end,
     not_before=clock_timestamp()+make_interval(secs=>least(10,attempts+1)),
     error=case when attempts+1>=max_attempts then 'own_report_purge_retry_exhausted' else 'own_report_purge_retry' end,
     finished_at=case when attempts+1>=max_attempts then clock_timestamp() else null end,
     result=jsonb_build_object('outcome',case when attempts+1>=max_attempts then 'retry_exhausted' else 'retry' end,'cleanupComplete',false)
     where id=jid;
   end if;
   return jsonb_build_object('outcome','retry','deletedRows',0);
  end if;
  -- Only this recognized own candidate is blocked; its immutable binding is
  -- preserved. The next finite module step can reach a later eligible job,
  -- and reports this blocked candidate separately from successful purges.
  update public.worker_jobs set status='failed',error='own_report_purge_blocked',finished_at=clock_timestamp(),
   result=jsonb_build_object('outcome','blocked','cleanupComplete',false) where id=jid and status='queued';
  return jsonb_build_object('outcome','blocked','deletedRows',0);
 end;
end;
$fn$;
revoke all on function private.dispatch_own_report_purge_v1(uuid) from public,anon,authenticated,inherit_upload_only;

create function private.run_own_report_purge_v1()
returns jsonb language plpgsql security definer set search_path=pg_catalog set lock_timeout='2s' as $fn$
declare jid uuid;
begin
 select w.id into jid from public.worker_jobs w
 where w.kind='revoke_purge' and w.status='queued' and w.not_before<=clock_timestamp() and w.attempts<w.max_attempts
 and (w.computation_revision='own-report-revocation-v1'
 or (w.computation_revision='family-revoke-purge-v1' and private.own_report_purge_scope_v1(w.source_binding_id)->>'accountId'=w.user_id::text
  and private.own_report_purge_scope_v1(w.source_binding_id)->>'revokedAt' is not null))
 order by w.created_at,w.id limit 1;
 if jid is null then return null; end if;
 return private.dispatch_own_report_purge_v1(jid);
end;
$fn$;
revoke all on function private.run_own_report_purge_v1() from public,anon,authenticated,inherit_upload_only;
grant execute on function private.run_own_report_purge_v1() to service_role;
create function public.run_own_report_purge_v1()
returns jsonb language sql security invoker set search_path=pg_catalog as $fn$
 select private.run_own_report_purge_v1();
$fn$;
revoke all on function public.run_own_report_purge_v1() from public,anon,authenticated,inherit_upload_only;
grant execute on function public.run_own_report_purge_v1() to service_role;

create or replace function private.clear_revoked_own_report_outputs_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog,private as $function$
declare v_ended boolean;
begin
 if tg_table_name='purpose_grants' then v_ended:=new.revoked_at is not null;
 else v_ended:=new.status<>'current'; end if;
 if v_ended and exists(select 1 from public.retention_due_phases p
  where p.phase_id='own-report-purpose-purge' and p.immutable_envelope->>'grantId'=new.grant_id::text) then
  return new;
 end if;
 if v_ended then
  delete from public.user_prs where file_id in(select file_id from private.own_analysis_runs
   where grant_id=new.grant_id and purpose='reports.polygenic');
  delete from private.own_analysis_runs where grant_id=new.grant_id;
 end if;
 return new;
end;
$function$;
revoke all on function private.clear_revoked_own_report_outputs_v1() from public,anon,authenticated,inherit_upload_only;
