-- SOURCE ONLY. The existing own-account actor and actual claimed-bound
-- binding supply ownership. An uploader/parent/reviewer role is insufficient.
create function private.current_account_correction_statement_v1(p_origin jsonb,p_id uuid)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' set lock_timeout='250ms' as $body$
declare actor jsonb; source jsonb; c public.correction_requests; e private.new_correction_case_envelopes;
 b private.future_person_account_bindings; s public.subjects; sp public.subject_principals; scope jsonb;
begin
 if not private.requester_statement_test_enabled_v1() or p_origin->>'kind' is distinct from 'account'
  or jsonb_typeof(p_origin)<>'object' or (select count(*) from jsonb_object_keys(p_origin))<>3 then
  raise exception using errcode='42501',message='not_found';end if;
 actor:=private.future_person_archive_account_actor_v1((p_origin->>'accountId')::uuid,(p_origin->>'sessionId')::uuid);
 if actor is null then raise exception using errcode='42501',message='not_found';end if;
 select * into c from public.correction_requests where id=p_id;
 perform 1 from public.subjects where id=c.subject_id for share;
 select * into b from private.future_person_account_bindings where subject_id=c.subject_id
  and account_id=(actor->>'accountId')::uuid for share;
 source:=private.future_person_bound_source_for_actor_v1(c.subject_id,clock_timestamp()+interval '30 seconds',actor);
 select * into s from public.subjects where id=c.subject_id for share;
 select * into sp from public.subject_principals where id=b.subject_principal_id for share;
 select * into c from public.correction_requests where id=p_id for share;
 select * into e from private.new_correction_case_envelopes where correction_id=c.id for share;
 scope:=jsonb_build_object('version',1,'caseKind','correction','caseId',c.id,
  'originalAuthorPrincipalId',b.subject_principal_id,'initialStatementRevision',1,
  'originalSubmittedAt',c.submitted_at,'originalDeadline',c.review_deadline,
  'requestedField',c.requested_field,'originalSubjectId',s.id);
 if actor is null or source is null or b.id is null or sp.id is null or sp.status<>'active' or sp.account_id is distinct from b.account_id
  or c.claimant_principal_id is distinct from b.subject_principal_id
  or c.review_case_format is distinct from 'reviewer-only-case-statement-v1'
  or c.review_case_binding->'scope' is distinct from scope
  or c.correction_revision<>1 or c.state not in('submitted','reviewing') or c.terminal_shredded_at is not null
  or c.review_deadline<=clock_timestamp() or c.review_deadline is distinct from c.submitted_at+interval '30 days'
  or e.correction_id is null or e.wrapped_case_key is null or e.statement_ciphertext is null or e.working_ciphertext is null then
  raise exception using errcode='42501',message='not_found';end if;
 return jsonb_build_object('scope',scope,'binding',jsonb_build_object(
  'accountId',b.account_id,'sessionId',(actor->>'sessionId')::uuid,'bindingId',b.id,
  'principalId',b.subject_principal_id,'subjectId',s.id,
  'accountAuthSessionRevision',actor->'account_auth_session_revision','sessionRevision',actor->'session_revision',
  'principalRevision',sp.principal_revision,'lifecycleRevision',s.lifecycle_revision,'bindingRevision',s.subject_binding_revision,
  'sourceReceipt',encode(extensions.digest(jsonb_build_object('binding',to_jsonb(b),'fileId',source->'fileId',
   'sourceSha256',source->'sourceSha256','membershipSha256',source->'membershipSha256','publicationRevision',source->'publicationRevision')::text,'sha256'),'hex'),
  'caseHash',encode(extensions.digest(jsonb_build_object('case',to_jsonb(c),'envelope',to_jsonb(e))::text,'sha256'),'hex')),
  'envelope',jsonb_build_object('format',c.review_case_format,'statementCiphertextHex',encode(e.statement_ciphertext,'hex'),
   'workingCiphertextHex',encode(e.working_ciphertext,'hex'),'wrappedCaseKeyHex',encode(e.wrapped_case_key,'hex')));
end $body$;
revoke all on function private.current_account_correction_statement_v1(jsonb,uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;

create function private.account_correction_statement_inventory_v1(p_origin jsonb,p_capture jsonb)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $body$
declare c public.correction_requests; frame jsonb; rows jsonb:='[]'; counts jsonb; digest bytea;
 subjects uuid[]; a uuid:=(p_origin->>'accountId')::uuid; n bigint:=0; earliest timestamptz;
begin
 if not private.requester_statement_test_enabled_v1() then raise exception using errcode='42501',message='not_found';end if;
 select array_agg(x::uuid order by x) into subjects from jsonb_array_elements_text(p_capture#>'{authority,subjectPartitions}')x;
 -- Complete actual class census. Nonempty unregistered legacy input is refused;
 -- its ciphertext, identity and retention are never reinterpreted.
 if exists(select 1 from public.appeal_intakes where appellant_account_id=a or appellant_principal_id in(
   select id from public.subject_principals where account_id=a)) then
  raise exception using errcode='0A000',message='requester_appeal_format_unavailable';end if;
 digest:=extensions.digest(convert_to('test-account-own-statements-v1','UTF8'),'sha256');
 for c in select * from public.correction_requests where subject_id=any(subjects)
  or claimant_principal_id in(select id from public.subject_principals where account_id=a) order by id for share loop
  if c.review_case_format is distinct from 'reviewer-only-case-statement-v1'
   or not(c.subject_id=any(subjects)) then raise exception using errcode='0A000',message='requester_statement_format_unavailable';end if;
  if c.state in('submitted','reviewing') then
   frame:=private.current_account_correction_statement_v1(p_origin,c.id);
   n:=n+1;earliest:=least(earliest,c.review_deadline);
   rows:=rows||jsonb_build_array(jsonb_build_object('correctionId',c.id,'subjectId',c.subject_id,
    'caseHash',frame#>>'{binding,caseHash}','originalDeadline',c.review_deadline));
   digest:=extensions.digest(digest||convert_to(c.id::text||':'||(frame->'binding')::text||E'\n','UTF8'),'sha256');
  elsif c.state not in('rejected','withdrawn','expired') or c.terminal_shredded_at is null
   or exists(select 1 from private.new_correction_case_envelopes where correction_id=c.id) then
   raise exception using errcode='42501',message='not_found';end if;
 end loop;
 select coalesce(jsonb_agg(jsonb_build_object('subjectId',subject,'rows',amount) order by subject),'[]') into counts from(
  select x->>'subjectId' subject,count(*) amount from jsonb_array_elements(rows)x group by x->>'subjectId')grouped;
 return jsonb_build_object('version','test-account-own-statements-v1','corrections',n,'appeals',0,
  'membershipSha256',encode(digest,'hex'),'originalDeadline',earliest,'partitions',counts,'cases',rows);
end $body$;
revoke all on function private.account_correction_statement_inventory_v1(jsonb,jsonb)
 from public,anon,authenticated,service_role,inherit_upload_only;

alter function private.export_account_owned_capture_pre_classes_v1(jsonb,text,uuid)
 rename to export_account_owned_capture_before_requester_statement_v1;
revoke all on function private.export_account_owned_capture_before_requester_statement_v1(jsonb,text,uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;
create function private.export_account_owned_capture_pre_classes_v1(p_origin jsonb,p_target_kind text,p_target_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $body$
declare captured jsonb; inventory jsonb; receipt text;
begin
 captured:=private.export_account_owned_capture_before_requester_statement_v1(p_origin,p_target_kind,p_target_id);
 if p_target_kind<>'account' or not private.requester_statement_test_enabled_v1() then return captured;end if;
 inventory:=private.account_correction_statement_inventory_v1(p_origin,captured);
 receipt:=encode(extensions.digest(jsonb_build_object('version','test-account-own-statements-capture-v1',
  'capture',captured,'ownStatements',inventory)::text,'sha256'),'hex');
 return jsonb_set(captured,'{authority,authorityReceipt}',to_jsonb(receipt))||jsonb_build_object('ownStatements',inventory-'cases');
end $body$;
revoke all on function private.export_account_owned_capture_pre_classes_v1(jsonb,text,uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;

alter function public.export_archive_request_v1(text,jsonb,text,uuid,jsonb,text)
 rename to export_archive_request_before_requester_statement_v1;
revoke all on function public.export_archive_request_before_requester_statement_v1(text,jsonb,text,uuid,jsonb,text)
 from public,anon,authenticated,service_role,inherit_upload_only;
create function public.export_archive_request_v1(p_operation text,p_origin jsonb,p_target_kind text,p_target_id uuid,
 p_payload jsonb default null,p_csrf_binding text default null)
returns jsonb language plpgsql security definer set search_path='' as $body$
declare result jsonb; inventory jsonb; task_export_id uuid; deadline_at timestamptz;
begin
 result:=public.export_archive_request_before_requester_statement_v1(p_operation,p_origin,p_target_kind,p_target_id,p_payload,p_csrf_binding);
 if p_operation='create' and p_target_kind='account' and private.requester_statement_test_enabled_v1() then
  inventory:=private.account_correction_statement_inventory_v1(p_origin,
   private.export_account_owned_capture_before_requester_statement_v1(p_origin,p_target_kind,p_target_id));
  task_export_id:=(result->>'exportId')::uuid;
  insert into private.new_correction_archive_cases(export_id,correction_id,original_deadline,case_hash,original_author_principal_id,origin_account_id)
  select task_export_id,(x->>'correctionId')::uuid,(x->>'originalDeadline')::timestamptz,x->>'caseHash',
   (private.current_account_correction_statement_v1(p_origin,(x->>'correctionId')::uuid)#>>'{binding,principalId}')::uuid,(p_origin->>'accountId')::uuid
   from jsonb_array_elements(inventory->'cases')x;
  deadline_at:=(inventory->>'originalDeadline')::timestamptz;
  if deadline_at is not null then update private.export_archive_jobs
   set deadline=least(deadline,deadline_at) where export_id=task_export_id;end if;
 end if;
 return result;
end $body$;
revoke all on function public.export_archive_request_v1(text,jsonb,text,uuid,jsonb,text)
 from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.export_archive_request_v1(text,jsonb,text,uuid,jsonb,text) to service_role;

alter function public.export_archive_account_classes_v1(text,uuid,uuid,text,text,uuid)
 rename to export_archive_account_classes_before_requester_statement_v1;
revoke all on function public.export_archive_account_classes_before_requester_statement_v1(text,uuid,uuid,text,text,uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;
create function public.export_archive_account_classes_v1(p_operation text,p_export_id uuid,p_attempt_id uuid,
 p_authority_receipt text,p_kind text default null,p_after_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $body$
declare result jsonb; permit jsonb; captured jsonb;
begin
 result:=public.export_archive_account_classes_before_requester_statement_v1(p_operation,p_export_id,p_attempt_id,p_authority_receipt,p_kind,p_after_id);
 if p_operation='context' and private.requester_statement_test_enabled_v1() then
  permit:=private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt);
  captured:=private.export_account_owned_capture_v1(permit->'origin','account',(permit->>'targetId')::uuid);
  result:=result||jsonb_build_object('ownStatements',captured->'ownStatements');
 end if;
 return result;
end $body$;
revoke all on function public.export_archive_account_classes_v1(text,uuid,uuid,text,text,uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.export_archive_account_classes_v1(text,uuid,uuid,text,text,uuid) to service_role;

alter function public.export_archive_account_members_v1(text,uuid,uuid,text,uuid,text)
 rename to export_archive_account_members_before_requester_statement_v1;
revoke all on function public.export_archive_account_members_before_requester_statement_v1(text,uuid,uuid,text,uuid,text)
 from public,anon,authenticated,service_role,inherit_upload_only;
create function public.export_archive_account_members_v1(p_operation text,p_export_id uuid,p_attempt_id uuid,
 p_authority_receipt text,p_subject_id uuid default null,p_after_id text default null)
returns jsonb language plpgsql security definer set search_path='' as $body$
declare permit jsonb; captured jsonb; inventory jsonb; row record; frame jsonb; rows jsonb:='[]'; n integer:=0; last_id uuid;
begin
 if p_operation<>'own-statements' then return public.export_archive_account_members_before_requester_statement_v1(
  p_operation,p_export_id,p_attempt_id,p_authority_receipt,p_subject_id,p_after_id);end if;
 permit:=private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt);
 if permit->>'targetKind'<>'account' or not private.requester_statement_test_enabled_v1() then
  raise exception using errcode='42501',message='not_found';end if;
 captured:=private.export_account_owned_capture_v1(permit->'origin','account',(permit->>'targetId')::uuid);
 inventory:=private.account_correction_statement_inventory_v1(permit->'origin',captured);
 if inventory->'cases' is distinct from(select coalesce(jsonb_agg(jsonb_build_object('correctionId',b.correction_id,
  'subjectId',c.subject_id,'caseHash',b.case_hash,'originalDeadline',b.original_deadline) order by b.correction_id),'[]')
  from private.new_correction_archive_cases b join public.correction_requests c on c.id=b.correction_id where b.export_id=p_export_id)
  or exists(select 1 from private.new_correction_archive_cases where export_id=p_export_id and state<>'active') then
  raise exception using errcode='42501',message='not_found';end if;
 for row in select b.correction_id from private.new_correction_archive_cases b join public.correction_requests c on c.id=b.correction_id
  where b.export_id=p_export_id and c.subject_id=p_subject_id
   and(p_after_id is null or b.correction_id>p_after_id::uuid) order by b.correction_id limit 32 loop
  frame:=private.current_account_correction_statement_v1(permit->'origin',row.correction_id);
  rows:=rows||jsonb_build_array(jsonb_build_object('id',row.correction_id,'frame',frame));n:=n+1;last_id:=row.correction_id;
 end loop;
 perform private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt);
 return jsonb_build_object('rows',rows,'count',n,'nextAfterId',last_id);
end $body$;
revoke all on function public.export_archive_account_members_v1(text,uuid,uuid,text,uuid,text)
 from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.export_archive_account_members_v1(text,uuid,uuid,text,uuid,text) to service_role;
