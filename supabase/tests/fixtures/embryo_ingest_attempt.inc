-- Shared by embryo_ingest_chunks.sql and embryo_ingest_write_fence.sql.
-- Include it inside the test transaction; everything it creates rolls back.
\ir invitation_quota_keys.inc

-- `claim_mail_outbox` takes the oldest deliverable row, so a developer
-- database holding other queued mail would hand this suite someone else's
-- token. Retiring those rows inside the test transaction makes every claim
-- below deterministic wherever the suite runs; the rollback puts them back.
update public.mail_outbox set state='invalidated' where state in ('queued','claimed');

-- Each primitive fixture now traverses the real signed two-parent authority
-- flow. Distinct accounts avoid bypassing the per-account outstanding-attempt
-- cap. The outer transaction rolls everything back.
create function pg_temp.new_attempt(p_capacity bigint default 200000000, p_legacy boolean default false)
returns uuid language plpgsql as $$
declare
  v_owner uuid:=gen_random_uuid(); v_parent uuid:=gen_random_uuid();
  v_auth uuid:=gen_random_uuid(); v_parent_auth uuid:=gen_random_uuid();
  v_owner_hash text; v_parent_hash text; v_rights_hash text;
  v_draft uuid; v_cohort uuid; v_session uuid;
  v_invitation uuid; v_mail record; v_token_hash text; v_key text;
  v_insurance uuid; v_charter uuid; v_minted jsonb; v_tries integer:=0;
  v_retention uuid;
  v_deadline timestamptz := clock_timestamp() + interval '24 hours';
begin
  insert into auth.users(id,email) values
    (v_owner,v_owner::text||'@chunk-owner.invalid'),(v_parent,v_parent::text||'@chunk-parent.invalid');
  insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
    (v_auth,v_owner,clock_timestamp(),clock_timestamp(),'aal1'),
    (v_parent_auth,v_parent,clock_timestamp(),clock_timestamp(),'aal1');
  -- A code now needs a declaration record; declare through the one writer.
  perform public.declare_jurisdiction_v1(v_owner,v_auth,'GB',
    (select version from public.consent_artifacts where artifact_key='attestation.jurisdiction' and superseded_at is null),
    (select body_sha256 from public.consent_artifacts where artifact_key='attestation.jurisdiction' and superseded_at is null),false);
  perform public.declare_jurisdiction_v1(v_parent,v_parent_auth,'GB',
    (select version from public.consent_artifacts where artifact_key='attestation.jurisdiction' and superseded_at is null),
    (select body_sha256 from public.consent_artifacts where artifact_key='attestation.jurisdiction' and superseded_at is null),false);
  v_owner_hash:=encode(extensions.digest(v_owner::text,'sha256'),'hex');
  v_parent_hash:=encode(extensions.digest(v_parent::text,'sha256'),'hex');
  v_rights_hash:=encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex');
  select draft_id into v_draft from public.create_embryo_cohort_draft_v1(
    v_owner,v_auth,'own_embryos','true_two_parent',2,
    decode('00112233445566778899aabbccddeeff','hex'),v_owner_hash,
    array['ffeeddccbbaa99887766554433221100'],array[v_parent_hash],gen_random_uuid()::text,true);
  foreach v_key in array array['consent.upload-embryo','attestation.embryo-parentage','attestation.embryo-disposition-rights'] loop
    perform public.sign_embryo_artifact_v1(v_owner,v_auth,'cohort_draft',v_draft,v_key,1,
      private.embryo_statement_keys_v1(v_key,'parent'),decode('deadbeef','hex'),'GB',gen_random_uuid()::text);
  end loop;
  select invitation_id into v_invitation from public.create_embryo_draft_invitation_v1(
    v_owner,v_auth,v_draft,v_parent_hash,v_rights_hash,gen_random_uuid()::text,true,
    p_quota_keys => pg_temp.invitation_quota_keys());
  -- Prior fixture notices may precede this invitation. Claim only bounded
  -- fixture work and verify the exact invitation before using its token.
  loop
    v_tries:=v_tries+1;
    if v_tries>10 then raise exception 'fixture invitation not claimable'; end if;
    select * into v_mail from public.claim_mail_outbox();
    if not found then raise exception 'fixture invitation not claimable'; end if;
    exit when exists(select 1 from public.mail_outbox where id=v_mail.outbox_id and target_id=v_invitation);
  end loop;
  v_token_hash:=encode(extensions.digest(convert_to(v_mail.delivery_token,'UTF8'),'sha256'),'hex');
  perform public.activate_rights_session_v1(v_token_hash,v_rights_hash,gen_random_uuid()::text);
  perform public.accept_embryo_co_parent_invitation_v1(v_rights_hash,v_parent,v_parent_hash,
    decode('deadbeef','hex'),'GB',private.embryo_statement_keys_v1('consent.upload-embryo','parent'),
    private.embryo_statement_keys_v1('attestation.embryo-parentage'),gen_random_uuid()::text);
  perform public.sign_embryo_artifact_v1(v_parent,v_parent_auth,'cohort_draft',v_draft,
    'attestation.embryo-disposition-rights',1,private.embryo_statement_keys_v1('attestation.embryo-disposition-rights'),
    decode('deadbeef','hex'),'GB',gen_random_uuid()::text);
  v_insurance:=public.sign_embryo_artifact_v1(v_owner,v_auth,'cohort_draft',v_draft,
    'disclosure.insurance-and-discrimination',1,private.embryo_statement_keys_v1('disclosure.insurance-and-discrimination'),
    decode('deadbeef','hex'),'GB',gen_random_uuid()::text);
  v_charter:=public.sign_embryo_artifact_v1(v_owner,v_auth,'cohort_draft',v_draft,
    'charter.future-person',1,private.embryo_statement_keys_v1('charter.future-person'),
    decode('deadbeef','hex'),'GB',gen_random_uuid()::text);
  select cohort_id into v_cohort from public.finalize_embryo_cohort_v1(
    v_owner,v_auth,v_draft,v_insurance,v_charter,gen_random_uuid()::text);
  if not p_legacy then
    v_minted:=private.create_embryo_ingest_session_v1(v_owner,v_auth,v_cohort,'http://localhost:3000',p_capacity,true);
    v_session:=(v_minted->>'session')::uuid;
    -- Synthetic format metadata is explicit fixture setup, not an upload or
    -- a claim that the unfinished mapping/build decision route is available.
    update public.embryo_ingest_sessions set source_format='vcf',reference_build='GRCh38' where id=v_session;
    return v_session;
  end if;
  -- The legacy-null-revision regression starts legacy-shaped. Never mutate
  -- an immutable credential on a newly minted session to make this case.
  v_session:=gen_random_uuid();
  insert into public.embryo_ingest_sessions (
    id, cohort_id, originating_session_id, uploader_principal_id, basis_case,
    basis_revision, participant_set_revision, donor_attribution_revision,
    source_binding_fingerprint, expires_at, account_auth_session_revision,
    account_revision, ingest_revision, cohort_lifecycle_revision, declared_capacity_bytes
  ) select v_session,v_cohort,v_auth,uploader_principal_id,'true_two_parent',1,1,1,
    repeat('a',64),v_deadline,null,1,1,1,p_capacity from public.embryo_cohort_drafts where id=v_draft;
  insert into public.retention_rows (
    retention_id, target_kind, target_id, retention_revision,
    target_lifecycle_revision, disposition_revision, fixed_deadline
  ) values ('embryo.ingest-session-24h', 'ingest_session', v_session, 1, 1, 1, v_deadline)
    returning id into v_retention;
  insert into public.retention_due_phases (
    retention_row_id, retention_id, phase_id, phase_kind, phase_revision,
    phase_deadline, target_kind, target_id, target_lifecycle_revision,
    disposition_revision, recipient_authority_kind, recipient_authority_revision,
    immutable_envelope
  ) values (v_retention, 'embryo.ingest-session-24h', 'ingest-abandoned-no-source',
    'ingest-abandoned-no-source', 1, v_deadline, 'ingest_session', v_session,
    1, 1, 'record-key-recipients', 1, jsonb_build_object('cohortId', v_cohort, 'ingestRevision', 1));
  return v_session;
end;
$$;

-- Writes every reserved fragment object of one chunk the way Storage's final
-- write does: an INSERT with a UUID-v4 version and metadata.size. Call it with
-- the service-role claims and role set. Metadata rows only; a database test
-- has no provider bytes.
create function pg_temp.write_fragment_objects(p_session uuid, p_sequence integer)
returns integer language sql as $$
  with written as (
    insert into storage.objects(bucket_id,name,version,metadata)
    select f.bucket_id,f.object_name,gen_random_uuid()::text,jsonb_build_object('size',f.byte_count)
      from public.embryo_ingest_fragments f
      where f.session_id=p_session and f.sequence=p_sequence
    returning 1)
  select count(*)::integer from written;
$$;
