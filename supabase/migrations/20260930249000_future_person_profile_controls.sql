-- Read-only settings control inventory. Prospective CSRF/operation proofs are
-- issued statelessly by the authorized page, never persisted by a GET.
create function public.future_person_profile_controls_v1(p_account uuid,p_session uuid,p_after uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare x record; v_delete jsonb; v_save jsonb; v_signature uuid; v_items jsonb:='[]';
  v_count integer:=0; v_cursor uuid; v_next uuid;
begin
  -- Bound pagination advances over actual current parent-recipient records,
  -- including unsupported records, without hiding the remainder of the set.
  for x in select e.id,e.cohort_id,coalesce(e.display_label,s.display_label) label,c.draft_id
    from public.embryos e join public.subjects s on s.id=e.subject_id
      join public.embryo_cohorts c on c.id=e.cohort_id
    where e.status='transferred' and e.future_person_state='reserved_for_future_person'
      and (p_after is null or e.id>p_after)
      and exists(select 1 from public.subject_principals sp
        where sp.id=any(private.embryo_cohort_set_v1(c.id,'record_key_recipients'))
          and sp.principal_kind='genetic_parent' and sp.status='active' and sp.account_id=p_account)
    order by e.id limit 65 loop
    v_count:=v_count+1;
    if v_count>64 then v_next:=v_cursor;exit;end if;
    v_cursor:=x.id;
    begin
      v_delete:=private.future_person_profile_context_v1(p_account,p_session,x.id,null);
    exception when insufficient_privilege then continue; end;
    v_save:=null;v_signature:=null;
    select cs.id into v_signature from public.consent_signatures cs
      join public.consent_artifacts ca on ca.artifact_key=cs.artifact_key
        and ca.version=cs.artifact_version and ca.body_sha256=cs.artifact_body_sha256
      where cs.signer_account_id=p_account and cs.signer_principal_id=(v_delete->>'actorPrincipal')::uuid
        and cs.target_kind='cohort_draft' and cs.target_id=x.draft_id
        and cs.artifact_key='consent.upload-embryo' and ca.superseded_at is null
      order by cs.signed_at desc,cs.id desc limit 1;
    if v_signature is not null then
      begin v_save:=private.future_person_profile_context_v1(p_account,p_session,x.id,v_signature);
      exception when insufficient_privilege then v_save:=null;end;
    end if;
    v_items:=v_items||jsonb_build_array(jsonb_build_object('embryoId',x.id,'label',x.label,
      'hasProfile',v_delete->'currentProfileId'<>'null'::jsonb,
      'expiresAt',v_delete->'expiresAt','saveContext',v_save,'deleteContext',v_delete));
  end loop;
  return jsonb_build_object('items',v_items,'nextCursor',v_next);
end $$;
revoke all on function public.future_person_profile_controls_v1(uuid,uuid,uuid)
  from public,anon,authenticated,inherit_upload_only;
grant execute on function public.future_person_profile_controls_v1(uuid,uuid,uuid) to service_role;
notify pgrst,'reload schema';
