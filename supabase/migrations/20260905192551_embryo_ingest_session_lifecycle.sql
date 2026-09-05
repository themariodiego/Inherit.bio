-- Session minting is kept private until the full route/worker/unwind path is
-- wired. TEST-LOCAL is the only supported capability context at this stage.
alter table public.embryo_ingest_sessions
  add column upload_id uuid unique,
  add column account_id uuid references auth.users(id) on delete restrict,
  add column cookie_hash text unique check (cookie_hash ~ '^[0-9a-f]{64}$'),
  add column origin text,
  add column capability_revision bigint check (capability_revision > 0),
  add column authority_fingerprint text check (authority_fingerprint ~ '^[0-9a-f]{64}$'),
  add column transport_challenge text check (transport_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  add column transport_revision bigint check (transport_revision > 0),
  add column reference_build text check (reference_build in ('GRCh37','GRCh38')),
  add column source_format text check (source_format in ('vcf','gvcf','pgt_table'));
alter table public.embryo_fragment_handle_maps add column expires_at timestamptz;
create unique index embryo_ingest_one_attempt_revision
  on public.embryo_ingest_sessions(cohort_id, ingest_revision)
  where ingest_revision is not null;
create index embryo_ingest_account_capacity
  on public.embryo_ingest_sessions(account_id, status);

create function private.embryo_ingest_authority_fingerprint_v1(p_cohort_id uuid)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  c public.embryo_cohorts%rowtype;
  d public.embryo_cohort_drafts%rowtype;
  b public.embryo_basis_bindings%rowtype;
  a record;
  v_kind text;
  v_expected uuid[];
  v_actual uuid[];
  v_parent uuid;
  v_key text;
  v_signature public.consent_signatures%rowtype;
  v_form text;
  v_signatures uuid[];
  v_old_fingerprint text;
  v_data jsonb;
  v_principals jsonb;
  v_sets jsonb;
  v_artifacts jsonb;
  v_reviews jsonb := '[]';
  v_attestations jsonb;
begin
  select * into c from public.embryo_cohorts where id=p_cohort_id for share nowait;
  if not found then raise exception using errcode='42501', message='cohort unavailable'; end if;
  select * into d from public.embryo_cohort_drafts where id=c.draft_id for share nowait;
  select * into b from public.embryo_basis_bindings where cohort_id=c.id for share nowait;
  if d.state is distinct from 'finalized' or b.cohort_id is null
    or d.basis_case is distinct from c.basis_case or b.basis_case is distinct from c.basis_case
    or d.basis_revision is distinct from c.basis_revision or b.basis_revision is distinct from c.basis_revision
    or b.participant_set_revision is distinct from c.participant_set_revision
    or d.uploader_principal_id is null
  then raise exception using errcode='42501', message='cohort unavailable'; end if;
  perform 1 from public.attestation_contradictions
    where cohort_id=c.id and resolved_at is null order by id for share nowait;
  if found then raise exception using errcode='42501', message='cohort unavailable'; end if;
  perform 1 from public.draft_participant_slots where embryo_draft_id=d.id order by id for share nowait;
  select * into a from private.resolve_embryo_basis_authority_v1(d.id);
  perform 1 from public.embryo_participant_sets where cohort_id=c.id order by set_kind,principal_id for share nowait;
  foreach v_kind in array array['required_upload_principals','disposition_authorities',
    'notice_recipients','record_key_recipients','attribution_principals'] loop
    v_expected := case v_kind
      when 'required_upload_principals' then a.required_upload_principals
      when 'disposition_authorities' then a.disposition_authorities
      when 'notice_recipients' then a.notice_recipients
      when 'record_key_recipients' then a.record_key_recipients
      else a.attribution_principals end;
    select coalesce(array_agg(x order by x),'{}'::uuid[]) into v_expected from unnest(v_expected) x;
    select coalesce(array_agg(principal_id order by principal_id),'{}'::uuid[]) into v_actual
      from public.embryo_participant_sets
      where cohort_id=c.id and set_kind=v_kind and revoked_at is null
        and set_revision=c.participant_set_revision;
    if v_actual is distinct from v_expected or exists (
      select 1 from public.embryo_participant_sets where cohort_id=c.id and set_kind=v_kind
        and revoked_at is null and set_revision<>c.participant_set_revision
    ) then raise exception using errcode='42501', message='cohort unavailable'; end if;
  end loop;

  -- Lock every current artifact/signature through the same draft boundary used
  -- by signing, and bind to the frozen finalization matrix as well as its current
  -- versions. No source-file label or derivative participates in this digest.
  perform 1 from public.consent_signatures where target_kind='cohort_draft' and target_id=d.id order by id for share nowait;
  perform 1 from public.consent_artifacts where artifact_key in (
    'consent.upload-embryo','attestation.embryo-parentage','attestation.embryo-disposition-rights',
    'attestation.embryo-single-parent-basis','charter.future-person','disclosure.insurance-and-discrimination'
  ) order by artifact_key,version for share nowait;
  select coalesce(array_agg(id order by id),'{}'::uuid[]) into v_signatures
    from public.consent_signatures where target_kind='cohort_draft' and target_id=d.id;
  v_old_fingerprint := encode(extensions.digest(convert_to(
    concat_ws(':',c.basis_case,c.basis_revision::text,array_to_string(v_signatures,',')), 'UTF8'),'sha256'),'hex');
  if v_old_fingerprint<>b.artifact_matrix_fingerprint then
    raise exception using errcode='42501', message='cohort unavailable';
  end if;

  foreach v_parent in array a.required_upload_principals || array[d.uploader_principal_id] loop
    perform 1 from public.subject_principals sp join public.profiles p on p.id=sp.account_id
      join auth.users u on u.id=p.id
      where sp.id=v_parent and sp.status='active' and u.deleted_at is null
        and (u.banned_until is null or u.banned_until<=clock_timestamp())
        and p.deletion_requested_at is null
      for share of sp,p,u nowait;
    if not found then raise exception using errcode='42501', message='cohort unavailable'; end if;
  end loop;

  foreach v_parent in array a.required_upload_principals || array[d.uploader_principal_id] loop
    foreach v_key in array array['consent.upload-embryo','attestation.embryo-parentage',
      'attestation.embryo-disposition-rights','attestation.embryo-single-parent-basis',
      'charter.future-person','disclosure.insurance-and-discrimination'] loop
      if v_key in ('charter.future-person','disclosure.insurance-and-discrimination') and v_parent<>d.uploader_principal_id then continue; end if;
      if v_key like 'attestation.%' and not (v_parent=any(a.required_upload_principals)) then continue; end if;
      if v_key='consent.upload-embryo' and c.upload_class='embryo_own'
        and not (v_parent=any(a.required_upload_principals)) then continue; end if;
      if v_key='attestation.embryo-single-parent-basis' and c.basis_case='true_two_parent' then continue; end if;
      v_form := case when v_parent=d.uploader_principal_id and c.upload_class='embryo_third_party'
        then 'uploader' else 'parent' end;
      select cs.* into v_signature from public.consent_signatures cs
        join public.consent_artifacts ca on ca.artifact_key=cs.artifact_key and ca.version=cs.artifact_version
        join public.subject_principals sp on sp.id=cs.signer_principal_id
        join public.profiles p on p.id=sp.account_id
        where cs.target_kind='cohort_draft' and cs.target_id=d.id
          and cs.signer_principal_id=v_parent and cs.artifact_key=v_key
          and ca.superseded_at is null and ca.body_sha256=cs.artifact_body_sha256
          and cs.signer_account_id=sp.account_id and cs.jurisdiction_code=p.jurisdiction_code
          and cs.jurisdiction_revision=p.jurisdiction_revision
          and cs.statement_keys=private.embryo_statement_keys_v1(v_key,v_form)
          and (v_key<>'consent.upload-embryo' or cs.purpose=case v_form
            when 'uploader' then 'embryo-upload-uploader-class' else 'embryo-upload-parent-class' end);
      if not found then raise exception using errcode='42501', message='cohort unavailable'; end if;
      if v_key like 'attestation.%' or v_key='charter.future-person' then
        perform 1 from public.attestations at where at.signature_id=v_signature.id
          and at.principal_id=v_parent and at.target_kind='cohort_draft' and at.target_id=d.id
          and at.statement_keys=v_signature.statement_keys and at.affirmed
          and at.kind=case v_key when 'attestation.embryo-parentage' then 'genetic_parent'
            when 'attestation.embryo-disposition-rights' then 'disposition_rights'
            when 'attestation.embryo-single-parent-basis' then 'single_parent_authority'
            else 'future_person_acknowledgement' end for share nowait;
        if not found then raise exception using errcode='42501', message='cohort unavailable'; end if;
      end if;
    end loop;
  end loop;

  if c.basis_case='true_two_parent' and exists (
    select 1 from public.consent_signatures where target_kind='cohort_draft' and target_id=d.id
      and artifact_key='attestation.embryo-single-parent-basis'
  ) then raise exception using errcode='42501', message='cohort unavailable'; end if;
  if c.basis_case<>'true_two_parent' and (
    select count(*) from public.consent_signatures where target_kind='cohort_draft' and target_id=d.id
      and artifact_key='attestation.embryo-single-parent-basis'
      and signer_principal_id=a.required_upload_principals[1]
  )<>1 then raise exception using errcode='42501', message='cohort unavailable'; end if;
  if c.basis_case in ('parent_deceased','sole_legal_authority') then
    select jsonb_build_array(lr.id,lr.review_revision,re.id,re.evidence_revision,re.evidence_sha256)
      into v_reviews from public.legal_reviews lr join public.reviewed_evidence re on re.review_id=lr.id
      where lr.id=b.legal_review_id and re.id=b.reviewed_evidence_id
        and lr.target_kind='single_parent_basis' and lr.target_id=d.id and lr.decision='approved'
        and re.purged_at is null and re.evidence_kind=case c.basis_case
          when 'parent_deceased' then 'parent-death-certificate' else 'sole-disposition-authority' end
        and not exists (select 1 from public.legal_reviews newer where newer.target_kind=lr.target_kind
          and newer.target_id=lr.target_id and newer.review_revision>lr.review_revision)
      for share of lr,re nowait;
    if not found then raise exception using errcode='42501', message='cohort unavailable'; end if;
  end if;
  perform 1 from public.embryo_donor_attributions where cohort_id=c.id order by id for share nowait;
  if c.basis_case='anonymous_donor' then
    if (select count(*) from public.embryo_donor_attributions where cohort_id=c.id and revoked_at is null
      and classification='anonymous' and donor_principal_id is null and signature_id is null
      and attribution_revision=c.donor_attribution_revision)<>1 then
      raise exception using errcode='42501', message='cohort unavailable';
    end if;
  elsif exists (select 1 from public.embryo_donor_attributions where cohort_id=c.id and revoked_at is null)
    or c.basis_case='identified_donor_consented' then
    -- The existing cohort resolver has no identified-donor implementation.
    -- Never turn that missing authority into parent authority.
    raise exception using errcode='42501', message='cohort unavailable';
  end if;

  select jsonb_agg(jsonb_build_array(sp.id,sp.principal_revision,p.id,p.account_revision,
      p.jurisdiction_code,p.jurisdiction_revision) order by sp.id) into v_principals
    from public.subject_principals sp join public.profiles p on p.id=sp.account_id
    where sp.id=any(a.required_upload_principals || array[d.uploader_principal_id]);
  select jsonb_agg(jsonb_build_array(set_kind,principal_id,set_revision,membership_revision)
      order by set_kind,principal_id) into v_sets
    from public.embryo_participant_sets where cohort_id=c.id and revoked_at is null;
  select jsonb_agg(jsonb_build_array(cs.id,cs.artifact_key,cs.artifact_version,cs.artifact_body_sha256,
      cs.signer_principal_id,cs.jurisdiction_revision) order by cs.id) into v_artifacts
    from public.consent_signatures cs where cs.target_kind='cohort_draft' and cs.target_id=d.id;
  select jsonb_agg(jsonb_build_array(at.id,at.signature_id,at.principal_id,at.kind,
      at.statement_keys,at.attestation_revision) order by at.id) into v_attestations
    from public.attestations at where at.target_kind='cohort_draft' and at.target_id=d.id;
  v_data:=jsonb_build_array(c.id,c.basis_case,c.basis_revision,c.participant_set_revision,
    c.donor_attribution_revision,c.recipient_set_revision,c.lifecycle_revision,c.ingest_revision,
    v_principals,v_sets,v_artifacts,v_reviews,v_attestations);
  return encode(extensions.digest(convert_to(v_data::text,'UTF8'),'sha256'),'hex');
end;
$$;

create function private.create_embryo_ingest_session_v1(
  p_account_id uuid,p_auth_session_id uuid,p_cohort_id uuid,p_origin text,
  p_capacity_bytes bigint default 200000000,p_test_jurisdiction boolean default false
) returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '250ms'
as $$
declare
  c public.embryo_cohorts%rowtype;
  p public.profiles%rowtype;
  v_now timestamptz:=clock_timestamp();
  v_session uuid:=gen_random_uuid();
  v_upload uuid:=gen_random_uuid();
  v_retention uuid;
  v_deadline timestamptz;
  v_cookie text;
  v_challenge text;
  v_handle text;
  v_handles jsonb:='[]';
  v_fingerprint text;
  v_ordinal integer;
begin
  if p_test_jurisdiction is distinct from true then
    raise exception using errcode='42501',message='jurisdiction unavailable';
  end if;
  if p_capacity_bytes is null or p_capacity_bytes not between 1 and 200000000
    or p_origin is null or length(p_origin)>255
    or p_origin !~ '^https?://[a-zA-Z0-9.-]+(:[0-9]{1,5})?$'
  then raise exception using errcode='22023',message='invalid session request'; end if;
  -- This account lock serializes capacity allocation across both cohorts.
  select * into p from public.profiles where id=p_account_id for update nowait;
  if not found or p.deletion_requested_at is not null or p.non_self_upload_suspended_at is not null then
    raise exception using errcode='42501',message='account unavailable';
  end if;
  perform 1 from auth.sessions where id=p_auth_session_id and user_id=p_account_id for update nowait;
  perform private.validate_sensitive_account_session_v1(p_account_id,p_auth_session_id);
  select * into c from public.embryo_cohorts where id=p_cohort_id for update nowait;
  if not found or c.owner_account_id<>p_account_id or c.status<>'upload_pending'
    or c.publication_revision is not null then
    raise exception using errcode='42501',message='cohort unavailable';
  end if;
  if exists (select 1 from public.embryo_ingest_sessions where cohort_id=c.id) then
    raise exception using errcode='55000',message='ingest attempt already exists';
  end if;
  -- Failure-pending and expired attempts continue to occupy their reservation
  -- until the identical unwind commits. Expiry never creates a fresh deadline.
  if (select count(*) from public.embryo_ingest_sessions s
      join public.embryo_cohorts owner on owner.id=s.cohort_id
      where owner.owner_account_id=p_account_id and s.status<>'published')>=2 then
    raise exception using errcode='54000',message='ingest capacity unavailable';
  end if;
  v_fingerprint:=private.embryo_ingest_authority_fingerprint_v1(c.id);
  if (select count(*) from public.embryos e join public.subjects s on s.id=e.subject_id
      where e.cohort_id=c.id and s.cohort_id=c.id and s.lifecycle='quarantined'
        and s.owner_account_id=p_account_id and s.subject_class='embryo'
        and s.upload_class=c.upload_class and e.status='pending'
        and e.sample_ordinal between 0 and c.embryo_count-1)<>c.embryo_count then
    raise exception using errcode='42501',message='cohort unavailable';
  end if;
  v_cookie:=rtrim(translate(encode(extensions.gen_random_bytes(32),'base64'),'+/','-_'),'=');
  v_challenge:=rtrim(translate(encode(extensions.gen_random_bytes(32),'base64'),'+/','-_'),'=');
  v_deadline:=v_now+interval '24 hours';
  insert into public.embryo_ingest_sessions (
    id,upload_id,account_id,cohort_id,originating_session_id,uploader_principal_id,
    basis_case,basis_revision,participant_set_revision,donor_attribution_revision,
    source_binding_fingerprint,account_auth_session_revision,account_revision,
    ingest_revision,cohort_lifecycle_revision,declared_capacity_bytes,
    cookie_hash,origin,capability_revision,authority_fingerprint,transport_challenge,
    transport_revision,created_at,expires_at
  ) select v_session,v_upload,p_account_id,c.id,p_auth_session_id,d.uploader_principal_id,
    c.basis_case,c.basis_revision,c.participant_set_revision,c.donor_attribution_revision,
    v_fingerprint,p.auth_session_revision,p.account_revision,c.ingest_revision,
    c.lifecycle_revision,p_capacity_bytes,encode(extensions.digest(convert_to(v_cookie,'UTF8'),'sha256'),'hex'),
    p_origin,1,v_fingerprint,v_challenge,1,v_now,v_deadline
    from public.embryo_cohort_drafts d where d.id=c.draft_id;
  for v_ordinal in 0..c.embryo_count-1 loop
    v_handle:=rtrim(translate(encode(extensions.gen_random_bytes(32),'base64'),'+/','-_'),'=');
    insert into public.embryo_fragment_handle_maps(session_id,sample_ordinal,handle_hash,expires_at)
      values(v_session,v_ordinal,encode(extensions.digest(convert_to(v_handle,'UTF8'),'sha256'),'hex'),v_deadline);
    v_handles:=v_handles||jsonb_build_object('ordinal',v_ordinal,'handle',v_handle);
  end loop;
  insert into public.retention_rows (
    retention_id,target_kind,target_id,retention_revision,target_lifecycle_revision,
    disposition_revision,fixed_deadline,created_at
  ) values ('embryo.ingest-session-24h','ingest_session',v_session,c.ingest_revision,
    c.lifecycle_revision,1,v_deadline,v_now) returning id into v_retention;
  insert into public.retention_due_phases (
    retention_row_id,retention_id,phase_id,phase_kind,phase_revision,phase_deadline,
    target_kind,target_id,target_lifecycle_revision,disposition_revision,
    recipient_authority_kind,recipient_authority_revision,immutable_envelope
  ) values(v_retention,'embryo.ingest-session-24h','ingest-abandoned-no-source',
    'ingest-abandoned-no-source',c.ingest_revision,v_deadline,'ingest_session',v_session,
    c.lifecycle_revision,1,'record-key-recipients',c.recipient_set_revision,
    jsonb_build_object('cohortId',c.id,'ingestRevision',c.ingest_revision));
  return jsonb_build_object('session',v_session,'uploadId',v_upload,'cookieValue',v_cookie,
    'challenge',v_challenge,'revision',1,'sampleHandles',v_handles,'expiresAt',v_deadline);
end;
$$;

create function private.freeze_embryo_ingest_session_v1()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if row(new.id,new.upload_id,new.account_id,new.cohort_id,new.originating_session_id,
    new.account_auth_session_revision,new.account_revision,new.ingest_revision,
    new.cohort_lifecycle_revision,new.created_at,new.expires_at,new.origin,new.cookie_hash,
    new.authority_fingerprint,new.declared_capacity_bytes,new.uploader_principal_id,
    new.basis_case,new.basis_revision,new.participant_set_revision,new.donor_attribution_revision,
    new.source_binding_fingerprint,new.capability_revision)
    is distinct from row(old.id,old.upload_id,old.account_id,old.cohort_id,old.originating_session_id,
    old.account_auth_session_revision,old.account_revision,old.ingest_revision,
    old.cohort_lifecycle_revision,old.created_at,old.expires_at,old.origin,old.cookie_hash,
    old.authority_fingerprint,old.declared_capacity_bytes,old.uploader_principal_id,
    old.basis_case,old.basis_revision,old.participant_set_revision,old.donor_attribution_revision,
    old.source_binding_fingerprint,old.capability_revision)
  then raise exception using errcode='55000',message='immutable ingest binding'; end if;
  return new;
end;
$$;
create trigger embryo_ingest_session_immutable
before update on public.embryo_ingest_sessions
for each row when (old.upload_id is not null)
execute function private.freeze_embryo_ingest_session_v1();

revoke all on function private.embryo_ingest_authority_fingerprint_v1(uuid),
  private.create_embryo_ingest_session_v1(uuid,uuid,uuid,text,bigint,boolean),
  private.freeze_embryo_ingest_session_v1() from public,anon,authenticated;
grant execute on function private.embryo_ingest_authority_fingerprint_v1(uuid),
  private.create_embryo_ingest_session_v1(uuid,uuid,uuid,text,bigint,boolean)
  to service_role;

-- The eventual cohort-finalize route calls this one transaction. If minting
-- fails, the draft consumption, cohort, provisional cards and nonce all roll back.
create function private.finalize_embryo_cohort_ingest_v1(
  p_account_id uuid,p_auth_session_id uuid,p_draft_id uuid,p_insurance_ack_id uuid,
  p_charter_ack_id uuid,p_token_nonce text,p_origin text,p_test_jurisdiction boolean default false
) returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '250ms'
as $$
declare f record; v_ingest jsonb;
begin
  if p_test_jurisdiction is distinct from true then
    raise exception using errcode='42501',message='jurisdiction unavailable';
  end if;
  perform 1 from public.profiles where id=p_account_id for update nowait;
  perform 1 from auth.sessions where id=p_auth_session_id and user_id=p_account_id for update nowait;
  perform private.validate_sensitive_account_session_v1(p_account_id,p_auth_session_id);
  perform 1 from public.embryo_cohort_drafts where id=p_draft_id for update nowait;
  select * into f from public.finalize_embryo_cohort_v1(p_account_id,p_auth_session_id,
    p_draft_id,p_insurance_ack_id,p_charter_ack_id,p_token_nonce);
  v_ingest:=private.create_embryo_ingest_session_v1(
    p_account_id,p_auth_session_id,f.cohort_id,p_origin,200000000,p_test_jurisdiction);
  return jsonb_build_object('cohort',to_jsonb(f),'ingest',v_ingest);
end;
$$;
revoke all on function private.finalize_embryo_cohort_ingest_v1(uuid,uuid,uuid,uuid,uuid,text,text,boolean)
  from public,anon,authenticated;
grant execute on function private.finalize_embryo_cohort_ingest_v1(uuid,uuid,uuid,uuid,uuid,text,text,boolean)
  to service_role;

-- Contention is a retriable transaction failure (55P03), never a durable
-- authorization failure. Explicit NOWAIT checks avoid lock-order cycles; the
-- mint/wrapper's local 250ms lock timeout bounds legacy and implicit FK waits.
-- Retrying keeps the same operation nonce/sequence: rollback consumed neither.
-- This is not a global lock-order protocol or permission to extend expiry.

-- Every chunk reservation and acknowledgement rechecks the exact authority
-- captured at minting. Legacy synthetic reservations retain their base checks.
create or replace function private.embryo_ingest_binding_failure_v1(p_session_id uuid)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_session public.embryo_ingest_sessions%rowtype;
  v_cohort public.embryo_cohorts%rowtype;
begin
  select * into v_session from public.embryo_ingest_sessions where id = p_session_id;
  if not found then return 'stale-binding'; end if;
  if v_session.expires_at <= clock_timestamp() then return 'expiry'; end if;
  select * into v_cohort from public.embryo_cohorts where id = v_session.cohort_id for share nowait;
  if not found or v_cohort.publication_revision is not null
    or v_cohort.status not in ('upload_pending', 'ingesting')
    or v_session.ingest_revision is distinct from v_cohort.ingest_revision
    or v_session.cohort_lifecycle_revision is distinct from v_cohort.lifecycle_revision
    or v_session.basis_case is distinct from v_cohort.basis_case
    or v_session.basis_revision is distinct from v_cohort.basis_revision
    or v_session.participant_set_revision is distinct from v_cohort.participant_set_revision
    or v_session.donor_attribution_revision is distinct from v_cohort.donor_attribution_revision
  then return 'stale-binding'; end if;
  perform 1 from auth.sessions s
      join auth.users u on u.id = s.user_id
      join public.profiles p on p.id = u.id
      join public.subject_principals principal on principal.id = v_session.uploader_principal_id
    where s.id = v_session.originating_session_id and s.user_id = v_cohort.owner_account_id
      and (s.not_after is null or s.not_after > clock_timestamp())
      and u.deleted_at is null and (u.banned_until is null or u.banned_until <= clock_timestamp())
      and principal.account_id = u.id and principal.status = 'active'
      and p.auth_session_revision = v_session.account_auth_session_revision
      and p.account_revision = v_session.account_revision
      and p.deletion_requested_at is null and p.non_self_upload_suspended_at is null
      and (s.aal = 'aal2' or not exists (
        select 1 from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified'
      ))
    for share of s, u, p, principal nowait;
  if not found then return 'authenticated-session-revocation'; end if;
  -- The exact, still-live due pair must survive all nonterminal work.
  perform 1 from public.retention_rows r
      join public.retention_due_phases d on d.retention_row_id = r.id
    where r.retention_id = 'embryo.ingest-session-24h'
      and r.target_kind = 'ingest_session' and r.target_id = v_session.id
      and r.retention_revision = v_session.ingest_revision
      and r.target_lifecycle_revision = v_session.cohort_lifecycle_revision
      and r.fixed_deadline = v_session.expires_at and r.state in ('scheduled', 'active')
      and d.phase_id = 'ingest-abandoned-no-source'
      and d.retention_id = r.retention_id
      and d.phase_kind = 'ingest-abandoned-no-source'
      and d.phase_revision = v_session.ingest_revision
      and d.target_kind = r.target_kind and d.target_id = r.target_id
      and d.phase_deadline = r.fixed_deadline
      and d.target_lifecycle_revision = r.target_lifecycle_revision
      and d.immutable_envelope = jsonb_build_object(
        'cohortId', v_session.cohort_id, 'ingestRevision', v_session.ingest_revision)
      and d.status in ('pending', 'retry')
      and (v_session.upload_id is null or (
        r.disposition_revision=1 and d.disposition_revision=1
        and d.recipient_authority_kind='record-key-recipients'
        and d.recipient_authority_revision=v_cohort.recipient_set_revision
      ))
    for share of r, d nowait;
  if not found then return 'stale-binding'; end if;
  if v_session.upload_id is not null then
    begin
      if v_session.account_id is distinct from v_cohort.owner_account_id
        or v_session.authority_fingerprint is distinct from
          private.embryo_ingest_authority_fingerprint_v1(v_cohort.id)
      then return 'stale-binding'; end if;
    exception
      -- 55000 is also a category handler and includes 55P03. Contention must
      -- escape before that broad authorization-state fallback.
      when lock_not_available or deadlock_detected then raise;
      when insufficient_privilege or object_not_in_prerequisite_state then
        return 'stale-binding';
    end;
  end if;
  return null;
end;
$$;
