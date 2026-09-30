begin;
select plan(28);
\ir fixtures/rights_invitation_pending.inc
-- policyResolvers.withdrawal-target-v1.purposeMatrix in the database. The
-- fixture above issues one real co-parent invitation; everything rolls back.

select is((select count(distinct purpose) from private.rights_purpose_matrix), 10::bigint,
  'the matrix names the register''s ten rights purposes');
select is((select count(*) from private.rights_purpose_matrix), 34::bigint,
  'with every registered action and route');
select is((select array_agg(session_purpose order by session_purpose) from private.rights_session_purposes),
  array['adult-subject-invitation', 'co-parent-invitation', 'embryo-parent-withdrawal'],
  'only the three purposes with an issuer can be stored on a session');
select is((select target_kind from private.rights_session_purposes where session_purpose = 'embryo-parent-withdrawal'),
  'cohort', 'an embryo withdrawal session binds the whole cohort, never one embryo');

-- The one gate.
select ok(private.rights_action_permitted_v1('adult-subject-invitation', 'confirm', 'api.withdraw'),
  'an adult invitation may be confirmed through api.withdraw');
select ok(private.rights_action_permitted_v1('adult-subject-invitation', 'delete', 'api.withdraw'),
  'and its reservation deleted there');
select ok(private.rights_action_permitted_v1('co-parent-invitation', 'refuse', 'api.withdraw'),
  'a co-parent invitation may be refused through api.withdraw');
select ok(private.rights_action_permitted_v1('co-parent-invitation', 'accept', 'api.invitation-accept'),
  'and accepted through api.invitation-accept');
select ok(not private.rights_action_permitted_v1('co-parent-invitation', 'confirm', 'api.withdraw'),
  'a co-parent invitation has no confirm action');
select ok(not private.rights_action_permitted_v1('co-parent-invitation', 'delete', 'api.withdraw'),
  'nor a delete action');
select ok(not private.rights_action_permitted_v1('adult-subject-invitation', 'accept', 'api.withdraw'),
  'an action is only permitted on its own registered route');
select ok(not private.rights_action_permitted_v1('adult-subject-invitation', 'export', 'api.future-person-export'),
  'an invitation credential can never reach a future-person route');
select ok(not private.rights_action_permitted_v1('approved-future-person-release', 'delete', 'api.withdraw'),
  'a purpose with no issuer permits nothing');
select ok(private.rights_action_permitted_v1('embryo-parent-withdrawal', 'refuse', 'api.withdraw')
  and private.rights_action_permitted_v1('embryo-parent-withdrawal', 'delete', 'api.withdraw'),
  'an embryo withdrawal session may refuse or delete through api.withdraw');
select ok(not private.rights_action_permitted_v1('embryo-parent-withdrawal', 'confirm', 'api.withdraw')
  and not private.rights_action_permitted_v1('embryo-parent-withdrawal', 'export', 'api.withdraw'),
  'and nothing else there');
select is((select count(*) from private.rights_purpose_matrix
  where purpose in ('approved-future-person-release', 'future-person-claim-objection')
    and route_id in ('api.withdraw', 'api.third-party-subject-export')), 0::bigint,
  'no future-person purpose names api.withdraw or token-target export');
select is((select count(*) from private.rights_purpose_matrix
  where purpose = 'approved-future-person-release' and route_id !~ '^api\.future-person-'), 0::bigint,
  'the approved release reaches future-person routes only');

-- withdrawal-target-v1.databaseConstraint on every rights session.
create temporary table held as
select id, token_hash_id, principal_id, target_id from public.rights_sessions
where token_hash_id = (select id from public.token_hashes where token_hash = (select hash from tok))
limit 0;
select is((select count(*) from public.activate_rights_session_v1(
  (select hash from tok), repeat('7',64), 'matrix-form-nonce-aaaaaaaaaaaa')), 1::bigint,
  'the fixture invitation opens a real session under a registered purpose');
insert into held select id, token_hash_id, principal_id, target_id from public.rights_sessions
where session_hash = repeat('7',64);
select throws_ok($$insert into public.rights_sessions
  (token_hash_id, principal_id, purpose, target_kind, target_id, authority_revision, session_hash, expires_at)
  select token_hash_id, principal_id, 'approved-future-person-release', 'claimed-subject', target_id, 1,
    repeat('8',64), clock_timestamp() + interval '10 minutes' from held$$,
  '42501', 'rights purpose unavailable', 'a session of a purpose with no issuer cannot be written');
select throws_ok($$insert into public.rights_sessions
  (token_hash_id, principal_id, purpose, target_kind, target_id, authority_revision, session_hash, expires_at)
  select token_hash_id, principal_id, 'co-parent-invitation', 'subject', target_id, 1,
    repeat('9',64), clock_timestamp() + interval '10 minutes' from held$$,
  '42501', 'rights purpose unavailable', 'a registered purpose cannot bind another purpose''s target kind');
select throws_ok($$update public.rights_sessions set purpose = 'adult-subject-invitation'
  where session_hash = repeat('7',64)$$,
  '42501', 'rights purpose unavailable', 'a live session cannot be moved to another purpose');
select throws_ok($$update public.rights_sessions set target_kind = 'subject'
  where session_hash = repeat('7',64)$$,
  '42501', 'rights purpose unavailable', 'or to another target kind');
select lives_ok($$update public.rights_sessions set expires_at = expires_at
  where session_hash = repeat('7',64)$$,
  'other columns of a registered session still change normally');
select throws_ok($$insert into private.rights_session_purposes
  (session_purpose, matrix_purpose, invitation_kind, target_kind)
  values ('invented-purpose', 'invented', null, 'subject')$$,
  '23514', 'rights purpose not in the matrix', 'a stored purpose must name a matrix purpose');

-- Nobody but the migration owner reads or changes the matrix.
select ok(not has_table_privilege(r, t, p), r||' cannot '||p||' '||t)
from unnest(array['anon','authenticated','service_role']) r
cross join unnest(array['private.rights_purpose_matrix','private.rights_session_purposes']) t
cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) p
where (r, t, p) in (('service_role','private.rights_purpose_matrix','INSERT'),
  ('service_role','private.rights_session_purposes','UPDATE'),
  ('authenticated','private.rights_purpose_matrix','SELECT'),
  ('anon','private.rights_session_purposes','SELECT'));
select ok(not has_function_privilege(r, 'private.rights_action_permitted_v1(text,text,text)', 'execute'),
  r||' cannot call the gate directly')
from unnest(array['anon','authenticated']) r;

select * from finish();
rollback;
