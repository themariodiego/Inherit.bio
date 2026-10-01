-- Restore the existing held-revision notice claim, pre-submit check and session
-- issuer after the shared Embryo/Future dispatcher replacements. Preserve the
-- complete022 mail wrappers and, when present,023 owner-objection wrapper.
-- Patch only the exact inherited dispatchers; retain every current non-held arm.
do $bridge$
declare
  v_canonical regprocedure:=to_regprocedure('public.activate_rights_session_v1(text,text,text)');
  v_alias regprocedure:=to_regprocedure('public.activate_rights_session_before_keyless_objection_v1(text,text,text)');
  v_target regprocedure; v_definition text; v_patched text; v_body text;
  v_wrapper_body text; v_current_md5 text;
  v_mail_target regprocedure; v_mail_canonical regprocedure; v_mail_wrapper_body text;
begin
  if v_canonical is null then raise exception using errcode='55000',message='rights activation predecessor unavailable';end if;
  if v_alias is not null then
    select prosrc into v_wrapper_body from pg_proc where oid=v_canonical;
    if md5(v_wrapper_body) is distinct from '5f92f26f9e5f94f7593f833d17db7d6c' or not exists(
      select 1 from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=v_canonical
        and p.prosecdef and l.lanname='plpgsql' and p.pronargs=3 and p.proargdefaults is null
        and p.proargnames=array['p_token_hash','p_session_hash','p_form_nonce','purpose','target_kind','target_id','expires_at']::text[]
        and p.proconfig=array['search_path=""','lock_timeout=250ms']::text[]
        and pg_get_function_result(p.oid)='TABLE(purpose text, target_kind text, target_id uuid, expires_at timestamp with time zone)'
    ) or exists(
      select 1 from unnest(array['anon','authenticated','inherit_upload_only','service_role']) r
        where has_function_privilege(r,v_alias,'execute')) then
      raise exception using errcode='55000',message='keyless activation wrapper predecessor differs';
    end if;
    v_target:=v_alias;
  else
    v_target:=v_canonical;
  end if;
  select prosrc,md5(prosrc) into v_body,v_current_md5 from pg_proc where oid=v_target;
  if v_current_md5 is distinct from '4777886cd6cd45b883e5e8c5ead6c8ee' or not exists(
    select 1 from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=v_target
      and l.lanname='plpgsql' and p.prosecdef and p.proconfig=array['search_path=""']::text[]
      and p.pronargs=3 and p.proargdefaults is null
      and p.proargnames=array['p_token_hash','p_session_hash','p_form_nonce','purpose','target_kind','target_id','expires_at']::text[]
      and pg_get_function_result(p.oid)='TABLE(purpose text, target_kind text, target_id uuid, expires_at timestamp with time zone)'
  ) or exists(select 1 from unnest(array['anon','authenticated','inherit_upload_only']) r
      where has_function_privilege(r,v_canonical,'execute'))
    or not has_function_privilege('service_role',v_canonical,'execute') then
    raise exception using errcode='55000',message='rights activation dispatcher predecessor differs';
  end if;
  if (v_alias is not null and (select proowner from pg_proc where oid=v_alias)
    is distinct from (select proowner from pg_proc where oid=v_canonical))
    or exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where p.oid in(v_target,v_canonical) and (a.privilege_type<>'EXECUTE' or a.grantor<>p.proowner
        or (a.grantee=p.proowner and a.is_grantable)
        or (a.grantee<>p.proowner and (p.oid<>v_canonical
          or a.grantee<>(select oid from pg_roles where rolname='service_role') or a.is_grantable))))
    or exists(select 1 from pg_proc p where p.oid in(v_target,v_canonical)
      and cardinality(coalesce(p.proacl,acldefault('f',p.proowner)))<>case when p.oid=v_canonical then 2 else 1 end) then
    raise exception using errcode='55000',message='rights activation predecessor grants differ';end if;
  -- The registered matrix already defines this exact purpose and its three
  -- actions. Its real held-revision issuer needs this one stored target pair.
  if (select count(*) from private.rights_purpose_matrix where purpose='adult-upload-confirmation'
      and invitation_kind is null and route_id='api.withdraw' and action in('confirm','refuse','delete'))<>3 then
    raise exception using errcode='55000',message='held revision purpose matrix predecessor differs';end if;
  insert into private.rights_session_purposes (session_purpose,matrix_purpose,invitation_kind,target_kind)
  values('adult-upload-confirmation','adult-upload-confirmation',null,'adult_upload_revision');

  v_definition:=pg_get_functiondef(v_target);
  if (length(v_definition)-length(replace(v_definition,$declaration$  v_expires_at timestamptz;$declaration$,'')))/length($declaration$  v_expires_at timestamptz;$declaration$)<>1
    or (length(v_definition)-length(replace(v_definition,$anchor$  if v_purpose is distinct from 'co-parent-invitation' then return; end if;$anchor$,'')))/length($anchor$  if v_purpose is distinct from 'co-parent-invitation' then return; end if;$anchor$)<>1 then
    raise exception using errcode='55000',message='rights activation insertion anchor differs';end if;
  v_patched:=replace(v_definition,$declaration$  v_expires_at timestamptz;$declaration$,
    $declared$  v_expires_at timestamptz;
  v_held public.other_adult_held_uploads%rowtype;$declared$);
  v_patched:=replace(v_patched,$anchor$  if v_purpose is distinct from 'co-parent-invitation' then return; end if;$anchor$,$held$  -- 20260928150000: the upload-time notice's credential opens a session for
  -- exactly its pending revision, bound to the subject's confirmation principal.
  if v_purpose = 'adult-upload-confirmation' then
    select h.* into v_held
    from public.token_candidates tc
    join public.other_adult_held_uploads h on h.id = tc.target_id
    where tc.id = v_token.candidate_id
      and tc.purpose = 'adult-upload-confirmation'
      and tc.target_kind = 'adult_upload_revision'
      and tc.state = 'issued' and tc.expires_at > v_now
      and tc.token_revision = v_token.token_revision
      and h.notice_outbox_id = tc.outbox_id
      and h.state = 'pending' and h.fixed_deadline > v_now
    for update of h;
    if v_held.id is null or not exists (
      select 1 from public.subjects s
      join public.subject_principals sp on sp.id = v_held.confirmation_principal_id
        and sp.subject_id = s.id and sp.status = 'active'
      where s.id = v_held.subject_id and s.lifecycle = 'active'
        and s.subject_binding_revision = v_held.subject_binding_revision
    ) then return; end if;

    v_expires_at := least(v_now + interval '24 hours', v_held.fixed_deadline);

    insert into public.rights_sessions (
      token_hash_id, principal_id, purpose, target_kind, target_id,
      authority_revision, session_hash, status, expires_at
    ) values (
      v_token.id, v_held.confirmation_principal_id, 'adult-upload-confirmation',
      'adult_upload_revision', v_held.id, v_held.subject_binding_revision,
      p_session_hash, 'active', v_expires_at
    );

    update public.token_hashes
    set status = 'consumed', ended_at = v_now
    where id = v_token.id;

    perform private.append_legal_audit_event(
      'rights.session.activated', null, 'api.rights-activate', 'accepted',
      jsonb_build_object('purpose', 'adult-upload-confirmation')
    );

    return query select
      'adult-upload-confirmation'::text, 'adult_upload_revision'::text,
      v_held.id, v_expires_at;
    return;
  end if;

  if v_purpose is distinct from 'co-parent-invitation' then return; end if;$held$);
  execute v_patched;
  if (select md5(prosrc) from pg_proc where oid=v_target) is distinct from '7c176e100123ecbdf9aedd8ee41b0539'
    or (v_alias is not null and (select prosrc from pg_proc where oid=v_canonical) is distinct from v_wrapper_body)
    or (v_alias is not null and exists(select 1 from unnest(array['anon','authenticated','inherit_upload_only','service_role']) r
      where has_function_privilege(r,v_alias,'execute'))) then
    raise exception using errcode='55000',message='rights activation bridge postcondition differs';end if;

  --022 owns the canonical mail entries. Its delegates carry the exact233
  -- shared dispatcher and remain denied even to service_role.
  v_mail_target:=to_regprocedure('public.claim_mail_outbox_before_keyless_notice_v1()');
  v_mail_canonical:=to_regprocedure('public.claim_mail_outbox()');
  if v_mail_target is null or v_mail_canonical is null then
    raise exception using errcode='55000',message='mail claim wrapper predecessor unavailable';end if;
  select prosrc into v_mail_wrapper_body from pg_proc where oid=v_mail_canonical;
  if md5(v_mail_wrapper_body) is distinct from 'abb70e7d8ec45731aebcbaa870ab9c13' or not exists(
    select 1 from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=v_mail_canonical
      and l.lanname='plpgsql' and p.prosecdef and p.pronargs=0 and p.proargdefaults is null
      and p.proargnames=array['outbox_id','template_id','template_payload','idempotency_key','attempt_ordinal','contact_ciphertext','delivery_token']::text[]
      and p.proconfig=array['search_path=""','lock_timeout=250ms']::text[]
      and pg_get_function_result(p.oid)='TABLE(outbox_id uuid, template_id text, template_payload jsonb, idempotency_key text, attempt_ordinal smallint, contact_ciphertext bytea, delivery_token text)'
  ) or (select md5(prosrc) from pg_proc where oid=v_mail_target) is distinct from '12222529081824e4e71833c2997911b3'
    or not exists(select 1 from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=v_mail_target
      and l.lanname='plpgsql' and p.prosecdef and p.pronargs=0 and p.proargdefaults is null
      and p.proargnames=array['outbox_id','template_id','template_payload','idempotency_key','attempt_ordinal','contact_ciphertext','delivery_token']::text[]
      and p.proconfig=array['search_path=""']::text[]
      and pg_get_function_result(p.oid)='TABLE(outbox_id uuid, template_id text, template_payload jsonb, idempotency_key text, attempt_ordinal smallint, contact_ciphertext bytea, delivery_token text)'
      and p.proowner=(select proowner from pg_proc where oid=v_mail_canonical))
    or exists(select 1 from unnest(array['anon','authenticated','inherit_upload_only','service_role']) r
      where has_function_privilege(r,v_mail_target,'execute'))
    or exists(select 1 from unnest(array['anon','authenticated','inherit_upload_only']) r
      where has_function_privilege(r,v_mail_canonical,'execute'))
    or not has_function_privilege('service_role',v_mail_canonical,'execute') then
    raise exception using errcode='55000',message='mail claim dispatcher predecessor differs';end if;
  -- Preserve the owner grants exactly, with no additional direct grantee.
  if exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where p.oid in(v_mail_target,v_mail_canonical) and (
      a.privilege_type<>'EXECUTE' or a.grantor<>p.proowner or
      (a.grantee=p.proowner and a.is_grantable) or
      (a.grantee<>p.proowner and (p.oid<>v_mail_canonical or a.grantee<>(select oid from pg_roles where rolname='service_role') or a.is_grantable))))
    or exists(select 1 from pg_proc p where p.oid in(v_mail_target,v_mail_canonical)
      and cardinality(coalesce(p.proacl,acldefault('f',p.proowner)))<>case when p.oid=v_mail_canonical then 2 else 1 end) then
    raise exception using errcode='55000',message='mail claim predecessor grants differ';end if;
  v_patched:=pg_get_functiondef(v_mail_target);
  if (length(v_patched)-length(replace(v_patched,$held_mail_current_anchor$  select m.* into v_outbox$held_mail_current_anchor$,'')))/length($held_mail_current_anchor$  select m.* into v_outbox$held_mail_current_anchor$)<>1 then
    raise exception using errcode='55000',message='mail claim insertion anchor differs';end if;
  v_patched:=replace(v_patched,$held_mail_current_anchor$  select m.* into v_outbox$held_mail_current_anchor$,$held_mail_current$  -- 20260928150000: an upload notice is current only while its revision is.
  update public.mail_outbox m set state='invalidated',claimed_at=null,
    last_outcome_code='upload_revision_stale'
  where m.state in('queued','claimed')
    and m.token_purpose='adult-upload-confirmation'
    and not private.adult_upload_mail_current_v1(m);

  select m.* into v_outbox$held_mail_current$);
  if (length(v_patched)-length(replace(v_patched,$held_mail_token_anchor$  return query
  select$held_mail_token_anchor$,'')))/length($held_mail_token_anchor$  return query
  select$held_mail_token_anchor$)<>1 then
    raise exception using errcode='55000',message='mail claim insertion anchor differs';end if;
  v_patched:=replace(v_patched,$held_mail_token_anchor$  return query
  select$held_mail_token_anchor$,$held_mail_token$  -- 20260928150000: the upload-time notice's confirmation credential.
  if v_outbox.token_purpose = 'adult-upload-confirmation' then
    if not private.adult_upload_mail_current_v1(v_outbox) then return; end if;
    select tc.* into strict v_candidate
    from public.token_candidates tc
    where tc.outbox_id = v_outbox.id
      and tc.purpose = 'adult-upload-confirmation'
      and tc.target_kind = 'adult_upload_revision'
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
  end if;

  return query
  select$held_mail_token$);
  execute v_patched;
  if (select md5(prosrc) from pg_proc where oid=v_mail_target) is distinct from 'c14b060235af46b3046205d3b95a4976'
    or (select prosrc from pg_proc where oid=v_mail_canonical) is distinct from v_mail_wrapper_body
    or exists(select 1 from unnest(array['anon','authenticated','inherit_upload_only','service_role']) r
      where has_function_privilege(r,v_mail_target,'execute')) then
    raise exception using errcode='55000',message='mail claim bridge postcondition differs';end if;
  v_mail_target:=to_regprocedure('private.authorize_mail_submission_before_keyless_notice_v1(uuid,smallint)');
  v_mail_canonical:=to_regprocedure('private.authorize_mail_submission_v1(uuid,smallint)');
  if v_mail_target is null or v_mail_canonical is null then
    raise exception using errcode='55000',message='mail submission wrapper predecessor unavailable';end if;
  select prosrc into v_mail_wrapper_body from pg_proc where oid=v_mail_canonical;
  if md5(v_mail_wrapper_body) is distinct from '448f258385a4c6f4392a1ca1781f0f2a' or not exists(
    select 1 from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=v_mail_canonical
      and l.lanname='plpgsql' and p.prosecdef and p.pronargs=2 and p.proargdefaults is null
      and p.proargnames=array['p_outbox','p_attempt']::text[]
      and p.proconfig=array['search_path=""','lock_timeout=250ms']::text[]
      and pg_get_function_result(p.oid)='boolean'
  ) or (select md5(prosrc) from pg_proc where oid=v_mail_target) is distinct from '0ecf82fc522f48e52d3f86298a7a71cb'
    or not exists(select 1 from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=v_mail_target
      and l.lanname='plpgsql' and p.prosecdef and p.pronargs=2 and p.proargdefaults is null
      and p.proargnames=array['p_outbox','p_attempt']::text[]
      and p.proconfig=array['search_path=""']::text[]
      and pg_get_function_result(p.oid)='boolean'
      and p.proowner=(select proowner from pg_proc where oid=v_mail_canonical))
    or exists(select 1 from unnest(array['anon','authenticated','inherit_upload_only','service_role']) r
      where has_function_privilege(r,v_mail_target,'execute'))
    or exists(select 1 from unnest(array['anon','authenticated','inherit_upload_only','service_role']) r
      where has_function_privilege(r,v_mail_canonical,'execute')) then
    raise exception using errcode='55000',message='mail submission dispatcher predecessor differs';end if;
  -- Preserve the owner grants exactly, with no additional direct grantee.
  if exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where p.oid in(v_mail_target,v_mail_canonical) and (
      a.privilege_type<>'EXECUTE' or a.grantor<>p.proowner or
      (a.grantee=p.proowner and a.is_grantable) or
      a.grantee<>p.proowner))
    or exists(select 1 from pg_proc p where p.oid in(v_mail_target,v_mail_canonical)
      and cardinality(coalesce(p.proacl,acldefault('f',p.proowner)))<>1) then
    raise exception using errcode='55000',message='mail submission predecessor grants differ';end if;
  v_patched:=pg_get_functiondef(v_mail_target);
  if (length(v_patched)-length(replace(v_patched,$held_mail_submission_anchor$ if m.template_id='report-ready' and private.file_ready_mail_current_v1(m) is not true then return false; end if;$held_mail_submission_anchor$,'')))/length($held_mail_submission_anchor$ if m.template_id='report-ready' and private.file_ready_mail_current_v1(m) is not true then return false; end if;$held_mail_submission_anchor$)<>1 then
    raise exception using errcode='55000',message='mail submission insertion anchor differs';end if;
  v_patched:=replace(v_patched,$held_mail_submission_anchor$ if m.template_id='report-ready' and private.file_ready_mail_current_v1(m) is not true then return false; end if;$held_mail_submission_anchor$,$held_mail_submission$ -- 20260928150000: an upload notice goes out only while its revision is pending.
 if m.token_purpose='adult-upload-confirmation' then
  if not private.adult_upload_mail_current_v1(m) or not exists(
   select 1 from public.token_candidates tc join public.token_hashes th on th.candidate_id=tc.id
   where tc.outbox_id=m.id and tc.state='issued' and th.status='current'
  ) then return false; end if;
 end if;
 if m.template_id='report-ready' and private.file_ready_mail_current_v1(m) is not true then return false; end if;$held_mail_submission$);
  execute v_patched;
  if (select md5(prosrc) from pg_proc where oid=v_mail_target) is distinct from '62c932b7c2b4863a23280a793fe7c264'
    or (select prosrc from pg_proc where oid=v_mail_canonical) is distinct from v_mail_wrapper_body
    or exists(select 1 from unnest(array['anon','authenticated','inherit_upload_only','service_role']) r
      where has_function_privilege(r,v_mail_target,'execute')) then
    raise exception using errcode='55000',message='mail submission bridge postcondition differs';end if;
end;
$bridge$;
