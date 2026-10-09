-- The current account executor has no complete Path B owned/subject/recipient
-- disposal proof. Refuse that exact graph before recording a deletion nonce,
-- holding an account or sending notices. Preserve all existing clocks/authority
-- and strict due/finalization graph guards; do not admit unknown FK rows.
do $path_b$
declare item record; target regprocedure; definition text; before_acl aclitem[];
begin
  if to_regprocedure('private.assert_account_path_b_deletion_supported_v1(uuid)') is not null then
    raise exception using errcode='55000',message='account Path B preflight already exists';end if;
  execute $definition$create function private.assert_account_path_b_deletion_supported_v1(p_account_id uuid)
  returns void language plpgsql security definer set search_path='' as $body$
begin
  -- Path B issuers lock the same current profile before creating a draft,
  -- binding the person, or issuing held storage. Keep that serialization.
  perform 1 from public.profiles where id=p_account_id for update;
  if not found then raise exception using errcode='55000',message='unsupported_account_graph';end if;
  if exists(select 1 from public.adult_subject_drafts d join public.subjects s on s.id=d.subject_id
      where d.adult_flow='path-b-subject-esignature' and (d.owner_account_id=p_account_id
        or s.owner_account_id=p_account_id or s.subject_account_id=p_account_id
        or exists(select 1 from public.subject_principals p where p.subject_id=s.id and p.account_id=p_account_id)))
    or exists(select 1 from public.upload_sessions u where u.upload_authority_kind='other-adult-held'
      and (u.account_id=p_account_id or exists(select 1 from public.subjects s where s.id=u.subject_id
        and (s.owner_account_id=p_account_id or s.subject_account_id=p_account_id))))
    or exists(select 1 from public.other_adult_held_uploads h join public.subjects s on s.id=h.subject_id
      join public.subject_principals p on p.id=h.confirmation_principal_id
      where h.uploader_account_id=p_account_id or s.owner_account_id=p_account_id
        or s.subject_account_id=p_account_id or p.account_id=p_account_id)
    or exists(select 1 from private.path_b_report_bindings b join public.subjects s on s.id=b.subject_id
      join public.genome_files f on f.id=b.file_id where b.recipient_account_id=p_account_id
        or s.owner_account_id=p_account_id or s.subject_account_id=p_account_id or f.user_id=p_account_id)
    or exists(select 1 from public.purpose_grants g where g.target_kind='subject'
      and (g.path_b_originating_session_id is not null or exists(select 1 from public.adult_subject_drafts d
        where d.subject_id=g.target_id and d.adult_flow='path-b-subject-esignature'))
      and (exists(select 1 from public.subject_principals p where p.account_id=p_account_id
        and p.id in(g.data_subject_principal_id,g.signer_principal_id))
        or exists(select 1 from public.directional_grants d where d.grant_id=g.grant_id
          and (d.recipient_account_id=p_account_id or exists(select 1 from public.subject_principals p
            where p.id=d.recipient_principal_id and p.account_id=p_account_id)))))
  then
    -- Ending a descriptor/report is not a physical upload-working disposal ACK.
    -- Current, terminal and retained historical rows require one exact graph
    -- executor; no foreign ownership or provider inventory may be inferred.
    raise exception using errcode='55000',message='unsupported_account_graph';
  end if;
end;
$body$;$definition$;
  revoke all on function private.assert_account_path_b_deletion_supported_v1(uuid)
    from public,anon,authenticated,inherit_upload_only,service_role;
  for item in select * from (values
    ('private.request_account_deletion_v2(uuid,uuid,text,timestamptz,bytea,text,text)','c638d84a1298b2bdd991173da7f3a3e7','f89dcda65e30d4223387d63843c291e0',true,array['p_account_id','p_session_id','p_nonce_hash','p_nonce_expires_at','p_contact_ciphertext','p_contact_hmac','p_notice_idempotency_key','deletion_id','status','notice_ends_at']::text[],7,'TABLE(deletion_id uuid, status text, notice_ends_at timestamp with time zone)','begin
  perform private.record_account_operation_nonce_v1(','begin
  perform private.validate_sensitive_account_session_v1(p_account_id, p_session_id);
  perform private.assert_account_path_b_deletion_supported_v1(p_account_id);
  perform private.record_account_operation_nonce_v1('),
    ('public.request_account_deletion_v1(uuid,uuid,text,bytea,text,text)','0a280b4a71a35caad7dccffc4500c893','cc02de010c27a714ff5ba96226016d60',false,array['p_account_id','p_session_id','p_nonce_hash','p_contact_ciphertext','p_contact_hmac','p_notice_idempotency_key','deletion_id','status','notice_ends_at']::text[],6,'TABLE(deletion_id uuid, status text, notice_ends_at timestamp with time zone)','  perform private.validate_sensitive_account_session_v1(p_account_id, p_session_id);','  perform private.validate_sensitive_account_session_v1(p_account_id, p_session_id);
  perform private.assert_account_path_b_deletion_supported_v1(p_account_id);'),
    ('private.assert_supported_self_deletion_graph_v1(uuid)','624b7aa17cfb8c20dbf0f0c7f600ff3c','be1e996ec3bf2c0e585c7a4b39decbc1',false,array['p_account_id']::text[],1,'uuid','begin
  perform private.assert_account_owned_cohorts_v1(p_account_id);','begin
  perform private.assert_account_path_b_deletion_supported_v1(p_account_id);
  perform private.assert_account_owned_cohorts_v1(p_account_id);')
  )x(signature,before_md5,after_md5,service_door,arg_names,input_count,result_type,anchor,replacement) loop
    target:=to_regprocedure(item.signature);
    if target is null or not exists(select 1 from pg_proc p join pg_language l on l.oid=p.prolang
      where p.oid=target and md5(p.prosrc)=item.before_md5 and p.prosecdef and l.lanname='plpgsql'
        and p.provolatile='v' and p.proparallel='u'
        and p.proowner=(select oid from pg_roles where rolname='postgres')
        and p.proconfig=array['search_path=""']::text[] and p.proargdefaults is null
        and p.pronargs=item.input_count and p.proargnames=item.arg_names
        and pg_get_function_result(p.oid)=item.result_type)
      or exists(select 1 from unnest(array['anon','authenticated','inherit_upload_only'])r
        where has_function_privilege(r,target,'execute'))
      or has_function_privilege('service_role',target,'execute') is distinct from item.service_door
      or exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a
        where p.oid=target and (a.privilege_type<>'EXECUTE' or a.grantor<>p.proowner or a.is_grantable
          or (a.grantee<>p.proowner and (not item.service_door or a.grantee<>(select oid from pg_roles where rolname='service_role')))))
      or (select cardinality(coalesce(proacl,acldefault('f',proowner))) from pg_proc where oid=target)
        <>(case when item.service_door then 2 else 1 end) then
      raise exception using errcode='55000',message='account Path B predecessor differs';end if;
    definition:=pg_get_functiondef(target);
    if (length(definition)-length(replace(definition,item.anchor,'')))/length(item.anchor)<>1 then
      raise exception using errcode='55000',message='account Path B insertion anchor differs';end if;
    select proacl into before_acl from pg_proc where oid=target;
    execute replace(definition,item.anchor,item.replacement);
    if not exists(select 1 from pg_proc where oid=target and md5(prosrc)=item.after_md5
      and proacl is not distinct from before_acl and prosecdef) then
      raise exception using errcode='55000',message='account Path B postcondition differs';end if;
  end loop;
  if not exists(select 1 from pg_proc p join pg_language l on l.oid=p.prolang
    where p.oid='private.assert_account_path_b_deletion_supported_v1(uuid)'::regprocedure
      and md5(p.prosrc)='6382fbb06d5525dc983806ecefebb629' and p.prosecdef and l.lanname='plpgsql'
      and p.provolatile='v' and p.proparallel='u'
      and p.proowner=(select oid from pg_roles where rolname='postgres')
      and p.proconfig=array['search_path=""']::text[] and p.proargdefaults is null
      and p.pronargs=1 and p.proargnames=array['p_account_id']::text[] and pg_get_function_result(p.oid)='void'
      and cardinality(coalesce(p.proacl,acldefault('f',p.proowner)))=1
      and not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a
        where a.privilege_type<>'EXECUTE' or a.grantee<>p.proowner or a.grantor<>p.proowner or a.is_grantable))
    or exists(select 1 from unnest(array['anon','authenticated','inherit_upload_only','service_role'])r
      where has_function_privilege(r,'private.assert_account_path_b_deletion_supported_v1(uuid)','execute')) then
    raise exception using errcode='55000',message='account Path B selector postcondition differs';end if;
end;
$path_b$;
