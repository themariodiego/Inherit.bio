-- Future Person custody. TEST-LOCAL only; no jurisdiction switch is changed.
-- Parent: 20260930232000_embryo_parent_withdrawal.sql.
--
-- The approval transaction in future-person-claim-resolution-v1 requires
-- one exact durable claimant, no parent ownership, and preservation of the
-- sanitized source and minimum historical agreement slice. Historical
-- canonical source/part descriptors are immutable publication provenance;
-- their cohort UUID never confers current authority. Parent deletion uses
-- the live subject binding and cannot select a detached claimed subject.

alter table public.subjects
  add column claimant_principal_id uuid references public.future_person_claimant_principals(id) on delete restrict,
  add column earliest_claim_at timestamptz,
  add column analysis_stopped_at timestamptz;

alter table public.subjects drop constraint subjects_embryo_cohort_shape;
alter table public.subjects add constraint subjects_embryo_cohort_shape check (
  (subject_class='embryo' and lifecycle not in ('claimed_unbound','claimed_bound') and cohort_id is not null)
  or (subject_class='embryo' and lifecycle in ('claimed_unbound','claimed_bound') and cohort_id is null)
  or (subject_class<>'embryo' and cohort_id is null)
);
-- The old self-owner equivalence cannot describe a claimant-owned embryo.
do $$ declare n text; begin
  select conname into n from pg_constraint
    where conrelid='public.subjects'::regclass and contype='c'
      and pg_get_constraintdef(oid) like '%subject_class = ''self''%'
      and pg_get_constraintdef(oid) like '%owner_account_id = subject_account_id%';
  if n is null then raise exception 'claim custody predecessor shape missing'; end if;
  execute format('alter table public.subjects drop constraint %I',n);
end $$;
alter table public.subjects add constraint subjects_self_or_claimant_owner_shape check (
  (subject_class='self' or (subject_class='embryo' and lifecycle='claimed_bound'))
  = (owner_account_id is not null and owner_account_id=subject_account_id)
);
alter table public.subjects add constraint subjects_claimed_custody_shape check (
  case lifecycle
    when 'claimed_unbound' then subject_class='embryo' and claimant_principal_id is not null
      and owner_account_id is null and subject_account_id is null and earliest_claim_at is not null
    when 'claimed_bound' then subject_class='embryo' and claimant_principal_id is not null
      and owner_account_id is not null and owner_account_id=subject_account_id and earliest_claim_at is not null
    else claimant_principal_id is null and (subject_class<>'embryo' or owner_account_id is not null)
  end
);

alter table public.embryos alter column cohort_id drop not null;
alter table public.embryos drop constraint embryos_status_check;
alter table public.embryos add constraint embryos_status_check check(status in (
  'pending','qc_pass','qc_marginal','qc_fail','excluded','stored','transferred','donated','discarded',
  'claimed_unbound','claimed_bound'
));
alter table public.embryos add constraint embryos_live_cohort_shape check (
  (status in ('claimed_unbound','claimed_bound'))=(cohort_id is null)
);
alter table public.embryos add column future_person_state text generated always as (
  case status when 'transferred' then 'reserved_for_future_person'
    when 'claimed_unbound' then 'claimed_unbound' when 'claimed_bound' then 'claimed_bound'
    else 'unavailable' end
) stored;

create or replace function private.assert_embryo_subject_binding()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.subjects s where s.id=new.subject_id and s.subject_class='embryo'
    and s.cohort_id is not distinct from new.cohort_id and s.lifecycle<>'purged'
    and ((new.cohort_id is not null and s.lifecycle not in ('claimed_unbound','claimed_bound'))
      or (new.cohort_id is null and s.lifecycle=new.status and s.claimant_principal_id is not null))) then
    raise exception using errcode='23514',message='invalid embryo subject binding';
  end if;
  return new;
end $$;
drop trigger embryos_subject_binding on public.embryos;
create trigger embryos_subject_binding before insert or update of cohort_id,subject_id,status on public.embryos
  for each row execute function private.assert_embryo_subject_binding();

-- A detached canonical file has no parent account FK. Ordinary account files
-- still require their owner. The positive claimed-subject check is deferred
-- because subject, embryo and file change in one approval transaction.
alter table public.genome_files alter column user_id drop not null;
create function private.assert_claimed_file_owner_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare f public.genome_files; s public.subjects;
begin
  select * into f from public.genome_files where id=coalesce(new.id,old.id);
  if f.id is null then return null; end if;
  select * into s from public.subjects where id=f.subject_id;
  if f.user_id is null and not (s.id is not null and s.subject_class='embryo'
    and s.lifecycle='claimed_unbound' and s.claimant_principal_id is not null and s.cohort_id is null
    and f.cohort_id is null and not f.is_cohort_file
    and exists(select 1 from private.embryo_canonical_sources x
      where x.file_id=f.id and x.subject_id=s.id)) then
    raise exception using errcode='23514',message='invalid claimed file owner';
  end if;
  if s.lifecycle='claimed_unbound' and f.user_id is not null then
    raise exception using errcode='23514',message='invalid claimed file owner';
  end if;
  return null;
end $$;
create constraint trigger genome_files_claimed_owner after insert or update on public.genome_files
  deferrable initially deferred for each row execute function private.assert_claimed_file_owner_v1();

create unique index future_person_claimant_principals_current_principal_idx
  on public.future_person_claimant_principals(principal_id) where status='current';
-- This is a durable, keyed re-verification record, not a 24-month contact.
alter table public.future_person_claimant_identity_hmacs alter column expires_at drop not null;

-- A narrow snapshot: no parent raw genome, contact, name, joint result or
-- live parent-principal FK. Original immutable source rows stay untouched.
create table private.future_person_custody_slices (
  subject_id uuid primary key references public.subjects(id) on delete restrict,
  claimant_principal_id uuid not null unique references public.future_person_claimant_principals(id) on delete restrict,
  source_file_id uuid not null unique references public.genome_files(id) on delete restrict,
  historical_cohort_id uuid not null,
  source_sha256 text not null check(source_sha256~'^[0-9a-f]{64}$'),
  source_membership_sha256 text not null check(source_membership_sha256~'^[0-9a-f]{64}$'),
  publication_revision bigint not null check(publication_revision>0),
  agreement_slice jsonb not null check(jsonb_typeof(agreement_slice)='array'),
  approved_at timestamptz not null default clock_timestamp()
);
alter table private.future_person_custody_slices enable row level security;
revoke all on private.future_person_custody_slices from public,anon,authenticated,service_role;
insert into public.purge_target_stores(target_id,store_name,store_order)
select 'variant-rows','private.future_person_custody_slices',coalesce(max(store_order),0)+1
  from public.purge_target_stores where target_id='variant-rows';

alter table private.claim_review_decisions
  add column documentary_attestation_ciphertext bytea,
  add column verified_identity_hmac text check(verified_identity_hmac is null or verified_identity_hmac~'^[0-9a-f]{64}$'),
  add column identity_hmac_revision bigint check(identity_hmac_revision is null or identity_hmac_revision>0),
  add column verified_date_of_birth date,
  add column recorded_parent_link_confirmed boolean not null default false,
  add constraint claim_review_attestation_shape check(
    num_nonnulls(documentary_attestation_ciphertext,verified_identity_hmac,identity_hmac_revision,verified_date_of_birth) in(0,4)
    and (documentary_attestation_ciphertext is null or octet_length(documentary_attestation_ciphertext) between 29 and 16384)
  );

create function private.claim_hash_matches_v1(a text,b text)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare x bytea; y bytea; d integer:=0; n integer;
begin
  if a is null or b is null or a!~'^[0-9a-f]{64}$' or b!~'^[0-9a-f]{64}$' then return false; end if;
  x:=decode(a,'hex');y:=decode(b,'hex');
  for n in 0..31 loop d:=d|(get_byte(x,n)#get_byte(y,n)); end loop;
  return d=0;
end $$;

-- Validate both ends of every relation, including its old end after a move.
create function private.assert_future_person_subject_custody_v1(p_subject uuid)
returns void language plpgsql security definer set search_path='' as $$
declare s public.subjects; n bigint;
begin
  select * into s from public.subjects where id=p_subject;
  if s.id is null then return; end if;
  if s.lifecycle not in ('claimed_unbound','claimed_bound') then
    if exists(select 1 from private.future_person_custody_slices where subject_id=s.id) then
      raise exception using errcode='23514',message='invalid claimant custody';
    end if;
    return;
  end if;
  select count(*) into n from public.future_person_claimant_principals c
    join public.subject_principals p on p.id=c.principal_id
    join public.future_person_claims f on f.id=c.claim_id
    join public.embryos e on e.id=f.embryo_id and e.subject_id=s.id
    where p.subject_id=s.id and p.principal_kind='future_person' and p.status='active'
      and c.status='current' and f.status='approved' and f.claimant_principal_id=p.id;
  if n<>1 or not exists(select 1 from public.future_person_claimant_principals c
    join public.subject_principals p on p.id=c.principal_id where c.id=s.claimant_principal_id
      and c.status='current' and p.status='active' and p.principal_kind='future_person' and p.subject_id=s.id
      and p.account_id is not distinct from s.subject_account_id) then
    raise exception using errcode='23514',message='invalid claimant custody';
  end if;
  if exists(select 1 from public.genome_files f where f.subject_id=s.id
    and ((s.lifecycle='claimed_unbound' and f.user_id is not null)
      or (s.lifecycle='claimed_bound' and f.user_id is distinct from s.subject_account_id))) then
    raise exception using errcode='23514',message='invalid claimed file owner'; end if;
  if not exists(select 1 from private.future_person_custody_slices x where x.subject_id=s.id
    and x.claimant_principal_id=s.claimant_principal_id) then
    raise exception using errcode='23514',message='invalid claimant custody'; end if;
  if not exists(select 1 from public.embryos e where e.subject_id=s.id and e.cohort_id is null
    and e.status=s.lifecycle and exists(select 1 from private.future_person_custody_slices x
      join private.embryo_canonical_sources cs on cs.file_id=x.source_file_id and cs.subject_id=x.subject_id
      join public.genome_files f on f.id=cs.file_id and f.subject_id=cs.subject_id
      where x.subject_id=s.id and cs.embryo_id=e.id and x.source_sha256=cs.source_sha256
        and x.source_membership_sha256=cs.membership_sha256)) then
    raise exception using errcode='23514',message='invalid claimant custody';
  end if;
end $$;

create function private.assert_future_person_custody_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare before_row jsonb; after_row jsonb; row_value jsonb; affected uuid[]:='{}'; v_subject uuid;
begin
  if tg_op<>'INSERT' then before_row:=to_jsonb(old); end if;
  if tg_op<>'DELETE' then after_row:=to_jsonb(new); end if;
  foreach row_value in array array[before_row,after_row] loop
    if row_value is null then continue; end if;
    if tg_table_name='subjects' then affected:=array_append(affected,(row_value->>'id')::uuid);
    elsif tg_table_name in('subject_principals','embryos','future_person_custody_slices','genome_files') then
      affected:=array_append(affected,(row_value->>'subject_id')::uuid);
    elsif tg_table_name='future_person_claimant_principals' then
      select array_cat(affected,coalesce(array_agg(id),'{}')) into affected from public.subjects
        where claimant_principal_id=(row_value->>'id')::uuid;
      select array_cat(affected,coalesce(array_agg(subject_id),'{}')) into affected from public.subject_principals
        where id=(row_value->>'principal_id')::uuid;
    elsif tg_table_name='future_person_claims' then
      select array_cat(affected,coalesce(array_agg(subject_id),'{}')) into affected from public.embryos
        where id=(row_value->>'embryo_id')::uuid;
      select array_cat(affected,coalesce(array_agg(subject_id),'{}')) into affected from public.subject_principals
        where id=(row_value->>'claimant_principal_id')::uuid;
    end if;
  end loop;
  for v_subject in select distinct id from unnest(affected) id where id is not null loop
    perform private.assert_future_person_subject_custody_v1(v_subject);
  end loop;
  return null;
end $$;
create constraint trigger subjects_claimant_cardinality after insert or update or delete on public.subjects
  deferrable initially deferred for each row execute function private.assert_future_person_custody_v1();
create constraint trigger principals_claimant_cardinality after insert or update or delete on public.subject_principals
  deferrable initially deferred for each row execute function private.assert_future_person_custody_v1();
create constraint trigger claimants_claimant_cardinality after insert or update or delete on public.future_person_claimant_principals
  deferrable initially deferred for each row execute function private.assert_future_person_custody_v1();
create constraint trigger approvals_claimant_cardinality after insert or update or delete on public.future_person_claims
  deferrable initially deferred for each row execute function private.assert_future_person_custody_v1();
create constraint trigger embryos_claimant_cardinality after insert or update or delete on public.embryos
  deferrable initially deferred for each row execute function private.assert_future_person_custody_v1();
create constraint trigger slices_claimant_cardinality after insert or update or delete on private.future_person_custody_slices
  deferrable initially deferred for each row execute function private.assert_future_person_custody_v1();
create constraint trigger files_claimant_cardinality after insert or update or delete on public.genome_files
  deferrable initially deferred for each row execute function private.assert_future_person_custody_v1();

-- Lock the exact subject, its retention rows, lifecycle, claim/hold, then
-- manifests. Cancel only its unstarted subject/file deletion rows. A parent
-- cohort/account row is never canceled wholesale to rescue one subject.
create function private.cancel_unstarted_claim_subject_purge_v1(p_subject uuid)
returns void language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare s public.subjects; r record;
begin
  select * into s from public.subjects where id=p_subject for update;
  if s.id is null then raise exception using errcode='42501',message='claim review unavailable'; end if;
  perform 1 from public.retention_rows t where
    (t.target_kind='subject' and t.target_id=s.id)
    or (t.target_kind='file' and t.target_id in(select id from public.genome_files where subject_id=s.id))
    or (t.target_kind='cohort' and t.target_id=s.cohort_id)
    or (t.target_kind='account' and t.target_id in(s.owner_account_id,s.subject_account_id))
    order by t.id for update;
  perform 1 from public.subjects where id=s.id for update;
  perform 1 from public.future_person_claims c join public.embryos e on e.id=c.embryo_id
    where e.subject_id=s.id order by c.id for update of c;
  perform 1 from public.purge_manifests m join public.retention_rows t on t.id=m.retention_row_id
    where (t.target_kind='subject' and t.target_id=s.id)
    or (t.target_kind='file' and t.target_id in(select id from public.genome_files where subject_id=s.id))
    or (t.target_kind='cohort' and t.target_id=s.cohort_id)
    or (t.target_kind='account' and t.target_id in(s.owner_account_id,s.subject_account_id))
    order by m.id for update of m;
  if exists(select 1 from public.purge_manifests m join public.retention_rows t on t.id=m.retention_row_id
    where (m.physical_purge_started_at is not null or m.batch_cursor>0)
      and ((t.target_kind='subject' and t.target_id=s.id)
        or (t.target_kind='file' and t.target_id in(select id from public.genome_files where subject_id=s.id))
        or (t.target_kind='cohort' and t.target_id=s.cohort_id)
        or (t.target_kind='account' and t.target_id in(s.owner_account_id,s.subject_account_id))))
    or exists(select 1 from public.account_deletion_requests d
      where d.account_id in(s.owner_account_id,s.subject_account_id)
        and (d.state='delete_started' or d.delete_started_at is not null)) then
    raise exception using errcode='42501',message='claim review unavailable';
  end if;
  for r in select t.id from public.retention_rows t where t.state in ('scheduled','active')
    and ((t.target_kind='subject' and t.target_id=s.id)
      or (t.target_kind='file' and t.target_id in(select id from public.genome_files where subject_id=s.id))) loop
    update public.retention_due_phases set status='cancelled',terminal_outcome_code='claim-detached',
      completed_at=clock_timestamp(),claim_token_hash=null,claim_expires_at=null
      where retention_row_id=r.id and status in ('pending','claimed','retry');
    update public.purge_manifests set state='cancelled' where retention_row_id=r.id
      and state in ('frozen','executing') and physical_purge_started_at is null and batch_cursor=0;
    update public.retention_rows set state='cancelled',ended_at=clock_timestamp() where id=r.id;
  end loop;
end $$;

-- Canonical provenance's historical cohort ID is never a parent selector.
create or replace function private.delete_embryo_cohort_sources_v1(p_cohort_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_files uuid[];
begin
  if p_cohort_id is null or p_reason is null or p_reason not in ('restriction','withdrawal') then
    raise exception using errcode='22023',message='invalid_request'; end if;
  perform 1 from public.embryo_cohorts where id=p_cohort_id for update;
  if not found then raise exception using errcode='42501',message='cohort unavailable'; end if;
  select array_agg(x.file_id order by x.file_id) into v_files from private.embryo_canonical_sources x
    join public.subjects s on s.id=x.subject_id
    join public.embryos e on e.id=x.embryo_id and e.subject_id=s.id
    where x.cohort_id=p_cohort_id and s.cohort_id=p_cohort_id and e.cohort_id=p_cohort_id
      and s.lifecycle not in ('claimed_unbound','claimed_bound') and s.claimant_principal_id is null;
  if v_files is null then return jsonb_build_object('status','none','sources',0); end if;
  return private.plan_embryo_source_deletion_v1(v_files,p_reason);
end $$;

-- Defense at the immutable source/membership deletion boundary, including a
-- direct parent planner call. A future claimant deletion executor must prove
-- its exact subject manifest here; parent reasons can never delete this row.
create function private.guard_claimed_canonical_deletion_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_subject uuid; s public.subjects;
begin
  if tg_table_name='embryo_canonical_sources' then v_subject:=old.subject_id;
  else select subject_id into v_subject from private.embryo_canonical_sources where file_id=old.file_id; end if;
  select * into s from public.subjects where id=v_subject for update;
  if s.lifecycle in ('claimed_unbound','claimed_bound') or s.claimant_principal_id is not null then
    raise exception using errcode='42501',message='embryo_source_unavailable';
  end if;
  return old;
end $$;
create trigger embryo_source_claimed_delete before delete on private.embryo_canonical_sources
  for each row execute function private.guard_claimed_canonical_deletion_v1();
create trigger embryo_source_membership_claimed_delete before delete on private.embryo_canonical_source_parts
  for each row execute function private.guard_claimed_canonical_deletion_v1();

-- The immutable approval decision names the immediately preceding review
-- revision. Advancing that revision must not fabricate, lose or broaden the
-- verified receipts. Every required sequence remains bound to today's live
-- reviewer session, current assignment and exact clean document digest.
create function private.claim_decision_document_received_v1(
  p_review private.claim_reviews,p_decision private.claim_review_decisions,p_document private.claim_documents
) returns boolean language sql stable security definer set search_path='' as $$
  select p_document.id is not null and p_document.state='clean' and p_document.object_deleted_at is null
    and not exists(select 1 from generate_series(0,ceil(p_document.byte_count/4000000.0)::integer-1) n
      where not exists(select 1 from private.claim_review_reads r
        join private.claim_review_assignments a on a.review_id=r.review_id and a.assignment_revision=r.assignment_revision
          and a.reviewer_account_id=r.reviewer_account_id and a.status='current'
        join public.profiles p on p.id=r.reviewer_account_id and p.auth_session_revision=r.account_auth_session_revision
        join auth.sessions s on s.id=r.auth_session_id and coalesce(s.refresh_token_counter,0)+1=r.originating_session_revision
        where r.review_id=p_review.id and r.review_revision=p_decision.review_revision
          and r.reviewer_account_id=p_decision.reviewer_account_id and r.auth_session_id=p_decision.auth_session_id
          and r.auth_session_id=(auth.jwt()->>'session_id')::uuid and r.document_id=p_document.id
          and r.document_sha256=p_document.sha256 and r.chunk_sequence=n and r.delivery_verified_at is not null));
$$;

-- Internal final-approval effect. No API role may call this. The caller has
-- already recorded this named reviewer's exact attested decision and created
-- its one approved claimant bridge in the same transaction. This function
-- still rechecks those predecessors, both complete document receipts and
-- current Record Key/disposition, rather than trusting the bridge alone.
create function private.detach_future_person_subject_v1(p_claim_id uuid)
returns uuid language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare
  s public.subjects; e public.embryos; c public.future_person_claims;
  cp public.future_person_claimant_principals; sp public.subject_principals;
  r private.claim_reviews; d private.claim_review_decisions; i private.future_person_claim_intakes;
  x private.embryo_canonical_sources; v_reviewer record; v_agreements jsonb; v_now timestamptz;
begin
  select * into c from public.future_person_claims where id=p_claim_id;
  select * into e from public.embryos where id=c.embryo_id;
  if c.id is null or e.id is null then raise exception using errcode='42501',message='claim review unavailable'; end if;
  -- Common retention-purge lock order starts with the target subject.
  select * into s from public.subjects where id=e.subject_id for update;
  perform private.cancel_unstarted_claim_subject_purge_v1(s.id);
  select * into c from public.future_person_claims where id=p_claim_id for update;
  select * into e from public.embryos where id=c.embryo_id for update;
  select * into r from private.claim_reviews where id=c.id for update;
  select * into d from private.claim_review_decisions where review_id=r.id order by review_revision desc limit 1;
  select * into i from private.future_person_claim_intakes where id=r.id for update;
  select * into v_reviewer from private.claim_reviewer_step_up_v1();
  select * into cp from public.future_person_claimant_principals where claim_id=c.id and status='current' for update;
  select * into sp from public.subject_principals where id=cp.principal_id for update;
  v_now:=clock_timestamp();
  if s.id is null or s.subject_class<>'embryo' or s.lifecycle not in ('active','restricted')
    or s.owner_account_id is null or s.claimant_principal_id is not null
    or e.cohort_id is distinct from s.cohort_id or e.status<>'transferred'
    or e.future_person_state<>'reserved_for_future_person' or e.transferred_at is null
    or c.status<>'approved' or c.claim_method<>'record_key' or c.claimant_account_id is not null
    or r.id is null or r.state<>'release_queued' or r.deadline<=v_now
    or r.case_kind<>'record_key' or r.mode<>'record-key' or r.matched_embryo_id is distinct from e.id
    or d.id is null or d.decision<>'approve-record-key' or d.review_revision+1<>r.review_revision
    or d.documentary_attestation_ciphertext is null or not d.recorded_parent_link_confirmed
    or d.verified_date_of_birth is null or d.verified_date_of_birth<date '1900-01-01'
    or (d.verified_date_of_birth+interval '18 years')::date>(v_now at time zone 'UTC')::date
    or d.verified_date_of_birth<(e.transferred_at at time zone 'UTC')::date
    or v_reviewer.account_id is null or d.reviewer_account_id is distinct from v_reviewer.account_id
    or d.auth_session_id is distinct from v_reviewer.auth_session_id
    or cp.id is null or sp.subject_id is distinct from s.id or sp.principal_kind<>'future_person'
    or sp.status<>'active' or sp.account_id is not null or c.claimant_principal_id is distinct from sp.id
    or not exists(select 1 from private.claim_review_assignments a where a.review_id=r.id
      and a.status='current' and a.reviewer_account_id=v_reviewer.account_id)
    or not exists(select 1 from public.future_person_record_key_hashes h where h.embryo_id=e.id
      and h.status='current' and private.claim_hash_matches_v1(h.key_hash,i.key_hash)) then
    raise exception using errcode='42501',message='claim review unavailable';
  end if;
  if private.claim_decision_document_received_v1(r,d,private.claim_review_document_v1(r,r.photo_document_id)) is distinct from true
    or private.claim_decision_document_received_v1(r,d,private.claim_review_document_v1(r,r.birth_record_document_id)) is distinct from true then
    raise exception using errcode='42501',message='claim review unavailable'; end if;
  select * into x from private.embryo_canonical_sources where subject_id=s.id and embryo_id=e.id for update;
  if x.file_id is null or not exists(select 1 from public.genome_files f where f.id=x.file_id
    and f.subject_id=s.id and f.user_id=s.owner_account_id and f.cohort_id is null and not f.is_cohort_file)
    or (select count(*) from public.genome_files where subject_id=s.id)<>1
    or (select count(*) from private.embryo_canonical_source_parts where file_id=x.file_id)<>x.part_count
    or exists(select 1 from public.user_variants where subject_id=s.id)
    or exists(select 1 from public.user_prs where subject_id=s.id)
    or exists(select 1 from public.chats where subject_id=s.id)
    or exists(select 1 from public.generated_exports where target_kind='subject' and target_id=s.id and status='ready') then
    -- These legacy account-only artifacts need their exact registered purge
    -- executor before this transition can claim completion; never orphan them.
    raise exception using errcode='42501',message='claim review unavailable';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('artifactKey',a.artifact_key,'artifactVersion',a.artifact_version,
    'bodySha256',a.artifact_body_sha256,'statementKeys',a.statement_keys,'signedAt',a.signed_at)
    order by a.artifact_key,a.artifact_version,a.id),'[]'::jsonb) into v_agreements
    from public.consent_signatures a where
      ((a.target_kind='cohort' and a.target_id=s.cohort_id) or (a.target_kind='cohort_draft'
        and a.target_id=(select draft_id from public.embryo_cohorts where id=s.cohort_id)))
      and a.artifact_key in ('consent.upload-embryo','charter.future-person');
  if (select count(distinct a->>'artifactKey') from jsonb_array_elements(v_agreements) a)<>2 then
    raise exception using errcode='42501',message='claim review unavailable'; end if;
  insert into private.future_person_custody_slices(subject_id,claimant_principal_id,source_file_id,
    historical_cohort_id,source_sha256,source_membership_sha256,publication_revision,agreement_slice,approved_at)
  values(s.id,cp.id,x.file_id,x.cohort_id,x.source_sha256,x.membership_sha256,x.publication_revision,v_agreements,v_now);
  insert into public.future_person_claimant_identity_hmacs(claimant_principal_id,identity_hmac,hmac_key_revision,expires_at)
    values(cp.id,d.verified_identity_hmac,d.identity_hmac_revision,null);
  update public.subject_relationships set status='revoked',ended_at=v_now,relationship_revision=relationship_revision+1
    where subject_id=s.id and status in ('pending','current');
  update public.subject_account_bindings set status='revoked',ended_at=v_now,binding_revision=binding_revision+1
    where subject_id=s.id and status in ('pending','current');
  update public.purpose_grants set revoked_at=v_now,revocation_reason='claim-detached'
    where target_kind='subject' and target_id=s.id and revoked_at is null;
  update public.subject_consents set revoked_at=v_now,revocation_reason='superseded'
    where subject_id=s.id and revoked_at is null;
  update public.download_sessions set status='revoked',ended_at=v_now,session_revision=session_revision+1
    where target_kind='subject' and target_id=s.id and status='active';
  update public.subject_principals set status='detached',principal_revision=principal_revision+1
    where subject_id=s.id and id<>sp.id and status in ('pending','active');
  update public.subjects set lifecycle='claimed_unbound',claimant_principal_id=cp.id,
    owner_account_id=null,subject_account_id=null,cohort_id=null,
    earliest_claim_at=(d.verified_date_of_birth+interval '18 years') at time zone 'UTC',
    subject_binding_revision=subject_binding_revision+1,lifecycle_revision=lifecycle_revision+1,updated_at=v_now
    where id=s.id;
  update public.embryos set cohort_id=null,status='claimed_unbound',disposition_revision=disposition_revision+1 where id=e.id;
  update public.genome_files set user_id=null where id=x.file_id;
  update public.future_person_record_key_hashes set status='revoked',ended_at=v_now where embryo_id=e.id and status='current';
  update public.future_person_record_key_print_rights set status='revoked' where embryo_id=e.id and status='unconsumed';
  update public.future_person_identity set state='shredded',parent_supplied_ciphertext='\\x00',
    identity_hmac=encode(extensions.gen_random_bytes(32),'hex'),ended_at=v_now
    where embryo_id=e.id and state='current';
  update public.future_person_claim_sessions set state='cancelled',ended_at=v_now
    where embryo_id=e.id and id<>c.intake_session_id and state in ('draft','submitted');
  return cp.id;
end $$;

do $$ declare f text; begin
  foreach f in array array[
    'private.assert_claimed_file_owner_v1()', 'private.assert_future_person_subject_custody_v1(uuid)', 'private.assert_future_person_custody_v1()',
    'private.cancel_unstarted_claim_subject_purge_v1(uuid)', 'private.guard_claimed_canonical_deletion_v1()',
    'private.claim_hash_matches_v1(text,text)', 'private.detach_future_person_subject_v1(uuid)',
    'private.claim_decision_document_received_v1(private.claim_reviews,private.claim_review_decisions,private.claim_documents)'
  ] loop execute format('revoke all on function %s from public,anon,authenticated,inherit_upload_only,service_role',f); end loop;
end $$;

-- A regenerated bearer link is a new provider submission payload. Semantic
-- event dedupe still uses the unchanged outbox key; the provider key binds
-- to its exact attempt. A repeat of that attempt retains the same key.
create function private.mail_provider_attempt_key_v1(m public.mail_outbox)
returns text language sql immutable security invoker set search_path='' as $$
  select case when m.token_purpose is null then m.idempotency_key else
    encode(extensions.digest(convert_to('mail-token-attempt-v1|'||m.idempotency_key||'|'||m.attempt_count,'UTF8'),'sha256'),'hex') end;
$$;
revoke all on function private.mail_provider_attempt_key_v1(public.mail_outbox)
  from public,anon,authenticated,inherit_upload_only,service_role;

-- Preserve every branch of the notice predecessor; only provider attempt
-- key derivation changes here. Claimant token issuance is added below.
create or replace function public.claim_mail_outbox()
returns table (
  outbox_id uuid,
  template_id text,
  template_payload jsonb,
  idempotency_key text,
  attempt_ordinal smallint,
  contact_ciphertext bytea,
  delivery_token text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outbox public.mail_outbox%rowtype;
  v_candidate public.token_candidates%rowtype;
  v_raw_token text;
  v_token_hash text;
begin
  perform private.lock_invitation_transitions_v1();
  update public.mail_outbox m
  set state = 'expired', claimed_at = null, last_outcome_code = 'expired'
  where m.state in ('queued', 'claimed')
    and m.expires_at <= clock_timestamp();

  update public.mail_outbox m
  set state = 'invalidated', claimed_at = null,
      last_outcome_code = 'recipient_authority_stale'
  where m.invitation_terminal_notice_id is null
    and m.state in ('queued', 'claimed')
    and not exists (
      select 1
      from public.subject_principals sp
      join public.encrypted_contact_references ecr
        on ecr.id = m.contact_reference_id
       and ecr.principal_id = sp.id
      where sp.id = m.recipient_principal_id
        and (
          sp.status = 'active'
          or (
            m.purpose in ('adult-subject-invitation', 'co-parent-invitation')
            and sp.status = 'pending'
          )
        )
        and sp.principal_revision = m.recipient_authority_revision
        and ecr.status = 'current'
        and ecr.authority_revision = m.recipient_authority_revision
        and ecr.contact_ciphertext is not null
    );

  -- A live contact is not enough: readiness belongs to this exact source.
  -- Invalidated rows retain their ordinary history/retention rules.
  update public.mail_outbox m
  set state = 'invalidated', claimed_at = null,
      last_outcome_code = 'file_target_unavailable'
  where m.template_id = 'report-ready' and m.state in ('queued', 'claimed')
    and private.file_ready_mail_current_v1(m) is not true;

  -- Recheck the exact invitation and all stored contact-key aliases before
  -- token creation, under the same transition lock as refusal/acceptance.
  update public.mail_outbox m set state='invalidated',claimed_at=null,
    last_outcome_code='invitation_authority_stale'
  where m.state in('queued','claimed')
    and m.token_purpose in('adult-subject-invitation','co-parent-invitation')
    and not private.invitation_mail_current_v1(m);

  -- An embryo withdrawal credential's row lives only while the cohort, its
  -- basis, its sets and the recipient are exactly those it was bound to.
  update public.mail_outbox m set state='invalidated',claimed_at=null,
    last_outcome_code='embryo_withdrawal_authority_stale'
  where m.state in('queued','claimed')
    and m.token_purpose='embryo-parent-withdrawal'
    and not exists (select 1 from public.token_candidates tc
      where tc.outbox_id=m.id and private.embryo_withdrawal_current_v1(tc.id));

  select m.* into v_outbox
  from public.mail_outbox m
  where m.invitation_terminal_notice_id is null and (
      (m.state = 'queued' and m.not_before <= clock_timestamp())
      or (
        m.state = 'claimed'
        and m.claimed_at < clock_timestamp() - interval '10 minutes'
      )
    )
    and m.expires_at > clock_timestamp()
    and m.attempt_count < 10
    and (m.template_id <> 'report-ready' or private.file_ready_mail_current_v1(m) is true)
  order by m.not_before, m.created_at
  for update skip locked
  limit 1;

  if v_outbox.id is null then return; end if;

  update public.mail_outbox m
  set state = 'claimed',
      claimed_at = clock_timestamp(),
      attempt_count = (m.attempt_count + 1)::smallint,
      last_outcome_code = null
  where m.id = v_outbox.id
  returning m.* into v_outbox;

  if v_outbox.token_purpose in ('adult-subject-invitation', 'co-parent-invitation') then
    if not private.invitation_mail_current_v1(v_outbox) then return; end if;
    select tc.* into strict v_candidate
    from public.token_candidates tc
    where tc.outbox_id = v_outbox.id
      and tc.target_kind = 'subject_invitation'
      and tc.target_id = v_outbox.target_id
      and tc.expires_at > clock_timestamp()
    for update;

    v_raw_token := rtrim(translate(
      encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'
    ), '=');
    v_token_hash := encode(extensions.digest(
      convert_to(v_raw_token, 'UTF8'), 'sha256'
    ), 'hex');

    update public.token_hashes
    set status = 'revoked', ended_at = clock_timestamp()
    where candidate_id = v_candidate.id and status = 'current';

    insert into public.token_hashes (
      candidate_id, token_hash, token_revision, status
    ) values (
      v_candidate.id, v_token_hash, v_candidate.token_revision, 'current'
    );

    update public.token_candidates
    set state = 'issued'
    where id = v_candidate.id;

    update public.subject_invitations
    set token_hash = v_token_hash
    where id = v_candidate.target_id
      and status = 'pending'
      and expires_at > clock_timestamp();
    if not found then
      raise exception using errcode = '55000', message = 'invitation is not current';
    end if;
  end if;

  -- The withdrawal link of an upload-time rights notice: a new raw token for
  -- the exact bound credential, rechecked here, replacing any earlier hash.
  if v_outbox.token_purpose = 'embryo-parent-withdrawal' then
    select tc.* into v_candidate
    from public.token_candidates tc
    where tc.outbox_id = v_outbox.id
      and tc.purpose = 'embryo-parent-withdrawal'
      and tc.target_kind = 'cohort'
      and tc.target_id = v_outbox.target_id
      and tc.expires_at > clock_timestamp()
    for update;
    if v_candidate.id is null or not private.embryo_withdrawal_current_v1(v_candidate.id) then return; end if;

    v_raw_token := rtrim(translate(
      encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'
    ), '=');
    v_token_hash := encode(extensions.digest(
      convert_to(v_raw_token, 'UTF8'), 'sha256'
    ), 'hex');

    update public.token_hashes
    set status = 'revoked', ended_at = clock_timestamp()
    where candidate_id = v_candidate.id and status = 'current';

    insert into public.token_hashes (
      candidate_id, token_hash, token_revision, status
    ) values (
      v_candidate.id, v_token_hash, v_candidate.token_revision, 'current'
    );

    update public.token_candidates
    set state = 'issued'
    where id = v_candidate.id;
  end if;

  return query
  select
    v_outbox.id,
    v_outbox.template_id,
    v_outbox.template_payload,
    private.mail_provider_attempt_key_v1(v_outbox),
    v_outbox.attempt_count,
    ecr.contact_ciphertext,
    v_raw_token
  from public.encrypted_contact_references ecr
  where ecr.id = v_outbox.contact_reference_id;
end;
$$;
