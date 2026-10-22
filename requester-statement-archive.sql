-- SOURCE ONLY. Real existing claimant archive composition; no provider adapter
-- is relabeled and no opaque appeal/correction row is adopted.
alter function private.future_person_export_capture_v1(text)
 rename to future_person_export_capture_before_requester_statement_v1;
revoke all on function private.future_person_export_capture_before_requester_statement_v1(text)
 from public,anon,authenticated,service_role,inherit_upload_only;

create table private.new_correction_archive_cases (
 export_id uuid not null references private.export_archive_jobs(export_id) on delete restrict,
 correction_id uuid not null references public.correction_requests(id) on delete restrict,
 original_deadline timestamptz not null,
 original_author_principal_id uuid not null references public.subject_principals(id) on delete restrict,
 origin_account_id uuid references auth.users(id) on delete restrict,
 case_hash text not null check(case_hash~'^[0-9a-f]{64}$'),
 state text not null default 'active' check(state in('active','closing')),
 created_at timestamptz not null default clock_timestamp(),
 primary key(export_id,correction_id)
);
create table private.new_correction_archive_runs (
 id uuid primary key default gen_random_uuid(),
 export_id uuid not null references private.export_archive_jobs(export_id) on delete restrict,
 attempt_id uuid not null references private.export_archive_attempts(id) on delete restrict,
 nonce_hash text not null unique check(nonce_hash~'^[0-9a-f]{64}$'),
 state text not null default 'active' check(state in('active','cancellation-requested','buffers-zeroed')),
 started_at timestamptz not null default clock_timestamp(),
 original_deadline timestamptz not null,
 buffers_zeroed_at timestamptz,
 check((state='buffers-zeroed')=(buffers_zeroed_at is not null))
);
create table private.new_correction_archive_provider_dispositions (
 attempt_id uuid not null,
 ordinal bigint not null,
 reservation_hash text not null check(reservation_hash~'^[0-9a-f]{64}$'),
 backend text not null,
 immutable_evidence jsonb not null check(jsonb_typeof(immutable_evidence)='object'),
 recorded_at timestamptz not null default clock_timestamp(),
 primary key(attempt_id,ordinal),
 foreign key(attempt_id,ordinal) references private.export_archive_segments(attempt_id,ordinal) on delete restrict
);
do $private_tables$
declare name text;
begin
 foreach name in array array['new_correction_archive_cases','new_correction_archive_runs','new_correction_archive_provider_dispositions'] loop
  execute format('alter table private.%I enable row level security',name);
  execute format('revoke all on table private.%I from public,anon,authenticated,service_role,inherit_upload_only',name);
 end loop;
end $private_tables$;

create function private.requester_correction_statement_inventory_v1(p_hash text)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $body$
declare rs public.rights_sessions; c public.correction_requests; frame jsonb;
 rows jsonb:='[]'; digest bytea; earliest timestamptz; n integer:=0;
begin
 rs:=private.current_requester_statement_session_v1(p_hash);
 -- Census the actual requester principal. Subject control alone does not make
 -- a foreign person's prose the requester's statement. Unknown owned legacy
 -- classes fail the complete TEST archive before its first byte reservation.
 if exists(select 1 from public.appeal_intakes where appellant_principal_id=rs.principal_id)
  or exists(select 1 from public.correction_requests where claimant_principal_id=rs.principal_id
   and review_case_format is distinct from 'reviewer-only-case-statement-v1') then
  raise exception using errcode='0A000',message='requester_statement_format_unavailable';end if;
 digest:=extensions.digest(convert_to('test-requester-own-statements-v1','UTF8'),'sha256');
 for c in select * from public.correction_requests where subject_id=rs.target_id
  and review_case_format='reviewer-only-case-statement-v1' order by id for share loop
  if c.state in('submitted','reviewing') then
   frame:=private.current_requester_correction_statement_v1(p_hash,c.id);
   n:=n+1;earliest:=least(earliest,c.review_deadline);
   rows:=rows||jsonb_build_array(jsonb_build_object('correctionId',c.id,'caseHash',frame#>>'{binding,caseHash}',
    'originalDeadline',c.review_deadline));
   digest:=extensions.digest(digest||convert_to(c.id::text||':'||(frame->'binding')::text||E'\n','UTF8'),'sha256');
  elsif c.state not in('rejected','withdrawn','expired') or c.terminal_shredded_at is null
   or exists(select 1 from private.new_correction_case_envelopes where correction_id=c.id) then
   raise exception using errcode='42501',message='not_found';end if;
 end loop;
 return jsonb_build_object('version','test-requester-own-statements-v1','corrections',n,'appeals',0,
  'membershipSha256',encode(digest,'hex'),'originalDeadline',earliest,'cases',rows);
end $body$;
revoke all on function private.requester_correction_statement_inventory_v1(text)
 from public,anon,authenticated,service_role,inherit_upload_only;

create function private.future_person_export_capture_v1(p_session_hash text)
returns jsonb language plpgsql security definer set search_path='' as $body$
declare captured jsonb; own jsonb; receipt text;
begin
 captured:=private.future_person_export_capture_before_requester_statement_v1(p_session_hash);
 if not private.requester_statement_test_enabled_v1() then return captured;end if;
 own:=private.requester_correction_statement_inventory_v1(p_session_hash);
 receipt:=encode(extensions.digest(jsonb_build_object('version','test-requester-archive-capture-v1',
  'originalCapture',captured,'ownStatements',own)::text,'sha256'),'hex');
 return jsonb_set(captured,'{authority,authorityReceipt}',to_jsonb(receipt))
  ||jsonb_build_object('ownStatements',own-'cases');
end $body$;
revoke all on function private.future_person_export_capture_v1(text)
 from public,anon,authenticated,service_role,inherit_upload_only;

-- The actual create/nonce/currentness transaction creates the case bindings.
-- Every archive deadline is clamped, never extended, to its earliest case.
alter function public.future_person_export_request_v1(text,text,jsonb,text)
 rename to future_person_export_request_before_requester_statement_v1;
revoke all on function public.future_person_export_request_before_requester_statement_v1(text,text,jsonb,text)
 from public,anon,authenticated,service_role,inherit_upload_only;
create function public.future_person_export_request_v1(p_operation text,p_session_hash text,p_payload jsonb default null,p_csrf_binding text default null)
returns jsonb language plpgsql security definer set search_path='' as $body$
declare result jsonb; inventory jsonb; task_export_id uuid; original_deadline timestamptz;
begin
 result:=public.future_person_export_request_before_requester_statement_v1(p_operation,p_session_hash,p_payload,p_csrf_binding);
 if p_operation='create' and private.requester_statement_test_enabled_v1() then
  inventory:=private.requester_correction_statement_inventory_v1(p_session_hash);
  task_export_id:=(result->>'exportId')::uuid;
  insert into private.new_correction_archive_cases(export_id,correction_id,original_deadline,case_hash,original_author_principal_id,origin_account_id)
  select task_export_id,(x->>'correctionId')::uuid,(x->>'originalDeadline')::timestamptz,x->>'caseHash',
   (private.current_requester_statement_session_v1(p_session_hash)).principal_id,null
   from jsonb_array_elements(inventory->'cases')x;
  original_deadline:=(inventory->>'originalDeadline')::timestamptz;
  if original_deadline is not null then update private.export_archive_jobs
   set deadline=least(deadline,original_deadline) where export_id=task_export_id;end if;
 end if;
 return result;
end $body$;
revoke all on function public.future_person_export_request_v1(text,text,jsonb,text)
 from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.future_person_export_request_v1(text,text,jsonb,text) to service_role;

-- Preserve every old member operation behind its actual predecessor. This
-- additional operation carries internal envelopes only to the exact worker.
alter function public.future_person_export_members_v1(text,uuid,uuid,text,text)
 rename to future_person_export_members_before_requester_statement_v1;
revoke all on function public.future_person_export_members_before_requester_statement_v1(text,uuid,uuid,text,text)
 from public,anon,authenticated,service_role,inherit_upload_only;
create function public.future_person_export_members_v1(p_operation text,p_export_id uuid,p_attempt_id uuid,p_authority_receipt text,p_after_id text default null)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $body$
declare e public.generated_exports; j private.export_archive_jobs; a private.export_archive_attempts;
 rs public.rights_sessions; inventory jsonb; frame jsonb; c record; rows jsonb:='[]'; n integer:=0; last_id uuid; after_id uuid;
begin
 if p_operation is distinct from 'own-statements' then
  return public.future_person_export_members_before_requester_statement_v1(p_operation,p_export_id,p_attempt_id,p_authority_receipt,p_after_id);end if;
 perform private.export_archive_current_v1(p_export_id,p_authority_receipt);
 select * into e from public.generated_exports where id=p_export_id for share;
 select * into j from private.export_archive_jobs where export_id=e.id for share;
 rs:=private.current_requester_statement_session_v1(j.origin->>'sessionHash');
 select * into a from private.export_archive_attempts where id=p_attempt_id and export_id=e.id for share;
 if e.id is null or e.origin_kind<>'independent-rights' or e.account_id is not null
  or e.requester_principal_id is distinct from rs.principal_id or e.target_id is distinct from rs.target_id
  or e.status<>'building' or j.route_id<>'api.future-person-export' or j.export_contract<>'approved-future-person-export-v1'
  or a.id is null or j.active_attempt is distinct from a.id or a.state<>'writing'
  or a.lease_expires_at<=clock_timestamp() or a.authority_receipt is distinct from p_authority_receipt
  or exists(select 1 from private.new_correction_archive_cases where export_id=e.id and state<>'active') then
  raise exception using errcode='42501',message='not_found';end if;
 inventory:=private.requester_correction_statement_inventory_v1(j.origin->>'sessionHash');
 if inventory->'cases' is distinct from(select coalesce(jsonb_agg(jsonb_build_object('correctionId',b.correction_id,
  'caseHash',b.case_hash,'originalDeadline',b.original_deadline) order by b.correction_id),'[]')
  from private.new_correction_archive_cases b where b.export_id=e.id) then
  raise exception using errcode='42501',message='not_found';end if;
 if p_after_id is not null then after_id:=p_after_id::uuid;end if;
 for c in select correction_id from private.new_correction_archive_cases where export_id=e.id
  and(after_id is null or correction_id>after_id) order by correction_id limit 32 loop
  frame:=private.current_requester_correction_statement_v1(j.origin->>'sessionHash',c.correction_id);
  rows:=rows||jsonb_build_array(jsonb_build_object('id',c.correction_id,'frame',frame));n:=n+1;last_id:=c.correction_id;
 end loop;
 perform private.export_archive_current_v1(p_export_id,p_authority_receipt);
 return jsonb_build_object('rows',rows,'count',n,'nextAfterId',last_id);
end $body$;
revoke all on function public.future_person_export_members_v1(text,uuid,uuid,text,text)
 from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.future_person_export_members_v1(text,uuid,uuid,text,text) to service_role;
