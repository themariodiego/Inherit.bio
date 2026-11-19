-- A synthetic delivered token for suites that insert rights sessions directly.
-- rights_sessions.token_hash_id must name a token_hashes row, and a fresh
-- database has none, so a suite makes its own instead of borrowing one. The
-- chain is contact reference, outbox row, candidate and hash, all invented
-- for the given account's own principal. Nothing is mailed, and the doors
-- under test never read the token row.
create function pg_temp.synthetic_rights_token(p_account uuid, p_purpose text, p_label text) returns uuid
language plpgsql volatile as $$
declare v_principal public.subject_principals%rowtype; v_contact uuid; v_outbox uuid; v_candidate uuid; v_token uuid;
 v_target uuid := gen_random_uuid();
begin
 select * into strict v_principal from public.subject_principals
  where account_id=p_account and principal_kind='account_subject' and status='active';
 insert into public.encrypted_contact_references(principal_id,contact_ciphertext,contact_hmac,key_revision,
  authority_revision,status)
 values(v_principal.id,extensions.gen_random_bytes(64),
  encode(extensions.digest(p_label||':contact','sha256'),'hex'),1,v_principal.principal_revision,'current')
 returning id into v_contact;
 insert into public.mail_outbox(template_id,purpose,target_kind,target_id,recipient_principal_id,contact_reference_id,
  recipient_authority_revision,semantic_revision,idempotency_key,expires_at,state)
 values(p_purpose,p_purpose,'subject',v_target,v_principal.id,v_contact,v_principal.principal_revision,1,
  encode(extensions.digest(p_label||':outbox','sha256'),'hex'),clock_timestamp()+interval '1 day','submitted')
 returning id into v_outbox;
 insert into public.token_candidates(outbox_id,purpose,target_kind,target_id,token_revision,state,expires_at)
 values(v_outbox,p_purpose,'subject',v_target,1,'issued',clock_timestamp()+interval '1 day')
 returning id into v_candidate;
 insert into public.token_hashes(candidate_id,token_hash,token_revision)
 values(v_candidate,encode(extensions.digest(p_label||':token','sha256'),'hex'),1)
 returning id into v_token;
 return v_token;
end;
$$;
