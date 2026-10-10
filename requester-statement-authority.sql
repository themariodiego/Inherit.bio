-- SOURCE ONLY, after V3 definitions. No migration number or activation.
-- The outer unconditional pre-DDL fence remains in unbound-source-candidate.sql.
-- This explicit owner-only TEST scope is configuration, never claimant authority.
create table private.new_requester_statement_test_scope (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 test_environment_binding uuid,
 check((not enabled and test_environment_binding is null) or(enabled and test_environment_binding is not null))
);
insert into private.new_requester_statement_test_scope(singleton) values(true);
alter table private.new_requester_statement_test_scope enable row level security;
revoke all on table private.new_requester_statement_test_scope from public,anon,authenticated,service_role,inherit_upload_only;

create function private.requester_statement_test_enabled_v1()
returns boolean language sql stable security definer set search_path='' as $body$
 select coalesce((select enabled and test_environment_binding is not null
  from private.new_requester_statement_test_scope where singleton),false)
$body$;
revoke all on function private.requester_statement_test_enabled_v1()
 from public,anon,authenticated,service_role,inherit_upload_only;

-- Existing actual approved-release rights and export action are the ownership
-- door. A case UUID, reviewer assignment, parent role or account cannot replace it.
create function private.current_requester_statement_session_v1(p_hash text)
returns public.rights_sessions language plpgsql security definer set search_path='' set lock_timeout='250ms' as $body$
declare rs public.rights_sessions;
begin
 if not private.requester_statement_test_enabled_v1() then
  raise exception using errcode='42501',message='not_found';end if;
 rs:=private.future_person_rights_session_v1(p_hash,false);
 if rs.id is null then raise exception using errcode='42501',message='not_found';end if;
 -- Lock the actual subject first, then the exact session and its existing
 -- release/token/principal/contact/custody rows. GET writes no row or nonce.
 perform 1 from public.subjects where id=rs.target_id for share;
 perform 1 from public.rights_sessions where id=rs.id for share;
 perform 1 from public.token_hashes where id=rs.token_hash_id for share;
 perform 1 from public.future_person_claim_release_credentials where candidate_id in(
  select candidate_id from public.token_hashes where id=rs.token_hash_id) order by id for share;
 perform 1 from public.future_person_claimant_principals where principal_id=rs.principal_id order by id for share;
 perform 1 from public.subject_principals where id=rs.principal_id for share;
 perform 1 from public.encrypted_contact_references where id in(
  select contact_reference_id from public.future_person_claim_release_credentials where candidate_id in(
   select candidate_id from public.token_hashes where id=rs.token_hash_id)) order by id for share;
 perform 1 from private.future_person_custody_slices where subject_id=rs.target_id for share;
 rs:=private.future_person_rights_session_v1(p_hash,false);
 if rs.id is null or not private.rights_action_permitted_v1(rs.purpose,'export','api.future-person-export') then
  raise exception using errcode='42501',message='not_found';end if;
 return rs;
end $body$;
revoke all on function private.current_requester_statement_session_v1(text)
 from public,anon,authenticated,service_role,inherit_upload_only;

create function private.current_requester_correction_statement_v1(p_hash text,p_id uuid)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' set lock_timeout='250ms' as $body$
declare rs public.rights_sessions; c public.correction_requests; e private.new_correction_case_envelopes;
 s public.subjects; sp public.subject_principals; scope jsonb; capture jsonb; binding jsonb;
begin
 rs:=private.current_requester_statement_session_v1(p_hash);
 select * into c from public.correction_requests where id=p_id and subject_id=rs.target_id for share;
 select * into e from private.new_correction_case_envelopes where correction_id=c.id for share;
 select * into s from public.subjects where id=rs.target_id for share;
 select * into sp from public.subject_principals where id=rs.principal_id for share;
 scope:=jsonb_build_object('version',1,'caseKind','correction','caseId',c.id,
  'originalAuthorPrincipalId',rs.principal_id,'initialStatementRevision',1,
  'originalSubmittedAt',c.submitted_at,'originalDeadline',c.review_deadline,
  'requestedField',c.requested_field,'originalSubjectId',rs.target_id);
 if c.id is null or c.review_case_format is distinct from 'reviewer-only-case-statement-v1'
  or c.claimant_principal_id is distinct from rs.principal_id
  or c.review_case_binding->'scope' is distinct from scope
  or c.correction_revision<>1 or c.state not in('submitted','reviewing')
  or c.terminal_shredded_at is not null or c.review_deadline<=clock_timestamp()
  or c.review_deadline is distinct from c.submitted_at+interval '30 days'
  or e.correction_id is null or e.wrapped_case_key is null
  or e.statement_ciphertext is null or e.working_ciphertext is null then
  raise exception using errcode='42501',message='not_found';end if;
 -- This is the actual complete export source receipt. No hash grants access.
 capture:=private.future_person_export_capture_before_requester_statement_v1(p_hash);
 binding:=jsonb_build_object('rightsSessionId',rs.id,'principalId',rs.principal_id,'subjectId',rs.target_id,
  'authorityRevision',rs.authority_revision,'tokenHashId',rs.token_hash_id,
  'principalRevision',sp.principal_revision,'lifecycleRevision',s.lifecycle_revision,
  'bindingRevision',s.subject_binding_revision,'sourceReceipt',capture#>>'{authority,authorityReceipt}',
  'caseHash',encode(extensions.digest(jsonb_build_object('case',to_jsonb(c),'envelope',to_jsonb(e))::text,'sha256'),'hex'));
 return jsonb_build_object('scope',scope,'binding',binding,'envelope',jsonb_build_object(
  'format',c.review_case_format,'statementCiphertextHex',encode(e.statement_ciphertext,'hex'),
  'workingCiphertextHex',encode(e.working_ciphertext,'hex'),'wrappedCaseKeyHex',encode(e.wrapped_case_key,'hex')));
end $body$;
revoke all on function private.current_requester_correction_statement_v1(text,uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;

create function public.read_requester_correction_statement_v1(p_hash text,p_id uuid)
returns jsonb language sql security definer set search_path='' as $body$
 select private.current_requester_correction_statement_v1(p_hash,p_id)
$body$;
create function public.check_requester_correction_statement_v1(p_hash text,p_id uuid,p_expected jsonb)
returns boolean language plpgsql security definer set search_path='' as $body$
declare current_frame jsonb;
begin
 current_frame:=private.current_requester_correction_statement_v1(p_hash,p_id);
 if p_expected is null or current_frame->'binding' is distinct from p_expected then
  raise exception using errcode='42501',message='not_found';end if;
 return true;
end $body$;
revoke all on function public.read_requester_correction_statement_v1(text,uuid),
 public.check_requester_correction_statement_v1(text,uuid,jsonb)
 from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.read_requester_correction_statement_v1(text,uuid),
 public.check_requester_correction_statement_v1(text,uuid,jsonb) to service_role;
