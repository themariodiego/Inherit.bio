-- Verified own-Auth contact producer. Existing v1 algorithms and readiness
-- trigger are unchanged. No contact authority is inferred or backfilled.
-- All predecessor checks, exact new DDL and postconditions form one statement:
-- a failed check rolls back the entire operation even without a caller BEGIN.
do $verified_account_contact$
declare item record; actual jsonb; v_fn regprocedure;
 v_original_procs_before jsonb; v_original_procs_after jsonb;
begin
 if current_user<>'postgres' then
  raise exception using errcode='42501',message='verified account contact migration owner only';end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname in('public','private') and p.proname in(
    'guard_verified_account_contact_revision_v1','create_verified_account_cohort_draft_v2',
    'create_embryo_cohort_draft_v2','invalidate_verified_account_auth_contact_v1',
    'guard_verified_account_contact_index_v1'))
  or exists(select 1 from pg_trigger where
   (tgrelid='public.encrypted_contact_references'::regclass and tgname='verified_account_contact_revision_server_only')
    or (tgrelid='auth.users'::regclass and tgname='zz_invalidate_verified_account_auth_contact')
    or (tgrelid='public.contact_hmac_indexes'::regclass and tgname='verified_account_contact_index_immutable')) then
  raise exception using errcode='55000',message='verified account contact new object collision';end if;
 select jsonb_agg(to_jsonb(p) order by p.oid) into v_original_procs_before from pg_proc p;
 for item in select * from (values
('private.create_embryo_cohort_draft_core_v1(uuid,uuid,text,text,integer,bytea,text,text[],text[],text,boolean)','{"body_md5":"ac9536213857e907aa7dcd8c766910d3","owner":"postgres","language":"plpgsql","security_definer":true,"strict":false,"leakproof":false,"volatility":"v","parallel":"u","configuration":["search_path=\"\""],"kind":"f","cost":100,"rows":1000,"binary":null,"returns_set":true,"argument_count":11,"default_count":0,"argument_defaults":null,"arguments":"p_account_id uuid, p_session_id uuid, p_upload_situation text, p_basis_case text, p_embryo_count integer, p_owner_contact_ciphertext bytea, p_owner_contact_hmac text, p_contact_ciphertexts text[], p_contact_hmacs text[], p_token_nonce text, p_test_jurisdiction boolean","result":"TABLE(draft_id uuid, expires_at timestamp with time zone, required_principal_slots text[])","grants":["postgres=X/postgres"]}'::jsonb),
('private.create_embryo_cohort_draft_keyed_v1(uuid,uuid,text,text,integer,bytea,text,text[],text[],text,boolean,jsonb,jsonb)','{"body_md5":"d1e8afce8dcdcb20003e0c4e8b91ee77","owner":"postgres","language":"plpgsql","security_definer":true,"strict":false,"leakproof":false,"volatility":"v","parallel":"u","configuration":["search_path=\"\""],"kind":"f","cost":100,"rows":1000,"binary":null,"returns_set":true,"argument_count":13,"default_count":0,"argument_defaults":null,"arguments":"p_account_id uuid, p_session_id uuid, p_upload_situation text, p_basis_case text, p_embryo_count integer, p_owner_contact_ciphertext bytea, p_owner_contact_hmac text, p_contact_ciphertexts text[], p_contact_hmacs text[], p_token_nonce text, p_test_jurisdiction boolean, p_owner_contact_hmac_set jsonb, p_contact_hmac_sets jsonb","result":"TABLE(draft_id uuid, expires_at timestamp with time zone, required_principal_slots text[])","grants":["postgres=X/postgres","service_role=X/postgres"]}'::jsonb),
('private.hmac_active_revision_v1(text)','{"body_md5":"4fcbbbd40d431921fbcaac85acaa80eb","owner":"postgres","language":"sql","security_definer":false,"strict":false,"leakproof":false,"volatility":"s","parallel":"u","configuration":["search_path=\"\""],"kind":"f","cost":100,"rows":0,"binary":null,"returns_set":false,"argument_count":1,"default_count":0,"argument_defaults":null,"arguments":"p_keyring text","result":"bigint","grants":["postgres=X/postgres"]}'::jsonb),
('private.invalidate_own_ready_auth_contact_v1()','{"body_md5":"856a265b8a11947756d3c3462897e229","owner":"postgres","language":"plpgsql","security_definer":true,"strict":false,"leakproof":false,"volatility":"v","parallel":"u","configuration":["search_path=pg_catalog"],"kind":"f","cost":100,"rows":0,"binary":null,"returns_set":false,"argument_count":0,"default_count":0,"argument_defaults":null,"arguments":"","result":"trigger","grants":["postgres=X/postgres"]}'::jsonb),
('private.resolve_hmac_set_v1(text,text,jsonb)','{"body_md5":"8f474e7d3ba36608caaa5aa4856f0f6c","owner":"postgres","language":"plpgsql","security_definer":false,"strict":false,"leakproof":false,"volatility":"s","parallel":"u","configuration":["search_path=\"\""],"kind":"f","cost":100,"rows":0,"binary":null,"returns_set":false,"argument_count":3,"default_count":0,"argument_defaults":null,"arguments":"p_keyring text, p_legacy text, p_set jsonb","result":"jsonb","grants":["postgres=X/postgres"]}'::jsonb),
('private.validate_sensitive_account_session_v1(uuid,uuid)','{"body_md5":"ce8813a75279262687f546121d45b4ac","owner":"postgres","language":"plpgsql","security_definer":true,"strict":false,"leakproof":false,"volatility":"v","parallel":"u","configuration":["search_path=\"\""],"kind":"f","cost":100,"rows":0,"binary":null,"returns_set":false,"argument_count":2,"default_count":0,"argument_defaults":null,"arguments":"p_account_id uuid, p_session_id uuid","result":"void","grants":["postgres=X/postgres"]}'::jsonb),
('public.create_embryo_cohort_draft_v1(uuid,uuid,text,text,integer,bytea,text,text[],text[],text,boolean,jsonb,jsonb)','{"body_md5":"e457e2d10d0344d370264ee4c15a86d5","owner":"postgres","language":"sql","security_definer":false,"strict":false,"leakproof":false,"volatility":"v","parallel":"u","configuration":["search_path=\"\""],"kind":"f","cost":100,"rows":1000,"binary":null,"returns_set":true,"argument_count":13,"default_count":2,"argument_defaults":"NULL::jsonb, NULL::jsonb","arguments":"p_account_id uuid, p_session_id uuid, p_upload_situation text, p_basis_case text, p_embryo_count integer, p_owner_contact_ciphertext bytea, p_owner_contact_hmac text, p_contact_ciphertexts text[], p_contact_hmacs text[], p_token_nonce text, p_test_jurisdiction boolean, p_owner_contact_hmac_set jsonb DEFAULT NULL::jsonb, p_contact_hmac_sets jsonb DEFAULT NULL::jsonb","result":"TABLE(draft_id uuid, expires_at timestamp with time zone, required_principal_slots text[])","grants":["postgres=X/postgres","service_role=X/postgres"]}'::jsonb)
 ) source(signature,expected) loop
  v_fn:=to_regprocedure(item.signature);
  select jsonb_build_object('body_md5',md5(p.prosrc),'owner',pg_get_userbyid(p.proowner),
   'language',l.lanname,'security_definer',p.prosecdef,'strict',p.proisstrict,'leakproof',p.proleakproof,
   'volatility',p.provolatile::text,'parallel',p.proparallel::text,'configuration',to_jsonb(p.proconfig),
   'kind',p.prokind::text,'cost',p.procost,'rows',p.prorows,'binary',p.probin,'returns_set',p.proretset,
   'argument_count',p.pronargs,'default_count',p.pronargdefaults,'argument_defaults',pg_get_expr(p.proargdefaults,0),
   'arguments',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid),
   'grants',(select jsonb_agg(a::text order by a::text collate "C") from unnest(coalesce(p.proacl,acldefault('f',p.proowner))) a))
  into actual from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=v_fn;
  if actual is distinct from item.expected or exists(select 1 from unnest(array['anon','authenticated','inherit_upload_only']) role
    where has_function_privilege(role,v_fn,'EXECUTE')) then
   raise exception using errcode='55000',message='verified account contact predecessor differs';end if;
 end loop;
 if exists(select 1 from pg_attribute where attrelid='public.encrypted_contact_references'::regclass
    and attname='account_mail_contact_revision' and not attisdropped)
  or (select array_agg(attname::text order by attnum) from pg_attribute
   where attrelid='public.encrypted_contact_references'::regclass and attnum>0 and not attisdropped)
     is distinct from array['id','principal_id','contact_ciphertext','contact_hmac','key_revision','authority_revision','status','created_at','ended_at']::text[]
  or not exists(select 1 from pg_trigger where tgrelid='auth.users'::regclass and tgname='invalidate_own_ready_auth_contact'
   and tgenabled='O' and not tgisinternal and tgfoid='private.invalidate_own_ready_auth_contact_v1()'::regprocedure
   and pg_get_triggerdef(oid)='CREATE TRIGGER invalidate_own_ready_auth_contact AFTER UPDATE OF email, email_confirmed_at ON auth.users FOR EACH ROW WHEN ((((old.email)::text IS DISTINCT FROM (new.email)::text) OR (old.email_confirmed_at IS DISTINCT FROM new.email_confirmed_at))) EXECUTE FUNCTION private.invalidate_own_ready_auth_contact_v1()') then
  raise exception using errcode='55000',message='verified account contact schema predecessor differs';end if;

 execute $verified_contact_ddl$
alter table public.encrypted_contact_references add column account_mail_contact_revision bigint
 check(account_mail_contact_revision is null or account_mail_contact_revision>0);
comment on column public.encrypted_contact_references.account_mail_contact_revision is
 'Verified own-Auth self-account mail revision. Legacy contacts remain NULL and unproven; never inferred or backfilled.';

-- A proven revision is immutable. Legacy NULL cannot be promoted in place;
-- the API service role cannot write new proof by direct contact-table access.
create function private.guard_verified_account_contact_revision_v1()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if (tg_op='UPDATE' and new.account_mail_contact_revision is distinct from old.account_mail_contact_revision)
  or (tg_op='INSERT' and new.account_mail_contact_revision is not null and current_user<>'postgres') then
  raise exception using errcode='42501',message='verified account contact revision server only';end if;
 if tg_op='UPDATE' and old.account_mail_contact_revision is not null and (
  (new.id,new.principal_id,new.contact_hmac,new.key_revision,new.authority_revision,new.created_at)
   is distinct from (old.id,old.principal_id,old.contact_hmac,old.key_revision,old.authority_revision,old.created_at)
  or (new.contact_ciphertext is distinct from old.contact_ciphertext
   and not(new.status='shredded' and new.contact_ciphertext is null))
  or (old.status='rotated' and new.status='current')
  or (old.status='shredded' and new.status<>'shredded')
  or (new.status='current' and new.ended_at is not null)
  or (new.status<>'current' and new.ended_at is null)) then
  raise exception using errcode='42501',message='verified account contact revision server only';end if;
 return new;
end $$;
revoke all on function private.guard_verified_account_contact_revision_v1() from public,anon,authenticated,service_role,inherit_upload_only;
create trigger verified_account_contact_revision_server_only before insert or update on public.encrypted_contact_references
 for each row execute function private.guard_verified_account_contact_revision_v1();

-- The same proven contact owns its exact index identity and fixed deadline.
-- Ordinary status expiry/revocation and child-first deletion remain available.
create function private.guard_verified_account_contact_index_v1()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if exists(select 1 from public.encrypted_contact_references contact
  where contact.account_mail_contact_revision is not null and
   (contact.id=new.contact_reference_id or (tg_op='UPDATE' and contact.id=old.contact_reference_id))) then
  if (tg_op='INSERT' and current_user<>'postgres') or (tg_op='UPDATE' and (
   (new.contact_reference_id,new.contact_hmac,new.hmac_key_revision,new.expires_at)
    is distinct from (old.contact_reference_id,old.contact_hmac,old.hmac_key_revision,old.expires_at)
   or (old.status<>'current' and new.status='current'))) then
   raise exception using errcode='42501',message='verified account contact index immutable';end if;
 end if;
 return new;
end $$;
revoke all on function private.guard_verified_account_contact_index_v1() from public,anon,authenticated,service_role,inherit_upload_only;
create trigger verified_account_contact_index_immutable before insert or update on public.contact_hmac_indexes
 for each row execute function private.guard_verified_account_contact_index_v1();

create function private.create_verified_account_cohort_draft_v2(
 p_account_id uuid,p_session_id uuid,p_upload_situation text,p_basis_case text,p_embryo_count integer,
 p_owner_contact_ciphertext bytea,p_owner_contact_hmac text,p_contact_ciphertexts text[],p_contact_hmacs text[],
 p_token_nonce text,p_test_jurisdiction boolean,p_owner_contact_hmac_set jsonb,p_contact_hmac_sets jsonb,
 p_verified_auth_email text
) returns table(draft_id uuid,expires_at timestamptz,required_principal_slots text[])
language plpgsql security definer set search_path='' as $$
declare owner auth.users; profile public.profiles; principal public.subject_principals;
 contact public.encrypted_contact_references; digest_set jsonb; active_revision bigint; result record; count_current bigint;
begin
 perform private.lock_invitation_transitions_v1();
 -- The live Auth row is locked before session/profile/contact authority. An
 -- email transition cannot commit between this check and contact creation.
 select * into owner from auth.users where id=p_account_id for update;
 if owner.id is null or owner.deleted_at is not null or owner.email_confirmed_at is null
  or nullif(btrim(owner.email),'') is null
  or owner.email_confirmed_at>clock_timestamp() or (owner.banned_until is not null and owner.banned_until>clock_timestamp())
  or p_verified_auth_email is null or p_verified_auth_email<>lower(btrim(owner.email))
  or octet_length(p_verified_auth_email) not between 3 and 254 then
  raise exception using errcode='42501',message='verified account contact unavailable';end if;
 perform private.validate_sensitive_account_session_v1(p_account_id,p_session_id);
 select * into profile from public.profiles where id=p_account_id for update;
 if profile.id is null or profile.deletion_requested_at is not null or exists(select 1 from public.account_deletion_requests
  where account_id=p_account_id and state in('notice_period','delete_started')) then
  raise exception using errcode='42501',message='verified account contact unavailable';end if;
 select count(*) into count_current from public.subject_principals sp join public.subjects s on s.id=sp.subject_id
  where sp.account_id=p_account_id and sp.principal_kind='account_subject' and sp.status='active'
   and s.subject_class='self' and s.subject_account_id=p_account_id and s.lifecycle='active';
 if count_current<>1 then raise exception using errcode='42501',message='verified account contact unavailable';end if;
 select sp.* into principal from public.subject_principals sp join public.subjects s on s.id=sp.subject_id
  where sp.account_id=p_account_id and sp.principal_kind='account_subject' and sp.status='active'
   and s.subject_class='self' and s.subject_account_id=p_account_id and s.lifecycle='active' for update of sp,s;
 if not exists(select 1 from public.subject_account_bindings binding where binding.subject_principal_id=principal.id
   and binding.account_id=p_account_id and binding.subject_id=principal.subject_id and binding.status='current'
   and binding.binding_kind='self' and binding.account_principal_id=principal.id) then
  raise exception using errcode='42501',message='verified account contact unavailable';end if;
 if p_owner_contact_hmac is not null or p_owner_contact_hmac_set is null or p_owner_contact_ciphertext is null
  or octet_length(p_owner_contact_ciphertext) not between 29 and 16384 then
  raise exception using errcode='42501',message='verified account contact unavailable';end if;
 digest_set:=private.resolve_hmac_set_v1('contact',null,p_owner_contact_hmac_set);
 active_revision:=private.hmac_active_revision_v1('contact');
 if digest_set is null then raise exception using errcode='42501',message='verified account contact unavailable';end if;
 select count(*) into count_current from public.encrypted_contact_references stored
  where stored.principal_id=principal.id and stored.status='current';
 if count_current>1 then raise exception using errcode='42501',message='verified account contact unavailable';end if;
 select * into contact from public.encrypted_contact_references stored
  where stored.principal_id=principal.id and stored.status='current' for update;
 if contact.id is not null and (contact.contact_ciphertext is null
  or contact.authority_revision is distinct from principal.principal_revision
  or contact.account_mail_contact_revision is distinct from profile.mail_contact_revision
  or contact.contact_hmac is distinct from digest_set->>contact.key_revision::text
  or exists(select 1 from jsonb_each_text(digest_set) held where not exists(select 1 from public.contact_hmac_indexes h
   where h.contact_reference_id=contact.id and h.hmac_key_revision=held.key::bigint and h.status='current' and h.contact_hmac=held.value
    and h.expires_at>statement_timestamp()))
  or exists(select 1 from public.contact_hmac_indexes h where h.contact_reference_id=contact.id and h.status='current'
   and h.contact_hmac is distinct from digest_set->>h.hmac_key_revision::text)) then
  -- Legacy NULL contacts remain NULL: neither promote nor duplicate them.
  raise exception using errcode='42501',message='verified account contact unavailable';end if;
 select * into strict result from public.create_embryo_cohort_draft_v1(p_account_id,p_session_id,p_upload_situation,
  p_basis_case,p_embryo_count,p_owner_contact_ciphertext,null,p_contact_ciphertexts,p_contact_hmacs,p_token_nonce,
  p_test_jurisdiction,p_owner_contact_hmac_set,p_contact_hmac_sets);
 if contact.id is null then
  insert into public.encrypted_contact_references(principal_id,contact_ciphertext,contact_hmac,key_revision,authority_revision,
   account_mail_contact_revision,status) values(principal.id,p_owner_contact_ciphertext,digest_set->>active_revision::text,
   active_revision,principal.principal_revision,profile.mail_contact_revision,'current') returning * into contact;
  insert into public.contact_hmac_indexes(contact_reference_id,contact_hmac,hmac_key_revision,status,expires_at)
   select contact.id,held.value,held.key::bigint,'current',result.expires_at from jsonb_each_text(digest_set) held;
 end if;
 return query select result.draft_id,result.expires_at,result.required_principal_slots;
end $$;
revoke all on function private.create_verified_account_cohort_draft_v2(uuid,uuid,text,text,integer,bytea,text,text[],text[],text,boolean,jsonb,jsonb,text)
 from public,anon,authenticated,service_role,inherit_upload_only;

create function public.create_embryo_cohort_draft_v2(
 p_account_id uuid,p_session_id uuid,p_upload_situation text,p_basis_case text,p_embryo_count integer,
 p_owner_contact_ciphertext bytea,p_owner_contact_hmac text,p_contact_ciphertexts text[],p_contact_hmacs text[],
 p_token_nonce text,p_test_jurisdiction boolean,p_owner_contact_hmac_set jsonb,p_contact_hmac_sets jsonb,p_verified_auth_email text
) returns table(draft_id uuid,expires_at timestamptz,required_principal_slots text[])
language sql security definer set search_path='' as $$
 select * from private.create_verified_account_cohort_draft_v2(p_account_id,p_session_id,p_upload_situation,p_basis_case,p_embryo_count,
  p_owner_contact_ciphertext,p_owner_contact_hmac,p_contact_ciphertexts,p_contact_hmacs,p_token_nonce,p_test_jurisdiction,
  p_owner_contact_hmac_set,p_contact_hmac_sets,p_verified_auth_email);
$$;
revoke all on function public.create_embryo_cohort_draft_v2(uuid,uuid,text,text,integer,bytea,text,text[],text[],text,boolean,jsonb,jsonb,text)
 from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.create_embryo_cohort_draft_v2(uuid,uuid,text,text,integer,bytea,text,text[],text[],text,boolean,jsonb,jsonb,text) to service_role;

-- A separate participant preserves the original readiness trigger byte-exact.
-- Its name runs after that trigger's mail_contact_revision increment.
create function private.invalidate_verified_account_auth_contact_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.mail_outbox mail set state='invalidated',claimed_at=null,last_outcome_code='recipient_authority_stale'
 where mail.state in('queued','claimed') and exists(select 1 from public.encrypted_contact_references contact
  join public.subject_principals principal on principal.id=contact.principal_id
  join public.subjects subject on subject.id=principal.subject_id
  where contact.id=mail.contact_reference_id and contact.account_mail_contact_revision is not null
   and principal.principal_kind='account_subject' and principal.account_id=new.id
   and subject.subject_class='self' and subject.subject_account_id=new.id);
 update public.contact_hmac_indexes h set status='revoked' where h.status='current' and exists(
  select 1 from public.encrypted_contact_references contact join public.subject_principals principal on principal.id=contact.principal_id
   join public.subjects subject on subject.id=principal.subject_id
  where contact.id=h.contact_reference_id and contact.account_mail_contact_revision is not null
   and principal.principal_kind='account_subject' and principal.account_id=new.id
   and subject.subject_class='self' and subject.subject_account_id=new.id);
 update public.encrypted_contact_references contact set status='rotated',ended_at=clock_timestamp()
 from public.subject_principals principal join public.subjects subject on subject.id=principal.subject_id
 where principal.id=contact.principal_id and contact.status='current' and contact.account_mail_contact_revision is not null
  and principal.principal_kind='account_subject' and principal.account_id=new.id
  and subject.subject_class='self' and subject.subject_account_id=new.id;
 return new;
end $$;
revoke all on function private.invalidate_verified_account_auth_contact_v1() from public,anon,authenticated,service_role,inherit_upload_only;
create trigger zz_invalidate_verified_account_auth_contact after update of email,email_confirmed_at on auth.users
 for each row when(old.email is distinct from new.email or old.email_confirmed_at is distinct from new.email_confirmed_at)
 execute function private.invalidate_verified_account_auth_contact_v1();

 $verified_contact_ddl$;
 if not exists(select 1 from pg_attribute where attrelid='public.encrypted_contact_references'::regclass
  and attname='account_mail_contact_revision' and atttypid='bigint'::regtype and not attnotnull and not atthasdef and not attisdropped)
  or exists(select 1 from public.encrypted_contact_references where account_mail_contact_revision is not null)
  or exists(select 1 from unnest(array['anon','authenticated','service_role','inherit_upload_only']) role cross join unnest(array[
   'private.create_verified_account_cohort_draft_v2(uuid,uuid,text,text,integer,bytea,text,text[],text[],text,boolean,jsonb,jsonb,text)',
   'private.invalidate_verified_account_auth_contact_v1()',
   'private.guard_verified_account_contact_revision_v1()']) fn where has_function_privilege(role,fn,'execute'))
  or exists(select 1 from unnest(array['anon','authenticated','inherit_upload_only']) role where has_function_privilege(role,
   'public.create_embryo_cohort_draft_v2(uuid,uuid,text,text,integer,bytea,text,text[],text[],text,boolean,jsonb,jsonb,text)','execute'))
  or not has_function_privilege('service_role',
   'public.create_embryo_cohort_draft_v2(uuid,uuid,text,text,integer,bytea,text,text[],text[],text,boolean,jsonb,jsonb,text)','execute') then
  raise exception using errcode='55000',message='verified account contact postcondition differs';end if;

 for item in select * from (values
('private.guard_verified_account_contact_revision_v1()','{"body_md5":"8f32523d2fa953b1b7eff27a2009f3ac","owner":"postgres","language":"plpgsql","security_definer":false,"strict":false,"leakproof":false,"volatility":"v","parallel":"u","configuration":["search_path=\"\""],"kind":"f","cost":100,"rows":0,"binary":null,"returns_set":false,"argument_count":0,"default_count":0,"argument_defaults":null,"arguments":"","result":"trigger","grants":["postgres=X/postgres"],"input_argument_types":[],"all_argument_types":[],"argument_names":null,"argument_modes":null,"variadic_type":null,"support_function":null,"transform_types":null}'::jsonb),
('private.guard_verified_account_contact_index_v1()','{"body_md5":"70cb879c4dab1cc67ca8ef57820ad8c7","owner":"postgres","language":"plpgsql","security_definer":false,"strict":false,"leakproof":false,"volatility":"v","parallel":"u","configuration":["search_path=\"\""],"kind":"f","cost":100,"rows":0,"binary":null,"returns_set":false,"argument_count":0,"default_count":0,"argument_defaults":null,"arguments":"","result":"trigger","grants":["postgres=X/postgres"],"input_argument_types":[],"all_argument_types":[],"argument_names":null,"argument_modes":null,"variadic_type":null,"support_function":null,"transform_types":null}'::jsonb),
('private.create_verified_account_cohort_draft_v2(uuid,uuid,text,text,integer,bytea,text,text[],text[],text,boolean,jsonb,jsonb,text)','{"body_md5":"1eedcbc40d3fcedfbf5595b88d375017","owner":"postgres","language":"plpgsql","security_definer":true,"strict":false,"leakproof":false,"volatility":"v","parallel":"u","configuration":["search_path=\"\""],"kind":"f","cost":100,"rows":1000,"binary":null,"returns_set":true,"argument_count":14,"default_count":0,"argument_defaults":null,"arguments":"p_account_id uuid, p_session_id uuid, p_upload_situation text, p_basis_case text, p_embryo_count integer, p_owner_contact_ciphertext bytea, p_owner_contact_hmac text, p_contact_ciphertexts text[], p_contact_hmacs text[], p_token_nonce text, p_test_jurisdiction boolean, p_owner_contact_hmac_set jsonb, p_contact_hmac_sets jsonb, p_verified_auth_email text","result":"TABLE(draft_id uuid, expires_at timestamp with time zone, required_principal_slots text[])","grants":["postgres=X/postgres"],"input_argument_types":["uuid","uuid","text","text","integer","bytea","text","text[]","text[]","text","boolean","jsonb","jsonb","text"],"all_argument_types":["uuid","uuid","text","text","integer","bytea","text","text[]","text[]","text","boolean","jsonb","jsonb","text","uuid","timestamp with time zone","text[]"],"argument_names":["p_account_id","p_session_id","p_upload_situation","p_basis_case","p_embryo_count","p_owner_contact_ciphertext","p_owner_contact_hmac","p_contact_ciphertexts","p_contact_hmacs","p_token_nonce","p_test_jurisdiction","p_owner_contact_hmac_set","p_contact_hmac_sets","p_verified_auth_email","draft_id","expires_at","required_principal_slots"],"argument_modes":["i","i","i","i","i","i","i","i","i","i","i","i","i","i","t","t","t"],"variadic_type":null,"support_function":null,"transform_types":null}'::jsonb),
('public.create_embryo_cohort_draft_v2(uuid,uuid,text,text,integer,bytea,text,text[],text[],text,boolean,jsonb,jsonb,text)','{"body_md5":"add22f131b382e1606b31bbe4cb770fb","owner":"postgres","language":"sql","security_definer":true,"strict":false,"leakproof":false,"volatility":"v","parallel":"u","configuration":["search_path=\"\""],"kind":"f","cost":100,"rows":1000,"binary":null,"returns_set":true,"argument_count":14,"default_count":0,"argument_defaults":null,"arguments":"p_account_id uuid, p_session_id uuid, p_upload_situation text, p_basis_case text, p_embryo_count integer, p_owner_contact_ciphertext bytea, p_owner_contact_hmac text, p_contact_ciphertexts text[], p_contact_hmacs text[], p_token_nonce text, p_test_jurisdiction boolean, p_owner_contact_hmac_set jsonb, p_contact_hmac_sets jsonb, p_verified_auth_email text","result":"TABLE(draft_id uuid, expires_at timestamp with time zone, required_principal_slots text[])","grants":["postgres=X/postgres","service_role=X/postgres"],"input_argument_types":["uuid","uuid","text","text","integer","bytea","text","text[]","text[]","text","boolean","jsonb","jsonb","text"],"all_argument_types":["uuid","uuid","text","text","integer","bytea","text","text[]","text[]","text","boolean","jsonb","jsonb","text","uuid","timestamp with time zone","text[]"],"argument_names":["p_account_id","p_session_id","p_upload_situation","p_basis_case","p_embryo_count","p_owner_contact_ciphertext","p_owner_contact_hmac","p_contact_ciphertexts","p_contact_hmacs","p_token_nonce","p_test_jurisdiction","p_owner_contact_hmac_set","p_contact_hmac_sets","p_verified_auth_email","draft_id","expires_at","required_principal_slots"],"argument_modes":["i","i","i","i","i","i","i","i","i","i","i","i","i","i","t","t","t"],"variadic_type":null,"support_function":null,"transform_types":null}'::jsonb),
('private.invalidate_verified_account_auth_contact_v1()','{"body_md5":"08745dfb49acbe424934ef09a3a25937","owner":"postgres","language":"plpgsql","security_definer":true,"strict":false,"leakproof":false,"volatility":"v","parallel":"u","configuration":["search_path=\"\""],"kind":"f","cost":100,"rows":0,"binary":null,"returns_set":false,"argument_count":0,"default_count":0,"argument_defaults":null,"arguments":"","result":"trigger","grants":["postgres=X/postgres"],"input_argument_types":[],"all_argument_types":[],"argument_names":null,"argument_modes":null,"variadic_type":null,"support_function":null,"transform_types":null}'::jsonb)
 ) source(signature,expected) loop
  v_fn:=to_regprocedure(item.signature);
  select jsonb_build_object('body_md5',md5(p.prosrc),'owner',pg_get_userbyid(p.proowner),
   'language',l.lanname,'security_definer',p.prosecdef,'strict',p.proisstrict,'leakproof',p.proleakproof,
   'volatility',p.provolatile::text,'parallel',p.proparallel::text,'configuration',to_jsonb(p.proconfig),
   'kind',p.prokind::text,'cost',p.procost,'rows',p.prorows,'binary',p.probin,'returns_set',p.proretset,
   'argument_count',p.pronargs,'default_count',p.pronargdefaults,'argument_defaults',pg_get_expr(p.proargdefaults,0),
   'arguments',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid),
   'grants',(select jsonb_agg(a::text order by a::text collate "C") from unnest(coalesce(p.proacl,acldefault('f',p.proowner))) a),
   'input_argument_types',to_jsonb(array(select format_type(p.proargtypes[i],null) from generate_series(0,p.pronargs-1) i)),
   'all_argument_types',to_jsonb(array(select format_type(t,null) from unnest(p.proallargtypes) with ordinality input(t,position) order by position)),
   'argument_names',to_jsonb(p.proargnames),'argument_modes',to_jsonb(p.proargmodes),
   'variadic_type',case when p.provariadic=0 then null else format_type(p.provariadic,null) end,
   'support_function',case when p.prosupport=0 then null else p.prosupport::regprocedure::text end,
   'transform_types',to_jsonb(p.protrftypes)) into actual
  from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=v_fn;
  if actual is distinct from item.expected
    or exists(select 1 from unnest(array['anon','authenticated','inherit_upload_only']) role where has_function_privilege(role,v_fn,'EXECUTE'))
    or has_function_privilege('service_role',v_fn,'EXECUTE') is distinct from (item.signature like 'public.%') then
   raise exception using errcode='55000',message='verified account contact function postcondition differs';end if;
 end loop;
 -- Check complete original pg_proc rows, not only the projected pins. New
 -- routines may be added; no original procedure/catalog/ACL field may change.
 select jsonb_agg(to_jsonb(p) order by p.oid) into v_original_procs_after from pg_proc p
  where p.oid in(select (captured->>'oid')::oid from jsonb_array_elements(v_original_procs_before) captured);
 if v_original_procs_after is distinct from v_original_procs_before then
  raise exception using errcode='55000',message='verified account contact changed original procedure metadata';end if;
 -- Exact new trigger edges and enabled row-event behavior.
 if not exists(select 1 from pg_trigger where tgrelid='public.encrypted_contact_references'::regclass
   and tgname='verified_account_contact_revision_server_only' and tgenabled='O' and not tgisinternal
   and tgfoid='private.guard_verified_account_contact_revision_v1()'::regprocedure
   and pg_get_triggerdef(oid)='CREATE TRIGGER verified_account_contact_revision_server_only BEFORE INSERT OR UPDATE ON public.encrypted_contact_references FOR EACH ROW EXECUTE FUNCTION private.guard_verified_account_contact_revision_v1()')
  or not exists(select 1 from pg_trigger where tgrelid='public.contact_hmac_indexes'::regclass
   and tgname='verified_account_contact_index_immutable' and tgenabled='O' and not tgisinternal
   and tgfoid='private.guard_verified_account_contact_index_v1()'::regprocedure
   and pg_get_triggerdef(oid)='CREATE TRIGGER verified_account_contact_index_immutable BEFORE INSERT OR UPDATE ON public.contact_hmac_indexes FOR EACH ROW EXECUTE FUNCTION private.guard_verified_account_contact_index_v1()')
  or not exists(select 1 from pg_trigger where tgrelid='auth.users'::regclass
   and tgname='zz_invalidate_verified_account_auth_contact' and tgenabled='O' and not tgisinternal
   and tgfoid='private.invalidate_verified_account_auth_contact_v1()'::regprocedure
   and pg_get_triggerdef(oid)='CREATE TRIGGER zz_invalidate_verified_account_auth_contact AFTER UPDATE OF email, email_confirmed_at ON auth.users FOR EACH ROW WHEN ((((old.email)::text IS DISTINCT FROM (new.email)::text) OR (old.email_confirmed_at IS DISTINCT FROM new.email_confirmed_at))) EXECUTE FUNCTION private.invalidate_verified_account_auth_contact_v1()') then
  raise exception using errcode='55000',message='verified account contact trigger postcondition differs';end if;
end $verified_account_contact$;
