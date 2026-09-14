-- The one writer for public.subject_demographics.chromosomal_sex (D-031).
--
-- The column has existed since 20260831221537 with no writer, so ADR 0015 and
-- ADR 0017 both record that Inherit knows no person's chromosomal sex and the
-- carrier rule answers an X-linked pattern with a named reason instead of the
-- hundred-pregnancy split. This migration records the fact. It does NOT derive
-- it.
--
-- DECLARED, NEVER DERIVED. Inherit holds X and Y coverage for many files and
-- could guess from it. It does not, for two reasons that are already settled
-- elsewhere in this repository: ADR 0003 forbids imputing a value Inherit did
-- not read, and a guess from coverage is wrong for people with a sex
-- chromosome pattern other than XX or XY, for whom the guess would be both
-- incorrect and intrusive. The value comes from the person and from nobody
-- else.
--
-- AUTHORITY IS THE SUBJECT, NOT THE HOLDER. The writer accepts only a subject
-- the acting account IS (`subjects.subject_account_id`), never one it merely
-- holds (`owner_account_id`). An uploader who controls another adult's record
-- cannot declare that adult's chromosomal sex; that adult declares it from
-- their own session or it stays unrecorded. Minors and embryos are out of
-- reach by subject class, and the pre-existing
-- `subject_demographics_reject_embryo` trigger is a second fence under the
-- embryo half.
--
-- WITHDRAWAL IS A CALL WITH NULL. It clears the column, leaves any
-- `date_of_birth` on the same row alone, bumps the revision and writes its own
-- audit row. Nothing downstream keeps a copy: the value is read at the moment
-- a cross is computed and is never written into a result.
--
-- THE AUDIT ROW CARRIES NO VALUE. `legal_audit_log` is append-only and
-- hash-chained, and its retention prefix is checkpointed rather than rewritten,
-- so a value written there outlives the row it describes. The audit question is
-- "did this declaration change, when, and under which revision" — `revision`
-- and `action` answer it, and the current value lives in the row the person can
-- change or delete.

create or replace function public.declare_chromosomal_sex_v1(
  p_account_id uuid,
  p_subject_id uuid,
  p_chromosomal_sex text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subject public.subjects%rowtype;
  v_previous text;
  v_row public.subject_demographics%rowtype;
  v_action text;
begin
  if p_chromosomal_sex is not null
    and p_chromosomal_sex not in ('XX', 'XY', 'other', 'unknown') then
    raise exception using errcode = '22023', message = 'chromosomal sex value is not recognised';
  end if;

  select s.* into v_subject
  from public.subjects s
  where s.id = p_subject_id
    and s.subject_account_id = p_account_id
    and s.subject_class in ('self', 'other_adult')
    and s.lifecycle = 'active'
  for update;
  if v_subject.id is null then
    -- One refusal for "no such subject" and for "not yours", so the caller
    -- learns nothing about a subject it does not hold.
    raise exception using errcode = '42501',
      message = 'chromosomal sex authority is unavailable';
  end if;

  select d.chromosomal_sex into v_previous
  from public.subject_demographics d
  where d.subject_id = p_subject_id
  for update;

  -- Re-declaring the same value is a true no-op: no revision, no timestamp,
  -- no audit row. A revision that moved without the value moving would make
  -- every later audit read a change that did not happen.
  if v_previous is not distinct from p_chromosomal_sex then
    -- No row at all and nothing to record is also a no-op: withdrawing a
    -- declaration that was never made must not create the row it would then
    -- have to delete.
    select d.* into v_row from public.subject_demographics d where d.subject_id = p_subject_id;
    return jsonb_build_object(
      'chromosomalSex', v_row.chromosomal_sex,
      'revision', coalesce(v_row.demographics_revision, 0),
      'updatedAt', v_row.updated_at,
      'action', 'unchanged'
    );
  end if;

  insert into public.subject_demographics (subject_id, chromosomal_sex)
  values (p_subject_id, p_chromosomal_sex)
  on conflict (subject_id) do update
    set chromosomal_sex = excluded.chromosomal_sex,
        demographics_revision = public.subject_demographics.demographics_revision + 1,
        updated_at = clock_timestamp()
  returning * into v_row;

  if p_chromosomal_sex is null then
    v_action := 'withdrawn';
  elsif v_previous is null then
    v_action := 'declared';
  else
    v_action := 'replaced';
  end if;

  perform private.append_legal_audit_event(
    'demographics.chromosomal-sex', null, 'api.chromosomal-sex', 'accepted',
    jsonb_build_object('revision', v_row.demographics_revision, 'action', v_action)
  );

  return jsonb_build_object(
    'chromosomalSex', v_row.chromosomal_sex,
    'revision', v_row.demographics_revision,
    'updatedAt', v_row.updated_at,
    'action', v_action
  );
end;
$$;

revoke all on function public.declare_chromosomal_sex_v1(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.declare_chromosomal_sex_v1(uuid, uuid, text) to service_role;

-- The reader the settings surface uses to render what is currently recorded.
-- Same authority as the writer, so a page can never show a value the caller
-- could not have set.
create or replace function public.own_chromosomal_sex_v1(
  p_account_id uuid,
  p_subject_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subject public.subjects%rowtype;
  v_row public.subject_demographics%rowtype;
begin
  select s.* into v_subject
  from public.subjects s
  where s.id = p_subject_id
    and s.subject_account_id = p_account_id
    and s.subject_class in ('self', 'other_adult')
    and s.lifecycle = 'active';
  if v_subject.id is null then
    raise exception using errcode = '42501',
      message = 'chromosomal sex authority is unavailable';
  end if;

  select d.* into v_row
  from public.subject_demographics d
  where d.subject_id = p_subject_id;

  return jsonb_build_object(
    'chromosomalSex', v_row.chromosomal_sex,
    'revision', coalesce(v_row.demographics_revision, 0),
    'updatedAt', v_row.updated_at
  );
end;
$$;

revoke all on function public.own_chromosomal_sex_v1(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.own_chromosomal_sex_v1(uuid, uuid) to service_role;
