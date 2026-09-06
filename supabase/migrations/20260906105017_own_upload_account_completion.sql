alter table public.account_operation_nonces drop constraint account_operation_nonces_operation_check;
alter table public.account_operation_nonces add constraint account_operation_nonces_operation_check
 check(operation in ('account_delete','account_delete_cancel','own_upload_artifact_sign','own_account_completion'));

create function private.own_upload_context_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare
 p public.profiles%rowtype;
 s public.subjects%rowtype;
 b public.subject_account_bindings%rowtype;
begin
 perform 1 from auth.users u where u.id=p_account_id and u.deleted_at is null for share;
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 perform 1 from auth.sessions a where a.id=p_session_id and a.user_id=p_account_id
  and (a.not_after is null or a.not_after>clock_timestamp()) for share;
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 select * into p from public.profiles where id=p_account_id for update;
 if p.id is null or p.deletion_requested_at is not null then
  raise exception using errcode='42501',message='not_found'; end if;
 select * into s from public.subjects where id=p_subject_id for share;
 if s.id is null or s.subject_account_id is distinct from p_account_id
  or s.subject_class not in ('self','other_adult') or s.lifecycle not in ('active','claimed_bound') then
  raise exception using errcode='42501',message='not_found'; end if;
 select sab.* into b from public.subject_account_bindings sab
  join public.subject_principals sp on sp.id=sab.subject_principal_id
   and sp.subject_id=s.id and sp.account_id=p_account_id
   and sp.principal_kind='account_subject' and sp.status='active'
  where sab.subject_id=s.id and sab.account_id=p_account_id and sab.status='current'
  for share of sab,sp;
 if b.id is null then raise exception using errcode='42501',message='not_found'; end if;
 return jsonb_build_object('accountRevision',p.account_revision,'authSessionRevision',p.auth_session_revision,
  'jurisdictionRevision',p.jurisdiction_revision,'subjectBindingRevision',s.subject_binding_revision,
  'accountBindingRevision',b.binding_revision,'birthDateState',case
   when p.date_of_birth is null then 'missing'
   when p.date_of_birth<=(timezone('UTC',clock_timestamp())::date-interval '18 years')::date then 'adult'
   else 'underage' end);
end;
$function$;

create function private.issue_own_upload_nonce_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,p_account_revision bigint,
 p_auth_session_revision bigint,p_jurisdiction_revision bigint,p_subject_binding_revision bigint,
 p_account_binding_revision bigint,
 p_operation text,p_nonce_hash text,p_expires_at timestamptz)
returns void language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare c jsonb;
begin
 c:=private.own_upload_context_v1(p_account_id,p_session_id,p_subject_id);
 if (c-'birthDateState') is distinct from jsonb_build_object('accountRevision',p_account_revision,'authSessionRevision',p_auth_session_revision,
 'jurisdictionRevision',p_jurisdiction_revision,'subjectBindingRevision',p_subject_binding_revision,
 'accountBindingRevision',p_account_binding_revision) then
  raise exception using errcode='42501',message='not_found'; end if;
 if p_operation is null or p_operation not in ('own_upload_artifact_sign','own_account_completion')
  or p_nonce_hash is null or p_nonce_hash!~'^[0-9a-f]{64}$'
  or p_expires_at is null or p_expires_at<=clock_timestamp()
  or p_expires_at>clock_timestamp()+interval '10 minutes' then
  raise exception using errcode='22023',message='invalid_request'; end if;
 if (p_operation='own_account_completion' and c->>'birthDateState'<>'missing')
  or (p_operation='own_upload_artifact_sign' and c->>'birthDateState'<>'adult') then
  raise exception using errcode='55000',message='account_completion_required'; end if;
 delete from public.account_operation_nonces where account_id=p_account_id
  and operation in ('own_upload_artifact_sign','own_account_completion') and expires_at<=clock_timestamp();
 insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
  values(p_nonce_hash,p_account_id,p_session_id,p_operation,p_expires_at);
end;
$function$;

create function private.complete_own_upload_account_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,p_account_revision bigint,
 p_auth_session_revision bigint,p_jurisdiction_revision bigint,p_subject_binding_revision bigint,
 p_account_binding_revision bigint,p_date_of_birth date,p_nonce_hash text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare c jsonb; n public.account_operation_nonces%rowtype;
begin
 c:=private.own_upload_context_v1(p_account_id,p_session_id,p_subject_id);
 if (c-'birthDateState') is distinct from jsonb_build_object('accountRevision',p_account_revision,'authSessionRevision',p_auth_session_revision,
 'jurisdictionRevision',p_jurisdiction_revision,'subjectBindingRevision',p_subject_binding_revision,
 'accountBindingRevision',p_account_binding_revision) then
  raise exception using errcode='42501',message='not_found'; end if;
 if c->>'birthDateState'<>'missing' then
  raise exception using errcode='55000',message='account_already_completed'; end if;
 if p_date_of_birth is null or p_date_of_birth>(timezone('UTC',clock_timestamp())::date-interval '18 years')::date then
  raise exception using errcode='22023',message='adult_account_required'; end if;
 select * into n from public.account_operation_nonces where nonce_hash=p_nonce_hash for update;
 if n.nonce_hash is null or n.account_id is distinct from p_account_id or n.session_id is distinct from p_session_id
  or n.operation<>'own_account_completion' or n.consumed_at is not null or n.expires_at<=clock_timestamp() then
  raise exception using errcode='42501',message='not_found'; end if;
 update public.account_operation_nonces set consumed_at=clock_timestamp() where nonce_hash=p_nonce_hash;
 update public.profiles set date_of_birth=p_date_of_birth,account_revision=account_revision+1 where id=p_account_id;
 return jsonb_build_object('status','completed');
end;
$function$;

revoke all on function private.own_upload_context_v1(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function private.own_upload_context_v1(uuid,uuid,uuid) to service_role;
create function public.own_upload_context_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid)
returns jsonb language sql security invoker set search_path=pg_catalog
as $function$ select private.own_upload_context_v1(p_account_id,p_session_id,p_subject_id); $function$;
revoke all on function public.own_upload_context_v1(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.own_upload_context_v1(uuid,uuid,uuid) to service_role;

revoke all on function private.issue_own_upload_nonce_v1(uuid,uuid,uuid,bigint,bigint,bigint,bigint,bigint,text,text,timestamptz) from public,anon,authenticated;
grant execute on function private.issue_own_upload_nonce_v1(uuid,uuid,uuid,bigint,bigint,bigint,bigint,bigint,text,text,timestamptz) to service_role;
create function public.issue_own_upload_nonce_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,p_account_revision bigint,
 p_auth_session_revision bigint,p_jurisdiction_revision bigint,p_subject_binding_revision bigint,
 p_account_binding_revision bigint,p_operation text,p_nonce_hash text,p_expires_at timestamptz)
returns void language sql security invoker set search_path=pg_catalog
as $function$ select private.issue_own_upload_nonce_v1(p_account_id,p_session_id,p_subject_id,p_account_revision,p_auth_session_revision,p_jurisdiction_revision,p_subject_binding_revision,p_account_binding_revision,p_operation,p_nonce_hash,p_expires_at); $function$;
revoke all on function public.issue_own_upload_nonce_v1(uuid,uuid,uuid,bigint,bigint,bigint,bigint,bigint,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.issue_own_upload_nonce_v1(uuid,uuid,uuid,bigint,bigint,bigint,bigint,bigint,text,text,timestamptz) to service_role;

revoke all on function private.complete_own_upload_account_v1(uuid,uuid,uuid,bigint,bigint,bigint,bigint,bigint,date,text) from public,anon,authenticated;
grant execute on function private.complete_own_upload_account_v1(uuid,uuid,uuid,bigint,bigint,bigint,bigint,bigint,date,text) to service_role;
create function public.complete_own_upload_account_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,p_account_revision bigint,
 p_auth_session_revision bigint,p_jurisdiction_revision bigint,p_subject_binding_revision bigint,
 p_account_binding_revision bigint,p_date_of_birth date,p_nonce_hash text)
returns jsonb language sql security invoker set search_path=pg_catalog
as $function$ select private.complete_own_upload_account_v1(p_account_id,p_session_id,p_subject_id,p_account_revision,p_auth_session_revision,p_jurisdiction_revision,p_subject_binding_revision,p_account_binding_revision,p_date_of_birth,p_nonce_hash); $function$;
revoke all on function public.complete_own_upload_account_v1(uuid,uuid,uuid,bigint,bigint,bigint,bigint,bigint,date,text) from public,anon,authenticated;
grant execute on function public.complete_own_upload_account_v1(uuid,uuid,uuid,bigint,bigint,bigint,bigint,bigint,date,text) to service_role;
