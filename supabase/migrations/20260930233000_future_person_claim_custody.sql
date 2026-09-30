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
create function private.guard_future_person_custody_slice_v1()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if to_jsonb(new) is distinct from to_jsonb(old) then
   raise exception using errcode='23514',message='claimant custody provenance is immutable';
 end if;
 return new;
end $$;
revoke all on function private.guard_future_person_custody_slice_v1() from public,anon,authenticated,service_role;
create trigger future_person_custody_slice_immutable before update on private.future_person_custody_slices
 for each row execute function private.guard_future_person_custody_slice_v1();
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
  perform 1 from public.attestation_contradictions where (subject_id=s.id or cohort_id=s.cohort_id)
    and resolved_at is null order by id for update;
  if exists(select 1 from public.attestation_contradictions where (subject_id=s.id or cohort_id=s.cohort_id)
    and resolved_at is null) then raise exception using errcode='42501',message='claim review unavailable'; end if;
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
  -- A parent cohort job's immutable source set contained this member. Its
  -- entire old capability is stale; only a freshly resolved remaining set
  -- can authorize a later job. This deletes no sibling source or result.
  update public.worker_jobs set status='cancelled',finished_at=v_now,claim_token_hash=null,
    claim_expires_at=null,claimed_by=null where status in('queued','running')
    and (file_id=x.file_id or (source_binding_kind='cohort-source-set' and source_binding_id=s.cohort_id));
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

  update public.mail_outbox m set state='invalidated',claimed_at=null,last_outcome_code='claimant_authority_stale'
  where m.state in('queued','claimed') and m.token_purpose='approved-future-person-release'
    and not exists(select 1 from public.token_candidates tc where tc.outbox_id=m.id
      and private.future_person_release_current_v1(tc.id));

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

  if v_outbox.token_purpose='approved-future-person-release' then
    select tc.* into v_candidate from public.token_candidates tc where tc.outbox_id=v_outbox.id for update;
    if v_candidate.id is null or not private.future_person_release_current_v1(v_candidate.id) then return; end if;
    v_raw_token:=rtrim(translate(encode(extensions.gen_random_bytes(32),'base64'),'+/','-_'),'=');
    v_token_hash:=encode(extensions.digest(convert_to(v_raw_token,'UTF8'),'sha256'),'hex');
    update public.token_hashes set status='revoked',ended_at=clock_timestamp()
      where candidate_id=v_candidate.id and status='current';
    insert into public.token_hashes(candidate_id,token_hash,token_revision,status)
      values(v_candidate.id,v_token_hash,v_candidate.token_revision,'current');
    update public.future_person_claim_release_credentials set credential_hash=v_token_hash
      where candidate_id=v_candidate.id and status='current';
    if not found then raise exception using errcode='42501',message='claim review unavailable'; end if;
    update public.token_candidates set state='issued' where id=v_candidate.id;
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

-- Retain the structural guard. Only user_id may change, and only along the
-- positive canonical claimant transition. Every other file field is identical.
create or replace function private.guard_structural_file_identity_v1()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if new.single_logical_sample_verified_at is not null
    and current_user not in('postgres','service_role','supabase_admin') then
    raise exception using errcode='42501',message='file_authority_required'; end if;
  if tg_op='UPDATE' and old.single_logical_sample_verified_at is not null
    and (new.user_id,new.subject_id,new.bucket_path,new.storage_object_id,new.size_bytes,new.sha256,
      new.source_sha256,new.structural_validator_version,new.single_logical_sample_verified_at)
    is distinct from (old.user_id,old.subject_id,old.bucket_path,old.storage_object_id,old.size_bytes,old.sha256,
      old.source_sha256,old.structural_validator_version,old.single_logical_sample_verified_at) then
    if current_user not in('postgres','service_role','supabase_admin')
      or (to_jsonb(new)-'user_id') is distinct from (to_jsonb(old)-'user_id')
      or not exists(select 1 from public.subjects s
        join public.embryos e on e.subject_id=s.id and e.status=s.lifecycle and e.cohort_id is null
        join private.future_person_custody_slices x on x.subject_id=s.id and x.source_file_id=new.id
          and x.claimant_principal_id=s.claimant_principal_id
        join private.embryo_canonical_sources cs on cs.file_id=x.source_file_id and cs.subject_id=s.id and cs.embryo_id=e.id
          and cs.source_sha256=x.source_sha256 and cs.membership_sha256=x.source_membership_sha256
        join public.future_person_claimant_principals cp on cp.id=x.claimant_principal_id and cp.status='current'
        join public.subject_principals sp on sp.id=cp.principal_id and sp.subject_id=s.id
          and sp.status='active' and sp.principal_kind='future_person'
        join public.future_person_claims c on c.id=cp.claim_id and c.status='approved' and c.embryo_id=e.id
          and c.claimant_principal_id=sp.id
        where s.id=new.subject_id and s.cohort_id is null and new.cohort_id is null and not new.is_cohort_file
          and ((s.lifecycle='claimed_unbound' and new.user_id is null and old.user_id is not null
            and s.owner_account_id is null and s.subject_account_id is null and sp.account_id is null
            and exists(select 1 from public.embryo_cohorts h where h.id=x.historical_cohort_id and h.owner_account_id=old.user_id))
          or (s.lifecycle='claimed_bound' and old.user_id is null and new.user_id=s.subject_account_id
            and s.owner_account_id=new.user_id and sp.account_id=new.user_id))) then
      raise exception using errcode='55000',message='immutable_file_identity';
    end if;
  end if;
  return new;
end $$;

-- Contact/authentication expiry does not delete the claimant's identity.
alter table public.future_person_claimant_principals
  add column contact_expires_at timestamptz,
  add column release_revision bigint not null default 1 check(release_revision>0);
alter table public.future_person_claim_release_credentials
  add column candidate_id uuid unique references public.token_candidates(id) on delete restrict,
  add column subject_id uuid references public.subjects(id) on delete restrict,
  add column subject_lifecycle_revision bigint,
  add column subject_binding_revision bigint,
  add column contact_reference_id uuid references public.encrypted_contact_references(id) on delete restrict,
  add constraint future_person_release_binding_shape check(
    num_nonnulls(candidate_id,subject_id,subject_lifecycle_revision,subject_binding_revision,contact_reference_id) in(0,5)
    and (subject_lifecycle_revision is null or (subject_lifecycle_revision>0 and subject_binding_revision>0)));

-- Reuse the existing externally rotated root revision catalogue, with a
-- distinct cryptographic purpose. A root still needed for a durable unbound
-- claimant cannot be retired after temporary contact expiry.
alter function private.hmac_key_revision_in_use_v1(text,bigint) rename to hmac_key_revision_in_use_before_claimant_v1;
create function private.hmac_key_revision_in_use_v1(p_keyring text,p_revision bigint)
returns boolean language sql stable security invoker set search_path='' as $$
 select private.hmac_key_revision_in_use_before_claimant_v1(p_keyring,p_revision)
   or (p_keyring='contact' and exists(select 1 from public.future_person_claimant_identity_hmacs h
     join public.future_person_claimant_principals c on c.id=h.claimant_principal_id and c.status='current'
     join public.subjects s on s.claimant_principal_id=c.id and s.lifecycle='claimed_unbound'
     where h.hmac_key_revision=p_revision));
$$;
revoke all on function private.hmac_key_revision_in_use_v1(text,bigint),
 private.hmac_key_revision_in_use_before_claimant_v1(text,bigint) from public,anon,authenticated,service_role;

create function private.future_person_release_current_v1(p_candidate uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.future_person_claim_release_credentials r
   join public.token_candidates tc on tc.id=r.candidate_id and tc.purpose='approved-future-person-release'
     and tc.target_kind='claimed-subject' and tc.target_id=r.subject_id and tc.token_revision=r.credential_revision
     and tc.expires_at=r.expires_at and tc.state in('pending','issued')
   join public.mail_outbox m on m.id=tc.outbox_id and m.token_purpose=tc.purpose and m.purpose=tc.purpose
     and m.target_kind=tc.target_kind and m.target_id=tc.target_id and m.token_target_id=tc.target_id
     and m.contact_reference_id=r.contact_reference_id and m.semantic_revision=r.credential_revision
     and m.expires_at=r.expires_at and m.state in('queued','claimed','submitted','delivered')
   join public.future_person_claimant_principals cp on cp.id=r.claimant_principal_id and cp.status='current'
     and cp.release_revision=r.credential_revision and cp.contact_expires_at>clock_timestamp()
   join public.subject_principals sp on sp.id=cp.principal_id and sp.status='active' and sp.principal_kind='future_person'
     and sp.account_id is null and sp.subject_id=r.subject_id and sp.id=m.recipient_principal_id
     and sp.principal_revision=m.recipient_authority_revision
   join public.future_person_claims c on c.id=r.claim_id and c.id=cp.claim_id and c.status='approved'
     and c.claimant_principal_id=sp.id and c.claimant_account_id is null
   join public.subjects s on s.id=r.subject_id and s.claimant_principal_id=cp.id and s.lifecycle='claimed_unbound'
     and s.owner_account_id is null and s.subject_account_id is null and s.cohort_id is null
     and s.lifecycle_revision=r.subject_lifecycle_revision and s.subject_binding_revision=r.subject_binding_revision
   join public.encrypted_contact_references contact on contact.id=r.contact_reference_id and contact.principal_id=sp.id
     and contact.status='current' and contact.contact_ciphertext is not null and contact.authority_revision=sp.principal_revision
   join private.future_person_custody_slices x on x.subject_id=s.id and x.claimant_principal_id=cp.id
   join private.embryo_canonical_sources cs on cs.file_id=x.source_file_id and cs.subject_id=s.id
     and cs.source_sha256=x.source_sha256 and cs.membership_sha256=x.source_membership_sha256
   where r.candidate_id=p_candidate and r.status='current' and r.expires_at>clock_timestamp());
$$;
revoke all on function private.future_person_release_current_v1(uuid) from public,anon,authenticated,service_role;

create function private.queue_future_person_release_v1(p_claim uuid,p_contact uuid,p_cipher bytea,p_contact_set jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare cp public.future_person_claimant_principals;sp public.subject_principals;s public.subjects;
  contact_set jsonb;active_revision bigint;outbox uuid;candidate uuid;expiry timestamptz;contact_expiry timestamptz;v_now timestamptz;
begin
 select * into cp from public.future_person_claimant_principals where claim_id=p_claim and status='current' for update;
 select * into sp from public.subject_principals where id=cp.principal_id for update;
 select * into s from public.subjects where id=sp.subject_id for update;
 if cp.id is null or s.lifecycle<>'claimed_unbound' or s.claimant_principal_id is distinct from cp.id
   or p_contact is null or p_cipher is null or octet_length(p_cipher) not between 29 and 16384 then
   raise exception using errcode='42501',message='claim review unavailable'; end if;
 contact_set:=private.resolve_hmac_set_v1('contact',null,p_contact_set);
 active_revision:=private.hmac_active_revision_v1('contact');v_now:=clock_timestamp();
 contact_expiry:=v_now+interval '24 months';expiry:=least(v_now+interval '7 days',contact_expiry);
 insert into public.encrypted_contact_references(id,principal_id,contact_ciphertext,contact_hmac,key_revision,authority_revision)
 values(p_contact,sp.id,p_cipher,contact_set->>active_revision::text,active_revision,sp.principal_revision);
 insert into public.contact_hmac_indexes(contact_reference_id,contact_hmac,hmac_key_revision,expires_at)
 select p_contact,value,key::bigint,contact_expiry from jsonb_each_text(contact_set);
 update public.future_person_claimant_principals set contact_expires_at=contact_expiry where id=cp.id;
 insert into public.mail_outbox(template_id,purpose,target_kind,target_id,recipient_principal_id,contact_reference_id,
   recipient_authority_revision,semantic_revision,idempotency_key,token_purpose,token_target_id,template_payload,expires_at)
 values('future-person-release','approved-future-person-release','claimed-subject',s.id,sp.id,p_contact,
   sp.principal_revision,cp.release_revision,encode(extensions.digest(convert_to('future-person-release-v1|'||cp.id||'|'||cp.release_revision,'UTF8'),'sha256'),'hex'),
   'approved-future-person-release',s.id,'{}',expiry) returning id into outbox;
 insert into public.token_candidates(outbox_id,purpose,target_kind,target_id,token_revision,expires_at)
 values(outbox,'approved-future-person-release','claimed-subject',s.id,cp.release_revision,expiry) returning id into candidate;
 insert into public.future_person_claim_release_credentials(claim_id,claimant_principal_id,credential_hash,credential_revision,status,
   expires_at,candidate_id,subject_id,subject_lifecycle_revision,subject_binding_revision,contact_reference_id)
 values(p_claim,cp.id,encode(extensions.gen_random_bytes(32),'hex'),cp.release_revision,'current',expiry,candidate,s.id,
   s.lifecycle_revision,s.subject_binding_revision,p_contact);
 insert into public.future_person_claim_notices(claim_id,outbox_id,notice_kind,notice_revision)
 values(p_claim,outbox,'release',cp.release_revision);
 if not private.future_person_release_current_v1(candidate) then
   raise exception using errcode='42501',message='claim review unavailable'; end if;
end $$;
revoke all on function private.queue_future_person_release_v1(uuid,uuid,bytea,jsonb) from public,anon,authenticated,service_role;

-- The obsolete nominal decision door cannot be called through an API role.
-- Its internal receipt/reviewer checks remain the common attested prerequisite.
revoke all on function public.decide_claim_review_v1(uuid,bigint,text,text,bytea),
 private.decide_claim_review_v1(uuid,bigint,text,text,bytea) from public,anon,authenticated,service_role;

create function private.shred_resolved_future_person_review_v1(p_review uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from private.claim_reviews where id=p_review and state in('refused','closed')
   and resolved_at is not null) then raise exception using errcode='42501',message='claim review unavailable';end if;
 update private.future_person_claim_intakes set identity_ciphertext=extensions.gen_random_bytes(29),
   wrapped_data_key=extensions.gen_random_bytes(29),
   key_hash=case when mode='keyless-start' then null else encode(extensions.gen_random_bytes(32),'hex') end,
   identifier_hmac=encode(extensions.gen_random_bytes(32),'hex'),network_hmac=encode(extensions.gen_random_bytes(32),'hex')
 where id=p_review;
 update private.claim_review_decisions set reason_ciphertext=extensions.gen_random_bytes(29),
   documentary_attestation_ciphertext=null,verified_identity_hmac=null,identity_hmac_revision=null,
   verified_date_of_birth=null,recorded_parent_link_confirmed=false where review_id=p_review;
 update private.claim_review_assignments set status='ended',ended_at=clock_timestamp() where review_id=p_review and status='current';
 update private.claim_review_downloads set expires_at=created_at where review_id=p_review;
end $$;
revoke all on function private.shred_resolved_future_person_review_v1(uuid) from public,anon,authenticated,service_role;

create function public.decide_claim_review_attested_v1(
 p_review_id uuid,p_review_revision bigint,p_decision text,p_nonce_hash text,p_reason_ciphertext bytea,
 p_attestation_ciphertext bytea,p_identity_hmac_set jsonb,p_verified_date_of_birth date,p_parent_link_confirmed boolean,
 p_contact_reference_id uuid,p_contact_ciphertext bytea,p_contact_hmac_set jsonb
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare r private.claim_reviews;e public.embryos;v_result jsonb;v_identity_set jsonb;v_revision bigint;
 sp uuid;cp uuid;intake uuid;v_now timestamptz;
begin
 select * into r from private.claim_reviews where id=p_review_id;
 if p_decision='approve-record-key' then
   select * into e from public.embryos where id=r.matched_embryo_id;
   perform 1 from public.subjects where id=e.subject_id for update;
   perform private.cancel_unstarted_claim_subject_purge_v1(e.subject_id);
 end if;
 if p_decision not in('reject','needs-more-information') then
   if p_decision<>'approve-record-key' or p_attestation_ciphertext is null
     or octet_length(p_attestation_ciphertext) not between 29 and 16384
     or p_verified_date_of_birth is null or p_verified_date_of_birth<date '1900-01-01'
     or (p_verified_date_of_birth+interval '18 years')::date>(clock_timestamp() at time zone 'UTC')::date
     or p_parent_link_confirmed is distinct from true then
     raise exception using errcode='42501',message='claim review unavailable'; end if;
   v_identity_set:=private.resolve_hmac_set_v1('contact',null,p_identity_hmac_set);
   v_revision:=private.hmac_active_revision_v1('contact');
 elsif num_nonnulls(p_attestation_ciphertext,p_identity_hmac_set,p_verified_date_of_birth)<>0
   or p_parent_link_confirmed is distinct from false then
   raise exception using errcode='42501',message='claim review unavailable';
 end if;
 v_result:=private.decide_claim_review_v1(p_review_id,p_review_revision,p_decision,p_nonce_hash,p_reason_ciphertext);
 if p_decision<>'approve-record-key' then
   if p_decision='reject' then perform private.shred_resolved_future_person_review_v1(p_review_id);end if;
   return v_result;
 end if;
 update private.claim_review_decisions set documentary_attestation_ciphertext=p_attestation_ciphertext,
   verified_identity_hmac=v_identity_set->>v_revision::text,identity_hmac_revision=v_revision,
   verified_date_of_birth=p_verified_date_of_birth,recorded_parent_link_confirmed=true
 where review_id=p_review_id and review_revision=p_review_revision;
 v_now:=clock_timestamp();
 insert into public.subject_principals(subject_id,principal_kind,status) values(e.subject_id,'future_person','active') returning id into sp;
 insert into public.future_person_claim_sessions(embryo_id,candidate_principal_id,intake_revision,state,expires_at)
 values(e.id,sp,1,'submitted',v_now+interval '1 hour') returning id into intake;
 insert into public.future_person_claims(id,intake_session_id,embryo_id,claimant_principal_id,claim_method,claim_revision,
   claimant_revision,status,decided_at) values(p_review_id,intake,e.id,sp,'record_key',1,1,'approved',v_now);
 insert into public.future_person_claimant_principals(claim_id,principal_id,claimant_revision,status)
 values(p_review_id,sp,1,'current') returning id into cp;
 perform private.detach_future_person_subject_v1(p_review_id);
 perform private.queue_future_person_release_v1(p_review_id,p_contact_reference_id,p_contact_ciphertext,p_contact_hmac_set);
 -- Shred every claim working value at final resolution. Object keys remain
 -- only until the already-registered Storage deletion worker confirms removal.
 update private.claim_reviews set state='closed',resolved_at=v_now where id=p_review_id;
 perform private.shred_resolved_future_person_review_v1(p_review_id);
 perform private.append_legal_audit_event('claim.resolved',null,'api.future-person-claim-review','accepted',jsonb_build_object('outcome','approved'));
 return v_result;
end $$;
revoke all on function public.decide_claim_review_attested_v1(uuid,bigint,text,text,bytea,bytea,jsonb,date,boolean,uuid,bytea,jsonb)
 from public,anon,authenticated,service_role;
grant execute on function public.decide_claim_review_attested_v1(uuid,bigint,text,text,bytea,bytea,jsonb,date,boolean,uuid,bytea,jsonb) to authenticated;

-- Preserve the old rejection/more-information interface for existing callers;
-- it cannot record a nominal approval without documentary attestation.
create or replace function public.decide_claim_review_v1(
 p_review_id uuid,p_review_revision bigint,p_decision text,p_nonce_hash text,p_reason_ciphertext bytea
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_decision is null or p_decision not in('reject','needs-more-information') then
   raise exception using errcode='42501',message='claim review unavailable';end if;
 return public.decide_claim_review_attested_v1(p_review_id,p_review_revision,p_decision,p_nonce_hash,
   p_reason_ciphertext,null,null,null,false,null,null,null);
end $$;
revoke all on function public.decide_claim_review_v1(uuid,bigint,text,text,bytea) from public,anon,authenticated,service_role;
grant execute on function public.decide_claim_review_v1(uuid,bigint,text,text,bytea) to authenticated;

-- Preserve every existing pre-submit branch, adding the exact claimant source.
create or replace function private.authorize_mail_submission_v1(p_outbox uuid,p_attempt smallint)
returns boolean language plpgsql security definer set search_path='' as $$
declare m public.mail_outbox%rowtype;
begin
 perform private.lock_invitation_transitions_v1();
 select * into m from public.mail_outbox where id=p_outbox for update;
 if m.id is null or m.state<>'claimed' or m.attempt_count is distinct from p_attempt
  or m.expires_at<=clock_timestamp() or m.invitation_terminal_notice_id is not null then return false; end if;
 if not exists(select 1 from public.encrypted_contact_references e
  join public.subject_principals sp on sp.id=e.principal_id
  where e.id=m.contact_reference_id and sp.id=m.recipient_principal_id
   and e.status='current' and e.contact_ciphertext is not null
   and e.authority_revision=m.recipient_authority_revision and sp.principal_revision=m.recipient_authority_revision
   and (sp.status='active' or (sp.status='pending' and m.token_purpose in('adult-subject-invitation','co-parent-invitation')))
 ) then return false; end if;
 if m.token_purpose in('adult-subject-invitation','co-parent-invitation') then
  if not private.invitation_mail_current_v1(m) or not exists(
   select 1 from public.token_candidates tc join public.token_hashes th on th.candidate_id=tc.id
   join public.subject_invitations i on i.id=tc.target_id and i.token_hash=th.token_hash
   where tc.outbox_id=m.id and tc.state='issued' and th.status='current'
  ) then return false; end if;
 end if;
 if m.token_purpose='embryo-parent-withdrawal' and not exists(
   select 1 from public.token_candidates tc join public.token_hashes th on th.candidate_id=tc.id
   where tc.outbox_id=m.id and tc.state='issued' and th.status='current'
    and private.embryo_withdrawal_current_v1(tc.id)
  ) then return false; end if;
 if m.token_purpose='approved-future-person-release' and not exists(
   select 1 from public.token_candidates tc join public.token_hashes th on th.candidate_id=tc.id
   join public.future_person_claim_release_credentials r on r.candidate_id=tc.id and r.credential_hash=th.token_hash
   where tc.outbox_id=m.id and tc.state='issued' and th.status='current'
     and private.future_person_release_current_v1(tc.id)
 ) then return false; end if;
 if m.template_id='report-ready' and private.file_ready_mail_current_v1(m) is not true then return false; end if;
 return true;
end;
$$;


insert into private.rights_session_purposes(session_purpose,matrix_purpose,invitation_kind,target_kind)
values('approved-future-person-release','approved-future-person-release',null,'claimed-subject');

-- A newly registered purpose does not turn another issuer's hash into claimant
-- authority. The release executor inserts while its exact token is current,
-- then consumes the token and credential in the same transaction.
create or replace function private.assert_rights_session_purpose_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from private.rights_session_purposes p
   where p.session_purpose=new.purpose and p.target_kind=new.target_kind) then
   raise exception using errcode='42501',message='rights purpose unavailable';
 end if;
 if tg_op='UPDATE' and old.purpose='approved-future-person-release'
   and (new.token_hash_id,new.principal_id,new.purpose,new.target_kind,new.target_id,new.authority_revision)
     is distinct from
       (old.token_hash_id,old.principal_id,old.purpose,old.target_kind,old.target_id,old.authority_revision) then
   raise exception using errcode='42501',message='rights purpose unavailable';
 end if;
 if new.purpose='approved-future-person-release' and
   (tg_op='INSERT' or old.purpose is distinct from new.purpose) and not exists(
     select 1 from public.token_hashes h
     join public.future_person_claim_release_credentials r on r.candidate_id=h.candidate_id
       and r.credential_hash=h.token_hash and r.status='current' and r.expires_at>clock_timestamp()
     join public.future_person_claimant_principals cp on cp.id=r.claimant_principal_id
       and cp.principal_id=new.principal_id and cp.release_revision=new.authority_revision
       and cp.release_revision=r.credential_revision
     where h.id=new.token_hash_id and h.status='current' and h.expires_at>clock_timestamp()
       and r.subject_id=new.target_id and new.status='active'
       and new.expires_at>clock_timestamp() and new.expires_at<=r.expires_at
       and new.expires_at<=h.expires_at and new.expires_at<=new.created_at+interval '60 minutes'
       and private.future_person_release_current_v1(h.candidate_id)
   ) then raise exception using errcode='42501',message='rights purpose unavailable';end if;
 return new;
end $$;
revoke all on function private.assert_rights_session_purpose_v1() from public,anon,authenticated,service_role;
drop trigger rights_sessions_registered_purpose on public.rights_sessions;
create trigger rights_sessions_registered_purpose before insert or update of
 token_hash_id,principal_id,purpose,target_kind,target_id,authority_revision on public.rights_sessions
 for each row execute function private.assert_rights_session_purpose_v1();

-- Existing invitation and withdrawal activation branches remain exact.
create or replace function public.activate_rights_session_v1(
  p_token_hash text,
  p_session_hash text,
  p_form_nonce text
)
returns table (
  purpose text,
  target_kind text,
  target_id uuid,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_token public.token_hashes%rowtype;
  v_purpose text;
  v_invitation public.subject_invitations%rowtype;
  v_draft public.embryo_cohort_drafts%rowtype;
  v_adult_draft public.adult_subject_drafts%rowtype;
  v_expires_at timestamptz;
  v_credential private.embryo_withdrawal_credentials%rowtype;
  v_release public.future_person_claim_release_credentials%rowtype;
  v_claimed_subject uuid;
begin
  -- Positive claimant lookup is read-only until the subject starts the common
  -- retention lock order. No token/purpose/target selector comes from the client.
  select r.subject_id into v_claimed_subject from public.future_person_claim_release_credentials r
    join public.token_hashes th on th.candidate_id=r.candidate_id and th.token_hash=r.credential_hash
    where th.token_hash=p_token_hash and th.status='current';
  if v_claimed_subject is not null then perform 1 from public.subjects where id=v_claimed_subject for update; end if;
  perform private.lock_invitation_transitions_v1();
  v_now := clock_timestamp();
  if p_token_hash is null or p_session_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or p_session_hash !~ '^[0-9a-f]{64}$' then
    return;
  end if;

  -- The activation form's one-time nonce is recorded before any read, so a
  -- replayed form fails closed even when its token is still current.
  perform private.consume_embryo_operation_nonce_v1(
    p_form_nonce, null, null, 'rights_activate', 'form', null
  );

  select th.* into v_token
  from public.token_hashes th
  where th.token_hash = p_token_hash and th.status = 'current'
  for update;
  if v_token.id is null then return; end if;

  select tc.purpose into v_purpose
  from public.token_candidates tc
  where tc.id = v_token.candidate_id;

  if v_purpose='approved-future-person-release' then
    if not private.future_person_release_current_v1(v_token.candidate_id) then return; end if;
    select * into v_release from public.future_person_claim_release_credentials
      where candidate_id=v_token.candidate_id and credential_hash=v_token.token_hash and status='current' for update;
    if v_release.id is null then return; end if;
    v_expires_at:=least(v_now+interval '60 minutes',v_release.expires_at);
    insert into public.rights_sessions(token_hash_id,principal_id,purpose,target_kind,target_id,
      authority_revision,session_hash,status,expires_at,created_at)
    select v_token.id,c.principal_id,'approved-future-person-release','claimed-subject',v_release.subject_id,
      c.release_revision,p_session_hash,'active',v_expires_at,v_now
    from public.future_person_claimant_principals c where c.id=v_release.claimant_principal_id;
    update public.token_hashes set status='consumed',ended_at=v_now where id=v_token.id;
    update public.future_person_claim_release_credentials set status='consumed' where id=v_release.id;
    perform private.append_legal_audit_event('rights.session.activated',null,'api.rights-activate','accepted',
      jsonb_build_object('purpose','approved-future-person-release'));
    return query select 'approved-future-person-release'::text,'claimed-subject'::text,v_release.subject_id,v_expires_at;
    return;
  end if;

  if v_purpose = 'adult-subject-invitation' then
    v_invitation := private.current_adult_subject_invitation_v1(v_token.id);
    if v_invitation.id is null or private.invitation_contact_barred_v1(v_invitation.email_hmac) then return; end if;

    select d.* into v_adult_draft
    from public.adult_subject_drafts d
    where d.subject_id = v_invitation.target_id
      and d.state = 'invited'
      and d.fixed_expires_at > v_now
    for update;
    if v_adult_draft.id is null then return; end if;

    v_expires_at := least(v_now + interval '24 hours', v_invitation.expires_at);

    insert into public.rights_sessions (
      token_hash_id, principal_id, purpose, target_kind, target_id,
      authority_revision, session_hash, status, expires_at
    ) values (
      v_token.id, v_invitation.invitee_principal_id, 'adult-subject-invitation',
      'subject', v_invitation.target_id, v_invitation.invitation_revision,
      p_session_hash, 'active', v_expires_at
    );

    update public.token_hashes
    set status = 'consumed', ended_at = v_now
    where id = v_token.id;

    perform private.append_legal_audit_event(
      'rights.session.activated', null, 'api.rights-activate', 'accepted',
      jsonb_build_object('purpose', 'adult-subject-invitation')
    );

    return query select
      'adult-subject-invitation'::text, 'subject'::text,
      v_invitation.target_id, v_expires_at;
    return;
  end if;

  -- An upload-time rights notice's withdrawal link: the exact credential the
  -- notice bound, still current, opens a session on its whole cohort.
  if v_purpose = 'embryo-parent-withdrawal' then
    if not private.embryo_withdrawal_current_v1(v_token.candidate_id) then return; end if;
    select b.* into strict v_credential from private.embryo_withdrawal_credentials b
      where b.candidate_id = v_token.candidate_id;
    select least(v_now + interval '24 hours', tc.expires_at) into strict v_expires_at
      from public.token_candidates tc where tc.id = v_token.candidate_id;

    insert into public.rights_sessions (
      token_hash_id, principal_id, purpose, target_kind, target_id,
      authority_revision, session_hash, status, expires_at
    ) values (
      v_token.id, v_credential.principal_id, 'embryo-parent-withdrawal',
      'cohort', v_credential.cohort_id, v_credential.participant_set_revision,
      p_session_hash, 'active', v_expires_at
    );

    update public.token_hashes
    set status = 'consumed', ended_at = v_now
    where id = v_token.id;

    perform private.append_legal_audit_event(
      'rights.session.activated', null, 'api.rights-activate', 'accepted',
      jsonb_build_object('purpose', 'embryo-parent-withdrawal')
    );

    return query select
      'embryo-parent-withdrawal'::text, 'cohort'::text, v_credential.cohort_id, v_expires_at;
    return;
  end if;

  if v_purpose is distinct from 'co-parent-invitation' then return; end if;

  v_invitation := private.current_co_parent_invitation_v1(v_token.id);
  if v_invitation.id is null or private.invitation_contact_barred_v1(v_invitation.email_hmac) then return; end if;

  select d.* into v_draft
  from public.embryo_cohort_drafts d
  where d.id = v_invitation.target_id
    and d.state in ('draft', 'evidence_pending', 'ready')
    and d.fixed_expires_at > v_now
  for update;
  if v_draft.id is null then return; end if;

  v_expires_at := least(v_now + interval '24 hours', v_invitation.expires_at);

  insert into public.rights_sessions (
    token_hash_id, principal_id, purpose, target_kind, target_id,
    authority_revision, session_hash, status, expires_at
  ) values (
    v_token.id, v_invitation.invitee_principal_id, 'co-parent-invitation',
    'cohort_draft', v_draft.id, v_invitation.invitation_revision,
    p_session_hash, 'active', v_expires_at
  );

  update public.token_hashes
  set status = 'consumed', ended_at = v_now
  where id = v_token.id;

  perform private.append_legal_audit_event(
    'rights.session.activated', null, 'api.rights-activate', 'accepted',
    jsonb_build_object('purpose', 'co-parent-invitation')
  );

  return query select
    'co-parent-invitation'::text, 'cohort_draft'::text, v_draft.id, v_expires_at;
end;
$$;
revoke all on function public.activate_rights_session_v1(text, text, text)
  from public, anon, authenticated;
grant execute on function public.activate_rights_session_v1(text, text, text)
  to service_role;

create function private.future_person_rights_session_v1(p_hash text,p_lock boolean)
returns public.rights_sessions language plpgsql security definer set search_path='' as $$
declare rs public.rights_sessions;
begin
 if p_hash is null or p_hash!~'^[0-9a-f]{64}$' then return null; end if;
 select * into rs from public.rights_sessions where session_hash=p_hash;
 if p_lock and rs.id is not null then
   perform 1 from public.subjects where id=rs.target_id for update;
   select * into rs from public.rights_sessions where id=rs.id for update;
 end if;
 if rs.id is null or rs.status<>'active' or rs.purpose<>'approved-future-person-release'
   or rs.target_kind<>'claimed-subject' or rs.expires_at<=clock_timestamp()
   or rs.expires_at>rs.created_at+interval '60 minutes' then return null; end if;
 if not exists(select 1 from public.token_hashes h
   join public.future_person_claim_release_credentials r on r.candidate_id=h.candidate_id
     and r.credential_hash=h.token_hash and r.status='consumed' and r.expires_at>clock_timestamp()
   join public.future_person_claimant_principals cp on cp.id=r.claimant_principal_id and cp.status='current'
     and cp.release_revision=rs.authority_revision and cp.release_revision=r.credential_revision
     and cp.contact_expires_at>clock_timestamp() and cp.principal_id=rs.principal_id
   join public.subject_principals sp on sp.id=cp.principal_id and sp.subject_id=rs.target_id
     and sp.status='active' and sp.principal_kind='future_person' and sp.account_id is null
   join public.subjects s on s.id=rs.target_id and s.id=r.subject_id and s.claimant_principal_id=cp.id
     and s.lifecycle='claimed_unbound' and s.owner_account_id is null and s.subject_account_id is null and s.cohort_id is null
     and s.lifecycle_revision=r.subject_lifecycle_revision and s.subject_binding_revision=r.subject_binding_revision
   join public.encrypted_contact_references e on e.id=r.contact_reference_id and e.principal_id=sp.id
     and e.status='current' and e.contact_ciphertext is not null and e.authority_revision=sp.principal_revision
   join private.future_person_custody_slices x on x.subject_id=s.id and x.claimant_principal_id=cp.id
   join private.embryo_canonical_sources cs on cs.file_id=x.source_file_id and cs.subject_id=s.id
     and cs.source_sha256=x.source_sha256 and cs.membership_sha256=x.source_membership_sha256
   where h.id=rs.token_hash_id and h.status='consumed') then return null; end if;
 return rs;
end $$;
revoke all on function private.future_person_rights_session_v1(text,boolean) from public,anon,authenticated,service_role;

create function public.future_person_rights_view_v1(p_session_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare rs public.rights_sessions;
begin
 rs:=private.future_person_rights_session_v1(p_session_hash,false);
 if rs.id is null then return null; end if;
 return jsonb_build_object('safeClaimedSubjectLabel','Your claimed record','lifecycleState','claimed_unbound',
   'retentionMaximumDays',null,'allowedActionIds',jsonb_build_array('export','delete','correct','analysis-stop','bind-account','create-recovery-key'));
end $$;
revoke all on function public.future_person_rights_view_v1(text) from public,anon,authenticated,service_role;
grant execute on function public.future_person_rights_view_v1(text) to service_role;

-- The page derives its signed operation controls statelessly. Only each
-- authorized mutation records a hash and consumes it once under the session.
create function private.consume_future_person_rights_nonce_v1(rs public.rights_sessions,p_nonce text)
returns void language plpgsql security definer set search_path='' as $$
declare v_nonce_hash text;revision bigint;
begin
 if p_nonce is null or p_nonce!~'^[A-Za-z0-9_-]{16,256}$' then
   raise exception using errcode='42501',message='claimant rights unavailable'; end if;
 v_nonce_hash:=encode(extensions.digest(convert_to(p_nonce,'UTF8'),'sha256'),'hex');
 if exists(select 1 from public.rights_nonces where rights_session_id=rs.id and rights_nonces.nonce_hash=v_nonce_hash) then
   raise exception using errcode='42501',message='claimant rights unavailable'; end if;
 select coalesce(max(nonce_revision),0)+1 into revision from public.rights_nonces where rights_session_id=rs.id;
 insert into public.rights_nonces(rights_session_id,nonce_hash,nonce_revision,expires_at,consumed_at)
 values(rs.id,v_nonce_hash,revision,least(rs.expires_at,clock_timestamp()+interval '10 minutes'),clock_timestamp());
end $$;
revoke all on function private.consume_future_person_rights_nonce_v1(public.rights_sessions,text) from public,anon,authenticated,service_role;

create function public.issue_future_person_recovery_key_v1(p_session_hash text,p_nonce text,p_key_hash text)
returns date language plpgsql security definer set search_path='' as $$
declare rs public.rights_sessions;cp public.future_person_claimant_principals;
begin
 rs:=private.future_person_rights_session_v1(p_session_hash,true);
 if rs.id is null or p_key_hash is null or p_key_hash!~'^[0-9a-f]{64}$'
   or not private.rights_action_permitted_v1(rs.purpose,'create-recovery-key','api.future-person-recovery-key') then
   raise exception using errcode='42501',message='claimant rights unavailable'; end if;
 select * into cp from public.future_person_claimant_principals where principal_id=rs.principal_id and status='current' for update;
 if exists(select 1 from public.future_person_recovery_key_hashes where claimant_principal_id=cp.id)
   or not exists(select 1 from public.future_person_claimant_identity_hmacs where claimant_principal_id=cp.id and expires_at is null) then
   raise exception using errcode='42501',message='claimant rights unavailable'; end if;
 perform private.consume_future_person_rights_nonce_v1(rs,p_nonce);
 insert into public.future_person_recovery_key_hashes(claimant_principal_id,recovery_key_hash,key_revision,status)
 values(cp.id,p_key_hash,cp.claimant_revision,'current');
 return (cp.contact_expires_at at time zone 'UTC')::date;
end $$;
revoke all on function public.issue_future_person_recovery_key_v1(text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.issue_future_person_recovery_key_v1(text,text,text) to service_role;

create function public.stop_future_person_analysis_v1(p_session_hash text,p_nonce text)
returns timestamptz language plpgsql security definer set search_path='' as $$
declare rs public.rights_sessions;stopped timestamptz;
begin
 rs:=private.future_person_rights_session_v1(p_session_hash,true);
 if rs.id is null or not private.rights_action_permitted_v1(rs.purpose,'analysis-stop','api.future-person-analysis-stop') then
   raise exception using errcode='42501',message='claimant rights unavailable'; end if;
 perform private.consume_future_person_rights_nonce_v1(rs,p_nonce);
 update public.subjects set analysis_stopped_at=coalesce(analysis_stopped_at,clock_timestamp())
   where id=rs.target_id returning analysis_stopped_at into stopped;
 update public.worker_jobs set status='cancelled',finished_at=clock_timestamp(),claim_token_hash=null,
   claim_expires_at=null,claimed_by=null where status in('queued','running')
   and file_id in(select id from public.genome_files where subject_id=rs.target_id)
   and kind not in('revoke_purge','retention_purge');
 return stopped;
end $$;
revoke all on function public.stop_future_person_analysis_v1(text,text) from public,anon,authenticated,service_role;
grant execute on function public.stop_future_person_analysis_v1(text,text) to service_role;
