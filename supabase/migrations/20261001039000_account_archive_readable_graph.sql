-- NEXT-RELEASE exact own saved-result and graph-metadata consumer.
-- Source authored only: no DB/native/provider proof or public activation.
do $account_readable_graph$
declare predecessor record;definition text;old_body text;new_body text;
begin
 if not exists(select 1 from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure('private.export_archive_ordinary_account_authority_v1(jsonb,text,uuid)')
  and p.pronargs=3 and p.proowner='postgres'::regrole and p.prokind='f' and not p.proleakproof and p.provariadic=0::oid and p.probin is null
  and p.prosupport::oid=0::oid and p.procost=100 and p.prorows=(case when p.proretset then 1000 else 0 end) and p.proargmodes is null and p.proallargtypes is null
  and p.prolang=(select oid from pg_catalog.pg_language where lanname='plpgsql')
  and p.prosecdef and not p.proisstrict and p.provolatile='v' and p.proparallel='u' and p.prorettype='jsonb'::regtype and not p.proretset
  and p.proconfig=array['search_path=pg_catalog, private']::text[] and p.proargnames=array['p_origin','p_target_kind','p_target_id']::text[] and p.pronargdefaults=0 and p.proargdefaults is null
  and md5(p.prosrc)='77fc2438e58080fb6534e2ada3d3a518') or exists(select 1 from unnest(array['anon','authenticated','service_role','inherit_upload_only'])role_name
   where has_function_privilege(role_name,'private.export_archive_ordinary_account_authority_v1(jsonb,text,uuid)','execute') is distinct from (role_name='service_role' and false))
  or exists(select 1 from pg_catalog.pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a
   where p.oid=pg_catalog.to_regprocedure('private.export_archive_ordinary_account_authority_v1(jsonb,text,uuid)') and (a.grantee not in('postgres'::regrole) or a.privilege_type<>'EXECUTE' or a.grantor<>p.proowner or(a.grantee<>'postgres'::regrole and a.is_grantable))) then
  raise exception using errcode='55000',message='export_readable_graph_predecessor_unavailable';end if;
 if not exists(select 1 from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure('private.export_account_owned_capture_pre_member_frame_v1(jsonb,text,uuid)')
  and p.pronargs=3 and p.proowner='postgres'::regrole and p.prokind='f' and not p.proleakproof and p.provariadic=0::oid and p.probin is null
  and p.prosupport::oid=0::oid and p.procost=100 and p.prorows=(case when p.proretset then 1000 else 0 end) and p.proargmodes is null and p.proallargtypes is null
  and p.prolang=(select oid from pg_catalog.pg_language where lanname='plpgsql')
  and p.prosecdef and not p.proisstrict and p.provolatile='v' and p.proparallel='u' and p.prorettype='jsonb'::regtype and not p.proretset
  and p.proconfig=array['search_path=pg_catalog','lock_timeout=250ms']::text[] and p.proargnames=array['p_origin','p_target_kind','p_target_id']::text[] and p.pronargdefaults=0 and p.proargdefaults is null
  and md5(p.prosrc)='4f7c4ec08895cadaef8af585c92b37ae') or exists(select 1 from unnest(array['anon','authenticated','service_role','inherit_upload_only'])role_name
   where has_function_privilege(role_name,'private.export_account_owned_capture_pre_member_frame_v1(jsonb,text,uuid)','execute') is distinct from (role_name='service_role' and false))
  or exists(select 1 from pg_catalog.pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a
   where p.oid=pg_catalog.to_regprocedure('private.export_account_owned_capture_pre_member_frame_v1(jsonb,text,uuid)') and (a.grantee not in('postgres'::regrole) or a.privilege_type<>'EXECUTE' or a.grantor<>p.proowner or(a.grantee<>'postgres'::regrole and a.is_grantable))) then
  raise exception using errcode='55000',message='export_readable_graph_predecessor_unavailable';end if;
 if not exists(select 1 from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure('private.export_account_owned_capture_pre_classes_v1(jsonb,text,uuid)')
  and p.pronargs=3 and p.proowner='postgres'::regrole and p.prokind='f' and not p.proleakproof and p.provariadic=0::oid and p.probin is null
  and p.prosupport::oid=0::oid and p.procost=100 and p.prorows=(case when p.proretset then 1000 else 0 end) and p.proargmodes is null and p.proallargtypes is null
  and p.prolang=(select oid from pg_catalog.pg_language where lanname='plpgsql')
  and p.prosecdef and not p.proisstrict and p.provolatile='v' and p.proparallel='u' and p.prorettype='jsonb'::regtype and not p.proretset
  and p.proconfig=array['search_path=""','lock_timeout=250ms']::text[] and p.proargnames=array['p_origin','p_target_kind','p_target_id']::text[] and p.pronargdefaults=0 and p.proargdefaults is null
  and md5(p.prosrc)='908e9ca92603692e81fcca9ceecf5afd') or exists(select 1 from unnest(array['anon','authenticated','service_role','inherit_upload_only'])role_name
   where has_function_privilege(role_name,'private.export_account_owned_capture_pre_classes_v1(jsonb,text,uuid)','execute') is distinct from (role_name='service_role' and false))
  or exists(select 1 from pg_catalog.pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a
   where p.oid=pg_catalog.to_regprocedure('private.export_account_owned_capture_pre_classes_v1(jsonb,text,uuid)') and (a.grantee not in('postgres'::regrole) or a.privilege_type<>'EXECUTE' or a.grantor<>p.proowner or(a.grantee<>'postgres'::regrole and a.is_grantable))) then
  raise exception using errcode='55000',message='export_readable_graph_predecessor_unavailable';end if;
 if not exists(select 1 from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure('private.export_account_class_inventory_v1(uuid,jsonb)')
  and p.pronargs=2 and p.proowner='postgres'::regrole and p.prokind='f' and not p.proleakproof and p.provariadic=0::oid and p.probin is null
  and p.prosupport::oid=0::oid and p.procost=100 and p.prorows=(case when p.proretset then 1000 else 0 end) and p.proargmodes is null and p.proallargtypes is null
  and p.prolang=(select oid from pg_catalog.pg_language where lanname='plpgsql')
  and p.prosecdef and not p.proisstrict and p.provolatile='v' and p.proparallel='u' and p.prorettype='jsonb'::regtype and not p.proretset
  and p.proconfig=array['search_path=""','lock_timeout=250ms']::text[] and p.proargnames=array['p_account','p_capture']::text[] and p.pronargdefaults=0 and p.proargdefaults is null
  and md5(p.prosrc)='a4ee4685252291aba11c45d395a5e862') or exists(select 1 from unnest(array['anon','authenticated','service_role','inherit_upload_only'])role_name
   where has_function_privilege(role_name,'private.export_account_class_inventory_v1(uuid,jsonb)','execute') is distinct from (role_name='service_role' and false))
  or exists(select 1 from pg_catalog.pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a
   where p.oid=pg_catalog.to_regprocedure('private.export_account_class_inventory_v1(uuid,jsonb)') and (a.grantee not in('postgres'::regrole) or a.privilege_type<>'EXECUTE' or a.grantor<>p.proowner or(a.grantee<>'postgres'::regrole and a.is_grantable))) then
  raise exception using errcode='55000',message='export_readable_graph_predecessor_unavailable';end if;
 if not exists(select 1 from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure('public.export_archive_account_members_v1(text,uuid,uuid,text,uuid,text)')
  and p.pronargs=6 and p.proowner='postgres'::regrole and p.prokind='f' and not p.proleakproof and p.provariadic=0::oid and p.probin is null
  and p.prosupport::oid=0::oid and p.procost=100 and p.prorows=(case when p.proretset then 1000 else 0 end) and p.proargmodes is null and p.proallargtypes is null
  and p.prolang=(select oid from pg_catalog.pg_language where lanname='plpgsql')
  and p.prosecdef and not p.proisstrict and p.provolatile='v' and p.proparallel='u' and p.prorettype='jsonb'::regtype and not p.proretset
  and p.proconfig=array['search_path=""','extra_float_digits=3']::text[] and p.proargnames=array['p_operation','p_export_id','p_attempt_id','p_authority_receipt','p_subject_id','p_after_id']::text[] and p.pronargdefaults=2 and pg_catalog.pg_get_expr(p.proargdefaults,0)='NULL::uuid, NULL::text'
  and md5(p.prosrc)='36f818dc8b24f0f7ff9ceb431eb7ce46') or exists(select 1 from unnest(array['anon','authenticated','service_role','inherit_upload_only'])role_name
   where has_function_privilege(role_name,'public.export_archive_account_members_v1(text,uuid,uuid,text,uuid,text)','execute') is distinct from (role_name='service_role' and true))
  or exists(select 1 from pg_catalog.pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a
   where p.oid=pg_catalog.to_regprocedure('public.export_archive_account_members_v1(text,uuid,uuid,text,uuid,text)') and (a.grantee not in('postgres'::regrole,'service_role'::regrole) or a.privilege_type<>'EXECUTE' or a.grantor<>p.proowner or(a.grantee<>'postgres'::regrole and a.is_grantable))) then
  raise exception using errcode='55000',message='export_readable_graph_predecessor_unavailable';end if;
 if not exists(select 1 from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure('public.export_archive_account_metadata_v1(text,uuid,uuid,text,uuid)')
  and p.pronargs=5 and p.proowner='postgres'::regrole and p.prokind='f' and not p.proleakproof and p.provariadic=0::oid and p.probin is null
  and p.prosupport::oid=0::oid and p.procost=100 and p.prorows=(case when p.proretset then 1000 else 0 end) and p.proargmodes is null and p.proallargtypes is null
  and p.prolang=(select oid from pg_catalog.pg_language where lanname='plpgsql')
  and p.prosecdef and not p.proisstrict and p.provolatile='v' and p.proparallel='u' and p.prorettype='jsonb'::regtype and not p.proretset
  and p.proconfig=array['search_path=""','lock_timeout=250ms']::text[] and p.proargnames=array['p_operation','p_export_id','p_attempt_id','p_authority_receipt','p_after_id']::text[] and p.pronargdefaults=1 and pg_catalog.pg_get_expr(p.proargdefaults,0)='NULL::uuid'
  and md5(p.prosrc)='a98a2b8a43e494ebb6adc3c0f3ae290b') or exists(select 1 from unnest(array['anon','authenticated','service_role','inherit_upload_only'])role_name
   where has_function_privilege(role_name,'public.export_archive_account_metadata_v1(text,uuid,uuid,text,uuid)','execute') is distinct from (role_name='service_role' and true))
  or exists(select 1 from pg_catalog.pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a
   where p.oid=pg_catalog.to_regprocedure('public.export_archive_account_metadata_v1(text,uuid,uuid,text,uuid)') and (a.grantee not in('postgres'::regrole,'service_role'::regrole) or a.privilege_type<>'EXECUTE' or a.grantor<>p.proowner or(a.grantee<>'postgres'::regrole and a.is_grantable))) then
  raise exception using errcode='55000',message='export_readable_graph_predecessor_unavailable';end if;
 if pg_catalog.to_regprocedure('private.export_account_path_b_snapshot_v1(jsonb,uuid)') is not null then raise exception using errcode='55000',message='export_readable_graph_predecessor_unavailable';end if;
 if pg_catalog.to_regprocedure('private.export_account_ordinary_readable_authority_v1(jsonb,text,uuid)') is not null then raise exception using errcode='55000',message='export_readable_graph_predecessor_unavailable';end if;
 if pg_catalog.to_regprocedure('private.export_account_graph_capture_v1(uuid,jsonb)') is not null then raise exception using errcode='55000',message='export_readable_graph_predecessor_unavailable';end if;
 if pg_catalog.to_regprocedure('public.export_archive_account_graph_rows_v2(uuid,uuid,text,text,jsonb)') is not null then raise exception using errcode='55000',message='export_readable_graph_predecessor_unavailable';end if;
 if pg_catalog.to_regprocedure('public.export_archive_account_path_b_v1(uuid,uuid,text,uuid)') is not null then raise exception using errcode='55000',message='export_readable_graph_predecessor_unavailable';end if;
 if pg_catalog.to_regprocedure('private.export_account_owned_capture_pre_readable_graph_v1(jsonb,text,uuid)') is not null then raise exception using errcode='55000',message='export_readable_graph_predecessor_unavailable';end if;
 if not exists(select 1 from pg_catalog.pg_proc p where p.oid='private.export_account_owned_capture_v1(jsonb,text,uuid)'::regprocedure
  and md5(p.prosrc)='838abdf91899078e4ebd2108855fa477' and p.proconfig=array['search_path=""','lock_timeout=250ms']::text[]
  and p.proowner='postgres'::regrole and p.prosecdef and p.prorettype='jsonb'::regtype and not p.proretset and p.pronargdefaults=0
  and p.prokind='f' and not p.proleakproof and p.provariadic=0::oid and p.probin is null
  and p.prosupport::oid=0::oid and p.procost=100 and p.prorows=(case when p.proretset then 1000 else 0 end) and p.proargmodes is null and p.proallargtypes is null and p.proargdefaults is null
  and p.prolang=(select oid from pg_catalog.pg_language where lanname='plpgsql')
  and not p.proisstrict and p.provolatile='v' and p.proparallel='u'
  and p.proargnames=array['p_origin','p_target_kind','p_target_id']::text[])
  or exists(select 1 from unnest(array['anon','authenticated','service_role','inherit_upload_only'])role_name
   where has_function_privilege(role_name,'private.export_account_owned_capture_v1(jsonb,text,uuid)','execute')) then
  raise exception using errcode='55000',message='export_readable_graph_predecessor_unavailable';end if;

 if not exists(select 1 from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure('public.export_archive_account_graph_rows_v1(uuid,uuid,text,text,jsonb)')
  and p.pronargs=5 and p.proowner='postgres'::regrole and p.prokind='f' and not p.proleakproof and p.provariadic=0::oid and p.probin is null
  and p.prosupport::oid=0::oid and p.procost=100 and p.prorows=(case when p.proretset then 1000 else 0 end) and p.proargmodes is null and p.proallargtypes is null
  and p.prolang=(select oid from pg_catalog.pg_language where lanname='plpgsql') and p.prosecdef and not p.proisstrict
  and p.provolatile='v' and p.proparallel='u' and p.prorettype='jsonb'::regtype and not p.proretset
  and p.proconfig=array['search_path=""','lock_timeout=250ms']::text[] and p.proargnames=array['p_export_id','p_attempt_id','p_authority_receipt','p_kind','p_after_key']::text[] and p.pronargdefaults=1 and pg_catalog.pg_get_expr(p.proargdefaults,0)='NULL::jsonb'
  and md5(p.prosrc)='9093c357b20c31d0f16af9daaa9465d3') or exists(select 1 from unnest(array['anon','authenticated','service_role','inherit_upload_only'])role_name
   where has_function_privilege(role_name,'public.export_archive_account_graph_rows_v1(uuid,uuid,text,text,jsonb)','execute') is distinct from (role_name='service_role' and true))
  or exists(select 1 from pg_catalog.pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a
   where p.oid=pg_catalog.to_regprocedure('public.export_archive_account_graph_rows_v1(uuid,uuid,text,text,jsonb)') and(a.grantee not in('postgres'::regrole,'service_role'::regrole) or a.privilege_type<>'EXECUTE' or a.grantor<>p.proowner
    or(a.grantee='service_role'::regrole and a.is_grantable))) then
  raise exception using errcode='55000',message='export_readable_graph_predecessor_unavailable';end if;
 if not exists(select 1 from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure('private.path_b_report_authority_v1(uuid,uuid,text)')
  and p.pronargs=3 and p.proowner='postgres'::regrole and p.prokind='f' and not p.proleakproof and p.provariadic=0::oid and p.probin is null
  and p.prosupport::oid=0::oid and p.procost=100 and p.prorows=(case when p.proretset then 1000 else 0 end) and p.proargmodes is null and p.proallargtypes is null
  and p.prolang=(select oid from pg_catalog.pg_language where lanname='plpgsql') and p.prosecdef and not p.proisstrict
  and p.provolatile='v' and p.proparallel='u' and p.prorettype='jsonb'::regtype and not p.proretset
  and p.proconfig=array['search_path=""']::text[] and p.proargnames=array['p_file_id','p_grant_id','p_checkpoint']::text[] and p.pronargdefaults=0 and p.proargdefaults is null
  and md5(p.prosrc)='36e5de75cf5a37a46e42c970ea3da4f3') or exists(select 1 from unnest(array['anon','authenticated','service_role','inherit_upload_only'])role_name
   where has_function_privilege(role_name,'private.path_b_report_authority_v1(uuid,uuid,text)','execute') is distinct from (role_name='service_role' and false))
  or exists(select 1 from pg_catalog.pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a
   where p.oid=pg_catalog.to_regprocedure('private.path_b_report_authority_v1(uuid,uuid,text)') and(a.grantee not in('postgres'::regrole) or a.privilege_type<>'EXECUTE' or a.grantor<>p.proowner
    or(a.grantee='service_role'::regrole and a.is_grantable))) then
  raise exception using errcode='55000',message='export_readable_graph_predecessor_unavailable';end if;
 if not exists(select 1 from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure('private.future_person_archive_account_actor_v1(uuid,uuid)')
  and p.pronargs=2 and p.proowner='postgres'::regrole and p.prokind='f' and not p.proleakproof and p.provariadic=0::oid and p.probin is null
  and p.prosupport::oid=0::oid and p.procost=100 and p.prorows=(case when p.proretset then 1000 else 0 end) and p.proargmodes is null and p.proallargtypes is null
  and p.prolang=(select oid from pg_catalog.pg_language where lanname='plpgsql') and p.prosecdef and not p.proisstrict
  and p.provolatile='v' and p.proparallel='u' and p.prorettype='jsonb'::regtype and not p.proretset
  and p.proconfig=array['search_path=pg_catalog','lock_timeout=250ms']::text[] and p.proargnames=array['p_account','p_session']::text[] and p.pronargdefaults=0 and p.proargdefaults is null
  and md5(p.prosrc)='44fbd1551a687600c0458ffc098dd29c') or exists(select 1 from unnest(array['anon','authenticated','service_role','inherit_upload_only'])role_name
   where has_function_privilege(role_name,'private.future_person_archive_account_actor_v1(uuid,uuid)','execute') is distinct from (role_name='service_role' and false))
  or exists(select 1 from pg_catalog.pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a
   where p.oid=pg_catalog.to_regprocedure('private.future_person_archive_account_actor_v1(uuid,uuid)') and(a.grantee not in('postgres'::regrole) or a.privilege_type<>'EXECUTE' or a.grantor<>p.proowner
    or(a.grantee='service_role'::regrole and a.is_grantable))) then
  raise exception using errcode='55000',message='export_readable_graph_predecessor_unavailable';end if;
 if not exists(select 1 from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure('private.export_account_graph_cursor_v1(text,jsonb)')
  and p.pronargs=2 and p.proowner='postgres'::regrole and p.prokind='f' and not p.proleakproof and p.provariadic=0::oid and p.probin is null
  and p.prosupport::oid=0::oid and p.procost=100 and p.prorows=(case when p.proretset then 1000 else 0 end) and p.proargmodes is null and p.proallargtypes is null
  and p.prolang=(select oid from pg_catalog.pg_language where lanname='plpgsql') and p.prosecdef and not p.proisstrict
  and p.provolatile='i' and p.proparallel='u' and p.prorettype='text'::regtype and p.proretset=false
  and p.proconfig=array['search_path=""']::text[] and p.proargnames=array['p_kind','p_key']::text[] and p.pronargdefaults=0 and p.proargdefaults is null
  and md5(p.prosrc)='3cd314a58d759aaafee4ad0c44394cc7') or exists(select 1 from unnest(array['anon','authenticated','service_role','inherit_upload_only'])role_name
   where has_function_privilege(role_name,'private.export_account_graph_cursor_v1(text,jsonb)','execute'))
  or exists(select 1 from pg_catalog.pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a
   where p.oid=pg_catalog.to_regprocedure('private.export_account_graph_cursor_v1(text,jsonb)') and(a.grantee not in('postgres'::regrole) or a.privilege_type<>'EXECUTE' or a.grantor<>p.proowner)) then
  raise exception using errcode='55000',message='export_readable_graph_predecessor_unavailable';end if;
 if not exists(select 1 from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure('private.export_account_graph_projection_v1(uuid,uuid[],text)')
  and p.pronargs=3 and p.proowner='postgres'::regrole and p.prokind='f' and not p.proleakproof and p.provariadic=0::oid and p.probin is null
  and p.prosupport::oid=0::oid and p.procost=100 and p.prorows=(case when p.proretset then 1000 else 0 end) and p.proargmodes=array['i','i','i','t','t']::"char"[] and p.proallargtypes=array['uuid'::regtype,'uuid[]'::regtype,'text'::regtype,'jsonb'::regtype,'jsonb'::regtype]::oid[]
  and p.prolang=(select oid from pg_catalog.pg_language where lanname='plpgsql') and p.prosecdef and not p.proisstrict
  and p.provolatile='v' and p.proparallel='u' and p.prorettype='record'::regtype and p.proretset=true
  and p.proconfig=array['search_path=""','lock_timeout=250ms']::text[] and p.proargnames=array['p_account','p_subjects','p_kind','projected_key','projected_row']::text[] and p.pronargdefaults=0 and p.proargdefaults is null
  and md5(p.prosrc)='3d00c720c63ac71752057e41d6e77c36') or exists(select 1 from unnest(array['anon','authenticated','service_role','inherit_upload_only'])role_name
   where has_function_privilege(role_name,'private.export_account_graph_projection_v1(uuid,uuid[],text)','execute'))
  or exists(select 1 from pg_catalog.pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a
   where p.oid=pg_catalog.to_regprocedure('private.export_account_graph_projection_v1(uuid,uuid[],text)') and(a.grantee not in('postgres'::regrole) or a.privilege_type<>'EXECUTE' or a.grantor<>p.proowner)) then
  raise exception using errcode='55000',message='export_readable_graph_predecessor_unavailable';end if;
 if not exists(select 1 from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure('private.path_b_person_v1(uuid,uuid,uuid)')
  and p.pronargs=3 and p.proowner='postgres'::regrole and p.prokind='f' and not p.proleakproof and p.provariadic=0::oid and p.probin is null
  and p.prosupport::oid=0::oid and p.procost=100 and p.prorows=(case when p.proretset then 1000 else 0 end) and p.proargmodes is null and p.proallargtypes is null
  and p.prolang=(select oid from pg_catalog.pg_language where lanname='plpgsql') and p.prosecdef and not p.proisstrict
  and p.provolatile='v' and p.proparallel='u' and p.prorettype='jsonb'::regtype and p.proretset=false
  and p.proconfig=array['search_path=pg_catalog']::text[] and p.proargnames=array['p_account_id','p_session_id','p_subject_id']::text[] and p.pronargdefaults=0 and p.proargdefaults is null
  and md5(p.prosrc)='875a447d377c70d38798f49f84089328') or exists(select 1 from unnest(array['anon','authenticated','service_role','inherit_upload_only'])role_name
   where has_function_privilege(role_name,'private.path_b_person_v1(uuid,uuid,uuid)','execute'))
  or exists(select 1 from pg_catalog.pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a
   where p.oid=pg_catalog.to_regprocedure('private.path_b_person_v1(uuid,uuid,uuid)') and(a.grantee not in('postgres'::regrole) or a.privilege_type<>'EXECUTE' or a.grantor<>p.proowner)) then
  raise exception using errcode='55000',message='export_readable_graph_predecessor_unavailable';end if;
 if pg_catalog.to_regprocedure('private.export_account_path_b_file_v1(uuid)') is not null then raise exception using errcode='55000',message='export_readable_graph_predecessor_unavailable';end if;
 if not exists(select 1 from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure('private.path_b_subject_v1(uuid,uuid)')
  and p.pronargs=2 and p.proowner='postgres'::regrole and p.prokind='f' and not p.proleakproof and p.provariadic=0::oid and p.probin is null
  and p.prosupport::oid=0::oid and p.procost=100 and p.prorows=0 and p.proargmodes is null and p.proallargtypes is null
  and p.prolang=(select oid from pg_catalog.pg_language where lanname='plpgsql') and p.prosecdef and not p.proisstrict
  and p.provolatile='v' and p.proparallel='u' and p.prorettype='jsonb'::regtype and not p.proretset
  and p.proconfig=array['search_path=pg_catalog, private']::text[] and p.proargnames=array['p_account_id','p_subject_id']::text[]
  and p.pronargdefaults=0 and p.proargdefaults is null and md5(p.prosrc)='0d423a210e1e4972af3d11aed336b1f6')
  or exists(select 1 from unnest(array['anon','authenticated','service_role','inherit_upload_only'])role_name
   where has_function_privilege(role_name,'private.path_b_subject_v1(uuid,uuid)','execute') is distinct from(role_name='service_role'))
  or exists(select 1 from pg_catalog.pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a
   where p.oid=pg_catalog.to_regprocedure('private.path_b_subject_v1(uuid,uuid)') and(a.grantee not in('postgres'::regrole,'service_role'::regrole)
    or a.privilege_type<>'EXECUTE' or a.grantor<>p.proowner or(a.grantee<>'postgres'::regrole and a.is_grantable))) then
  raise exception using errcode='55000',message='export_readable_graph_predecessor_unavailable';end if;
 -- Every new door is created atomically after all exact predecessors match.
 execute $create$
create function private.export_account_path_b_file_v1(p_file uuid)
returns boolean language sql stable security definer set search_path='' set lock_timeout='250ms' as $$
 select exists(select 1 from public.genome_files f join public.subjects s on s.id=f.subject_id
  join public.adult_subject_drafts d on d.subject_id=s.id
  where f.id=p_file and s.subject_class='other_adult' and f.user_id=s.owner_account_id
   and d.adult_flow='path-b-subject-esignature' and d.state='confirmed');
$$
$create$;
 execute 'revoke all on function private.export_account_path_b_file_v1(uuid) from public,anon,authenticated,service_role,inherit_upload_only';

 execute $create$
create function private.export_account_path_b_snapshot_v1(p_origin jsonb,p_subject uuid)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' set extra_float_digits=3 as $$
declare actor jsonb;s public.subjects;b private.path_b_report_bindings;f public.genome_files;a jsonb;
 records jsonb:='[]';row_value jsonb;row_text text;total bigint:=0;held bigint;hash bytea;
begin
 if jsonb_typeof(p_origin) is distinct from 'object' or p_origin->>'kind' is distinct from 'account'
  or (select count(*) from jsonb_object_keys(p_origin))<>3 or not(p_origin ?& array['kind','accountId','sessionId']) then
  raise exception using errcode='42501',message='not_found';end if;
 actor:=private.future_person_archive_account_actor_v1((p_origin->>'accountId')::uuid,(p_origin->>'sessionId')::uuid);
 if actor is null or actor->>'accountId' is distinct from p_origin->>'accountId'
  or actor->>'sessionId' is distinct from p_origin->>'sessionId' then raise exception using errcode='42501',message='not_found';end if;
 select * into s from public.subjects where id=p_subject for share nowait;
 if s.id is null or s.subject_class<>'other_adult' or s.lifecycle<>'active'
  or s.subject_account_id is distinct from (p_origin->>'accountId')::uuid
  or not exists(select 1 from public.adult_subject_drafts d where d.subject_id=s.id
   and d.adult_flow='path-b-subject-esignature' and d.state='confirmed') then
  raise exception using errcode='42501',message='not_found';end if;
 -- A genuine own current person/session/binding is distinct from source ownership.
 perform private.path_b_person_v1((p_origin->>'accountId')::uuid,(p_origin->>'sessionId')::uuid,s.id);
 hash:=extensions.digest(convert_to('account-class-members-v1|path_b_report_bindings','UTF8'),'sha256');
 for b in select * from private.path_b_report_bindings where subject_id=s.id
  and recipient_account_id=(p_origin->>'accountId')::uuid order by id for share nowait loop
  if b.state<>'complete' or b.result is null or b.completed_at is null then
   raise exception using errcode='0A000',message='export_result_projection_unavailable';end if;
  a:=private.path_b_report_authority_v1(b.file_id,b.grant_id,'export-source-read');
  if a is distinct from b.authority or a->>'direction'<>'self'
   or a->>'recipientAccountId' is distinct from p_origin->>'accountId'
   or(a->>'authorityExpiresAt')::timestamptz<=clock_timestamp()
   or jsonb_typeof(b.result) is distinct from 'object' or b.result-array['reports','prsCount','prsCoverage']<>'{}'
   or not(b.result ?& array['reports','prsCount','prsCoverage']) or jsonb_typeof(b.result->'reports') is distinct from 'array'
   or jsonb_typeof(b.result->'prsCoverage') is distinct from 'array'
   or jsonb_typeof(b.result->'prsCount') is distinct from 'number'
   or b.result->>'prsCount'!~'^(0|[1-9][0-9]{0,2})$' then
   raise exception using errcode='42501',message='not_found';end if;
  -- The actual publication contract retains coverage only. Never reconstruct
  -- raw scores, calibrated risk or percentiles from the discarded stage.
  if (b.result->>'prsCount')::integer is distinct from jsonb_array_length(b.result->'prsCoverage')
   or (b.result->>'prsCount')::integer>100 or(b.purpose='reports.monogenic' and(b.result->>'prsCount')::integer<>0)
   or exists(select 1 from jsonb_array_elements(b.result->'prsCoverage')q
    where jsonb_typeof(q) is distinct from 'object' or not(q ?& array['pgs_id','coverage','matched'])
     or q-array['pgs_id','coverage','matched']<>'{}' or jsonb_typeof(q->'pgs_id') is distinct from 'string'
     or length(q->>'pgs_id') not between 1 and 500 or jsonb_typeof(q->'coverage') is distinct from 'number'
     or jsonb_typeof(q->'matched') is distinct from 'number' or q->>'matched'!~'^(0|[1-9][0-9]{0,6})$') then
   raise exception using errcode='42501',message='not_found';end if;
  if exists(select 1 from jsonb_array_elements(b.result->'prsCoverage')q where(q->>'coverage')::numeric not between 0 and 1)
   or(select count(distinct q->>'pgs_id') from jsonb_array_elements(b.result->'prsCoverage')q)
    <>jsonb_array_length(b.result->'prsCoverage') then
   raise exception using errcode='42501',message='not_found';end if;
  select * into f from public.genome_files where id=b.file_id and subject_id=s.id for share nowait;
  if f.id is null or not private.export_account_path_b_file_v1(f.id) then raise exception using errcode='42501',message='not_found';end if;
  -- Only the actual stored result and permitted provenance are exported. Grant,
  -- session, provider-location, uploader and claim identities stay internal.
  row_value:=jsonb_build_object('bindingRevision',b.binding_revision,'fileId',f.id,'subjectId',s.id,
   'purpose',b.purpose,'completedAt',b.completed_at,
   'source',jsonb_build_object('sourceRevision',f.upload_revision,'rawSha256',f.sha256,'decodedSha256',f.source_sha256,
    'normalizedAt',f.normalization_completed_at,'normalizationRevision',f.normalization_source_revision,
    'sourcePublicationRevision',f.source_publication_revision,'variantCount',f.variant_count,'build',f.build,
    'computationRevision',b.computation_revision,'catalogSha256',a->'catalogSha256'),
   'reports',b.result->'reports','prsCount',b.result->'prsCount','prsCoverage',b.result->'prsCoverage');
  row_text:=row_value::text;total:=total+1;
  hash:=extensions.digest(hash||convert_to(b.id::text||':'||s.id::text||':'||row_text||E'\n','UTF8'),'sha256');
  records:=records||jsonb_build_array(jsonb_build_object('id',b.id,'subjectId',s.id,'rowText',row_text));
  if total>9007199254740991 or octet_length(records::text)>4000000 then
   raise exception using errcode='54000',message='export_result_projection_unavailable';end if;
 end loop;
 -- No file with an unproved/partial scientific source is silently omitted.
 if exists(select 1 from public.genome_files gf where gf.subject_id=s.id and private.export_account_path_b_file_v1(gf.id)
  and not exists(select 1 from private.path_b_report_bindings x where x.file_id=gf.id and x.subject_id=s.id
   and x.recipient_account_id=(p_origin->>'accountId')::uuid and x.state='complete')) then
  raise exception using errcode='0A000',message='export_result_projection_unavailable';end if;
 -- These original working objects are explicitly out of subject-export scope;
 -- they do not become retired own uploads, nor grant access to the uploader.
 select count(*) into held from public.other_adult_held_uploads h where h.subject_id=s.id;
 return jsonb_build_object('subjectId',s.id,'records',records,'rows',total,'sha256',encode(hash,'hex'),'excludedHeldUploads',held);
end $$
$create$;
 execute 'revoke all on function private.export_account_path_b_snapshot_v1(jsonb,uuid) from public,anon,authenticated,service_role,inherit_upload_only';

 execute $create$
create function private.export_account_ordinary_readable_authority_v1(p_origin jsonb,p_target_kind text,p_target_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare a uuid; sess uuid; p public.profiles%rowtype; ap public.subject_principals%rowtype;
 origin_binding text; receipt text; graph jsonb; subjects jsonb:='[]'; sources jsonb:='[]';
 s record; f record; snapshot jsonb; binding jsonb; person jsonb; confirmation jsonb;
 session_revision bigint; file_ids uuid[]:='{}';
begin
 if p_origin is null or jsonb_typeof(p_origin)<>'object' then raise exception using errcode='22023',message='invalid_request'; end if;
 if p_origin->>'kind' is distinct from 'account' then
  raise exception using errcode='0A000',message='export_origin_projection_unavailable'; end if;
 if (select count(*) from jsonb_object_keys(p_origin))<>3 or not(p_origin ?& array['kind','accountId','sessionId'])
  or p_target_kind is null or p_target_kind not in ('account','subject') or p_target_id is null then
  raise exception using errcode='22023',message='invalid_request'; end if;
 a:=(p_origin->>'accountId')::uuid; sess:=(p_origin->>'sessionId')::uuid;
 perform private.own_export_source_v1(a,sess,null);
 select * into p from public.profiles where id=a;
 select coalesce(refresh_token_counter,0)+1 into session_revision from auth.sessions where id=sess and user_id=a;
 select sp.* into ap from public.subject_account_bindings b join public.subjects subj on subj.id=b.subject_id
  join public.subject_principals sp on sp.id=b.account_principal_id
  join public.subject_principals subject_p on subject_p.id=b.subject_principal_id
  where b.account_id=a and b.status='current' and subj.subject_class='self' and subj.subject_account_id=a
   and subj.lifecycle in ('active','restricted') and sp.account_id=a and sp.status='active' and sp.principal_kind='account_subject'
   and subject_p.account_id=a and subject_p.subject_id=subj.id and subject_p.status='active' and subject_p.principal_kind='account_subject';
 if ap.id is null then raise exception using errcode='42501',message='not_found'; end if;
 if p_target_kind='account' then
  if p_target_id<>a then raise exception using errcode='42501',message='not_found'; end if;
  if exists(select 1 from public.subjects where owner_account_id=a and lifecycle<>'purged'
    and (subject_account_id is distinct from a or subject_class not in ('self','other_adult')))
   or exists(select 1 from public.subjects where subject_account_id=a and lifecycle<>'purged'
    and subject_class not in ('self','other_adult'))
   or exists(select 1 from public.embryo_cohorts c where c.status<>'purged' and (c.owner_account_id=a or exists(
    select 1 from public.embryo_participant_sets ps join public.subject_principals sp on sp.id=ps.principal_id
     where ps.cohort_id=c.id and sp.account_id=a and ps.revoked_at is null)))
   or exists(select 1 from public.family_pairs pair join public.subjects subj on subj.id in (pair.subject_a_id,pair.subject_b_id)
    where pair.status<>'purged' and (subj.owner_account_id=a or subj.subject_account_id=a))
   or exists(select 1 from public.directional_grants d join public.purpose_grants g using(grant_id)
    join public.subject_principals recipient on recipient.id=d.recipient_principal_id
    where (d.recipient_account_id=a or recipient.account_id=a) and d.status='current' and g.revoked_at is null
      and (g.expires_at is null or g.expires_at>clock_timestamp()) and (g.target_kind<>'subject' or not exists(
       select 1 from public.subjects subj where subj.id=g.target_id and subj.subject_account_id=a and subj.subject_class in ('self','other_adult')))) then
   raise exception using errcode='0A000',message='export_partition_projection_unavailable';
  end if;
 end if;
 for s in select * from public.subjects where subject_account_id=a and lifecycle<>'purged'
  and (p_target_kind='account' or id=p_target_id) order by id for share loop
  if s.subject_class not in ('self','other_adult') or s.lifecycle not in ('active','restricted') then
   raise exception using errcode='0A000',message='export_partition_projection_unavailable'; end if;
  if exists(select 1 from public.genome_files gf where gf.subject_id=s.id
    and private.export_account_path_b_file_v1(gf.id)) then
   -- The actual Path B producer binds its one confirmation principal directly,
   -- not through an ordinary subject_account_bindings row. Both genuine current
   -- receipts and all governing rows enter the capture; no binding is invented.
   person:=private.path_b_person_v1(a,sess,s.id);
   confirmation:=private.path_b_subject_v1(s.owner_account_id,s.id);
   if person is null or confirmation is null or person->>'subjectId' is distinct from s.id::text
    or (person->>'subjectBindingRevision')::bigint is distinct from s.subject_binding_revision
    or person->>'principalId' is distinct from confirmation->>'principalId'
    or person->>'principalRevision' is distinct from confirmation->>'principalRevision'
    or (confirmation->>'subjectBindingRevision')::bigint is distinct from s.subject_binding_revision
    or (confirmation->>'subjectLifecycleRevision')::bigint is distinct from s.lifecycle_revision then
    raise exception using errcode='42501',message='not_found';end if;
   select jsonb_build_object('kind','path-b-confirmation-v1','person',person,'confirmation',confirmation,
    'draft',to_jsonb(d),'subjectPrincipal',to_jsonb(sp),'signature',to_jsonb(cs),
    'artifact',to_jsonb(ca),'contact',to_jsonb(e)) into binding
   from public.adult_subject_drafts d join public.subject_principals sp on sp.id=(person->>'principalId')::uuid
    join public.consent_signatures cs on cs.id=(confirmation->>'confirmationSignatureId')::uuid
    join public.consent_artifacts ca on ca.artifact_key=cs.artifact_key and ca.version=cs.artifact_version
    join public.encrypted_contact_references e on e.id=(confirmation->>'contactReferenceId')::uuid
   where d.subject_id=s.id and d.owner_account_id=s.owner_account_id and d.state='confirmed'
    and d.adult_flow='path-b-subject-esignature' and d.evidence_kind='esignature'
    and sp.subject_id=s.id and sp.account_id=a and sp.principal_kind='account_subject' and sp.status='active'
    and sp.principal_revision=(person->>'principalRevision')::bigint
    and cs.target_kind='subject' and cs.target_id=s.id and cs.signer_principal_id=sp.id and cs.signer_account_id=a
    and cs.purpose='adult-subject-path-b-confirmation' and cs.subject_binding_revision=s.subject_binding_revision
    and cs.jurisdiction_revision=p.jurisdiction_revision
    and ca.artifact_key='consent.subject-adult-esignature' and ca.body_sha256=cs.artifact_body_sha256
    and ca.superseded_at is null and ca.published_at<=clock_timestamp()
    and ca.effective_on<=timezone('UTC',clock_timestamp())::date
    and ca.body_sha256=encode(extensions.digest(convert_to(ca.body_markdown,'UTF8'),'sha256'),'hex')
    and e.principal_id=sp.id and e.status='current' and e.contact_ciphertext is not null
    and e.authority_revision=sp.principal_revision;
  else
  select jsonb_build_object('binding',to_jsonb(b),'subjectPrincipal',to_jsonb(sp),'accountPrincipal',to_jsonb(ac)) into binding
   from public.subject_account_bindings b join public.subject_principals sp on sp.id=b.subject_principal_id
    join public.subject_principals ac on ac.id=b.account_principal_id
   where b.subject_id=s.id and b.account_id=a and b.status='current' and sp.subject_id=s.id and sp.account_id=a
    and sp.status='active' and sp.principal_kind='account_subject' and ac.account_id=a and ac.status='active'
    and ac.principal_kind='account_subject';
  end if;
  if binding is null then raise exception using errcode='42501',message='not_found'; end if;
  subjects:=subjects||jsonb_build_array(jsonb_build_object('subject',to_jsonb(s),'binding',binding));
  -- Enumerate every file: the content list's exclusion filter must not silently
  -- omit an uploading, mismatched or otherwise unavailable member.
  for f in select id from public.genome_files where subject_id=s.id
   and not private.export_account_path_b_file_v1(id) order by id loop
   snapshot:=private.own_export_source_v1(a,sess,f.id);
   if snapshot is null then raise exception using errcode='55000',message='export_source_unavailable'; end if;
   sources:=sources||jsonb_build_array(snapshot); file_ids:=array_append(file_ids,f.id);
  end loop;
 end loop;
 if jsonb_array_length(subjects)=0 then raise exception using errcode='42501',message='not_found'; end if;
 origin_binding:=encode(extensions.digest(jsonb_build_object('origin',p_origin,'accountRevision',p.account_revision,
  'authSessionRevision',p.auth_session_revision,'sessionRevision',session_revision,
  'jurisdictionRevision',p.jurisdiction_revision,'principal',to_jsonb(ap))::text,'sha256'),'hex');
 graph:=jsonb_build_object('version','export-authority-v4','originBinding',origin_binding,'targetKind',p_target_kind,
  'targetId',p_target_id,'profile',to_jsonb(p),'subjects',subjects,'sources',sources,
  'principalGraphRevision',(select greatest(coalesce(max(principal_revision),1),1) from public.subject_principals where account_id=a),
  'grants',(select coalesce(jsonb_agg(jsonb_build_object('grant',to_jsonb(g),'signature',to_jsonb(sig),
    'artifact',to_jsonb(artifact),'live',g.revoked_at is null and (g.expires_at is null or g.expires_at>clock_timestamp())) order by g.grant_id),'[]')
    from public.purpose_grants g join public.consent_signatures sig on sig.id=g.signature_id
     join public.consent_artifacts artifact on artifact.artifact_key=g.artifact_key and artifact.version=g.artifact_version
    where g.target_kind='subject' and g.target_id in(select (x#>>'{subject,id}')::uuid from jsonb_array_elements(subjects)x)),
  'consents',(select coalesce(jsonb_agg(jsonb_build_object('consent',to_jsonb(c),
    'live',c.revoked_at is null and (c.expires_at is null or c.expires_at>clock_timestamp())) order by c.id),'[]') from public.subject_consents c
    where c.subject_id in(select (x#>>'{subject,id}')::uuid from jsonb_array_elements(subjects)x)),
  -- v2: the requester's own history, whole rows, so any change after capture
  -- (a new or revoked legacy consent, a principal, binding, consent or
  -- recipient-grant revision, a demographics edit, a new signature or
  -- attestation) fails the job rather than
  -- being exported against a receipt that no longer describes it.
  'history',jsonb_build_object(
   'legacyConsents',case when p_target_kind='account' then (select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]')
     from public.consent_grants c where c.user_id=a) else '[]'::jsonb end,
   'principals',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.subject_principals x
     where x.account_id=a and (p_target_kind='account' or x.subject_id=p_target_id)),
   'bindings',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.subject_account_bindings x
     where x.account_id=a and (p_target_kind='account' or x.subject_id=p_target_id)),
   'accountConsents',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.subject_consents x
     where x.account_id=a and (p_target_kind='account' or x.subject_id=p_target_id)),
   'recipientGrants',case when p_target_kind='account' then (select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]')
     from public.provider_recipient_grants x where x.account_id=a) else '[]'::jsonb end,
   'demographics',(select coalesce(jsonb_agg(to_jsonb(x) order by x.subject_id),'[]') from public.subject_demographics x
     where x.subject_id in(select (y#>>'{subject,id}')::uuid from jsonb_array_elements(subjects)y)),
   'signatures',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.consent_signatures x
     where x.signer_account_id=a and (p_target_kind='account' or (x.target_kind='subject' and x.target_id=p_target_id))),
   'attestations',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.attestations x
     where (x.principal_id in(select id from public.subject_principals where account_id=a)
       or x.signature_id in(select id from public.consent_signatures where signer_account_id=a))
      and (p_target_kind='account' or (x.target_kind='subject' and x.target_id=p_target_id))),
   -- v3: every own chat on a captured subject, with a digest of all its
   -- messages, so a new or changed message after capture fails the job.
   'chats',(select coalesce(jsonb_agg(jsonb_build_object('chat',to_jsonb(ch),'messages',encode(extensions.digest(
      coalesce((select jsonb_agg(to_jsonb(m) order by m.turn_ordinal,m.role,m.id) from public.chat_messages m
       where m.chat_id=ch.id),'[]'::jsonb)::text,'sha256'),'hex')) order by ch.id),'[]')
     from public.chats ch where ch.user_id=a
      and ch.subject_id in(select (y#>>'{subject,id}')::uuid from jsonb_array_elements(subjects)y)),
   -- v4: the legal audit events this account caused itself, whole rows, so an
   -- event it causes after capture fails the job. Account exports only: an
   -- event records no subject, so no subject export can select its own.
   'legalAudit',case when p_target_kind='account' then (select coalesce(jsonb_agg(to_jsonb(l) order by l.seq),'[]')
     from public.legal_audit_log l join private.legal_audit_account_principals m on m.audit_principal_id=l.audit_principal_id
     where m.account_id=a) else '[]'::jsonb end),
  'analysis',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]') from private.own_analysis_runs r where r.file_id=any(file_ids)));
 receipt:=encode(extensions.digest(graph::text,'sha256'),'hex');
 -- Capture returns only closed metadata and a digest. The digest also hashes
 -- stored analysis content internally; no raw variants or source bytes return.
 -- The archive producer must still prove complete authorized membership.
 return jsonb_build_object('principalId',ap.id,'principalHash',encode(extensions.digest(ap.id::text,'sha256'),'hex'),
  'originBinding',origin_binding,'authorityReceipt',receipt,'accountRevision',p.account_revision,
  'lifecycleRevision',case when p_target_kind='account' then p.account_revision else
   (select lifecycle_revision from public.subjects where id=p_target_id) end,
  'principalGraphRevision',(select greatest(coalesce(max(principal_revision),1),1) from public.subject_principals where account_id=a),
  'subjectPartitions',(select jsonb_agg(x#>'{subject,id}') from jsonb_array_elements(subjects)x),
  'fileCount',cardinality(file_ids));
end $$
$create$;
 execute 'revoke all on function private.export_account_ordinary_readable_authority_v1(jsonb,text,uuid) from public,anon,authenticated,service_role,inherit_upload_only';

 definition:=pg_catalog.pg_get_functiondef('private.export_account_owned_capture_pre_member_frame_v1(jsonb,text,uuid)'::regprocedure);
 old_body:=$old_base$
declare a uuid;s record;current_part jsonb;base jsonb;parts jsonb:='[]';ids jsonb:='[]';
 frame jsonb;files bigint:=0;receipt text;
begin
 if jsonb_typeof(p_origin) is distinct from 'object' or p_origin->>'kind' is distinct from 'account'
  or (select count(*) from jsonb_object_keys(p_origin))<>3 or not(p_origin ?& array['kind','accountId','sessionId'])
  or p_target_kind not in('account','subject') or p_target_kind is null or p_target_id is null then
  raise exception using errcode='42501',message='not_found';end if;
 a:=(p_origin->>'accountId')::uuid;
 if p_target_kind='account' then
  if p_target_id<>a then raise exception using errcode='42501',message='not_found';end if;
  if exists(select 1 from public.subjects where owner_account_id=a and lifecycle<>'purged'
    and (subject_account_id is distinct from a or (subject_class not in ('self','other_adult')
      and not(subject_class='embryo' and lifecycle='claimed_bound' and owner_account_id=a))))
   or exists(select 1 from public.subjects where subject_account_id=a and lifecycle<>'purged'
    and subject_class not in ('self','other_adult')
    and not(subject_class='embryo' and lifecycle='claimed_bound' and owner_account_id=a))
   or exists(select 1 from public.embryo_cohorts c where c.status<>'purged' and (c.owner_account_id=a or exists(
    select 1 from public.embryo_participant_sets ps join public.subject_principals sp on sp.id=ps.principal_id
     where ps.cohort_id=c.id and sp.account_id=a and ps.revoked_at is null)))
   or exists(select 1 from public.family_pairs pair join public.subjects subj on subj.id in (pair.subject_a_id,pair.subject_b_id)
    where pair.status<>'purged' and (subj.owner_account_id=a or subj.subject_account_id=a))
   or exists(select 1 from public.directional_grants d join public.purpose_grants g using(grant_id)
    join public.subject_principals recipient on recipient.id=d.recipient_principal_id
    where (d.recipient_account_id=a or recipient.account_id=a) and d.status='current' and g.revoked_at is null
      and (g.expires_at is null or g.expires_at>clock_timestamp()) and (g.target_kind<>'subject' or not exists(
       select 1 from public.subjects subj where subj.id=g.target_id and subj.subject_account_id=a and (subj.subject_class in ('self','other_adult') or (subj.subject_class='embryo' and subj.lifecycle='claimed_bound' and subj.owner_account_id=a))))) then
   raise exception using errcode='0A000',message='export_partition_projection_unavailable';
  end if;

 end if;
 for s in select * from public.subjects where subject_account_id=a and lifecycle<>'purged'
  and (p_target_kind='account' or id=p_target_id) order by id for share loop
  if s.subject_class in('self','other_adult') then
   current_part:=private.export_archive_ordinary_account_authority_v1(p_origin,'subject',s.id);
   parts:=parts||jsonb_build_array(jsonb_build_object('subjectId',s.id,'class','ordinary','capture',current_part));
   files:=files+(current_part->>'fileCount')::bigint;
   if s.subject_class='self' and base is null then base:=current_part;end if;
  elsif s.subject_class='embryo' and s.lifecycle='claimed_bound' and s.owner_account_id=a then
   current_part:=private.future_person_bound_export_snapshot_v1(p_origin,s.id);
   parts:=parts||jsonb_build_array(jsonb_build_object('subjectId',s.id,'class','claimed-bound','capture',current_part));
   files:=files+1;
  else raise exception using errcode='0A000',message='export_partition_projection_unavailable';end if;
  ids:=ids||jsonb_build_array(s.id);
 end loop;
 if jsonb_array_length(parts)=0 then raise exception using errcode='42501',message='not_found';end if;
 -- A genuine current self account principal remains the account origin anchor.
 if base is null then
  select subj.id into s from public.subjects subj where subj.subject_account_id=a and subj.subject_class='self'
   and subj.lifecycle in('active','restricted') order by subj.id limit 1;
  if s.id is null then raise exception using errcode='42501',message='not_found';end if;
  base:=private.export_archive_ordinary_account_authority_v1(p_origin,'subject',s.id);
 end if;
 frame:=jsonb_build_object('version','owned-account-archive-v1','origin',p_origin,'targetKind',p_target_kind,
  'targetId',p_target_id,'partitions',parts,
  'legacyConsents',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from public.consent_grants c where c.user_id=a),
  'providerRecipients',(select coalesce(jsonb_agg(to_jsonb(g) order by g.id),'[]') from public.provider_recipient_grants g where g.account_id=a),
  'principals',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') from public.subject_principals p where p.account_id=a),
  'bindings',(select coalesce(jsonb_agg(to_jsonb(b) order by b.id),'[]') from public.subject_account_bindings b where b.account_id=a),
  'consents',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from public.subject_consents c where c.account_id=a),
  'signatures',(select coalesce(jsonb_agg(to_jsonb(sig) order by sig.id),'[]') from public.consent_signatures sig where sig.signer_account_id=a),
  'attestations',(select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') from public.attestations t
    where t.principal_id in(select id from public.subject_principals where account_id=a)
     or t.signature_id in(select id from public.consent_signatures where signer_account_id=a)),
  'legalAudit',(select coalesce(jsonb_agg(to_jsonb(l) order by l.seq),'[]') from public.legal_audit_log l
    join private.legal_audit_account_principals m on m.audit_principal_id=l.audit_principal_id where m.account_id=a));
 receipt:=encode(extensions.digest(frame::text,'sha256'),'hex');
 return jsonb_build_object('authority',base||jsonb_build_object('authorityReceipt',receipt,'subjectPartitions',ids,'fileCount',files),
  'partitions',parts);
end $old_base$;
 new_body:=$new_base$
declare a uuid;s record;current_part jsonb;base jsonb;parts jsonb:='[]';ids jsonb:='[]';
 frame jsonb;files bigint:=0;receipt text;
begin
 if jsonb_typeof(p_origin) is distinct from 'object' or p_origin->>'kind' is distinct from 'account'
  or (select count(*) from jsonb_object_keys(p_origin))<>3 or not(p_origin ?& array['kind','accountId','sessionId'])
  or p_target_kind not in('account','subject') or p_target_kind is null or p_target_id is null then
  raise exception using errcode='42501',message='not_found';end if;
 a:=(p_origin->>'accountId')::uuid;
 if p_target_kind='account' then
  if p_target_id<>a then raise exception using errcode='42501',message='not_found';end if;
  if exists(select 1 from public.subjects where owner_account_id=a and lifecycle<>'purged'
    and (subject_account_id is distinct from a or (subject_class not in ('self','other_adult')
      and not(subject_class='embryo' and lifecycle='claimed_bound' and owner_account_id=a))))
   or exists(select 1 from public.subjects where subject_account_id=a and lifecycle<>'purged'
    and subject_class not in ('self','other_adult')
    and not(subject_class='embryo' and lifecycle='claimed_bound' and owner_account_id=a))
   or exists(select 1 from public.embryo_cohorts c where c.status<>'purged' and (c.owner_account_id=a or exists(
    select 1 from public.embryo_participant_sets ps join public.subject_principals sp on sp.id=ps.principal_id
     where ps.cohort_id=c.id and sp.account_id=a and ps.revoked_at is null)))
   or exists(select 1 from public.directional_grants d join public.purpose_grants g using(grant_id)
    join public.subject_principals recipient on recipient.id=d.recipient_principal_id
    where (d.recipient_account_id=a or recipient.account_id=a) and d.status='current' and g.revoked_at is null
      and (g.expires_at is null or g.expires_at>clock_timestamp()) and (g.target_kind<>'subject' or not exists(
       select 1 from public.subjects subj where subj.id=g.target_id and subj.subject_account_id=a and (subj.subject_class in ('self','other_adult') or (subj.subject_class='embryo' and subj.lifecycle='claimed_bound' and subj.owner_account_id=a))))) then
   raise exception using errcode='0A000',message='export_partition_projection_unavailable';
  end if;

 end if;
 for s in select * from public.subjects where subject_account_id=a and lifecycle<>'purged'
  and (p_target_kind='account' or id=p_target_id) order by id for share loop
  if s.subject_class in('self','other_adult') then
   current_part:=case when p_target_kind='account' and exists(select 1 from public.genome_files gf
    where gf.subject_id=s.id and private.export_account_path_b_file_v1(gf.id))
    then private.export_account_ordinary_readable_authority_v1(p_origin,'subject',s.id)
    else private.export_archive_ordinary_account_authority_v1(p_origin,'subject',s.id) end;
   parts:=parts||jsonb_build_array(jsonb_build_object('subjectId',s.id,'class','ordinary','capture',current_part));
   files:=files+(current_part->>'fileCount')::bigint;
   if s.subject_class='self' and base is null then base:=current_part;end if;
  elsif s.subject_class='embryo' and s.lifecycle='claimed_bound' and s.owner_account_id=a then
   current_part:=private.future_person_bound_export_snapshot_v1(p_origin,s.id);
   parts:=parts||jsonb_build_array(jsonb_build_object('subjectId',s.id,'class','claimed-bound','capture',current_part));
   files:=files+1;
  else raise exception using errcode='0A000',message='export_partition_projection_unavailable';end if;
  ids:=ids||jsonb_build_array(s.id);
 end loop;
 if jsonb_array_length(parts)=0 then raise exception using errcode='42501',message='not_found';end if;
 -- A genuine current self account principal remains the account origin anchor.
 if base is null then
  select subj.id into s from public.subjects subj where subj.subject_account_id=a and subj.subject_class='self'
   and subj.lifecycle in('active','restricted') order by subj.id limit 1;
  if s.id is null then raise exception using errcode='42501',message='not_found';end if;
  base:=private.export_archive_ordinary_account_authority_v1(p_origin,'subject',s.id);
 end if;
 frame:=jsonb_build_object('version','owned-account-archive-v1','origin',p_origin,'targetKind',p_target_kind,
  'targetId',p_target_id,'partitions',parts,
  'legacyConsents',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from public.consent_grants c where c.user_id=a),
  'providerRecipients',(select coalesce(jsonb_agg(to_jsonb(g) order by g.id),'[]') from public.provider_recipient_grants g where g.account_id=a),
  'principals',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') from public.subject_principals p where p.account_id=a),
  'bindings',(select coalesce(jsonb_agg(to_jsonb(b) order by b.id),'[]') from public.subject_account_bindings b where b.account_id=a),
  'consents',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from public.subject_consents c where c.account_id=a),
  'signatures',(select coalesce(jsonb_agg(to_jsonb(sig) order by sig.id),'[]') from public.consent_signatures sig where sig.signer_account_id=a),
  'attestations',(select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') from public.attestations t
    where t.principal_id in(select id from public.subject_principals where account_id=a)
     or t.signature_id in(select id from public.consent_signatures where signer_account_id=a)),
  'legalAudit',(select coalesce(jsonb_agg(to_jsonb(l) order by l.seq),'[]') from public.legal_audit_log l
    join private.legal_audit_account_principals m on m.audit_principal_id=l.audit_principal_id where m.account_id=a));
 receipt:=encode(extensions.digest(frame::text,'sha256'),'hex');
 return jsonb_build_object('authority',base||jsonb_build_object('authorityReceipt',receipt,'subjectPartitions',ids,'fileCount',files),
  'partitions',parts);
end $new_base$;
 if (length(definition)-length(replace(definition,old_body,'')))/length(old_body)<>1 then
  raise exception using errcode='55000',message='export_readable_graph_predecessor_unavailable';end if;
 execute replace(definition,old_body,new_body);

 definition:=pg_catalog.pg_get_functiondef('private.export_account_owned_capture_pre_classes_v1(jsonb,text,uuid)'::regprocedure);
 old_body:=$old_original$
declare captured jsonb;item record;source jsonb;frames jsonb:='[]';receipt text;
begin
 captured:=private.export_account_owned_capture_pre_original_v1(p_origin,p_target_kind,p_target_id);
 if p_target_kind<>'account' then return captured;end if;
 for item in select gf.id from public.genome_files gf where exists(select 1 from jsonb_array_elements(captured->'partitions')x
  where x->>'class'='ordinary' and x->>'subjectId'=gf.subject_id::text) order by gf.id loop
  source:=private.own_export_source_v1((p_origin->>'accountId')::uuid,(p_origin->>'sessionId')::uuid,item.id);
  if source is null then raise exception using errcode='42501',message='not_found';end if;
  frames:=frames||jsonb_build_array(private.export_account_original_frame_v1(item.id,source ? 'preparedSource'));
 end loop;
 receipt:=encode(extensions.digest(jsonb_build_object('version','account-original-frame-v1',
  'capture',captured,'originalFrames',frames)::text,'sha256'),'hex');
 return jsonb_set(captured,'{authority,authorityReceipt}',to_jsonb(receipt))||jsonb_build_object('originalFrames',frames);
end $old_original$;
 new_body:=$new_original$
declare captured jsonb;item record;source jsonb;frames jsonb:='[]';receipt text;
begin
 captured:=private.export_account_owned_capture_pre_original_v1(p_origin,p_target_kind,p_target_id);
 if p_target_kind<>'account' then return captured;end if;
 for item in select gf.id from public.genome_files gf where exists(select 1 from jsonb_array_elements(captured->'partitions')x
  where x->>'class'='ordinary' and x->>'subjectId'=gf.subject_id::text)
  and not private.export_account_path_b_file_v1(gf.id) order by gf.id loop
  source:=private.own_export_source_v1((p_origin->>'accountId')::uuid,(p_origin->>'sessionId')::uuid,item.id);
  if source is null then raise exception using errcode='42501',message='not_found';end if;
  frames:=frames||jsonb_build_array(private.export_account_original_frame_v1(item.id,source ? 'preparedSource'));
 end loop;
 receipt:=encode(extensions.digest(jsonb_build_object('version','account-original-frame-v1',
  'capture',captured,'originalFrames',frames)::text,'sha256'),'hex');
 return jsonb_set(captured,'{authority,authorityReceipt}',to_jsonb(receipt))||jsonb_build_object('originalFrames',frames);
end $new_original$;
 if (length(definition)-length(replace(definition,old_body,'')))/length(old_body)<>1 then
  raise exception using errcode='55000',message='export_readable_graph_predecessor_unavailable';end if;
 execute replace(definition,old_body,new_body);

 definition:=pg_catalog.pg_get_functiondef('public.export_archive_account_members_v1(text,uuid,uuid,text,uuid,text)'::regprocedure);
 old_body:=$old_members$
declare permit jsonb;capture jsonb;c jsonb;result jsonb;member jsonb;actor uuid[];
 source uuid;embryo uuid;page jsonb;n integer;after_id uuid;last_id uuid;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception using errcode='42501',message='not_found';end if;
 if p_operation is null or p_operation not in('context','ordinary-files','bound-context','agreements','quality','scores','figures','reports','variants','legal-audit')
  or (p_operation='context' and (p_subject_id is not null or p_after_id is not null))
  or (p_operation='ordinary-files' and p_subject_id is not null)
  or (p_operation not in('context','ordinary-files') and p_subject_id is null)
  or (p_operation not in('scores','figures','reports','variants','legal-audit','ordinary-files') and p_after_id is not null) then
  raise exception using errcode='22023',message='invalid_request';end if;
 if p_after_id is not null and p_operation not in('variants','legal-audit') then after_id:=p_after_id::uuid;end if;
 permit:=private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt);
 capture:=private.export_account_owned_capture_v1(permit->'origin',permit->>'targetKind',(permit->>'targetId')::uuid);
 if capture#>'{authority,subjectPartitions}' is distinct from permit->'partitions' then
  raise exception using errcode='42501',message='not_found';end if;
 if p_operation='context' then
  result:=jsonb_build_object('version','account-archive-members-v1','targetKind',permit->'targetKind','targetId',permit->'targetId',
   'authorityReceipt',p_authority_receipt,'deadline',permit->'deadline','capturedAt',permit->'capturedAt',
   'actor',jsonb_build_object('accountId',permit#>'{origin,accountId}','sessionId',permit#>'{origin,sessionId}'),'fileCount',capture#>'{authority,fileCount}',
   'partitions',(select jsonb_agg(jsonb_build_object('subjectId',x->'subjectId','class',x->'class',
     'fileCount',case when x->>'class'='claimed-bound' then '1'::jsonb else x#>'{capture,fileCount}' end,
     'fileIds',(select coalesce(jsonb_agg(gf.id order by gf.id),'[]') from public.genome_files gf where gf.subject_id=(x->>'subjectId')::uuid)) order by x->>'subjectId')
    from jsonb_array_elements(capture->'partitions')x));
 elsif p_operation='ordinary-files' then
  result:='[]'::jsonb;
  for source in select gf.id from public.genome_files gf
   where (p_after_id is null or gf.id>after_id) and exists(select 1 from jsonb_array_elements(capture->'partitions')x
     where x->>'class'='ordinary' and gf.subject_id=(x->>'subjectId')::uuid) order by gf.id limit 100 loop
   c:=private.own_export_source_v1((permit#>>'{origin,accountId}')::uuid,(permit#>>'{origin,sessionId}')::uuid,source);
   if c is null then raise exception using errcode='55000',message='export_source_unavailable';end if;
   result:=result||jsonb_build_array(c);
  end loop;
 else
  select x into member from jsonb_array_elements(capture->'partitions')x
   where x->>'subjectId'=p_subject_id::text and x->>'class'='claimed-bound';
  if member is null or not(permit->'partitions' ? p_subject_id::text) then raise exception using errcode='42501',message='not_found';end if;
  c:=jsonb_set(member->'capture','{authority,authorityReceipt}',to_jsonb(p_authority_receipt));
  source:=(c#>>'{source,fileId}')::uuid;
  select embryo_id into embryo from private.embryo_canonical_sources where file_id=source;
  if p_operation='bound-context' then result:=c;
  elsif p_operation='agreements' then select agreement_slice into result from private.future_person_custody_slices where subject_id=p_subject_id;
  elsif p_operation='quality' then select coalesce(jsonb_agg(to_jsonb(q)-'embryo_id'),'[]') into result from public.embryo_qc q where q.embryo_id=embryo;
  elsif p_operation in('variants','legal-audit') then
   if p_after_id is not null and (p_after_id!~'^[1-9][0-9]{0,18}$' or p_after_id::numeric>9223372036854775807) then
    raise exception using errcode='22023',message='invalid_request';end if;
   if p_operation='variants' then
    select jsonb_build_object('rows',coalesce(jsonb_agg(v.row order by v.id),'[]'),'count',count(*),'nextAfterId',max(v.id)::text)
     into result from (select id,jsonb_build_object('id',id::text,'chromosome',chromosome,'position',position,
      'referenceAllele',reference_allele,'alternateAllele',alternate_allele,'genotype',genotype) row
      from public.embryo_variants where source_file_id=source and (p_after_id is null or id>p_after_id::bigint) order by id limit 500)v;
   else
    select array[b.audit_principal_id,custody.audit_principal_id] into actor from private.future_person_account_bindings b
     join private.future_person_custody_slices custody on custody.subject_id=b.subject_id where b.subject_id=p_subject_id;
    select jsonb_build_object('rows',coalesce(jsonb_agg(v.row order by v.seq),'[]'),'count',count(*),'nextAfterId',max(v.seq)::text)
     into result from (select l.seq,jsonb_build_object('id',l.seq::text,'event',jsonb_build_object('seq',l.seq,'occurred_at',l.occurred_at,
      'event_code',l.event_code,'route_id',l.route_id,'outcome_code',l.outcome_code,'coded_context',l.coded_context)) row
      from public.legal_audit_log l where l.audit_principal_id=any(actor) and (p_after_id is null or l.seq>p_after_id::bigint) order by l.seq limit 500)v;
   end if;
  else
   if p_operation='scores' then
    select coalesce(jsonb_agg(x.row order by x.id),'[]'),count(*),max(x.id::text)::uuid into page,n,last_id from (
     select score.id,to_jsonb(score)-'embryo_id' row from public.embryo_scores score where score.embryo_id=embryo
      and (after_id is null or score.id>after_id) order by score.id limit 500)x;
   elsif p_operation='figures' then
    select coalesce(jsonb_agg(x.row order by x.id),'[]'),count(*),max(x.id::text)::uuid into page,n,last_id from (
     select fig.id,to_jsonb(fig)||jsonb_build_object('findingRecord',to_jsonb(score)-'embryo_id') row
      from public.embryo_figures fig join public.embryo_scores score on score.id=fig.finding_id
      where score.embryo_id=embryo and (after_id is null or fig.id>after_id) order by fig.id limit 500)x;
   else
    select coalesce(jsonb_agg(x.row order by x.id),'[]'),count(*),max(x.id::text)::uuid into page,n,last_id from (
     select report.id,(to_jsonb(report)-'subject_id'-'cohort_id')||jsonb_build_object('embryoId',embryo) row
      from public.report_artifacts report where report.subject_id=p_subject_id
      and (after_id is null or report.id>after_id) order by report.id limit 500)x;
   end if;
   result:=jsonb_build_object('rows',page,'nextAfterId',last_id,'count',n);
  end if;
 end if;
 if octet_length(result::text)>4000000 then raise exception using errcode='55000',message='export_source_unavailable';end if;
 if private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt) is distinct from permit
  or private.export_account_owned_capture_v1(permit->'origin',permit->>'targetKind',(permit->>'targetId')::uuid) is distinct from capture then
  raise exception using errcode='42501',message='not_found';end if;
 return result;
end $old_members$;
 new_body:=$new_members$
declare permit jsonb;capture jsonb;c jsonb;result jsonb;member jsonb;actor uuid[];
 source uuid;embryo uuid;page jsonb;n integer;after_id uuid;last_id uuid;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception using errcode='42501',message='not_found';end if;
 if p_operation is null or p_operation not in('context','ordinary-files','bound-context','agreements','quality','scores','figures','reports','variants','legal-audit')
  or (p_operation='context' and (p_subject_id is not null or p_after_id is not null))
  or (p_operation='ordinary-files' and p_subject_id is not null)
  or (p_operation not in('context','ordinary-files') and p_subject_id is null)
  or (p_operation not in('scores','figures','reports','variants','legal-audit','ordinary-files') and p_after_id is not null) then
  raise exception using errcode='22023',message='invalid_request';end if;
 if p_after_id is not null and p_operation not in('variants','legal-audit') then after_id:=p_after_id::uuid;end if;
 permit:=private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt);
 capture:=private.export_account_owned_capture_v1(permit->'origin',permit->>'targetKind',(permit->>'targetId')::uuid);
 if capture#>'{authority,subjectPartitions}' is distinct from permit->'partitions' then
  raise exception using errcode='42501',message='not_found';end if;
 if p_operation='context' then
  result:=jsonb_build_object('version','account-archive-members-v1','targetKind',permit->'targetKind','targetId',permit->'targetId',
   'authorityReceipt',p_authority_receipt,'deadline',permit->'deadline','capturedAt',permit->'capturedAt',
   'actor',jsonb_build_object('accountId',permit#>'{origin,accountId}','sessionId',permit#>'{origin,sessionId}'),'fileCount',capture#>'{authority,fileCount}',
   'partitions',(select jsonb_agg(jsonb_build_object('subjectId',x->'subjectId','class',x->'class',
     'fileCount',case when x->>'class'='claimed-bound' then '1'::jsonb else x#>'{capture,fileCount}' end,
     'fileIds',(select coalesce(jsonb_agg(gf.id order by gf.id),'[]') from public.genome_files gf where gf.subject_id=(x->>'subjectId')::uuid
       and(x->>'class'='claimed-bound' or not private.export_account_path_b_file_v1(gf.id)))) order by x->>'subjectId')
    from jsonb_array_elements(capture->'partitions')x));
 elsif p_operation='ordinary-files' then
  result:='[]'::jsonb;
  for source in select gf.id from public.genome_files gf
   where (p_after_id is null or gf.id>after_id) and not private.export_account_path_b_file_v1(gf.id) and exists(select 1 from jsonb_array_elements(capture->'partitions')x
     where x->>'class'='ordinary' and gf.subject_id=(x->>'subjectId')::uuid) order by gf.id limit 100 loop
   c:=private.own_export_source_v1((permit#>>'{origin,accountId}')::uuid,(permit#>>'{origin,sessionId}')::uuid,source);
   if c is null then raise exception using errcode='55000',message='export_source_unavailable';end if;
   result:=result||jsonb_build_array(c);
  end loop;
 else
  select x into member from jsonb_array_elements(capture->'partitions')x
   where x->>'subjectId'=p_subject_id::text and x->>'class'='claimed-bound';
  if member is null or not(permit->'partitions' ? p_subject_id::text) then raise exception using errcode='42501',message='not_found';end if;
  c:=jsonb_set(member->'capture','{authority,authorityReceipt}',to_jsonb(p_authority_receipt));
  source:=(c#>>'{source,fileId}')::uuid;
  select embryo_id into embryo from private.embryo_canonical_sources where file_id=source;
  if p_operation='bound-context' then result:=c;
  elsif p_operation='agreements' then select agreement_slice into result from private.future_person_custody_slices where subject_id=p_subject_id;
  elsif p_operation='quality' then select coalesce(jsonb_agg(to_jsonb(q)-'embryo_id'),'[]') into result from public.embryo_qc q where q.embryo_id=embryo;
  elsif p_operation in('variants','legal-audit') then
   if p_after_id is not null and (p_after_id!~'^[1-9][0-9]{0,18}$' or p_after_id::numeric>9223372036854775807) then
    raise exception using errcode='22023',message='invalid_request';end if;
   if p_operation='variants' then
    select jsonb_build_object('rows',coalesce(jsonb_agg(v.row order by v.id),'[]'),'count',count(*),'nextAfterId',max(v.id)::text)
     into result from (select id,jsonb_build_object('id',id::text,'chromosome',chromosome,'position',position,
      'referenceAllele',reference_allele,'alternateAllele',alternate_allele,'genotype',genotype) row
      from public.embryo_variants where source_file_id=source and (p_after_id is null or id>p_after_id::bigint) order by id limit 500)v;
   else
    select array[b.audit_principal_id,custody.audit_principal_id] into actor from private.future_person_account_bindings b
     join private.future_person_custody_slices custody on custody.subject_id=b.subject_id where b.subject_id=p_subject_id;
    select jsonb_build_object('rows',coalesce(jsonb_agg(v.row order by v.seq),'[]'),'count',count(*),'nextAfterId',max(v.seq)::text)
     into result from (select l.seq,jsonb_build_object('id',l.seq::text,'event',jsonb_build_object('seq',l.seq,'occurred_at',l.occurred_at,
      'event_code',l.event_code,'route_id',l.route_id,'outcome_code',l.outcome_code,'coded_context',l.coded_context)) row
      from public.legal_audit_log l where l.audit_principal_id=any(actor) and (p_after_id is null or l.seq>p_after_id::bigint) order by l.seq limit 500)v;
   end if;
  else
   if p_operation='scores' then
    select coalesce(jsonb_agg(x.row order by x.id),'[]'),count(*),max(x.id::text)::uuid into page,n,last_id from (
     select score.id,to_jsonb(score)-'embryo_id' row from public.embryo_scores score where score.embryo_id=embryo
      and (after_id is null or score.id>after_id) order by score.id limit 500)x;
   elsif p_operation='figures' then
    select coalesce(jsonb_agg(x.row order by x.id),'[]'),count(*),max(x.id::text)::uuid into page,n,last_id from (
     select fig.id,to_jsonb(fig)||jsonb_build_object('findingRecord',to_jsonb(score)-'embryo_id') row
      from public.embryo_figures fig join public.embryo_scores score on score.id=fig.finding_id
      where score.embryo_id=embryo and (after_id is null or fig.id>after_id) order by fig.id limit 500)x;
   else
    select coalesce(jsonb_agg(x.row order by x.id),'[]'),count(*),max(x.id::text)::uuid into page,n,last_id from (
     select report.id,(to_jsonb(report)-'subject_id'-'cohort_id')||jsonb_build_object('embryoId',embryo) row
      from public.report_artifacts report where report.subject_id=p_subject_id
      and (after_id is null or report.id>after_id) order by report.id limit 500)x;
   end if;
   result:=jsonb_build_object('rows',page,'nextAfterId',last_id,'count',n);
  end if;
 end if;
 if octet_length(result::text)>4000000 then raise exception using errcode='55000',message='export_source_unavailable';end if;
 if private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt) is distinct from permit
  or private.export_account_owned_capture_v1(permit->'origin',permit->>'targetKind',(permit->>'targetId')::uuid) is distinct from capture then
  raise exception using errcode='42501',message='not_found';end if;
 return result;
end $new_members$;
 if (length(definition)-length(replace(definition,old_body,'')))/length(old_body)<>1 then
  raise exception using errcode='55000',message='export_readable_graph_predecessor_unavailable';end if;
 execute replace(definition,old_body,new_body);

 definition:=pg_catalog.pg_get_functiondef('public.export_archive_account_metadata_v1(text,uuid,uuid,text,uuid)'::regprocedure);
 old_body:=$old_metadata$
declare permit jsonb;capture jsonb;result jsonb;subjects uuid[];account uuid;page jsonb;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception using errcode='42501',message='not_found';end if;
 if p_operation is null or p_operation not in('context','profile','purpose-grants','legacy-counts')
  or (p_operation in('context','profile') and p_after_id is not null) then
  raise exception using errcode='22023',message='invalid_request';end if;
 permit:=private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt);
 if permit->>'targetKind' is distinct from 'account' then raise exception using errcode='42501',message='not_found';end if;
 capture:=private.export_account_owned_capture_v1(permit->'origin','account',(permit->>'targetId')::uuid);
 if capture#>'{authority,subjectPartitions}' is distinct from permit->'partitions' then
  raise exception using errcode='42501',message='not_found';end if;
 account:=(permit#>>'{origin,accountId}')::uuid;
 select array_agg(x::uuid order by x) into subjects from jsonb_array_elements_text(permit->'partitions')x;
 if p_operation='context' then
  page:=jsonb_build_array(jsonb_build_object('profileCount',(select count(*) from public.profiles where id=account),
   'purposeGrantCount',(select count(*) from public.purpose_grants g join public.consent_signatures s on s.id=g.signature_id
    where s.signer_account_id=account and g.target_kind='subject' and g.target_id=any(subjects)),
   'fileCount',(select count(*) from public.genome_files f join public.subjects s on s.id=f.subject_id
    where s.id=any(subjects) and s.subject_class in('self','other_adult'))));
 elsif p_operation='profile' then
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'date_of_birth',date_of_birth,'jurisdiction_code',jurisdiction_code,
   'jurisdiction_subdivision',jurisdiction_subdivision,'jurisdiction_revision',jurisdiction_revision,
   'jurisdiction_declared_at',jurisdiction_declared_at,'jurisdiction_attestation_version',jurisdiction_attestation_version,
   'jurisdiction_attestation_sha256',jurisdiction_attestation_sha256)),'[]') into page from public.profiles where id=account;
 elsif p_operation='purpose-grants' then
  select coalesce(jsonb_agg(x.row order by x.id),'[]') into page from(
   select g.grant_id id,jsonb_build_object('grant_id',g.grant_id,'grant_revision',g.grant_revision,'target_kind',g.target_kind,
    'target_id',g.target_id,'purpose',g.purpose,'artifact_key',g.artifact_key,'artifact_version',g.artifact_version,
    'artifact_body_sha256',g.artifact_body_sha256,'signature_id',g.signature_id,'signer_principal_id',g.signer_principal_id,
    'data_subject_principal_id',g.data_subject_principal_id,'subject_binding_revision',g.subject_binding_revision,
    'jurisdiction_code',g.jurisdiction_code,'jurisdiction_revision',g.jurisdiction_revision,'granted_at',g.granted_at,
    'expires_at',g.expires_at,'revoked_at',g.revoked_at,'revocation_reason',g.revocation_reason)row
   from public.purpose_grants g join public.consent_signatures s on s.id=g.signature_id
   where s.signer_account_id=account and g.target_kind='subject' and g.target_id=any(subjects)
    and (p_after_id is null or g.grant_id>p_after_id) order by g.grant_id limit 500)x;
 else
  select coalesce(jsonb_agg(x.row order by x.id),'[]') into page from(
   select f.id,jsonb_build_object('fileId',f.id,'subjectId',f.subject_id,'revision',f.export_content_revision,
    'variantCount',(select count(*) from public.user_variants v where v.file_id=f.id),
    'observedCallCount',(select count(*) from public.report_observed_calls o where o.file_id=f.id))row
   from public.genome_files f join public.subjects s on s.id=f.subject_id
   where s.id=any(subjects) and s.subject_class in('self','other_adult') and (p_after_id is null or f.id>p_after_id)
    order by f.id limit 100)x;
 end if;
 result:=jsonb_build_object('version','account-archive-metadata-v1','operation',p_operation,'rows',page);
 if private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt) is distinct from permit
  or private.export_account_owned_capture_v1(permit->'origin','account',(permit->>'targetId')::uuid) is distinct from capture then
  raise exception using errcode='42501',message='not_found';end if;
 return result;
end $old_metadata$;
 new_body:=$new_metadata$
declare permit jsonb;capture jsonb;result jsonb;subjects uuid[];account uuid;page jsonb;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception using errcode='42501',message='not_found';end if;
 if p_operation is null or p_operation not in('context','profile','purpose-grants','legacy-counts')
  or (p_operation in('context','profile') and p_after_id is not null) then
  raise exception using errcode='22023',message='invalid_request';end if;
 permit:=private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt);
 if permit->>'targetKind' is distinct from 'account' then raise exception using errcode='42501',message='not_found';end if;
 capture:=private.export_account_owned_capture_v1(permit->'origin','account',(permit->>'targetId')::uuid);
 if capture#>'{authority,subjectPartitions}' is distinct from permit->'partitions' then
  raise exception using errcode='42501',message='not_found';end if;
 account:=(permit#>>'{origin,accountId}')::uuid;
 select array_agg(x::uuid order by x) into subjects from jsonb_array_elements_text(permit->'partitions')x;
 if p_operation='context' then
  page:=jsonb_build_array(jsonb_build_object('profileCount',(select count(*) from public.profiles where id=account),
   'purposeGrantCount',(select count(*) from public.purpose_grants g join public.consent_signatures s on s.id=g.signature_id
    where s.signer_account_id=account and g.target_kind='subject' and g.target_id=any(subjects)),
   'fileCount',(select count(*) from public.genome_files f join public.subjects s on s.id=f.subject_id
    where s.id=any(subjects) and s.subject_class in('self','other_adult') and not private.export_account_path_b_file_v1(f.id))));
 elsif p_operation='profile' then
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'date_of_birth',date_of_birth,'jurisdiction_code',jurisdiction_code,
   'jurisdiction_subdivision',jurisdiction_subdivision,'jurisdiction_revision',jurisdiction_revision,
   'jurisdiction_declared_at',jurisdiction_declared_at,'jurisdiction_attestation_version',jurisdiction_attestation_version,
   'jurisdiction_attestation_sha256',jurisdiction_attestation_sha256)),'[]') into page from public.profiles where id=account;
 elsif p_operation='purpose-grants' then
  select coalesce(jsonb_agg(x.row order by x.id),'[]') into page from(
   select g.grant_id id,jsonb_build_object('grant_id',g.grant_id,'grant_revision',g.grant_revision,'target_kind',g.target_kind,
    'target_id',g.target_id,'purpose',g.purpose,'artifact_key',g.artifact_key,'artifact_version',g.artifact_version,
    'artifact_body_sha256',g.artifact_body_sha256,'signature_id',g.signature_id,'signer_principal_id',g.signer_principal_id,
    'data_subject_principal_id',g.data_subject_principal_id,'subject_binding_revision',g.subject_binding_revision,
    'jurisdiction_code',g.jurisdiction_code,'jurisdiction_revision',g.jurisdiction_revision,'granted_at',g.granted_at,
    'expires_at',g.expires_at,'revoked_at',g.revoked_at,'revocation_reason',g.revocation_reason)row
   from public.purpose_grants g join public.consent_signatures s on s.id=g.signature_id
   where s.signer_account_id=account and g.target_kind='subject' and g.target_id=any(subjects)
    and (p_after_id is null or g.grant_id>p_after_id) order by g.grant_id limit 500)x;
 else
  select coalesce(jsonb_agg(x.row order by x.id),'[]') into page from(
   select f.id,jsonb_build_object('fileId',f.id,'subjectId',f.subject_id,'revision',f.export_content_revision,
    'variantCount',(select count(*) from public.user_variants v where v.file_id=f.id),
    'observedCallCount',(select count(*) from public.report_observed_calls o where o.file_id=f.id))row
   from public.genome_files f join public.subjects s on s.id=f.subject_id
   where s.id=any(subjects) and s.subject_class in('self','other_adult') and not private.export_account_path_b_file_v1(f.id) and (p_after_id is null or f.id>p_after_id)
    order by f.id limit 100)x;
 end if;
 result:=jsonb_build_object('version','account-archive-metadata-v1','operation',p_operation,'rows',page);
 if private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt) is distinct from permit
  or private.export_account_owned_capture_v1(permit->'origin','account',(permit->>'targetId')::uuid) is distinct from capture then
  raise exception using errcode='42501',message='not_found';end if;
 return result;
end $new_metadata$;
 if (length(definition)-length(replace(definition,old_body,'')))/length(old_body)<>1 then
  raise exception using errcode='55000',message='export_readable_graph_predecessor_unavailable';end if;
 execute replace(definition,old_body,new_body);

 execute $create$
create function private.export_account_graph_capture_v1(p_account uuid,p_capture jsonb)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare subjects uuid[];anchor uuid;kind text;item record;identity text;digest bytea;n bigint;inventory jsonb:='[]';
begin
 select array_agg(x::uuid order by x) into subjects from jsonb_array_elements_text(p_capture#>'{authority,subjectPartitions}')x;
 select s.id into anchor from public.subjects s where s.id=any(subjects) and s.subject_class='self'
  and s.subject_account_id=p_account and s.lifecycle in('active','restricted') for share nowait;
 if anchor is null then raise exception using errcode='42501',message='not_found';end if;
 -- This release has no complete parent-cohort scientific partition. Physical
 -- foreign/revoked cohort membership never becomes a read grant. The original
 -- non-purged cohort refusal remains; retained cohort science is refused too.
 if exists(select 1 from public.embryos e join public.embryo_cohorts c on c.id=e.cohort_id
  where c.owner_account_id=p_account or exists(select 1 from public.embryo_participant_sets ps
   join public.subject_principals sp on sp.id=ps.principal_id where ps.cohort_id=c.id and sp.account_id=p_account)) then
  raise exception using errcode='0A000',message='export_partition_projection_unavailable';end if;
 foreach kind in array array['embryo_cohorts','embryo_basis_bindings','embryo_participant_sets','embryo_donor_attributions',
  'embryo_disposition_proposals','embryo_disposition_confirmations','family_pairs'] loop
  digest:=extensions.digest(convert_to('account-graph-routed-v2|'||kind,'UTF8'),'sha256');n:=0;
  for item in select * from private.export_account_graph_projection_v1(p_account,subjects,kind)
   order by (projected_key->>0) collate "C",coalesce(projected_key->>1,'') collate "C",
    coalesce(projected_key->>2,'') collate "C",coalesce((projected_key->>3)::bigint,0) loop
   identity:=private.export_account_graph_cursor_v1(kind,item.projected_key);
   if octet_length(item.projected_row::text)>8192 then raise exception using errcode='55000',message='export_class_projection_unavailable';end if;
   n:=n+1;if n>9007199254740991 then raise exception using errcode='55000',message='export_class_projection_unavailable';end if;
   digest:=extensions.digest(digest||convert_to(identity||':'||anchor::text||':requester-account-history:'||item.projected_row::text||E'\n','UTF8'),'sha256');
  end loop;
  inventory:=inventory||jsonb_build_array(jsonb_build_object('kind',kind,'rows',n,'membershipSha256',encode(digest,'hex'),
   'partitions',case when n=0 then '[]'::jsonb else jsonb_build_array(jsonb_build_object('subjectId',anchor,'rows',n)) end));
 end loop;
 return jsonb_build_object('anchorSubjectId',anchor,'inventory',inventory,
  'pairSourceFrame',(select coalesce(jsonb_agg(to_jsonb(fp) order by fp.id),'[]') from public.family_pairs fp
   where fp.subject_a_id=any(subjects) or fp.subject_b_id=any(subjects)));
end $$
$create$;
 execute 'revoke all on function private.export_account_graph_capture_v1(uuid,jsonb) from public,anon,authenticated,service_role,inherit_upload_only';
 -- Preserve the complete014/021/024/026 frame, then capture every exact saved
 -- PathB recipient result and all seven named metadata classes before029.
 execute 'alter function private.export_account_owned_capture_pre_classes_v1(jsonb,text,uuid) rename to export_account_owned_capture_pre_readable_graph_v1';
 execute $create$
create function private.export_account_owned_capture_pre_classes_v1(p_origin jsonb,p_target_kind text,p_target_id uuid)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare captured jsonb;result_sources jsonb:='[]';s record;graph jsonb;receipt text;
begin
 captured:=private.export_account_owned_capture_pre_readable_graph_v1(p_origin,p_target_kind,p_target_id);
 if p_target_kind<>'account' then return captured;end if;
 for s in select sub.id from public.subjects sub where sub.subject_account_id=(p_origin->>'accountId')::uuid
  and sub.lifecycle<>'purged' and sub.subject_class='other_adult' and exists(select 1 from public.genome_files gf
   where gf.subject_id=sub.id and private.export_account_path_b_file_v1(gf.id)) order by sub.id loop
  result_sources:=result_sources||jsonb_build_array(private.export_account_path_b_snapshot_v1(p_origin,s.id));
  if octet_length(result_sources::text)>4000000 then raise exception using errcode='54000',message='export_result_projection_unavailable';end if;
 end loop;
 graph:=private.export_account_graph_capture_v1((p_origin->>'accountId')::uuid,captured);
 receipt:=encode(extensions.digest(jsonb_build_object('version','account-readable-graph-capture-v1',
  'capture',captured,'graph',graph,'pathBResults',result_sources)::text,'sha256'),'hex');
 return jsonb_set(captured,'{authority,authorityReceipt}',to_jsonb(receipt))||jsonb_build_object('readableGraph',graph,'pathBResults',result_sources);
end $$
$create$;
 execute 'revoke all on function private.export_account_owned_capture_pre_classes_v1(jsonb,text,uuid), private.export_account_owned_capture_pre_readable_graph_v1(jsonb,text,uuid) from public,anon,authenticated,service_role,inherit_upload_only';

 definition:=pg_catalog.pg_get_functiondef('private.export_account_class_inventory_v1(uuid,jsonb)'::regprocedure);
 old_body:=$old_classes$
declare subjects uuid[];cohorts uuid[];kind text;handling text;item record;n bigint;digest bytea;counts jsonb;out jsonb:='[]';
 scientific_frame jsonb;ordinary uuid[];
begin
 select array_agg(x::uuid order by x) into subjects from jsonb_array_elements_text(p_capture#>'{authority,subjectPartitions}')x;
 select array_agg((x->>'subjectId')::uuid order by x->>'subjectId') into ordinary from jsonb_array_elements(p_capture->'partitions')x
  where x->>'class'='ordinary';
 select array_agg(id order by id) into cohorts from(select c.id from public.embryo_cohorts c where c.owner_account_id=p_account
  union select s.cohort_id from public.embryo_participant_sets s join public.subject_principals p on p.id=s.principal_id where p.account_id=p_account)x;
 scientific_frame:=(select coalesce(jsonb_agg(x->'capture' order by x->>'subjectId'),'[]') from jsonb_array_elements(p_capture->'partitions')x
  where x->>'class'='claimed-bound');
 foreach kind in array array['ancestry_regions','appeal_intakes','attestation_contradictions','correction_requests','directional_grants',
  'embryo_basis_bindings','embryo_cohorts','embryo_disposition_confirmations','embryo_disposition_proposals','embryo_donor_attributions',
  'embryo_figures','embryo_participant_sets','embryo_qc','embryo_scores','embryo_variants','embryos','family_pairs','family_sharing_pauses',
  'family_sharing_stops','future_person_claim_objections','future_person_claimant_principals','future_person_claims','portrait_results',
  'report_artifacts','subject_control_refusal_authorities','subject_relationships','suppressions','other_adult_held_uploads','path_b_report_bindings'] loop
  n:=0;counts:='[]';digest:=extensions.digest(convert_to('account-class-members-v1|'||kind,'UTF8'),'sha256');
  if kind in('attestation_contradictions','directional_grants','family_sharing_pauses','family_sharing_stops','future_person_claim_objections',
   'future_person_claimant_principals','future_person_claims','subject_control_refusal_authorities','subject_relationships','suppressions') then
   handling:='metadata';
   for item in select * from private.export_account_class_projection_v1(p_account,subjects,kind) loop
    if octet_length(item.projected_row::text)>8192 then raise exception using errcode='55000',message='export_class_projection_unavailable';end if;
    n:=n+1;digest:=extensions.digest(digest||convert_to(item.projected_id::text||':'||coalesce(item.projected_subject::text,'')||':'||item.projected_row::text||E'\n','UTF8'),'sha256');
   end loop;
   select coalesce(jsonb_agg(jsonb_build_object('subjectId',x.subject,'rows',x.n) order by x.subject),'[]') into counts from(
    select projected_subject subject,count(*) n from private.export_account_class_projection_v1(p_account,subjects,kind)
    where projected_subject is not null group by projected_subject)x;
  elsif kind in('embryo_figures','embryo_qc','embryo_scores','embryo_variants','embryos','report_artifacts') then
   handling:='claimed-bound';
   -- Original bound capture already independently validates full source,
   -- immutable calls and exact complete QC/finding/figure/report membership.
   -- Parent-cohort files and ordinary arbitrary artifact payloads are refused.
   if exists(select 1 from public.embryos e where e.subject_id=any(ordinary))
    or (kind='report_artifacts' and exists(select 1 from public.report_artifacts r where r.subject_id=any(ordinary) or r.cohort_id=any(cohorts))) then
    raise exception using errcode='0A000',message='export_class_projection_unavailable';end if;
   for item in select x->>'subjectId' subject,x->'capture' snapshot from jsonb_array_elements(p_capture->'partitions')x where x->>'class'='claimed-bound' loop
    n:=case kind when 'embryos' then 1 when 'embryo_qc' then (item.snapshot#>>'{membership,qualityReports}')::bigint
     when 'embryo_scores' then (item.snapshot#>>'{membership,scores}')::bigint when 'embryo_figures' then (item.snapshot#>>'{membership,figures}')::bigint
     when 'embryo_variants' then (item.snapshot#>>'{membership,variants}')::bigint when 'report_artifacts' then (item.snapshot#>>'{membership,reports}')::bigint end;
    if n>0 then counts:=counts||jsonb_build_array(jsonb_build_object('subjectId',item.subject,'rows',n));end if;
   end loop;
   select coalesce(sum((x->>'rows')::bigint),0) into n from jsonb_array_elements(counts)x;
   digest:=extensions.digest(convert_to('account-class-members-v1|'||kind||'|'||scientific_frame::text,'UTF8'),'sha256');
  else
   handling:='unsupported';
   case kind
    when 'ancestry_regions' then select count(*) into n from public.ancestry_regions where subject_id=any(subjects);
    when 'appeal_intakes' then select count(*) into n from public.appeal_intakes where appellant_account_id=p_account or appellant_principal_id in(select id from public.subject_principals where account_id=p_account);
    when 'correction_requests' then select count(*) into n from public.correction_requests where subject_id=any(subjects) or claimant_principal_id in(select id from public.subject_principals where account_id=p_account);
    when 'embryo_basis_bindings' then select count(*) into n from public.embryo_basis_bindings where cohort_id=any(cohorts);
    when 'embryo_cohorts' then n:=coalesce(cardinality(cohorts),0);
    when 'embryo_disposition_confirmations' then select count(*) into n from public.embryo_disposition_confirmations c join public.embryo_disposition_proposals p on p.id=c.proposal_id join public.embryos e on e.id=p.embryo_id where e.cohort_id=any(cohorts) or c.confirmer_principal_id in(select id from public.subject_principals where account_id=p_account);
    when 'embryo_disposition_proposals' then select count(*) into n from public.embryo_disposition_proposals p join public.embryos e on e.id=p.embryo_id where e.cohort_id=any(cohorts) or p.proposer_principal_id in(select id from public.subject_principals where account_id=p_account);
    when 'embryo_donor_attributions' then select count(*) into n from public.embryo_donor_attributions where cohort_id=any(cohorts) or donor_principal_id in(select id from public.subject_principals where account_id=p_account);
    when 'embryo_participant_sets' then select count(*) into n from public.embryo_participant_sets where cohort_id=any(cohorts) or principal_id in(select id from public.subject_principals where account_id=p_account);
    when 'family_pairs' then select count(*) into n from public.family_pairs where subject_a_id=any(subjects) or subject_b_id=any(subjects);
    when 'portrait_results' then select count(*) into n from public.portrait_results where owner_account_id=p_account or parent_a_subject_id=any(subjects) or parent_b_subject_id=any(subjects);
    when 'other_adult_held_uploads' then select count(*) into n from public.other_adult_held_uploads where uploader_account_id=p_account or subject_id=any(subjects);
    when 'path_b_report_bindings' then select count(*) into n from private.path_b_report_bindings where recipient_account_id=p_account or subject_id=any(subjects);
    else raise exception using errcode='22023',message='invalid_request';
   end case;
   if n<>0 then raise exception using errcode='0A000',message='export_class_projection_unavailable';end if;
  end if;
  if n is null or n<0 or n>9007199254740991 then raise exception using errcode='55000',message='export_class_projection_unavailable';end if;
  out:=out||jsonb_build_array(jsonb_build_object('kind',kind,'mode',handling,'rows',n,'membershipSha256',encode(digest,'hex'),'partitions',counts));
 end loop;
 return out;
end $old_classes$;
 new_body:=$new_classes$
declare subjects uuid[];cohorts uuid[];kind text;handling text;item record;n bigint;digest bytea;counts jsonb;out jsonb:='[]';
 scientific_frame jsonb;ordinary uuid[];
begin
 select array_agg(x::uuid order by x) into subjects from jsonb_array_elements_text(p_capture#>'{authority,subjectPartitions}')x;
 select array_agg((x->>'subjectId')::uuid order by x->>'subjectId') into ordinary from jsonb_array_elements(p_capture->'partitions')x
  where x->>'class'='ordinary';
 select array_agg(id order by id) into cohorts from(select c.id from public.embryo_cohorts c where c.owner_account_id=p_account
  union select s.cohort_id from public.embryo_participant_sets s join public.subject_principals p on p.id=s.principal_id where p.account_id=p_account)x;
 scientific_frame:=(select coalesce(jsonb_agg(x->'capture' order by x->>'subjectId'),'[]') from jsonb_array_elements(p_capture->'partitions')x
  where x->>'class'='claimed-bound');
 foreach kind in array array['ancestry_regions','appeal_intakes','attestation_contradictions','correction_requests','directional_grants',
  'embryo_basis_bindings','embryo_cohorts','embryo_disposition_confirmations','embryo_disposition_proposals','embryo_donor_attributions',
  'embryo_figures','embryo_participant_sets','embryo_qc','embryo_scores','embryo_variants','embryos','family_pairs','family_sharing_pauses',
  'family_sharing_stops','future_person_claim_objections','future_person_claimant_principals','future_person_claims','portrait_results',
  'report_artifacts','subject_control_refusal_authorities','subject_relationships','suppressions','other_adult_held_uploads','path_b_report_bindings'] loop
  n:=0;counts:='[]';digest:=extensions.digest(convert_to('account-class-members-v1|'||kind,'UTF8'),'sha256');
  if kind in('attestation_contradictions','directional_grants','family_sharing_pauses','family_sharing_stops','future_person_claim_objections',
   'future_person_claimant_principals','future_person_claims','subject_control_refusal_authorities','subject_relationships','suppressions') then
   handling:='metadata';
   for item in select * from private.export_account_class_projection_v1(p_account,subjects,kind) loop
    if octet_length(item.projected_row::text)>8192 then raise exception using errcode='55000',message='export_class_projection_unavailable';end if;
    n:=n+1;digest:=extensions.digest(digest||convert_to(item.projected_id::text||':'||coalesce(item.projected_subject::text,'')||':'||item.projected_row::text||E'\n','UTF8'),'sha256');
   end loop;
   select coalesce(jsonb_agg(jsonb_build_object('subjectId',x.subject,'rows',x.n) order by x.subject),'[]') into counts from(
    select projected_subject subject,count(*) n from private.export_account_class_projection_v1(p_account,subjects,kind)
    where projected_subject is not null group by projected_subject)x;
  elsif kind in('embryo_figures','embryo_qc','embryo_scores','embryo_variants','embryos','report_artifacts') then
   handling:='claimed-bound';
   -- Original bound capture already independently validates full source,
   -- immutable calls and exact complete QC/finding/figure/report membership.
   -- Parent-cohort files and ordinary arbitrary artifact payloads are refused.
   if exists(select 1 from public.embryos e where e.subject_id=any(ordinary))
    or (kind='report_artifacts' and exists(select 1 from public.report_artifacts r where r.subject_id=any(ordinary) or r.cohort_id=any(cohorts))) then
    raise exception using errcode='0A000',message='export_class_projection_unavailable';end if;
   for item in select x->>'subjectId' subject,x->'capture' snapshot from jsonb_array_elements(p_capture->'partitions')x where x->>'class'='claimed-bound' loop
    n:=case kind when 'embryos' then 1 when 'embryo_qc' then (item.snapshot#>>'{membership,qualityReports}')::bigint
     when 'embryo_scores' then (item.snapshot#>>'{membership,scores}')::bigint when 'embryo_figures' then (item.snapshot#>>'{membership,figures}')::bigint
     when 'embryo_variants' then (item.snapshot#>>'{membership,variants}')::bigint when 'report_artifacts' then (item.snapshot#>>'{membership,reports}')::bigint end;
    if n>0 then counts:=counts||jsonb_build_array(jsonb_build_object('subjectId',item.subject,'rows',n));end if;
   end loop;
   select coalesce(sum((x->>'rows')::bigint),0) into n from jsonb_array_elements(counts)x;
   digest:=extensions.digest(convert_to('account-class-members-v1|'||kind||'|'||scientific_frame::text,'UTF8'),'sha256');
  elsif kind in('embryo_basis_bindings','embryo_cohorts','embryo_disposition_confirmations','embryo_disposition_proposals',
   'embryo_donor_attributions','embryo_participant_sets','family_pairs') then
   handling:='graph';
   select (x->>'rows')::bigint,decode(x->>'membershipSha256','hex'),x->'partitions' into n,digest,counts
    from jsonb_array_elements(p_capture#>'{readableGraph,inventory}')x where x->>'kind'=kind;
   if n is null or digest is null or counts is null then raise exception using errcode='55000',message='export_class_projection_unavailable';end if;
  elsif kind='path_b_report_bindings' then
   handling:='path-b-results';
   for item in select x->>'id' id,x->>'subjectId' subject,x->>'rowText' row_text
    from jsonb_array_elements(p_capture->'pathBResults')s cross join lateral jsonb_array_elements(s->'records')x
    order by (x->>'id') collate "C" loop
    n:=n+1;digest:=extensions.digest(digest||convert_to(item.id||':'||item.subject||':'||item.row_text||E'\n','UTF8'),'sha256');
   end loop;
   select coalesce(jsonb_agg(jsonb_build_object('subjectId',x->'subjectId','rows',x->'rows') order by x->>'subjectId'),'[]') into counts
    from jsonb_array_elements(p_capture->'pathBResults')x where (x->>'rows')::bigint>0;
   -- Exact recipient-scoped internal bindings have a registered result-only
   -- subject projection. Other recipients' grants/results are not borrowed.
   if n<>(select count(*) from private.path_b_report_bindings b where b.recipient_account_id=p_account) then
    raise exception using errcode='0A000',message='export_result_projection_unavailable';end if;
  elsif kind='other_adult_held_uploads' then
   handling:='excluded';
   select count(*) into n from public.other_adult_held_uploads h where h.uploader_account_id=p_account or h.subject_id=any(subjects);
   if n<>coalesce((select sum((x->>'excludedHeldUploads')::bigint) from jsonb_array_elements(p_capture->'pathBResults')x),0) then
    raise exception using errcode='0A000',message='export_result_projection_unavailable';end if;
   digest:=extensions.digest(convert_to('account-excluded-held-objects-v1|'||coalesce((select jsonb_agg(to_jsonb(h) order by h.id)
    from public.other_adult_held_uploads h where h.subject_id=any(subjects)),'[]')::text,'UTF8'),'sha256');
  else
   handling:='unsupported';
   case kind
    when 'ancestry_regions' then select count(*) into n from public.ancestry_regions where subject_id=any(subjects);
    when 'appeal_intakes' then select count(*) into n from public.appeal_intakes where appellant_account_id=p_account or appellant_principal_id in(select id from public.subject_principals where account_id=p_account);
    when 'correction_requests' then select count(*) into n from public.correction_requests where subject_id=any(subjects) or claimant_principal_id in(select id from public.subject_principals where account_id=p_account);
    when 'embryo_basis_bindings' then select count(*) into n from public.embryo_basis_bindings where cohort_id=any(cohorts);
    when 'embryo_cohorts' then n:=coalesce(cardinality(cohorts),0);
    when 'embryo_disposition_confirmations' then select count(*) into n from public.embryo_disposition_confirmations c join public.embryo_disposition_proposals p on p.id=c.proposal_id join public.embryos e on e.id=p.embryo_id where e.cohort_id=any(cohorts) or c.confirmer_principal_id in(select id from public.subject_principals where account_id=p_account);
    when 'embryo_disposition_proposals' then select count(*) into n from public.embryo_disposition_proposals p join public.embryos e on e.id=p.embryo_id where e.cohort_id=any(cohorts) or p.proposer_principal_id in(select id from public.subject_principals where account_id=p_account);
    when 'embryo_donor_attributions' then select count(*) into n from public.embryo_donor_attributions where cohort_id=any(cohorts) or donor_principal_id in(select id from public.subject_principals where account_id=p_account);
    when 'embryo_participant_sets' then select count(*) into n from public.embryo_participant_sets where cohort_id=any(cohorts) or principal_id in(select id from public.subject_principals where account_id=p_account);
    when 'family_pairs' then select count(*) into n from public.family_pairs where subject_a_id=any(subjects) or subject_b_id=any(subjects);
    when 'portrait_results' then select count(*) into n from public.portrait_results where owner_account_id=p_account or parent_a_subject_id=any(subjects) or parent_b_subject_id=any(subjects);
    when 'other_adult_held_uploads' then select count(*) into n from public.other_adult_held_uploads where uploader_account_id=p_account or subject_id=any(subjects);
    when 'path_b_report_bindings' then select count(*) into n from private.path_b_report_bindings where recipient_account_id=p_account or subject_id=any(subjects);
    else raise exception using errcode='22023',message='invalid_request';
   end case;
   if n<>0 then raise exception using errcode='0A000',message='export_class_projection_unavailable';end if;
  end if;
  if n is null or n<0 or n>9007199254740991 then raise exception using errcode='55000',message='export_class_projection_unavailable';end if;
  out:=out||jsonb_build_array(jsonb_build_object('kind',kind,'mode',handling,'rows',n,'membershipSha256',encode(digest,'hex'),'partitions',counts));
 end loop;
 return out;
end $new_classes$;
 if (length(definition)-length(replace(definition,old_body,'')))/length(old_body)<>1 then
  raise exception using errcode='55000',message='export_readable_graph_predecessor_unavailable';end if;
 execute replace(definition,old_body,new_body);

 execute $create$
create function public.export_archive_account_graph_rows_v2(p_export_id uuid,p_attempt_id uuid,p_authority_receipt text,p_kind text,p_after_key jsonb default null)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare permit jsonb;captured jsonb;subjects uuid[];anchor uuid;item record;rows jsonb:='[]';total bigint:=0;page_count integer:=0;last_key jsonb;
 digest bytea;identity text;exists_after boolean:=p_after_key is null;expected jsonb;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception using errcode='42501',message='not_found';end if;
 if p_kind is null or p_kind not in('embryo_cohorts','embryo_basis_bindings','embryo_participant_sets','embryo_donor_attributions',
  'embryo_disposition_proposals','embryo_disposition_confirmations','family_pairs') then raise exception using errcode='22023',message='invalid_request';end if;
 if p_after_key is not null then perform private.export_account_graph_cursor_v1(p_kind,p_after_key);end if;
 permit:=private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt);
 if permit->>'targetKind' is distinct from 'account' then raise exception using errcode='42501',message='not_found';end if;
 captured:=private.export_account_owned_capture_v1(permit->'origin','account',(permit->>'targetId')::uuid);
 if captured#>'{authority,subjectPartitions}' is distinct from permit->'partitions' then raise exception using errcode='42501',message='not_found';end if;
 select array_agg(x::uuid order by x) into subjects from jsonb_array_elements_text(permit->'partitions')x;
 anchor:=(captured#>>'{readableGraph,anchorSubjectId}')::uuid;
 select x into expected from jsonb_array_elements(captured#>'{readableGraph,inventory}')x where x->>'kind'=p_kind;
 if anchor is null or expected is null or not(anchor=any(subjects)) then raise exception using errcode='42501',message='not_found';end if;
 digest:=extensions.digest(convert_to('account-graph-routed-v2|'||p_kind,'UTF8'),'sha256');
 for item in select * from private.export_account_graph_projection_v1((permit#>>'{origin,accountId}')::uuid,subjects,p_kind)
  order by (projected_key->>0) collate "C",coalesce(projected_key->>1,'') collate "C",coalesce(projected_key->>2,'') collate "C",coalesce((projected_key->>3)::bigint,0) loop
  identity:=private.export_account_graph_cursor_v1(p_kind,item.projected_key);
  if octet_length(item.projected_row::text)>8192 then raise exception using errcode='55000',message='export_class_projection_unavailable';end if;
  total:=total+1;
  digest:=extensions.digest(digest||convert_to(identity||':'||anchor::text||':requester-account-history:'||item.projected_row::text||E'\n','UTF8'),'sha256');
  if item.projected_key=p_after_key then exists_after:=true;end if;
  if page_count<500 and (p_after_key is null or
   ((item.projected_key->>0) collate "C",coalesce(item.projected_key->>1,'') collate "C",coalesce(item.projected_key->>2,'') collate "C",coalesce((item.projected_key->>3)::bigint,0))>
   ((p_after_key->>0) collate "C",coalesce(p_after_key->>1,'') collate "C",coalesce(p_after_key->>2,'') collate "C",coalesce((p_after_key->>3)::bigint,0))) then
   rows:=rows||jsonb_build_array(jsonb_build_object('identity',identity,'subjectId',anchor,
    'scope','requester-account-history','rowText',item.projected_row::text));page_count:=page_count+1;last_key:=item.projected_key;
  end if;
 end loop;
 if total>9007199254740991 or not exists_after then raise exception using errcode='22023',message='invalid_request';end if;
 if total is distinct from(expected->>'rows')::bigint or encode(digest,'hex') is distinct from expected->>'membershipSha256'
  or private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt) is distinct from permit
  or private.export_account_owned_capture_v1(permit->'origin','account',(permit->>'targetId')::uuid) is distinct from captured then
  raise exception using errcode='42501',message='not_found';end if;
 return jsonb_build_object('version','account-graph-page-v2','kind',p_kind,'authorityReceipt',p_authority_receipt,
  'membership',jsonb_build_object('rows',total,'sha256',encode(digest,'hex')),'rows',rows,'nextAfterKey',case when page_count=500 then last_key else null end);
end $$
$create$;
 execute 'revoke all on function public.export_archive_account_graph_rows_v2(uuid,uuid,text,text,jsonb) from public,anon,authenticated,service_role,inherit_upload_only';
 execute 'grant execute on function public.export_archive_account_graph_rows_v2(uuid,uuid,text,text,jsonb) to service_role';
 execute $create$
create function public.export_archive_account_path_b_v1(p_export_id uuid,p_attempt_id uuid,p_authority_receipt text,p_subject_id uuid)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' set extra_float_digits=3 as $$
declare permit jsonb;captured jsonb;result jsonb;snapshot jsonb;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception using errcode='42501',message='not_found';end if;
 if p_subject_id is null then raise exception using errcode='22023',message='invalid_request';end if;
 permit:=private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt);
 if permit->>'targetKind' is distinct from 'account' or not(permit->'partitions' ? p_subject_id::text) then
  raise exception using errcode='42501',message='not_found';end if;
 captured:=private.export_account_owned_capture_v1(permit->'origin','account',(permit->>'targetId')::uuid);
 if captured#>'{authority,subjectPartitions}' is distinct from permit->'partitions' then raise exception using errcode='42501',message='not_found';end if;
 select x into snapshot from jsonb_array_elements(captured->'pathBResults')x where x->>'subjectId'=p_subject_id::text;
 if snapshot is null then
  if exists(select 1 from public.genome_files gf where gf.subject_id=p_subject_id and private.export_account_path_b_file_v1(gf.id)) then
   raise exception using errcode='42501',message='not_found';end if;
  snapshot:=jsonb_build_object('subjectId',p_subject_id,'records','[]'::jsonb,'rows',0,
   'sha256',encode(extensions.digest(convert_to('account-class-members-v1|path_b_report_bindings','UTF8'),'sha256'),'hex'),'excludedHeldUploads',0);
 end if;
 result:=jsonb_build_object('version','account-path-b-results-v1','authorityReceipt',p_authority_receipt,'snapshot',snapshot);
 if octet_length(result::text)>4000000 then raise exception using errcode='54000',message='export_result_projection_unavailable';end if;
 if private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt) is distinct from permit
  or private.export_account_owned_capture_v1(permit->'origin','account',(permit->>'targetId')::uuid) is distinct from captured then
  raise exception using errcode='42501',message='not_found';end if;
 return result;
end $$
$create$;
 execute 'revoke all on function public.export_archive_account_path_b_v1(uuid,uuid,text,uuid) from public,anon,authenticated,service_role,inherit_upload_only';
 execute 'grant execute on function public.export_archive_account_path_b_v1(uuid,uuid,text,uuid) to service_role';
 -- Exact replacement and retained-ABI successor checks.
 if not exists(select 1 from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure('private.export_account_owned_capture_pre_member_frame_v1(jsonb,text,uuid)')
  and p.pronargs=3 and p.proowner='postgres'::regrole and p.prokind='f' and not p.proleakproof and p.provariadic=0::oid and p.probin is null
  and p.prosupport::oid=0::oid and p.procost=100 and p.prorows=(case when p.proretset then 1000 else 0 end) and p.proargmodes is null and p.proallargtypes is null
  and p.prolang=(select oid from pg_catalog.pg_language where lanname='plpgsql') and p.prosecdef and not p.proisstrict
  and p.provolatile='v' and p.proparallel='u' and p.prorettype='jsonb'::regtype and not p.proretset
  and p.proargnames=array['p_origin','p_target_kind','p_target_id']::text[] and p.proconfig=array['search_path=pg_catalog','lock_timeout=250ms']::text[] and p.pronargdefaults=0
  and p.proargdefaults is null and md5(p.prosrc)='a28b5936faf4b9faf58f5efa7c4b8709')
  or exists(select 1 from unnest(array['anon','authenticated','service_role','inherit_upload_only'])role_name
   where has_function_privilege(role_name,'private.export_account_owned_capture_pre_member_frame_v1(jsonb,text,uuid)','execute') is distinct from(role_name='service_role' and false))
  or exists(select 1 from pg_catalog.pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a
   where p.oid=pg_catalog.to_regprocedure('private.export_account_owned_capture_pre_member_frame_v1(jsonb,text,uuid)') and(a.grantee not in('postgres'::regrole) or a.privilege_type<>'EXECUTE' or a.grantor<>p.proowner
    or(a.grantee<>'postgres'::regrole and a.is_grantable))) then
  raise exception using errcode='55000',message='export_readable_graph_postcondition_failed';end if;
 if not exists(select 1 from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure('private.export_account_owned_capture_pre_readable_graph_v1(jsonb,text,uuid)')
  and p.pronargs=3 and p.proowner='postgres'::regrole and p.prokind='f' and not p.proleakproof and p.provariadic=0::oid and p.probin is null
  and p.prosupport::oid=0::oid and p.procost=100 and p.prorows=(case when p.proretset then 1000 else 0 end) and p.proargmodes is null and p.proallargtypes is null
  and p.prolang=(select oid from pg_catalog.pg_language where lanname='plpgsql') and p.prosecdef and not p.proisstrict
  and p.provolatile='v' and p.proparallel='u' and p.prorettype='jsonb'::regtype and not p.proretset
  and p.proargnames=array['p_origin','p_target_kind','p_target_id']::text[] and p.proconfig=array['search_path=""','lock_timeout=250ms']::text[] and p.pronargdefaults=0
  and p.proargdefaults is null and md5(p.prosrc)='f80f0a8c7681aa616a59ffc5c2062c11')
  or exists(select 1 from unnest(array['anon','authenticated','service_role','inherit_upload_only'])role_name
   where has_function_privilege(role_name,'private.export_account_owned_capture_pre_readable_graph_v1(jsonb,text,uuid)','execute') is distinct from(role_name='service_role' and false))
  or exists(select 1 from pg_catalog.pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a
   where p.oid=pg_catalog.to_regprocedure('private.export_account_owned_capture_pre_readable_graph_v1(jsonb,text,uuid)') and(a.grantee not in('postgres'::regrole) or a.privilege_type<>'EXECUTE' or a.grantor<>p.proowner
    or(a.grantee<>'postgres'::regrole and a.is_grantable))) then
  raise exception using errcode='55000',message='export_readable_graph_postcondition_failed';end if;
 if not exists(select 1 from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure('public.export_archive_account_members_v1(text,uuid,uuid,text,uuid,text)')
  and p.pronargs=6 and p.proowner='postgres'::regrole and p.prokind='f' and not p.proleakproof and p.provariadic=0::oid and p.probin is null
  and p.prosupport::oid=0::oid and p.procost=100 and p.prorows=(case when p.proretset then 1000 else 0 end) and p.proargmodes is null and p.proallargtypes is null
  and p.prolang=(select oid from pg_catalog.pg_language where lanname='plpgsql') and p.prosecdef and not p.proisstrict
  and p.provolatile='v' and p.proparallel='u' and p.prorettype='jsonb'::regtype and not p.proretset
  and p.proargnames=array['p_operation','p_export_id','p_attempt_id','p_authority_receipt','p_subject_id','p_after_id']::text[] and p.proconfig=array['search_path=""','extra_float_digits=3']::text[] and p.pronargdefaults=2
  and pg_catalog.pg_get_expr(p.proargdefaults,0)='NULL::uuid, NULL::text' and md5(p.prosrc)='1e04b020763456c3c95ca362e3cae7d2')
  or exists(select 1 from unnest(array['anon','authenticated','service_role','inherit_upload_only'])role_name
   where has_function_privilege(role_name,'public.export_archive_account_members_v1(text,uuid,uuid,text,uuid,text)','execute') is distinct from(role_name='service_role' and true))
  or exists(select 1 from pg_catalog.pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a
   where p.oid=pg_catalog.to_regprocedure('public.export_archive_account_members_v1(text,uuid,uuid,text,uuid,text)') and(a.grantee not in('postgres'::regrole,'service_role'::regrole) or a.privilege_type<>'EXECUTE' or a.grantor<>p.proowner
    or(a.grantee<>'postgres'::regrole and a.is_grantable))) then
  raise exception using errcode='55000',message='export_readable_graph_postcondition_failed';end if;
 if not exists(select 1 from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure('public.export_archive_account_metadata_v1(text,uuid,uuid,text,uuid)')
  and p.pronargs=5 and p.proowner='postgres'::regrole and p.prokind='f' and not p.proleakproof and p.provariadic=0::oid and p.probin is null
  and p.prosupport::oid=0::oid and p.procost=100 and p.prorows=(case when p.proretset then 1000 else 0 end) and p.proargmodes is null and p.proallargtypes is null
  and p.prolang=(select oid from pg_catalog.pg_language where lanname='plpgsql') and p.prosecdef and not p.proisstrict
  and p.provolatile='v' and p.proparallel='u' and p.prorettype='jsonb'::regtype and not p.proretset
  and p.proargnames=array['p_operation','p_export_id','p_attempt_id','p_authority_receipt','p_after_id']::text[] and p.proconfig=array['search_path=""','lock_timeout=250ms']::text[] and p.pronargdefaults=1
  and pg_catalog.pg_get_expr(p.proargdefaults,0)='NULL::uuid' and md5(p.prosrc)='b48f1e537700bf6e0ae87e29cbea574e')
  or exists(select 1 from unnest(array['anon','authenticated','service_role','inherit_upload_only'])role_name
   where has_function_privilege(role_name,'public.export_archive_account_metadata_v1(text,uuid,uuid,text,uuid)','execute') is distinct from(role_name='service_role' and true))
  or exists(select 1 from pg_catalog.pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a
   where p.oid=pg_catalog.to_regprocedure('public.export_archive_account_metadata_v1(text,uuid,uuid,text,uuid)') and(a.grantee not in('postgres'::regrole,'service_role'::regrole) or a.privilege_type<>'EXECUTE' or a.grantor<>p.proowner
    or(a.grantee<>'postgres'::regrole and a.is_grantable))) then
  raise exception using errcode='55000',message='export_readable_graph_postcondition_failed';end if;
 if not exists(select 1 from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure('private.export_account_class_inventory_v1(uuid,jsonb)')
  and p.pronargs=2 and p.proowner='postgres'::regrole and p.prokind='f' and not p.proleakproof and p.provariadic=0::oid and p.probin is null
  and p.prosupport::oid=0::oid and p.procost=100 and p.prorows=(case when p.proretset then 1000 else 0 end) and p.proargmodes is null and p.proallargtypes is null
  and p.prolang=(select oid from pg_catalog.pg_language where lanname='plpgsql') and p.prosecdef and not p.proisstrict
  and p.provolatile='v' and p.proparallel='u' and p.prorettype='jsonb'::regtype and not p.proretset
  and p.proargnames=array['p_account','p_capture']::text[] and p.proconfig=array['search_path=""','lock_timeout=250ms']::text[] and p.pronargdefaults=0
  and p.proargdefaults is null and md5(p.prosrc)='4acd95ba8f9b21a3a27ed03d50eec761')
  or exists(select 1 from unnest(array['anon','authenticated','service_role','inherit_upload_only'])role_name
   where has_function_privilege(role_name,'private.export_account_class_inventory_v1(uuid,jsonb)','execute') is distinct from(role_name='service_role' and false))
  or exists(select 1 from pg_catalog.pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a
   where p.oid=pg_catalog.to_regprocedure('private.export_account_class_inventory_v1(uuid,jsonb)') and(a.grantee not in('postgres'::regrole) or a.privilege_type<>'EXECUTE' or a.grantor<>p.proowner
    or(a.grantee<>'postgres'::regrole and a.is_grantable))) then
  raise exception using errcode='55000',message='export_readable_graph_postcondition_failed';end if;
 -- Exact new function body/ABI/config/ACL postconditions; any drift rolls back the whole DO.
 if not exists(select 1 from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure('private.export_account_path_b_snapshot_v1(jsonb,uuid)')
  and p.pronargs=2 and p.proowner='postgres'::regrole and p.prokind='f' and not p.proleakproof and p.provariadic=0::oid and p.probin is null
  and p.prosupport::oid=0::oid and p.procost=100 and p.prorows=(case when p.proretset then 1000 else 0 end) and p.proargmodes is null and p.proallargtypes is null
  and p.prolang=(select oid from pg_catalog.pg_language where lanname='plpgsql') and p.prosecdef and not p.proisstrict
  and p.provolatile='v' and p.proparallel='u' and p.prorettype='jsonb'::regtype and not p.proretset
  and p.proargnames=array['p_origin','p_subject']::text[] and p.proconfig=array['search_path=""','lock_timeout=250ms','extra_float_digits=3']::text[]
  and p.pronargdefaults=0 and p.proargdefaults is null and md5(p.prosrc)='1d00a5aaaeb38f2fc5b66eb75b009791')
  or exists(select 1 from unnest(array['anon','authenticated','service_role','inherit_upload_only'])role_name
   where has_function_privilege(role_name,'private.export_account_path_b_snapshot_v1(jsonb,uuid)','execute') is distinct from (role_name='service_role' and false))
  or exists(select 1 from pg_catalog.pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a
   where p.oid=pg_catalog.to_regprocedure('private.export_account_path_b_snapshot_v1(jsonb,uuid)') and(a.grantee not in('postgres'::regrole) or a.privilege_type<>'EXECUTE' or a.grantor<>p.proowner
    or(a.grantee<>'postgres'::regrole and a.is_grantable))) then
  raise exception using errcode='55000',message='export_readable_graph_postcondition_failed';end if;
 if not exists(select 1 from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure('private.export_account_ordinary_readable_authority_v1(jsonb,text,uuid)')
  and p.pronargs=3 and p.proowner='postgres'::regrole and p.prokind='f' and not p.proleakproof and p.provariadic=0::oid and p.probin is null
  and p.prosupport::oid=0::oid and p.procost=100 and p.prorows=(case when p.proretset then 1000 else 0 end) and p.proargmodes is null and p.proallargtypes is null
  and p.prolang=(select oid from pg_catalog.pg_language where lanname='plpgsql') and p.prosecdef and not p.proisstrict
  and p.provolatile='v' and p.proparallel='u' and p.prorettype='jsonb'::regtype and not p.proretset
  and p.proargnames=array['p_origin','p_target_kind','p_target_id']::text[] and p.proconfig=array['search_path=pg_catalog, private']::text[]
  and p.pronargdefaults=0 and p.proargdefaults is null and md5(p.prosrc)='bf81f0f13c382c9d5e159acba53995e8')
  or exists(select 1 from unnest(array['anon','authenticated','service_role','inherit_upload_only'])role_name
   where has_function_privilege(role_name,'private.export_account_ordinary_readable_authority_v1(jsonb,text,uuid)','execute') is distinct from (role_name='service_role' and false))
  or exists(select 1 from pg_catalog.pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a
   where p.oid=pg_catalog.to_regprocedure('private.export_account_ordinary_readable_authority_v1(jsonb,text,uuid)') and(a.grantee not in('postgres'::regrole) or a.privilege_type<>'EXECUTE' or a.grantor<>p.proowner
    or(a.grantee<>'postgres'::regrole and a.is_grantable))) then
  raise exception using errcode='55000',message='export_readable_graph_postcondition_failed';end if;
 if not exists(select 1 from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure('private.export_account_graph_capture_v1(uuid,jsonb)')
  and p.pronargs=2 and p.proowner='postgres'::regrole and p.prokind='f' and not p.proleakproof and p.provariadic=0::oid and p.probin is null
  and p.prosupport::oid=0::oid and p.procost=100 and p.prorows=(case when p.proretset then 1000 else 0 end) and p.proargmodes is null and p.proallargtypes is null
  and p.prolang=(select oid from pg_catalog.pg_language where lanname='plpgsql') and p.prosecdef and not p.proisstrict
  and p.provolatile='v' and p.proparallel='u' and p.prorettype='jsonb'::regtype and not p.proretset
  and p.proargnames=array['p_account','p_capture']::text[] and p.proconfig=array['search_path=""','lock_timeout=250ms']::text[]
  and p.pronargdefaults=0 and p.proargdefaults is null and md5(p.prosrc)='6572858ea4d079066829ae3bea1af5ff')
  or exists(select 1 from unnest(array['anon','authenticated','service_role','inherit_upload_only'])role_name
   where has_function_privilege(role_name,'private.export_account_graph_capture_v1(uuid,jsonb)','execute') is distinct from (role_name='service_role' and false))
  or exists(select 1 from pg_catalog.pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a
   where p.oid=pg_catalog.to_regprocedure('private.export_account_graph_capture_v1(uuid,jsonb)') and(a.grantee not in('postgres'::regrole) or a.privilege_type<>'EXECUTE' or a.grantor<>p.proowner
    or(a.grantee<>'postgres'::regrole and a.is_grantable))) then
  raise exception using errcode='55000',message='export_readable_graph_postcondition_failed';end if;
 if not exists(select 1 from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure('private.export_account_owned_capture_pre_classes_v1(jsonb,text,uuid)')
  and p.pronargs=3 and p.proowner='postgres'::regrole and p.prokind='f' and not p.proleakproof and p.provariadic=0::oid and p.probin is null
  and p.prosupport::oid=0::oid and p.procost=100 and p.prorows=(case when p.proretset then 1000 else 0 end) and p.proargmodes is null and p.proallargtypes is null
  and p.prolang=(select oid from pg_catalog.pg_language where lanname='plpgsql') and p.prosecdef and not p.proisstrict
  and p.provolatile='v' and p.proparallel='u' and p.prorettype='jsonb'::regtype and not p.proretset
  and p.proargnames=array['p_origin','p_target_kind','p_target_id']::text[] and p.proconfig=array['search_path=""','lock_timeout=250ms']::text[]
  and p.pronargdefaults=0 and p.proargdefaults is null and md5(p.prosrc)='2f6ea9aee8e9b9d3a36b43b98748dddc')
  or exists(select 1 from unnest(array['anon','authenticated','service_role','inherit_upload_only'])role_name
   where has_function_privilege(role_name,'private.export_account_owned_capture_pre_classes_v1(jsonb,text,uuid)','execute') is distinct from (role_name='service_role' and false))
  or exists(select 1 from pg_catalog.pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a
   where p.oid=pg_catalog.to_regprocedure('private.export_account_owned_capture_pre_classes_v1(jsonb,text,uuid)') and(a.grantee not in('postgres'::regrole) or a.privilege_type<>'EXECUTE' or a.grantor<>p.proowner
    or(a.grantee<>'postgres'::regrole and a.is_grantable))) then
  raise exception using errcode='55000',message='export_readable_graph_postcondition_failed';end if;
 if not exists(select 1 from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure('public.export_archive_account_graph_rows_v2(uuid,uuid,text,text,jsonb)')
  and p.pronargs=5 and p.proowner='postgres'::regrole and p.prokind='f' and not p.proleakproof and p.provariadic=0::oid and p.probin is null
  and p.prosupport::oid=0::oid and p.procost=100 and p.prorows=(case when p.proretset then 1000 else 0 end) and p.proargmodes is null and p.proallargtypes is null
  and p.prolang=(select oid from pg_catalog.pg_language where lanname='plpgsql') and p.prosecdef and not p.proisstrict
  and p.provolatile='v' and p.proparallel='u' and p.prorettype='jsonb'::regtype and not p.proretset
  and p.proargnames=array['p_export_id','p_attempt_id','p_authority_receipt','p_kind','p_after_key']::text[] and p.proconfig=array['search_path=""','lock_timeout=250ms']::text[]
  and p.pronargdefaults=1 and pg_catalog.pg_get_expr(p.proargdefaults,0)='NULL::jsonb' and md5(p.prosrc)='fb3711e8e02f504bd0711456e896df01')
  or exists(select 1 from unnest(array['anon','authenticated','service_role','inherit_upload_only'])role_name
   where has_function_privilege(role_name,'public.export_archive_account_graph_rows_v2(uuid,uuid,text,text,jsonb)','execute') is distinct from (role_name='service_role' and true))
  or exists(select 1 from pg_catalog.pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a
   where p.oid=pg_catalog.to_regprocedure('public.export_archive_account_graph_rows_v2(uuid,uuid,text,text,jsonb)') and(a.grantee not in('postgres'::regrole,'service_role'::regrole) or a.privilege_type<>'EXECUTE' or a.grantor<>p.proowner
    or(a.grantee<>'postgres'::regrole and a.is_grantable))) then
  raise exception using errcode='55000',message='export_readable_graph_postcondition_failed';end if;
 if not exists(select 1 from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure('public.export_archive_account_path_b_v1(uuid,uuid,text,uuid)')
  and p.pronargs=4 and p.proowner='postgres'::regrole and p.prokind='f' and not p.proleakproof and p.provariadic=0::oid and p.probin is null
  and p.prosupport::oid=0::oid and p.procost=100 and p.prorows=(case when p.proretset then 1000 else 0 end) and p.proargmodes is null and p.proallargtypes is null
  and p.prolang=(select oid from pg_catalog.pg_language where lanname='plpgsql') and p.prosecdef and not p.proisstrict
  and p.provolatile='v' and p.proparallel='u' and p.prorettype='jsonb'::regtype and not p.proretset
  and p.proargnames=array['p_export_id','p_attempt_id','p_authority_receipt','p_subject_id']::text[] and p.proconfig=array['search_path=""','lock_timeout=250ms','extra_float_digits=3']::text[]
  and p.pronargdefaults=0 and p.proargdefaults is null and md5(p.prosrc)='7f30cb4770f877b3335c72914dfcfc8a')
  or exists(select 1 from unnest(array['anon','authenticated','service_role','inherit_upload_only'])role_name
   where has_function_privilege(role_name,'public.export_archive_account_path_b_v1(uuid,uuid,text,uuid)','execute') is distinct from (role_name='service_role' and true))
  or exists(select 1 from pg_catalog.pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a
   where p.oid=pg_catalog.to_regprocedure('public.export_archive_account_path_b_v1(uuid,uuid,text,uuid)') and(a.grantee not in('postgres'::regrole,'service_role'::regrole) or a.privilege_type<>'EXECUTE' or a.grantor<>p.proowner
    or(a.grantee<>'postgres'::regrole and a.is_grantable))) then
  raise exception using errcode='55000',message='export_readable_graph_postcondition_failed';end if;
 if not exists(select 1 from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure('private.export_account_path_b_file_v1(uuid)')
  and p.pronargs=1 and p.proowner='postgres'::regrole and p.prokind='f' and not p.proleakproof and p.provariadic=0::oid and p.probin is null
  and p.prosupport::oid=0::oid and p.procost=100 and p.prorows=(case when p.proretset then 1000 else 0 end) and p.proargmodes is null and p.proallargtypes is null
  and p.prolang=(select oid from pg_catalog.pg_language where lanname='sql') and p.prosecdef and not p.proisstrict
  and p.provolatile='s' and p.proparallel='u' and p.prorettype='boolean'::regtype and not p.proretset
  and p.proargnames=array['p_file']::text[] and p.proconfig=array['search_path=""','lock_timeout=250ms']::text[]
  and p.pronargdefaults=0 and p.proargdefaults is null and md5(p.prosrc)='55f112c989b64c6786cf88dc6b01ba39')
  or exists(select 1 from unnest(array['anon','authenticated','service_role','inherit_upload_only'])role_name
   where has_function_privilege(role_name,'private.export_account_path_b_file_v1(uuid)','execute'))
  or exists(select 1 from pg_catalog.pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a
   where p.oid=pg_catalog.to_regprocedure('private.export_account_path_b_file_v1(uuid)') and(a.grantee not in('postgres'::regrole) or a.privilege_type<>'EXECUTE' or a.grantor<>p.proowner)) then
  raise exception using errcode='55000',message='export_readable_graph_postcondition_failed';end if;
end
$account_readable_graph$;
