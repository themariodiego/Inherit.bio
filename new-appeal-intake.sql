-- SOURCE ONLY. No migration ID, execution permission or production activation.
-- Requires frozen V6 as an exact source predecessor; complete native catalog,
-- constraint/trigger/ABI/ACL and purge-plan fingerprints remain UNBOUND.
begin;
set local statement_timeout='45s';
set local lock_timeout='5s';
set local jit=off;
do $unbound$ begin
 if current_user<>'postgres' then raise exception using errcode='42501',message='appeal_source_owner_required';end if;
 raise exception using errcode='55000',message='appeal_source_predecessor_unbound';
end $unbound$;

-- Original principal cases retain the exact original alternatives. A new random
-- case-only author has no account, subject, parent or service/reviewer role.
-- The exact auto-named predecessor constraints must be captured before binding.
alter table public.subject_principals drop constraint subject_principals_principal_kind_check;
alter table public.subject_principals add constraint subject_principals_principal_kind_check
 check(principal_kind in('account_subject','non_account_subject','future_person','genetic_parent','identified_donor','reviewer','service','appeal_case'));
alter table public.subject_principals drop constraint subject_principals_check;
alter table public.subject_principals add constraint subject_principals_check
 check(subject_id is not null or account_id is not null or principal_kind in('reviewer','service','appeal_case'));
alter table public.subject_principals add constraint new_appeal_case_principal_shape
 check((principal_kind<>'appeal_case' or(subject_id is null and account_id is null
  and reviewer_case_purposes is null and correction_intake_assignee is null)) is true);

-- Separate explicit purpose grant: existing correction purpose rows/predicates
-- and completed legacy claim/appeal assignments are never borrowed or changed.
create table private.new_appeal_reviewer_purposes(
 principal_id uuid primary key references public.subject_principals(id) on delete restrict,
 principal_revision bigint not null check(principal_revision>0),
 purpose text not null check(purpose='appeal'),grant_revision bigint not null check(grant_revision>0),
 intake_assignee boolean not null default false,enabled boolean not null default false
);
create unique index new_appeal_one_current_intake_assignee on private.new_appeal_reviewer_purposes(intake_assignee)
 where intake_assignee and enabled;
create table private.new_appeal_intake_keys(
 singleton boolean primary key default true check(singleton),operation_key bytea not null check(octet_length(operation_key)=32)
);
insert into private.new_appeal_intake_keys values(true,extensions.gen_random_bytes(32));
create table private.new_appeal_test_scope(
 singleton boolean primary key default true check(singleton),enabled boolean not null default false,test_environment_binding uuid,
 check((not enabled and test_environment_binding is null) or(enabled and test_environment_binding is not null))
);
insert into private.new_appeal_test_scope(singleton) values(true);

-- Legacy opaque identity and target/statement bytes stay NULL-format and exact.
-- NEW unresolved targets use NULL legacy target fields, never a guessed UUID.
alter table public.appeal_intakes alter column appellant_principal_id drop not null;
alter table public.appeal_intakes alter column target_kind drop not null;
alter table public.appeal_intakes alter column target_id drop not null;
alter table public.appeal_intakes alter column statement_ciphertext drop not null;
alter table public.appeal_intakes
 add column review_case_format text,add column intake_kind text,add column original_deadline timestamptz,
 add column current_reviewer_principal_id uuid references public.subject_principals(id) on delete restrict,
 add column reviewer_principal_revision bigint,add column reviewer_purpose_revision bigint,
 add column assignment_revision bigint,add column evidence_revision bigint,
 add column current_case_binding jsonb,add column terminal_shredded_at timestamptz,
 add column terminal_audit_principal_id uuid references public.audit_principals(id) on delete restrict;
alter table public.appeal_intakes add constraint new_appeal_format_shape check((
 (review_case_format is null and appellant_principal_id is not null and target_kind is not null and target_id is not null
  and statement_ciphertext is not null and intake_kind is null and original_deadline is null
  and current_reviewer_principal_id is null and reviewer_principal_revision is null and reviewer_purpose_revision is null
  and assignment_revision is null and evidence_revision is null and current_case_binding is null
  and terminal_shredded_at is null and terminal_audit_principal_id is null)
 or(review_case_format='reviewer-only-case-statement-v1' and target_kind is null and target_id is null and statement_ciphertext is null
  and intake_kind in('subject-objection','genetic-parent-objection','access-or-review-appeal','contradiction-suspension-appeal')
  and original_deadline=submitted_at+interval '30 days' and appeal_revision=1 and assignment_revision>0 and evidence_revision>0
  and((state in('submitted','reviewing') and appellant_principal_id is not null and current_reviewer_principal_id is not null
    and reviewer_principal_revision>0 and reviewer_purpose_revision>0 and jsonb_typeof(current_case_binding)='object'
    and terminal_shredded_at is null and terminal_audit_principal_id is null)
   or(state in('approved','rejected','withdrawn','expired') and appellant_principal_id is null and appellant_account_id is null
    and current_reviewer_principal_id is null and reviewer_principal_revision is null and reviewer_purpose_revision is null
    and current_case_binding is null and terminal_shredded_at=decided_at and terminal_audit_principal_id is not null)))
) is true);
create table private.new_appeal_case_envelopes(
 appeal_id uuid primary key references public.appeal_intakes(id) on delete restrict,
 wrapped_case_key bytea not null check(octet_length(wrapped_case_key)=72),
 statement_ciphertext bytea not null check(octet_length(statement_ciphertext) between 48 and 16028),
 working_ciphertext bytea not null check(octet_length(working_ciphertext) between 48 and 20528),
 reviewer_reason_ciphertext bytea check(reviewer_reason_ciphertext is null or octet_length(reviewer_reason_ciphertext) between 48 and 8028)
);
create table private.new_appeal_authors(
 appeal_id uuid primary key references public.appeal_intakes(id) on delete restrict,
 principal_id uuid not null unique references public.subject_principals(id) on delete restrict,
 initial_statement_revision bigint not null check(initial_statement_revision=1),
 original_submitted_at timestamptz not null,original_deadline timestamptz not null,
 check(original_deadline=original_submitted_at+interval '30 days')
);
create table private.new_appeal_intake_nonce_uses(
 nonce_hash text primary key check(nonce_hash~'^[0-9a-f]{64}$'),
 appeal_id uuid not null unique references public.appeal_intakes(id) on delete restrict,
 consumed_at timestamptz not null,expires_at timestamptz not null check(expires_at>consumed_at)
);
create table private.new_appeal_mutation_context(
 backend_pid integer not null,transaction_id bigint not null,appeal_id uuid not null,operation text not null
  check(operation in('intake','delivery','evidence','review','terminal','archive')),
 primary key(backend_pid,transaction_id,appeal_id)
);
alter table public.encrypted_contact_references add column appeal_case_id uuid references public.appeal_intakes(id) on delete restrict;
alter table public.encrypted_contact_references drop constraint encrypted_contact_references_status_check;
alter table public.encrypted_contact_references add constraint encrypted_contact_references_status_check check((
 (correction_case_id is null and appeal_case_id is null and status in('current','rotated','shredded'))
 or(correction_case_id is not null and appeal_case_id is null and status='correction-case-working')
 or(correction_case_id is null and appeal_case_id is not null and status='appeal-case-working')) is true);
alter table public.mail_outbox add column appeal_case_id uuid references public.appeal_intakes(id) on delete restrict;
alter table public.mail_provider_attempts add column appeal_case_id uuid references public.appeal_intakes(id) on delete restrict;
alter table public.mail_deliveries add column appeal_case_id uuid references public.appeal_intakes(id) on delete restrict;
create table private.new_appeal_delivery(
 appeal_id uuid primary key references public.appeal_intakes(id) on delete restrict,
 contact_reference_id uuid not null unique references public.encrypted_contact_references(id) on delete restrict,
 outbox_id uuid not null unique references public.mail_outbox(id) on delete restrict,
 candidate_id uuid not null unique references public.token_candidates(id) on delete restrict,
 retention_row_id uuid not null unique references public.retention_rows(id) on delete restrict,
 acknowledgement_target timestamptz not null,credential_deadline timestamptz not null
);
do $acl$ declare name text;begin
 foreach name in array array['new_appeal_reviewer_purposes','new_appeal_intake_keys','new_appeal_test_scope','new_appeal_case_envelopes',
  'new_appeal_authors','new_appeal_intake_nonce_uses','new_appeal_mutation_context','new_appeal_delivery'] loop
  execute format('alter table private.%I enable row level security',name);
  execute format('revoke all on table private.%I from public,anon,authenticated,service_role,inherit_upload_only',name);
 end loop;
end $acl$;

create function private.guard_new_appeal_principal_v1()
returns trigger language plpgsql security invoker set search_path='' as $body$
begin
 if tg_op='DELETE' then
  if old.principal_kind='appeal_case' and(current_user<>'postgres' or not exists(
   select 1 from private.new_appeal_mutation_context m join private.new_appeal_authors a on a.appeal_id=m.appeal_id
   where m.backend_pid=pg_backend_pid() and m.transaction_id=txid_current() and m.operation='terminal' and a.principal_id=old.id)) then
   raise exception using errcode='42501',message='appeal_unavailable';end if;return old;
 end if;
 if new.principal_kind='appeal_case' or(tg_op='UPDATE' and old.principal_kind='appeal_case') then
  if current_user<>'postgres' or not exists(select 1 from private.new_appeal_mutation_context where backend_pid=pg_backend_pid()
   and transaction_id=txid_current() and(operation='intake' and tg_op='INSERT' or operation='terminal' and tg_op='UPDATE')) then
   raise exception using errcode='42501',message='appeal_unavailable';end if;
  if tg_op='UPDATE' and(new.id is distinct from old.id or new.subject_id is not null or new.account_id is not null
   or new.principal_kind<>'appeal_case' or new.status<>'deleted' or new.principal_revision<>old.principal_revision+1) then
   raise exception using errcode='42501',message='appeal_unavailable';end if;
 end if;return new;
end $body$;
create trigger guard_new_appeal_principal before insert or update or delete on public.subject_principals
 for each row execute function private.guard_new_appeal_principal_v1();
create function private.guard_new_appeal_row_v1()
returns trigger language plpgsql security invoker set search_path='' as $body$
declare case_id uuid;
begin
 case_id:=case when tg_op='DELETE' then old.id else new.id end;
 if(tg_op='DELETE' and old.review_case_format is not null) or(tg_op<>'DELETE' and(new.review_case_format is not null
  or(tg_op='UPDATE' and old.review_case_format is not null))) then
  if current_user<>'postgres' or not exists(select 1 from private.new_appeal_mutation_context where backend_pid=pg_backend_pid()
   and transaction_id=txid_current() and appeal_id=case_id) then raise exception using errcode='42501',message='appeal_unavailable';end if;
 end if;
 if tg_op='UPDATE' and old.review_case_format is not null then
  if new.id is distinct from old.id or new.intake_kind is distinct from old.intake_kind
   or new.submitted_at is distinct from old.submitted_at or new.original_deadline is distinct from old.original_deadline
   or new.review_case_format is distinct from old.review_case_format or new.appeal_revision is distinct from old.appeal_revision
   or(old.state in('approved','rejected','withdrawn','expired') and to_jsonb(new) is distinct from to_jsonb(old)) then
   raise exception using errcode='42501',message='appeal_unavailable';end if;
  if new.state in('submitted','reviewing') and(new.appellant_principal_id is distinct from old.appellant_principal_id
   or new.appellant_account_id is distinct from old.appellant_account_id or new.current_case_binding is distinct from old.current_case_binding) then
   raise exception using errcode='42501',message='appeal_unavailable';end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $body$;
create trigger guard_new_appeal_row before insert or update or delete on public.appeal_intakes
 for each row execute function private.guard_new_appeal_row_v1();

create function private.guard_new_appeal_contact_v1()
returns trigger language plpgsql security invoker set search_path='' as $body$
declare case_id uuid;
begin
 case_id:=case when tg_op='DELETE' then old.appeal_case_id else new.appeal_case_id end;
 if case_id is not null or(tg_op='UPDATE' and old.appeal_case_id is not null) then
  if current_user<>'postgres' or tg_op='UPDATE' or not exists(select 1 from private.new_appeal_mutation_context
   where backend_pid=pg_backend_pid() and transaction_id=txid_current() and appeal_id=case_id
    and operation=case when tg_op='INSERT' then 'intake' else 'terminal' end) then
   raise exception using errcode='42501',message='appeal_unavailable';end if;
  if tg_op='INSERT' and(new.correction_case_id is not null or new.status<>'appeal-case-working') then
   raise exception using errcode='42501',message='appeal_unavailable';end if;
 end if;if tg_op='DELETE' then return old;end if;return new;
end $body$;
create trigger guard_new_appeal_contact before insert or update or delete on public.encrypted_contact_references
 for each row execute function private.guard_new_appeal_contact_v1();

create function private.guard_new_appeal_outbox_v1()
returns trigger language plpgsql security invoker set search_path='' as $body$
declare case_id uuid;contact_case uuid;
begin
 case_id:=case when tg_op='DELETE' then old.appeal_case_id else new.appeal_case_id end;
 if tg_op<>'DELETE' then
  select appeal_case_id into contact_case from public.encrypted_contact_references where id=new.contact_reference_id;
  if contact_case is not null and case_id is distinct from contact_case then raise exception using errcode='42501',message='appeal_unavailable';end if;
 end if;
 if case_id is not null or(tg_op='UPDATE' and old.appeal_case_id is not null) then
  if current_user<>'postgres' or not exists(select 1 from private.new_appeal_mutation_context
   where backend_pid=pg_backend_pid() and transaction_id=txid_current() and appeal_id=case_id) then
   raise exception using errcode='42501',message='appeal_unavailable';end if;
  if tg_op<>'DELETE' and(new.correction_case_id is not null or new.template_id<>'appeal-evidence-request'
   or new.purpose<>'appeal-evidence' or new.target_kind<>'appeal' or new.target_id is distinct from case_id
   or new.template_payload is distinct from '{}'::jsonb or new.token_purpose<>'appeal-evidence' or new.token_target_id is distinct from case_id) then
   raise exception using errcode='42501',message='appeal_unavailable';end if;
  if tg_op='UPDATE' and(new.id is distinct from old.id or new.appeal_case_id is distinct from old.appeal_case_id
   or new.contact_reference_id is distinct from old.contact_reference_id or new.recipient_principal_id is distinct from old.recipient_principal_id
   or new.recipient_authority_revision is distinct from old.recipient_authority_revision or new.semantic_revision is distinct from old.semantic_revision
   or new.created_at is distinct from old.created_at or new.expires_at is distinct from old.expires_at
   or new.idempotency_key is distinct from old.idempotency_key or new.template_id is distinct from old.template_id
   or new.template_payload is distinct from old.template_payload or new.token_purpose is distinct from old.token_purpose
   or new.token_target_id is distinct from old.token_target_id or new.target_kind is distinct from old.target_kind
   or new.target_id is distinct from old.target_id or new.purpose is distinct from old.purpose) then
   raise exception using errcode='42501',message='appeal_unavailable';end if;
 elsif tg_op<>'DELETE' and(new.template_id='appeal-evidence-request' or new.purpose='appeal-evidence') then
  raise exception using errcode='42501',message='appeal_unavailable';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $body$;
create trigger guard_new_appeal_outbox before insert or update or delete on public.mail_outbox
 for each row execute function private.guard_new_appeal_outbox_v1();

create function private.new_appeal_test_enabled_v1()
returns boolean language sql stable security definer set search_path='' as $body$
 select coalesce((select enabled and test_environment_binding is not null from private.new_appeal_test_scope where singleton),false)
$body$;
create function private.designate_new_appeal_reviewer_v1(p_principal uuid,p_expected_revision bigint,p_enabled boolean,p_assignee boolean)
returns void language plpgsql security invoker set search_path='' as $body$
declare sp public.subject_principals;old_grant private.new_appeal_reviewer_purposes;
begin
 if current_user<>'postgres' or p_enabled is null or p_assignee is null or(p_assignee and not p_enabled) then
  raise exception using errcode='42501',message='appeal_unavailable';end if;
 select * into sp from public.subject_principals where id=p_principal;
 perform 1 from auth.users where id=sp.account_id and deleted_at is null and(banned_until is null or banned_until<=clock_timestamp()) for share;
 if not found then raise exception using errcode='42501',message='appeal_unavailable';end if;
 perform 1 from public.profiles where id=sp.account_id and deletion_requested_at is null for share;
 if not found then raise exception using errcode='42501',message='appeal_unavailable';end if;
 select * into sp from public.subject_principals where id=p_principal for share;
 if sp.id is null or sp.principal_kind<>'reviewer' or sp.subject_id is not null or sp.account_id is null or sp.status<>'active'
  or sp.principal_revision is distinct from p_expected_revision then raise exception using errcode='42501',message='appeal_unavailable';end if;
 select * into old_grant from private.new_appeal_reviewer_purposes where principal_id=sp.id for update;
 insert into private.new_appeal_reviewer_purposes values(sp.id,sp.principal_revision,'appeal',coalesce(old_grant.grant_revision,0)+1,p_assignee,p_enabled)
 on conflict(principal_id) do update set principal_revision=excluded.principal_revision,grant_revision=excluded.grant_revision,
  intake_assignee=excluded.intake_assignee,enabled=excluded.enabled;
 -- Existing cases bind the original purpose revision and refuse. No automatic
 -- case reassignment, claim-purpose promotion or principal revision mutation.
end $body$;
create function private.new_appeal_designated_reviewer_v1()
returns jsonb language plpgsql security definer set search_path='' as $body$
declare sp public.subject_principals;purpose private.new_appeal_reviewer_purposes;
begin
 if(select count(*) from private.new_appeal_reviewer_purposes where intake_assignee and enabled)<>1 then
  raise exception using errcode='42501',message='appeal_unavailable';end if;
 select * into purpose from private.new_appeal_reviewer_purposes where intake_assignee and enabled;
 select * into sp from public.subject_principals where id=purpose.principal_id;
 perform 1 from auth.users where id=sp.account_id and deleted_at is null and(banned_until is null or banned_until<=clock_timestamp()) for share;
 if not found then raise exception using errcode='42501',message='appeal_unavailable';end if;
 perform 1 from public.profiles where id=sp.account_id and deletion_requested_at is null for share;
 if not found then raise exception using errcode='42501',message='appeal_unavailable';end if;
 select * into sp from public.subject_principals where id=sp.id for share;
 select * into purpose from private.new_appeal_reviewer_purposes where principal_id=sp.id for share;
 if sp.id is null or sp.status<>'active' or sp.principal_kind<>'reviewer' or sp.subject_id is not null or sp.account_id is null
  or purpose.principal_revision is distinct from sp.principal_revision or not purpose.enabled or not purpose.intake_assignee then
  raise exception using errcode='42501',message='appeal_unavailable';end if;
 return jsonb_build_object('principalId',sp.id,'principalRevision',sp.principal_revision,'purposeRevision',purpose.grant_revision);
end $body$;

-- Stateless native prepare: no author/case/nonce/session/outbox/table write.
-- This is only the three public branches. The separately required suspension
-- origin must be composed before that registered branch can be admitted.
create function public.prepare_new_public_appeal_v1(p_kind text,p_payload_digest text,p_form_nonce_hash text,
 p_contact_digests jsonb,p_identifier_digests jsonb,p_network_digests jsonb)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $body$
declare submitted timestamptz:=clock_timestamp();frame jsonb;key bytea;reviewer jsonb;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' or not private.new_appeal_test_enabled_v1()
  or p_kind is null or p_kind not in('subject-objection','genetic-parent-objection','access-or-review-appeal')
  or p_payload_digest is null or p_payload_digest!~'^[0-9a-f]{64}$' or p_form_nonce_hash is null or p_form_nonce_hash!~'^[0-9a-f]{64}$' then
  raise exception using errcode='42501',message='appeal_unavailable';end if;
 reviewer:=private.new_appeal_designated_reviewer_v1();
 frame:=jsonb_build_object('version','new-appeal-public-intake-native-v1','scope',jsonb_build_object('version',1,'caseKind','appeal',
  'caseId',gen_random_uuid(),'originalAuthorPrincipalId',gen_random_uuid(),'initialStatementRevision',1,'originalSubmittedAt',submitted,
  'originalDeadline',submitted+interval '30 days','intakeKind',p_kind),'reviewer',reviewer,'assignmentRevision',1,
  'prepareExpiresAt',submitted+interval '30 seconds','caseContactId',gen_random_uuid(),'payloadDigest',p_payload_digest,
  'formNonceHash',p_form_nonce_hash,'contactDigests',private.resolve_hmac_set_v1('contact',null,p_contact_digests),
  'identifierDigests',private.resolve_hmac_set_v1('rate-limit',null,p_identifier_digests),
  'networkDigests',private.resolve_hmac_set_v1('rate-limit',null,p_network_digests));
 select operation_key into key from private.new_appeal_intake_keys where singleton;
 if key is null then raise exception using errcode='42501',message='appeal_unavailable';end if;
 return jsonb_build_object('frame',frame,'signature',encode(extensions.hmac(convert_to(frame::text,'UTF8'),key,'sha256'),'hex'));
end $body$;

-- The following source adds atomic public commit and own-JWT reads. The real
-- native sender, evidence/final mutations, archive and physical disposition
-- still require their full composition. This is not an eligible migration.
revoke all on function private.new_appeal_test_enabled_v1(),private.designate_new_appeal_reviewer_v1(uuid,bigint,boolean,boolean),
 private.new_appeal_designated_reviewer_v1(),public.prepare_new_public_appeal_v1(text,text,text,jsonb,jsonb,jsonb)
 from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.prepare_new_public_appeal_v1(text,text,text,jsonb,jsonb,jsonb) to service_role;
-- Complete atomic commit of the three account-free registered branches.
-- Every ID and original clock comes from the stateless native signed frame.
-- No lookup of a subject/cohort/decision occurs before or during this commit.
create function public.commit_new_public_appeal_v1(p_expected jsonb,p_payload_digest text,p_nonce_hash text,
 p_wrapped_key bytea,p_statement bytea,p_working bytea,p_contact bytea,p_quota_keys jsonb)
returns boolean language plpgsql security definer set search_path='' set timezone='UTC' as $body$
declare f jsonb;s jsonb;key bytea;signature text;sp public.subject_principals;reviewer jsonb;
 c_id uuid;author uuid;contact_id uuid;outbox_id uuid:=gen_random_uuid();candidate_id uuid:=gen_random_uuid();v_retention_id uuid;
 submitted timestamptz;deadline timestamptz;contact_set jsonb;active_revision bigint;ack timestamptz;envelope jsonb;expected_quota jsonb;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' or not private.new_appeal_test_enabled_v1()
  or p_expected is null or jsonb_typeof(p_expected)<>'object' or(select count(*) from jsonb_object_keys(p_expected))<>2
  or p_expected->>'signature' is null or p_expected->>'signature'!~'^[0-9a-f]{64}$' then
  raise exception using errcode='42501',message='appeal_unavailable';end if;
 f:=p_expected->'frame';s:=f->'scope';select operation_key into key from private.new_appeal_intake_keys where singleton;
 signature:=encode(extensions.hmac(convert_to(f::text,'UTF8'),key,'sha256'),'hex');
 -- Compare all octets. Never use a caller-provided signature to select a key.
 if key is null or signature is null or not private.new_appeal_equal_signature_v1(signature,p_expected->>'signature')
  or f->>'version' is distinct from 'new-appeal-public-intake-native-v1'
  or f->>'payloadDigest' is distinct from p_payload_digest or f->>'formNonceHash' is distinct from p_nonce_hash
  or p_payload_digest is null or p_nonce_hash is null or p_payload_digest!~'^[0-9a-f]{64}$' or p_nonce_hash!~'^[0-9a-f]{64}$'
  or s->>'caseKind' is distinct from 'appeal' or s->>'version' is distinct from '1'
  or s->>'initialStatementRevision' is distinct from '1'
  or s->>'intakeKind' is null or s->>'intakeKind' not in('subject-objection','genetic-parent-objection','access-or-review-appeal')
  or(f->>'prepareExpiresAt')::timestamptz<=clock_timestamp()
  or p_wrapped_key is null or octet_length(p_wrapped_key)<>72
  or p_statement is null or octet_length(p_statement) not between 48 and 16028
  or p_working is null or octet_length(p_working) not between 48 and 20528
  or p_contact is null or octet_length(p_contact) not between 29 and 282 then
  raise exception using errcode='42501',message='appeal_unavailable';end if;
 submitted:=(s->>'originalSubmittedAt')::timestamptz;deadline:=(s->>'originalDeadline')::timestamptz;
 if deadline is distinct from submitted+interval '30 days' or submitted>clock_timestamp()
  or submitted<clock_timestamp()-interval '30 seconds' or(f->>'prepareExpiresAt')::timestamptz is distinct from submitted+interval '30 seconds' then
  raise exception using errcode='42501',message='appeal_unavailable';end if;
 -- Quotas commit even for an exhausted request, with the identical opaque 202.
 -- Native server-owned specs precede every authority/resource lookup. Key sets
 -- come only from the closed route, never from the public request body.
 select jsonb_object_agg(k,jsonb_build_object('normalized-identifier',f->'identifierDigests'->k,
  'source-network',f->'networkDigests'->k,'global-capacity',encode(extensions.digest(
  convert_to('api.subject-access-request|global-capacity','UTF8'),'sha256'),'hex'))) into expected_quota
 from jsonb_object_keys(f->'identifierDigests')k;
 if p_quota_keys is null or expected_quota is null or p_quota_keys is distinct from expected_quota then
  raise exception using errcode='42501',message='appeal_unavailable';end if;
 if not private.consume_rate_limit_buckets_v1('api.subject-access-request',
  '[{"dimension":"source-network","windowSeconds":3600,"limit":30},
    {"dimension":"normalized-identifier","windowSeconds":86400,"limit":10},
    {"dimension":"global-capacity","windowSeconds":3600,"limit":1000}]',p_quota_keys) then return false;end if;
 reviewer:=private.new_appeal_designated_reviewer_v1();
 if reviewer is distinct from f->'reviewer' then raise exception using errcode='42501',message='appeal_unavailable';end if;
 contact_set:=private.resolve_hmac_set_v1('contact',null,f->'contactDigests');active_revision:=private.hmac_active_revision_v1('contact');
 c_id:=(s->>'caseId')::uuid;author:=(s->>'originalAuthorPrincipalId')::uuid;contact_id:=(f->>'caseContactId')::uuid;
 if c_id is null or author is null or contact_id is null or c_id=author or c_id=contact_id or author=contact_id then
  raise exception using errcode='42501',message='appeal_unavailable';end if;
 insert into private.new_appeal_mutation_context values(pg_backend_pid(),txid_current(),c_id,'intake');
 insert into public.subject_principals(id,principal_kind,principal_revision,status,created_at)
 values(author,'appeal_case',1,'pending',submitted);
 insert into public.appeal_intakes(id,appellant_principal_id,appeal_revision,state,submitted_at,review_case_format,intake_kind,
  original_deadline,current_reviewer_principal_id,reviewer_principal_revision,reviewer_purpose_revision,assignment_revision,evidence_revision,current_case_binding)
 values(c_id,author,1,'submitted',submitted,'reviewer-only-case-statement-v1',s->>'intakeKind',deadline,
  (reviewer->>'principalId')::uuid,(reviewer->>'principalRevision')::bigint,(reviewer->>'purposeRevision')::bigint,1,1,f);
 insert into private.new_appeal_authors values(c_id,author,1,submitted,deadline);
 insert into private.new_appeal_case_envelopes(appeal_id,wrapped_case_key,statement_ciphertext,working_ciphertext)
 values(c_id,p_wrapped_key,p_statement,p_working);
 insert into private.new_appeal_intake_nonce_uses values(p_nonce_hash,c_id,clock_timestamp(),submitted+interval '10 minutes');
 insert into public.encrypted_contact_references(id,principal_id,contact_ciphertext,contact_hmac,key_revision,authority_revision,
  status,created_at,appeal_case_id)
 values(contact_id,author,p_contact,contact_set->>active_revision::text,active_revision,1,'appeal-case-working',submitted,c_id);
 -- This case reference creates no global contact identity/refusal lookup.
 ack:=private.new_correction_ack_target_v1(submitted);
 insert into public.mail_outbox(id,template_id,purpose,target_kind,target_id,recipient_principal_id,contact_reference_id,
  recipient_authority_revision,semantic_revision,idempotency_key,token_purpose,token_target_id,template_payload,
  created_at,not_before,expires_at,appeal_case_id)
 values(outbox_id,'appeal-evidence-request','appeal-evidence','appeal',c_id,author,contact_id,1,1,
  encode(extensions.digest(convert_to('new-appeal-evidence-v1|'||c_id||'|1','UTF8'),'sha256'),'hex'),
  'appeal-evidence',c_id,'{}',submitted,submitted,deadline,c_id);
 insert into public.token_candidates(id,outbox_id,purpose,target_kind,target_id,token_revision,expires_at)
 values(candidate_id,outbox_id,'appeal-evidence','appeal',c_id,1,deadline);
 envelope:=jsonb_build_object('version',1,'caseId',c_id,'format','reviewer-only-case-statement-v1','intakeKind',s->>'intakeKind',
  'appealRevision',1,'originalSubmittedAt',submitted,'originalDeadline',deadline);
 insert into public.retention_rows(retention_id,target_kind,target_id,retention_revision,target_lifecycle_revision,
  disposition_revision,fixed_deadline,state,created_at)
 values('appeal.intake-review-30d','appeal',c_id,1,1,1,deadline,'active',submitted) returning id into v_retention_id;
 insert into public.retention_due_phases(retention_row_id,retention_id,phase_id,phase_kind,phase_revision,phase_deadline,
  target_kind,target_id,target_lifecycle_revision,disposition_revision,recipient_authority_kind,recipient_authority_revision,immutable_envelope)
 select v_retention_id,'appeal.intake-review-30d',phase_id,phase_kind,1,
  case when phase_id='appeal-acknowledgement' then ack else deadline end,'appeal',c_id,1,1,'current-appeal-case',1,envelope
 from public.retention_phase_registry where retention_id='appeal.intake-review-30d';
 if(select count(*) from public.retention_due_phases where retention_row_id=v_retention_id)<>2 then
  raise exception using errcode='55000',message='appeal_retention_unavailable';end if;
 insert into public.purge_manifests(retention_row_id,phase_id,phase_revision,manifest_class,manifest_revision,source_binding_fingerprint)
 values(v_retention_id,'appeal-review-close',1,'review-working',1,encode(extensions.digest(convert_to(envelope::text,'UTF8'),'sha256'),'hex'));
 insert into private.new_appeal_delivery values(c_id,contact_id,outbox_id,candidate_id,v_retention_id,ack,deadline);
 delete from private.new_appeal_mutation_context where backend_pid=pg_backend_pid() and transaction_id=txid_current() and appeal_id=c_id;
 return true;
end $body$;

-- Bytewise fixed-length signature comparison used by native stateless prepare.
create function private.new_appeal_equal_signature_v1(p_expected text,p_actual text)
returns boolean language plpgsql immutable security invoker set search_path='' as $body$
declare a bytea;b bytea;i integer;difference integer:=0;
begin
 if p_expected is null or p_actual is null or p_expected!~'^[0-9a-f]{64}$' or p_actual!~'^[0-9a-f]{64}$' then return false;end if;
 a:=decode(p_expected,'hex');b:=decode(p_actual,'hex');
 for i in 0..31 loop difference:=difference|(get_byte(a,i)#get_byte(b,i));end loop;return difference=0;
end $body$;

-- All review operations use the caller's own live authenticated JWT, current
-- enrolled MFA step-up, and the separate explicit appeal purpose grant.
create function private.new_appeal_reviewer_context_v1(p_write boolean)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $body$
declare claims jsonb:=auth.jwt();live jsonb;sp public.subject_principals;purpose private.new_appeal_reviewer_purposes;
begin
 if not private.new_appeal_test_enabled_v1() or claims->>'role' is distinct from 'authenticated'
  or claims->>'aal' is distinct from 'aal2' or jsonb_typeof(claims->'amr') is distinct from 'array' then
  raise exception using errcode='42501',message='appeal_unavailable';end if;
 if p_write then live:=private.assert_live_authenticated_session_write_v1();
 else live:=private.assert_live_authenticated_session_read_v1();end if;
 if live->>'authorized' is distinct from 'true' or not exists(select 1 from jsonb_array_elements(claims->'amr') a
  where a->>'method' in('totp','webauthn','phone') and jsonb_typeof(a->'timestamp')='number'
  and a->>'timestamp'~'^[0-9]+(?:\.[0-9]+)?$' and(a->>'timestamp')::numeric>=extract(epoch from clock_timestamp())-900
  and(a->>'timestamp')::numeric<=extract(epoch from clock_timestamp())+60) then
  raise exception using errcode='42501',message='appeal_unavailable';end if;
 if(select count(*) from public.subject_principals p join private.new_appeal_reviewer_purposes purpose on purpose.principal_id=p.id
  and purpose.principal_revision=p.principal_revision and purpose.enabled and purpose.purpose='appeal'
  where p.account_id=auth.uid() and p.subject_id is null and p.principal_kind='reviewer' and p.status='active')<>1 then
  raise exception using errcode='42501',message='appeal_unavailable';end if;
 select p.* into sp from public.subject_principals p join private.new_appeal_reviewer_purposes purpose on purpose.principal_id=p.id
  and purpose.principal_revision=p.principal_revision and purpose.enabled and purpose.purpose='appeal'
  where p.account_id=auth.uid() and p.subject_id is null and p.principal_kind='reviewer' and p.status='active';
 select * into purpose from private.new_appeal_reviewer_purposes where principal_id=sp.id;
 return jsonb_build_object('accountId',auth.uid(),'sessionId',claims->>'session_id','principalId',sp.id,
  'principalRevision',sp.principal_revision,'purposeRevision',purpose.grant_revision,'live',live);
end $body$;
create function private.current_new_appeal_for_reviewer_v1(p_id uuid,p_actor jsonb,p_write boolean)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $body$
declare c public.appeal_intakes;e private.new_appeal_case_envelopes;author private.new_appeal_authors;
 sp public.subject_principals;purpose private.new_appeal_reviewer_purposes;d private.new_appeal_delivery;contact public.encrypted_contact_references;
begin
 if p_actor is null or p_actor->>'accountId' is distinct from auth.uid()::text then
  raise exception using errcode='42501',message='appeal_unavailable';end if;
 if p_write then select * into c from public.appeal_intakes where id=p_id for update;
 else select * into c from public.appeal_intakes where id=p_id for share;end if;
 select * into sp from public.subject_principals where id=c.current_reviewer_principal_id for share;
 select * into purpose from private.new_appeal_reviewer_purposes where principal_id=sp.id for share;
 select * into author from private.new_appeal_authors where appeal_id=c.id for share;
 select * into e from private.new_appeal_case_envelopes where appeal_id=c.id for share;
 select * into d from private.new_appeal_delivery where appeal_id=c.id for share;
 select * into contact from public.encrypted_contact_references where id=d.contact_reference_id for share;
 if c.id is null or c.review_case_format is distinct from 'reviewer-only-case-statement-v1'
  or c.state not in('submitted','reviewing') or c.original_deadline<=clock_timestamp() or c.terminal_shredded_at is not null
  or c.original_deadline is distinct from c.submitted_at+interval '30 days'
  or c.current_reviewer_principal_id::text is distinct from p_actor->>'principalId'
  or c.reviewer_principal_revision::text is distinct from p_actor->>'principalRevision'
  or c.reviewer_purpose_revision::text is distinct from p_actor->>'purposeRevision'
  or sp.id is null or sp.status<>'active' or sp.account_id is distinct from auth.uid() or sp.principal_kind<>'reviewer'
  or sp.subject_id is not null or sp.principal_revision::text is distinct from p_actor->>'principalRevision'
  or purpose.grant_revision::text is distinct from p_actor->>'purposeRevision'
  or purpose.principal_id is null or not purpose.enabled or purpose.purpose<>'appeal'
  or purpose.principal_revision is distinct from sp.principal_revision
  or author.appeal_id is null or author.principal_id is distinct from c.appellant_principal_id
  or author.original_submitted_at is distinct from c.submitted_at or author.original_deadline is distinct from c.original_deadline
  or author.initial_statement_revision<>1 or e.appeal_id is null or d.appeal_id is null
  or contact.appeal_case_id is distinct from c.id or contact.principal_id is distinct from author.principal_id
  or contact.contact_ciphertext is null or contact.status<>'appeal-case-working'
  or c.current_case_binding->'scope' is distinct from jsonb_build_object('version',1,'caseKind','appeal','caseId',c.id,
   'originalAuthorPrincipalId',author.principal_id,'initialStatementRevision',1,'originalSubmittedAt',c.submitted_at,
   'originalDeadline',c.original_deadline,'intakeKind',c.intake_kind) then
  raise exception using errcode='42501',message='appeal_unavailable';end if;
 return jsonb_build_object('scope',c.current_case_binding->'scope','binding',jsonb_build_object('caseId',c.id,
  'assignmentRevision',c.assignment_revision,'evidenceRevision',c.evidence_revision,'actor',p_actor,
  'caseHash',encode(extensions.digest(jsonb_build_object('case',to_jsonb(c),'envelope',to_jsonb(e),
   'author',to_jsonb(author),'delivery',to_jsonb(d),'contact',to_jsonb(contact))::text,'sha256'),'hex')),
  'envelope',jsonb_build_object('format',c.review_case_format,'wrappedCaseKeyHex',encode(e.wrapped_case_key,'hex'),
   'statementCiphertextHex',encode(e.statement_ciphertext,'hex'),'workingCiphertextHex',encode(e.working_ciphertext,'hex'),
   'contactCiphertextHex',encode(contact.contact_ciphertext,'hex')));
end $body$;
create function private.new_appeal_reviewer_audit_v1(p_actor jsonb)
returns uuid language plpgsql security definer set search_path='' as $body$
declare result uuid;
begin
 if auth.jwt()->>'role' is distinct from 'authenticated' or auth.uid() is distinct from(p_actor->>'accountId')::uuid then
  raise exception using errcode='42501',message='appeal_unavailable';end if;
 perform pg_catalog.pg_advisory_xact_lock(1229866068,pg_catalog.hashtext(auth.uid()::text));
 select audit_principal_id into result from private.legal_audit_account_principals where account_id=auth.uid();
 if result is null then insert into public.audit_principals default values returning id into result;
  insert into private.legal_audit_account_principals(account_id,audit_principal_id) values(auth.uid(),result);end if;
 return result;
end $body$;
revoke all on function private.new_appeal_reviewer_audit_v1(jsonb) from public,anon,authenticated,service_role,inherit_upload_only;
create function public.read_new_appeal_for_reviewer_v1(p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $body$
declare actor jsonb;frame jsonb;
begin
 actor:=private.new_appeal_reviewer_context_v1(false);frame:=private.current_new_appeal_for_reviewer_v1(p_id,actor,false);
 perform private.append_legal_audit_event('appeal.read',private.new_appeal_reviewer_audit_v1(actor),'api.appeal-review','read','{}');return frame;
end $body$;
create function public.check_new_appeal_for_reviewer_v1(p_id uuid,p_expected jsonb)
returns boolean language plpgsql security definer set search_path='' as $body$
declare actor jsonb;frame jsonb;
begin
 actor:=private.new_appeal_reviewer_context_v1(false);frame:=private.current_new_appeal_for_reviewer_v1(p_id,actor,false);
 if p_expected is null or frame->'binding' is distinct from p_expected then
  raise exception using errcode='42501',message='appeal_unavailable';end if;return true;
end $body$;

-- Own statement read requires a current exact case-bound session and source
-- candidate/hash/contact, never an email match, account role or case UUID.
create function private.current_new_appeal_own_session_v1(p_hash text,p_write boolean)
returns public.rights_sessions language plpgsql security definer set search_path='' as $body$
declare rs public.rights_sessions;c public.appeal_intakes;d private.new_appeal_delivery;t public.token_hashes;
 candidate public.token_candidates;contact public.encrypted_contact_references;sp public.subject_principals;
begin
 if not private.new_appeal_test_enabled_v1() or not private.requester_statement_test_enabled_v1()
  or p_hash is null or p_hash!~'^[0-9a-f]{64}$' then raise exception using errcode='42501',message='not_found';end if;
 select * into rs from public.rights_sessions where session_hash=p_hash;
 if p_write then select * into c from public.appeal_intakes where id=rs.target_id for update;
 else select * into c from public.appeal_intakes where id=rs.target_id for share;end if;
 select * into rs from public.rights_sessions where id=rs.id for share;
 select * into d from private.new_appeal_delivery where appeal_id=c.id for share;
 select * into t from public.token_hashes where id=rs.token_hash_id for share;
 select * into candidate from public.token_candidates where id=t.candidate_id for share;
 select * into contact from public.encrypted_contact_references where id=d.contact_reference_id for share;
 select * into sp from public.subject_principals where id=c.appellant_principal_id for share;
 if rs.id is null or rs.status<>'active' or rs.purpose<>'appeal-evidence' or rs.target_kind<>'appeal'
  or rs.target_id is distinct from c.id or rs.principal_id is distinct from c.appellant_principal_id
  or rs.authority_revision<>1 or rs.expires_at<=clock_timestamp() or rs.expires_at>c.original_deadline
  or c.id is null or c.review_case_format is distinct from 'reviewer-only-case-statement-v1' or c.state not in('submitted','reviewing')
  or c.original_deadline<=clock_timestamp() or c.terminal_shredded_at is not null
  or c.original_deadline is distinct from c.submitted_at+interval '30 days'
  or sp.id is null or sp.principal_kind<>'appeal_case' or sp.principal_revision<>1 or sp.status<>'pending'
  or sp.account_id is not null or sp.subject_id is not null or d.appeal_id is null
  or t.id is null or t.status<>'current' or t.token_revision<>1
  or candidate.id is distinct from d.candidate_id or candidate.state<>'issued' or candidate.purpose<>'appeal-evidence'
  or candidate.target_kind<>'appeal' or candidate.target_id is distinct from c.id or candidate.token_revision<>1
  or candidate.expires_at is distinct from c.original_deadline
  or contact.id is null or contact.status<>'appeal-case-working' or contact.appeal_case_id is distinct from c.id
  or contact.principal_id is distinct from sp.id or contact.authority_revision<>1 or contact.contact_ciphertext is null then
  raise exception using errcode='42501',message='not_found';end if;return rs;
end $body$;
create function public.read_new_appeal_own_statement_v1(p_hash text)
returns jsonb language plpgsql security definer set search_path='' as $body$
declare rs public.rights_sessions;c public.appeal_intakes;e private.new_appeal_case_envelopes;a private.new_appeal_authors;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception using errcode='42501',message='not_found';end if;
 rs:=private.current_new_appeal_own_session_v1(p_hash,false);
 select * into c from public.appeal_intakes where id=rs.target_id for share;
 select * into e from private.new_appeal_case_envelopes where appeal_id=c.id for share;
 select * into a from private.new_appeal_authors where appeal_id=c.id for share;
 if e.appeal_id is null or a.principal_id is distinct from rs.principal_id
  or a.original_submitted_at is distinct from c.submitted_at or a.original_deadline is distinct from c.original_deadline
  or a.initial_statement_revision is distinct from 1 or c.current_case_binding->'scope' is distinct from
  jsonb_build_object('version',1,'caseKind','appeal','caseId',c.id,'originalAuthorPrincipalId',a.principal_id,
   'initialStatementRevision',1,'originalSubmittedAt',c.submitted_at,'originalDeadline',c.original_deadline,'intakeKind',c.intake_kind) then
  raise exception using errcode='42501',message='not_found';end if;
 return jsonb_build_object('scope',c.current_case_binding->'scope','binding',jsonb_build_object('rightsSessionId',rs.id,
  'tokenHashId',rs.token_hash_id,'principalId',rs.principal_id,'authorityRevision',rs.authority_revision,
  'caseHash',encode(extensions.digest(jsonb_build_object('case',to_jsonb(c),'envelope',to_jsonb(e),'author',to_jsonb(a))::text,'sha256'),'hex')),
  'envelope',jsonb_build_object('format',c.review_case_format,'wrappedCaseKeyHex',encode(e.wrapped_case_key,'hex'),
   'statementCiphertextHex',encode(e.statement_ciphertext,'hex')));
end $body$;
create function public.check_new_appeal_own_statement_v1(p_hash text,p_expected jsonb)
returns boolean language plpgsql security definer set search_path='' as $body$
declare frame jsonb;
begin frame:=public.read_new_appeal_own_statement_v1(p_hash);
 if p_expected is null or frame->'binding' is distinct from p_expected then raise exception using errcode='42501',message='not_found';end if;
 return true;end $body$;

-- Explicit closed suspension branch. The actual predecessor has neither an
-- originating contradiction INSERT nor uploader/trigger/source/idempotency/
-- count-revision/notice linkage. Existing arbitrary rows are not reinterpreted.
-- This refusal is a documented incomplete producer, not whole-flow success.
create function public.prepare_new_suspension_appeal_v1(p_notice_hash text,p_nonce text,p_payload_digest text)
returns jsonb language plpgsql security definer set search_path='' as $body$
begin
 raise exception using errcode='0A000',message='appeal_contradiction_origin_unbound';
end $body$;

revoke all on function public.commit_new_public_appeal_v1(jsonb,text,text,bytea,bytea,bytea,bytea,jsonb),
 private.new_appeal_equal_signature_v1(text,text),private.new_appeal_reviewer_context_v1(boolean),
 private.current_new_appeal_for_reviewer_v1(uuid,jsonb,boolean),public.read_new_appeal_for_reviewer_v1(uuid),
 public.check_new_appeal_for_reviewer_v1(uuid,jsonb),private.current_new_appeal_own_session_v1(text,boolean),
 public.read_new_appeal_own_statement_v1(text),public.check_new_appeal_own_statement_v1(text,jsonb),
 public.prepare_new_suspension_appeal_v1(text,text,text)
 from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.commit_new_public_appeal_v1(jsonb,text,text,bytea,bytea,bytea,bytea,jsonb),
 public.read_new_appeal_own_statement_v1(text),public.check_new_appeal_own_statement_v1(text,jsonb) to service_role;
grant execute on function public.read_new_appeal_for_reviewer_v1(uuid),public.check_new_appeal_for_reviewer_v1(uuid,jsonb),
 public.prepare_new_suspension_appeal_v1(text,text,text) to authenticated;
-- Prevent generic API writes from manufacturing an issued case credential,
-- provider receipt or reviewer assignment. No dashboard/service table insert
-- can grant the own-statement read door by constructing a valid-looking row.
create function private.guard_new_appeal_credential_v1()
returns trigger language plpgsql security invoker set search_path='' as $body$
declare case_id uuid;old_case uuid;source_id uuid;row_data jsonb;old_data jsonb;
begin
 if tg_op='DELETE' then row_data:=to_jsonb(old);else row_data:=to_jsonb(new);end if;
 if tg_op='UPDATE' then old_data:=to_jsonb(old);end if;
 if tg_table_name='token_candidates' then
  select appeal_case_id into case_id from public.mail_outbox where id=(row_data->>'outbox_id')::uuid;
  if tg_op='UPDATE' then select appeal_case_id into old_case from public.mail_outbox where id=(old_data->>'outbox_id')::uuid;
   if old_case is not null and row_data->>'outbox_id' is distinct from old_data->>'outbox_id' then
    raise exception using errcode='42501',message='appeal_unavailable';end if;end if;
 elsif tg_table_name='token_hashes' then
  select o.appeal_case_id into case_id from public.token_candidates candidate join public.mail_outbox o on o.id=candidate.outbox_id
   where candidate.id=(row_data->>'candidate_id')::uuid;
  if tg_op='UPDATE' then
   select o.appeal_case_id into old_case from public.token_candidates candidate join public.mail_outbox o on o.id=candidate.outbox_id
    where candidate.id=(old_data->>'candidate_id')::uuid;
   if old_case is not null and row_data->>'candidate_id' is distinct from old_data->>'candidate_id' then
    raise exception using errcode='42501',message='appeal_unavailable';end if;end if;
 else
  select o.appeal_case_id into case_id from public.token_hashes h join public.token_candidates candidate on candidate.id=h.candidate_id
   join public.mail_outbox o on o.id=candidate.outbox_id where h.id=(row_data->>'token_hash_id')::uuid;
  if tg_op='UPDATE' then
   select o.appeal_case_id into old_case from public.token_hashes h join public.token_candidates candidate on candidate.id=h.candidate_id
    join public.mail_outbox o on o.id=candidate.outbox_id where h.id=(old_data->>'token_hash_id')::uuid;
   if old_case is not null and row_data->>'token_hash_id' is distinct from old_data->>'token_hash_id' then
    raise exception using errcode='42501',message='appeal_unavailable';end if;end if;
 end if;
 if tg_op<>'DELETE' and tg_table_name in('token_candidates','rights_sessions') and row_data->>'purpose'='appeal-evidence' and case_id is null then
  raise exception using errcode='42501',message='appeal_unavailable';end if;
 if case_id is not null then
  if current_user<>'postgres' or not exists(select 1 from private.new_appeal_mutation_context m
   where m.backend_pid=pg_backend_pid() and m.transaction_id=txid_current() and m.appeal_id=case_id
   and m.operation=case when tg_op='DELETE' then 'terminal' when tg_op='INSERT' and tg_table_name='token_candidates' then 'intake' else 'delivery' end) then
   raise exception using errcode='42501',message='appeal_unavailable';end if;
  if tg_op<>'DELETE' and tg_table_name in('token_candidates','rights_sessions') and(row_data->>'purpose' is distinct from 'appeal-evidence'
   or row_data->>'target_kind' is distinct from 'appeal' or row_data->>'target_id' is distinct from case_id::text) then
   raise exception using errcode='42501',message='appeal_unavailable';end if;
  if tg_op<>'DELETE' and tg_table_name='token_candidates' and row_data->>'token_revision' is distinct from '1' then
   raise exception using errcode='42501',message='appeal_unavailable';end if;
  if tg_op<>'DELETE' and tg_table_name='rights_sessions' and row_data->>'authority_revision' is distinct from '1' then
   raise exception using errcode='42501',message='appeal_unavailable';end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $body$;
create trigger guard_new_appeal_candidate before insert or update or delete on public.token_candidates
 for each row execute function private.guard_new_appeal_credential_v1();
create trigger guard_new_appeal_hash before insert or update or delete on public.token_hashes
 for each row execute function private.guard_new_appeal_credential_v1();
create trigger guard_new_appeal_session before insert or update or delete on public.rights_sessions
 for each row execute function private.guard_new_appeal_credential_v1();

create function private.guard_new_appeal_mail_child_v1()
returns trigger language plpgsql security invoker set search_path='' as $body$
declare case_id uuid;old_case uuid;source_id uuid;
begin
 source_id:=case when tg_op='DELETE' then old.outbox_id else new.outbox_id end;
 select appeal_case_id into case_id from public.mail_outbox where id=source_id;
 if tg_op='UPDATE' then select appeal_case_id into old_case from public.mail_outbox where id=old.outbox_id;
  if old_case is not null and new.outbox_id is distinct from old.outbox_id then raise exception using errcode='42501',message='appeal_unavailable';end if;end if;
 if case_id is not null then
  if current_user<>'postgres' or not exists(select 1 from private.new_appeal_mutation_context m
   where m.backend_pid=pg_backend_pid() and m.transaction_id=txid_current() and m.appeal_id=case_id
   and m.operation=case when tg_op='DELETE' then 'terminal' else 'delivery' end)
   or(tg_op<>'DELETE' and new.appeal_case_id is distinct from case_id) then
   raise exception using errcode='42501',message='appeal_unavailable';end if;
 elsif tg_op<>'DELETE' and new.appeal_case_id is not null then raise exception using errcode='42501',message='appeal_unavailable';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $body$;
create trigger guard_new_appeal_provider_attempt before insert or update or delete on public.mail_provider_attempts
 for each row execute function private.guard_new_appeal_mail_child_v1();
create trigger guard_new_appeal_delivery_receipt before insert or update or delete on public.mail_deliveries
 for each row execute function private.guard_new_appeal_mail_child_v1();

-- Legacy generic sender is barred from this NEW encrypted contact format at
-- claim time. The eventual native transaction adapter must replace this hold
-- with exact row locks held through token creation and provider submission.
-- The old queue selector is delegated only after every eligible NEW row is
-- terminally fenced, so it never receives NEW ciphertext as an old envelope.
alter function public.claim_mail_outbox() rename to claim_mail_outbox_before_new_appeal_v1;
revoke all on function public.claim_mail_outbox_before_new_appeal_v1() from public,anon,authenticated,service_role,inherit_upload_only;
create function public.claim_mail_outbox()
returns table(outbox_id uuid,template_id text,template_payload jsonb,idempotency_key text,
 attempt_ordinal smallint,contact_ciphertext bytea,delivery_token text)
language plpgsql security definer set search_path='' set lock_timeout='250ms' as $body$
declare c public.appeal_intakes;o public.mail_outbox;i integer;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception using errcode='42501',message='appeal_unavailable';end if;
 for i in 1..25 loop
  select * into o from public.mail_outbox where appeal_case_id is not null and state in('queued','claimed')
   and not_before<=clock_timestamp() order by created_at,id limit 1;
  if o.id is null then return query select * from public.claim_mail_outbox_before_new_appeal_v1();return;end if;
  select * into c from public.appeal_intakes where id=o.appeal_case_id for update;
  select * into o from public.mail_outbox where id=o.id for update;
  if o.state not in('queued','claimed') then continue;end if;
  insert into private.new_appeal_mutation_context values(pg_backend_pid(),txid_current(),o.appeal_case_id,'delivery');
  update public.mail_outbox set state='invalidated',claimed_at=null,last_outcome_code='appeal_native_sender_unbound' where id=o.id;
  delete from private.new_appeal_mutation_context where backend_pid=pg_backend_pid() and transaction_id=txid_current() and appeal_id=o.appeal_case_id;
 end loop;
 return;
end $body$;
alter function private.authorize_mail_submission_v1(uuid,smallint) rename to authorize_mail_submission_before_new_appeal_v1;
revoke all on function private.authorize_mail_submission_before_new_appeal_v1(uuid,smallint)
 from public,anon,authenticated,service_role,inherit_upload_only;
create function private.authorize_mail_submission_v1(p_outbox uuid,p_attempt smallint)
returns boolean language plpgsql security definer set search_path='' as $body$
begin
 if exists(select 1 from public.mail_outbox where id=p_outbox and appeal_case_id is not null) then return false;end if;
 return private.authorize_mail_submission_before_new_appeal_v1(p_outbox,p_attempt);
end $body$;
revoke all on function private.guard_new_appeal_credential_v1(),private.guard_new_appeal_mail_child_v1(),
 public.claim_mail_outbox(),private.authorize_mail_submission_v1(uuid,smallint)
 from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.claim_mail_outbox() to service_role;
commit;
