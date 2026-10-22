-- policyResolvers.withdrawal-target-v1.purposeMatrix, held by the database.
--
-- The register names ten rights purposes, the target kind each may bind and
-- the actions and routes each may reach. Until now that matrix lived only in
-- the register and in each RPC's own literal purpose check. This makes it one
-- table the database enforces:
--
--  * every rights session must carry a purpose and stored target kind the
--    database knows, so a credential can never be minted for a target its
--    purpose does not name (withdrawal-target-v1.databaseConstraint);
--  * `private.rights_action_permitted_v1` is the one answer to "may a session
--    of this purpose take this action on this route", so a future-person
--    credential can never reach api.withdraw or token-target export, and an
--    invitation credential can never reach a future-person route.
--
-- `scripts/rights-purpose-matrix.test.ts` holds the seed below equal to the
-- register in both directions, so neither can drift from the other.

create table private.rights_purpose_matrix (
  purpose text not null check (purpose in (
    'adult-withdrawal', 'adult-subject-control', 'adult-upload-confirmation',
    'embryo-parent-withdrawal', 'embryo-record-key-card-delivery', 'invitation',
    'consent-reaffirm', 'appeal-evidence', 'future-person-claim-objection',
    'approved-future-person-release'
  )),
  -- Only the invitation purpose splits its actions by invitation kind.
  invitation_kind text check (invitation_kind in ('adult_subject', 'co_parent', 'identified_donor_subject')),
  action text not null check (action ~ '^[a-z][a-z-]{1,40}$'),
  route_id text not null check (route_id ~ '^api\.[a-z][a-z0-9-]{1,80}$'),
  check ((purpose = 'invitation') = (invitation_kind is not null)),
  unique nulls not distinct (purpose, invitation_kind, action, route_id)
);
alter table private.rights_purpose_matrix enable row level security;
revoke all on private.rights_purpose_matrix from public, anon, authenticated, service_role;

insert into private.rights_purpose_matrix (purpose, invitation_kind, action, route_id) values
  ('adult-withdrawal', null, 'refuse', 'api.withdraw'),
  ('adult-withdrawal', null, 'delete', 'api.withdraw'),
  ('adult-withdrawal', null, 'export', 'api.third-party-subject-export'),
  ('adult-subject-control', null, 'grant-purpose', 'api.consent-grant-rights'),
  ('adult-subject-control', null, 'revoke-purpose', 'api.consent-revoke-rights'),
  ('adult-subject-control', null, 'bind-account', 'api.adult-subject-bind'),
  ('adult-subject-control', null, 'refuse', 'api.withdraw'),
  ('adult-subject-control', null, 'delete', 'api.withdraw'),
  ('adult-subject-control', null, 'export', 'api.third-party-subject-export'),
  ('adult-upload-confirmation', null, 'confirm', 'api.withdraw'),
  ('adult-upload-confirmation', null, 'refuse', 'api.withdraw'),
  ('adult-upload-confirmation', null, 'delete', 'api.withdraw'),
  ('embryo-parent-withdrawal', null, 'refuse', 'api.withdraw'),
  ('embryo-parent-withdrawal', null, 'delete', 'api.withdraw'),
  ('embryo-parent-withdrawal', null, 'export', 'api.third-party-subject-export'),
  ('embryo-record-key-card-delivery', null, 'deliver-record-key-cards', 'api.embryo-record-key-cards-rights'),
  ('invitation', 'adult_subject', 'accept', 'api.invitation-accept'),
  ('invitation', 'adult_subject', 'confirm', 'api.withdraw'),
  ('invitation', 'adult_subject', 'refuse', 'api.withdraw'),
  ('invitation', 'adult_subject', 'delete', 'api.withdraw'),
  ('invitation', 'co_parent', 'accept', 'api.invitation-accept'),
  ('invitation', 'co_parent', 'refuse', 'api.withdraw'),
  ('invitation', 'identified_donor_subject', 'accept', 'api.invitation-accept'),
  ('invitation', 'identified_donor_subject', 'refuse', 'api.withdraw'),
  ('consent-reaffirm', null, 'reaffirm', 'api.consent-reaffirm-rights'),
  ('appeal-evidence', null, 'create-kind-bound-document-session', 'api.appeal-document-session'),
  ('appeal-evidence', null, 'complete-evidence-set', 'api.appeal-complete'),
  ('future-person-claim-objection', null, 'object', 'api.future-person-claim-objection'),
  ('approved-future-person-release', null, 'export', 'api.future-person-export'),
  ('approved-future-person-release', null, 'delete', 'api.future-person-delete'),
  ('approved-future-person-release', null, 'correct', 'api.future-person-correction'),
  ('approved-future-person-release', null, 'analysis-stop', 'api.future-person-analysis-stop'),
  ('approved-future-person-release', null, 'bind-account', 'api.future-person-claimant-bind'),
  ('approved-future-person-release', null, 'create-recovery-key', 'api.future-person-recovery-key');

-- The purpose names credentials actually store, and the one target kind each
-- may bind. A matrix purpose with no row here has no issuer yet, so no
-- session of it can exist. The invitation purpose is stored per kind, bound
-- to the draft the invitation reserves (withdrawal-target-v1.cases.invitation).
create table private.rights_session_purposes (
  session_purpose text primary key check (session_purpose ~ '^[a-z][a-z-]{2,60}$'),
  matrix_purpose text not null,
  invitation_kind text,
  target_kind text not null,
  unique (matrix_purpose, invitation_kind, target_kind)
);
alter table private.rights_session_purposes enable row level security;
revoke all on private.rights_session_purposes from public, anon, authenticated, service_role;
insert into private.rights_session_purposes (session_purpose, matrix_purpose, invitation_kind, target_kind)
values
  ('adult-subject-invitation', 'invitation', 'adult_subject', 'subject'),
  ('co-parent-invitation', 'invitation', 'co_parent', 'cohort_draft');

-- Every stored purpose must name a real matrix purpose (and kind).
create function private.assert_rights_session_purpose_row_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from private.rights_purpose_matrix m
    where m.purpose = new.matrix_purpose
      and m.invitation_kind is not distinct from new.invitation_kind
  ) then
    raise exception using errcode = '23514', message = 'rights purpose not in the matrix';
  end if;
  return new;
end;
$$;
revoke all on function private.assert_rights_session_purpose_row_v1()
  from public, anon, authenticated, service_role;
create trigger rights_session_purposes_in_matrix
  before insert or update on private.rights_session_purposes
  for each row execute function private.assert_rights_session_purpose_row_v1();

-- withdrawal-target-v1.databaseConstraint: a rights session's purpose and
-- target kind must match exactly one registered pair. Checked on every
-- insert and on any change to either column; nothing else is read.
create function private.assert_rights_session_purpose_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from private.rights_session_purposes p
    where p.session_purpose = new.purpose and p.target_kind = new.target_kind
  ) then
    raise exception using errcode = '42501', message = 'rights purpose unavailable';
  end if;
  return new;
end;
$$;
revoke all on function private.assert_rights_session_purpose_v1()
  from public, anon, authenticated, service_role;
create trigger rights_sessions_registered_purpose
  before insert or update of purpose, target_kind on public.rights_sessions
  for each row execute function private.assert_rights_session_purpose_v1();

-- The one gate for "may a session of this stored purpose take this action on
-- this route". Unknown purposes, actions and routes are all false.
create function private.rights_action_permitted_v1(
  p_session_purpose text, p_action text, p_route_id text
)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1
    from private.rights_session_purposes p
    join private.rights_purpose_matrix m
      on m.purpose = p.matrix_purpose
     and m.invitation_kind is not distinct from p.invitation_kind
    where p.session_purpose = p_session_purpose
      and m.action = p_action and m.route_id = p_route_id
  );
$$;
revoke all on function private.rights_action_permitted_v1(text, text, text)
  from public, anon, authenticated, service_role;
