-- G5.6 and L-34: the legal audit events a person caused themselves.
--
-- The owner decided on 28 Sep 2026 (docs/protocol/decisions.md) that the
-- export carries the legal audit events a person caused themselves, and that
-- engineering records who acted on new events from here on. Every event so
-- far was written with a null audit principal, and nothing can recover who
-- caused it, so those events stay unattributed for good.
--
-- Who acted is derived at append time, inside private.append_legal_audit_event,
-- from proof the transaction already carries. None of the 29 writer functions
-- is redefined:
--
--   * consuming a session-bound, single-use operation nonce names the account
--     the operation was performed for. A trigger on each nonce table records
--     that account for the rest of the transaction. Two different accounts in
--     one transaction record a conflict, and a conflict attributes nothing;
--   * a request made with a user's own JWT (role authenticated) names its
--     subject. None of today's writers is callable that way; the rule is here
--     so that one which becomes callable is attributed rather than silently
--     left null.
--
-- An actor is recorded only on the closed list of events a person causes
-- themselves, and never on a job route. Purges, expiries, retention,
-- checkpoints and blocked responses are the service's own acts and stay null
-- even when a person's operation triggered them in the same transaction. A
-- new event code is unattributed until it is added to the list. Nothing is
-- ever guessed: no context, a conflict or an unlisted event records null.
--
-- Writers that authenticate without consuming a nonce (the jurisdiction
-- declaration, chromosomal sex, family sharing pauses, direct revocation,
-- portrait acknowledgement, adult-subject invitations and their responses)
-- therefore still record null. docs/export-legal-audit-resolver.md lists them
-- and what closes each.
--
-- The pseudonym. Each account that acts gets one random audit pseudonym
-- (public.audit_principals). private.legal_audit_account_principals links the
-- account to it and is deleted with the account, which leaves every ledger
-- row byte-identical and no longer linkable to anyone (L-49). The registered
-- encrypted link (public.audit_principal_links with an envelope key) needs a
-- key held outside the database, which an in-database append cannot use; the
-- link here is a plain row with a foreign key, registered as a purge store of
-- the same target.

-- When attribution began. The export says that events before it cannot be
-- shown as anyone's.
create table private.legal_audit_attribution_config (
  singleton boolean primary key default true check (singleton),
  started_at timestamptz not null
);
insert into private.legal_audit_attribution_config (singleton, started_at) values (true, clock_timestamp());
alter table private.legal_audit_attribution_config enable row level security;
revoke all on table private.legal_audit_attribution_config from public, anon, authenticated, service_role;

create table private.legal_audit_account_principals (
  account_id uuid primary key references auth.users (id) on delete cascade,
  audit_principal_id uuid not null unique references public.audit_principals (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp()
);
alter table private.legal_audit_account_principals enable row level security;
revoke all on table private.legal_audit_account_principals from public, anon, authenticated, service_role;

-- The link is deleted with the account; it belongs to the audit-link target.
insert into public.purge_target_stores (target_id, store_name, store_order)
select 'audit-principal-link-key-envelope', 'private.legal_audit_account_principals', coalesce(max(store_order), 0) + 1
from public.purge_target_stores where target_id = 'audit-principal-link-key-envelope';

-- Record the account a transaction acts for. A second, different account
-- turns the record into a conflict, which attributes nothing.
create function private.note_legal_audit_actor_v1(p_account_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_current text := pg_catalog.current_setting('inherit.legal_audit_actor', true);
begin
  if p_account_id is null then return; end if;
  if v_current is null or v_current = '' then
    perform pg_catalog.set_config('inherit.legal_audit_actor', p_account_id::text, true);
  elsif v_current <> p_account_id::text then
    perform pg_catalog.set_config('inherit.legal_audit_actor', 'conflict', true);
  end if;
end $$;
revoke all on function private.note_legal_audit_actor_v1(uuid) from public, anon, authenticated, service_role;

-- A consumed operation nonce is the proof: embryo and purpose-grant nonces are
-- consumed by inserting them, account operation nonces by setting consumed_at.
create function private.note_legal_audit_actor_from_nonce_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.note_legal_audit_actor_v1(new.account_id);
  elsif tg_op = 'UPDATE' and old.consumed_at is null and new.consumed_at is not null then
    perform private.note_legal_audit_actor_v1(new.account_id);
  end if;
  return null;
end $$;
revoke all on function private.note_legal_audit_actor_from_nonce_v1() from public, anon, authenticated, service_role;

create trigger legal_audit_actor_on_consume after insert on public.embryo_operation_nonces
  for each row execute function private.note_legal_audit_actor_from_nonce_v1();
create trigger legal_audit_actor_on_consume after insert on public.purpose_grant_nonces
  for each row execute function private.note_legal_audit_actor_from_nonce_v1();
create trigger legal_audit_actor_on_consume after update of consumed_at on public.account_operation_nonces
  for each row execute function private.note_legal_audit_actor_from_nonce_v1();

-- The account this transaction acts for, or null. Null when nothing names one,
-- when two accounts were named, or when a nonce and a user JWT disagree.
create function private.legal_audit_actor_account_v1()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_nonce text := nullif(pg_catalog.current_setting('inherit.legal_audit_actor', true), '');
  v_claims jsonb;
  v_jwt uuid;
begin
  begin
    v_claims := nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then
    v_claims := null;
  end;
  if pg_catalog.jsonb_typeof(v_claims) = 'object' and v_claims->>'role' = 'authenticated'
    and coalesce(v_claims->>'sub', '') ~ v_uuid then
    v_jwt := (v_claims->>'sub')::uuid;
  end if;
  if v_nonce is not null and v_nonce !~ v_uuid then return null; end if;
  if v_nonce is not null and v_jwt is not null and v_nonce <> v_jwt::text then return null; end if;
  return coalesce(v_nonce::uuid, v_jwt);
end $$;
revoke all on function private.legal_audit_actor_account_v1() from public, anon, authenticated, service_role;

-- The closed list of events a person causes themselves. Everything else,
-- including any code added later, is the service's and records no actor.
create function private.legal_audit_person_event_v1(p_event_code text, p_route_id text)
returns boolean language sql immutable set search_path = '' as $$
  select p_route_id is not null and p_route_id !~ '^(api\.)?jobs\.'
    and p_event_code = any (array[
      'demographics.chromosomal-sex',
      'embryo.artifact.signed',
      'embryo.cohort.finalized',
      'embryo.cohort.restricted',
      'embryo.disposition.proposed',
      'embryo.disposition.recorded',
      'embryo.draft.created',
      'embryo.record-key.delivered',
      'family.sharing_paused',
      'family.sharing_resumed',
      'family.sharing_stopped',
      'invitation.accepted',
      'invitation.deleted',
      'invitation.issued',
      'invitation.refused',
      'jurisdiction.declared',
      'jurisdiction.reaffirmed',
      'portrait.acknowledged',
      'purpose.granted',
      'purpose.revoked',
      'rights.session.activated'
    ]::text[])
$$;
revoke all on function private.legal_audit_person_event_v1(text, text) from public, anon, authenticated, service_role;

-- The acting account's pseudonym for a person's own event, created on first
-- use, or null.
create function private.legal_audit_actor_principal_v1(p_event_code text, p_route_id text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_account uuid;
  v_principal uuid;
begin
  if not private.legal_audit_person_event_v1(p_event_code, p_route_id) then return null; end if;
  v_account := private.legal_audit_actor_account_v1();
  if v_account is null or not exists (select 1 from auth.users where id = v_account) then return null; end if;
  -- One pseudonym per account, even when two transactions act at once.
  perform pg_catalog.pg_advisory_xact_lock(1229866068, pg_catalog.hashtext(v_account::text));
  select audit_principal_id into v_principal from private.legal_audit_account_principals where account_id = v_account;
  if v_principal is null then
    insert into public.audit_principals default values returning id into v_principal;
    insert into private.legal_audit_account_principals (account_id, audit_principal_id) values (v_account, v_principal);
  end if;
  return v_principal;
end $$;
revoke all on function private.legal_audit_actor_principal_v1(text, text) from public, anon, authenticated, service_role;

-- The single writer, unchanged except that a null principal is replaced by
-- the derived actor, which the chain hash covers like any other principal.
create or replace function private.append_legal_audit_event(
  p_event_code text,
  p_audit_principal_id uuid,
  p_route_id text,
  p_outcome_code text,
  p_coded_context jsonb default '{}'::jsonb
)
returns public.legal_audit_log
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev_seq bigint;
  v_prev_time timestamptz;
  v_prev_hash bytea;
  v_seq bigint;
  v_time timestamptz;
  v_hash bytea;
  v_row public.legal_audit_log;
  v_principal uuid;
begin
  v_principal := coalesce(p_audit_principal_id, private.legal_audit_actor_principal_v1(p_event_code, p_route_id));

  perform pg_catalog.pg_advisory_xact_lock(1229866068, 1);

  select l.seq, l.occurred_at, l.row_hash
    into v_prev_seq, v_prev_time, v_prev_hash
  from public.legal_audit_log l
  order by l.seq desc
  limit 1;

  if v_prev_seq is null then
    select c.removed_through_seq, c.removed_through_occurred_at, c.removed_through_row_hash
      into v_prev_seq, v_prev_time, v_prev_hash
    from public.legal_audit_retention_checkpoints c
    order by c.removed_through_seq desc
    limit 1;
  end if;

  v_seq := coalesce(v_prev_seq, 0) + 1;
  v_time := greatest(clock_timestamp(), coalesce(v_prev_time, '-infinity'::timestamptz));
  v_prev_hash := coalesce(v_prev_hash, decode(repeat('00', 32), 'hex'));
  v_hash := extensions.digest(
    pg_catalog.convert_to(
      v_seq::text || '|' || v_time::text || '|' || p_event_code || '|' ||
      coalesce(v_principal::text, '') || '|' || coalesce(p_route_id, '') || '|' ||
      p_outcome_code || '|' || coalesce(p_coded_context, '{}'::jsonb)::text || '|' ||
      encode(v_prev_hash, 'hex'),
      'utf8'
    ),
    'sha256'
  );

  perform pg_catalog.set_config('inherit.audit_mutation', 'on', true);
  insert into public.legal_audit_log (
    seq, occurred_at, event_code, audit_principal_id, route_id,
    outcome_code, coded_context, previous_hash, row_hash
  ) values (
    v_seq, v_time, p_event_code, v_principal, p_route_id,
    p_outcome_code, coalesce(p_coded_context, '{}'::jsonb), v_prev_hash, v_hash
  ) returning * into v_row;
  perform pg_catalog.set_config('inherit.audit_mutation', 'off', true);
  return v_row;
end;
$$;

-- One page of the events an account caused itself, in ledger order, with
-- listed columns only: never the pseudonym, the chain hashes or anyone
-- else's row.
create function private.legal_audit_account_events_v1(p_account_id uuid, p_after_seq bigint)
returns jsonb language sql stable security definer set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'events', coalesce(pg_catalog.jsonb_agg(x.row order by x.seq), '[]'::jsonb),
    'nextAfterSeq', case when count(*) = 500 then pg_catalog.to_jsonb(max(x.seq)) else 'null'::jsonb end)
  from (
    select l.seq, pg_catalog.jsonb_build_object('seq', l.seq, 'occurred_at', l.occurred_at, 'event_code', l.event_code,
      'route_id', l.route_id, 'outcome_code', l.outcome_code, 'coded_context', l.coded_context) as row
    from public.legal_audit_log l
    join private.legal_audit_account_principals m on m.audit_principal_id = l.audit_principal_id
    where m.account_id = p_account_id and l.seq > coalesce(p_after_seq, 0)
    order by l.seq
    limit 500
  ) x
$$;
revoke all on function private.legal_audit_account_events_v1(uuid, bigint) from public, anon, authenticated, service_role;

-- The synchronous export's door: the same account and session gate as the
-- rest of the export, then one page of the requester's own events.
create function public.own_legal_audit_events_v1(p_account_id uuid, p_session_id uuid, p_after_seq bigint default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_account_id is null or p_session_id is null or (p_after_seq is not null and p_after_seq < 0) then
    raise exception using errcode = '22023', message = 'invalid_request';
  end if;
  perform private.own_export_source_v1(p_account_id, p_session_id, null);
  return pg_catalog.jsonb_build_object('version', 'legal-audit-slice-v1',
    'attributionStartedAt', (select started_at from private.legal_audit_attribution_config where singleton))
    || private.legal_audit_account_events_v1(p_account_id, p_after_seq);
end $$;
revoke all on function public.own_legal_audit_events_v1(uuid, uuid, bigint) from public, anon, authenticated;
grant execute on function public.own_legal_audit_events_v1(uuid, uuid, bigint) to service_role;

-- The asynchronous export: the receipt covers the requester's own slice
-- (export-authority-v4), and the history reader gains a closed legal-audit
-- class. Both definitions are the live ones from
-- 20260925220000_export_archive_chat_reader.sql with only these additions.
create or replace function private.export_archive_authority_v1(p_origin jsonb,p_target_kind text,p_target_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare a uuid; sess uuid; p public.profiles%rowtype; ap public.subject_principals%rowtype;
 origin_binding text; receipt text; graph jsonb; subjects jsonb:='[]'; sources jsonb:='[]';
 s record; f record; snapshot jsonb; binding jsonb; session_revision bigint; file_ids uuid[]:='{}';
begin
 if p_origin is null or jsonb_typeof(p_origin)<>'object' then raise exception using errcode='22023',message='invalid_request'; end if;
 if p_origin->>'kind' is distinct from 'account' then
  raise exception using errcode='0A000',message='export_origin_projection_unavailable'; end if;
 if (select count(*) from jsonb_object_keys(p_origin))<>3 or not(p_origin ?& array['kind','accountId','sessionId'])
  or p_target_kind is null or p_target_kind not in ('account','subject') or p_target_id is null then
  raise exception using errcode='22023',message='invalid_request'; end if;
 a:=(p_origin->>'accountId')::uuid; sess:=(p_origin->>'sessionId')::uuid;
 perform private.own_export_source_v1(a,sess,null);
 select * into p from public.profiles where id=a;
 select coalesce(refresh_token_counter,0)+1 into session_revision from auth.sessions where id=sess and user_id=a;
 select sp.* into ap from public.subject_account_bindings b join public.subjects subj on subj.id=b.subject_id
  join public.subject_principals sp on sp.id=b.account_principal_id
  join public.subject_principals subject_p on subject_p.id=b.subject_principal_id
  where b.account_id=a and b.status='current' and subj.subject_class='self' and subj.subject_account_id=a
   and subj.lifecycle in ('active','restricted') and sp.account_id=a and sp.status='active' and sp.principal_kind='account_subject'
   and subject_p.account_id=a and subject_p.subject_id=subj.id and subject_p.status='active' and subject_p.principal_kind='account_subject';
 if ap.id is null then raise exception using errcode='42501',message='not_found'; end if;
 if p_target_kind='account' then
  if p_target_id<>a then raise exception using errcode='42501',message='not_found'; end if;
  if exists(select 1 from public.subjects where owner_account_id=a and lifecycle<>'purged'
    and (subject_account_id is distinct from a or subject_class not in ('self','other_adult')))
   or exists(select 1 from public.subjects where subject_account_id=a and lifecycle<>'purged'
    and subject_class not in ('self','other_adult'))
   or exists(select 1 from public.embryo_cohorts c where c.status<>'purged' and (c.owner_account_id=a or exists(
    select 1 from public.embryo_participant_sets ps join public.subject_principals sp on sp.id=ps.principal_id
     where ps.cohort_id=c.id and sp.account_id=a and ps.revoked_at is null)))
   or exists(select 1 from public.family_pairs pair join public.subjects subj on subj.id in (pair.subject_a_id,pair.subject_b_id)
    where pair.status<>'purged' and (subj.owner_account_id=a or subj.subject_account_id=a))
   or exists(select 1 from public.directional_grants d join public.purpose_grants g using(grant_id)
    join public.subject_principals recipient on recipient.id=d.recipient_principal_id
    where (d.recipient_account_id=a or recipient.account_id=a) and d.status='current' and g.revoked_at is null
      and (g.expires_at is null or g.expires_at>clock_timestamp()) and (g.target_kind<>'subject' or not exists(
       select 1 from public.subjects subj where subj.id=g.target_id and subj.subject_account_id=a and subj.subject_class in ('self','other_adult')))) then
   raise exception using errcode='0A000',message='export_partition_projection_unavailable';
  end if;
 end if;
 for s in select * from public.subjects where subject_account_id=a and lifecycle<>'purged'
  and (p_target_kind='account' or id=p_target_id) order by id for share loop
  if s.subject_class not in ('self','other_adult') or s.lifecycle not in ('active','restricted') then
   raise exception using errcode='0A000',message='export_partition_projection_unavailable'; end if;
  select jsonb_build_object('binding',to_jsonb(b),'subjectPrincipal',to_jsonb(sp),'accountPrincipal',to_jsonb(ac)) into binding
   from public.subject_account_bindings b join public.subject_principals sp on sp.id=b.subject_principal_id
    join public.subject_principals ac on ac.id=b.account_principal_id
   where b.subject_id=s.id and b.account_id=a and b.status='current' and sp.subject_id=s.id and sp.account_id=a
    and sp.status='active' and sp.principal_kind='account_subject' and ac.account_id=a and ac.status='active'
    and ac.principal_kind='account_subject';
  if binding is null then raise exception using errcode='42501',message='not_found'; end if;
  subjects:=subjects||jsonb_build_array(jsonb_build_object('subject',to_jsonb(s),'binding',binding));
  -- Enumerate every file: the content list's exclusion filter must not silently
  -- omit an uploading, mismatched or otherwise unavailable member.
  for f in select id from public.genome_files where subject_id=s.id order by id loop
   snapshot:=private.own_export_source_v1(a,sess,f.id);
   if snapshot is null then raise exception using errcode='55000',message='export_source_unavailable'; end if;
   sources:=sources||jsonb_build_array(snapshot); file_ids:=array_append(file_ids,f.id);
  end loop;
 end loop;
 if jsonb_array_length(subjects)=0 then raise exception using errcode='42501',message='not_found'; end if;
 origin_binding:=encode(extensions.digest(jsonb_build_object('origin',p_origin,'accountRevision',p.account_revision,
  'authSessionRevision',p.auth_session_revision,'sessionRevision',session_revision,
  'jurisdictionRevision',p.jurisdiction_revision,'principal',to_jsonb(ap))::text,'sha256'),'hex');
 graph:=jsonb_build_object('version','export-authority-v4','originBinding',origin_binding,'targetKind',p_target_kind,
  'targetId',p_target_id,'profile',to_jsonb(p),'subjects',subjects,'sources',sources,
  'principalGraphRevision',(select greatest(coalesce(max(principal_revision),1),1) from public.subject_principals where account_id=a),
  'grants',(select coalesce(jsonb_agg(jsonb_build_object('grant',to_jsonb(g),'signature',to_jsonb(sig),
    'artifact',to_jsonb(artifact),'live',g.revoked_at is null and (g.expires_at is null or g.expires_at>clock_timestamp())) order by g.grant_id),'[]')
    from public.purpose_grants g join public.consent_signatures sig on sig.id=g.signature_id
     join public.consent_artifacts artifact on artifact.artifact_key=g.artifact_key and artifact.version=g.artifact_version
    where g.target_kind='subject' and g.target_id in(select (x#>>'{subject,id}')::uuid from jsonb_array_elements(subjects)x)),
  'consents',(select coalesce(jsonb_agg(jsonb_build_object('consent',to_jsonb(c),
    'live',c.revoked_at is null and (c.expires_at is null or c.expires_at>clock_timestamp())) order by c.id),'[]') from public.subject_consents c
    where c.subject_id in(select (x#>>'{subject,id}')::uuid from jsonb_array_elements(subjects)x)),
  -- v2: the requester's own history, whole rows, so any change after capture
  -- (a new or revoked legacy consent, a principal, binding, consent or
  -- recipient-grant revision, a demographics edit, a new signature or
  -- attestation) fails the job rather than
  -- being exported against a receipt that no longer describes it.
  'history',jsonb_build_object(
   'legacyConsents',case when p_target_kind='account' then (select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]')
     from public.consent_grants c where c.user_id=a) else '[]'::jsonb end,
   'principals',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.subject_principals x
     where x.account_id=a and (p_target_kind='account' or x.subject_id=p_target_id)),
   'bindings',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.subject_account_bindings x
     where x.account_id=a and (p_target_kind='account' or x.subject_id=p_target_id)),
   'accountConsents',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.subject_consents x
     where x.account_id=a and (p_target_kind='account' or x.subject_id=p_target_id)),
   'recipientGrants',case when p_target_kind='account' then (select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]')
     from public.provider_recipient_grants x where x.account_id=a) else '[]'::jsonb end,
   'demographics',(select coalesce(jsonb_agg(to_jsonb(x) order by x.subject_id),'[]') from public.subject_demographics x
     where x.subject_id in(select (y#>>'{subject,id}')::uuid from jsonb_array_elements(subjects)y)),
   'signatures',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.consent_signatures x
     where x.signer_account_id=a and (p_target_kind='account' or (x.target_kind='subject' and x.target_id=p_target_id))),
   'attestations',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.attestations x
     where (x.principal_id in(select id from public.subject_principals where account_id=a)
       or x.signature_id in(select id from public.consent_signatures where signer_account_id=a))
      and (p_target_kind='account' or (x.target_kind='subject' and x.target_id=p_target_id))),
   -- v3: every own chat on a captured subject, with a digest of all its
   -- messages, so a new or changed message after capture fails the job.
   'chats',(select coalesce(jsonb_agg(jsonb_build_object('chat',to_jsonb(ch),'messages',encode(extensions.digest(
      coalesce((select jsonb_agg(to_jsonb(m) order by m.turn_ordinal,m.role,m.id) from public.chat_messages m
       where m.chat_id=ch.id),'[]'::jsonb)::text,'sha256'),'hex')) order by ch.id),'[]')
     from public.chats ch where ch.user_id=a
      and ch.subject_id in(select (y#>>'{subject,id}')::uuid from jsonb_array_elements(subjects)y)),
   -- v4: the legal audit events this account caused itself, whole rows, so an
   -- event it causes after capture fails the job. Account exports only: an
   -- event records no subject, so no subject export can select its own.
   'legalAudit',case when p_target_kind='account' then (select coalesce(jsonb_agg(to_jsonb(l) order by l.seq),'[]')
     from public.legal_audit_log l join private.legal_audit_account_principals m on m.audit_principal_id=l.audit_principal_id
     where m.account_id=a) else '[]'::jsonb end),
  'analysis',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]') from private.own_analysis_runs r where r.file_id=any(file_ids)));
 receipt:=encode(extensions.digest(graph::text,'sha256'),'hex');
 -- Capture returns only closed metadata and a digest. The digest also hashes
 -- stored analysis content internally; no raw variants or source bytes return.
 -- The archive producer must still prove complete authorized membership.
 return jsonb_build_object('principalId',ap.id,'principalHash',encode(extensions.digest(ap.id::text,'sha256'),'hex'),
  'originBinding',origin_binding,'authorityReceipt',receipt,'accountRevision',p.account_revision,
  'lifecycleRevision',case when p_target_kind='account' then p.account_revision else
   (select lifecycle_revision from public.subjects where id=p_target_id) end,
  'principalGraphRevision',(select greatest(coalesce(max(principal_revision),1),1) from public.subject_principals where account_id=a),
  'subjectPartitions',(select jsonb_agg(x#>'{subject,id}') from jsonb_array_elements(subjects)x),
  'fileCount',cardinality(file_ids));
end $$;

create or replace function public.export_archive_content_v1(p_operation text,p_export_id uuid,p_attempt_id uuid,
 p_authority_receipt text,p_payload jsonb default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare e public.generated_exports%rowtype; j private.export_archive_jobs%rowtype;
 att private.export_archive_attempts%rowtype; f public.genome_files%rowtype;
 authority jsonb; account_at uuid; session_at uuid; partitions uuid[]; file_at uuid; after_at uuid;
 offset_at integer; snapshot jsonb; page jsonb:='[]'; result jsonb; member uuid; last_at uuid;
 member_count integer:=0; purpose text; grant_authority jsonb; authorities jsonb:='{}';
 history_kind text; history_after uuid; seq_after bigint; last_seq bigint;
 chat_after uuid; chat_at uuid; ordinal_after bigint; chat_projection jsonb; chat_row public.chats%rowtype; cutoff bigint;
begin
 if p_operation is null or p_operation not in ('context','files','history','chats','chat-messages','check','variants','observed','reports','prs','ancestry')
  or p_export_id is null or p_attempt_id is null or p_authority_receipt is null
  or p_authority_receipt!~'^[0-9a-f]{64}$' then
  raise exception using errcode='22023',message='invalid_request'; end if;
 -- Closed payload shapes, validated before any authority or source read.
 if p_operation='context' then
  if p_payload is not null then raise exception using errcode='22023',message='invalid_request'; end if;
 elsif p_payload is null or jsonb_typeof(p_payload)<>'object' then
  raise exception using errcode='22023',message='invalid_request';
 elsif p_operation='files' then
  if (select count(*) from jsonb_object_keys(p_payload))<>1 or not(p_payload ? 'afterFileId')
   or jsonb_typeof(p_payload->'afterFileId') not in ('null','string') then
   raise exception using errcode='22023',message='invalid_request'; end if;
 elsif p_operation='chats' then
  if (select count(*) from jsonb_object_keys(p_payload))<>1 or not(p_payload ? 'afterChatId')
   or jsonb_typeof(p_payload->'afterChatId') not in ('null','string') then
   raise exception using errcode='22023',message='invalid_request'; end if;
 elsif p_operation='chat-messages' then
  if (select count(*) from jsonb_object_keys(p_payload))<>2 or not(p_payload ?& array['chatId','afterOrdinal'])
   or jsonb_typeof(p_payload->'chatId') is distinct from 'string'
   or jsonb_typeof(p_payload->'afterOrdinal') is distinct from 'number' or (p_payload->>'afterOrdinal')!~'^[0-9]{1,15}$' then
   raise exception using errcode='22023',message='invalid_request'; end if;
 elsif p_operation='history' then
  -- The legal audit class pages by ledger sequence, every other class by id.
  if (select count(*) from jsonb_object_keys(p_payload))<>2 or jsonb_typeof(p_payload->'kind') is distinct from 'string'
   or p_payload->>'kind' not in ('legacy-consents','subjects','demographics','principals','bindings','account-consents','recipient-grants',
    'signatures','attestations','legal-audit')
   or (p_payload->>'kind'<>'legal-audit' and (not(p_payload ? 'afterId') or jsonb_typeof(p_payload->'afterId') not in ('null','string')))
   or (p_payload->>'kind'='legal-audit' and (not(p_payload ? 'afterSeq') or jsonb_typeof(p_payload->'afterSeq') not in ('null','number')
    or (jsonb_typeof(p_payload->'afterSeq')='number' and (p_payload->>'afterSeq')!~'^[0-9]{1,18}$'))) then
   raise exception using errcode='22023',message='invalid_request'; end if;
 elsif (select count(*) from jsonb_object_keys(p_payload))<>(case when p_operation='check' then 2 else 3 end)
  or not(p_payload ?& array['fileId','snapshot']) or jsonb_typeof(p_payload->'fileId') is distinct from 'string'
  or jsonb_typeof(p_payload->'snapshot') is distinct from 'object'
  or (p_operation<>'check' and (not(p_payload ? 'offset') or jsonb_typeof(p_payload->'offset') is distinct from 'number'
   or (p_payload->>'offset')!~'^[0-9]{1,9}$')) then
  raise exception using errcode='22023',message='invalid_request';
 end if;
 begin
  if p_operation='files' and jsonb_typeof(p_payload->'afterFileId')='string' then after_at:=(p_payload->>'afterFileId')::uuid; end if;
  if p_operation='history' then
   history_kind:=p_payload->>'kind';
   if jsonb_typeof(p_payload->'afterId')='string' then history_after:=(p_payload->>'afterId')::uuid; end if;
   if jsonb_typeof(p_payload->'afterSeq')='number' then seq_after:=(p_payload->>'afterSeq')::bigint; end if;
  end if;
  if p_operation='chats' and jsonb_typeof(p_payload->'afterChatId')='string' then chat_after:=(p_payload->>'afterChatId')::uuid; end if;
  if p_operation='chat-messages' then
   chat_at:=(p_payload->>'chatId')::uuid; ordinal_after:=(p_payload->>'afterOrdinal')::bigint;
  end if;
  if p_operation not in ('context','files','history','chats','chat-messages') then file_at:=(p_payload->>'fileId')::uuid; end if;
 exception when invalid_text_representation then raise exception using errcode='22023',message='invalid_request';
 end;
 if p_operation not in ('context','files','history','chats','chat-messages','check') then offset_at:=(p_payload->>'offset')::integer; end if;

 -- Source locks before job/attempt locks, as in every authority-capable RPC.
 authority:=private.export_archive_current_v1(p_export_id,p_authority_receipt);
 select * into e from public.generated_exports where id=p_export_id for share;
 select * into j from private.export_archive_jobs where export_id=p_export_id for share;
 select * into att from private.export_archive_attempts where id=p_attempt_id and export_id=p_export_id for share;
 if att.id is null or j.active_attempt is distinct from att.id or att.state<>'writing'
  or att.lease_expires_at<=clock_timestamp() or att.authority_receipt is distinct from p_authority_receipt
  or e.status is distinct from 'building' or j.origin->>'kind' is distinct from 'account' then
  raise exception using errcode='42501',message='not_found'; end if;
 account_at:=(j.origin->>'accountId')::uuid; session_at:=(j.origin->>'sessionId')::uuid;
 select coalesce(array_agg(x::uuid order by x),'{}') into partitions from jsonb_array_elements_text(e.subject_partitions) x;
 if file_at is not null and not exists(select 1 from public.genome_files where id=file_at and subject_id=any(partitions)) then
  raise exception using errcode='42501',message='not_found'; end if;

 if p_operation='context' then
  -- Worker-internal only: never an archive member or a client response.
  result:=jsonb_build_object('exportId',e.id,'attemptId',att.id,'routeId',j.route_id,'exportContract',j.export_contract,
   'targetKind',e.target_kind,'targetId',e.target_id,'subjectPartitions',e.subject_partitions,
   'origin',jsonb_build_object('kind','account','accountId',account_at,'sessionId',session_at),
   'authorityReceipt',j.authority_receipt,'fileCount',(authority->>'fileCount')::integer,
   'leaseExpiresAt',att.lease_expires_at,'deadline',j.deadline);
 elsif p_operation='files' then
  -- Every in-scope file, including ones the older list filtered out: a file
  -- without an exact current source refuses the whole page, never disappears.
  for member in select gf.id from public.genome_files gf where gf.subject_id=any(partitions)
   and (after_at is null or gf.id>after_at) order by gf.id limit 100 loop
   snapshot:=private.own_export_source_v1(account_at,session_at,member);
   if snapshot is null then raise exception using errcode='55000',message='export_source_unavailable'; end if;
   page:=page||jsonb_build_array(snapshot); last_at:=member; member_count:=member_count+1;
  end loop;
  result:=jsonb_build_object('files',page,'nextAfterFileId',case when member_count=100 and exists(
   select 1 from public.genome_files gf where gf.subject_id=any(partitions) and gf.id>last_at) then to_jsonb(last_at) else 'null'::jsonb end);
 elsif p_operation='history' then
  -- The requester's own history, the same scoping as the synchronous
  -- export's subject record (src/lib/export/subject-record.ts): subjects and
  -- demographics are the captured partitions; the other classes are keyed to
  -- this account, and a subject export keeps only rows about that subject.
  -- Account-level classes belong to an account export only. Columns are
  -- listed, never whole rows, so a column added later is not exported by
  -- default. Keyset pages of 500 by id (demographics by subject id).
  if history_kind in ('legacy-consents','recipient-grants','legal-audit') and e.target_kind<>'account' then
   raise exception using errcode='22023',message='invalid_request'; end if;
  if history_kind='legacy-consents' then
   select coalesce(jsonb_agg(x.row order by x.id),'[]'),count(*),max(x.id::text)::uuid into page,member_count,last_at from (
    select c.id,jsonb_build_object('id',c.id,'provider_key',c.provider_key,'data_classes',c.data_classes,
     'granted_at',c.granted_at,'revoked_at',c.revoked_at) as row from public.consent_grants c
    where c.user_id=account_at and (history_after is null or c.id>history_after) order by c.id limit 500) x;
  elsif history_kind='subjects' then
   select coalesce(jsonb_agg(x.row order by x.id),'[]'),count(*),max(x.id::text)::uuid into page,member_count,last_at from (
    select s.id,jsonb_build_object('id',s.id,'subject_class',s.subject_class,'upload_class',s.upload_class,
     'display_label',s.display_label,'lifecycle',s.lifecycle,'subject_binding_revision',s.subject_binding_revision,
     'lifecycle_revision',s.lifecycle_revision,'created_at',s.created_at,'updated_at',s.updated_at,
     'portrait_acknowledged_at',s.portrait_acknowledged_at,'independent_login_at',s.independent_login_at) as row
    from public.subjects s where s.id=any(partitions) and (history_after is null or s.id>history_after) order by s.id limit 500) x;
  elsif history_kind='demographics' then
   select coalesce(jsonb_agg(x.row order by x.id),'[]'),count(*),max(x.id::text)::uuid into page,member_count,last_at from (
    select d.subject_id as id,jsonb_build_object('subject_id',d.subject_id,'date_of_birth',d.date_of_birth,
     'chromosomal_sex',d.chromosomal_sex,'demographics_revision',d.demographics_revision,'updated_at',d.updated_at) as row
    from public.subject_demographics d where d.subject_id=any(partitions)
     and (history_after is null or d.subject_id>history_after) order by d.subject_id limit 500) x;
  elsif history_kind='principals' then
   select coalesce(jsonb_agg(x.row order by x.id),'[]'),count(*),max(x.id::text)::uuid into page,member_count,last_at from (
    select p.id,jsonb_build_object('id',p.id,'subject_id',p.subject_id,'principal_kind',p.principal_kind,
     'principal_revision',p.principal_revision,'status',p.status,'created_at',p.created_at) as row
    from public.subject_principals p where p.account_id=account_at
     and (e.target_kind='account' or p.subject_id=e.target_id)
     and (history_after is null or p.id>history_after) order by p.id limit 500) x;
  elsif history_kind='bindings' then
   select coalesce(jsonb_agg(x.row order by x.id),'[]'),count(*),max(x.id::text)::uuid into page,member_count,last_at from (
    select b.id,jsonb_build_object('id',b.id,'subject_id',b.subject_id,'subject_principal_id',b.subject_principal_id,
     'account_principal_id',b.account_principal_id,'binding_kind',b.binding_kind,'binding_revision',b.binding_revision,
     'status',b.status,'bound_at',b.bound_at,'ended_at',b.ended_at) as row
    from public.subject_account_bindings b where b.account_id=account_at
     and (e.target_kind='account' or b.subject_id=e.target_id)
     and (history_after is null or b.id>history_after) order by b.id limit 500) x;
  elsif history_kind='account-consents' then
   select coalesce(jsonb_agg(x.row order by x.id),'[]'),count(*),max(x.id::text)::uuid into page,member_count,last_at from (
    select c.id,jsonb_build_object('id',c.id,'signature_id',c.signature_id,'subject_id',c.subject_id,'cohort_id',c.cohort_id,
     'consent_type',c.consent_type,'scope',c.scope,'provider_key',c.provider_key,'grant_revision',c.grant_revision,
     'granted_at',c.granted_at,'expires_at',c.expires_at,'revoked_at',c.revoked_at,'revocation_reason',c.revocation_reason,
     'copilot_recipient',c.copilot_recipient) as row
    from public.subject_consents c where c.account_id=account_at
     and (e.target_kind='account' or c.subject_id=e.target_id)
     and (history_after is null or c.id>history_after) order by c.id limit 500) x;
  elsif history_kind='signatures' then
   -- Never the encrypted signing name: a signature is exported as what was
   -- signed, about what, and when.
   select coalesce(jsonb_agg(x.row order by x.id),'[]'),count(*),max(x.id::text)::uuid into page,member_count,last_at from (
    select g.id,jsonb_build_object('id',g.id,'artifact_key',g.artifact_key,'artifact_version',g.artifact_version,
     'artifact_body_sha256',g.artifact_body_sha256,'signer_principal_id',g.signer_principal_id,'target_kind',g.target_kind,
     'target_id',g.target_id,'purpose',g.purpose,'statement_keys',g.statement_keys,'jurisdiction_code',g.jurisdiction_code,
     'jurisdiction_revision',g.jurisdiction_revision,'subject_binding_revision',g.subject_binding_revision,
     'signed_at',g.signed_at) as row
    from public.consent_signatures g where g.signer_account_id=account_at
     and (e.target_kind='account' or (g.target_kind='subject' and g.target_id=e.target_id))
     and (history_after is null or g.id>history_after) order by g.id limit 500) x;
  elsif history_kind='attestations' then
   select coalesce(jsonb_agg(x.row order by x.id),'[]'),count(*),max(x.id::text)::uuid into page,member_count,last_at from (
    select t.id,jsonb_build_object('id',t.id,'signature_id',t.signature_id,'principal_id',t.principal_id,
     'target_kind',t.target_kind,'target_id',t.target_id,'kind',t.kind,'statement_keys',t.statement_keys,
     'affirmed',t.affirmed,'attestation_revision',t.attestation_revision,'affirmed_at',t.affirmed_at) as row
    from public.attestations t where (t.principal_id in(select id from public.subject_principals where account_id=account_at)
      or t.signature_id in(select id from public.consent_signatures where signer_account_id=account_at))
     and (e.target_kind='account' or (t.target_kind='subject' and t.target_id=e.target_id))
     and (history_after is null or t.id>history_after) order by t.id limit 500) x;
  elsif history_kind='legal-audit' then
   -- The events this account caused itself (owner decision, 28 Sep 2026), by
   -- ledger sequence: never the pseudonym, the chain hashes or another
   -- account's event, and never an event that records no actor.
   select coalesce(jsonb_agg(x.row order by x.seq),'[]'),count(*),max(x.seq) into page,member_count,last_seq from (
    select l.seq,jsonb_build_object('seq',l.seq,'occurred_at',l.occurred_at,'event_code',l.event_code,
     'route_id',l.route_id,'outcome_code',l.outcome_code,'coded_context',l.coded_context) as row
    from public.legal_audit_log l join private.legal_audit_account_principals m on m.audit_principal_id=l.audit_principal_id
    where m.account_id=account_at and (seq_after is null or l.seq>seq_after) order by l.seq limit 500) x;
  else
   select coalesce(jsonb_agg(x.row order by x.id),'[]'),count(*),max(x.id::text)::uuid into page,member_count,last_at from (
    select g.id,jsonb_build_object('id',g.id,'recipient_principal_id',g.recipient_principal_id,'provider_id',g.provider_id,
     'purpose',g.purpose,'artifact_key',g.artifact_key,'artifact_version',g.artifact_version,'grant_revision',g.grant_revision,
     'model_recipient_revision',g.model_recipient_revision,'status',g.status,'created_at',g.created_at,'ended_at',g.ended_at) as row
    from public.provider_recipient_grants g where g.account_id=account_at
     and (history_after is null or g.id>history_after) order by g.id limit 500) x;
  end if;
  -- A full page says whether more follow; the next call starts after it.
  result:=case when history_kind='legal-audit' then jsonb_build_object('kind',history_kind,'rows',page,
    'nextAfterSeq',case when member_count=500 then to_jsonb(last_seq) else 'null'::jsonb end)
   else jsonb_build_object('kind',history_kind,'rows',page,
    'nextAfterId',case when member_count=500 then to_jsonb(last_at) else 'null'::jsonb end) end;
 elsif p_operation in ('chats','chat-messages') then
  -- Own Copilot conversations on a captured subject. A chat is exportable
  -- while the Copilot grant it was created under (and, for a cloud model,
  -- the provider consent) is still the same current revision. The export
  -- reads those grants directly and never the provider configuration or its
  -- transport; changing or deleting the settings supersedes the grants, which
  -- ends the chats here exactly as it ends them in the chat history and
  -- queues their deletion. Legacy unverified chats and every other scope are
  -- not exported. Within a chat,
  -- the first turn answered under a data projection that no longer holds, and
  -- everything after it, is omitted whole (chat-history-projection-v1); a
  -- chat with nothing left is not listed. Only the closed history fields
  -- leave: no target ids, grant revisions, projections or provider payloads.
  if p_operation='chats' then
   select coalesce(jsonb_agg(x.row order by x.id),'[]'),count(*),max(x.id::text)::uuid into page,member_count,last_at from (
    select ch.id,jsonb_build_object('id',ch.id,'subject_id',ch.subject_id,'scope_kind',ch.scope_kind,'created_at',ch.created_at,
     'message_count',(q.v->>'count')::integer) as row
    from public.chats ch cross join lateral (select private.export_archive_chat_messages_v1(account_at,session_at,ch.id,null,null) v) q
    where ch.user_id=account_at and ch.subject_id=any(partitions)
     and (e.target_kind='account' or ch.subject_id=e.target_id)
     and (chat_after is null or ch.id>chat_after) and (q.v->>'count')::integer>0
    order by ch.id limit 100) x;
   result:=jsonb_build_object('chats',page,'nextAfterChatId',case when member_count=100 then to_jsonb(last_at) else 'null'::jsonb end);
  else
   select * into chat_row from public.chats where id=chat_at and user_id=account_at and subject_id=any(partitions)
    and (e.target_kind='account' or subject_id=e.target_id);
   if chat_row.id is null then raise exception using errcode='42501',message='not_found'; end if;
   result:=private.export_archive_chat_messages_v1(account_at,session_at,chat_row.id,ordinal_after,200);
   if (result->>'count')::integer=0 and ordinal_after=0 then raise exception using errcode='42501',message='not_found'; end if;
   result:=result-'count';
  end if;
 elsif p_operation in ('check','variants','observed','ancestry') then
  -- The existing per-file projection keeps its own snapshot, source and grant
  -- checks; ancestry already requires a current grant on both backends.
  result:=private.own_subject_export_content_v1(p_operation,account_at,session_at,file_at,p_payload->'snapshot',coalesce(offset_at,0));
 else
  snapshot:=private.own_export_source_v1(account_at,session_at,file_at);
  if snapshot is null or snapshot is distinct from p_payload->'snapshot' then
   raise exception using errcode='42501',message='not_found'; end if;
  if snapshot ? 'preparedSource' then
   -- The prepared backend already applies the current-purpose gate.
   result:=private.own_subject_export_content_v1(p_operation,account_at,session_at,file_at,snapshot,offset_at);
  elsif not (snapshot->>'normalized')::boolean then result:='[]';
  else
   -- The database backend gets the same gate the older helper applies only to
   -- prepared sources: a completed run is exported only under its purpose's
   -- current grant. Saved results are returned verbatim, never regenerated.
   select * into f from public.genome_files where id=file_at;
   foreach purpose in array array['reports.monogenic','reports.polygenic'] loop
    if p_operation='prs' and purpose<>'reports.polygenic' then continue; end if;
    grant_authority:=null;
    begin
     grant_authority:=private.current_own_report_grant_read_v1(account_at,session_at,f.id,purpose);
     if private.own_analysis_completion_matches_v1(f.id,purpose,grant_authority) is not true then grant_authority:=null; end if;
    exception when insufficient_privilege or object_not_in_prerequisite_state then grant_authority:=null;
    end;
    if grant_authority is not null then authorities:=authorities||jsonb_build_object(purpose,grant_authority); end if;
   end loop;
   with completed as (select r.* from private.own_analysis_runs r where r.file_id=f.id and r.subject_id=f.subject_id
    and r.state='complete' and r.completed_at is not null and r.computation_revision='own-reports-v1'
    and r.source_revision=f.upload_revision and r.source_sha256=f.sha256
    and r.normalization_completed_at=f.normalization_completed_at
    and r.authority->'context'->'subjectBindingRevision'=snapshot->'binding'->'subjectBindingRevision'
    and authorities ? r.purpose and private.own_analysis_completion_matches_v1(f.id,r.purpose,authorities->r.purpose) is true)
   select case when p_operation='reports' then
    (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select r.purpose,r.completed_at,report.value as report
     from completed r cross join lateral jsonb_array_elements(r.result->'reports') with ordinality report(value,ordinality)
     where r.purpose in ('reports.monogenic','reports.polygenic') order by r.purpose,report.ordinality offset offset_at limit 1000) x)
    else (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select v.pgs_id,v.matched,v.computed_at,
     m.name,m.trait,m.ancestry_note,m.n_variants from public.user_prs v left join public.prs_scores m using(pgs_id)
     where v.file_id=f.id and v.subject_id=f.subject_id and v.user_id=f.user_id
      and exists(select 1 from completed r where r.purpose='reports.polygenic')
     order by v.id offset offset_at limit 1000) x) end into result;
   for purpose,grant_authority in select key,value from jsonb_each(authorities) loop
    if private.current_own_report_grant_read_v1(account_at,session_at,f.id,purpose) is distinct from grant_authority
     or private.own_analysis_completion_matches_v1(f.id,purpose,grant_authority) is not true then
     raise exception using errcode='42501',message='not_found'; end if;
   end loop;
   if private.own_export_source_v1(account_at,session_at,file_at) is distinct from snapshot then
    raise exception using errcode='42501',message='not_found'; end if;
  end if;
 end if;

 -- The same job, attempt, lease and full graph must still hold after the read.
 perform private.export_archive_current_v1(p_export_id,p_authority_receipt);
 if not exists(select 1 from private.export_archive_attempts a join private.export_archive_jobs job on job.active_attempt=a.id
   where a.id=att.id and a.export_id=p_export_id and a.state='writing' and a.lease_expires_at>clock_timestamp()
    and a.authority_receipt=p_authority_receipt) then
  raise exception using errcode='42501',message='not_found'; end if;
 return result;
end $$;
