-- Preserve every existing canonical mail branch by delegation. The new
-- owner-notice branch locks its exact subject before retention/mail rows and
-- cannot submit or accept a stale-owner/revision/attempt delivery. Public
-- positive documentary approval and objection/release remain closed.
alter function private.commit_keyless_notice_delivery_v1(uuid) rename to commit_keyless_notice_delivery_before_provider_v1;
revoke all on function private.commit_keyless_notice_delivery_before_provider_v1(uuid)
  from public,anon,authenticated,inherit_upload_only,service_role;
create function private.commit_keyless_notice_delivery_v1(p_claim uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  -- A duplicate terminal provider callback has no effect and cannot reopen
  -- the working key or issue a successor notice clock.
  if exists(select 1 from public.future_person_claim_review_packages where claim_id=p_claim
    and review_id=p_claim and state in('approved','refused','closed')) then return false;end if;
  return private.commit_keyless_notice_delivery_before_provider_v1(p_claim);
end $$;
revoke all on function private.commit_keyless_notice_delivery_v1(uuid)
  from public,anon,authenticated,inherit_upload_only,service_role;

alter function public.claim_mail_outbox() rename to claim_mail_outbox_before_keyless_notice_v1;
revoke all on function public.claim_mail_outbox_before_keyless_notice_v1()
  from public,anon,authenticated,inherit_upload_only,service_role;
create function public.claim_mail_outbox()
returns table(outbox_id uuid,template_id text,template_payload jsonb,idempotency_key text,
  attempt_ordinal smallint,contact_ciphertext bytea,delivery_token text)
language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare pending record; m public.mail_outbox; n public.future_person_claim_notices;
  tc public.token_candidates; contact public.encrypted_contact_references; raw_token text; token_digest text;
begin
  select k.subject_id,k.claim_id,stored_notice.outbox_id into pending from public.future_person_claim_review_packages k
    join public.future_person_claim_notices stored_notice on stored_notice.claim_id=k.claim_id and stored_notice.owner_account_id is not null
    join public.mail_outbox o on o.id=stored_notice.outbox_id
    where k.state='open' and k.review_id is not null and stored_notice.delivered_at is null
      and o.state in('queued','claimed') and o.not_before<=clock_timestamp()
      and (o.state='queued' or o.claimed_at<clock_timestamp()-interval '10 minutes')
    order by o.created_at,o.id limit 1;
  if pending.claim_id is null then
    return query select * from public.claim_mail_outbox_before_keyless_notice_v1();return;
  end if;
  perform 1 from public.subjects where id=pending.subject_id for update;
  perform 1 from public.retention_rows where target_kind='claim' and target_id=pending.claim_id order by id for update;
  perform private.lock_invitation_transitions_v1();
  select stored_notice.* into n from public.future_person_claim_notices stored_notice where stored_notice.outbox_id=pending.outbox_id for update;
  select * into m from public.mail_outbox where id=n.outbox_id for update;
  if n.id is null or m.id is null or n.delivered_at is not null or m.state not in('queued','claimed')
    or m.not_before>clock_timestamp() or (m.state='claimed' and m.claimed_at>=clock_timestamp()-interval '10 minutes') then return;end if;
  if m.expires_at<=clock_timestamp() or not private.keyless_owner_notice_current_v1(pending.claim_id) then
    perform private.close_keyless_notice_v1(pending.claim_id,
      case when m.expires_at<=clock_timestamp() then 'notice_delivery_failed' else 'record_state_changed' end);
    return;
  end if;
  if m.attempt_count>=10 then
    perform private.close_keyless_notice_v1(pending.claim_id,'notice_delivery_failed');return;
  end if;
  select * into tc from public.token_candidates where id=n.candidate_id for update;
  select * into contact from public.encrypted_contact_references where id=m.contact_reference_id for update;
  if tc.id is null or tc.outbox_id<>m.id or tc.purpose<>'future-person-claim-objection' or tc.target_kind<>'claim'
    or tc.target_id<>n.claim_id or tc.token_revision<>n.notice_revision or tc.state not in('pending','issued')
    or tc.expires_at<=clock_timestamp() or contact.id is null or contact.contact_ciphertext is null then
    raise exception using errcode='42501',message='claim notice unavailable';end if;
  update public.mail_outbox set state='claimed',claimed_at=clock_timestamp(),attempt_count=attempt_count+1
    where id=m.id returning * into m;
  raw_token:=rtrim(translate(encode(extensions.gen_random_bytes(32),'base64'),'+/','-_'),'=');
  token_digest:=encode(extensions.digest(convert_to(raw_token,'UTF8'),'sha256'),'hex');
  update public.token_hashes set status='revoked',ended_at=clock_timestamp()
    where candidate_id=tc.id and status='current';
  insert into public.token_hashes(candidate_id,token_hash,token_revision,status)
    values(tc.id,token_digest,tc.token_revision,'current');
  update public.token_candidates set state='issued' where id=tc.id;
  -- This hash is a non-authorizing delivery candidate until the exact current
  -- delivered callback issues the full owner clock. No raw value is stored.
  return query select m.id,m.template_id,m.template_payload,private.mail_provider_attempt_key_v1(m),
    m.attempt_count,contact.contact_ciphertext,raw_token;
end $$;
revoke all on function public.claim_mail_outbox() from public,anon,authenticated,inherit_upload_only;
grant execute on function public.claim_mail_outbox() to service_role;

alter function private.authorize_mail_submission_v1(uuid,smallint) rename to authorize_mail_submission_before_keyless_notice_v1;
revoke all on function private.authorize_mail_submission_before_keyless_notice_v1(uuid,smallint)
  from public,anon,authenticated,inherit_upload_only,service_role;
create function private.authorize_mail_submission_v1(p_outbox uuid,p_attempt smallint)
returns boolean language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare notice public.future_person_claim_notices; package public.future_person_claim_review_packages;
begin
  select * into notice from public.future_person_claim_notices where outbox_id=p_outbox and owner_account_id is not null;
  if notice.id is null then return private.authorize_mail_submission_before_keyless_notice_v1(p_outbox,p_attempt);end if;
  select * into package from public.future_person_claim_review_packages where claim_id=notice.claim_id;
  perform 1 from public.subjects where id=package.subject_id for update;
  perform 1 from public.retention_rows where target_kind='claim' and target_id=notice.claim_id order by id for update;
  if not private.authorize_mail_submission_before_keyless_notice_v1(p_outbox,p_attempt)
    or not private.keyless_owner_notice_current_v1(notice.claim_id)
    or package.delivery_deadline<=clock_timestamp() or notice.delivered_at is not null then return false;end if;
  return exists(select 1 from public.token_candidates tc join public.token_hashes th on th.candidate_id=tc.id
    join public.mail_outbox m on m.id=tc.outbox_id
    where tc.id=notice.candidate_id and tc.outbox_id=p_outbox and tc.purpose='future-person-claim-objection'
      and tc.target_kind='claim' and tc.target_id=notice.claim_id and tc.token_revision=notice.notice_revision
      and tc.state='issued' and tc.expires_at>clock_timestamp() and th.status='current'
      and th.token_revision=tc.token_revision and m.state='claimed' and m.attempt_count=p_attempt
      and m.semantic_revision=notice.notice_revision);
end $$;
revoke all on function private.authorize_mail_submission_v1(uuid,smallint)
  from public,anon,authenticated,inherit_upload_only,service_role;

alter function public.complete_mail_attempt(uuid,smallint,boolean,text,text) rename to complete_mail_attempt_before_keyless_notice_v1;
revoke all on function public.complete_mail_attempt_before_keyless_notice_v1(uuid,smallint,boolean,text,text)
  from public,anon,authenticated,inherit_upload_only,service_role;
create function public.complete_mail_attempt(p_outbox_id uuid,p_attempt_ordinal smallint,p_success boolean,
  p_provider_message_id_hmac text,p_outcome_code text)
returns void language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare notice public.future_person_claim_notices; package public.future_person_claim_review_packages;
begin
  select * into notice from public.future_person_claim_notices where outbox_id=p_outbox_id and owner_account_id is not null;
  if notice.id is not null then
    select * into package from public.future_person_claim_review_packages where claim_id=notice.claim_id;
    perform 1 from public.subjects where id=package.subject_id for update;
    perform 1 from public.retention_rows where target_kind='claim' and target_id=notice.claim_id order by id for update;
    if not private.keyless_owner_notice_current_v1(notice.claim_id) or package.delivery_deadline<=clock_timestamp() then
      perform private.close_keyless_notice_v1(notice.claim_id,
        case when package.delivery_deadline<=clock_timestamp() then 'notice_delivery_failed' else 'record_state_changed' end);return;
    end if;
    if p_success is null or (p_success and (p_provider_message_id_hmac is null or p_provider_message_id_hmac!~'^[0-9a-f]{64}$')) then
      raise exception using errcode='22023',message='invalid mail completion';end if;
    if p_success and not private.authorize_mail_submission_v1(p_outbox_id,p_attempt_ordinal) then
      raise exception using errcode='42501',message='claim notice unavailable';end if;
  end if;
  perform public.complete_mail_attempt_before_keyless_notice_v1(p_outbox_id,p_attempt_ordinal,p_success,p_provider_message_id_hmac,p_outcome_code);
  if notice.id is not null and exists(select 1 from public.mail_outbox where id=p_outbox_id and state='failed') then
    perform private.close_keyless_notice_v1(notice.claim_id,'notice_delivery_failed');
  end if;
  -- Accepted submission never starts the owner period. It waits for the exact
  -- delivered event, which the callback below re-resolves independently.
end $$;
revoke all on function public.complete_mail_attempt(uuid,smallint,boolean,text,text)
  from public,anon,authenticated,inherit_upload_only;
grant execute on function public.complete_mail_attempt(uuid,smallint,boolean,text,text) to service_role;

alter function public.record_resend_mail_event(text,text,text,timestamptz) rename to record_resend_mail_event_before_keyless_notice_v1;
revoke all on function public.record_resend_mail_event_before_keyless_notice_v1(text,text,text,timestamptz)
  from public,anon,authenticated,inherit_upload_only,service_role;
create function public.record_resend_mail_event(p_provider_message_id_hmac text,p_provider_event_hmac text,
  p_status text,p_occurred_at timestamptz)
returns boolean language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare a public.mail_provider_attempts; notice public.future_person_claim_notices;
  package public.future_person_claim_review_packages; m public.mail_outbox; recorded boolean;
begin
  select * into a from public.mail_provider_attempts where provider_message_id_hmac=p_provider_message_id_hmac;
  select * into notice from public.future_person_claim_notices where outbox_id=a.outbox_id and owner_account_id is not null;
  if notice.id is null then
    return public.record_resend_mail_event_before_keyless_notice_v1(p_provider_message_id_hmac,p_provider_event_hmac,p_status,p_occurred_at);
  end if;
  if p_provider_message_id_hmac is null or p_provider_message_id_hmac!~'^[0-9a-f]{64}$'
    or p_provider_event_hmac is null or p_provider_event_hmac!~'^[0-9a-f]{64}$'
    or p_status is null or p_status not in('accepted','delivered','bounced','complained','reviewed_undeliverable')
    or p_occurred_at is null or not isfinite(p_occurred_at) then
    raise exception using errcode='22023',message='invalid mail event';end if;
  select * into package from public.future_person_claim_review_packages where claim_id=notice.claim_id;
  perform 1 from public.subjects where id=package.subject_id for update;
  perform 1 from public.retention_rows where target_kind='claim' and target_id=notice.claim_id order by id for update;
  select * into m from public.mail_outbox where id=notice.outbox_id for update;
  -- A prior uncertain/superseded attempt's event must never be attached to a
  -- successor attempt by the old canonical outbox-level event projection.
  if a.attempt_ordinal is distinct from m.attempt_count or not exists(select 1 from public.mail_deliveries d
    where d.outbox_id=m.id and d.provider_attempt_id=a.id) then return false;end if;
  if package.state not in('open','objected') then return false;end if;
  if not private.keyless_owner_notice_current_v1(notice.claim_id) then
    perform private.close_keyless_notice_v1(notice.claim_id,'record_state_changed');return false;end if;
  recorded:=public.record_resend_mail_event_before_keyless_notice_v1(p_provider_message_id_hmac,p_provider_event_hmac,p_status,p_occurred_at);
  if recorded and p_status in('delivered','bounced','complained','reviewed_undeliverable') then
    perform private.commit_keyless_notice_delivery_v1(notice.claim_id);
  end if;
  return recorded;
end $$;
revoke all on function public.record_resend_mail_event(text,text,text,timestamptz)
  from public,anon,authenticated,inherit_upload_only;
grant execute on function public.record_resend_mail_event(text,text,text,timestamptz) to service_role;

-- The native service RPC is the sole API door to the now-denied private
-- dispatcher. Its original invoker ABI must delegate under the owner, rather
-- than restoring direct API execution on the private dispatcher/delegates.
do $$
begin
  if not exists(select 1 from pg_catalog.pg_proc p where p.oid=
    'public.authorize_mail_submission_v1(uuid,smallint)'::regprocedure
    and p.proowner=(select oid from pg_catalog.pg_roles where rolname='postgres')
    and p.prolang=(select oid from pg_catalog.pg_language where lanname='sql')
    and p.prorettype='boolean'::regtype and p.proconfig=array['search_path=""']::text[]
    and regexp_replace(p.prosrc,'\s','','g')=
      'selectprivate.authorize_mail_submission_v1(p_outbox_id,p_attempt_ordinal);') then
    raise exception using errcode='55000',message='unexpected mail submission door';end if;
end $$;
alter function public.authorize_mail_submission_v1(uuid,smallint) security definer;
revoke all on function public.authorize_mail_submission_v1(uuid,smallint)
  from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function public.authorize_mail_submission_v1(uuid,smallint) to service_role;
notify pgrst,'reload schema';
