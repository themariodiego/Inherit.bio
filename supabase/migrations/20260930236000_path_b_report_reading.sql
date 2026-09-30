-- TEST-LOCAL saved queued reports on the registered genome report routes.
-- Metadata never carries genetics; capture and final confirmation reauthorize
-- actual current sessions and exact current per-recipient saved outputs.
create function private.path_b_report_metadata_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,p_test_jurisdiction boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.subjects%rowtype; selected text; purposes jsonb; item jsonb; bindings jsonb; result jsonb:='[]';
begin
 if p_test_jurisdiction is distinct from true then raise exception using errcode='42501',message='not_found'; end if;
 perform 1 from auth.sessions x join auth.users u on u.id=x.user_id where x.id=p_session_id and x.user_id=p_account_id
  and(x.not_after is null or x.not_after>clock_timestamp()) and u.deleted_at is null
  and(u.banned_until is null or u.banned_until<=clock_timestamp()) for share of x,u;
 if not found or not private.path_b_account_current_v1(p_account_id) then
  raise exception using errcode='42501',message='not_found'; end if;
 perform private.lock_invitation_transitions_v1();
 for s in select sub.* from public.subjects sub where sub.subject_class='other_adult' and sub.lifecycle='active'
  and(p_subject_id is null or sub.id=p_subject_id) and(sub.owner_account_id=p_account_id or sub.subject_account_id=p_account_id)
  and exists(select 1 from public.adult_subject_drafts d where d.subject_id=sub.id
   and d.adult_flow='path-b-subject-esignature' and d.state='confirmed') order by sub.id for share
 loop
  purposes:='[]';
  foreach selected in array array['reports.monogenic','reports.polygenic'] loop
   if private.path_b_result_read_v1(p_account_id,s.id,selected)='{"allowed":true,"gate":"ready"}'::jsonb then
    purposes:=purposes||to_jsonb(selected); end if;
  end loop;
  if purposes='[]'::jsonb then continue; end if;
  item:=jsonb_build_object('subjectId',s.id,'label',s.display_label,
   'direction',case when s.subject_account_id=p_account_id then 'self' else 'uploader' end,'purposes',purposes);
  -- Immutable full bindings, including grant identity/revision, are hashed
  -- server-side. A revoke/regrant can never reuse an old presentation digest.
  select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'revision',b.binding_revision,'authority',b.authority,
   'result',encode(extensions.digest(convert_to(b.result::text,'UTF8'),'sha256'),'hex')) order by b.id),'[]') into bindings
   from private.path_b_report_bindings b where b.subject_id=s.id and b.recipient_account_id=p_account_id
    and b.state='complete' and purposes ? b.purpose;
  item:=item||jsonb_build_object('receipt',encode(extensions.digest(convert_to(jsonb_build_object('item',item,
   'accountId',p_account_id,'sessionId',p_session_id,'subjectRevision',s.subject_binding_revision,
   'lifecycleRevision',s.lifecycle_revision,'bindings',bindings)::text,'UTF8'),'sha256'),'hex'));
  result:=result||jsonb_build_array(item);
  if jsonb_array_length(result)>100 then raise exception using errcode='22023',message='invalid_request'; end if;
 end loop;
 perform 1 from auth.sessions where id=p_session_id and user_id=p_account_id
  and(not_after is null or not_after>clock_timestamp());
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 return result;
end;
$$;
revoke all on function private.path_b_report_metadata_v1(uuid,uuid,uuid,boolean) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.path_b_report_metadata_v1(uuid,uuid,uuid,boolean) to service_role;
create function public.path_b_report_metadata_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,p_test_jurisdiction boolean)
returns jsonb language sql security invoker set search_path='' as $$
 select private.path_b_report_metadata_v1(p_account_id,p_session_id,p_subject_id,p_test_jurisdiction);
$$;
revoke all on function public.path_b_report_metadata_v1(uuid,uuid,uuid,boolean) from public,anon,authenticated,inherit_upload_only;
grant execute on function public.path_b_report_metadata_v1(uuid,uuid,uuid,boolean) to service_role;

create function private.capture_path_b_report_results_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,p_test_jurisdiction boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare metadata jsonb; checked jsonb; selected text; row jsonb; sources jsonb:='[]'; item jsonb; receipt text;
 f public.genome_files%rowtype;
begin
 if p_subject_id is null then raise exception using errcode='42501',message='not_found'; end if;
 metadata:=private.path_b_report_metadata_v1(p_account_id,p_session_id,p_subject_id,p_test_jurisdiction);
 if jsonb_array_length(metadata)<>1 then raise exception using errcode='42501',message='not_found'; end if;
 metadata:=metadata->0;
 for selected in select jsonb_array_elements_text(metadata->'purposes') loop
  for row in select value from jsonb_array_elements(private.path_b_report_results_v1(
   p_account_id,p_session_id,p_subject_id,selected,p_test_jurisdiction)) loop
   select * into strict f from public.genome_files where id=(row->>'fileId')::uuid and subject_id=p_subject_id for share;
   -- Display provenance only. Raw descriptors, signing sessions, grant IDs,
   -- source hashes and report execution authority never cross this boundary.
   item:=jsonb_build_object('fileId',f.id,'subjectId',p_subject_id,'purpose',selected,'completedAt',row->'completedAt',
    'source',jsonb_build_object('fileId',f.id,'fileType',f.file_type,'processedAt',f.normalization_completed_at,'snapshot',null),
    'reports',row->'result'->'reports',
    'receipt',encode(extensions.digest(convert_to(row::text,'UTF8'),'sha256'),'hex'));
   sources:=sources||jsonb_build_array(item);
   if jsonb_array_length(sources)>100 then raise exception using errcode='22023',message='invalid_request'; end if;
  end loop;
 end loop;
 if sources='[]'::jsonb then raise exception using errcode='42501',message='not_found'; end if;
 checked:=private.path_b_report_metadata_v1(p_account_id,p_session_id,p_subject_id,p_test_jurisdiction);
 if checked is distinct from jsonb_build_array(metadata) then raise exception using errcode='42501',message='not_found'; end if;
 item:=jsonb_build_object('metadata',metadata,'sources',sources);
 if octet_length(item::text)>4000000 then raise exception using errcode='22023',message='invalid_request'; end if;
 receipt:=encode(extensions.digest(convert_to(item::text,'UTF8'),'sha256'),'hex');
 return item||jsonb_build_object('receipt',receipt);
end;
$$;
revoke all on function private.capture_path_b_report_results_v1(uuid,uuid,uuid,boolean) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.capture_path_b_report_results_v1(uuid,uuid,uuid,boolean) to service_role;
create function public.capture_path_b_report_results_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,p_test_jurisdiction boolean)
returns jsonb language sql security invoker set search_path='' as $$
 select private.capture_path_b_report_results_v1(p_account_id,p_session_id,p_subject_id,p_test_jurisdiction);
$$;
revoke all on function public.capture_path_b_report_results_v1(uuid,uuid,uuid,boolean) from public,anon,authenticated,inherit_upload_only;
grant execute on function public.capture_path_b_report_results_v1(uuid,uuid,uuid,boolean) to service_role;

create function private.confirm_path_b_report_results_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,p_receipt text,p_test_jurisdiction boolean)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if p_receipt is null or p_receipt!~'^[0-9a-f]{64}$' then raise exception using errcode='22023',message='invalid_request'; end if;
 return private.capture_path_b_report_results_v1(p_account_id,p_session_id,p_subject_id,p_test_jurisdiction)->>'receipt'=p_receipt;
exception when insufficient_privilege then return false;
end;
$$;
revoke all on function private.confirm_path_b_report_results_v1(uuid,uuid,uuid,text,boolean) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.confirm_path_b_report_results_v1(uuid,uuid,uuid,text,boolean) to service_role;
create function public.confirm_path_b_report_results_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,p_receipt text,p_test_jurisdiction boolean)
returns boolean language sql security invoker set search_path='' as $$
 select private.confirm_path_b_report_results_v1(p_account_id,p_session_id,p_subject_id,p_receipt,p_test_jurisdiction);
$$;
revoke all on function public.confirm_path_b_report_results_v1(uuid,uuid,uuid,text,boolean) from public,anon,authenticated,inherit_upload_only;
grant execute on function public.confirm_path_b_report_results_v1(uuid,uuid,uuid,text,boolean) to service_role;

-- A stale oldest normalization admission must not starve every later current
-- source. Only that stale exact queued job is terminalized; no source or
-- genetic result is read/published and an internal error still aborts.
do $patch$
declare body text:=pg_get_functiondef('private.path_b_normalization_v1(text,uuid,text,uuid,jsonb,boolean)'::regprocedure);
 old_fragment text:=$old$select w.* into j from public.worker_jobs w
  where w.status='queued' and w.kind='annotate_vcf' and w.output_kind='ingest.normalize'
   and w.computation_revision='path-b-normalization-v1' and w.not_before<=clock_timestamp()
   and w.attempts<w.max_attempts order by w.created_at,w.id for update of w skip locked limit 1;$old$;
 new_fragment text:=$new$for j in select w.* from public.worker_jobs w
   where w.status='queued' and w.kind='annotate_vcf' and w.output_kind='ingest.normalize'
    and w.computation_revision='path-b-normalization-v1' and w.not_before<=clock_timestamp()
    and w.attempts<w.max_attempts order by w.created_at,w.id for update of w skip locked limit 100
  loop
   begin
    c:=private.path_b_normalization_authority_v1(j.file_id,'worker-claim');
    if j.payload is distinct from jsonb_build_object('authority',c) then
     raise exception using errcode='42501',message='not_found'; end if;
    exit;
   exception when insufficient_privilege then
    update public.worker_jobs set status='cancelled',finished_at=clock_timestamp(),claim_token_hash=null,
     claim_expires_at=null,error='path_b_normalization_cancelled' where id=j.id;
    j:=null;
   end;
  end loop;$new$;
begin
 if(length(body)-length(replace(body,old_fragment,'')))/length(old_fragment)<>1 then
  raise exception using errcode='55000',message='path_b_normalization_claim_body_changed'; end if;
 execute replace(body,old_fragment,new_fragment);
end;
$patch$;
