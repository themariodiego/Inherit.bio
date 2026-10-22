-- Registered optional parent profile. Legacy rows acquire no match/decryption
-- proof. New data has a distinct random wrapped key and an immutable expiry.
alter table public.future_person_identity
  add column profile_format_version smallint,
  add column wrapped_profile_key bytea,
  add column match_indexes jsonb not null default '{}'::jsonb,
  add column fixed_expires_at timestamptz,
  add column authority_snapshot jsonb;

create function private.future_person_profile_shape_v1(p_indexes jsonb)
returns boolean language sql immutable set search_path='' as $$
  select case when jsonb_typeof(p_indexes)='object' then
    (select count(*) between 1 and 8 and coalesce(bool_and(
       e.key ~ '^[1-9][0-9]{0,5}$' and jsonb_typeof(e.value)='string'
       and e.value#>>'{}' ~ '^[0-9a-f]{64}$'),false) from jsonb_each(p_indexes) e)
    else false end;
$$;
revoke all on function private.future_person_profile_shape_v1(jsonb)
  from public,anon,authenticated,inherit_upload_only,service_role;

alter table public.future_person_identity add constraint future_person_profile_envelope_shape check ((
  (profile_format_version is null and wrapped_profile_key is null
    and match_indexes='{}'::jsonb and fixed_expires_at is null and authority_snapshot is null)
  or (profile_format_version=1 and fixed_expires_at is not null
    and jsonb_typeof(authority_snapshot)='object'
    and ((state='current' and octet_length(wrapped_profile_key)=72
      and octet_length(parent_supplied_ciphertext) between 29 and 16384
      and private.future_person_profile_shape_v1(match_indexes))
     or (state<>'current' and wrapped_profile_key is null and match_indexes='{}'::jsonb
      and parent_supplied_ciphertext=decode('00','hex'))))) is true);

create function private.guard_future_person_profile_v1() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' then
    if (new.id,new.embryo_id,new.identity_revision,new.profile_format_version,new.fixed_expires_at,new.authority_snapshot)
      is distinct from (old.id,old.embryo_id,old.identity_revision,old.profile_format_version,old.fixed_expires_at,old.authority_snapshot)
    then raise exception using errcode='55000',message='immutable_identity_profile'; end if;
    if old.profile_format_version=1 and new.state='current' and
      (new.parent_supplied_ciphertext,new.wrapped_profile_key,new.match_indexes,new.identity_hmac,
       new.hmac_key_revision,new.envelope_key_revision,new.created_at)
      is distinct from (old.parent_supplied_ciphertext,old.wrapped_profile_key,old.match_indexes,old.identity_hmac,
       old.hmac_key_revision,old.envelope_key_revision,old.created_at)
    then raise exception using errcode='55000',message='immutable_identity_profile'; end if;
    if old.state<>'current' and new.state='current' then
      raise exception using errcode='55000',message='immutable_identity_profile'; end if;
  end if;
  if new.state<>'current' then
    -- Also runs for existing detach/refusal executors; no caller can leave the
    -- independently wrapped key usable behind a tombstone.
    new.wrapped_profile_key:=null; new.match_indexes:='{}'::jsonb;
    new.parent_supplied_ciphertext:=decode('00','hex');
    new.identity_hmac:=encode(extensions.gen_random_bytes(32),'hex');
  end if;
  return new;
end $$;
revoke all on function private.guard_future_person_profile_v1()
  from public,anon,authenticated,inherit_upload_only,service_role;
create trigger future_person_profile_immutable before insert or update on public.future_person_identity
  for each row execute function private.guard_future_person_profile_v1();

-- Register only the two explicit parent actions for account attribution.
-- Automated expiry uses a jobs route and remains unattributed.
alter function private.legal_audit_person_event_v1(text,text) rename to legal_audit_person_event_before_profiles_v1;
revoke all on function private.legal_audit_person_event_before_profiles_v1(text,text)
  from public,anon,authenticated,inherit_upload_only,service_role;
create function private.legal_audit_person_event_v1(p_event_code text,p_route_id text)
returns boolean language sql immutable set search_path='' as $$
  select private.legal_audit_person_event_before_profiles_v1(p_event_code,p_route_id)
    or (p_route_id='api.future-person-identity-profile' and p_event_code in (
      'embryo.identity_profile_saved','embryo.identity_profile_deleted'));
$$;
revoke all on function private.legal_audit_person_event_v1(text,text)
  from public,anon,authenticated,inherit_upload_only,service_role;

-- One source of profile authority, with the same subject-first lock as claims
-- and deletion. Service callers obtain account/session only from verified Auth.
create function private.future_person_profile_context_v1(p_account uuid,p_session uuid,p_embryo uuid,p_signature uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.embryos%rowtype; s public.subjects%rowtype; c public.embryo_cohorts%rowtype;
  p public.profiles%rowtype; ss auth.sessions%rowtype; i public.future_person_identity%rowtype;
  b public.embryo_basis_bindings%rowtype; d public.embryo_cohort_drafts%rowtype; a record; v_proof jsonb;
  r public.retention_rows%rowtype; v_principals uuid[]; v_actor uuid; v_fingerprint text; v_revision bigint;
begin
  select subject_id into e.subject_id from public.embryos where id=p_embryo;
  select * into s from public.subjects where id=e.subject_id for share;
  select * into c from public.embryo_cohorts where id=s.cohort_id for share;
  select * into e from public.embryos where id=p_embryo for share;
  if e.id is null or s.id is null or c.id is null or e.subject_id<>s.id or e.cohort_id<>c.id
    or s.cohort_id<>c.id or s.owner_account_id is distinct from c.owner_account_id
    or s.subject_class<>'embryo' or s.subject_account_id is not null
    or s.lifecycle not in ('active','restricted') or c.status not in ('active','restricted')
    or e.status<>'transferred' or e.future_person_state<>'reserved_for_future_person'
    or exists(select 1 from public.future_person_claims f where f.embryo_id=e.id and f.status='approved')
  then raise exception using errcode='42501',message='not_found'; end if;
  select * into ss from auth.sessions where id=p_session and user_id=p_account for share;
  select * into p from public.profiles where id=p_account for share;
  perform 1 from auth.users u where u.id=p_account and u.deleted_at is null
    and (u.banned_until is null or u.banned_until<=clock_timestamp()) for share;
  if not found or ss.id is null or p.id is null or p.deletion_requested_at is not null
    or (ss.not_after is not null and ss.not_after<=clock_timestamp())
  then raise exception using errcode='42501',message='not_found'; end if;
  if p_signature is not null then
    v_fingerprint:=private.embryo_ingest_authority_fingerprint_v1(c.id);
  else
    -- Erasing optional identity never requires signing a new upload consent.
    -- It still requires the actual current parent basis and recipient matrix.
    select * into d from public.embryo_cohort_drafts where id=c.draft_id for share;
    select * into b from public.embryo_basis_bindings where cohort_id=c.id for share;
    select * into a from private.resolve_embryo_basis_authority_v1(c.draft_id);
    if d.state is distinct from 'finalized' or b.cohort_id is null
      or (d.basis_case,d.basis_revision,b.basis_case,b.basis_revision,b.participant_set_revision)
        is distinct from (c.basis_case,c.basis_revision,c.basis_case,c.basis_revision,c.participant_set_revision)
      or (select array_agg(x order by x) from unnest(a.record_key_recipients) x)
        is distinct from (select array_agg(x order by x) from unnest(private.embryo_cohort_set_v1(c.id,'record_key_recipients')) x)
      or exists(select 1 from public.attestation_contradictions where cohort_id=c.id and resolved_at is null)
    then raise exception using errcode='42501',message='not_found'; end if;
    if c.basis_case in ('parent_deceased','sole_legal_authority') then
      perform 1 from public.legal_reviews lr join public.reviewed_evidence re on re.review_id=lr.id
        where lr.id=b.legal_review_id and re.id=b.reviewed_evidence_id and lr.decision='approved'
          and lr.target_kind='single_parent_basis' and lr.target_id=d.id and re.purged_at is null
          and re.evidence_kind=case c.basis_case when 'parent_deceased' then 'parent-death-certificate' else 'sole-disposition-authority' end
          and not exists(select 1 from public.legal_reviews newer where newer.target_kind=lr.target_kind
            and newer.target_id=lr.target_id and newer.review_revision>lr.review_revision) for share of lr,re;
      if not found then raise exception using errcode='42501',message='not_found'; end if;
    end if;
    select jsonb_agg(jsonb_build_array(ps.principal_id,ps.set_revision,ps.membership_revision,sp.principal_revision)
      order by ps.principal_id) into v_proof from public.embryo_participant_sets ps
      join public.subject_principals sp on sp.id=ps.principal_id and sp.status='active'
      where ps.cohort_id=c.id and ps.set_kind='record_key_recipients' and ps.revoked_at is null
        and ps.set_revision=c.participant_set_revision;
    v_fingerprint:=encode(extensions.digest(convert_to(jsonb_build_array('profile-erase-authority-v1',
      c.id,c.basis_case,c.basis_revision,c.recipient_set_revision,c.lifecycle_revision,
      b.case_artifact_signature_id,b.reviewed_evidence_id,b.legal_review_id,v_proof)::text,'UTF8'),'sha256'),'hex');
  end if;
  select array_agg(sp.id order by sp.id) into v_principals from public.subject_principals sp
    where sp.id=any(private.embryo_cohort_set_v1(c.id,'record_key_recipients'))
      and sp.account_id=p_account and sp.status='active' and sp.principal_kind='genetic_parent';
  if cardinality(v_principals) is distinct from 1 then
    raise exception using errcode='42501',message='not_found'; end if;
  v_actor:=v_principals[1];
  if p_signature is not null then
    perform 1 from public.consent_signatures cs join public.consent_artifacts ca
      on ca.artifact_key=cs.artifact_key and ca.version=cs.artifact_version
        and ca.body_sha256=cs.artifact_body_sha256
      where cs.id=p_signature and cs.signer_principal_id=v_actor and cs.signer_account_id=p_account
        and cs.target_kind='cohort_draft' and cs.target_id=c.draft_id
        and cs.artifact_key='consent.upload-embryo' and ca.superseded_at is null
        and ca.published_at<=clock_timestamp() and ca.effective_on<=timezone('UTC',clock_timestamp())::date
        and ca.body_sha256=encode(extensions.digest(convert_to(ca.body_markdown,'UTF8'),'sha256'),'hex')
        and cs.statement_keys=private.embryo_statement_keys_v1('consent.upload-embryo','parent')
        and cs.purpose='embryo-upload-parent-class' and cs.jurisdiction_code=p.jurisdiction_code
        and cs.jurisdiction_revision=p.jurisdiction_revision for share of cs,ca;
    if not found then raise exception using errcode='42501',message='not_found'; end if;
  end if;
  -- A fixed live disposition row is the sole deadline source. The parent
  -- cannot create a profile during physical disposal or extend a window.
  perform 1 from public.retention_rows rr where rr.target_kind='subject' and rr.target_id=s.id
    order by rr.id for share;
  select * into r from public.retention_rows rr where rr.retention_id='embryo.transferred-claim-window'
    and rr.target_kind='subject' and rr.target_id=s.id and rr.state in ('scheduled','active')
    and rr.disposition_revision=e.disposition_revision and rr.retention_revision=e.disposition_revision;
  if r.id is null or r.fixed_deadline<=clock_timestamp() or exists(
      select 1 from public.retention_rows rr join public.purge_manifests m on m.retention_row_id=rr.id
      where rr.target_kind='subject' and rr.target_id=s.id and (m.state in ('executing','complete') or m.physical_purge_started_at is not null or m.batch_cursor>0))
    or exists(select 1 from public.purge_manifest_entries x join public.purge_manifests m on m.id=x.manifest_id
      join public.retention_rows rr on rr.id=m.retention_row_id
      where rr.target_kind='subject' and rr.target_id=s.id and x.status in ('deleted','missing'))
  then raise exception using errcode='42501',message='not_found'; end if;
  select * into i from public.future_person_identity where embryo_id=e.id and state='current' for share;
  select coalesce(max(identity_revision),0)+1 into v_revision from public.future_person_identity where embryo_id=e.id;
  return jsonb_build_object('embryoId',e.id,'subjectId',s.id,'actorPrincipal',v_actor,
    'basisFingerprint',v_fingerprint,'basisRevision',c.basis_revision,'participantSetRevision',c.participant_set_revision,
    'recipientSetRevision',c.recipient_set_revision,'cohortLifecycleRevision',c.lifecycle_revision,
    'subjectLifecycleRevision',s.lifecycle_revision,'dispositionRevision',e.disposition_revision,
    'accountRevision',p.account_revision,'authSessionRevision',p.auth_session_revision,
    'sessionRevision',coalesce(ss.refresh_token_counter,0)+1,'consentSignatureId',p_signature,
    'currentProfileId',i.id,'nextIdentityRevision',v_revision,'expiresAt',r.fixed_deadline);
end $$;
revoke all on function private.future_person_profile_context_v1(uuid,uuid,uuid,uuid)
  from public,anon,authenticated,inherit_upload_only,service_role;

create function public.future_person_profile_context_v1(p_account uuid,p_session uuid,p_embryo uuid,p_signature uuid)
returns jsonb language sql security definer set search_path='' as $$
  select private.future_person_profile_context_v1(p_account,p_session,p_embryo,p_signature);
$$;
revoke all on function public.future_person_profile_context_v1(uuid,uuid,uuid,uuid)
  from public,anon,authenticated,inherit_upload_only;
grant execute on function public.future_person_profile_context_v1(uuid,uuid,uuid,uuid) to service_role;

create function private.erase_future_person_profile_v1(p_profile uuid,p_state text default 'shredded',p_route text default 'api.future-person-identity-profile')
returns boolean language plpgsql security definer set search_path='' as $$
declare i public.future_person_identity%rowtype; v_subject uuid; r public.retention_rows%rowtype;
begin
  if p_state not in ('shredded','superseded') or p_route not in ('api.future-person-identity-profile','api.jobs.retention') then raise exception using errcode='22023',message='invalid_request'; end if;
  select e.subject_id into v_subject from public.future_person_identity fi join public.embryos e on e.id=fi.embryo_id where fi.id=p_profile;
  perform 1 from public.subjects where id=v_subject for update;
  select * into i from public.future_person_identity where id=p_profile for update;
  if i.id is null or i.state<>'current' then return false; end if;
  update public.future_person_identity set state=p_state,ended_at=clock_timestamp() where id=i.id;
  for r in select * from public.retention_rows where retention_id='future-person.identity-match-profile'
    and target_kind='subject' and target_id=v_subject and retention_revision=i.identity_revision
    and state in ('scheduled','active') order by id for update loop
    update public.retention_due_phases set status='succeeded',claim_token_hash=null,claim_expires_at=null,
      terminal_outcome_code='identity_profile_erased',completed_at=clock_timestamp()
      where retention_row_id=r.id and status in ('pending','claimed','retry');
    update public.retention_rows set state='complete',ended_at=clock_timestamp() where id=r.id;
  end loop;
  perform private.append_legal_audit_event('embryo.identity_profile_deleted',null,p_route,
    'erased','{}'::jsonb);
  return true;
end $$;
revoke all on function private.erase_future_person_profile_v1(uuid,text,text)
  from public,anon,authenticated,inherit_upload_only,service_role;

create function public.write_future_person_profile_v1(p_account uuid,p_session uuid,p_embryo uuid,
  p_signature uuid,p_expected jsonb,p_profile uuid,p_ciphertext bytea,p_wrapped_key bytea,p_indexes jsonb,p_nonce text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_context jsonb; v_index jsonb; v_active bigint; v_retention uuid; v_revision bigint;
begin
  if p_signature is null or p_profile is null or p_ciphertext is null or octet_length(p_ciphertext) not between 29 and 16384
    or octet_length(p_wrapped_key) is distinct from 72 or not private.future_person_profile_shape_v1(p_indexes)
  then raise exception using errcode='22023',message='invalid_request'; end if;
  perform 1 from public.subjects where id=(select subject_id from public.embryos where id=p_embryo) for update;
  v_context:=private.future_person_profile_context_v1(p_account,p_session,p_embryo,p_signature);
  if p_expected is distinct from v_context then raise exception using errcode='42501',message='not_found'; end if;
  v_index:=private.resolve_hmac_set_v1('contact',null,p_indexes);
  v_active:=private.hmac_active_revision_v1('contact');
  perform private.consume_embryo_operation_nonce_v1(p_nonce,p_account,p_session,'future_person_identity_save','embryo',p_embryo);
  perform private.erase_future_person_profile_v1((v_context->>'currentProfileId')::uuid,'superseded');
  v_revision:=(v_context->>'nextIdentityRevision')::bigint;
  insert into public.future_person_identity(id,embryo_id,identity_revision,parent_supplied_ciphertext,
    identity_hmac,hmac_key_revision,envelope_key_revision,profile_format_version,wrapped_profile_key,
    match_indexes,fixed_expires_at,authority_snapshot)
  values(p_profile,p_embryo,v_revision,p_ciphertext,v_index->>v_active::text,v_active,1,1,p_wrapped_key,
    p_indexes,(v_context->>'expiresAt')::timestamptz,
    v_context-'currentProfileId'-'nextIdentityRevision'-'accountRevision'-'authSessionRevision'-'sessionRevision');
  insert into public.retention_rows(retention_id,target_kind,target_id,retention_revision,target_lifecycle_revision,
    disposition_revision,fixed_deadline)
  values('future-person.identity-match-profile','subject',(v_context->>'subjectId')::uuid,v_revision,
    (v_context->>'subjectLifecycleRevision')::bigint,(v_context->>'dispositionRevision')::bigint,
    (v_context->>'expiresAt')::timestamptz) returning id into v_retention;
  insert into public.retention_due_phases(retention_row_id,retention_id,phase_id,phase_kind,phase_revision,
    phase_deadline,target_kind,target_id,target_lifecycle_revision,disposition_revision,
    recipient_authority_kind,recipient_authority_revision,immutable_envelope)
  select v_retention,'future-person.identity-match-profile',phase_id,phase_kind,1,
    (v_context->>'expiresAt')::timestamptz,'subject',(v_context->>'subjectId')::uuid,
    (v_context->>'subjectLifecycleRevision')::bigint,(v_context->>'dispositionRevision')::bigint,
    'record-key-recipients',(v_context->>'recipientSetRevision')::bigint,
    jsonb_build_object('profileId',p_profile,'identityRevision',v_revision)
  from public.retention_phase_registry where retention_id='future-person.identity-match-profile';
  perform private.append_legal_audit_event('embryo.identity_profile_saved',null,'api.future-person-identity-profile',
    'saved','{}'::jsonb);
  return jsonb_build_object('status','saved','expiresAt',(v_context->>'expiresAt')::timestamptz);
end $$;
revoke all on function public.write_future_person_profile_v1(uuid,uuid,uuid,uuid,jsonb,uuid,bytea,bytea,jsonb,text)
  from public,anon,authenticated,inherit_upload_only;
grant execute on function public.write_future_person_profile_v1(uuid,uuid,uuid,uuid,jsonb,uuid,bytea,bytea,jsonb,text) to service_role;

create function public.delete_future_person_profile_v1(p_account uuid,p_session uuid,p_embryo uuid,p_expected jsonb,p_nonce text)
returns void language plpgsql security definer set search_path='' as $$
declare v_context jsonb;
begin
  perform 1 from public.subjects where id=(select subject_id from public.embryos where id=p_embryo) for update;
  v_context:=private.future_person_profile_context_v1(p_account,p_session,p_embryo,null);
  if p_expected is distinct from v_context then raise exception using errcode='42501',message='not_found'; end if;
  perform private.consume_embryo_operation_nonce_v1(p_nonce,p_account,p_session,'future_person_identity_delete','embryo',p_embryo);
  perform private.erase_future_person_profile_v1((v_context->>'currentProfileId')::uuid);
end $$;
revoke all on function public.delete_future_person_profile_v1(uuid,uuid,uuid,jsonb,text)
  from public,anon,authenticated,inherit_upload_only;
grant execute on function public.delete_future_person_profile_v1(uuid,uuid,uuid,jsonb,text) to service_role;

-- Loss of parent control, claim approval, subject deletion or disposition
-- reversal makes the independently wrapped key unreadable in that transaction.
create function private.erase_changed_future_person_profiles_v1() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_profile uuid;
begin
  if tg_table_name='subjects' then
    if new.lifecycle not in ('active','restricted') or new.subject_account_id is not null
      or new.owner_account_id is null or new.cohort_id is null then
      for v_profile in select fi.id from public.future_person_identity fi join public.embryos e on e.id=fi.embryo_id
        where e.subject_id=new.id and fi.state='current' order by fi.id loop
        perform private.erase_future_person_profile_v1(v_profile,'shredded','api.jobs.retention');
      end loop;
    end if;
  else
    if new.status<>'transferred' or new.future_person_state<>'reserved_for_future_person' then
      for v_profile in select id from public.future_person_identity where embryo_id=new.id and state='current' order by id loop
        perform private.erase_future_person_profile_v1(v_profile,'shredded','api.jobs.retention');
      end loop;
    end if;
  end if;
  return new;
end $$;
revoke all on function private.erase_changed_future_person_profiles_v1()
  from public,anon,authenticated,inherit_upload_only,service_role;
create trigger future_person_profile_subject_end after update on public.subjects
  for each row execute function private.erase_changed_future_person_profiles_v1();
create trigger future_person_profile_embryo_end after update on public.embryos
  for each row execute function private.erase_changed_future_person_profiles_v1();

create function public.purge_due_future_person_profiles_v1() returns integer
language plpgsql security definer set search_path='' as $$
declare i record; n integer:=0;
begin
  for i in select fi.id from public.future_person_identity fi join public.embryos e on e.id=fi.embryo_id
    where fi.profile_format_version=1 and fi.state='current' and fi.fixed_expires_at<=clock_timestamp()
    order by e.subject_id,fi.id limit 100 loop
    if private.erase_future_person_profile_v1(i.id,'shredded','api.jobs.retention') then n:=n+1; end if;
  end loop;
  return n;
end $$;
revoke all on function public.purge_due_future_person_profiles_v1() from public,anon,authenticated,inherit_upload_only;
grant execute on function public.purge_due_future_person_profiles_v1() to service_role;

-- Never retire a still-needed held HMAC root and silently turn a legitimate
-- profile into a no-match. New profile writes retain every held revision.
create function private.guard_profile_match_key_retirement_v1() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if old.keyring='contact' and new.state='retired' and old.state<>'retired' and exists(
    select 1 from public.future_person_identity fi where fi.profile_format_version=1
      and fi.state='current' and fi.fixed_expires_at>clock_timestamp()
      and fi.match_indexes ? old.key_revision::text and not(fi.match_indexes ?
        coalesce(private.hmac_active_revision_v1('contact')::text,'')))
  then raise exception using errcode='55000',message='identity_profile_key_still_required'; end if;
  return new;
end $$;
revoke all on function private.guard_profile_match_key_retirement_v1()
  from public,anon,authenticated,inherit_upload_only,service_role;
create trigger hmac_profile_retirement_hold before update on private.hmac_key_versions
  for each row execute function private.guard_profile_match_key_retirement_v1();
notify pgrst,'reload schema';

-- A Card alone selects the record; optional parent input never gates it.
-- Every age/key/conflict predicate and every other mode remains unchanged.
create or replace function private.resolve_claim_case_v1(p_intake private.future_person_claim_intakes)
returns table (case_kind text, matched_embryo_id uuid, matched_claimant_principal_id uuid)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_embryo uuid;
  v_claimant uuid;
begin
  if p_intake.mode = 'record-key' then
    select h.embryo_id into v_embryo
    from public.future_person_record_key_hashes h
    join public.embryos e on e.id = h.embryo_id
    where h.key_hash = p_intake.key_hash and h.status = 'current'
      and e.status = 'transferred' and e.closing_date_state = 'definitive_transferred_claim_window'
      and e.transferred_at is not null and e.transferred_at + interval '18 years' <= clock_timestamp()
      and not exists (select 1 from private.claim_reviews r where r.matched_embryo_id = e.id
        and private.claim_review_open_v1(r));
    if v_embryo is not null then
      return query select 'record_key'::text, v_embryo, null::uuid;
    else
      return query select 'record_key_unmatched_or_ineligible'::text, null::uuid, null::uuid;
    end if;
  elsif p_intake.mode = 'claimant-recovery-key' then
    select k.claimant_principal_id into v_claimant
    from public.future_person_recovery_key_hashes k
    join public.future_person_claimant_principals c on c.id = k.claimant_principal_id
    where k.recovery_key_hash = p_intake.key_hash and k.status = 'current' and c.status = 'current'
      and not exists (select 1 from private.claim_reviews r where r.matched_claimant_principal_id = c.id
        and private.claim_review_open_v1(r));
    if v_claimant is not null then
      return query select 'claimant_recovery_key'::text, null::uuid, v_claimant;
    else
      return query select 'recovery_key_unmatched_or_ineligible'::text, null::uuid, null::uuid;
    end if;
  else
    return query select 'keyless_none'::text, null::uuid, null::uuid;
  end if;
end;
$$;
revoke all on function private.resolve_claim_case_v1(private.future_person_claim_intakes)
  from public, anon, authenticated, service_role;


-- The current named reviewer can read genuine earlier signing evidence when
-- a Card case has no legacy profile. Never reconstruct a historical name.
alter function private.read_claim_review_case_v1(uuid) rename to read_claim_review_case_before_parent_profiles_v1;
revoke all on function private.read_claim_review_case_before_parent_profiles_v1(uuid)
  from public,anon,authenticated,inherit_upload_only,service_role;
create function private.read_claim_review_case_v1(p_review_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare body jsonb; r private.claim_reviews%rowtype; fi public.future_person_identity%rowtype;
  c public.embryo_cohorts%rowtype; evidence jsonb; v_recipients uuid[];
begin
  -- The predecessor enforces own JWT, current named assignment and recent MFA.
  body:=private.read_claim_review_case_before_parent_profiles_v1(p_review_id);
  if body->>'caseKind'<>'record_key' then return body; end if;
  select * into r from private.claim_reviews where id=p_review_id;
  select * into fi from public.future_person_identity where embryo_id=r.matched_embryo_id and state='current';
  if fi.id is not null and fi.profile_format_version is null then return body; end if;
  select h.* into c from public.embryo_cohorts h join public.embryos e on e.cohort_id=h.id where e.id=r.matched_embryo_id;
  perform private.embryo_ingest_authority_fingerprint_v1(c.id);
  v_recipients:=private.embryo_cohort_set_v1(c.id,'record_key_recipients');
  select jsonb_agg(jsonb_build_object('nameCiphertext',encode(cs.signing_name_encrypted,'hex'),
    'role','genetic-parent') order by cs.signer_principal_id) into evidence
    from public.consent_signatures cs join public.subject_principals sp on sp.id=cs.signer_principal_id
      join public.profiles p on p.id=sp.account_id
      join public.consent_artifacts ca on ca.artifact_key=cs.artifact_key
        and ca.version=cs.artifact_version and ca.body_sha256=cs.artifact_body_sha256
    where cs.target_kind='cohort_draft' and cs.target_id=c.draft_id
      and cs.artifact_key='attestation.embryo-parentage' and cs.signer_principal_id=any(v_recipients)
      and sp.principal_kind='genetic_parent' and sp.status='active'
      and cs.signer_account_id=sp.account_id and cs.jurisdiction_code=p.jurisdiction_code
      and cs.jurisdiction_revision=p.jurisdiction_revision and ca.superseded_at is null
      and cs.statement_keys=private.embryo_statement_keys_v1('attestation.embryo-parentage','parent')
      and octet_length(cs.signing_name_encrypted) between 29 and 2048;
  if evidence is null or jsonb_array_length(evidence) is distinct from cardinality(v_recipients)
    or jsonb_array_length(evidence) not between 1 and 4 then
    raise exception using errcode='42501',message='claim review unavailable'; end if;
  return (body-'parentIdentityCiphertext')||jsonb_build_object('parentIdentityCiphertext',null,
    'recordedParentSigningEvidence',evidence);
end $$;
revoke all on function private.read_claim_review_case_v1(uuid) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function private.read_claim_review_case_v1(uuid) to authenticated;
