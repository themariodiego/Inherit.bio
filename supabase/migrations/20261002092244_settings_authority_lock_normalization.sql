-- Normalize only current settings profile and owner-objection authority locks.
-- Every original clock, predicate, nonce, result, write and refusal remains.
-- New private helpers cannot be executed by any API role. They add locks only.
-- Ordinary account purge and unrelated writers are outside this scoped proof.
do $settings_authority_locks$
declare expected jsonb; actual jsonb; target regprocedure; before_metadata jsonb:='{}';
  pins constant jsonb := $pins$[{"signature":"private.assert_live_authenticated_session()","metadata":{"name":"private.assert_live_authenticated_session","inputTypes":"","argumentNames":null,"allTypes":null,"modes":null,"inputCount":0,"defaultCount":0,"defaultExpression":null,"result":"jsonb","setReturning":false,"owner":"postgres","language":"plpgsql","kind":"f","volatility":"v","parallel":"u","strict":false,"securityDefiner":true,"leakproof":false,"variadicType":"0","binary":null,"support":"-","cost":100,"rows":0,"config":["search_path=pg_catalog, private"],"bodyMd5":"7a8423b747e8cbca49bbb99f93f4c9be","transformTypes":null,"sqlBody":null,"acl":[{"grantor":"postgres","grantee":"authenticated","privilege":"EXECUTE","grantable":false},{"grantor":"postgres","grantee":"inherit_upload_only","privilege":"EXECUTE","grantable":false},{"grantor":"postgres","grantee":"postgres","privilege":"EXECUTE","grantable":false},{"grantor":"postgres","grantee":"service_role","privilege":"EXECUTE","grantable":false}],"apiExecute":{"anon":false,"service_role":true,"authenticated":true,"inherit_upload_only":true}},"successorBodyMd5":"7a8423b747e8cbca49bbb99f93f4c9be"},{"signature":"private.assert_live_authenticated_session_read_v1()","metadata":{"name":"private.assert_live_authenticated_session_read_v1","inputTypes":"","argumentNames":null,"allTypes":null,"modes":null,"inputCount":0,"defaultCount":0,"defaultExpression":null,"result":"jsonb","setReturning":false,"owner":"postgres","language":"plpgsql","kind":"f","volatility":"v","parallel":"u","strict":false,"securityDefiner":true,"leakproof":false,"variadicType":"0","binary":null,"support":"-","cost":100,"rows":0,"config":["search_path=pg_catalog, private"],"bodyMd5":"9e82a8763e4769505d09ecda9517e18f","transformTypes":null,"sqlBody":null,"acl":[{"grantor":"postgres","grantee":"postgres","privilege":"EXECUTE","grantable":false}],"apiExecute":{"anon":false,"service_role":false,"authenticated":false,"inherit_upload_only":false}},"successorBodyMd5":"9e82a8763e4769505d09ecda9517e18f"},{"signature":"private.embryo_cohort_set_v1(uuid,text)","metadata":{"name":"private.embryo_cohort_set_v1","inputTypes":"uuid, text","argumentNames":["p_cohort_id","p_set_kind"],"allTypes":null,"modes":null,"inputCount":2,"defaultCount":0,"defaultExpression":null,"result":"uuid[]","setReturning":false,"owner":"postgres","language":"sql","kind":"f","volatility":"s","parallel":"u","strict":false,"securityDefiner":true,"leakproof":false,"variadicType":"0","binary":null,"support":"-","cost":100,"rows":0,"config":["search_path=\"\""],"bodyMd5":"d9a127f51da9d3e04806cd7213f31911","transformTypes":null,"sqlBody":null,"acl":[{"grantor":"postgres","grantee":"postgres","privilege":"EXECUTE","grantable":false},{"grantor":"postgres","grantee":"service_role","privilege":"EXECUTE","grantable":false}],"apiExecute":{"anon":false,"service_role":true,"authenticated":false,"inherit_upload_only":false}},"successorBodyMd5":"d9a127f51da9d3e04806cd7213f31911"},{"signature":"private.embryo_ingest_authority_fingerprint_v1(uuid)","metadata":{"name":"private.embryo_ingest_authority_fingerprint_v1","inputTypes":"uuid","argumentNames":["p_cohort_id"],"allTypes":null,"modes":null,"inputCount":1,"defaultCount":0,"defaultExpression":null,"result":"text","setReturning":false,"owner":"postgres","language":"plpgsql","kind":"f","volatility":"v","parallel":"u","strict":false,"securityDefiner":true,"leakproof":false,"variadicType":"0","binary":null,"support":"-","cost":100,"rows":0,"config":["search_path=\"\""],"bodyMd5":"9f68eed2744652ed9485f03f5a7f4a05","transformTypes":null,"sqlBody":null,"acl":[{"grantor":"postgres","grantee":"postgres","privilege":"EXECUTE","grantable":false},{"grantor":"postgres","grantee":"service_role","privilege":"EXECUTE","grantable":false}],"apiExecute":{"anon":false,"service_role":true,"authenticated":false,"inherit_upload_only":false}},"successorBodyMd5":"9f68eed2744652ed9485f03f5a7f4a05"},{"signature":"private.future_person_profile_context_v1(uuid,uuid,uuid,uuid)","metadata":{"name":"private.future_person_profile_context_v1","inputTypes":"uuid, uuid, uuid, uuid","argumentNames":["p_account","p_session","p_embryo","p_signature"],"allTypes":null,"modes":null,"inputCount":4,"defaultCount":0,"defaultExpression":null,"result":"jsonb","setReturning":false,"owner":"postgres","language":"plpgsql","kind":"f","volatility":"v","parallel":"u","strict":false,"securityDefiner":true,"leakproof":false,"variadicType":"0","binary":null,"support":"-","cost":100,"rows":0,"config":["search_path=\"\""],"bodyMd5":"f88948290d39e4087ff446f258c9a7a5","transformTypes":null,"sqlBody":null,"acl":[{"grantor":"postgres","grantee":"postgres","privilege":"EXECUTE","grantable":false}],"apiExecute":{"anon":false,"service_role":false,"authenticated":false,"inherit_upload_only":false}},"successorBodyMd5":"ff87233bebe2ee5049a9859ef2222555"},{"signature":"private.keyless_owner_account_v1(uuid)","metadata":{"name":"private.keyless_owner_account_v1","inputTypes":"uuid","argumentNames":["p_notice"],"allTypes":null,"modes":null,"inputCount":1,"defaultCount":0,"defaultExpression":null,"result":"jsonb","setReturning":false,"owner":"postgres","language":"plpgsql","kind":"f","volatility":"v","parallel":"u","strict":false,"securityDefiner":true,"leakproof":false,"variadicType":"0","binary":null,"support":"-","cost":100,"rows":0,"config":["search_path=\"\""],"bodyMd5":"9e18878393b58d7181f2ae3f2f09dbf6","transformTypes":null,"sqlBody":null,"acl":[{"grantor":"postgres","grantee":"postgres","privilege":"EXECUTE","grantable":false}],"apiExecute":{"anon":false,"service_role":false,"authenticated":false,"inherit_upload_only":false}},"successorBodyMd5":"335b4741a5384157ede35d3d66d227a5"},{"signature":"private.resolve_embryo_basis_authority_v1(uuid)","metadata":{"name":"private.resolve_embryo_basis_authority_v1","inputTypes":"uuid","argumentNames":["p_draft_id","basis_case","disposition_mode","required_upload_principals","disposition_authorities","attribution_principals","notice_recipients","record_key_recipients"],"allTypes":["uuid","text","text","uuid[]","uuid[]","uuid[]","uuid[]","uuid[]"],"modes":["i","t","t","t","t","t","t","t"],"inputCount":1,"defaultCount":0,"defaultExpression":null,"result":"TABLE(basis_case text, disposition_mode text, required_upload_principals uuid[], disposition_authorities uuid[], attribution_principals uuid[], notice_recipients uuid[], record_key_recipients uuid[])","setReturning":true,"owner":"postgres","language":"plpgsql","kind":"f","volatility":"s","parallel":"u","strict":false,"securityDefiner":true,"leakproof":false,"variadicType":"0","binary":null,"support":"-","cost":100,"rows":1000,"config":["search_path=\"\""],"bodyMd5":"124e882fbd33aea02a90e4bd11c596f9","transformTypes":null,"sqlBody":null,"acl":[{"grantor":"postgres","grantee":"postgres","privilege":"EXECUTE","grantable":false},{"grantor":"postgres","grantee":"service_role","privilege":"EXECUTE","grantable":false}],"apiExecute":{"anon":false,"service_role":true,"authenticated":false,"inherit_upload_only":false}},"successorBodyMd5":"124e882fbd33aea02a90e4bd11c596f9"},{"signature":"private.validate_sensitive_account_session_read_v1(uuid,uuid)","metadata":{"name":"private.validate_sensitive_account_session_read_v1","inputTypes":"uuid, uuid","argumentNames":["p_account_id","p_session_id"],"allTypes":null,"modes":null,"inputCount":2,"defaultCount":0,"defaultExpression":null,"result":"void","setReturning":false,"owner":"postgres","language":"plpgsql","kind":"f","volatility":"v","parallel":"u","strict":false,"securityDefiner":true,"leakproof":false,"variadicType":"0","binary":null,"support":"-","cost":100,"rows":0,"config":["search_path=\"\""],"bodyMd5":"706dcffdb9bdd16d2efbce3126de3afc","transformTypes":null,"sqlBody":null,"acl":[{"grantor":"postgres","grantee":"postgres","privilege":"EXECUTE","grantable":false}],"apiExecute":{"anon":false,"service_role":false,"authenticated":false,"inherit_upload_only":false}},"successorBodyMd5":"706dcffdb9bdd16d2efbce3126de3afc"},{"signature":"private.validate_sensitive_account_session_v1(uuid,uuid)","metadata":{"name":"private.validate_sensitive_account_session_v1","inputTypes":"uuid, uuid","argumentNames":["p_account_id","p_session_id"],"allTypes":null,"modes":null,"inputCount":2,"defaultCount":0,"defaultExpression":null,"result":"void","setReturning":false,"owner":"postgres","language":"plpgsql","kind":"f","volatility":"v","parallel":"u","strict":false,"securityDefiner":true,"leakproof":false,"variadicType":"0","binary":null,"support":"-","cost":100,"rows":0,"config":["search_path=\"\""],"bodyMd5":"ce8813a75279262687f546121d45b4ac","transformTypes":null,"sqlBody":null,"acl":[{"grantor":"postgres","grantee":"postgres","privilege":"EXECUTE","grantable":false}],"apiExecute":{"anon":false,"service_role":false,"authenticated":false,"inherit_upload_only":false}},"successorBodyMd5":"ce8813a75279262687f546121d45b4ac"},{"signature":"public.delete_future_person_profile_v1(uuid,uuid,uuid,jsonb,text)","metadata":{"name":"public.delete_future_person_profile_v1","inputTypes":"uuid, uuid, uuid, jsonb, text","argumentNames":["p_account","p_session","p_embryo","p_expected","p_nonce"],"allTypes":null,"modes":null,"inputCount":5,"defaultCount":0,"defaultExpression":null,"result":"void","setReturning":false,"owner":"postgres","language":"plpgsql","kind":"f","volatility":"v","parallel":"u","strict":false,"securityDefiner":true,"leakproof":false,"variadicType":"0","binary":null,"support":"-","cost":100,"rows":0,"config":["search_path=\"\""],"bodyMd5":"85801650ba2c39a0b26998dc058f7339","transformTypes":null,"sqlBody":null,"acl":[{"grantor":"postgres","grantee":"postgres","privilege":"EXECUTE","grantable":false},{"grantor":"postgres","grantee":"service_role","privilege":"EXECUTE","grantable":false}],"apiExecute":{"anon":false,"service_role":true,"authenticated":false,"inherit_upload_only":false}},"successorBodyMd5":"725c86d5309e8b1398c64c92143e0ace"},{"signature":"public.future_person_owner_account_objection_scope_v1(uuid)","metadata":{"name":"public.future_person_owner_account_objection_scope_v1","inputTypes":"uuid","argumentNames":["p_notice"],"allTypes":null,"modes":null,"inputCount":1,"defaultCount":0,"defaultExpression":null,"result":"jsonb","setReturning":false,"owner":"postgres","language":"plpgsql","kind":"f","volatility":"v","parallel":"u","strict":false,"securityDefiner":true,"leakproof":false,"variadicType":"0","binary":null,"support":"-","cost":100,"rows":0,"config":["search_path=\"\""],"bodyMd5":"b5d42b16687f743b5ca1740f6692f19b","transformTypes":null,"sqlBody":null,"acl":[{"grantor":"postgres","grantee":"authenticated","privilege":"EXECUTE","grantable":false},{"grantor":"postgres","grantee":"postgres","privilege":"EXECUTE","grantable":false}],"apiExecute":{"anon":false,"service_role":false,"authenticated":true,"inherit_upload_only":false}},"successorBodyMd5":"cb6be8dc24e37bc1609207de66567075"},{"signature":"public.future_person_profile_context_v1(uuid,uuid,uuid,uuid)","metadata":{"name":"public.future_person_profile_context_v1","inputTypes":"uuid, uuid, uuid, uuid","argumentNames":["p_account","p_session","p_embryo","p_signature"],"allTypes":null,"modes":null,"inputCount":4,"defaultCount":0,"defaultExpression":null,"result":"jsonb","setReturning":false,"owner":"postgres","language":"sql","kind":"f","volatility":"v","parallel":"u","strict":false,"securityDefiner":true,"leakproof":false,"variadicType":"0","binary":null,"support":"-","cost":100,"rows":0,"config":["search_path=\"\""],"bodyMd5":"b72078a64cbb510136cbe47d2fdae787","transformTypes":null,"sqlBody":null,"acl":[{"grantor":"postgres","grantee":"postgres","privilege":"EXECUTE","grantable":false},{"grantor":"postgres","grantee":"service_role","privilege":"EXECUTE","grantable":false}],"apiExecute":{"anon":false,"service_role":true,"authenticated":false,"inherit_upload_only":false}},"successorBodyMd5":"b72078a64cbb510136cbe47d2fdae787"},{"signature":"public.future_person_profile_controls_v1(uuid,uuid,uuid)","metadata":{"name":"public.future_person_profile_controls_v1","inputTypes":"uuid, uuid, uuid","argumentNames":["p_account","p_session","p_after"],"allTypes":null,"modes":null,"inputCount":3,"defaultCount":1,"defaultExpression":"NULL::uuid","result":"jsonb","setReturning":false,"owner":"postgres","language":"plpgsql","kind":"f","volatility":"v","parallel":"u","strict":false,"securityDefiner":true,"leakproof":false,"variadicType":"0","binary":null,"support":"-","cost":100,"rows":0,"config":["search_path=\"\""],"bodyMd5":"8ed2f87fb202d71180738418ec3c7ddd","transformTypes":null,"sqlBody":null,"acl":[{"grantor":"postgres","grantee":"postgres","privilege":"EXECUTE","grantable":false},{"grantor":"postgres","grantee":"service_role","privilege":"EXECUTE","grantable":false}],"apiExecute":{"anon":false,"service_role":true,"authenticated":false,"inherit_upload_only":false}},"successorBodyMd5":"8ed2f87fb202d71180738418ec3c7ddd"},{"signature":"public.submit_future_person_account_objection_v1(uuid,bigint,text,bytea,bytea)","metadata":{"name":"public.submit_future_person_account_objection_v1","inputTypes":"uuid, bigint, text, bytea, bytea","argumentNames":["p_notice","p_revision","p_nonce","p_statement_ciphertext","p_wrapped_statement_key"],"allTypes":null,"modes":null,"inputCount":5,"defaultCount":0,"defaultExpression":null,"result":"jsonb","setReturning":false,"owner":"postgres","language":"plpgsql","kind":"f","volatility":"v","parallel":"u","strict":false,"securityDefiner":true,"leakproof":false,"variadicType":"0","binary":null,"support":"-","cost":100,"rows":0,"config":["search_path=\"\"","lock_timeout=250ms"],"bodyMd5":"422651c6e50a5406cde09962d01400c4","transformTypes":null,"sqlBody":null,"acl":[{"grantor":"postgres","grantee":"authenticated","privilege":"EXECUTE","grantable":false},{"grantor":"postgres","grantee":"postgres","privilege":"EXECUTE","grantable":false}],"apiExecute":{"anon":false,"service_role":false,"authenticated":true,"inherit_upload_only":false}},"successorBodyMd5":"422651c6e50a5406cde09962d01400c4"},{"signature":"public.write_future_person_profile_v1(uuid,uuid,uuid,uuid,jsonb,uuid,bytea,bytea,jsonb,text)","metadata":{"name":"public.write_future_person_profile_v1","inputTypes":"uuid, uuid, uuid, uuid, jsonb, uuid, bytea, bytea, jsonb, text","argumentNames":["p_account","p_session","p_embryo","p_signature","p_expected","p_profile","p_ciphertext","p_wrapped_key","p_indexes","p_nonce"],"allTypes":null,"modes":null,"inputCount":10,"defaultCount":0,"defaultExpression":null,"result":"jsonb","setReturning":false,"owner":"postgres","language":"plpgsql","kind":"f","volatility":"v","parallel":"u","strict":false,"securityDefiner":true,"leakproof":false,"variadicType":"0","binary":null,"support":"-","cost":100,"rows":0,"config":["search_path=\"\""],"bodyMd5":"75243c9864bf12bd19b185b7eb1e76b0","transformTypes":null,"sqlBody":null,"acl":[{"grantor":"postgres","grantee":"postgres","privilege":"EXECUTE","grantable":false},{"grantor":"postgres","grantee":"service_role","privilege":"EXECUTE","grantable":false}],"apiExecute":{"anon":false,"service_role":true,"authenticated":false,"inherit_upload_only":false}},"successorBodyMd5":"549d87d0d357bbbda013d9bc73413117"},{"signature":"public.future_person_owner_objection_controls_v1(uuid)","metadata":{"acl":[{"grantee":"authenticated","grantor":"postgres","grantable":false,"privilege":"EXECUTE"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"EXECUTE"}],"cost":100,"kind":"f","name":"public.future_person_owner_objection_controls_v1","rows":0,"modes":null,"owner":"postgres","binary":null,"config":["search_path=\"\""],"result":"jsonb","strict":false,"bodyMd5":"52d4cdb44f64ac6c14eb61f74497c822","support":"-","allTypes":null,"language":"plpgsql","parallel":"u","leakproof":false,"apiExecute":{"anon":false,"service_role":false,"authenticated":true,"inherit_upload_only":false},"inputCount":1,"inputTypes":"uuid","volatility":"v","defaultCount":1,"setReturning":false,"variadicType":"0","argumentNames":["p_after"],"securityDefiner":true,"defaultExpression":"NULL::uuid","transformTypes":null,"sqlBody":null},"successorBodyMd5":"52d4cdb44f64ac6c14eb61f74497c822"}]$pins$::jsonb;
  new_pins constant jsonb := $new_pins$[{"signature":"private.future_person_profile_read_locks_v1(uuid,uuid)","metadata":{"name":"private.future_person_profile_read_locks_v1","inputTypes":"uuid, uuid","argumentNames":["p_account","p_session"],"allTypes":null,"modes":null,"inputCount":2,"defaultCount":0,"defaultExpression":null,"result":"void","setReturning":false,"owner":"postgres","language":"plpgsql","kind":"f","volatility":"v","parallel":"u","strict":false,"securityDefiner":true,"leakproof":false,"variadicType":"0","binary":null,"support":"-","cost":100,"rows":0,"config":["search_path=\"\""],"bodyMd5":"226c7cd92cb31f5943cc1d615e747b03","transformTypes":null,"sqlBody":null,"acl":[{"grantor":"postgres","grantee":"postgres","privilege":"EXECUTE","grantable":false}],"apiExecute":{"anon":false,"authenticated":false,"inherit_upload_only":false,"service_role":false}}},{"signature":"private.future_person_profile_write_locks_v1(uuid,uuid)","metadata":{"name":"private.future_person_profile_write_locks_v1","inputTypes":"uuid, uuid","argumentNames":["p_account","p_session"],"allTypes":null,"modes":null,"inputCount":2,"defaultCount":0,"defaultExpression":null,"result":"void","setReturning":false,"owner":"postgres","language":"plpgsql","kind":"f","volatility":"v","parallel":"u","strict":false,"securityDefiner":true,"leakproof":false,"variadicType":"0","binary":null,"support":"-","cost":100,"rows":0,"config":["search_path=\"\""],"bodyMd5":"a48dbd2146928e6bae050cf5d7eb36c5","transformTypes":null,"sqlBody":null,"acl":[{"grantor":"postgres","grantee":"postgres","privilege":"EXECUTE","grantable":false}],"apiExecute":{"anon":false,"authenticated":false,"inherit_upload_only":false,"service_role":false}}},{"signature":"private.assert_live_authenticated_session_write_v1()","metadata":{"name":"private.assert_live_authenticated_session_write_v1","inputTypes":"","argumentNames":null,"allTypes":null,"modes":null,"inputCount":0,"defaultCount":0,"defaultExpression":null,"result":"jsonb","setReturning":false,"owner":"postgres","language":"plpgsql","kind":"f","volatility":"v","parallel":"u","strict":false,"securityDefiner":true,"leakproof":false,"variadicType":"0","binary":null,"support":"-","cost":100,"rows":0,"config":["search_path=pg_catalog, private"],"bodyMd5":"c8cfa149f20a7da76c1d435c8015281f","transformTypes":null,"sqlBody":null,"acl":[{"grantor":"postgres","grantee":"postgres","privilege":"EXECUTE","grantable":false}],"apiExecute":{"anon":false,"service_role":false,"authenticated":false,"inherit_upload_only":false}}},{"signature":"private.keyless_owner_account_read_v1(uuid)","metadata":{"name":"private.keyless_owner_account_read_v1","inputTypes":"uuid","argumentNames":["p_notice"],"allTypes":null,"modes":null,"inputCount":1,"defaultCount":0,"defaultExpression":null,"result":"jsonb","setReturning":false,"owner":"postgres","language":"plpgsql","kind":"f","volatility":"v","parallel":"u","strict":false,"securityDefiner":true,"leakproof":false,"variadicType":"0","binary":null,"support":"-","cost":100,"rows":0,"config":["search_path=\"\""],"bodyMd5":"a98a980fd6800e1f039b0a2e030f7501","transformTypes":null,"sqlBody":null,"acl":[{"grantor":"postgres","grantee":"postgres","privilege":"EXECUTE","grantable":false}],"apiExecute":{"anon":false,"service_role":false,"authenticated":false,"inherit_upload_only":false}}}]$new_pins$::jsonb;
begin
  if current_user<>'postgres' then raise exception using errcode='42501',message='settings authority locks owner only';end if;
  if exists(select 1 from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='private'
      and p.proname in('future_person_profile_read_locks_v1','future_person_profile_write_locks_v1',
        'assert_live_authenticated_session_write_v1','keyless_owner_account_read_v1')) then
    raise exception using errcode='55000',message='settings authority helper already exists';end if;
  for expected in select value from jsonb_array_elements(pins) loop
    target:=to_regprocedure(expected->>'signature');
    select jsonb_build_object('name',ns.nspname||'.'||p.proname,'inputTypes',oidvectortypes(p.proargtypes),'argumentNames',p.proargnames,'allTypes',(select jsonb_agg(format_type(t,null) order by n) from unnest(p.proallargtypes) with ordinality a(t,n)),'modes',p.proargmodes,'inputCount',p.pronargs,'defaultCount',p.pronargdefaults,'defaultExpression',pg_get_expr(p.proargdefaults,0),'result',pg_get_function_result(p.oid),'setReturning',p.proretset,'owner',pg_get_userbyid(p.proowner),'language',l.lanname,'kind',p.prokind,'volatility',p.provolatile,'parallel',p.proparallel,'strict',p.proisstrict,'securityDefiner',p.prosecdef,'leakproof',p.proleakproof,'variadicType',p.provariadic,'binary',p.probin,'support',p.prosupport::text,'cost',p.procost,'rows',p.prorows,'config',p.proconfig,'bodyMd5',md5(p.prosrc),'transformTypes',(select jsonb_agg(format_type(t,null) order by n) from unnest(p.protrftypes) with ordinality a(t,n)),'sqlBody',p.prosqlbody::text,'acl',(select jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),'grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) order by a.grantee::regrole::text,a.grantor::regrole::text,a.privilege_type,a.is_grantable) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a),'apiExecute',(select jsonb_object_agg(api,has_function_privilege(api,p.oid,'execute')) from unnest(array['anon','authenticated','inherit_upload_only','service_role']) api)) into actual from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace join pg_language l on l.oid=p.prolang where p.oid=target;
    if target is null or actual is distinct from expected->'metadata' then
      raise exception using errcode='55000',message='settings authority predecessor differs';end if;
    -- Full runtime pg_proc comparison preserves actual OIDs and raw ACLs;
    -- literal semantic pins above also work on independently allocated catalogs.
    select to_jsonb(p)-'prosrc' into actual from pg_proc p where p.oid=target;
    before_metadata:=before_metadata||jsonb_build_object(expected->>'signature',actual);
  end loop;
  execute $definition_0$CREATE FUNCTION private.future_person_profile_read_locks_v1(p_account uuid, p_session uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform 1 from auth.users where id=p_account for share;
  perform 1 from auth.sessions where id=p_session and user_id=p_account for share;
  perform 1 from public.profiles where id=p_account for share;
end
$function$;$definition_0$;
  execute $definition_1$CREATE FUNCTION private.future_person_profile_write_locks_v1(p_account uuid, p_session uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform 1 from auth.users where id=p_account for share;
  perform 1 from auth.sessions where id=p_session and user_id=p_account for update;
  perform 1 from public.profiles where id=p_account for share;
end
$function$;$definition_1$;
  execute $definition_2$CREATE FUNCTION private.assert_live_authenticated_session_write_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'private'
AS $function$
declare c jsonb:=auth.jwt(); a uuid; s uuid; p public.profiles%rowtype; v_session bigint; v_issuer text;
begin
 select auth_issuer into v_issuer from private.upload_authorization_config where singleton for share;
 if v_issuer is null or c->>'iss' is distinct from v_issuer
  or (coalesce(c->>'role',''),coalesce(c->>'aud','')) not in (('authenticated','authenticated'),('inherit_upload_only','inherit-storage-upload'))
  or coalesce(c->>'sub','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or coalesce(c->>'session_id','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or jsonb_typeof(c->'exp') is distinct from 'number' or coalesce(c->>'exp','')!~'^[0-9]+$'
  or (c->>'exp')::numeric<=extract(epoch from clock_timestamp()) then
  return '{"authorized":false}'::jsonb;
 end if;
 a:=(c->>'sub')::uuid; s:=(c->>'session_id')::uuid;
 perform 1 from auth.users where id=a and deleted_at is null
  and (banned_until is null or banned_until<=clock_timestamp()) for share;
 if not found then return '{"authorized":false}'::jsonb; end if;
 select coalesce(refresh_token_counter,0)+1 into v_session from auth.sessions
  where id=s and user_id=a and (not_after is null or not_after>clock_timestamp()) for update;
 if v_session is null then return '{"authorized":false}'::jsonb; end if;
 select * into p from public.profiles where id=a for update;
 if p.id is null or p.deletion_requested_at is not null then return '{"authorized":false}'::jsonb; end if;
 if c->>'role'='inherit_upload_only' and (c->'account_auth_session_revision') is distinct from to_jsonb(p.auth_session_revision) then
  return '{"authorized":false}'::jsonb;
 end if;
 return jsonb_build_object('authorized',true,'account_auth_session_revision',p.auth_session_revision,'session_revision',v_session);
exception when invalid_text_representation or numeric_value_out_of_range then
 return '{"authorized":false}'::jsonb;
end;
$function$;$definition_2$;
  execute $definition_3$CREATE FUNCTION private.keyless_owner_account_read_v1(p_notice uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare live jsonb; n public.future_person_claim_notices; k public.future_person_claim_review_packages;
begin
  live:=private.assert_live_authenticated_session_read_v1();
  if live->>'authorized' is distinct from 'true' then return null;end if;
  select * into n from public.future_person_claim_notices where id=p_notice;
  select * into k from public.future_person_claim_review_packages where claim_id=n.claim_id;
  perform 1 from public.subjects where id=k.subject_id for share;
  perform 1 from public.retention_rows where target_kind='claim' and target_id=n.claim_id order by id for share;
  select * into n from public.future_person_claim_notices where id=p_notice for share;
  if n.id is null or n.owner_account_id is distinct from auth.uid()
    or not private.keyless_objection_notice_current_v1(n.id) then return null;end if;
  perform private.validate_sensitive_account_session_read_v1(auth.uid(),(auth.jwt()->>'session_id')::uuid);
  return jsonb_build_object('accountId',auth.uid(),'authSessionId',(auth.jwt()->>'session_id')::uuid,
    'noticeId',n.id,'noticeRevision',n.notice_revision);
end $function$;$definition_3$;
  execute $definition_4$CREATE OR REPLACE FUNCTION private.future_person_profile_context_v1(p_account uuid, p_session uuid, p_embryo uuid, p_signature uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare e public.embryos%rowtype; s public.subjects%rowtype; c public.embryo_cohorts%rowtype;
  p public.profiles%rowtype; ss auth.sessions%rowtype; i public.future_person_identity%rowtype;
  b public.embryo_basis_bindings%rowtype; d public.embryo_cohort_drafts%rowtype; a record; v_proof jsonb;
  r public.retention_rows%rowtype; v_principals uuid[]; v_actor uuid; v_fingerprint text; v_revision bigint;
begin
  perform private.future_person_profile_read_locks_v1(p_account,p_session);
  select subject_id into e.subject_id from public.embryos where id=p_embryo;
  select * into s from public.subjects where id=e.subject_id for share;
  select * into c from public.embryo_cohorts where id=s.cohort_id for share;
  select * into e from public.embryos where id=p_embryo for share;
  if e.id is null or s.id is null or c.id is null or e.subject_id<>s.id or e.cohort_id<>c.id
    or s.cohort_id<>c.id or s.owner_account_id is distinct from c.owner_account_id
    or s.subject_class<>'embryo' or s.subject_account_id is not null
    or s.lifecycle not in ('active','restricted') or c.status not in ('active','restricted')
    or e.status<>'transferred' or e.future_person_state<>'reserved_for_future_person'
    or exists(select 1 from public.future_person_claims f where f.embryo_id=e.id and f.status='approved')
  then raise exception using errcode='42501',message='not_found'; end if;
  select * into ss from auth.sessions where id=p_session and user_id=p_account for share;
  select * into p from public.profiles where id=p_account for share;
  perform 1 from auth.users u where u.id=p_account and u.deleted_at is null
    and (u.banned_until is null or u.banned_until<=clock_timestamp()) for share;
  if not found or ss.id is null or p.id is null or p.deletion_requested_at is not null
    or (ss.not_after is not null and ss.not_after<=clock_timestamp())
  then raise exception using errcode='42501',message='not_found'; end if;
  if p_signature is not null then
    v_fingerprint:=private.embryo_ingest_authority_fingerprint_v1(c.id);
  else
    -- Erasing optional identity never requires signing a new upload consent.
    -- It still requires the actual current parent basis and recipient matrix.
    select * into d from public.embryo_cohort_drafts where id=c.draft_id for share;
    select * into b from public.embryo_basis_bindings where cohort_id=c.id for share;
    select * into a from private.resolve_embryo_basis_authority_v1(c.draft_id);
    if d.state is distinct from 'finalized' or b.cohort_id is null
      or (d.basis_case,d.basis_revision,b.basis_case,b.basis_revision,b.participant_set_revision)
        is distinct from (c.basis_case,c.basis_revision,c.basis_case,c.basis_revision,c.participant_set_revision)
      or (select array_agg(x order by x) from unnest(a.record_key_recipients) x)
        is distinct from (select array_agg(x order by x) from unnest(private.embryo_cohort_set_v1(c.id,'record_key_recipients')) x)
      or exists(select 1 from public.attestation_contradictions where cohort_id=c.id and resolved_at is null)
    then raise exception using errcode='42501',message='not_found'; end if;
    if c.basis_case in ('parent_deceased','sole_legal_authority') then
      perform 1 from public.legal_reviews lr join public.reviewed_evidence re on re.review_id=lr.id
        where lr.id=b.legal_review_id and re.id=b.reviewed_evidence_id and lr.decision='approved'
          and lr.target_kind='single_parent_basis' and lr.target_id=d.id and re.purged_at is null
          and re.evidence_kind=case c.basis_case when 'parent_deceased' then 'parent-death-certificate' else 'sole-disposition-authority' end
          and not exists(select 1 from public.legal_reviews newer where newer.target_kind=lr.target_kind
            and newer.target_id=lr.target_id and newer.review_revision>lr.review_revision) for share of lr,re;
      if not found then raise exception using errcode='42501',message='not_found'; end if;
    end if;
    select jsonb_agg(jsonb_build_array(ps.principal_id,ps.set_revision,ps.membership_revision,sp.principal_revision)
      order by ps.principal_id) into v_proof from public.embryo_participant_sets ps
      join public.subject_principals sp on sp.id=ps.principal_id and sp.status='active'
      where ps.cohort_id=c.id and ps.set_kind='record_key_recipients' and ps.revoked_at is null
        and ps.set_revision=c.participant_set_revision;
    v_fingerprint:=encode(extensions.digest(convert_to(jsonb_build_array('profile-erase-authority-v1',
      c.id,c.basis_case,c.basis_revision,c.recipient_set_revision,c.lifecycle_revision,
      b.case_artifact_signature_id,b.reviewed_evidence_id,b.legal_review_id,v_proof)::text,'UTF8'),'sha256'),'hex');
  end if;
  select array_agg(sp.id order by sp.id) into v_principals from public.subject_principals sp
    where sp.id=any(private.embryo_cohort_set_v1(c.id,'record_key_recipients'))
      and sp.account_id=p_account and sp.status='active' and sp.principal_kind='genetic_parent';
  if cardinality(v_principals) is distinct from 1 then
    raise exception using errcode='42501',message='not_found'; end if;
  v_actor:=v_principals[1];
  if p_signature is not null then
    perform 1 from public.consent_signatures cs join public.consent_artifacts ca
      on ca.artifact_key=cs.artifact_key and ca.version=cs.artifact_version
        and ca.body_sha256=cs.artifact_body_sha256
      where cs.id=p_signature and cs.signer_principal_id=v_actor and cs.signer_account_id=p_account
        and cs.target_kind='cohort_draft' and cs.target_id=c.draft_id
        and cs.artifact_key='consent.upload-embryo' and ca.superseded_at is null
        and ca.published_at<=clock_timestamp() and ca.effective_on<=timezone('UTC',clock_timestamp())::date
        and ca.body_sha256=encode(extensions.digest(convert_to(ca.body_markdown,'UTF8'),'sha256'),'hex')
        and cs.statement_keys=private.embryo_statement_keys_v1('consent.upload-embryo','parent')
        and cs.purpose='embryo-upload-parent-class' and cs.jurisdiction_code=p.jurisdiction_code
        and cs.jurisdiction_revision=p.jurisdiction_revision for share of cs,ca;
    if not found then raise exception using errcode='42501',message='not_found'; end if;
  end if;
  -- A fixed live disposition row is the sole deadline source. The parent
  -- cannot create a profile during physical disposal or extend a window.
  perform 1 from public.retention_rows rr where rr.target_kind='subject' and rr.target_id=s.id
    order by rr.id for share;
  select * into r from public.retention_rows rr where rr.retention_id='embryo.transferred-claim-window'
    and rr.target_kind='subject' and rr.target_id=s.id and rr.state in ('scheduled','active')
    and rr.disposition_revision=e.disposition_revision and rr.retention_revision=e.disposition_revision;
  if r.id is null or r.fixed_deadline<=clock_timestamp() or exists(
      select 1 from public.retention_rows rr join public.purge_manifests m on m.retention_row_id=rr.id
      where rr.target_kind='subject' and rr.target_id=s.id and (m.state in ('executing','complete') or m.physical_purge_started_at is not null or m.batch_cursor>0))
    or exists(select 1 from public.purge_manifest_entries x join public.purge_manifests m on m.id=x.manifest_id
      join public.retention_rows rr on rr.id=m.retention_row_id
      where rr.target_kind='subject' and rr.target_id=s.id and x.status in ('deleted','missing'))
  then raise exception using errcode='42501',message='not_found'; end if;
  select * into i from public.future_person_identity where embryo_id=e.id and state='current' for share;
  select coalesce(max(identity_revision),0)+1 into v_revision from public.future_person_identity where embryo_id=e.id;
  return jsonb_build_object('embryoId',e.id,'subjectId',s.id,'actorPrincipal',v_actor,
    'basisFingerprint',v_fingerprint,'basisRevision',c.basis_revision,'participantSetRevision',c.participant_set_revision,
    'recipientSetRevision',c.recipient_set_revision,'cohortLifecycleRevision',c.lifecycle_revision,
    'subjectLifecycleRevision',s.lifecycle_revision,'dispositionRevision',e.disposition_revision,
    'accountRevision',p.account_revision,'authSessionRevision',p.auth_session_revision,
    'sessionRevision',coalesce(ss.refresh_token_counter,0)+1,'consentSignatureId',p_signature,
    'currentProfileId',i.id,'nextIdentityRevision',v_revision,'expiresAt',r.fixed_deadline);
end $function$;$definition_4$;
  execute $definition_5$CREATE OR REPLACE FUNCTION public.write_future_person_profile_v1(p_account uuid, p_session uuid, p_embryo uuid, p_signature uuid, p_expected jsonb, p_profile uuid, p_ciphertext bytea, p_wrapped_key bytea, p_indexes jsonb, p_nonce text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_context jsonb; v_index jsonb; v_active bigint; v_retention uuid; v_revision bigint;
begin
  if p_signature is null or p_profile is null or p_ciphertext is null or octet_length(p_ciphertext) not between 29 and 16384
    or octet_length(p_wrapped_key) is distinct from 72 or not private.future_person_profile_shape_v1(p_indexes)
  then raise exception using errcode='22023',message='invalid_request'; end if;
  perform private.future_person_profile_write_locks_v1(p_account,p_session);
  perform 1 from public.subjects where id=(select subject_id from public.embryos where id=p_embryo) for update;
  v_context:=private.future_person_profile_context_v1(p_account,p_session,p_embryo,p_signature);
  if p_expected is distinct from v_context then raise exception using errcode='42501',message='not_found'; end if;
  v_index:=private.resolve_hmac_set_v1('contact',null,p_indexes);
  v_active:=private.hmac_active_revision_v1('contact');
  perform private.consume_embryo_operation_nonce_v1(p_nonce,p_account,p_session,'future_person_identity_save','embryo',p_embryo);
  perform private.erase_future_person_profile_v1((v_context->>'currentProfileId')::uuid,'superseded');
  v_revision:=(v_context->>'nextIdentityRevision')::bigint;
  insert into public.future_person_identity(id,embryo_id,identity_revision,parent_supplied_ciphertext,
    identity_hmac,hmac_key_revision,envelope_key_revision,profile_format_version,wrapped_profile_key,
    match_indexes,fixed_expires_at,authority_snapshot)
  values(p_profile,p_embryo,v_revision,p_ciphertext,v_index->>v_active::text,v_active,1,1,p_wrapped_key,
    p_indexes,(v_context->>'expiresAt')::timestamptz,
    v_context-'currentProfileId'-'nextIdentityRevision'-'accountRevision'-'authSessionRevision'-'sessionRevision');
  insert into public.retention_rows(retention_id,target_kind,target_id,retention_revision,target_lifecycle_revision,
    disposition_revision,fixed_deadline)
  values('future-person.identity-match-profile','subject',(v_context->>'subjectId')::uuid,v_revision,
    (v_context->>'subjectLifecycleRevision')::bigint,(v_context->>'dispositionRevision')::bigint,
    (v_context->>'expiresAt')::timestamptz) returning id into v_retention;
  insert into public.retention_due_phases(retention_row_id,retention_id,phase_id,phase_kind,phase_revision,
    phase_deadline,target_kind,target_id,target_lifecycle_revision,disposition_revision,
    recipient_authority_kind,recipient_authority_revision,immutable_envelope)
  select v_retention,'future-person.identity-match-profile',phase_id,phase_kind,1,
    (v_context->>'expiresAt')::timestamptz,'subject',(v_context->>'subjectId')::uuid,
    (v_context->>'subjectLifecycleRevision')::bigint,(v_context->>'dispositionRevision')::bigint,
    'record-key-recipients',(v_context->>'recipientSetRevision')::bigint,
    jsonb_build_object('profileId',p_profile,'identityRevision',v_revision)
  from public.retention_phase_registry where retention_id='future-person.identity-match-profile';
  perform private.append_legal_audit_event('embryo.identity_profile_saved',null,'api.future-person-identity-profile',
    'saved','{}'::jsonb);
  return jsonb_build_object('status','saved','expiresAt',(v_context->>'expiresAt')::timestamptz);
end $function$;$definition_5$;
  execute $definition_6$CREATE OR REPLACE FUNCTION public.delete_future_person_profile_v1(p_account uuid, p_session uuid, p_embryo uuid, p_expected jsonb, p_nonce text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_context jsonb;
begin
  perform private.future_person_profile_write_locks_v1(p_account,p_session);
  perform 1 from public.subjects where id=(select subject_id from public.embryos where id=p_embryo) for update;
  v_context:=private.future_person_profile_context_v1(p_account,p_session,p_embryo,null);
  if p_expected is distinct from v_context then raise exception using errcode='42501',message='not_found'; end if;
  perform private.consume_embryo_operation_nonce_v1(p_nonce,p_account,p_session,'future_person_identity_delete','embryo',p_embryo);
  perform private.erase_future_person_profile_v1((v_context->>'currentProfileId')::uuid);
end $function$;$definition_6$;
  execute $definition_7$CREATE OR REPLACE FUNCTION private.keyless_owner_account_v1(p_notice uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare live jsonb; n public.future_person_claim_notices; k public.future_person_claim_review_packages;
begin
  live:=private.assert_live_authenticated_session_write_v1();
  if live->>'authorized' is distinct from 'true' then return null;end if;
  select * into n from public.future_person_claim_notices where id=p_notice;
  select * into k from public.future_person_claim_review_packages where claim_id=n.claim_id;
  perform 1 from public.subjects where id=k.subject_id for update;
  perform 1 from public.retention_rows where target_kind='claim' and target_id=n.claim_id order by id for update;
  select * into n from public.future_person_claim_notices where id=p_notice for update;
  if n.id is null or n.owner_account_id is distinct from auth.uid()
    or not private.keyless_objection_notice_current_v1(n.id) then return null;end if;
  perform private.validate_sensitive_account_session_v1(auth.uid(),(auth.jwt()->>'session_id')::uuid);
  return jsonb_build_object('accountId',auth.uid(),'authSessionId',(auth.jwt()->>'session_id')::uuid,
    'noticeId',n.id,'noticeRevision',n.notice_revision);
end $function$;$definition_7$;
  execute $definition_8$CREATE OR REPLACE FUNCTION public.future_person_owner_account_objection_scope_v1(p_notice uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare authority jsonb; n public.future_person_claim_notices;
begin
  authority:=private.keyless_owner_account_read_v1(p_notice);
  if authority is null then raise exception using errcode='42501',message='claim notice unavailable';end if;
  select * into n from public.future_person_claim_notices where id=p_notice;
  return jsonb_build_object('claimId',n.claim_id,'noticeId',n.id,'noticeRevision',n.notice_revision);
end $function$;$definition_8$;
  execute 'revoke all on function private.future_person_profile_read_locks_v1(uuid,uuid) from public,anon,authenticated,inherit_upload_only,service_role';
  execute 'revoke all on function private.future_person_profile_write_locks_v1(uuid,uuid) from public,anon,authenticated,inherit_upload_only,service_role';
  execute 'revoke all on function private.assert_live_authenticated_session_write_v1() from public,anon,authenticated,inherit_upload_only,service_role';
  execute 'revoke all on function private.keyless_owner_account_read_v1(uuid) from public,anon,authenticated,inherit_upload_only,service_role';
  for expected in select value from jsonb_array_elements(pins) loop
    target:=to_regprocedure(expected->>'signature');
    select jsonb_build_object('name',ns.nspname||'.'||p.proname,'inputTypes',oidvectortypes(p.proargtypes),'argumentNames',p.proargnames,'allTypes',(select jsonb_agg(format_type(t,null) order by n) from unnest(p.proallargtypes) with ordinality a(t,n)),'modes',p.proargmodes,'inputCount',p.pronargs,'defaultCount',p.pronargdefaults,'defaultExpression',pg_get_expr(p.proargdefaults,0),'result',pg_get_function_result(p.oid),'setReturning',p.proretset,'owner',pg_get_userbyid(p.proowner),'language',l.lanname,'kind',p.prokind,'volatility',p.provolatile,'parallel',p.proparallel,'strict',p.proisstrict,'securityDefiner',p.prosecdef,'leakproof',p.proleakproof,'variadicType',p.provariadic,'binary',p.probin,'support',p.prosupport::text,'cost',p.procost,'rows',p.prorows,'config',p.proconfig,'bodyMd5',md5(p.prosrc),'transformTypes',(select jsonb_agg(format_type(t,null) order by n) from unnest(p.protrftypes) with ordinality a(t,n)),'sqlBody',p.prosqlbody::text,'acl',(select jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),'grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) order by a.grantee::regrole::text,a.grantor::regrole::text,a.privilege_type,a.is_grantable) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a),'apiExecute',(select jsonb_object_agg(api,has_function_privilege(api,p.oid,'execute')) from unnest(array['anon','authenticated','inherit_upload_only','service_role']) api)) into actual from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace join pg_language l on l.oid=p.prolang where p.oid=target;
    if target is null or actual is distinct from (expected->'metadata')||jsonb_build_object('bodyMd5',expected->>'successorBodyMd5') then
      raise exception using errcode='55000',message='settings authority successor differs';end if;
    select to_jsonb(p)-'prosrc' into actual from pg_proc p where p.oid=target;
    if actual is distinct from before_metadata->(expected->>'signature') then
      raise exception using errcode='55000',message='settings authority predecessor metadata changed';end if;
  end loop;
  for expected in select value from jsonb_array_elements(new_pins) loop
    target:=to_regprocedure(expected->>'signature');
    select jsonb_build_object('name',ns.nspname||'.'||p.proname,'inputTypes',oidvectortypes(p.proargtypes),'argumentNames',p.proargnames,'allTypes',(select jsonb_agg(format_type(t,null) order by n) from unnest(p.proallargtypes) with ordinality a(t,n)),'modes',p.proargmodes,'inputCount',p.pronargs,'defaultCount',p.pronargdefaults,'defaultExpression',pg_get_expr(p.proargdefaults,0),'result',pg_get_function_result(p.oid),'setReturning',p.proretset,'owner',pg_get_userbyid(p.proowner),'language',l.lanname,'kind',p.prokind,'volatility',p.provolatile,'parallel',p.proparallel,'strict',p.proisstrict,'securityDefiner',p.prosecdef,'leakproof',p.proleakproof,'variadicType',p.provariadic,'binary',p.probin,'support',p.prosupport::text,'cost',p.procost,'rows',p.prorows,'config',p.proconfig,'bodyMd5',md5(p.prosrc),'transformTypes',(select jsonb_agg(format_type(t,null) order by n) from unnest(p.protrftypes) with ordinality a(t,n)),'sqlBody',p.prosqlbody::text,'acl',(select jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),'grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) order by a.grantee::regrole::text,a.grantor::regrole::text,a.privilege_type,a.is_grantable) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a),'apiExecute',(select jsonb_object_agg(api,has_function_privilege(api,p.oid,'execute')) from unnest(array['anon','authenticated','inherit_upload_only','service_role']) api)) into actual from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace join pg_language l on l.oid=p.prolang where p.oid=target;
    if target is null or actual is distinct from expected->'metadata' then
      raise exception using errcode='55000',message='settings authority helper metadata differs';end if;
  end loop;
end $settings_authority_locks$;
notify pgrst,'reload schema';
