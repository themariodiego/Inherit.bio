-- =====================================================================
-- PRODUCTION RELEASE: GUARDED. This migration is applied to local and CI
-- databases only. It must reach a hosted database through the guarded
-- production release (preflight, postflight, receipt), never as a side
-- effect of a merge. Future Person claims are TEST-LOCAL only: the native
-- switch private.new_correction_intake_config stays disabled and nothing
-- here enables it.
-- =====================================================================
--
-- The named human correction review (register
-- api.future-person-correction-review, GET and POST
-- /api/reviews/future-person/corrections/[id]). The claimant's correction
-- intake (20261009193600_new_correction_intake.sql) already names the
-- reviewer at intake and seals the statement under one case key. This adds
-- the reviewer's read and decision.
--
-- Who may act: the reviewer the intake named, under their own JWT, in a live
-- session stepped up with MFA in the last 15 minutes
-- (private.claim_reviewer_step_up_v1), whose reviewer principal, claim
-- reviewer standing and correction purpose are all still current. Anything
-- else, and anything unknown, stale or past the fixed 30-day deadline, is the
-- one opaque 42501.
--
-- What a decision does:
--   - reject: records the coded versioned outcome and closes the request.
--     The existing close trigger then shreds the statement, working package,
--     case contact copy and case key (future-person.correction-review-30d);
--     the reviewer reason is nulled in the same transaction.
--   - needs-more-information: records the coded versioned outcome and keeps
--     the request open. The deadline is never moved. The encrypted reason is
--     kept until final resolution and shredded then.
--   - approve: refused. What an approved correction changes is an open owner
--     question (see the report on this slice), so no subject, result or
--     provenance row is mutated by this migration.
-- No decision sends mail: no outcome notice text is approved.
--
-- currentProvenance is computed, never stored. fieldVersion is 1 plus the
-- approved corrections of the same field on the subject, provenanceRevision
-- 1 plus all approved corrections on the subject (both are 1 today, since
-- approval is refused). sourceReference is an opaque digest of the subject,
-- the field and its current source row. affectedResultCount counts the
-- subject's report and embryo score rows for the two genetic-source fields
-- and is 0 for the three others.
--
-- Storage: the decision is a row of public.correction_assignments, which
-- the claimant erasure graph already deletes. Two nullable columns are
-- added: the reviewer reason ciphertext (sealed under the case key by the
-- server) and the one-time decision nonce hash.

do $predecessor$
begin
 if to_regclass('private.new_correction_intakes') is null
   or to_regclass('private.new_correction_reviewers') is null
   or to_regclass('private.new_correction_intake_config') is null
   or to_regprocedure('private.claim_reviewer_step_up_v1()') is null
   or to_regprocedure('private.shred_new_correction_package_v1(uuid)') is null
   or to_regprocedure('private.append_legal_audit_event(text,uuid,text,text,jsonb)') is null then
  raise exception using errcode='55000',message='correction review prerequisite missing'; end if;
 if not exists(select 1 from pg_constraint where conrelid='public.correction_assignments'::regclass
   and conname='correction_assignments_decision_check'
   and pg_get_constraintdef(oid)='CHECK ((decision = ANY (ARRAY[''approve''::text, ''reject''::text, ''close''::text])))') then
  raise exception using errcode='55000',message='correction assignment predecessor differs'; end if;
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='correction_assignments'
   and column_name in ('reason_ciphertext','nonce_hash'))
   or to_regprocedure('public.read_future_person_correction_review_v1(uuid)') is not null then
  raise exception using errcode='55000',message='correction review successor already exists'; end if;
end;
$predecessor$;

alter table public.correction_assignments drop constraint correction_assignments_decision_check;
alter table public.correction_assignments add constraint correction_assignments_decision_check
 check (decision in ('approve','reject','close','more_information'));
alter table public.correction_assignments
 add column reason_ciphertext bytea check (reason_ciphertext is null or octet_length(reason_ciphertext) between 29 and 16384),
 add column nonce_hash text check (nonce_hash is null or nonce_hash ~ '^[0-9a-f]{64}$');
create unique index correction_assignments_nonce_once on public.correction_assignments (nonce_hash)
 where nonce_hash is not null;

-- Final resolution of the intake (reject, expiry, withdrawal, claimant
-- deletion's close) makes every stored reviewer reason unreadable with it.
create function private.shred_correction_review_reasons_v1() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.state='closed' then
  update public.correction_assignments set reason_ciphertext=null
   where correction_id=new.id and reason_ciphertext is not null;
 end if;
 return new;
end $$;
revoke all on function private.shred_correction_review_reasons_v1() from public,anon,authenticated,service_role,inherit_upload_only;
create trigger shred_correction_review_reasons after update of state on private.new_correction_intakes
 for each row execute function private.shred_correction_review_reasons_v1();

create function private.correction_review_provenance_v1(p_subject uuid,p_field text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.subjects;e public.embryos;x private.future_person_custody_slices;
 approved_field bigint;approved_all bigint;source_row uuid;affected bigint:=0;
begin
 select * into s from public.subjects where id=p_subject;
 select * into e from public.embryos where subject_id=p_subject;
 select * into x from private.future_person_custody_slices where subject_id=p_subject;
 if s.id is null or e.id is null or x.subject_id is null or x.source_file_id is null or p_field is null
   or p_field not in('display-label','disposition-record','identity-match-profile','report-provenance','variant-call-source') then
  raise exception using errcode='42501',message='not_found';end if;
 select count(*) filter(where i.frame#>>'{scope,requestedField}'=p_field),count(*) into approved_field,approved_all
  from public.correction_assignments a join private.new_correction_intakes i on i.id=a.correction_id
  where i.subject_id=p_subject and a.decision='approve';
 source_row:=case when p_field in('variant-call-source','report-provenance') then x.source_file_id else e.id end;
 if p_field in('variant-call-source','report-provenance') then
  affected:=(select count(*) from public.report_artifacts where subject_id=p_subject)
   +(select count(*) from public.embryo_scores where embryo_id=e.id);
 end if;
 return jsonb_build_object('fieldVersion',approved_field+1,
  'sourceKind',case p_field when 'display-label' then 'neutral-display-label' when 'disposition-record' then 'disposition-event'
   when 'identity-match-profile' then 'identity-profile' when 'report-provenance' then 'report-result' else 'imported-variant-source' end,
  'sourceReference',encode(extensions.digest(convert_to(jsonb_build_array('future-person-correction-source-v1',
   p_subject,p_field,source_row)::text,'UTF8'),'sha256'),'hex'),
  'provenanceRevision',approved_all+1,'affectedResultCount',affected,'analysisStopped',s.analysis_stopped_at is not null);
end $$;
revoke all on function private.correction_review_provenance_v1(uuid,text) from public,anon,authenticated,service_role,inherit_upload_only;

-- The complete current case for the named, stepped-up reviewer, locked.
-- Raises the one opaque 42501 for every other caller or state.
create function private.correction_review_context_v1(p_correction uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare rv record;i private.new_correction_intakes;c public.correction_requests;r private.new_correction_reviewers;
 p public.subject_principals;s public.subjects;cp public.future_person_claimant_principals;w public.correction_working_data;
 prov jsonb;review_revision bigint;source_hash text;binding jsonb;field text;
begin
 perform 1 from private.new_correction_intake_config where singleton and enabled for share;
 if not found or p_correction is null then raise exception using errcode='42501',message='not_found';end if;
 select * into rv from private.claim_reviewer_step_up_v1();
 if rv.account_id is null then raise exception using errcode='42501',message='not_found';end if;
 select * into i from private.new_correction_intakes where id=p_correction for update;
 if i.id is null or i.state<>'committed' or i.wrapped_case_key is null or i.deadline<=clock_timestamp()
   or i.deadline is distinct from (i.frame#>>'{scope,originalDeadline}')::timestamptz
   or i.id is distinct from (i.frame#>>'{scope,caseId}')::uuid then
  raise exception using errcode='42501',message='not_found';end if;
 field:=i.frame#>>'{scope,requestedField}';
 select * into c from public.correction_requests where id=i.id for update;
 if c.id is null or c.state not in('submitted','reviewing') or c.subject_id<>i.subject_id
   or c.claimant_principal_id<>i.author_principal_id or octet_length(c.statement_ciphertext)<48 then
  raise exception using errcode='42501',message='not_found';end if;
 select x.* into r from private.new_correction_reviewers x where x.principal_id=i.reviewer_principal_id and x.active
  and x.purpose_revision=i.reviewer_purpose_revision and x.principal_revision=(i.frame->>'reviewerPrincipalRevision')::bigint
  for share;
 select x.* into p from public.subject_principals x where x.id=r.principal_id and x.principal_kind='reviewer'
  and x.status='active' and x.principal_revision=r.principal_revision and x.account_id=rv.account_id for share;
 perform 1 from private.claim_reviewers a where a.account_id=rv.account_id and a.status='active' for share;
 if r.principal_id is null or p.id is null or not found then raise exception using errcode='42501',message='not_found';end if;
 select * into s from public.subjects where id=i.subject_id for share;
 select * into cp from public.future_person_claimant_principals where id=s.claimant_principal_id for share;
 if s.id is null or s.subject_class<>'embryo' or s.lifecycle not in('claimed_unbound','claimed_bound')
   or cp.id is null or cp.status<>'current' or cp.principal_id<>i.author_principal_id then
  raise exception using errcode='42501',message='not_found';end if;
 select * into w from public.correction_working_data where correction_id=i.id and working_revision=1;
 if w.correction_id is null then raise exception using errcode='42501',message='not_found';end if;
 select coalesce(max(a.review_revision),0) into review_revision from public.correction_assignments a where a.correction_id=i.id;
 prov:=private.correction_review_provenance_v1(s.id,field);
 source_hash:=encode(extensions.digest(convert_to(jsonb_build_object('version','future-person-correction-review-source-v1',
  'frame',i.frame,'state',c.state,'correctionRevision',c.correction_revision,'reviewRevision',review_revision,
  'provenance',prov,'lifecycleRevision',s.lifecycle_revision,'claimantRevision',cp.claimant_revision,
  'statement',encode(extensions.digest(c.statement_ciphertext,'sha256'),'hex'),
  'working',encode(extensions.digest(w.working_ciphertext,'sha256'),'hex'),
  'key',encode(extensions.digest(i.wrapped_case_key,'sha256'),'hex'))::text,'UTF8'),'sha256'),'hex');
 binding:=jsonb_build_object('actor',jsonb_build_object('accountId',rv.account_id,'sessionId',rv.auth_session_id,
   'principalId',p.id,'principalRevision',p.principal_revision,
   'live',jsonb_build_object('authorized',true,'account_auth_session_revision',rv.account_auth_session_revision,
    'session_revision',rv.session_revision)),
  'assignmentRevision',(i.frame->>'assignmentRevision')::bigint,'sourceHash',source_hash);
 return jsonb_build_object('correctionId',i.id,'field',field,'correctionRevision',c.correction_revision,
  'reviewRevision',review_revision,'deadline',to_char(i.deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'scope',i.frame->'scope','provenance',prov,'binding',binding,
  'envelope',jsonb_build_object('format','reviewer-only-case-statement-v1',
   'statementCiphertextHex',encode(c.statement_ciphertext,'hex'),'workingCiphertextHex',encode(w.working_ciphertext,'hex'),
   'wrappedCaseKeyHex',encode(i.wrapped_case_key,'hex')));
end $$;
revoke all on function private.correction_review_context_v1(uuid) from public,anon,authenticated,service_role,inherit_upload_only;

-- GET: the audited read. Every successful call appends one ledger event.
create function public.read_future_person_correction_review_v1(p_correction uuid)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare ctx jsonb;
begin
 ctx:=private.correction_review_context_v1(p_correction);
 perform private.append_legal_audit_event('correction.review.read',null,'api.future-person-correction-review','accepted','{}'::jsonb);
 return ctx;
end $$;

-- The unaudited recheck the route runs after decrypting and serializing.
create function public.check_future_person_correction_review_v1(p_correction uuid,p_expected jsonb)
returns boolean language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
begin
 return p_expected is not null and (private.correction_review_context_v1(p_correction)->'binding') is not distinct from p_expected;
end $$;

-- POST preparation: everything but the case prose, so the server can verify
-- its stateless nonce against the current binding and seal the reason.
create function public.future_person_correction_decision_context_v1(p_correction uuid)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare ctx jsonb;
begin
 ctx:=private.correction_review_context_v1(p_correction);
 return jsonb_build_object('correctionId',ctx->'correctionId','correctionRevision',ctx->'correctionRevision',
  'reviewRevision',ctx->'reviewRevision','deadline',ctx->'deadline','scope',ctx->'scope','binding',ctx->'binding',
  'wrappedCaseKeyHex',ctx#>'{envelope,wrappedCaseKeyHex}');
end $$;

create function public.decide_future_person_correction_review_v1(p_correction uuid,p_decision text,
 p_correction_revision bigint,p_expected jsonb,p_nonce_hash text,p_reason_ciphertext bytea)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare ctx jsonb;next_revision bigint;outcome text;
begin
 ctx:=private.correction_review_context_v1(p_correction);
 -- Approval is not decided by the owner yet; it is refused before any write.
 if p_decision is null or p_decision not in('reject','needs-more-information')
   or p_correction_revision is distinct from (ctx->>'correctionRevision')::bigint
   or p_expected is null or (ctx->'binding') is distinct from p_expected
   or p_nonce_hash is null or p_nonce_hash!~'^[0-9a-f]{64}$'
   or p_reason_ciphertext is null or octet_length(p_reason_ciphertext) not between 29 and 16384
   or exists(select 1 from public.correction_assignments where nonce_hash=p_nonce_hash) then
  raise exception using errcode='42501',message='not_found';end if;
 next_revision:=(ctx->>'reviewRevision')::bigint+1;
 outcome:=case p_decision when 'reject' then 'rejected' else 'more_information_required' end;
 -- The coded row is written first, so the close trigger below finds it.
 insert into public.correction_assignments(correction_id,reviewer_principal_id,review_revision,decision,reason_code,
  reason_ciphertext,nonce_hash)
 values(p_correction,(ctx#>>'{binding,actor,principalId}')::uuid,next_revision,
  case p_decision when 'reject' then 'reject' else 'more_information' end,outcome,p_reason_ciphertext,p_nonce_hash);
 if p_decision='reject' then
  update public.correction_requests set state='rejected',decided_at=clock_timestamp() where id=p_correction;
 else
  update public.correction_requests set state='reviewing' where id=p_correction and state='submitted';
 end if;
 perform private.append_legal_audit_event('correction.review.decided',null,'api.future-person-correction-review',outcome,'{}'::jsonb);
 return jsonb_build_object('correctionId',p_correction,'state',outcome,'reviewRevision',next_revision);
end $$;

revoke all on function public.read_future_person_correction_review_v1(uuid),
 public.check_future_person_correction_review_v1(uuid,jsonb),
 public.future_person_correction_decision_context_v1(uuid),
 public.decide_future_person_correction_review_v1(uuid,text,bigint,jsonb,text,bytea)
 from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.read_future_person_correction_review_v1(uuid),
 public.check_future_person_correction_review_v1(uuid,jsonb),
 public.future_person_correction_decision_context_v1(uuid),
 public.decide_future_person_correction_review_v1(uuid,text,bigint,jsonb,text,bytea)
 to authenticated;
