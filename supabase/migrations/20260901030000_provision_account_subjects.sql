-- Provision the subject-bound identity graph for every newly created account.
-- The v2 backfill created this graph for existing profiles, but the original
-- auth trigger only created a profile for accounts registered afterwards.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subject_id uuid;
  v_principal_id uuid;
begin
  insert into public.profiles (id, display_name)
  values (new.id, new.raw_user_meta_data ->> 'display_name');

  insert into public.subjects (
    owner_account_id,
    subject_account_id,
    subject_class,
    upload_class,
    display_label,
    lifecycle
  ) values (
    new.id,
    new.id,
    'self',
    'self',
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), 'You'),
    'active'
  )
  returning id into v_subject_id;

  insert into public.subject_principals (
    subject_id,
    account_id,
    principal_kind,
    status
  ) values (
    v_subject_id,
    new.id,
    'account_subject',
    'active'
  )
  returning id into v_principal_id;

  insert into public.subject_account_bindings (
    subject_id,
    subject_principal_id,
    account_id,
    account_principal_id,
    binding_kind,
    binding_revision,
    status
  ) values (
    v_subject_id,
    v_principal_id,
    new.id,
    v_principal_id,
    'self',
    1,
    'current'
  );

  insert into public.subject_relationships (
    subject_id,
    data_subject_principal_id,
    recipient_principal_id,
    recipient_account_id,
    relationship_kind,
    relationship_revision,
    status
  ) values (
    v_subject_id,
    v_principal_id,
    v_principal_id,
    new.id,
    'self',
    1,
    'current'
  );

  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to service_role;
