-- Settings inventories are reads: compatible shared locks retain live Auth,
-- deletion, expiry, current-session, recent-reauthentication and MFA checks.
-- Mutating callers keep the original exclusive validators unchanged.
-- Only the authenticated owner-notice inventory calls these API-denied copies.
do $settings_read_locks$
declare expected jsonb; actual jsonb; target regprocedure; before_metadata jsonb:='{}';
  pins constant jsonb := $pins$[{"signature":"public.future_person_owner_objection_controls_v1(uuid)","metadata":{"acl":[{"grantee":"authenticated","grantor":"postgres","grantable":false,"privilege":"EXECUTE"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"EXECUTE"}],"cost":100,"kind":"f","name":"public.future_person_owner_objection_controls_v1","rows":0,"modes":null,"owner":"postgres","binary":null,"config":["search_path=\"\""],"result":"jsonb","strict":false,"bodyMd5":"75fc7a537eff1618b5b97e4c18c70f83","support":"-","allTypes":null,"language":"plpgsql","parallel":"u","leakproof":false,"apiExecute":{"anon":false,"service_role":false,"authenticated":true,"inherit_upload_only":false},"inputCount":1,"inputTypes":"uuid","volatility":"v","defaultCount":1,"setReturning":false,"variadicType":"0","argumentNames":["p_after"],"securityDefiner":true,"defaultExpression":"NULL::uuid"},"successorBodyMd5":"52d4cdb44f64ac6c14eb61f74497c822"},{"signature":"private.assert_live_authenticated_session()","metadata":{"acl":[{"grantee":"authenticated","grantor":"postgres","grantable":false,"privilege":"EXECUTE"},{"grantee":"inherit_upload_only","grantor":"postgres","grantable":false,"privilege":"EXECUTE"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"EXECUTE"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"EXECUTE"}],"cost":100,"kind":"f","name":"private.assert_live_authenticated_session","rows":0,"modes":null,"owner":"postgres","binary":null,"config":["search_path=pg_catalog, private"],"result":"jsonb","strict":false,"bodyMd5":"7a8423b747e8cbca49bbb99f93f4c9be","support":"-","allTypes":null,"language":"plpgsql","parallel":"u","leakproof":false,"apiExecute":{"anon":false,"service_role":true,"authenticated":true,"inherit_upload_only":true},"inputCount":0,"inputTypes":"","volatility":"v","defaultCount":0,"setReturning":false,"variadicType":"0","argumentNames":null,"securityDefiner":true,"defaultExpression":null},"successorBodyMd5":"7a8423b747e8cbca49bbb99f93f4c9be"},{"signature":"private.validate_sensitive_account_session_v1(uuid,uuid)","metadata":{"acl":[{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"EXECUTE"}],"cost":100,"kind":"f","name":"private.validate_sensitive_account_session_v1","rows":0,"modes":null,"owner":"postgres","binary":null,"config":["search_path=\"\""],"result":"void","strict":false,"bodyMd5":"ce8813a75279262687f546121d45b4ac","support":"-","allTypes":null,"language":"plpgsql","parallel":"u","leakproof":false,"apiExecute":{"anon":false,"service_role":false,"authenticated":false,"inherit_upload_only":false},"inputCount":2,"inputTypes":"uuid, uuid","volatility":"v","defaultCount":0,"setReturning":false,"variadicType":"0","argumentNames":["p_account_id","p_session_id"],"securityDefiner":true,"defaultExpression":null},"successorBodyMd5":"ce8813a75279262687f546121d45b4ac"}]$pins$::jsonb;
  new_pins constant jsonb := $new_pins$[{"signature":"private.assert_live_authenticated_session_read_v1()","metadata":{"acl":[{"grantor":"postgres","grantee":"postgres","privilege":"EXECUTE","grantable":false}],"cost":100,"kind":"f","name":"private.assert_live_authenticated_session_read_v1","rows":0,"modes":null,"owner":"postgres","binary":null,"config":["search_path=pg_catalog, private"],"result":"jsonb","strict":false,"bodyMd5":"9e82a8763e4769505d09ecda9517e18f","support":"-","allTypes":null,"language":"plpgsql","parallel":"u","leakproof":false,"apiExecute":{"anon":false,"service_role":false,"authenticated":false,"inherit_upload_only":false},"inputCount":0,"inputTypes":"","volatility":"v","defaultCount":0,"setReturning":false,"variadicType":"0","argumentNames":null,"securityDefiner":true,"defaultExpression":null}},{"signature":"private.validate_sensitive_account_session_read_v1(uuid,uuid)","metadata":{"acl":[{"grantor":"postgres","grantee":"postgres","privilege":"EXECUTE","grantable":false}],"cost":100,"kind":"f","name":"private.validate_sensitive_account_session_read_v1","rows":0,"modes":null,"owner":"postgres","binary":null,"config":["search_path=\"\""],"result":"void","strict":false,"bodyMd5":"706dcffdb9bdd16d2efbce3126de3afc","support":"-","allTypes":null,"language":"plpgsql","parallel":"u","leakproof":false,"apiExecute":{"anon":false,"service_role":false,"authenticated":false,"inherit_upload_only":false},"inputCount":2,"inputTypes":"uuid, uuid","volatility":"v","defaultCount":0,"setReturning":false,"variadicType":"0","argumentNames":["p_account_id","p_session_id"],"securityDefiner":true,"defaultExpression":null}}]$new_pins$::jsonb;
begin
  if current_user<>'postgres' then raise exception using errcode='42501',message='settings read locks owner only';end if;
  if exists(select 1 from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='private' and p.proname in('assert_live_authenticated_session_read_v1','validate_sensitive_account_session_read_v1')) then
    raise exception using errcode='55000',message='settings read validator already exists';end if;
  for expected in select value from jsonb_array_elements(pins) loop
    target:=to_regprocedure(expected->>'signature');
    select jsonb_build_object('name',ns.nspname||'.'||p.proname,'inputTypes',oidvectortypes(p.proargtypes),'argumentNames',p.proargnames,'allTypes',(select jsonb_agg(format_type(t,null) order by n) from unnest(p.proallargtypes) with ordinality a(t,n)),'modes',p.proargmodes,'inputCount',p.pronargs,'defaultCount',p.pronargdefaults,'defaultExpression',pg_get_expr(p.proargdefaults,0),'result',pg_get_function_result(p.oid),'setReturning',p.proretset,'owner',pg_get_userbyid(p.proowner),'language',l.lanname,'kind',p.prokind,'volatility',p.provolatile,'parallel',p.proparallel,'strict',p.proisstrict,'securityDefiner',p.prosecdef,'leakproof',p.proleakproof,'variadicType',p.provariadic,'binary',p.probin,'support',p.prosupport::text,'cost',p.procost,'rows',p.prorows,'config',p.proconfig,'bodyMd5',md5(p.prosrc),'acl',(select jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),'grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) order by a.grantee::regrole::text,a.grantor::regrole::text,a.privilege_type,a.is_grantable) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a),'apiExecute',(select jsonb_object_agg(api,has_function_privilege(api,p.oid,'execute')) from unnest(array['anon','authenticated','inherit_upload_only','service_role']) api)) into actual from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace join pg_language l on l.oid=p.prolang where p.oid=target;
    if target is null or actual is distinct from expected->'metadata' then
      raise exception using errcode='55000',message='settings read predecessor differs';end if;
    select to_jsonb(p)-'prosrc' into actual from pg_proc p where p.oid=target;
    before_metadata:=before_metadata||jsonb_build_object(expected->>'signature',actual);
  end loop;
  execute $definition_0$CREATE FUNCTION private.assert_live_authenticated_session_read_v1()
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
  where id=s and user_id=a and (not_after is null or not_after>clock_timestamp()) for share;
 if v_session is null then return '{"authorized":false}'::jsonb; end if;
 select * into p from public.profiles where id=a for share;
 if p.id is null or p.deletion_requested_at is not null then return '{"authorized":false}'::jsonb; end if;
 if c->>'role'='inherit_upload_only' and (c->'account_auth_session_revision') is distinct from to_jsonb(p.auth_session_revision) then
  return '{"authorized":false}'::jsonb;
 end if;
 return jsonb_build_object('authorized',true,'account_auth_session_revision',p.auth_session_revision,'session_revision',v_session);
exception when invalid_text_representation or numeric_value_out_of_range then
 return '{"authorized":false}'::jsonb;
end;
$function$;$definition_0$;
  execute $definition_1$CREATE FUNCTION private.validate_sensitive_account_session_read_v1(p_account_id uuid, p_session_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_session auth.sessions%rowtype;
begin
  select s.* into v_session
  from auth.sessions s
  where s.id = p_session_id and s.user_id = p_account_id
  for share;

  if v_session.id is null
    or v_session.created_at < clock_timestamp() - interval '15 minutes'
    or (v_session.not_after is not null and v_session.not_after <= clock_timestamp())
  then
    raise exception using errcode = '42501', message = 'recent_reauthentication_required';
  end if;

  if exists (
    select 1 from auth.mfa_factors f
    where f.user_id = p_account_id and f.status::text = 'verified'
  ) and coalesce(v_session.aal::text, 'aal1') <> 'aal2' then
    raise exception using errcode = '42501', message = 'mfa_required';
  end if;
end;
$function$;$definition_1$;
  execute $definition_2$CREATE OR REPLACE FUNCTION public.future_person_owner_objection_controls_v1(p_after uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare live jsonb; items jsonb; next_cursor uuid;
begin
  live:=private.assert_live_authenticated_session_read_v1();
  if live->>'authorized' is distinct from 'true' then
    raise exception using errcode='42501',message='claim notice unavailable';end if;
  perform private.validate_sensitive_account_session_read_v1(auth.uid(),(auth.jwt()->>'session_id')::uuid);
  with selected as materialized(select n.id,n.notice_revision,n.notice_deadline
    from public.future_person_claim_notices n where n.owner_account_id=auth.uid()
      and (p_after is null or n.id>p_after) and private.keyless_objection_notice_current_v1(n.id)
    order by n.id limit 65)
  select coalesce(jsonb_agg(jsonb_build_object('noticeId',id,'noticeRevision',notice_revision,
    'safeNoticeSummary','A claim to a record you hold is pending.','noticeDeadline',notice_deadline,
    'objectionArtifactBody','Your objection pauses only this claim while a named person reviews it. Your record stays as it is.',
    'allowedActionIds',jsonb_build_array('object')) order by id) filter(where row_number<=64),'[]'::jsonb),
    case when count(*)>64 then (array_agg(id order by id))[64] else null end
    into items,next_cursor from(select *,row_number() over(order by id) from selected) numbered;
  return jsonb_build_object('items',items,'nextCursor',next_cursor);
end $function$;$definition_2$;
  execute 'revoke all on function private.assert_live_authenticated_session_read_v1() from public,anon,authenticated,inherit_upload_only,service_role';
  execute 'revoke all on function private.validate_sensitive_account_session_read_v1(uuid,uuid) from public,anon,authenticated,inherit_upload_only,service_role';
  for expected in select value from jsonb_array_elements(pins) loop
    target:=to_regprocedure(expected->>'signature');
    select jsonb_build_object('name',ns.nspname||'.'||p.proname,'inputTypes',oidvectortypes(p.proargtypes),'argumentNames',p.proargnames,'allTypes',(select jsonb_agg(format_type(t,null) order by n) from unnest(p.proallargtypes) with ordinality a(t,n)),'modes',p.proargmodes,'inputCount',p.pronargs,'defaultCount',p.pronargdefaults,'defaultExpression',pg_get_expr(p.proargdefaults,0),'result',pg_get_function_result(p.oid),'setReturning',p.proretset,'owner',pg_get_userbyid(p.proowner),'language',l.lanname,'kind',p.prokind,'volatility',p.provolatile,'parallel',p.proparallel,'strict',p.proisstrict,'securityDefiner',p.prosecdef,'leakproof',p.proleakproof,'variadicType',p.provariadic,'binary',p.probin,'support',p.prosupport::text,'cost',p.procost,'rows',p.prorows,'config',p.proconfig,'bodyMd5',md5(p.prosrc),'acl',(select jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),'grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) order by a.grantee::regrole::text,a.grantor::regrole::text,a.privilege_type,a.is_grantable) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a),'apiExecute',(select jsonb_object_agg(api,has_function_privilege(api,p.oid,'execute')) from unnest(array['anon','authenticated','inherit_upload_only','service_role']) api)) into actual from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace join pg_language l on l.oid=p.prolang where p.oid=target;
    if actual is distinct from (expected->'metadata')||jsonb_build_object('bodyMd5',expected->>'successorBodyMd5') then
      raise exception using errcode='55000',message='settings read successor differs';end if;
    select to_jsonb(p)-'prosrc' into actual from pg_proc p where p.oid=target;
    if actual is distinct from before_metadata->(expected->>'signature') then
      raise exception using errcode='55000',message='settings read predecessor metadata changed';end if;
  end loop;
  for expected in select value from jsonb_array_elements(new_pins) loop
    target:=to_regprocedure(expected->>'signature');
    select jsonb_build_object('name',ns.nspname||'.'||p.proname,'inputTypes',oidvectortypes(p.proargtypes),'argumentNames',p.proargnames,'allTypes',(select jsonb_agg(format_type(t,null) order by n) from unnest(p.proallargtypes) with ordinality a(t,n)),'modes',p.proargmodes,'inputCount',p.pronargs,'defaultCount',p.pronargdefaults,'defaultExpression',pg_get_expr(p.proargdefaults,0),'result',pg_get_function_result(p.oid),'setReturning',p.proretset,'owner',pg_get_userbyid(p.proowner),'language',l.lanname,'kind',p.prokind,'volatility',p.provolatile,'parallel',p.proparallel,'strict',p.proisstrict,'securityDefiner',p.prosecdef,'leakproof',p.proleakproof,'variadicType',p.provariadic,'binary',p.probin,'support',p.prosupport::text,'cost',p.procost,'rows',p.prorows,'config',p.proconfig,'bodyMd5',md5(p.prosrc),'acl',(select jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),'grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) order by a.grantee::regrole::text,a.grantor::regrole::text,a.privilege_type,a.is_grantable) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a),'apiExecute',(select jsonb_object_agg(api,has_function_privilege(api,p.oid,'execute')) from unnest(array['anon','authenticated','inherit_upload_only','service_role']) api)) into actual from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace join pg_language l on l.oid=p.prolang where p.oid=target;
    if target is null or actual is distinct from expected->'metadata' then
      raise exception using errcode='55000',message='settings read validator metadata differs';end if;
  end loop;
end $settings_read_locks$;
notify pgrst,'reload schema';
