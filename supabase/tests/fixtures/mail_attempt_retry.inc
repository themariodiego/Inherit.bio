-- Exercise real token regeneration; keep every probe rolled back so the
-- existing invitation/withdrawal journeys continue with their original link.
create function pg_temp.assert_mail_retry(p_outbox uuid,p_key text,p_token text)
returns setof text language plpgsql as $$
declare r record; j jsonb; i integer; stable text; old_hash text;
begin
  select private.mail_provider_attempt_key_v1(m) into stable from public.mail_outbox m where id=p_outbox;
  old_hash:=encode(extensions.digest(convert_to(p_token,'UTF8'),'sha256'),'hex');
  begin
    perform public.complete_mail_attempt(p_outbox,(select attempt_count from public.mail_outbox where id=p_outbox),
      false,null,'unknown');
    update public.mail_outbox set not_before=clock_timestamp() where id=p_outbox;
    for i in 1..30 loop
      select * into r from public.claim_mail_outbox();
      if r.outbox_id=p_outbox then exit; end if;
      if r.outbox_id is null then raise exception 'retry did not claim the exact outbox'; end if;
    end loop;
    if r.outbox_id is distinct from p_outbox then raise exception 'retry did not claim the exact outbox'; end if;
    j:=jsonb_build_object('key',r.idempotency_key,'tokenHash',encode(extensions.digest(convert_to(r.delivery_token,'UTF8'),'sha256'),'hex'),
      'oldAuthorized',private.authorize_mail_submission_v1(p_outbox,(r.attempt_ordinal-1)::smallint),
      'newAuthorized',private.authorize_mail_submission_v1(p_outbox,r.attempt_ordinal),
      'oldStatus',(select status from public.token_hashes where token_hash=old_hash),
      'currentCount',(select count(*) from public.token_hashes h join public.token_candidates c on c.id=h.candidate_id
        where c.outbox_id=p_outbox and h.status='current'),
      'rawAbsent',not exists(select 1 from public.mail_outbox m where position(r.delivery_token in to_jsonb(m)::text)>0)
        and not exists(select 1 from public.mail_provider_attempts a where position(r.delivery_token in to_jsonb(a)::text)>0));
    update public.mail_outbox set state='invalidated',claimed_at=null where id=p_outbox;
    j:=j||jsonb_build_object('canceledAuthorized',private.authorize_mail_submission_v1(p_outbox,r.attempt_ordinal));
    raise exception using errcode='ZY002',message='restore synthetic retry';
  exception when sqlstate 'ZY002' then null; end;
  return next is(stable,p_key,'repeated delivery of one attempt retains its provider key');
  return next isnt(j->>'tokenHash',old_hash,'a regenerated attempt receives a different raw token hash');
  return next isnt(j->>'key',p_key,'a regenerated attempt receives a different provider key');
  return next is((j->>'oldAuthorized')::boolean,false,'the old attempt cannot authorize provider submission');
  return next is((j->>'newAuthorized')::boolean,true,'the exact successor attempt can authorize provider submission');
  return next is(j->>'oldStatus','revoked','the successor atomically revokes the earlier bearer hash');
  return next is((j->>'currentCount')::bigint,1::bigint,'only one authorizing token hash remains current');
  return next is((j->>'canceledAuthorized')::boolean,false,'a canceled attempt cannot authorize provider submission');
  return next ok((j->>'rawAbsent')::boolean,'the regenerated raw token is absent from durable outbox and provider attempts');
end $$;
