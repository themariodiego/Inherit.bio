-- Bounded owner-only synthetic historical account-request prerequisite.
-- Current native HTTP202 and real-time v2/nonce/due/239 paths stay unchanged.
-- A fresh page-issued nonce must be verified by the real application before
-- this owner entry; this gives no HTTP202, elapsed or physical-provider credit.
-- No row is aged, no registry/period changes, and all new API roles are denied.
do $historical_account$
declare expected jsonb; target regprocedure; before_metadata jsonb:='{}'; actual jsonb;
  pins constant jsonb := $pins$[{"signature":"public.request_account_deletion_v1(uuid,uuid,text,bytea,text,text)","name":"public.request_account_deletion_v1","bodyMd5":"cc02de010c27a714ff5ba96226016d60","argumentNames":["p_account_id","p_session_id","p_nonce_hash","p_contact_ciphertext","p_contact_hmac","p_notice_idempotency_key","deletion_id","status","notice_ends_at"],"inputCount":6,"allArgumentTypes":["uuid","uuid","text","bytea","text","text","uuid","text","timestamp with time zone"],"argumentModes":["i","i","i","i","i","i","t","t","t"],"inputTypes":"uuid, uuid, text, bytea, text, text","result":"TABLE(deletion_id uuid, status text, notice_ends_at timestamp with time zone)","setReturning":true,"language":"plpgsql","securityDefiner":true,"volatility":"v","parallel":"u","defaultCount":0,"defaultExpression":null,"config":["search_path=\"\""],"owner":"postgres","serviceExecute":false,"sourcePath":"supabase/migrations/20260930238000_account_cohort_notices.sql","successorBodyMd5":"280878be5b442da38b9102f180b8457d"},{"signature":"private.enqueue_account_affected_notice_v1(uuid,jsonb,boolean,timestamptz)","name":"private.enqueue_account_affected_notice_v1","bodyMd5":"09e28871183342525fe46d4bccda37bb","argumentNames":["p_deletion","p_binding","p_cancelled","p_at"],"inputCount":4,"allArgumentTypes":null,"argumentModes":null,"inputTypes":"uuid, jsonb, boolean, timestamp with time zone","result":"uuid","setReturning":false,"language":"plpgsql","securityDefiner":true,"volatility":"v","parallel":"u","defaultCount":0,"defaultExpression":null,"config":["search_path=\"\""],"owner":"postgres","serviceExecute":false,"sourcePath":"supabase/migrations/20260930238000_account_cohort_notices.sql","successorBodyMd5":"738cb562e8383bcad24356eb88d7924a"},{"signature":"public.request_account_deletion_v2(uuid,uuid,text,timestamptz,bytea,text,text)","name":"public.request_account_deletion_v2","bodyMd5":"6bc32c31a256f9cf27659da73f6a0486","argumentNames":["p_account_id","p_session_id","p_nonce_hash","p_nonce_expires_at","p_contact_ciphertext","p_contact_hmac","p_notice_idempotency_key","deletion_id","status","notice_ends_at"],"inputCount":7,"allArgumentTypes":["uuid","uuid","text","timestamp with time zone","bytea","text","text","uuid","text","timestamp with time zone"],"argumentModes":["i","i","i","i","i","i","i","t","t","t"],"inputTypes":"uuid, uuid, text, timestamp with time zone, bytea, text, text","result":"TABLE(deletion_id uuid, status text, notice_ends_at timestamp with time zone)","setReturning":true,"language":"sql","securityDefiner":false,"volatility":"v","parallel":"u","defaultCount":0,"defaultExpression":null,"config":["search_path=\"\""],"owner":"postgres","serviceExecute":true,"sourcePath":"supabase/migrations/20260930140200_account_operation_nonce_rendered.sql","successorBodyMd5":"6bc32c31a256f9cf27659da73f6a0486"},{"signature":"private.request_account_deletion_v2(uuid,uuid,text,timestamptz,bytea,text,text)","name":"private.request_account_deletion_v2","bodyMd5":"f89dcda65e30d4223387d63843c291e0","argumentNames":["p_account_id","p_session_id","p_nonce_hash","p_nonce_expires_at","p_contact_ciphertext","p_contact_hmac","p_notice_idempotency_key","deletion_id","status","notice_ends_at"],"inputCount":7,"allArgumentTypes":["uuid","uuid","text","timestamp with time zone","bytea","text","text","uuid","text","timestamp with time zone"],"argumentModes":["i","i","i","i","i","i","i","t","t","t"],"inputTypes":"uuid, uuid, text, timestamp with time zone, bytea, text, text","result":"TABLE(deletion_id uuid, status text, notice_ends_at timestamp with time zone)","setReturning":true,"language":"plpgsql","securityDefiner":true,"volatility":"v","parallel":"u","defaultCount":0,"defaultExpression":null,"config":["search_path=\"\""],"owner":"postgres","serviceExecute":true,"sourcePath":"supabase/migrations/20260930140200_account_operation_nonce_rendered.sql","successorBodyMd5":"f89dcda65e30d4223387d63843c291e0"},{"signature":"private.record_account_operation_nonce_v1(uuid,uuid,text,text,timestamptz)","name":"private.record_account_operation_nonce_v1","bodyMd5":"a71e2d5c1908d171bedeae278bdd1a79","argumentNames":["p_account_id","p_session_id","p_operation","p_nonce_hash","p_expires_at"],"inputCount":5,"allArgumentTypes":null,"argumentModes":null,"inputTypes":"uuid, uuid, text, text, timestamp with time zone","result":"void","setReturning":false,"language":"plpgsql","securityDefiner":true,"volatility":"v","parallel":"u","defaultCount":0,"defaultExpression":null,"config":["search_path=\"\""],"owner":"postgres","serviceExecute":false,"sourcePath":"supabase/migrations/20260930140200_account_operation_nonce_rendered.sql","successorBodyMd5":"a71e2d5c1908d171bedeae278bdd1a79"},{"signature":"private.validate_sensitive_account_session_v1(uuid,uuid)","name":"private.validate_sensitive_account_session_v1","bodyMd5":"ce8813a75279262687f546121d45b4ac","argumentNames":["p_account_id","p_session_id"],"inputCount":2,"allArgumentTypes":null,"argumentModes":null,"inputTypes":"uuid, uuid","result":"void","setReturning":false,"language":"plpgsql","securityDefiner":true,"volatility":"v","parallel":"u","defaultCount":0,"defaultExpression":null,"config":["search_path=\"\""],"owner":"postgres","serviceExecute":false,"sourcePath":"supabase/migrations/20260901033000_account_deletion_notice_runtime.sql","successorBodyMd5":"ce8813a75279262687f546121d45b4ac"},{"signature":"public.claim_due_account_deletion_v1(text,integer)","name":"public.claim_due_account_deletion_v1","bodyMd5":"becdeb884370f707f57752d0dc7c2873","argumentNames":["p_claim_token_hash","p_lease_seconds","deletion_id","account_id","storage_objects","database_already_purged"],"inputCount":2,"allArgumentTypes":["text","integer","uuid","uuid","jsonb","boolean"],"argumentModes":["i","i","t","t","t","t"],"inputTypes":"text, integer","result":"TABLE(deletion_id uuid, account_id uuid, storage_objects jsonb, database_already_purged boolean)","setReturning":true,"language":"plpgsql","securityDefiner":true,"volatility":"v","parallel":"u","defaultCount":1,"defaultExpression":"300","config":["search_path=\"\""],"owner":"postgres","serviceExecute":true,"sourcePath":"supabase/migrations/20260930238000_account_cohort_notices.sql","successorBodyMd5":"becdeb884370f707f57752d0dc7c2873"},{"signature":"private.account_affected_notice_envelope_v1(uuid)","name":"private.account_affected_notice_envelope_v1","bodyMd5":"d0adfb68ddf9d75bedaca974405254d1","argumentNames":["p_account"],"inputCount":1,"allArgumentTypes":null,"argumentModes":null,"inputTypes":"uuid","result":"jsonb","setReturning":false,"language":"plpgsql","securityDefiner":true,"volatility":"v","parallel":"u","defaultCount":0,"defaultExpression":null,"config":["search_path=\"\""],"owner":"postgres","serviceExecute":false,"sourcePath":"supabase/migrations/20260930238000_account_cohort_notices.sql","successorBodyMd5":"d0adfb68ddf9d75bedaca974405254d1"},{"signature":"private.assert_account_affected_notice_receipt_v1(uuid,jsonb)","name":"private.assert_account_affected_notice_receipt_v1","bodyMd5":"4311bcaa5329a9c367ba334054516cbb","argumentNames":["p_deletion","p_envelope"],"inputCount":2,"allArgumentTypes":null,"argumentModes":null,"inputTypes":"uuid, jsonb","result":"void","setReturning":false,"language":"plpgsql","securityDefiner":true,"volatility":"v","parallel":"u","defaultCount":0,"defaultExpression":null,"config":["search_path=\"\""],"owner":"postgres","serviceExecute":false,"sourcePath":"supabase/migrations/20260930238000_account_cohort_notices.sql","successorBodyMd5":"4311bcaa5329a9c367ba334054516cbb"},{"signature":"private.assert_account_path_b_deletion_supported_v1(uuid)","name":"private.assert_account_path_b_deletion_supported_v1","bodyMd5":"6382fbb06d5525dc983806ecefebb629","argumentNames":["p_account_id"],"inputCount":1,"allArgumentTypes":null,"argumentModes":null,"inputTypes":"uuid","result":"void","setReturning":false,"language":"plpgsql","securityDefiner":true,"volatility":"v","parallel":"u","defaultCount":0,"defaultExpression":null,"config":["search_path=\"\""],"owner":"postgres","serviceExecute":false,"sourcePath":"supabase/migrations/20261001030000_account_path_b_request_refusal.sql","successorBodyMd5":"6382fbb06d5525dc983806ecefebb629"},{"signature":"private.assert_account_owned_cohorts_v1(uuid)","name":"private.assert_account_owned_cohorts_v1","bodyMd5":"4c16b808f87f91b640b94a19f13c2f74","argumentNames":["p_account"],"inputCount":1,"allArgumentTypes":null,"argumentModes":null,"inputTypes":"uuid","result":"void","setReturning":false,"language":"plpgsql","securityDefiner":true,"volatility":"v","parallel":"u","defaultCount":0,"defaultExpression":null,"config":["search_path=\"\""],"owner":"postgres","serviceExecute":false,"sourcePath":"supabase/migrations/20260930235000_account_cohort_purge.sql","successorBodyMd5":"4c16b808f87f91b640b94a19f13c2f74"},{"signature":"private.assert_supported_self_deletion_graph_v1(uuid)","name":"private.assert_supported_self_deletion_graph_v1","bodyMd5":"be1e996ec3bf2c0e585c7a4b39decbc1","argumentNames":["p_account_id"],"inputCount":1,"allArgumentTypes":null,"argumentModes":null,"inputTypes":"uuid","result":"uuid","setReturning":false,"language":"plpgsql","securityDefiner":true,"volatility":"v","parallel":"u","defaultCount":0,"defaultExpression":null,"config":["search_path=\"\""],"owner":"postgres","serviceExecute":false,"sourcePath":"supabase/migrations/20260930235000_account_cohort_purge.sql","successorBodyMd5":"be1e996ec3bf2c0e585c7a4b39decbc1"},{"signature":"private.embryo_cohort_set_v1(uuid,text)","name":"private.embryo_cohort_set_v1","bodyMd5":"d9a127f51da9d3e04806cd7213f31911","argumentNames":["p_cohort_id","p_set_kind"],"inputCount":2,"allArgumentTypes":null,"argumentModes":null,"inputTypes":"uuid, text","result":"uuid[]","setReturning":false,"language":"sql","securityDefiner":true,"volatility":"s","parallel":"u","defaultCount":0,"defaultExpression":null,"config":["search_path=\"\""],"owner":"postgres","serviceExecute":true,"sourcePath":"supabase/migrations/20260905103317_embryo_cohort_runtime.sql","successorBodyMd5":"d9a127f51da9d3e04806cd7213f31911"},{"signature":"private.lock_invitation_transitions_v1()","name":"private.lock_invitation_transitions_v1","bodyMd5":"8efac632f9dad73d9af1056a8d81c480","argumentNames":[],"inputCount":0,"allArgumentTypes":null,"argumentModes":null,"inputTypes":"","result":"void","setReturning":false,"language":"sql","securityDefiner":false,"volatility":"v","parallel":"u","defaultCount":0,"defaultExpression":null,"config":["search_path=\"\""],"owner":"postgres","serviceExecute":true,"sourcePath":"supabase/migrations/20260906051253_invitation_refusal_transaction.sql","successorBodyMd5":"8efac632f9dad73d9af1056a8d81c480"},{"signature":"private.enqueue_embryo_principal_mail_v1(uuid,text,text,text,uuid,jsonb,text,timestamptz,text,uuid)","name":"private.enqueue_embryo_principal_mail_v1","bodyMd5":"ef221766cf9a9df289468466c4077f52","argumentNames":["p_principal_id","p_template_id","p_purpose","p_target_kind","p_target_id","p_payload","p_idempotency_key","p_expires_at","p_token_purpose","p_token_target_id"],"inputCount":10,"allArgumentTypes":null,"argumentModes":null,"inputTypes":"uuid, text, text, text, uuid, jsonb, text, timestamp with time zone, text, uuid","result":"uuid","setReturning":false,"language":"plpgsql","securityDefiner":true,"volatility":"v","parallel":"u","defaultCount":0,"defaultExpression":null,"config":["search_path=\"\""],"owner":"postgres","serviceExecute":true,"sourcePath":"supabase/migrations/20261001035000_historical_embryo_producer_clocks.sql","successorBodyMd5":"ef221766cf9a9df289468466c4077f52"},{"signature":"private.enqueue_embryo_principal_mail_clock_core_v1(uuid,text,text,text,uuid,jsonb,text,timestamptz,text,uuid,timestamptz)","name":"private.enqueue_embryo_principal_mail_clock_core_v1","bodyMd5":"fc348ae1d6fa086e600171ddf06cde32","argumentNames":["p_principal_id","p_template_id","p_purpose","p_target_kind","p_target_id","p_payload","p_idempotency_key","p_expires_at","p_token_purpose","p_token_target_id","p_created_at"],"inputCount":11,"allArgumentTypes":null,"argumentModes":null,"inputTypes":"uuid, text, text, text, uuid, jsonb, text, timestamp with time zone, text, uuid, timestamp with time zone","result":"uuid","setReturning":false,"language":"plpgsql","securityDefiner":true,"volatility":"v","parallel":"u","defaultCount":0,"defaultExpression":null,"config":["search_path=\"\""],"owner":"postgres","serviceExecute":false,"sourcePath":"supabase/migrations/20261001035000_historical_embryo_producer_clocks.sql","successorBodyMd5":"fc348ae1d6fa086e600171ddf06cde32"},{"signature":"private.enqueue_embryo_principal_mail_at_v1(uuid,text,text,text,uuid,jsonb,text,timestamptz,text,uuid,timestamptz)","name":"private.enqueue_embryo_principal_mail_at_v1","bodyMd5":"45221157cf814442d38214c9e483c690","argumentNames":["p_principal_id","p_template_id","p_purpose","p_target_kind","p_target_id","p_payload","p_idempotency_key","p_expires_at","p_token_purpose","p_token_target_id","p_created_at"],"inputCount":11,"allArgumentTypes":null,"argumentModes":null,"inputTypes":"uuid, text, text, text, uuid, jsonb, text, timestamp with time zone, text, uuid, timestamp with time zone","result":"uuid","setReturning":false,"language":"plpgsql","securityDefiner":true,"volatility":"v","parallel":"u","defaultCount":0,"defaultExpression":null,"config":["search_path=\"\""],"owner":"postgres","serviceExecute":false,"sourcePath":"supabase/migrations/20261001035000_historical_embryo_producer_clocks.sql","successorBodyMd5":"45221157cf814442d38214c9e483c690"}]$pins$::jsonb;
  new_metadata constant jsonb := $new_metadata$[{"signature":"private.request_account_deletion_clock_core_v1(uuid,uuid,text,bytea,text,text,timestamptz)","name":"private.request_account_deletion_clock_core_v1","bodyMd5":"76937876a68e3525f56099b667c0c09d","argumentNames":["p_account_id","p_session_id","p_nonce_hash","p_contact_ciphertext","p_contact_hmac","p_notice_idempotency_key","p_effective_at","deletion_id","status","notice_ends_at"],"inputCount":7,"allArgumentTypes":["uuid","uuid","text","bytea","text","text","timestamp with time zone","uuid","text","timestamp with time zone"],"argumentModes":["i","i","i","i","i","i","i","t","t","t"],"inputTypes":"uuid, uuid, text, bytea, text, text, timestamp with time zone","result":"TABLE(deletion_id uuid, status text, notice_ends_at timestamp with time zone)","setReturning":true,"language":"plpgsql","securityDefiner":true,"volatility":"v","parallel":"u","defaultCount":0,"defaultExpression":null,"config":["search_path=\"\""],"owner":"postgres","serviceExecute":false,"sourcePath":null},{"signature":"private.enqueue_account_affected_notice_clock_core_v1(uuid,jsonb,boolean,timestamptz,timestamptz)","name":"private.enqueue_account_affected_notice_clock_core_v1","bodyMd5":"940371cb22f6ef88755c2a7dcfa48e4e","argumentNames":["p_deletion","p_binding","p_cancelled","p_at","p_created_at"],"inputCount":5,"allArgumentTypes":null,"argumentModes":null,"inputTypes":"uuid, jsonb, boolean, timestamp with time zone, timestamp with time zone","result":"uuid","setReturning":false,"language":"plpgsql","securityDefiner":true,"volatility":"v","parallel":"u","defaultCount":0,"defaultExpression":null,"config":["search_path=\"\""],"owner":"postgres","serviceExecute":false,"sourcePath":null},{"signature":"private.request_account_deletion_at_v1(uuid,uuid,text,timestamptz,bytea,text,text,timestamptz)","name":"private.request_account_deletion_at_v1","bodyMd5":"50e1a7b077fec72e1c1606a8a86a886a","argumentNames":["p_account_id","p_session_id","p_nonce_hash","p_nonce_expires_at","p_contact_ciphertext","p_contact_hmac","p_notice_idempotency_key","p_effective_at","deletion_id","status","notice_ends_at"],"inputCount":8,"allArgumentTypes":["uuid","uuid","text","timestamp with time zone","bytea","text","text","timestamp with time zone","uuid","text","timestamp with time zone"],"argumentModes":["i","i","i","i","i","i","i","i","t","t","t"],"inputTypes":"uuid, uuid, text, timestamp with time zone, bytea, text, text, timestamp with time zone","result":"TABLE(deletion_id uuid, status text, notice_ends_at timestamp with time zone)","setReturning":true,"language":"plpgsql","securityDefiner":true,"volatility":"v","parallel":"u","defaultCount":0,"defaultExpression":null,"config":["search_path=\"\""],"owner":"postgres","serviceExecute":false,"sourcePath":null}]$new_metadata$::jsonb;
begin
  if current_user<>'postgres' then raise exception using errcode='42501',message='historical account owner only';end if;
  if exists(select 1 from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
    where ns.nspname='private' and p.proname in('request_account_deletion_clock_core_v1','enqueue_account_affected_notice_clock_core_v1','request_account_deletion_at_v1')) then
    raise exception using errcode='55000',message='historical account successor already exists';end if;
  for expected in select value from jsonb_array_elements(pins) loop

    target:=to_regprocedure(expected->>'signature');
    if target is null or not exists(select 1 from pg_proc p join pg_language lang on lang.oid=p.prolang
      join pg_namespace ns on ns.oid=p.pronamespace where p.oid=target
      and ns.nspname=split_part(expected->>'name','.',1) and p.proname=split_part(expected->>'name','.',2)
      and p.proowner='postgres'::regrole and p.prokind='f' and not p.proleakproof and p.provariadic=0
      and p.probin is null and p.prosupport=0 and p.procost=100
      and p.prorows=case when (expected->>'setReturning')::boolean then 1000 else 0 end
      and lang.lanname=expected->>'language' and p.prosecdef=(expected->>'securityDefiner')::boolean
      and p.proretset=(expected->>'setReturning')::boolean and p.provolatile::text=expected->>'volatility'
      and p.proparallel::text=expected->>'parallel' and p.pronargs=(expected->>'inputCount')::integer
      and oidvectortypes(p.proargtypes)=expected->>'inputTypes'
      and pg_get_function_result(p.oid)=expected->>'result'
      and coalesce(to_jsonb(p.proargnames),'[]'::jsonb)=expected->'argumentNames'
      and coalesce(to_jsonb(p.proargmodes),'null'::jsonb)=expected->'argumentModes'
      and coalesce((select jsonb_agg(format_type(t,null) order by ordinal)
        from unnest(p.proallargtypes) with ordinality a(t,ordinal)),'null'::jsonb)=expected->'allArgumentTypes'
      and to_jsonb(p.proconfig)=expected->'config'
      and p.pronargdefaults=(expected->>'defaultCount')::integer
      and pg_get_expr(p.proargdefaults,0) is not distinct from expected->>'defaultExpression'
      and md5(p.prosrc)=expected->>'bodyMd5'
      and cardinality(coalesce(p.proacl,acldefault('f',p.proowner)))=case when (expected->>'serviceExecute')::boolean then 2 else 1 end
      and not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
        where acl.grantor<>p.proowner or acl.is_grantable or acl.privilege_type<>'EXECUTE'
          or (acl.grantee<>p.proowner and (not (expected->>'serviceExecute')::boolean or acl.grantee<>'service_role'::regrole))))
      or exists(select 1 from unnest(array['anon','authenticated','inherit_upload_only','service_role']) api
        where has_function_privilege(api,target,'execute') is distinct from
          (api='service_role' and (expected->>'serviceExecute')::boolean)) then
      raise exception using errcode='55000',message='historical account predecessor differs';end if;

    select to_jsonb(p)-'prosrc' into actual from pg_proc p where p.oid=target;
    before_metadata:=before_metadata||jsonb_build_object(expected->>'signature',actual);
  end loop;
  -- The ordinary recording defaults and registered strict periods are not changed.
  if exists(select 1 from unnest(array['public.account_deletion_requests','public.retention_rows','public.purge_manifests','public.mail_outbox']) relation
    where not exists(select 1 from pg_attribute a join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
      where a.attrelid=to_regclass(relation) and a.attname='created_at' and not a.attisdropped
        and a.atttypid='timestamptz'::regtype and a.attnotnull and pg_get_expr(d.adbin,d.adrelid)='clock_timestamp()'))
    or exists(select 1 from (values('public.mail_outbox','not_before'),('public.account_operation_nonces','issued_at')) clock_column(relation,name)
      where not exists(select 1 from pg_attribute a join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
        where a.attrelid=to_regclass(clock_column.relation) and a.attname=clock_column.name and not a.attisdropped
          and a.atttypid='timestamptz'::regtype and a.attnotnull and pg_get_expr(d.adbin,d.adrelid)='clock_timestamp()'))
    or not exists(select 1 from pg_constraint where conrelid='public.account_deletion_requests'::regclass
      and conname='account_deletion_requests_check' and contype='c' and convalidated and not condeferrable
      and pg_get_constraintdef(oid)='CHECK ((notice_ends_at = (requested_at + ''7 days''::interval)))')
    or not exists(select 1 from pg_constraint where conrelid='public.mail_outbox'::regclass
      and conname='mail_outbox_check' and contype='c' and convalidated and not condeferrable
      and pg_get_constraintdef(oid)='CHECK ((expires_at > created_at))')
    or not exists(select 1 from pg_constraint where conrelid='public.mail_outbox'::regclass
      and conname='mail_outbox_provider_retention_limit' and contype='c' and convalidated and not condeferrable
      and pg_get_constraintdef(oid)='CHECK ((expires_at <= (created_at + ''30 days''::interval)))') then
    raise exception using errcode='55000',message='historical account clock boundary differs';end if;
  execute $definition_0$create function private.enqueue_account_affected_notice_clock_core_v1(p_deletion uuid,p_binding jsonb,p_cancelled boolean,p_at timestamptz,p_created_at timestamptz)
returns uuid language plpgsql security definer set search_path='' as $body$
declare p public.subject_principals; e public.encrypted_contact_references; result uuid; t timestamptz:=case when p_created_at is null then pg_catalog.clock_timestamp() else p_created_at end;
 template text:=case when p_cancelled then 'account-deletion-affected-cancelled' else 'account-deletion-affected' end;
begin
 if p_created_at is not null and (not isfinite(p_created_at) or p_created_at>pg_catalog.clock_timestamp()) then
  raise exception using errcode='22023',message='invalid historical account mail clock';end if;
 select * into p from public.subject_principals where id=(p_binding->>'principalId')::uuid for update;
 select * into e from public.encrypted_contact_references where id=(p_binding->>'contactId')::uuid for update;
 if p.id is null or p.status<>'active' or p.principal_revision<>(p_binding->>'principalRevision')::bigint
  or e.id is null or e.principal_id<>p.id or e.status<>'current' or e.contact_ciphertext is null
  or e.authority_revision<>p.principal_revision or (select count(*) from public.encrypted_contact_references
   where principal_id=p.id and status='current')<>1 then
  raise exception using errcode='55000',message='account_notice_binding_unavailable'; end if;
 insert into public.mail_outbox(template_id,purpose,target_kind,target_id,recipient_principal_id,contact_reference_id,
  recipient_authority_revision,semantic_revision,idempotency_key,template_payload,expires_at,created_at,not_before)
 values(template,template,'account',p_deletion,p.id,e.id,p.principal_revision,1,
  encode(extensions.digest(concat_ws(':',template,p_deletion::text,p.id::text),'sha256'),'hex'),
  jsonb_build_object(case when p_cancelled then 'cancelledAt' else 'noticeEndsAt' end,p_at),
  p_at+interval '1 day',t,t) returning id into result;
 return result;
end $body$;$definition_0$;
  execute $definition_1$create function private.request_account_deletion_clock_core_v1(p_account_id uuid,p_session_id uuid,p_nonce_hash text,p_contact_ciphertext bytea,
  p_contact_hmac text,p_notice_idempotency_key text,p_effective_at timestamptz)
returns table(deletion_id uuid,status text,notice_ends_at timestamptz) language plpgsql security definer set search_path='' as $body$
declare
  v_now timestamptz := clock_timestamp();
  v_effective_at timestamptz := coalesce(p_effective_at, v_now);
  v_profile public.profiles%rowtype;
  v_principal public.subject_principals%rowtype;
  v_graph_revision bigint;
  v_request public.account_deletion_requests%rowtype;
  v_retention_id uuid;
  v_contact_id uuid;
  v_notice jsonb; v_binding jsonb; v_bound jsonb:='[]'; v_mail uuid;
begin
  if p_effective_at is not null and (not isfinite(p_effective_at) or p_effective_at>v_now) then
    raise exception using errcode='22023',message='invalid historical account clock';end if;
  perform private.validate_sensitive_account_session_v1(p_account_id, p_session_id);
  perform private.assert_account_path_b_deletion_supported_v1(p_account_id);
  if exists(select 1 from public.embryo_cohorts where owner_account_id=p_account_id) then
    perform private.assert_supported_self_deletion_graph_v1(p_account_id);
  end if;
  v_notice := private.account_affected_notice_envelope_v1(p_account_id);

  if p_nonce_hash !~ '^[0-9a-f]{64}$'
    or p_contact_ciphertext is null
    or p_contact_hmac !~ '^[0-9a-f]{64}$'
    or p_notice_idempotency_key !~ '^[0-9a-f]{64}$'
  then
    raise exception using errcode = '22023', message = 'invalid_deletion_request';
  end if;

  update public.account_operation_nonces
  set consumed_at = v_now
  where nonce_hash = p_nonce_hash
    and account_id = p_account_id
    and session_id = p_session_id
    and operation = 'account_delete'
    and consumed_at is null
    and expires_at > v_now;
  if not found then
    raise exception using errcode = '22023', message = 'invalid_operation_nonce';
  end if;

  select p.* into strict v_profile
  from public.profiles p where p.id = p_account_id for update;

  if exists (
    select 1 from public.account_deletion_requests d
    where d.account_id = p_account_id
      and d.state in ('notice_period', 'delete_started')
  ) then
    raise exception using errcode = '23505', message = 'deletion_request_exists';
  end if;

  select sp.* into strict v_principal
  from public.subject_principals sp
  join public.subjects s on s.id = sp.subject_id
  where sp.account_id = p_account_id
    and sp.principal_kind = 'account_subject'
    and sp.status = 'active'
    and s.subject_class = 'self'
    and s.subject_account_id = p_account_id
  order by sp.created_at, sp.id
  limit 1
  for update of sp;

  if (select count(*) from public.encrypted_contact_references ecr where ecr.principal_id=v_principal.id and ecr.status='current')>1 then
    raise exception using errcode='55000',message='account_notice_binding_unavailable'; end if;

  select greatest(coalesce(max(sp.principal_revision), 1), 1)
  into v_graph_revision
  from public.subject_principals sp
  where sp.account_id = p_account_id;

  update public.profiles
  set deletion_requested_at = v_now,
      account_revision = account_revision + 1,
      auth_session_revision = auth_session_revision + 1
  where id = p_account_id
  returning * into v_profile;

  insert into public.account_deletion_requests (
    account_id, request_account_revision, request_auth_session_revision,
    principal_graph_revision, deletion_hold_revision, state,
    requested_at, notice_ends_at
  ) values (
    p_account_id, v_profile.account_revision,
    v_profile.auth_session_revision, v_graph_revision,
    v_profile.account_revision, 'notice_period', v_effective_at,
    v_effective_at + interval '7 days'
  ) returning * into v_request;

  insert into public.retention_rows (
    retention_id, target_kind, target_id, retention_revision,
    target_lifecycle_revision, disposition_revision, fixed_deadline, state
  ) values (
    'account-deletion.notice-7d', 'account', p_account_id,
    v_profile.account_revision, v_profile.account_revision,
    v_profile.account_revision, v_request.notice_ends_at, 'scheduled'
  ) returning id into v_retention_id;

  if p_effective_at is null then
  insert into public.retention_due_phases (
    retention_row_id, retention_id, phase_id, phase_kind, phase_revision,
    phase_deadline, target_kind, target_id, target_lifecycle_revision,
    disposition_revision, recipient_authority_kind,
    recipient_authority_revision, immutable_envelope
  ) values (
    v_retention_id, 'account-deletion.notice-7d',
    'account-deletion-notice-deadline', 'compound-atomic', 1,
    v_request.notice_ends_at, 'account', p_account_id,
    v_profile.account_revision, v_profile.account_revision,
    'account-subject-principal', v_principal.principal_revision,
    jsonb_build_object(
      'deletionRequestId', v_request.id,
      'principalGraphRevision', v_graph_revision,
      'originalNoticeEndsAt', v_request.notice_ends_at
    )
  );

  insert into public.purge_manifests (
    retention_row_id, phase_id, phase_revision, manifest_class,
    manifest_revision, source_binding_fingerprint, state
  ) values (
    v_retention_id, 'account-deletion-notice-deadline', 1,
    'complete-retention', 1,
    encode(extensions.digest(
      concat_ws(':', 'account-deletion-v1', v_request.id::text,
        p_account_id::text, v_graph_revision::text,
        v_request.notice_ends_at::text),
      'sha256'
    ), 'hex'),
    'frozen'
  );

  end if;

  select ecr.id into v_contact_id
  from public.encrypted_contact_references ecr
  where ecr.principal_id = v_principal.id
    and ecr.contact_hmac = p_contact_hmac
    and ecr.status = 'current'
  order by ecr.created_at desc limit 1 for update;

  if v_contact_id is null then
    update public.encrypted_contact_references ecr
    set status = 'rotated', ended_at = v_now
    where ecr.principal_id = v_principal.id and ecr.status = 'current';

    insert into public.encrypted_contact_references (
      principal_id, contact_ciphertext, contact_hmac, key_revision,
      authority_revision, status
    ) values (
      v_principal.id, p_contact_ciphertext, p_contact_hmac, 1,
      v_principal.principal_revision, 'current'
    ) returning id into v_contact_id;

    insert into public.contact_hmac_indexes (
      contact_reference_id, contact_hmac, hmac_key_revision, status, expires_at
    ) values (
      v_contact_id, p_contact_hmac, 1, 'current',
      v_request.notice_ends_at + interval '1 day'
    );
  end if;

  if p_effective_at is null then
  insert into public.mail_outbox (
    template_id, purpose, target_kind, target_id,
    recipient_principal_id, contact_reference_id,
    recipient_authority_revision, semantic_revision, idempotency_key,
    template_payload, expires_at
  ) values (
    'account-deletion-notice', 'account-deletion-notice', 'account',
    v_request.id, v_principal.id, v_contact_id,
    v_principal.principal_revision, 1, p_notice_idempotency_key,
    jsonb_build_object(
      'noticeEndsAt', v_request.notice_ends_at,
      'cancelPath', '/settings/data',
      'exportPath', '/api/export'
    ),
    v_request.notice_ends_at + interval '1 day'
  );

  else
  insert into public.mail_outbox (
    template_id, purpose, target_kind, target_id,
    recipient_principal_id, contact_reference_id,
    recipient_authority_revision, semantic_revision, idempotency_key,
    template_payload, expires_at, created_at, not_before
  ) values (
    'account-deletion-notice', 'account-deletion-notice', 'account',
    v_request.id, v_principal.id, v_contact_id,
    v_principal.principal_revision, 1, p_notice_idempotency_key,
    jsonb_build_object(
      'noticeEndsAt', v_request.notice_ends_at,
      'cancelPath', '/settings/data',
      'exportPath', '/api/export'
    ),
    v_request.notice_ends_at + interval '1 day', v_effective_at, v_effective_at
  );

  end if;

  for v_binding in select value from jsonb_array_elements(v_notice->'recipients') loop
    if p_effective_at is null then
    v_mail:=private.enqueue_account_affected_notice_v1(v_request.id,v_binding,false,v_request.notice_ends_at);
    else
      v_mail:=private.enqueue_account_affected_notice_clock_core_v1(v_request.id,v_binding,false,v_request.notice_ends_at,v_effective_at);
    end if;
    v_bound:=v_bound||jsonb_build_array(v_binding||jsonb_build_object('outboxId',v_mail));
  end loop;
  if p_effective_at is null then
  update public.retention_due_phases
  set immutable_envelope=immutable_envelope||jsonb_build_object('affectedNotice',
    jsonb_set(v_notice,'{recipients}',v_bound))
  where retention_row_id=v_retention_id and phase_id='account-deletion-notice-deadline';
  else
  insert into public.retention_due_phases (
    retention_row_id, retention_id, phase_id, phase_kind, phase_revision,
    phase_deadline, target_kind, target_id, target_lifecycle_revision,
    disposition_revision, recipient_authority_kind,
    recipient_authority_revision, immutable_envelope
  ) values (
    v_retention_id, 'account-deletion.notice-7d',
    'account-deletion-notice-deadline', 'compound-atomic', 1,
    v_request.notice_ends_at, 'account', p_account_id,
    v_profile.account_revision, v_profile.account_revision,
    'account-subject-principal', v_principal.principal_revision,
    jsonb_build_object(
      'deletionRequestId', v_request.id,
      'principalGraphRevision', v_graph_revision,
      'originalNoticeEndsAt', v_request.notice_ends_at,
      'affectedNotice', jsonb_set(v_notice,'{recipients}',v_bound)
    )
  );

  insert into public.purge_manifests (
    retention_row_id, phase_id, phase_revision, manifest_class,
    manifest_revision, source_binding_fingerprint, state
  ) values (
    v_retention_id, 'account-deletion-notice-deadline', 1,
    'complete-retention', 1,
    encode(extensions.digest(
      concat_ws(':', 'account-deletion-v1', v_request.id::text,
        p_account_id::text, v_graph_revision::text,
        v_request.notice_ends_at::text),
      'sha256'
    ), 'hex'),
    'frozen'
  );

  end if;

  -- Keep only the verified session that requested deletion. The proxy limits
  -- that session to export, revocation, transfer, and cancellation operations.
  delete from auth.sessions
  where user_id = p_account_id and id <> p_session_id;

  return query select v_request.id, 'notice_period'::text, v_request.notice_ends_at;
end;
$body$;$definition_1$;
  execute $definition_2$create function private.request_account_deletion_at_v1(p_account_id uuid,p_session_id uuid,p_nonce_hash text,
  p_nonce_expires_at timestamptz,p_contact_ciphertext bytea,p_contact_hmac text,p_notice_idempotency_key text,p_effective_at timestamptz)
returns table(deletion_id uuid,status text,notice_ends_at timestamptz) language plpgsql security definer set search_path='' as $body$
begin
  if p_effective_at is null or not isfinite(p_effective_at) or p_effective_at>pg_catalog.clock_timestamp() then
    raise exception using errcode='22023',message='invalid historical account clock';end if;
  perform private.validate_sensitive_account_session_v1(p_account_id,p_session_id);
  perform private.assert_account_path_b_deletion_supported_v1(p_account_id);
  perform private.record_account_operation_nonce_v1(
    p_account_id,p_session_id,'account_delete',p_nonce_hash,p_nonce_expires_at);
  return query select * from private.request_account_deletion_clock_core_v1(
    p_account_id,p_session_id,p_nonce_hash,p_contact_ciphertext,p_contact_hmac,p_notice_idempotency_key,p_effective_at);
end;
$body$;$definition_2$;
  execute $definition_3$create or replace function private.enqueue_account_affected_notice_v1(p_deletion uuid,p_binding jsonb,p_cancelled boolean,p_at timestamptz)
returns uuid language plpgsql security definer set search_path='' as $body$
begin
 return private.enqueue_account_affected_notice_clock_core_v1(p_deletion,p_binding,p_cancelled,p_at,null);
end;
$body$;$definition_3$;
  execute $definition_4$create or replace function public.request_account_deletion_v1(p_account_id uuid,p_session_id uuid,p_nonce_hash text,p_contact_ciphertext bytea,
  p_contact_hmac text,p_notice_idempotency_key text)
returns table(deletion_id uuid,status text,notice_ends_at timestamptz) language plpgsql security definer set search_path='' as $body$
begin
  return query select * from private.request_account_deletion_clock_core_v1(
    p_account_id,p_session_id,p_nonce_hash,p_contact_ciphertext,p_contact_hmac,p_notice_idempotency_key,null);
end;
$body$;$definition_4$;
  revoke all on function private.request_account_deletion_clock_core_v1(uuid,uuid,text,bytea,text,text,timestamptz) from public,anon,authenticated,inherit_upload_only,service_role;
  revoke all on function private.enqueue_account_affected_notice_clock_core_v1(uuid,jsonb,boolean,timestamptz,timestamptz) from public,anon,authenticated,inherit_upload_only,service_role;
  revoke all on function private.request_account_deletion_at_v1(uuid,uuid,text,timestamptz,bytea,text,text,timestamptz) from public,anon,authenticated,inherit_upload_only,service_role;
  for expected in select value from jsonb_array_elements(pins) loop
    select to_jsonb(p)-'prosrc' into actual from pg_proc p where p.oid=to_regprocedure(expected->>'signature');
    if actual is distinct from before_metadata->(expected->>'signature')
      or (select md5(prosrc) from pg_proc where oid=to_regprocedure(expected->>'signature'))
        is distinct from expected->>'successorBodyMd5' then
      raise exception using errcode='55000',message='historical account original metadata changed';end if;
  end loop;
  for expected in select value from jsonb_array_elements(new_metadata) loop

    target:=to_regprocedure(expected->>'signature');
    if target is null or not exists(select 1 from pg_proc p join pg_language lang on lang.oid=p.prolang
      join pg_namespace ns on ns.oid=p.pronamespace where p.oid=target
      and ns.nspname=split_part(expected->>'name','.',1) and p.proname=split_part(expected->>'name','.',2)
      and p.proowner='postgres'::regrole and p.prokind='f' and not p.proleakproof and p.provariadic=0
      and p.probin is null and p.prosupport=0 and p.procost=100
      and p.prorows=case when (expected->>'setReturning')::boolean then 1000 else 0 end
      and lang.lanname=expected->>'language' and p.prosecdef=(expected->>'securityDefiner')::boolean
      and p.proretset=(expected->>'setReturning')::boolean and p.provolatile::text=expected->>'volatility'
      and p.proparallel::text=expected->>'parallel' and p.pronargs=(expected->>'inputCount')::integer
      and oidvectortypes(p.proargtypes)=expected->>'inputTypes'
      and pg_get_function_result(p.oid)=expected->>'result'
      and coalesce(to_jsonb(p.proargnames),'[]'::jsonb)=expected->'argumentNames'
      and coalesce(to_jsonb(p.proargmodes),'null'::jsonb)=expected->'argumentModes'
      and coalesce((select jsonb_agg(format_type(t,null) order by ordinal)
        from unnest(p.proallargtypes) with ordinality a(t,ordinal)),'null'::jsonb)=expected->'allArgumentTypes'
      and to_jsonb(p.proconfig)=expected->'config'
      and p.pronargdefaults=(expected->>'defaultCount')::integer
      and pg_get_expr(p.proargdefaults,0) is not distinct from expected->>'defaultExpression'
      and md5(p.prosrc)=expected->>'bodyMd5'
      and cardinality(coalesce(p.proacl,acldefault('f',p.proowner)))=case when (expected->>'serviceExecute')::boolean then 2 else 1 end
      and not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
        where acl.grantor<>p.proowner or acl.is_grantable or acl.privilege_type<>'EXECUTE'
          or (acl.grantee<>p.proowner and (not (expected->>'serviceExecute')::boolean or acl.grantee<>'service_role'::regrole))))
      or exists(select 1 from unnest(array['anon','authenticated','inherit_upload_only','service_role']) api
        where has_function_privilege(api,target,'execute') is distinct from
          (api='service_role' and (expected->>'serviceExecute')::boolean)) then
      raise exception using errcode='55000',message='historical account new owner boundary differs';end if;

  end loop;
end;
$historical_account$;
