-- A terminal notice is a canonical outbox row committed WITH refusal.
-- Its private recipient envelope is independent of draft/contact deletion.
-- Ordinary mail still requires both principal and contact references.
alter table public.mail_outbox
 add column invitation_terminal_notice_id uuid unique
 references private.invitation_terminal_notices(id) on delete restrict,
 add column invitation_submission_started_at timestamptz,
 alter column recipient_principal_id drop not null,
 alter column contact_reference_id drop not null,
 add constraint mail_outbox_recipient_shape check (
  (invitation_terminal_notice_id is null
   and recipient_principal_id is not null and contact_reference_id is not null
   and invitation_submission_started_at is null)
  or
  (invitation_terminal_notice_id is not null
   and recipient_principal_id is null and contact_reference_id is null
   and template_id='invitation-terminal-notice' and purpose='invitation-terminal-notice'
   and target_kind='subject_invitation' and token_purpose is null and token_target_id is null)
 );

create or replace function private.enqueue_invitation_terminal_notice_v1()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 insert into public.mail_outbox(
  template_id,purpose,target_kind,target_id,recipient_authority_revision,
  semantic_revision,idempotency_key,template_payload,expires_at,
  invitation_terminal_notice_id)
 values('invitation-terminal-notice','invitation-terminal-notice','subject_invitation',
  new.invitation_id,new.recipient_authority_revision,1,new.idempotency_key,
  jsonb_build_object('kind',new.notice_kind),new.expires_at,new.id);
 return new;
end;
$$;
revoke all on function private.enqueue_invitation_terminal_notice_v1()
 from public,anon,authenticated,service_role;
create trigger enqueue_invitation_terminal_notice
after insert on private.invitation_terminal_notices
for each row execute function private.enqueue_invitation_terminal_notice_v1();

-- The staged private table had no public writer. Preserve any local pending
-- intent on upgrade without changing its original deadline or creating mail
-- for expired/already-released recipients.
insert into public.mail_outbox(
 template_id,purpose,target_kind,target_id,recipient_authority_revision,
 semantic_revision,idempotency_key,template_payload,expires_at,invitation_terminal_notice_id)
select 'invitation-terminal-notice','invitation-terminal-notice','subject_invitation',
 n.invitation_id,n.recipient_authority_revision,1,n.idempotency_key,
 jsonb_build_object('kind',n.notice_kind),n.expires_at,n.id
from private.invitation_terminal_notices n
where n.state='pending' and n.expires_at>clock_timestamp()
 and not exists(select 1 from public.mail_outbox m where m.invitation_terminal_notice_id=n.id);

create or replace function private.invitation_notice_recipient_current_v1(
 p_notice_id uuid
)
returns boolean language sql stable security invoker set search_path='' as $$
 select exists(
  select 1 from private.invitation_terminal_notices n
  join public.mail_outbox m on m.invitation_terminal_notice_id=n.id
   and m.target_kind='subject_invitation' and m.target_id=n.invitation_id
   and m.template_id='invitation-terminal-notice' and m.purpose='invitation-terminal-notice'
   and m.template_payload=jsonb_build_object('kind',n.notice_kind)
   and m.idempotency_key=n.idempotency_key
   and m.recipient_authority_revision=n.recipient_authority_revision
   and m.expires_at=n.expires_at
  where n.id=p_notice_id and n.state='pending' and n.expires_at>statement_timestamp()
   and (
    (n.recipient_kind='contact' and n.contact_ciphertext is not null)
    or
    (n.recipient_kind='account' and exists(
     select 1 from public.subject_principals sp
     join auth.users u on u.id=sp.account_id
     join public.profiles p on p.id=u.id
     where sp.account_id=n.recipient_account_id and sp.principal_kind='account_subject'
      and sp.status='active' and sp.principal_revision=n.recipient_authority_revision
      and u.email is not null and u.email_confirmed_at is not null
      and p.deletion_requested_at is null
      and not exists(select 1 from public.account_deletion_requests r
       where r.account_id=u.id and r.state in ('notice_period','delete_started'))
    ))
   )
 );
$$;
revoke all on function private.invitation_notice_recipient_current_v1(uuid)
 from public,anon,authenticated,service_role;

create or replace function public.claim_invitation_terminal_mail_v1()
returns table(outbox_id uuid,attempt_ordinal smallint,idempotency_key text,
 notice_kind text,contact_ciphertext bytea,recipient_account_id uuid)
language plpgsql security definer set search_path='' as $$
declare m public.mail_outbox%rowtype;
begin
 perform private.lock_invitation_transitions_v1();
 -- Retired owners cannot block refusal and do not receive a stale notice.
 update public.mail_outbox q set state='invalidated',claimed_at=null,
  last_outcome_code='recipient_authority_stale'
 where q.invitation_terminal_notice_id is not null and q.state in ('queued','claimed')
  and not private.invitation_notice_recipient_current_v1(q.invitation_terminal_notice_id);
 update private.invitation_terminal_notices n set state='expired',
  contact_ciphertext=null,recipient_account_id=null
 where n.state='pending' and exists(select 1 from public.mail_outbox q
  where q.invitation_terminal_notice_id=n.id and q.state='invalidated');
 -- Provider keys deduplicate for only 24 hours. An uncertain old submission
 -- needs reconciliation, not an automatic duplicate with an expired key.
 update public.mail_outbox q set state='failed',claimed_at=null,
  last_outcome_code='provider_receipt_uncertain'
 where q.invitation_terminal_notice_id is not null and q.state in ('queued','claimed')
  and q.invitation_submission_started_at<=clock_timestamp()-interval '24 hours';
 select q.* into m from public.mail_outbox q
 where q.invitation_terminal_notice_id is not null
  and ((q.state='queued' and q.not_before<=clock_timestamp())
   or (q.state='claimed' and q.claimed_at<clock_timestamp()-interval '10 minutes'))
  and q.expires_at>clock_timestamp() and q.attempt_count<10
 order by q.not_before,q.created_at for update skip locked limit 1;
 if m.id is null then return; end if;
 update public.mail_outbox q set state='claimed',claimed_at=clock_timestamp(),
  attempt_count=(q.attempt_count+1)::smallint,last_outcome_code=null
 where q.id=m.id returning q.* into m;
 return query select m.id,m.attempt_count,m.idempotency_key,
  n.notice_kind,n.contact_ciphertext,n.recipient_account_id
 from private.invitation_terminal_notices n where n.id=m.invitation_terminal_notice_id;
end;
$$;
revoke all on function public.claim_invitation_terminal_mail_v1() from public,anon,authenticated;
grant execute on function public.claim_invitation_terminal_mail_v1() to service_role;

create or replace function public.authorize_invitation_terminal_mail_v1(
 p_outbox_id uuid,p_attempt_ordinal smallint
)
returns boolean language plpgsql security definer set search_path='' as $$
declare m public.mail_outbox%rowtype;
begin
 perform private.lock_invitation_transitions_v1();
 select * into m from public.mail_outbox where id=p_outbox_id for update;
 if m.id is null or m.invitation_terminal_notice_id is null or m.state<>'claimed'
  or m.attempt_count<>p_attempt_ordinal or m.expires_at<=clock_timestamp()
  or m.invitation_submission_started_at<=clock_timestamp()-interval '24 hours'
  or not private.invitation_notice_recipient_current_v1(m.invitation_terminal_notice_id)
 then return false; end if;
 update public.mail_outbox set invitation_submission_started_at=
  coalesce(invitation_submission_started_at,clock_timestamp()) where id=m.id;
 return true;
end;
$$;
revoke all on function public.authorize_invitation_terminal_mail_v1(uuid,smallint)
 from public,anon,authenticated;
grant execute on function public.authorize_invitation_terminal_mail_v1(uuid,smallint) to service_role;

create or replace function public.complete_invitation_terminal_mail_v1(
 p_outbox_id uuid,p_attempt_ordinal smallint,p_success boolean,p_provider_message_hmac text
)
returns boolean language plpgsql security definer set search_path='' as $$
declare m public.mail_outbox%rowtype;
begin
 perform private.lock_invitation_transitions_v1();
 select * into m from public.mail_outbox where id=p_outbox_id for update;
 if m.id is null or m.invitation_terminal_notice_id is null then return false; end if;
 -- Completion retries acknowledge the exact already-accepted receipt.
 if m.state in ('submitted','delivered') then
  return p_success and exists(select 1 from public.mail_provider_attempts a
   where a.outbox_id=m.id and a.attempt_ordinal=p_attempt_ordinal
    and a.provider_message_id_hmac=p_provider_message_hmac and a.submitted_at is not null);
 end if;
 if m.state<>'claimed' or m.attempt_count<>p_attempt_ordinal then return false; end if;
 if p_success and (m.invitation_submission_started_at is null
   or p_provider_message_hmac is null or p_provider_message_hmac!~'^[0-9a-f]{64}$')
 then return false; end if;
 perform public.complete_mail_attempt(m.id,p_attempt_ordinal,p_success,p_provider_message_hmac,
  case when p_success then 'accepted' else 'provider_or_recipient_unavailable' end);
 if p_success then
  update private.invitation_terminal_notices set state='enqueued',
   contact_ciphertext=null,recipient_account_id=null where id=m.invitation_terminal_notice_id;
 end if;
 return true;
end;
$$;
revoke all on function public.complete_invitation_terminal_mail_v1(uuid,smallint,boolean,text)
 from public,anon,authenticated;
grant execute on function public.complete_invitation_terminal_mail_v1(uuid,smallint,boolean,text) to service_role;

-- Independent expiry is required even if the provider or purge worker fails.
-- Delete only this notice's canonical delivery graph; never a draft or file.
create or replace function public.expire_invitation_terminal_notices_v1()
returns integer language plpgsql security definer set search_path='' as $$
declare n record; v_count integer:=0;
begin
 perform private.lock_invitation_transitions_v1();
 for n in select i.id from private.invitation_terminal_notices i
  where i.expires_at<=clock_timestamp() order by i.id for update skip locked
 loop
  perform 1 from public.mail_outbox where invitation_terminal_notice_id=n.id for update;
  delete from public.mail_deliveries d using public.mail_outbox m
   where d.outbox_id=m.id and m.invitation_terminal_notice_id=n.id;
  delete from public.mail_provider_attempts a using public.mail_outbox m
   where a.outbox_id=m.id and m.invitation_terminal_notice_id=n.id;
  delete from public.mail_outbox where invitation_terminal_notice_id=n.id;
  delete from private.invitation_terminal_notices where id=n.id;
  v_count:=v_count+1;
 end loop;
 return v_count;
end;
$$;
revoke all on function public.expire_invitation_terminal_notices_v1() from public,anon,authenticated;
grant execute on function public.expire_invitation_terminal_notices_v1() to service_role;

-- The ordinary worker does not claim or invalidate the separately guarded
-- terminal recipient envelopes. Its other source and contact checks remain.
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
    and not (m.target_kind = 'genome_file' and exists (
        select 1 from public.genome_files f
        join public.subject_principals sp on sp.id = m.recipient_principal_id
        where f.id = m.target_id and f.user_id = sp.account_id
          and f.subject_id = sp.subject_id and f.status = 'annotated'
          and not exists (select 1 from private.genome_file_deletions d where d.file_id = f.id)
      ));

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
    and (m.template_id <> 'report-ready' or (m.target_kind = 'genome_file' and exists (
        select 1 from public.genome_files f
        join public.subject_principals sp on sp.id = m.recipient_principal_id
        where f.id = m.target_id and f.user_id = sp.account_id
          and f.subject_id = sp.subject_id and f.status = 'annotated'
          and not exists (select 1 from private.genome_file_deletions d where d.file_id = f.id)
      )))
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

  return query
  select
    v_outbox.id,
    v_outbox.template_id,
    v_outbox.template_payload,
    v_outbox.idempotency_key,
    v_outbox.attempt_count,
    ecr.contact_ciphertext,
    v_raw_token
  from public.encrypted_contact_references ecr
  where ecr.id = v_outbox.contact_reference_id;
end;
$$;

revoke all on function public.claim_mail_outbox()
  from public, anon, authenticated;
grant execute on function public.claim_mail_outbox() to service_role;

-- Only old invitation authority is cancelled; new terminal notices survive.
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
 where target_kind='subject_invitation' and target_id=i.id and state in ('queued','claimed')
  and invitation_terminal_notice_id is null;
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
