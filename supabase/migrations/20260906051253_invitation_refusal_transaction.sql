-- Durable, minimal notice intents survive deletion of the invitation draft.
-- They are not send authority: the mail worker must recheck the recipient
-- before materializing/submitting the canonical mail_outbox entry.
create table private.invitation_terminal_notices (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid not null,
  notice_kind text not null check (notice_kind in (
    'invitation-refused', 'draft-cancelled', 'donor-attribution-ended'
  )),
  recipient_kind text not null check (recipient_kind in ('contact', 'account')),
  contact_ciphertext bytea,
  recipient_account_id uuid,
  recipient_authority_revision bigint not null check (recipient_authority_revision > 0),
  idempotency_key text not null unique check (idempotency_key ~ '^[0-9a-f]{64}$'),
  state text not null default 'pending' check (state in ('pending', 'enqueued', 'expired')),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  check (expires_at > created_at and expires_at <= created_at + interval '30 days'),
  check (
    (state = 'pending' and (
      (recipient_kind = 'contact' and contact_ciphertext is not null and recipient_account_id is null)
      or (recipient_kind = 'account' and recipient_account_id is not null and contact_ciphertext is null)
    ))
    or (state in ('enqueued', 'expired') and contact_ciphertext is null and recipient_account_id is null)
  )
);
alter table private.invitation_terminal_notices enable row level security;
revoke all on private.invitation_terminal_notices from public, anon, authenticated, service_role;
create index invitation_terminal_notices_pending_idx
  on private.invitation_terminal_notices(created_at) where state='pending';
insert into public.purge_target_stores(target_id,store_name,store_order)
values ('mail-token-and-rights-delivery-state','private.invitation_terminal_notices',8);

-- All invitation mutators must acquire this before their own row locks.
-- A shared transaction lock also serializes aliases while key versions overlap.
-- Integration with issuance, legacy adult actions and provider submission is
-- required before exposing the refusal RPC.
create or replace function private.lock_invitation_transitions_v1()
returns void language sql volatile security invoker set search_path='' as $$
  select pg_advisory_xact_lock(1869509217, 1);
$$;
revoke all on function private.lock_invitation_transitions_v1()
  from public,anon,authenticated,service_role;

-- Resolve the stored version aliases without ever decrypting a contact.
-- Every hop is a current contact-reference index, or an already-established
-- bar alias from the same explicit refusal. The latter survives draft purge.
create or replace function private.invitation_contact_aliases_v1(p_hmac text)
returns text[] language sql stable security invoker set search_path='' as $$
  with recursive edges(a,b) as (
    select e.contact_hmac,h.contact_hmac
    from public.encrypted_contact_references e
    join public.contact_hmac_indexes h on h.contact_reference_id=e.id
    where h.status='current' and h.expires_at>statement_timestamp()
    union
    select a.contact_hmac,b.contact_hmac
    from public.contact_refusal_bars a
    join public.contact_refusal_bars b
      on b.target_kind=a.target_kind and b.target_id=a.target_id
      and b.refusal_revision=a.refusal_revision
    where a.expires_at>statement_timestamp() and b.expires_at>statement_timestamp()
  ), aliases(hmac) as (
    select p_hmac
    union
    select case when e.a=a.hmac then e.b else e.a end
    from aliases a join edges e on e.a=a.hmac or e.b=a.hmac
  )
  select array_agg(hmac order by hmac) from aliases;
$$;
revoke all on function private.invitation_contact_aliases_v1(text)
  from public,anon,authenticated,service_role;

-- Freeze a narrow draft purge. These are draft IDs, never live cohort/source
-- IDs. An existing later expiry is brought forward, never extended.
create or replace function private.queue_refused_invitation_draft_v1(
 p_kind text, p_draft_id uuid, p_deadline timestamptz, p_revision bigint
)
returns void language plpgsql security invoker set search_path='' as $$
declare
 v_retention text; v_phase text; v_target text; v_class text;
 v_row uuid; v_manifest uuid; v_now timestamptz:=clock_timestamp();
begin
 if p_kind='co_parent' then
  v_retention:='embryo.cohort-draft-30d'; v_phase:='embryo-cohort-draft-expiry';
  v_target:='cohort'; v_class:='cohort-draft-complete';
 elsif p_kind='adult_subject' then
  v_retention:='adult.subject-draft-30d'; v_phase:='adult-subject-draft-expiry';
  v_target:='subject'; v_class:='adult-draft-complete';
 else
  raise exception using errcode='22023',message='invalid draft purge kind';
 end if;
 select id into v_row from public.retention_rows
 where retention_id=v_retention and target_kind=v_target and target_id=p_draft_id
   and state in ('scheduled','active')
 order by retention_revision desc limit 1 for update;
 if v_row is null then
  insert into public.retention_rows(
   retention_id,target_kind,target_id,retention_revision,target_lifecycle_revision,
   disposition_revision,fixed_deadline,state)
  values(v_retention,v_target,p_draft_id,p_revision,p_revision,1,least(p_deadline,v_now),'active')
  returning id into v_row;
  insert into public.retention_due_phases(
   retention_row_id,retention_id,phase_id,phase_kind,phase_revision,phase_deadline,
   target_kind,target_id,target_lifecycle_revision,disposition_revision,
   recipient_authority_kind,recipient_authority_revision,immutable_envelope)
  values(v_row,v_retention,v_phase,'compound-atomic',1,least(p_deadline,v_now),
   v_target,p_draft_id,p_revision,1,'invitation-terminal',p_revision,
   jsonb_build_object('draftId',p_draft_id,'reason','invitation-refused'));
 else
  update public.retention_due_phases set
   phase_deadline=least(phase_deadline,v_now),
   immutable_envelope=jsonb_build_object('draftId',p_draft_id,'reason','invitation-refused')
  where retention_row_id=v_row and phase_id=v_phase and status='pending';
 end if;
 select id into v_manifest from public.purge_manifests
 where retention_row_id=v_row and phase_id=v_phase and state='frozen'
 order by manifest_revision desc limit 1 for update;
 if v_manifest is null then
  insert into public.purge_manifests(
   retention_row_id,phase_id,phase_revision,manifest_class,manifest_revision,
   source_binding_fingerprint,state)
  values(v_row,v_phase,1,v_class,1,encode(extensions.digest(convert_to(
   concat_ws(':','invitation-refusal-v1',p_kind,p_draft_id::text,p_revision::text),'UTF8'),
   'sha256'),'hex'),'frozen') returning id into v_manifest;
 end if;
 -- A manifest entry targets only legal evidence bound to this exact draft.
 insert into public.purge_manifest_entries(
  manifest_id,target_id,store_name,object_id,entry_revision,status)
 select v_manifest,'storage-objects','storage.objects',o.object_id,
  row_number() over(order by o.object_id),'pending'
 from (
  select f.object_id from public.legal_evidence_fragments f
  join public.legal_evidence_ingest_sessions s on s.id=f.session_id
  where s.target_id=p_draft_id and s.target_kind=case when p_kind='co_parent' then 'cohort_draft' else 'adult_draft' end
  union
  select d.object_id from public.legal_evidence_documents d
  join public.legal_evidence_ingest_sessions s on s.id=d.session_id
  where s.target_id=p_draft_id and s.target_kind=case when p_kind='co_parent' then 'cohort_draft' else 'adult_draft' end
  union
  select c.object_id from public.legal_evidence_review_copies c
  join public.legal_evidence_documents d on d.id=c.document_id
  join public.legal_evidence_ingest_sessions s on s.id=d.session_id
  where s.target_id=p_draft_id and s.target_kind=case when p_kind='co_parent' then 'cohort_draft' else 'adult_draft' end
 ) o
 on conflict do nothing;
 update public.legal_evidence_ingest_sessions set state='cancelled'
 where target_id=p_draft_id and target_kind=case when p_kind='co_parent' then 'cohort_draft' else 'adult_draft' end
   and state in ('open','finalized');
end;
$$;
revoke all on function private.queue_refused_invitation_draft_v1(text,uuid,timestamptz,bigint)
 from public,anon,authenticated,service_role;

-- Kind-aware terminalization. This helper does not create a refusal bar:
-- collateral cancellation of another parent on the same draft is not refusal.
create or replace function private.terminalize_refused_invitation_v1(
 p_invitation_id uuid, p_explicit_contact boolean
)
returns void language plpgsql security invoker set search_path='' as $$
declare
 i public.subject_invitations%rowtype;
 d public.embryo_cohort_drafts%rowtype;
 a public.adult_subject_drafts%rowtype;
 v_owner uuid; v_owner_revision bigint; v_cipher bytea;
 v_now timestamptz:=clock_timestamp(); v_deadline timestamptz;
 v_notice text;
begin
 select * into i from public.subject_invitations where id=p_invitation_id for update;
 if i.id is null or i.status<>'pending' then return; end if;
 v_deadline:=v_now+interval '30 days';
 select e.contact_ciphertext into v_cipher
 from public.invitation_candidates c
 join public.encrypted_contact_references e on e.id=c.contact_reference_id
 where c.invitation_id=i.id and e.contact_hmac=i.email_hmac
   and e.status='current' and e.contact_ciphertext is not null
 order by c.candidate_revision desc limit 1 for update of e;
 v_cipher:=coalesce(v_cipher,i.email_encrypted);

 if i.invitation_kind in ('co_parent','identified_donor_subject') then
  if i.target_kind<>'cohort_draft' then
   raise exception using errcode='42501',message='invitation target unavailable';
  end if;
  select * into d from public.embryo_cohort_drafts where id=i.target_id for update;
  if d.id is null or d.state='finalized' or exists(
   select 1 from public.embryo_cohorts where draft_id=d.id
  ) then raise exception using errcode='42501',message='draft unavailable'; end if;
  v_owner:=d.owner_account_id;
  if i.invitation_kind='co_parent' then
   update public.embryo_cohort_drafts set state='cancelled' where id=d.id;
   perform private.queue_refused_invitation_draft_v1(
    'co_parent',d.id,d.fixed_expires_at,d.participant_set_revision);
   v_notice:='draft-cancelled';
  else
   -- An optional donor can end attribution, never cancel the embryo draft.
   update public.embryo_cohort_drafts set basis_case='anonymous_donor',
    basis_revision=basis_revision+1,donor_attribution_revision=donor_attribution_revision+1
   where id=d.id;
   update public.draft_participant_slots set principal_id=null,state='revoked',
    slot_revision=slot_revision+1 where embryo_draft_id=d.id
    and principal_id=i.invitee_principal_id and slot_kind not in ('parent_a','parent_b');
   delete from public.embryo_draft_participants where draft_id=d.id
    and set_kind='attribution_principals' and principal_id=i.invitee_principal_id;
   v_notice:='donor-attribution-ended';
  end if;
 elsif i.invitation_kind='adult_subject' then
  select * into a from public.adult_subject_drafts where subject_id=i.target_id for update;
  if i.target_kind<>'subject' or a.id is null or a.state='confirmed' then
   raise exception using errcode='42501',message='draft unavailable';
  end if;
  v_owner:=a.owner_account_id;
  update public.adult_subject_drafts set state='cancelled' where id=a.id;
  perform private.queue_refused_invitation_draft_v1(
   'adult_subject',a.id,a.fixed_expires_at,a.draft_revision);
  -- The legacy adult draft has a subject placeholder, but no confirmed data.
  update public.subjects set lifecycle='purge_queued',lifecycle_revision=lifecycle_revision+1
   where id=a.subject_id and lifecycle='draft';
  if not found then
   raise exception using errcode='42501',message='adult draft subject unavailable';
  end if;
  v_notice:='draft-cancelled';
 else
  raise exception using errcode='22023',message='unsupported invitation kind';
 end if;

 select principal_revision into v_owner_revision from public.subject_principals
 where id=i.inviter_principal_id and account_id=v_owner
 for update;
 -- A deleted/revoked inviter must not prevent the recipient from refusing.
 -- Delivery rechecks this recorded authority and can close an undeliverable
 -- notice without reopening or extending the cancelled draft.
 if v_owner_revision is null or (p_explicit_contact and v_cipher is null) then
  raise exception using errcode='42501',message='notice recipient unavailable';
 end if;
 -- Both notice intents and the transition are in this same transaction.
 -- No target detail or another person's address appears in a notice payload.
 if p_explicit_contact then
  insert into private.invitation_terminal_notices(
   invitation_id,notice_kind,recipient_kind,contact_ciphertext,
   recipient_authority_revision,idempotency_key,created_at,expires_at)
  values(i.id,case when i.invitation_kind='identified_donor_subject' then v_notice else 'invitation-refused' end,
   'contact',v_cipher,i.invitation_revision,encode(extensions.digest(convert_to(
    concat_ws(':','invitation-refusal-contact',(private.invitation_contact_aliases_v1(i.email_hmac))[1],
     to_char(v_now at time zone 'UTC','YYYY-MM-DD')),'UTF8'),'sha256'),'hex'),
   v_now,v_deadline) on conflict(idempotency_key) do nothing;
 end if;
 insert into private.invitation_terminal_notices(
  invitation_id,notice_kind,recipient_kind,recipient_account_id,
  recipient_authority_revision,idempotency_key,created_at,expires_at)
 values(i.id,v_notice,'account',v_owner,v_owner_revision,
  encode(extensions.digest(convert_to(concat_ws(':','invitation-terminal-owner',
   i.target_id::text,v_notice),'UTF8'),'sha256'),'hex'),v_now,v_deadline)
 on conflict(idempotency_key) do nothing;

 update public.subject_invitations set status=case when p_explicit_contact then 'refused' else 'cancelled' end,
  terminal_at=v_now,contact_purge_due_at=v_deadline,email_encrypted=null
 where id=i.id;
 update public.invitation_candidates set state='refused' where invitation_id=i.id;
 update public.token_hashes th set status='revoked',ended_at=v_now
 from public.token_candidates c
 where th.candidate_id=c.id and c.target_kind='subject_invitation' and c.target_id=i.id
   and th.status in ('current','consumed');
 update public.rights_sessions rs set status='revoked',ended_at=v_now
 from public.token_hashes th,public.token_candidates c
 where rs.token_hash_id=th.id and th.candidate_id=c.id
   and c.target_kind='subject_invitation' and c.target_id=i.id and rs.status='active';
 delete from public.rights_nonces n using public.rights_sessions rs,public.token_hashes th,public.token_candidates c
 where n.rights_session_id=rs.id and rs.token_hash_id=th.id and th.candidate_id=c.id
   and c.target_kind='subject_invitation' and c.target_id=i.id;
 update public.token_candidates set state='invalidated'
 where target_kind='subject_invitation' and target_id=i.id;
 update public.mail_outbox set state='invalidated'
 where target_kind='subject_invitation' and target_id=i.id and state in ('queued','claimed');
 update public.mail_outbox m set state='invalidated'
 from public.invitation_reminders r where r.invitation_id=i.id and r.outbox_id=m.id
 and m.state in ('queued','claimed');
 delete from public.invitation_reminders where invitation_id=i.id;
 update public.encrypted_contact_references e set status='shredded',
  contact_ciphertext=null,ended_at=v_now
 from public.invitation_candidates c where c.invitation_id=i.id
  and c.contact_reference_id=e.id and e.principal_id=i.invitee_principal_id;
 update public.subject_principals set status='deleted',principal_revision=principal_revision+1
 where id=i.invitee_principal_id and status='pending';
end;
$$;
revoke all on function private.terminalize_refused_invitation_v1(uuid,boolean)
 from public,anon,authenticated,service_role;

-- This private transaction is deliberately not yet exposed as an API RPC.
-- Canonical notice materialization, purge execution and all lock participants
-- must be connected before the accountless refusal control is enabled.
create or replace function private.refuse_co_parent_invitation_v1(
 p_session_hash text, p_nonce text
)
returns void language plpgsql security invoker set search_path='' as $$
declare
 s public.rights_sessions%rowtype; i public.subject_invitations%rowtype;
 v_aliases text[]; v_deadline timestamptz; v_hmac text; v_id uuid;
 v_now timestamptz:=clock_timestamp();
begin
 perform private.lock_invitation_transitions_v1();
 select * into s from public.rights_sessions
 where session_hash=p_session_hash and purpose='co-parent-invitation'
   and target_kind='cohort_draft' and expires_at>v_now for update;
 if s.id is null then
  raise exception using errcode='42501',message='rights session unavailable';
 end if;
 -- A retry can acknowledge its own already committed refusal, not any nonce.
 if exists(select 1 from public.embryo_operation_nonces
   where nonce_hash=encode(extensions.digest(convert_to(p_nonce,'UTF8'),'sha256'),'hex')
   and operation='invitation_refuse' and target_kind='rights_session' and target_id=s.id)
 then return; end if;
 if s.status<>'active' then
  raise exception using errcode='42501',message='rights session unavailable';
 end if;
 i:=private.current_co_parent_invitation_v1(s.token_hash_id,s.id);
 if i.id is null then
  raise exception using errcode='42501',message='invitation unavailable';
 end if;
 perform private.consume_embryo_operation_nonce_v1(
  p_nonce,null,null,'invitation_refuse','rights_session',s.id);
 v_aliases:=private.invitation_contact_aliases_v1(i.email_hmac);
 select least(v_now+interval '365 days',min(expires_at)) into v_deadline
 from (
  select expires_at from public.contact_refusal_bars where contact_hmac=any(v_aliases) and expires_at>v_now
  union all
  select expires_at from public.invitation_refusal_hmacs where email_hmac=any(v_aliases) and expires_at>v_now
 ) b;
 foreach v_hmac in array v_aliases loop
  insert into public.invitation_refusal_hmacs(email_hmac,refusal_revision,created_at,expires_at)
  values(v_hmac,1,v_now,v_deadline)
  on conflict(email_hmac) do update set
   expires_at=case when invitation_refusal_hmacs.expires_at>v_now
    then least(invitation_refusal_hmacs.expires_at,excluded.expires_at) else excluded.expires_at end,
   created_at=case when invitation_refusal_hmacs.expires_at>v_now
    then invitation_refusal_hmacs.created_at else excluded.created_at end;
  insert into public.contact_refusal_bars(contact_hmac,target_kind,target_id,refusal_revision,created_at,expires_at)
  values(v_hmac,'invitation',i.id,1,v_now,v_deadline)
  on conflict(contact_hmac,target_kind,target_id,refusal_revision) do nothing;
 end loop;
 for v_id in select id from public.subject_invitations
  where email_hmac=any(v_aliases) and status='pending' order by id for update
 loop
  perform private.terminalize_refused_invitation_v1(v_id,true);
 end loop;
 -- Other parents on a cancelled draft lose only that invitation. No bar is
 -- written for their address, and a donor on another draft keeps its fallback.
 for v_id in select si.id from public.subject_invitations si
  join public.embryo_cohort_drafts d on d.id=si.target_id
  where si.target_kind='cohort_draft' and d.state='cancelled' and si.status='pending'
   and exists(select 1 from public.subject_invitations refused
    where refused.target_kind='cohort_draft' and refused.target_id=d.id
    and refused.status='refused' and refused.email_hmac=any(v_aliases))
  order by si.id for update of si
 loop
  perform private.terminalize_refused_invitation_v1(v_id,false);
 end loop;
 perform private.append_legal_audit_event(
  'invitation.refused',null,'api.withdraw','accepted','{"operation":"refuse"}'::jsonb);
end;
$$;
revoke all on function private.refuse_co_parent_invitation_v1(text,text)
 from public,anon,authenticated,service_role;
