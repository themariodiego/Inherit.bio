-- Restore the registered refusal worker's owner-defined cleanup boundary after
--023 closes claimant objections. Preserve every exact graph, manifest, claim,
--storage-presence and shared-evidence check; grant no protected-table access.
-- Restore only the original pinned service TRUNCATE on user_variants. Existing
--210 statement revision triggers continue to invalidate captured member frames.
do $cleanup$
declare item record; target regprocedure; before_acl aclitem[];
begin
  for item in select * from (values
    ('public.claim_refused_invitation_draft_purge_v1(text)','eb80f8424c3d83bbccdc90035cd24b34','TABLE(manifest_id uuid, storage_objects jsonb)',array['p_claim_token_hash','manifest_id','storage_objects']::text[],1,true),
    ('public.authorize_refused_invitation_storage_v1(uuid,text,bigint[])','7c6b39f23efbc248af08b157a9362dee','boolean',array['p_manifest_id','p_claim_token_hash','p_ordinals']::text[],3,true),
    ('public.complete_refused_invitation_storage_v1(uuid,text,bigint[])','3ad1c3f784d13336f8a95448cd13b99b','void',array['p_manifest_id','p_claim_token_hash','p_ordinals']::text[],3,true),
    ('public.finish_refused_invitation_draft_purge_v1(uuid,text)','b6bc8b84951f70ade7c6968e510a54e2','void',array['p_manifest_id','p_claim_token_hash']::text[],2,true),
    ('public.fail_refused_invitation_draft_purge_v1(uuid,text)','6ff72ac54047851920c711af4676bb51','void',array['p_manifest_id','p_claim_token_hash']::text[],2,true),
    ('private.refused_draft_evidence_objects_v1(text,uuid)','b1e8bdcd1ee36a42602df5f86797cc99','TABLE(object_id uuid)',array['p_kind','p_draft','object_id']::text[],2,false),
    ('private.assert_refused_draft_v1(public.retention_due_phases)','5a0546f919d8e6e48dbe1b1ae1d8d53e','text',array['p']::text[],1,false),
    ('private.lock_refused_draft_purge_v1(uuid,text)','d66a80c100c4d00cd6921a852341e8d7','public.retention_due_phases',array['p_manifest','p_claim']::text[],2,false),
    ('private.assert_refused_evidence_exclusive_v1(text,uuid)','01e11f088ba411e9ad9ebb2b672e3627','void',array['p_kind','p_draft']::text[],2,false)

  ) x(signature,body_md5,result_type,arg_names,input_count,service_door) loop
    target:=to_regprocedure(item.signature);
    if target is null or not exists(select 1 from pg_proc p join pg_language l on l.oid=p.prolang
      where p.oid=target and md5(p.prosrc)=item.body_md5 and not p.prosecdef
        and p.proowner=(select oid from pg_roles where rolname='postgres')
        and p.prokind='f' and not p.proisstrict
        and p.provolatile=case when item.signature='private.refused_draft_evidence_objects_v1(text,uuid)' then 's'::"char" else 'v'::"char" end
        and l.lanname=case when item.signature='private.refused_draft_evidence_objects_v1(text,uuid)' then 'sql' else 'plpgsql' end
        and p.proconfig=array['search_path=""']::text[] and p.proargdefaults is null
        and p.pronargs=item.input_count and p.proargnames=item.arg_names
        and (case when item.signature='private.lock_refused_draft_purge_v1(uuid,text)'
          then p.prorettype='public.retention_due_phases'::regtype
          else pg_get_function_result(p.oid)=item.result_type end))
      or exists(select 1 from unnest(array['anon','authenticated','inherit_upload_only']) r
        where has_function_privilege(r,target,'execute'))
      or not has_function_privilege('service_role',target,'execute')
      or exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        where p.oid=target and (a.privilege_type<>'EXECUTE' or a.grantor<>p.proowner or a.is_grantable
          or a.grantee not in(p.proowner,(select oid from pg_roles where rolname='service_role'))))
      or (select cardinality(coalesce(proacl,acldefault('f',proowner))) from pg_proc where oid=target)<>2 then
      raise exception using errcode='55000',message='refused cleanup predecessor differs';end if;
    select proacl into before_acl from pg_proc where oid=target;
    if item.service_door then
      execute format('alter function %s security definer',target);
      if not exists(select 1 from pg_proc where oid=target and prosecdef
          and md5(prosrc)=item.body_md5 and proacl is not distinct from before_acl) then
        raise exception using errcode='55000',message='refused cleanup door postcondition differs';end if;
    else
      execute format('revoke all on function %s from public,anon,authenticated,inherit_upload_only,service_role',target);
      if exists(select 1 from unnest(array['anon','authenticated','inherit_upload_only','service_role']) r
        where has_function_privilege(r,target,'execute')) or not exists(
          select 1 from pg_proc where oid=target and not prosecdef and md5(prosrc)=item.body_md5) then
        raise exception using errcode='55000',message='refused cleanup helper postcondition differs';end if;
    end if;
  end loop;
  if has_table_privilege('service_role','public.user_variants','truncate')
    or exists(select 1 from unnest(array['anon','authenticated','inherit_upload_only']) r
      where has_table_privilege(r,'public.user_variants','truncate'))
    or not exists(select 1 from pg_trigger t join pg_proc p on p.oid=t.tgfoid
      where t.tgrelid='public.user_variants'::regclass and t.tgname='export_variant_content_truncate'
        and t.tgenabled='O' and p.oid='private.advance_export_content_revision_v1()'::regprocedure
        and p.prosecdef and p.proconfig=array['search_path=""','lock_timeout=250ms']::text[]) then
    raise exception using errcode='55000',message='variant maintenance predecessor differs';end if;
  if exists(select 1 from unnest(array['anon','authenticated','inherit_upload_only','service_role']) r
    where has_table_privilege(r,'public.future_person_claim_objections','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_any_column_privilege(r,'public.future_person_claim_objections','SELECT,INSERT,UPDATE,REFERENCES')) then
    raise exception using errcode='55000',message='protected objection predecessor differs';end if;
  grant truncate on public.user_variants to service_role;
  if not has_table_privilege('service_role','public.user_variants','truncate')
    or exists(select 1 from unnest(array['anon','authenticated','inherit_upload_only']) r
      where has_table_privilege(r,'public.user_variants','truncate')) then
    raise exception using errcode='55000',message='variant maintenance postcondition differs';end if;
end;
$cleanup$;
