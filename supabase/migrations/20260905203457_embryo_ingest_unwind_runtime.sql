-- Exact ingest object ownership and independent terminal delivery. None of
-- these primitives proves an external writer has drained: finalization must
-- remain unavailable until the Storage deletion fence is verified.
do $$ begin
  if exists (select 1 from public.embryo_ingest_fragments) then
    raise exception using errcode='55000', message='unbound ingest objects require explicit review';
  end if;
end $$;
alter table public.embryo_ingest_fragments
  add column bucket_id text not null check (bucket_id='genomes'),
  add column object_name text not null unique;

create function private.bind_embryo_fragment_object_v1()
returns trigger language plpgsql security definer set search_path=''
as $$
declare s public.embryo_ingest_sessions%rowtype; v_suffix text;
begin
  if tg_op='UPDATE' then
    if new is distinct from old then
      raise exception using errcode='55000', message='immutable ingest object';
    end if;
    return new;
  end if;
  select * into strict s from public.embryo_ingest_sessions where id=new.session_id for update;
  v_suffix:=case s.source_format when 'vcf' then '.vcf' when 'gvcf' then '.vcf' when 'pgt_table' then '.tsv' end;
  if s.status<>'open' or s.account_id is null or s.upload_id is null
    or v_suffix is null or s.reference_build is null then
    raise exception using errcode='55000',message='ingest object binding unavailable';
  end if;
  if new.bucket_id is not null or new.object_name is not null then
    raise exception using errcode='22023',message='client object path forbidden';
  end if;
  new.bucket_id:='genomes';
  new.object_name:=s.account_id::text||'/'||s.cohort_id::text||'/'||s.upload_id::text||'/'||new.object_id::text||v_suffix;
  return new;
end $$;
create trigger embryo_fragment_object_binding before insert or update on public.embryo_ingest_fragments
  for each row execute function private.bind_embryo_fragment_object_v1();
revoke all on function private.bind_embryo_fragment_object_v1() from public,anon,authenticated;

-- The terminal envelope has no account, principal, subject, cohort or contact
-- FK. Its recipient pseudonym is random, not an address hash or product role.
-- User-approved 2026-09-05: maximum 24h after confirmed file cleanup, earlier
-- deletion on accepted submission. No retry can renew this fixed deadline.
create table public.embryo_terminal_mail (
  id uuid primary key default gen_random_uuid(),
  unwind_id uuid not null,
  recipient_pseudonym uuid not null,
  recipient_ciphertext bytea,
  cleanup_confirmed_at timestamptz not null,
  expires_at timestamptz not null,
  state text not null default 'queued' check(state in ('queued','claimed','accepted','expired','delivery_unavailable')),
  attempt_count integer not null default 0 check(attempt_count between 0 and 10),
  claim_token uuid,
  claim_expires_at timestamptz,
  next_attempt_at timestamptz not null default clock_timestamp(),
  accepted_at timestamptz,
  provider_message_hmac text check(provider_message_hmac ~ '^[0-9a-f]{64}$'),
  unique(unwind_id,recipient_pseudonym),
  check(expires_at=cleanup_confirmed_at+interval '24 hours'),
  check((state in ('accepted','expired','delivery_unavailable'))=(recipient_ciphertext is null)),
  check((state='claimed')=(claim_token is not null and claim_expires_at is not null)),
  check((state='accepted')=(accepted_at is not null))
);
alter table public.embryo_terminal_mail enable row level security;
revoke all on public.embryo_terminal_mail from public,anon,authenticated;
grant select,insert,update,delete on public.embryo_terminal_mail to service_role;
create index embryo_terminal_mail_due on public.embryo_terminal_mail(next_attempt_at)
  where state in ('queued','claimed');

create function private.freeze_embryo_terminal_mail_v1()
returns trigger language plpgsql set search_path='' as $$ begin
  if (new.id,new.unwind_id,new.recipient_pseudonym,new.cleanup_confirmed_at,new.expires_at)
    is distinct from (old.id,old.unwind_id,old.recipient_pseudonym,old.cleanup_confirmed_at,old.expires_at)
    or (new.recipient_ciphertext is not null and new.recipient_ciphertext is distinct from old.recipient_ciphertext)
    or (old.state in ('accepted','expired','delivery_unavailable') and new is distinct from old) then
    raise exception using errcode='55000',message='immutable terminal notice authority';
  end if;
  return new;
end $$;
create trigger embryo_terminal_mail_authority before update on public.embryo_terminal_mail
  for each row execute function private.freeze_embryo_terminal_mail_v1();
revoke all on function private.freeze_embryo_terminal_mail_v1() from public,anon,authenticated;

create function public.expire_embryo_terminal_mail_v1()
returns integer language plpgsql security definer set search_path=''
as $$ declare n integer; begin
  update public.embryo_terminal_mail set state='expired',recipient_ciphertext=null,
    claim_token=null,claim_expires_at=null
    where expires_at<=clock_timestamp() and recipient_ciphertext is not null;
  get diagnostics n=row_count;
  return n;
end $$;

create function public.claim_embryo_terminal_mail_v1()
returns table(notice_id uuid,claim_token uuid,contact_ciphertext text,idempotency_key text)
language plpgsql security definer set search_path='' set lock_timeout='250ms'
as $$ declare m public.embryo_terminal_mail%rowtype; v_now timestamptz:=clock_timestamp();
begin
  perform public.expire_embryo_terminal_mail_v1();
  select * into m from public.embryo_terminal_mail t
    where t.expires_at>v_now and t.attempt_count<10
      and ((t.state='queued' and t.next_attempt_at<=v_now)
        or (t.state='claimed' and t.claim_expires_at<=v_now))
    order by t.cleanup_confirmed_at,t.id for update skip locked limit 1;
  if not found then return; end if;
  update public.embryo_terminal_mail t set state='claimed',attempt_count=t.attempt_count+1,
    claim_token=gen_random_uuid(),claim_expires_at=least(t.expires_at,v_now+interval '5 minutes')
    where t.id=m.id returning t.* into m;
  return query select m.id,m.claim_token,encode(m.recipient_ciphertext,'hex'),
    'embryo-terminal-'||m.id::text;
end $$;

create function public.complete_embryo_terminal_mail_v1(
  p_notice_id uuid,p_claim_token uuid,p_accepted boolean,p_provider_message_hmac text
) returns boolean language plpgsql security definer set search_path='' set lock_timeout='250ms'
as $$ declare m public.embryo_terminal_mail%rowtype; v_now timestamptz:=clock_timestamp();
begin
  select * into m from public.embryo_terminal_mail where id=p_notice_id for update;
  if not found or m.state<>'claimed' or m.claim_token is distinct from p_claim_token then return false; end if;
  if m.expires_at<=v_now then
    update public.embryo_terminal_mail set state='expired',recipient_ciphertext=null,
      claim_token=null,claim_expires_at=null where id=m.id;
    return false;
  end if;
  if p_accepted is true then
    if p_provider_message_hmac is null or p_provider_message_hmac !~ '^[0-9a-f]{64}$' then
      raise exception using errcode='22023',message='invalid terminal mail receipt';
    end if;
    update public.embryo_terminal_mail set state='accepted',recipient_ciphertext=null,
      accepted_at=v_now,provider_message_hmac=p_provider_message_hmac,
      claim_token=null,claim_expires_at=null where id=m.id;
  else
    update public.embryo_terminal_mail set state='queued',claim_token=null,claim_expires_at=null,
      next_attempt_at=least(expires_at,v_now+interval '5 minutes') where id=m.id;
  end if;
  return true;
end $$;
revoke all on function public.expire_embryo_terminal_mail_v1(),
  public.claim_embryo_terminal_mail_v1(),public.complete_embryo_terminal_mail_v1(uuid,uuid,boolean,text)
  from public,anon,authenticated;
grant execute on function public.expire_embryo_terminal_mail_v1(),
  public.claim_embryo_terminal_mail_v1(),public.complete_embryo_terminal_mail_v1(uuid,uuid,boolean,text)
  to service_role;

create table public.embryo_ingest_unwinds (
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid,
  session_id uuid,
  draft_id uuid,
  ingest_revision bigint not null check(ingest_revision>0),
  state text not null default 'planned' check(state in ('planned','storage_pending','storage_confirmed','complete')),
  fixed_ingest_deadline timestamptz not null,
  matrix_fingerprint text check(matrix_fingerprint ~ '^[0-9a-f]{64}$'),
  recipients jsonb,
  storage_confirmed_at timestamptz,
  completed_at timestamptz,
  unique(cohort_id,ingest_revision),
  check((state='complete')=(completed_at is not null)),
  check((state='complete')=(cohort_id is null and session_id is null and draft_id is null
    and matrix_fingerprint is null and recipients is null))
);
create table public.embryo_ingest_delete_objects (
  unwind_id uuid not null references public.embryo_ingest_unwinds(id) on delete restrict,
  ordinal bigint not null check(ordinal>0),
  bucket_id text not null check(bucket_id in ('genomes','genomes-staging','generated-artifacts','legal-evidence')),
  object_name text not null check(length(object_name) between 1 and 1024),
  source_kind text not null check(source_kind in ('ingest-fragment','canonical-source','legacy-source','upload-staging','legal-evidence')),
  source_id uuid not null,
  state text not null default 'pending' check(state in ('pending','deleted','missing')),
  acknowledged_at timestamptz,
  primary key(unwind_id,ordinal),
  unique(unwind_id,bucket_id,object_name),
  check((state='pending')=(acknowledged_at is null))
);
alter table public.embryo_ingest_unwinds enable row level security;
alter table public.embryo_ingest_delete_objects enable row level security;
revoke all on public.embryo_ingest_unwinds,public.embryo_ingest_delete_objects from public,anon,authenticated;
grant all on public.embryo_ingest_unwinds,public.embryo_ingest_delete_objects to service_role;
insert into public.purge_target_stores(target_id,store_name,store_order) values
  ('upload-and-ingest-working-state','public.embryo_ingest_delete_objects',31),
  ('upload-and-ingest-working-state','public.embryo_ingest_unwinds',32);

create function private.freeze_embryo_unwind_object_v1()
returns trigger language plpgsql set search_path='' as $$ begin
  if (new.unwind_id,new.ordinal,new.bucket_id,new.object_name,new.source_kind,new.source_id)
    is distinct from (old.unwind_id,old.ordinal,old.bucket_id,old.object_name,old.source_kind,old.source_id) then
    raise exception using errcode='55000',message='immutable unwind object identity';
  end if;
  return new;
end $$;
create trigger embryo_unwind_object_identity before update on public.embryo_ingest_delete_objects
  for each row execute function private.freeze_embryo_unwind_object_v1();
revoke all on function private.freeze_embryo_unwind_object_v1() from public,anon,authenticated;

-- This is deliberately a closed subset of the full prepublication store
-- registry. A newly populated store must obtain an exact reviewed selector.
create function private.assert_embryo_unwind_plannable_stores_v1(p_targets uuid[])
returns void language plpgsql security definer set search_path='' as $$
declare r record; v_exists boolean; v_allowed constant text[]:=array[
  'subjects','embryos','embryo_cohorts','embryo_cohort_drafts','embryo_participant_sets',
  'embryo_basis_bindings','embryo_donor_attributions','embryo_ingest_sessions','embryo_ingest_unwinds',
  'embryo_ingest_chunks','embryo_ingest_fragments','embryo_fragment_handle_maps','embryo_mapping_challenges',
  'embryo_draft_participants','draft_participant_slots','embryo_operation_nonces','consent_signatures','attestations',
  'attestation_contradictions','subject_invitations','mail_outbox','token_candidates','rights_sessions',
  'future_person_record_key_hashes','future_person_record_key_print_rights','future_person_record_key_recipients',
  'retention_rows','retention_due_phases','purge_manifests','purge_manifest_entries',
  'genome_files','genome_storage_objects','upload_sessions'];
begin
  for r in select c.relname table_name,a.attname column_name from pg_class c
    join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid
    where n.nspname='public' and c.relkind='r' and not a.attisdropped and a.atttypid='uuid'::regtype
      and a.attname in ('cohort_id','subject_id','embryo_id','target_id','draft_id','embryo_draft_id','ingest_session_id','session_id')
      and not c.relname=any(v_allowed)
  loop
    execute format('select exists(select 1 from public.%I where %I=any($1))',r.table_name,r.column_name)
      into v_exists using p_targets;
    if v_exists then raise exception using errcode='55000',message='unsupported unwind store'; end if;
  end loop;
end $$;
revoke all on function private.assert_embryo_unwind_plannable_stores_v1(uuid[]) from public,anon,authenticated;

-- Cleanup authority uses the frozen legal matrix, not a live login or current
-- consent version. Revocation must not make its own cleanup impossible.
create function private.assert_embryo_unwind_matrix_v1(p_cohort_id uuid)
returns text language plpgsql security definer set search_path='' set lock_timeout='250ms'
as $$
declare c public.embryo_cohorts%rowtype; d public.embryo_cohort_drafts%rowtype;
  b public.embryo_basis_bindings%rowtype; v_kind text; v_parent uuid; v_key text;
  v_parents uuid[]; v_expected uuid[]; v_actual uuid[]; v_signatures uuid[];
  v_signature public.consent_signatures%rowtype; v_form text; v_fingerprint text;
begin
  select * into strict c from public.embryo_cohorts where id=p_cohort_id for update;
  select * into strict d from public.embryo_cohort_drafts where id=c.draft_id for update;
  select * into strict b from public.embryo_basis_bindings where cohort_id=c.id for update;
  if c.publication_revision is not null or c.uploaded_at is not null or d.state<>'finalized'
    or (c.basis_case,c.basis_revision,c.participant_set_revision)
      is distinct from (b.basis_case,b.basis_revision,b.participant_set_revision)
    or (c.basis_case,c.basis_revision,c.participant_set_revision)
      is distinct from (d.basis_case,d.basis_revision,d.participant_set_revision) then
    raise exception using errcode='55000',message='unwind matrix unavailable';
  end if;
  perform 1 from public.embryo_participant_sets where cohort_id=c.id order by set_kind,principal_id for update;
  perform 1 from public.embryo_draft_participants where draft_id=d.id order by set_kind,principal_id for update;
  foreach v_kind in array array['required_upload_principals','disposition_authorities',
    'notice_recipients','record_key_recipients','attribution_principals'] loop
    select coalesce(array_agg(principal_id order by principal_id),'{}'::uuid[]) into v_expected
      from public.embryo_draft_participants where draft_id=d.id and set_kind=v_kind
        and set_revision=c.participant_set_revision;
    -- Issued-Card notice identity survives access revocation. Do not filter
    -- revoked_at, and never admit a replacement member or membership revision.
    select coalesce(array_agg(principal_id order by principal_id),'{}'::uuid[]) into v_actual
      from public.embryo_participant_sets where cohort_id=c.id and set_kind=v_kind;
    if v_expected is distinct from v_actual or exists(
      select 1 from public.embryo_participant_sets p where p.cohort_id=c.id and p.set_kind=v_kind
        and (p.set_revision<>c.participant_set_revision or not exists(
          select 1 from public.embryo_draft_participants x where x.draft_id=d.id and x.set_kind=v_kind
            and x.principal_id=p.principal_id and x.membership_revision=p.membership_revision))) then
      raise exception using errcode='55000',message='unwind matrix unavailable';
    end if;
    if v_kind='required_upload_principals' then v_parents:=v_actual; end if;
    if v_kind in ('disposition_authorities','notice_recipients','record_key_recipients')
      and v_actual is distinct from v_parents then
      raise exception using errcode='55000',message='unwind matrix unavailable';
    end if;
  end loop;
  if cardinality(v_parents)<>(case c.basis_case when 'true_two_parent' then 2 else 1 end)
    or exists(select 1 from public.subject_principals where id=any(v_parents) and principal_kind<>'genetic_parent') then
    raise exception using errcode='55000',message='unwind matrix unavailable';
  end if;
  perform 1 from public.consent_signatures where target_kind='cohort_draft' and target_id=d.id order by id for update;
  select coalesce(array_agg(id order by id),'{}'::uuid[]) into v_signatures
    from public.consent_signatures where target_kind='cohort_draft' and target_id=d.id;
  v_fingerprint:=encode(extensions.digest(convert_to(concat_ws(':',c.basis_case,c.basis_revision::text,
    array_to_string(v_signatures,',')),'UTF8'),'sha256'),'hex');
  if v_fingerprint is distinct from b.artifact_matrix_fingerprint then
    raise exception using errcode='55000',message='unwind matrix unavailable';
  end if;
  foreach v_parent in array v_parents||array[d.uploader_principal_id] loop
    foreach v_key in array array['consent.upload-embryo','attestation.embryo-parentage',
      'attestation.embryo-disposition-rights','attestation.embryo-single-parent-basis',
      'charter.future-person','disclosure.insurance-and-discrimination'] loop
      if v_key in ('charter.future-person','disclosure.insurance-and-discrimination') and v_parent<>d.uploader_principal_id then continue; end if;
      if v_key like 'attestation.%' and not(v_parent=any(v_parents)) then continue; end if;
      if v_key='consent.upload-embryo' and c.upload_class='embryo_own' and not(v_parent=any(v_parents)) then continue; end if;
      if v_key='attestation.embryo-single-parent-basis' and c.basis_case='true_two_parent' then continue; end if;
      v_form:=case when v_parent=d.uploader_principal_id and c.upload_class='embryo_third_party' then 'uploader' else 'parent' end;
      select cs.* into v_signature from public.consent_signatures cs join public.consent_artifacts ca
        on ca.artifact_key=cs.artifact_key and ca.version=cs.artifact_version
        where cs.target_kind='cohort_draft' and cs.target_id=d.id and cs.signer_principal_id=v_parent
          and cs.artifact_key=v_key and cs.artifact_body_sha256=ca.body_sha256
          and cs.statement_keys=private.embryo_statement_keys_v1(v_key,v_form)
          and (v_key<>'consent.upload-embryo' or cs.purpose=case v_form when 'uploader'
            then 'embryo-upload-uploader-class' else 'embryo-upload-parent-class' end);
      if not found then raise exception using errcode='55000',message='unwind matrix unavailable'; end if;
      if v_key like 'attestation.%' or v_key='charter.future-person' then
        perform 1 from public.attestations a where a.signature_id=v_signature.id
          and a.principal_id=v_parent and a.target_kind='cohort_draft' and a.target_id=d.id
          and a.statement_keys=v_signature.statement_keys and a.affirmed
          and a.kind=case v_key when 'attestation.embryo-parentage' then 'genetic_parent'
            when 'attestation.embryo-disposition-rights' then 'disposition_rights'
            when 'attestation.embryo-single-parent-basis' then 'single_parent_authority'
            else 'future_person_acknowledgement' end for update;
        if not found then raise exception using errcode='55000',message='unwind matrix unavailable'; end if;
      end if;
    end loop;
  end loop;
  if (select count(*) from public.consent_signatures where target_kind='cohort_draft' and target_id=d.id
      and artifact_key='attestation.embryo-single-parent-basis')
      <>(case c.basis_case when 'true_two_parent' then 0 else 1 end) then
    raise exception using errcode='55000',message='unwind matrix unavailable';
  end if;
  if c.basis_case in ('parent_deceased','sole_legal_authority') and not exists(
    select 1 from public.legal_reviews lr join public.reviewed_evidence re on re.review_id=lr.id
      where lr.id=b.legal_review_id and re.id=b.reviewed_evidence_id
        and lr.target_kind='single_parent_basis' and lr.target_id=d.id and lr.decision='approved') then
    raise exception using errcode='55000',message='unwind matrix unavailable';
  end if;
  -- Accepted identified-donor authority is not yet produced by the ingest
  -- resolver. Do not recast a future donor graph as a supported parent graph.
  if c.basis_case='identified_donor_consented' then
    raise exception using errcode='55000',message='unsupported unwind donor graph';
  end if;
  return v_fingerprint;
end $$;
revoke all on function private.assert_embryo_unwind_matrix_v1(uuid) from public,anon,authenticated;

create function public.prepare_embryo_ingest_unwind_v1(p_cohort_id uuid,p_ingest_revision bigint)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms'
as $$
declare c public.embryo_cohorts%rowtype; s public.embryo_ingest_sessions%rowtype;
  u public.embryo_ingest_unwinds%rowtype; v_matrix text; v_recipients jsonb; v_now timestamptz:=clock_timestamp();
begin
  select * into c from public.embryo_cohorts where id=p_cohort_id for update;
  if not found then return jsonb_build_object('status','unavailable'); end if;
  if c.publication_revision is not null then return jsonb_build_object('status','published'); end if;
  select * into s from public.embryo_ingest_sessions where cohort_id=c.id and ingest_revision=p_ingest_revision for update;
  if not found or c.ingest_revision is distinct from p_ingest_revision then
    return jsonb_build_object('status','unavailable');
  end if;
  if s.status<>'failure_pending' and s.expires_at>v_now then
    return jsonb_build_object('status','unavailable');
  end if;
  -- No renewal, session removal, due-phase cancellation or partial notice.
  perform private.mark_embryo_ingest_failure_v1(s.id,coalesce(s.failure_code,'expiry'));
  v_matrix:=private.assert_embryo_unwind_matrix_v1(c.id);
  perform private.assert_embryo_unwind_plannable_stores_v1(array[c.id,c.draft_id,s.id]
    ||array(select id from public.subjects where cohort_id=c.id)
    ||array(select id from public.embryos where cohort_id=c.id));
  perform 1 from public.retention_rows r join public.retention_due_phases p on p.retention_row_id=r.id
    where r.target_id=s.id and r.retention_id='embryo.ingest-session-24h'
      and r.target_kind='ingest_session' and r.state in ('scheduled','active')
      and r.fixed_deadline=s.expires_at and r.retention_revision=s.ingest_revision
      and p.phase_id='ingest-abandoned-no-source' and p.phase_revision=s.ingest_revision
      and p.retention_id=r.retention_id and p.phase_kind='ingest-abandoned-no-source'
      and p.target_kind=r.target_kind and p.target_id=r.target_id
      and r.target_lifecycle_revision=s.cohort_lifecycle_revision
      and p.target_lifecycle_revision=r.target_lifecycle_revision
      and r.disposition_revision=1 and p.disposition_revision=1
      and p.recipient_authority_kind='record-key-recipients'
      and p.recipient_authority_revision=c.recipient_set_revision
      and p.phase_deadline=s.expires_at and p.status in ('pending','retry','claimed')
      and p.immutable_envelope=jsonb_build_object('cohortId',c.id,'ingestRevision',s.ingest_revision)
    for update of r,p;
  if not found then raise exception using errcode='55000',message='unwind due authority unavailable'; end if;
  select * into u from public.embryo_ingest_unwinds where cohort_id=c.id and ingest_revision=s.ingest_revision for update;
  if found then
    if u.matrix_fingerprint is distinct from v_matrix then
      raise exception using errcode='55000',message='unwind matrix changed';
    end if;
    return jsonb_build_object('status',u.state,'unwindId',u.id);
  end if;

  -- Preserve only identity/revision references until the atomic terminal
  -- transaction. Do not copy a contact early or restart its retention clock.
  perform 1 from public.subject_principals sp join public.embryo_participant_sets p on p.principal_id=sp.id
    where p.cohort_id=c.id and p.set_kind='record_key_recipients' order by sp.id for update of sp;
  select jsonb_agg(jsonb_build_object('principalId',p.principal_id,'membershipRevision',p.membership_revision,
      'setRevision',p.set_revision,'recipientPseudonym',gen_random_uuid()) order by p.principal_id)
    into v_recipients from public.embryo_participant_sets p
    where p.cohort_id=c.id and p.set_kind='record_key_recipients';
  insert into public.embryo_ingest_unwinds(cohort_id,session_id,draft_id,ingest_revision,
    fixed_ingest_deadline,matrix_fingerprint,recipients)
    values(c.id,s.id,c.draft_id,s.ingest_revision,s.expires_at,v_matrix,v_recipients) returning * into u;
  perform 1 from public.embryo_ingest_fragments where session_id=s.id order by sequence,sample_ordinal for update;
  perform 1 from public.genome_storage_objects where cohort_id=c.id order by object_id for update;

  -- Evidence fragments and pending-source rows currently lack an exact
  -- physical version/path binding. Do not silently skip these stores.
  if exists(select 1 from public.pending_source_rows where cohort_id=c.id)
    or exists(select 1 from public.legal_evidence_ingest_sessions where target_id=c.draft_id)
    or exists(select 1 from public.reviewed_evidence re join public.embryo_basis_bindings b
      on b.reviewed_evidence_id=re.id where b.cohort_id=c.id and re.storage_object_id is not null) then
    raise exception using errcode='55000',message='unbound unwind storage unavailable';
  end if;
  if exists(select 1 from public.embryo_ingest_fragments f join public.genome_storage_objects g on g.object_id=f.object_id
    where f.session_id=s.id and (f.bucket_id,f.object_name) is distinct from (g.bucket_id,g.object_name)) then
    raise exception using errcode='55000',message='contradictory unwind object binding';
  end if;
  insert into public.embryo_ingest_delete_objects(unwind_id,ordinal,bucket_id,object_name,source_kind,source_id)
    select u.id,row_number() over(order by bucket_id,object_name),bucket_id,object_name,source_kind,source_id from (
      select f.bucket_id,f.object_name,'ingest-fragment'::text source_kind,f.object_id source_id
        from public.embryo_ingest_fragments f where f.session_id=s.id
      union all
      select g.bucket_id,g.object_name,'canonical-source',g.object_id from public.genome_storage_objects g
        where (g.cohort_id=c.id or g.genome_file_id in(select f.id from public.genome_files f
          join public.subjects subject on subject.id=f.subject_id where subject.cohort_id=c.id))
          and not exists(select 1 from public.embryo_ingest_fragments f
          where f.session_id=s.id and f.object_id=g.object_id)
      union all
      select 'genomes',f.bucket_path,'legacy-source',f.id from public.genome_files f
        join public.subjects subject on subject.id=f.subject_id
        where subject.cohort_id=c.id and f.bucket_path is not null and f.storage_object_id is null
      union all
      select 'genomes-staging',staging_object_name,'upload-staging',id from public.upload_sessions
        where cohort_id=c.id or subject_id in(select id from public.subjects where cohort_id=c.id)
    ) exact_objects;
  update public.embryo_ingest_unwinds set state='storage_pending' where id=u.id;
  return jsonb_build_object('status','storage_pending','unwindId',u.id);
end $$;
revoke all on function public.prepare_embryo_ingest_unwind_v1(uuid,bigint) from public,anon,authenticated;
grant execute on function public.prepare_embryo_ingest_unwind_v1(uuid,bigint) to service_role;

-- There is deliberately NO Storage ACK or terminal graph-purge RPC yet.
-- An absent storage.objects row does not prove that an in-flight, versioned
-- backend upload is absent. The exact manifest survives for a reviewed worker
-- fence; neither an empty DELETE response nor a lease timeout can publish a
-- no-source notice. The actual source-accepting HTTP writer remains disabled.
