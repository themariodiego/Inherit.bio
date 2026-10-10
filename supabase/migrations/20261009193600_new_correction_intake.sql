-- The existing claimant correction route's three native transaction doors.
-- TEST activation remains owner-only and disabled; no reviewer approval,
-- result mutation, delivery success or account adoption is implied by intake.
create table private.new_correction_intake_config (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false
);
insert into private.new_correction_intake_config(singleton) values(true);
create table private.new_correction_reviewers (
 principal_id uuid primary key references public.subject_principals(id) on delete restrict,
 principal_revision bigint not null check(principal_revision>0),
 purpose_revision bigint not null check(purpose_revision>0),
 active boolean not null default true
);
create table private.new_correction_intakes (
 id uuid primary key,
 rights_session_id uuid not null,
 nonce_hash text not null check(nonce_hash~'^[0-9a-f]{64}$'),
 subject_id uuid not null references public.subjects(id) on delete restrict,
 author_principal_id uuid not null references public.subject_principals(id) on delete restrict,
 frame jsonb not null,
 reviewer_principal_id uuid not null references private.new_correction_reviewers(principal_id) on delete restrict,
 reviewer_purpose_revision bigint not null check(reviewer_purpose_revision>0),
 prepare_expires_at timestamptz not null,
 deadline timestamptz not null,
 state text not null check(state in('prepared','committed','closed')),
 wrapped_case_key bytea,
 case_contact_id uuid,
 unique(rights_session_id,nonce_hash),
 check((state='committed')=(wrapped_case_key is not null)),
 check(wrapped_case_key is null or octet_length(wrapped_case_key)=72)
);
do $private$ declare name text;begin
 foreach name in array array['new_correction_intake_config','new_correction_reviewers','new_correction_intakes'] loop
  execute format('alter table private.%I enable row level security',name);
  execute format('revoke all on private.%I from public,anon,authenticated,service_role,inherit_upload_only',name);
 end loop;
end $private$;

-- Original identities, recipient, scope and clocks cannot be reauthored;
-- a completion can only install the first key/contact then erase that key.
create function private.guard_new_correction_intake_v1() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if (to_jsonb(new)-array['state','wrapped_case_key','case_contact_id'])
  is distinct from (to_jsonb(old)-array['state','wrapped_case_key','case_contact_id']) then
  raise exception using errcode='42501',message='not_found';end if;
 if old.state='prepared' and new.state='committed' and new.wrapped_case_key is not null
  and new.case_contact_id=(old.frame->>'caseContactId')::uuid then return new;end if;
 if old.state in('prepared','committed') and new.state='closed' and new.wrapped_case_key is null
  and new.case_contact_id is not distinct from old.case_contact_id then return new;end if;
 if to_jsonb(new) is not distinct from to_jsonb(old) then return new;end if;
 raise exception using errcode='42501',message='not_found';
end $$;
revoke all on function private.guard_new_correction_intake_v1() from public,anon,authenticated,service_role,inherit_upload_only;
create trigger guard_new_correction_intake before update on private.new_correction_intakes
 for each row execute function private.guard_new_correction_intake_v1();

create function private.assert_new_correction_actor_v1(p_session_hash text,p_nonce text)
returns public.rights_sessions language plpgsql security definer set search_path='' as $$
declare rs public.rights_sessions;
begin
 perform 1 from private.new_correction_intake_config where singleton and enabled for share;
 if not found or p_nonce is null or char_length(p_nonce) not between 16 and 256 or p_nonce!~'^[A-Za-z0-9_-]+$' then
  raise exception using errcode='42501',message='not_found';end if;
 rs:=private.future_person_rights_session_v1(p_session_hash,true);
 if rs.id is null or not private.rights_action_permitted_v1(rs.purpose,'correct','api.future-person-correction')
  or exists(select 1 from public.rights_nonces n where n.rights_session_id=rs.id
   and n.nonce_hash=encode(extensions.digest(convert_to(p_nonce,'UTF8'),'sha256'),'hex')) then
  raise exception using errcode='42501',message='not_found';end if;
 return rs;
end $$;

create function public.prepare_new_correction_v1(p_session_hash text,p_nonce text,p_field text)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare rs public.rights_sessions;reviewer record;contact public.encrypted_contact_references;
 frame jsonb;case_id uuid:=gen_random_uuid();submitted timestamptz:=date_trunc('milliseconds',clock_timestamp());
 nonce_hash text;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' or p_field is null
  or p_field not in('display-label','disposition-record','identity-match-profile','report-provenance','variant-call-source') then
  raise exception using errcode='42501',message='not_found';end if;
 rs:=private.assert_new_correction_actor_v1(p_session_hash,p_nonce);
 nonce_hash:=encode(extensions.digest(convert_to(p_nonce,'UTF8'),'sha256'),'hex');
 -- Owner names this purpose's reviewer; a request never selects a reviewer.
 select r.* into reviewer from private.new_correction_reviewers r
  join public.subject_principals p on p.id=r.principal_id and p.principal_revision=r.principal_revision
   and p.principal_kind='reviewer' and p.status='active'
  join private.claim_reviewers a on a.account_id=p.account_id and a.status='active'
  where r.active order by r.principal_id limit 1 for share of r,p,a;
 if reviewer.principal_id is null then raise exception using errcode='42501',message='not_found';end if;
 select e.* into contact from public.token_hashes h
  join public.future_person_claim_release_credentials c on c.candidate_id=h.candidate_id
  join public.encrypted_contact_references e on e.id=c.contact_reference_id
   and e.principal_id=rs.principal_id and e.status='current' and e.contact_ciphertext is not null
  where h.id=rs.token_hash_id and h.status='consumed' and c.status='consumed'
  for share of e;
 if contact.id is null then raise exception using errcode='42501',message='not_found';end if;
 frame:=jsonb_build_object('scope',jsonb_build_object('version',1,'caseKind','correction','caseId',case_id,
  'originalAuthorPrincipalId',rs.principal_id,'initialStatementRevision',1,
  'originalSubmittedAt',to_char(submitted at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'originalDeadline',to_char((submitted+interval '30 days') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'requestedField',p_field,'originalSubjectId',rs.target_id),
  'rightsSessionId',rs.id,'authorityRevision',rs.authority_revision,'tokenHashId',rs.token_hash_id,
  'reviewerPrincipalId',reviewer.principal_id,'reviewerPrincipalRevision',reviewer.principal_revision,
  'assignmentRevision',1,'sourceContactReferenceId',contact.id,
  'sourceContactFingerprint',encode(extensions.digest(contact.contact_ciphertext,'sha256'),'hex'),
  'caseContactId',gen_random_uuid());
 insert into private.new_correction_intakes(id,rights_session_id,nonce_hash,subject_id,author_principal_id,frame,
  reviewer_principal_id,reviewer_purpose_revision,prepare_expires_at,deadline,state)
 values(case_id,rs.id,nonce_hash,rs.target_id,rs.principal_id,frame,reviewer.principal_id,reviewer.purpose_revision,
  least(rs.expires_at,submitted+interval '10 minutes'),submitted+interval '30 days','prepared');
 return frame;
end $$;

-- Every stage re-reads the original source, session, reviewer and full frame.
-- Parsing an opaque case ID or possessing previously selected ciphertext is
-- insufficient; preparation is one-shot and cannot be regenerated on replay.
create function private.assert_new_correction_preparation_v1(p_session_hash text,p_nonce text,p_expected jsonb)
returns private.new_correction_intakes language plpgsql security definer set search_path='' as $$
declare rs public.rights_sessions;i private.new_correction_intakes;contact public.encrypted_contact_references;
begin
 rs:=private.assert_new_correction_actor_v1(p_session_hash,p_nonce);
 select * into i from private.new_correction_intakes x where x.rights_session_id=rs.id
  and x.nonce_hash=encode(extensions.digest(convert_to(p_nonce,'UTF8'),'sha256'),'hex') for update;
 if i.id is null or i.state<>'prepared' or i.prepare_expires_at<=clock_timestamp()
  or i.frame is distinct from p_expected
  or i.deadline is distinct from (i.frame#>>'{scope,originalDeadline}')::timestamptz
  or i.id is distinct from (i.frame#>>'{scope,caseId}')::uuid
  or i.subject_id is distinct from rs.target_id
  or i.author_principal_id is distinct from rs.principal_id
  or i.frame->>'authorityRevision' is distinct from rs.authority_revision::text
  or i.frame->>'tokenHashId' is distinct from rs.token_hash_id::text
 then raise exception using errcode='42501',message='not_found';end if;
 -- Share-lock every current recipient row through the read/commit transaction;
 -- a concurrent purpose/reviewer revocation cannot pass an unlocked EXISTS.
 perform 1 from private.new_correction_reviewers r
  join public.subject_principals p on p.id=r.principal_id and p.status='active' and p.principal_kind='reviewer'
   and p.principal_revision=r.principal_revision
  join private.claim_reviewers a on a.account_id=p.account_id and a.status='active'
  where r.principal_id=i.reviewer_principal_id and r.active and r.purpose_revision=i.reviewer_purpose_revision
   and r.principal_revision=(i.frame->>'reviewerPrincipalRevision')::bigint for share of r,p,a;
 if not found then raise exception using errcode='42501',message='not_found';end if;
 select e.* into contact from public.token_hashes h
  join public.future_person_claim_release_credentials c on c.candidate_id=h.candidate_id
  join public.encrypted_contact_references e on e.id=c.contact_reference_id
   and e.principal_id=rs.principal_id and e.status='current' and e.contact_ciphertext is not null
  where h.id=rs.token_hash_id and c.status='consumed' and e.id=(i.frame->>'sourceContactReferenceId')::uuid
  for share of e;
 if contact.id is null or encode(extensions.digest(contact.contact_ciphertext,'sha256'),'hex')
  is distinct from i.frame->>'sourceContactFingerprint' then raise exception using errcode='42501',message='not_found';end if;
 return i;
end $$;

create function public.read_new_correction_intake_contact_v1(p_session_hash text,p_nonce text,p_expected jsonb)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare i private.new_correction_intakes;cipher bytea;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception using errcode='42501',message='not_found';end if;
 i:=private.assert_new_correction_preparation_v1(p_session_hash,p_nonce,p_expected);
 select contact_ciphertext into cipher from public.encrypted_contact_references where id=(i.frame->>'sourceContactReferenceId')::uuid;
 return jsonb_build_object('caseContactId',i.frame->'caseContactId','sourceContactCiphertextHex',encode(cipher,'hex'));
end $$;

create function public.commit_new_correction_v1(p_session_hash text,p_nonce text,p_expected jsonb,
 p_statement bytea,p_working bytea,p_wrapped_key bytea,p_contact_cipher bytea,p_contact_hmac_set jsonb)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare i private.new_correction_intakes;rs public.rights_sessions;digests jsonb;active_revision bigint;source_contact uuid;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception using errcode='42501',message='not_found';end if;
 i:=private.assert_new_correction_preparation_v1(p_session_hash,p_nonce,p_expected);
 if p_statement is null or octet_length(p_statement) not between 48 and 16028
  or p_working is null or octet_length(p_working) not between 48 and 16384
  or p_wrapped_key is null or octet_length(p_wrapped_key)<>72
  or p_contact_cipher is null or octet_length(p_contact_cipher) not between 29 and 16384 then
  raise exception using errcode='22023',message='invalid_request';end if;
 digests:=private.resolve_hmac_set_v1('contact',null,p_contact_hmac_set);
 source_contact:=(i.frame->>'sourceContactReferenceId')::uuid;
 if digests is null or exists(select 1 from jsonb_each_text(digests) d
  where not exists(select 1 from public.contact_hmac_indexes h where h.contact_reference_id=source_contact
   and h.hmac_key_revision=d.key::bigint and h.contact_hmac=d.value and h.status='current' and h.expires_at>clock_timestamp())
  and not exists(select 1 from public.encrypted_contact_references e where e.id=source_contact
   and e.key_revision=d.key::bigint and e.contact_hmac=d.value and e.status='current')) then
  raise exception using errcode='42501',message='not_found';end if;
 perform private.declare_contact_alias_groups_v1(jsonb_build_array(digests));
 active_revision:=private.hmac_active_revision_v1('contact');
 rs:=private.future_person_rights_session_v1(p_session_hash,true);
 perform private.consume_future_person_rights_nonce_v1(rs,p_nonce);
 insert into public.correction_requests(id,subject_id,claimant_principal_id,correction_kind,correction_revision,
  statement_ciphertext,state,submitted_at)
 values(i.id,i.subject_id,i.author_principal_id,case i.frame#>>'{scope,requestedField}'
  when 'display-label' then 'record_metadata' when 'disposition-record' then 'attribution'
  when 'identity-match-profile' then 'identity' when 'report-provenance' then 'attribution' else 'source_call' end,
  1,p_statement,'submitted',(i.frame#>>'{scope,originalSubmittedAt}')::timestamptz);
 insert into public.correction_working_data(correction_id,working_ciphertext,working_revision,expires_at)
 values(i.id,p_working,1,i.deadline);
 insert into public.encrypted_contact_references(id,principal_id,contact_ciphertext,contact_hmac,key_revision,authority_revision)
 values((i.frame->>'caseContactId')::uuid,i.author_principal_id,p_contact_cipher,digests->>active_revision::text,
  active_revision,(select principal_revision from public.subject_principals where id=i.author_principal_id));
 insert into public.contact_hmac_indexes(contact_reference_id,contact_hmac,hmac_key_revision,expires_at)
 select (i.frame->>'caseContactId')::uuid,d.value,d.key::bigint,i.deadline from jsonb_each_text(digests)d;
 -- This call occurs immediately after the actual INSERTs, in their transaction.
 -- The server cannot label/convert a preexisting opaque row as a NEW envelope.
 perform private.register_account_requester_statement_v1('correction',i.id,i.frame->'scope',
  jsonb_build_object('format','reviewer-only-case-statement-v1','statementCiphertextHex',encode(p_statement,'hex'),
   'workingCiphertextHex',encode(p_working,'hex'),'wrappedCaseKeyHex',encode(p_wrapped_key,'hex')));
 update private.new_correction_intakes set state='committed',wrapped_case_key=p_wrapped_key,
  case_contact_id=(i.frame->>'caseContactId')::uuid where id=i.id;
 return jsonb_build_object('status','review_pending','correctionId',i.id);
end $$;

revoke all on function private.assert_new_correction_actor_v1(text,text),
 private.assert_new_correction_preparation_v1(text,text,jsonb) from public,anon,authenticated,service_role,inherit_upload_only;
revoke all on function public.prepare_new_correction_v1(text,text,text),
 public.read_new_correction_intake_contact_v1(text,text,jsonb),
 public.commit_new_correction_v1(text,text,jsonb,bytea,bytea,bytea,bytea,jsonb)
 from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.prepare_new_correction_v1(text,text,text),
 public.read_new_correction_intake_contact_v1(text,text,jsonb),
 public.commit_new_correction_v1(text,text,jsonb,bytea,bytea,bytea,bytea,jsonb) to service_role;

-- Expiry/terminal disposition never extends the original case clock. Remove
-- only this NEW case's mutable package/key and independently cloned contact;
-- retain its coded intake row. No remote-copy, history or purge ACK is implied.
create function private.shred_new_correction_package_v1(p_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare i private.new_correction_intakes;
begin
 select * into i from private.new_correction_intakes where id=p_id for update;
 if i.id is null or i.state='closed' then return false;end if;
 delete from private.account_requester_statement_capsules where case_kind='correction' and case_id=i.id;
 delete from public.correction_working_data where correction_id=i.id;
 update public.correction_requests set statement_ciphertext=''::bytea where id=i.id;
 if i.case_contact_id is not null then
  update public.contact_hmac_indexes set status='expired' where contact_reference_id=i.case_contact_id;
  update public.encrypted_contact_references set contact_ciphertext=null,status='shredded',ended_at=clock_timestamp()
   where id=i.case_contact_id and principal_id=i.author_principal_id;
 end if;
 update private.new_correction_intakes set state='closed',wrapped_case_key=null where id=i.id;
 return true;
end $$;
create function private.close_new_correction_package_v1() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.state not in('submitted','reviewing') then perform private.shred_new_correction_package_v1(new.id);end if;
 return new;
end $$;
create trigger close_new_correction_package after update of state on public.correction_requests
 for each row execute function private.close_new_correction_package_v1();
create function public.drain_due_new_corrections_v1() returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare i record;n integer:=0;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception using errcode='42501',message='not_found';end if;
 for i in select x.id,x.state from private.new_correction_intakes x where x.state<>'closed'
  and ((x.state='prepared' and x.prepare_expires_at<=clock_timestamp()) or x.deadline<=clock_timestamp()
   or exists(select 1 from public.correction_requests c where c.id=x.id and c.state not in('submitted','reviewing')))
  order by x.id for update of x loop
  perform private.shred_new_correction_package_v1(i.id);
  update public.correction_requests set state='expired',decided_at=clock_timestamp()
   where id=i.id and state in('submitted','reviewing');
  n:=n+1;
 end loop;
 return jsonb_build_object('shredded',n,'completed',n,'held',0);
end $$;
revoke all on function private.shred_new_correction_package_v1(uuid),private.close_new_correction_package_v1()
 from public,anon,authenticated,service_role,inherit_upload_only;
revoke all on function public.drain_due_new_corrections_v1() from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.drain_due_new_corrections_v1() to service_role;

-- This extra retained row is explicitly in the complete existing erasure
-- graph. The unchanged old graph and all old row selectors are delegated.
insert into public.purge_target_stores(target_id,store_name,store_order)
 select 'appeal-and-correction-working-packages','private.new_correction_intakes',max(store_order)+1
 from public.purge_target_stores where target_id='appeal-and-correction-working-packages';
alter function private.future_person_deletion_graph_rows_v1(uuid,uuid,uuid,uuid,uuid)
 rename to future_person_deletion_graph_rows_pre_new_correction_v1;
create function private.future_person_deletion_graph_rows_v1(p_subject uuid,p_claimant uuid,p_file uuid,p_embryo uuid,p_audit uuid)
returns table(purge_target_id text,physical_store text,primary_key jsonb)
language plpgsql stable security definer set search_path='' as $$
begin
 return query select * from private.future_person_deletion_graph_rows_pre_new_correction_v1(p_subject,p_claimant,p_file,p_embryo,p_audit);
 return query select 'appeal-and-correction-working-packages'::text,'private.new_correction_intakes'::text,
  jsonb_build_object('id',i.id) from private.new_correction_intakes i where i.subject_id=p_subject
   or i.author_principal_id in(select p.id from public.subject_principals p where p.subject_id=p_subject);
end $$;
alter function private.future_person_deletion_row_v1(text,jsonb,boolean) rename to future_person_deletion_row_pre_new_correction_v1;
create function private.future_person_deletion_row_v1(p_store text,p_key jsonb,p_delete boolean default false)
returns bigint language plpgsql security definer set search_path='' as $$
declare n bigint;
begin
 if p_store is distinct from 'private.new_correction_intakes' then
  return private.future_person_deletion_row_pre_new_correction_v1(p_store,p_key,p_delete);end if;
 if p_delete is null or jsonb_typeof(p_key) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_key))<>1
  or jsonb_typeof(p_key->'id') is distinct from 'string' then raise exception using errcode='42501',message='claimant deletion unavailable';end if;
 if p_delete then delete from private.new_correction_intakes where id=(p_key->>'id')::uuid;get diagnostics n=row_count;
 else select count(*) into n from private.new_correction_intakes where id=(p_key->>'id')::uuid;end if;
 return n;
end $$;
revoke all on function private.future_person_deletion_graph_rows_v1(uuid,uuid,uuid,uuid,uuid),
 private.future_person_deletion_graph_rows_pre_new_correction_v1(uuid,uuid,uuid,uuid,uuid),
 private.future_person_deletion_row_v1(text,jsonb,boolean),private.future_person_deletion_row_pre_new_correction_v1(text,jsonb,boolean)
 from public,anon,authenticated,service_role,inherit_upload_only;
create trigger future_person_sealed_graph_delete before delete on private.new_correction_intakes
 for each row execute function private.guard_future_person_sealed_graph_delete_v1();
