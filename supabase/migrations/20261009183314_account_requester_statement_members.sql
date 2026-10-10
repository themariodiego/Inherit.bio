-- Closed requester-only NEW envelope producer and account-export pager.
-- No legacy ciphertext conversion, provider choice, READY publication or activation.
-- The native intake transaction must register its exact committed case envelope.
create table private.account_requester_statement_capsules (
 case_kind text not null check(case_kind in ('correction','appeal')),
 case_id uuid not null,
 author_principal_id uuid not null references public.subject_principals(id) on delete restrict,
 subject_id uuid not null references public.subjects(id) on delete restrict,
 scope jsonb not null,
 envelope jsonb not null,
 native_case_sha256 text not null check(native_case_sha256~'^[0-9a-f]{64}$'),
 primary key(case_kind,case_id),
 unique(case_id)
);
alter table private.account_requester_statement_capsules enable row level security;
revoke all on private.account_requester_statement_capsules from public,anon,authenticated,service_role,inherit_upload_only;

-- Named immutable original fields only. Assignments, reviewer notes, contact,
-- decisions and another person's statement are never selected by this door.
create function private.account_requester_case_v1(p_kind text,p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.correction_requests;a public.appeal_intakes;subject uuid;
begin
 if p_kind='correction' then
  select * into c from public.correction_requests where id=p_id;
  if c.id is null or c.state not in('submitted','reviewing') then raise exception using errcode='42501',message='not_found';end if;
  return jsonb_build_object('id',c.id,'principalId',c.claimant_principal_id,'subjectId',c.subject_id,
   'submittedAt',c.submitted_at,'deadline',c.submitted_at+interval '30 days','revision',c.correction_revision,
   'kind',c.correction_kind,'statementHex',encode(c.statement_ciphertext,'hex'));
 elsif p_kind='appeal' then
  select * into a from public.appeal_intakes where id=p_id;
  select subject_id into subject from public.subject_principals where id=a.appellant_principal_id;
  if a.id is null or subject is null or a.state not in('submitted','reviewing') then raise exception using errcode='42501',message='not_found';end if;
  return jsonb_build_object('id',a.id,'principalId',a.appellant_principal_id,'subjectId',subject,
   'submittedAt',a.submitted_at,'deadline',a.submitted_at+interval '30 days','revision',a.appeal_revision,
   'kind',a.target_kind,'targetId',a.target_id,'statementHex',encode(a.statement_ciphertext,'hex'));
 end if;
 raise exception using errcode='22023',message='invalid_request';
end $$;

-- Owner-only, one registration, in the same native intake transaction. xmin
-- proves the last modifying transaction, not INSERT-only history: the trusted
-- native intake owner must pass the original NEW envelope, never convert a
-- legacy row. No API role can register a format or rewrite a registered key.
create function private.register_account_requester_statement_v1(p_kind text,p_id uuid,p_scope jsonb,p_envelope jsonb)
returns void language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare original jsonb;field text;keys integer;source_xid bigint;
begin
 original:=private.account_requester_case_v1(p_kind,p_id);
 if p_kind='correction' then select xmin::text::bigint into source_xid from public.correction_requests where id=p_id;
 else select xmin::text::bigint into source_xid from public.appeal_intakes where id=p_id;end if;
 if source_xid is distinct from mod(pg_catalog.pg_current_xact_id()::text::numeric,4294967296)::bigint then
  raise exception using errcode='42501',message='not_found';end if;
 if jsonb_typeof(p_scope) is distinct from 'object' or jsonb_typeof(p_envelope) is distinct from 'object' then
  raise exception using errcode='22023',message='invalid_request';end if;
 select count(*) into keys from jsonb_object_keys(p_scope);
 if p_scope->'version' is distinct from '1'::jsonb or p_scope->>'caseKind' is distinct from p_kind
  or p_scope->>'caseId' is distinct from p_id::text
  or p_scope->>'originalAuthorPrincipalId' is distinct from original->>'principalId'
  or p_scope->'initialStatementRevision' is distinct from '1'::jsonb or original->>'revision' is distinct from '1'
  or (p_scope->>'originalSubmittedAt')::timestamptz is distinct from (original->>'submittedAt')::timestamptz
  or (p_scope->>'originalDeadline')::timestamptz is distinct from (original->>'deadline')::timestamptz
  or (original->>'deadline')::timestamptz<=clock_timestamp()
  or p_envelope->>'format' is distinct from 'reviewer-only-case-statement-v1'
  or p_envelope->>'statementCiphertextHex' is distinct from original->>'statementHex'
  or length(p_envelope->>'statementCiphertextHex') not between 96 and 32056
  or (p_envelope->>'statementCiphertextHex')!~'^(?:[0-9a-f]{2})+$'
  or length(p_envelope->>'wrappedCaseKeyHex') is distinct from 144
  or (p_envelope->>'wrappedCaseKeyHex')!~'^[0-9a-f]{144}$' then
  raise exception using errcode='42501',message='not_found';end if;
 if p_kind='correction' then
  field:=p_scope->>'requestedField';
  if keys<>9 or not(p_scope ?& array['version','caseKind','caseId','originalAuthorPrincipalId','initialStatementRevision',
   'originalSubmittedAt','originalDeadline','requestedField','originalSubjectId'])
   or p_scope->>'originalSubjectId' is distinct from original->>'subjectId'
   or not(case field when 'display-label' then original->>'kind'='record_metadata'
    when 'disposition-record' then original->>'kind'='attribution' when 'identity-match-profile' then original->>'kind'='identity'
    when 'report-provenance' then original->>'kind'='attribution' when 'variant-call-source' then original->>'kind'='source_call' else false end)
   or (select count(*) from jsonb_object_keys(p_envelope))<>4
   or not(p_envelope ?& array['format','statementCiphertextHex','workingCiphertextHex','wrappedCaseKeyHex'])
   or not coalesce(length(p_envelope->>'workingCiphertextHex') between 96 and 32768
    and (p_envelope->>'workingCiphertextHex')~'^(?:[0-9a-f]{2})+$',false)
   or not exists(select 1 from public.correction_working_data w where w.correction_id=p_id and w.working_revision=1
    and encode(w.working_ciphertext,'hex')=p_envelope->>'workingCiphertextHex'
    and w.expires_at=(original->>'deadline')::timestamptz)
   then raise exception using errcode='42501',message='not_found';end if;
 else
  if keys<>8 or not(p_scope ?& array['version','caseKind','caseId','originalAuthorPrincipalId','initialStatementRevision',
    'originalSubmittedAt','originalDeadline','intakeKind'])
   or not coalesce(p_scope->>'intakeKind' in('subject-objection','genetic-parent-objection','access-or-review-appeal','contradiction-suspension-appeal'),false)
   or not(case p_scope->>'intakeKind' when 'subject-objection' then original->>'kind'='claim'
    when 'genetic-parent-objection' then original->>'kind'='claim'
    when 'access-or-review-appeal' then original->>'kind' in('access_decision','correction')
    when 'contradiction-suspension-appeal' then original->>'kind'='contradiction' else false end)
   or (select count(*) from jsonb_object_keys(p_envelope))<>3
   or not(p_envelope ?& array['format','statementCiphertextHex','wrappedCaseKeyHex']) then raise exception using errcode='42501',message='not_found';end if;
 end if;
 insert into private.account_requester_statement_capsules values(p_kind,p_id,(original->>'principalId')::uuid,
  (original->>'subjectId')::uuid,p_scope,p_envelope,encode(extensions.digest(original::text,'sha256'),'hex'));
end $$;

-- Current original author plus current own subject binding, never reviewer
-- assignment or mere access to somebody else's subject. Missing/legacy capsule
-- refuses the whole owned class; no supported subset is silently returned.
create function private.export_account_requester_rows_v1(p_account uuid,p_subjects uuid[])
returns table(id uuid,subject_id uuid,case_kind text,scope jsonb,envelope jsonb,principal_id uuid,binding_id uuid,
 principal_revision bigint,lifecycle_revision bigint,binding_revision bigint,case_hash text)
language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare item record;capsule private.account_requester_statement_capsules;original jsonb;
begin
 for item in
  select c.id,c.subject_id,'correction'::text kind,c.claimant_principal_id author from public.correction_requests c
   join public.subject_account_bindings b on b.subject_id=c.subject_id and b.account_id=p_account and b.status='current'
    and c.claimant_principal_id in(b.subject_principal_id,b.account_principal_id)
   where c.subject_id=any(p_subjects)
  union all
  select a.id,p.subject_id,'appeal',a.appellant_principal_id from public.appeal_intakes a
   join public.subject_principals p on p.id=a.appellant_principal_id
   join public.subject_account_bindings b on b.subject_id=p.subject_id and b.account_id=p_account and b.status='current'
    and a.appellant_principal_id in(b.subject_principal_id,b.account_principal_id)
   where p.subject_id=any(p_subjects) and (a.appellant_account_id is null or a.appellant_account_id=p_account)
  order by 1,3
 loop
  select * into capsule from private.account_requester_statement_capsules x where x.case_id=item.id and x.case_kind=item.kind;
  if capsule.case_id is null then raise exception using errcode='0A000',message='export_requester_statement_format_unavailable';end if;
  original:=private.account_requester_case_v1(item.kind,item.id);
  if capsule.native_case_sha256 is distinct from encode(extensions.digest(original::text,'sha256'),'hex')
   or capsule.author_principal_id is distinct from item.author or capsule.subject_id is distinct from item.subject_id
   or (capsule.scope->>'originalDeadline')::timestamptz<=clock_timestamp() then raise exception using errcode='42501',message='not_found';end if;
  select b.id,p.principal_revision,s.lifecycle_revision,b.binding_revision into binding_id,principal_revision,lifecycle_revision,binding_revision
   from public.subject_account_bindings b join public.subject_principals p on p.id=item.author
   join public.subject_principals ap on ap.id=b.account_principal_id join public.subject_principals sp on sp.id=b.subject_principal_id
   join public.subjects s on s.id=b.subject_id
   where b.subject_id=item.subject_id and b.account_id=p_account and b.status='current' and b.ended_at is null
    and item.author in(b.subject_principal_id,b.account_principal_id) and p.status='active'
    and ap.account_id=p_account and ap.status='active' and sp.status='active'
    and s.subject_account_id=p_account and s.lifecycle in('active','restricted','claimed_bound');
  if binding_id is null then raise exception using errcode='42501',message='not_found';end if;
  id:=item.id;subject_id:=item.subject_id;case_kind:=item.kind;scope:=capsule.scope;envelope:=capsule.envelope;
  principal_id:=item.author;case_hash:=capsule.native_case_sha256;return next;
 end loop;
end $$;

create function private.export_account_own_statement_capture_v1(p_account uuid,p_capture jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare subjects uuid[];rows jsonb;corrections bigint;appeals bigint;deadline timestamptz;kinds jsonb;parts jsonb;
begin
 select array_agg(x::uuid order by x) into subjects from jsonb_array_elements_text(p_capture#>'{authority,subjectPartitions}')x;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.id,x.case_kind),'[]') into rows from private.export_account_requester_rows_v1(p_account,subjects)x;
 select count(*) filter(where x->>'case_kind'='correction'),count(*) filter(where x->>'case_kind'='appeal'),
  min((x#>>'{scope,originalDeadline}')::timestamptz) into corrections,appeals,deadline from jsonb_array_elements(rows)x;
 select coalesce(jsonb_agg(jsonb_build_object('subjectId',subject,'rows',n) order by subject),'[]') into parts
  from(select x->>'subject_id' subject,count(*) n from jsonb_array_elements(rows)x group by x->>'subject_id')q;
 select jsonb_object_agg(kind,jsonb_build_object('rows',n,'membershipSha256',digest,'partitions',partitions)) into kinds from(
  select case label when 'correction' then 'correction_requests' else 'appeal_intakes' end kind,
   (select count(*) from jsonb_array_elements(rows)x where x->>'case_kind'=label)n,
   encode(extensions.digest(coalesce((select jsonb_agg(x order by x->>'id') from jsonb_array_elements(rows)x where x->>'case_kind'=label),'[]')::text,'sha256'),'hex')digest,
   coalesce((select jsonb_agg(jsonb_build_object('subjectId',subject,'rows',n) order by subject) from(
    select x->>'subject_id' subject,count(*) n from jsonb_array_elements(rows)x where x->>'case_kind'=label group by x->>'subject_id')q),'[]')partitions
  from unnest(array['correction','appeal'])label)q;
 return jsonb_build_object('version','test-account-own-statements-v2','corrections',corrections,'appeals',appeals,
  'membershipSha256',encode(extensions.digest(rows::text,'sha256'),'hex'),'originalDeadline',deadline,'partitions',parts,'classes',kinds);
end $$;

-- Retain every existing graph/result/metadata branch. Only these two classes
-- gain the exact requester projection; all other unsupported classes stay closed.
do $patch$
declare definition text;anchor text:=E'  else\n   handling:=''unsupported'';';replacement text;declaration text:='scientific_frame jsonb;ordinary uuid[];';
begin
 definition:=pg_catalog.pg_get_functiondef('private.export_account_class_inventory_v1(uuid,jsonb)'::regprocedure);
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'requester_class_predecessor_unavailable';end if;
 if (length(definition)-length(replace(definition,declaration,'')))/length(declaration)<>1 then raise exception 'requester_class_predecessor_unavailable';end if;
 definition:=replace(definition,declaration,'scientific_frame jsonb;ordinary uuid[];requester_frame jsonb;');
 replacement:=E'  elsif kind in(''correction_requests'',''appeal_intakes'') then\n   handling:=''requester-statements'';\n   requester_frame:=private.export_account_own_statement_capture_v1(p_account,p_capture)->''classes''->kind;\n   n:=(requester_frame->>''rows'')::bigint;digest:=decode(requester_frame->>''membershipSha256'',''hex'');counts:=requester_frame->''partitions'';\n'||anchor;
 execute replace(definition,anchor,replacement);
end $patch$;

alter function private.export_account_owned_capture_v1(jsonb,text,uuid) rename to export_account_owned_capture_pre_requester_v1;
create function private.export_account_owned_capture_v1(p_origin jsonb,p_target_kind text,p_target_id uuid)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare captured jsonb;statements jsonb;receipt text;
begin
 captured:=private.export_account_owned_capture_pre_requester_v1(p_origin,p_target_kind,p_target_id);
 if p_target_kind<>'account' then return captured;end if;
 statements:=private.export_account_own_statement_capture_v1((p_origin->>'accountId')::uuid,captured);
 receipt:=encode(extensions.digest(jsonb_build_object('version','account-requester-statements-v2','capture',captured,'ownStatements',statements)::text,'sha256'),'hex');
 return jsonb_set(captured,'{authority,authorityReceipt}',to_jsonb(receipt))||jsonb_build_object('ownStatements',statements);
end $$;

alter function public.export_archive_account_members_v1(text,uuid,uuid,text,uuid,text) rename to export_archive_account_members_pre_requester_v1;
create function public.export_archive_account_members_v1(p_operation text,p_export_id uuid,p_attempt_id uuid,
 p_authority_receipt text,p_subject_id uuid default null,p_after_id text default null)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare permit jsonb;capture jsonb;result jsonb;account uuid;session uuid;rev bigint;session_rev bigint;
begin
 if p_operation is distinct from 'own-statements' then
  return public.export_archive_account_members_pre_requester_v1(p_operation,p_export_id,p_attempt_id,p_authority_receipt,p_subject_id,p_after_id);end if;
 if auth.jwt()->>'role' is distinct from 'service_role' or p_subject_id is null then raise exception using errcode='42501',message='not_found';end if;
 permit:=private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt);
 if permit->>'targetKind' is distinct from 'account' or not(permit->'partitions' ? p_subject_id::text) then raise exception using errcode='42501',message='not_found';end if;
 account:=(permit#>>'{origin,accountId}')::uuid;session:=(permit#>>'{origin,sessionId}')::uuid;
 capture:=private.export_account_owned_capture_v1(permit->'origin','account',account);
 select auth_session_revision into rev from public.profiles where id=account;
 select coalesce(refresh_token_counter,0)+1 into session_rev from auth.sessions where id=session and user_id=account;
 if rev is null or session_rev is null then raise exception using errcode='42501',message='not_found';end if;
 select jsonb_build_object('rows',coalesce(jsonb_agg(jsonb_build_object('id',x.id,'frame',jsonb_build_object('scope',x.scope,'envelope',x.envelope,
  'binding',jsonb_build_object('accountId',account,'sessionId',session,'bindingId',x.binding_id,'principalId',x.principal_id,'subjectId',x.subject_id,
   'accountAuthSessionRevision',rev,'sessionRevision',session_rev,'principalRevision',x.principal_revision,'lifecycleRevision',x.lifecycle_revision,
   'bindingRevision',x.binding_revision,'sourceReceipt',p_authority_receipt,'caseHash',x.case_hash))) order by x.id),'[]'),
   'count',count(*),'nextAfterId',max(x.id::text)) into result
  from(select * from private.export_account_requester_rows_v1(account,array[p_subject_id]) r
   where p_after_id is null or r.id>p_after_id::uuid order by r.id limit 32)x;
 if octet_length(result::text)>2000000 then raise exception using errcode='55000',message='export_source_unavailable';end if;
 if private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt) is distinct from permit
  or private.export_account_owned_capture_v1(permit->'origin','account',account) is distinct from capture then raise exception using errcode='42501',message='not_found';end if;
 return result;
end $$;
revoke all on function public.export_archive_account_members_pre_requester_v1(text,uuid,uuid,text,uuid,text) from public,anon,authenticated,service_role,inherit_upload_only;
revoke all on function public.export_archive_account_members_v1(text,uuid,uuid,text,uuid,text) from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.export_archive_account_members_v1(text,uuid,uuid,text,uuid,text) to service_role;

-- Add only the captured requester descriptor to the existing four-field context.
do $patch$
declare definition text;anchor text:=$anchor$'boundSnapshots',(select$anchor$;
begin
 definition:=pg_catalog.pg_get_functiondef('public.export_archive_account_classes_v1(text,uuid,uuid,text,text,uuid)'::regprocedure);
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'requester_context_predecessor_unavailable';end if;
 execute replace(definition,anchor,$replacement$'ownStatements',captured->'ownStatements',
   $replacement$||anchor);
end $patch$;
revoke all on function private.account_requester_case_v1(text,uuid),private.register_account_requester_statement_v1(text,uuid,jsonb,jsonb),
 private.export_account_requester_rows_v1(uuid,uuid[]),private.export_account_own_statement_capture_v1(uuid,jsonb),
 private.export_account_owned_capture_v1(jsonb,text,uuid),private.export_account_owned_capture_pre_requester_v1(jsonb,text,uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;

create or replace function private.export_archive_account_authority_v1(p_origin jsonb,p_target_kind text,p_target_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog set lock_timeout='250ms' as $$
begin
 if p_target_kind='account' then return private.export_account_owned_capture_v1(p_origin,p_target_kind,p_target_id)->'authority';end if;
 if not exists(select 1 from public.subjects where subject_account_id=(p_origin->>'accountId')::uuid
  and subject_class='embryo' and lifecycle='claimed_bound' and id=p_target_id) then
  return private.export_archive_ordinary_account_authority_v1(p_origin,p_target_kind,p_target_id);end if;
 return private.export_account_owned_capture_v1(p_origin,p_target_kind,p_target_id)->'authority';
end $$;
revoke all on function private.export_archive_account_authority_v1(jsonb,text,uuid) from public,anon,authenticated,service_role,inherit_upload_only;

-- No orphaned encryption key survives deletion of its actual source case.
create function private.delete_account_requester_capsule_v1() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' or new.state not in('submitted','reviewing') then
  delete from private.account_requester_statement_capsules where case_id=old.id
   and case_kind=case when tg_table_name='correction_requests' then 'correction' else 'appeal' end;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function private.delete_account_requester_capsule_v1() from public,anon,authenticated,service_role,inherit_upload_only;
create trigger delete_account_requester_capsule after delete on public.correction_requests
 for each row execute function private.delete_account_requester_capsule_v1();
create trigger delete_account_requester_capsule after delete on public.appeal_intakes
 for each row execute function private.delete_account_requester_capsule_v1();
create trigger close_account_requester_capsule after update of state on public.correction_requests
 for each row execute function private.delete_account_requester_capsule_v1();
create trigger close_account_requester_capsule after update of state on public.appeal_intakes
 for each row execute function private.delete_account_requester_capsule_v1();

-- Include the key envelope in the existing physical erasure graph, not an
-- uncounted trigger side effect. Every existing selector/identity remains exact.
insert into public.purge_target_stores(target_id,store_name,store_order)
 select 'appeal-and-correction-working-packages','private.account_requester_statement_capsules',max(store_order)+1
 from public.purge_target_stores where target_id='appeal-and-correction-working-packages';
alter function private.future_person_deletion_graph_rows_v1(uuid,uuid,uuid,uuid,uuid)
 rename to future_person_deletion_graph_rows_pre_requester_v1;
create function private.future_person_deletion_graph_rows_v1(p_subject uuid,p_claimant uuid,p_file uuid,p_embryo uuid,p_audit uuid)
returns table(purge_target_id text,physical_store text,primary_key jsonb)
language plpgsql stable security definer set search_path='' as $$
begin
 return query select * from private.future_person_deletion_graph_rows_pre_requester_v1(p_subject,p_claimant,p_file,p_embryo,p_audit);
 return query select 'appeal-and-correction-working-packages'::text,'private.account_requester_statement_capsules'::text,
  jsonb_build_object('case_kind',c.case_kind,'case_id',c.case_id) from private.account_requester_statement_capsules c
  where c.subject_id=p_subject or c.author_principal_id in(select id from public.subject_principals where subject_id=p_subject);
end $$;
alter function private.future_person_deletion_row_v1(text,jsonb,boolean) rename to future_person_deletion_row_pre_requester_v1;
create function private.future_person_deletion_row_v1(p_store text,p_key jsonb,p_delete boolean default false)
returns bigint language plpgsql security definer set search_path='' as $$
declare n bigint;
begin
 if p_store is distinct from 'private.account_requester_statement_capsules' then
  return private.future_person_deletion_row_pre_requester_v1(p_store,p_key,p_delete);end if;
 if p_delete is null or jsonb_typeof(p_key) is distinct from 'object'
  or (select count(*) from jsonb_object_keys(p_key))<>2 or not(p_key ?& array['case_kind','case_id'])
  or not coalesce(p_key->>'case_kind' in('appeal','correction'),false) or jsonb_typeof(p_key->'case_id') is distinct from 'string'
  then raise exception using errcode='42501',message='claimant deletion unavailable';end if;
 if p_delete then
  delete from private.account_requester_statement_capsules where case_kind=p_key->>'case_kind' and case_id=(p_key->>'case_id')::uuid;
  get diagnostics n=row_count;
 else select count(*) into n from private.account_requester_statement_capsules where case_kind=p_key->>'case_kind' and case_id=(p_key->>'case_id')::uuid;end if;
 return n;
end $$;
revoke all on function private.future_person_deletion_graph_rows_v1(uuid,uuid,uuid,uuid,uuid),
 private.future_person_deletion_graph_rows_pre_requester_v1(uuid,uuid,uuid,uuid,uuid),
 private.future_person_deletion_row_v1(text,jsonb,boolean),private.future_person_deletion_row_pre_requester_v1(text,jsonb,boolean)
 from public,anon,authenticated,service_role,inherit_upload_only;
create trigger future_person_sealed_graph_delete before delete on private.account_requester_statement_capsules
 for each row execute function private.guard_future_person_sealed_graph_delete_v1();
