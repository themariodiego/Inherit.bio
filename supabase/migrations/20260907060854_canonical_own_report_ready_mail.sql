-- Email-only transitions have their own counter: they must not invalidate
-- scientific authority or use a generic Auth updated_at/session revision.
-- Profiles are seeded by the Auth INSERT trigger, never by browser recreation.
alter table public.profiles add column mail_contact_revision bigint not null default 1
 check(mail_contact_revision>0);
create function private.guard_profile_mail_contact_revision_v1()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if current_user in ('anon','authenticated','inherit_upload_only') and (
  tg_op='INSERT' or
  (tg_op='UPDATE' and new.mail_contact_revision is distinct from old.mail_contact_revision)) then
  raise exception using errcode='42501',message='mail_contact_revision_server_only'; end if;
 return new;
end; $$;
revoke all on function private.guard_profile_mail_contact_revision_v1() from public,anon,authenticated,inherit_upload_only;
create trigger profiles_mail_contact_revision_server_only before insert or update on public.profiles
 for each row execute function private.guard_profile_mail_contact_revision_v1();

-- Durable own-report notices use the same canonical source/grant predicates
-- as result reads, without requiring an originating browser session to remain
-- logged in. These mail-only resolvers never authorize genetic reads or jobs.
create function private.own_upload_context_mail_v1(p_account_id uuid,p_subject_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare
 p public.profiles%rowtype;
 s public.subjects%rowtype;
 b public.subject_account_bindings%rowtype;
begin
 perform 1 from auth.users u where u.id=p_account_id and u.deleted_at is null;
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 select * into p from public.profiles where id=p_account_id;
 if p.id is null or p.deletion_requested_at is not null or exists(select 1 from public.account_deletion_requests d where d.account_id=p_account_id and (d.state in ('delete_started','complete') or d.delete_started_at is not null or d.database_purged_at is not null)) then
  raise exception using errcode='42501',message='not_found'; end if;
 select * into s from public.subjects where id=p_subject_id;
 if s.id is null or s.subject_account_id is distinct from p_account_id
  or s.subject_class not in ('self','other_adult') or s.lifecycle not in ('active','claimed_bound') then
  raise exception using errcode='42501',message='not_found'; end if;
 select sab.* into b from public.subject_account_bindings sab
  join public.subject_principals sp on sp.id=sab.subject_principal_id
   and sp.subject_id=s.id and sp.account_id=p_account_id
   and sp.principal_kind='account_subject' and sp.status='active'
  where sab.subject_id=s.id and sab.account_id=p_account_id and sab.status='current'
 ;
 if b.id is null then raise exception using errcode='42501',message='not_found'; end if;
 return jsonb_build_object('accountRevision',p.account_revision,'authSessionRevision',p.auth_session_revision,
  'jurisdictionRevision',p.jurisdiction_revision,'subjectBindingRevision',s.subject_binding_revision,
  'accountBindingRevision',b.binding_revision,'birthDateState',case
   when p.date_of_birth is null then 'missing'
   when p.date_of_birth<=(timezone('UTC',clock_timestamp())::date-interval '18 years')::date then 'adult'
   else 'underage' end);
end;
$function$;
revoke all on function private.own_upload_context_mail_v1(uuid,uuid) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.own_upload_context_mail_v1(uuid,uuid) to service_role;

create function private.own_upload_store_authority_mail_v1(p_account_id uuid,p_subject_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare c jsonb; v_consent uuid; v_principal uuid; v_lifecycle bigint; v_session bigint;
begin
 c:=private.own_upload_context_mail_v1(p_account_id,p_subject_id);
 perform 1 from auth.users where id=p_account_id and (banned_until is null or banned_until<=clock_timestamp());
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 if c->>'birthDateState'<>'adult' then raise exception using errcode='55000',message='adult_account_required'; end if;
 select lifecycle_revision into v_lifecycle from public.subjects where id=p_subject_id;
 v_session:=null;
 select subject_principal_id into v_principal from public.subject_account_bindings
  where subject_id=p_subject_id and account_id=p_account_id and status='current'
  and binding_revision=(c->>'accountBindingRevision')::bigint;
 -- Both artifacts must still be current, hash-verified and signed at this binding.
 perform 1 from public.consent_signatures cs join public.consent_artifacts ca
  on ca.artifact_key=cs.artifact_key and ca.version=cs.artifact_version
  and ca.body_sha256=cs.artifact_body_sha256
 where cs.target_kind='subject' and cs.target_id=p_subject_id and cs.signer_account_id=p_account_id
  and cs.signer_principal_id=v_principal and cs.subject_binding_revision=(c->>'subjectBindingRevision')::bigint
  and cs.jurisdiction_revision=(c->>'jurisdictionRevision')::bigint
  and ca.artifact_key='disclosure.insurance-and-discrimination' and ca.superseded_at is null
  and ca.published_at<=clock_timestamp() and ca.effective_on<=timezone('UTC',clock_timestamp())::date
  and ca.body_sha256=encode(extensions.digest(convert_to(ca.body_markdown,'UTF8'),'sha256'),'hex')
;
 if not found then raise exception using errcode='55000',message='insurance_acknowledgement_required'; end if;
 select sc.id into v_consent from public.subject_consents sc
 join public.consent_signatures cs on cs.id=sc.signature_id
 join public.consent_artifacts ca on ca.artifact_key=cs.artifact_key and ca.version=cs.artifact_version
  and ca.body_sha256=cs.artifact_body_sha256
 where sc.subject_id=p_subject_id and sc.account_id=p_account_id and sc.consent_type='upload_class'
  and sc.scope=array['store'] and sc.revoked_at is null and (sc.expires_at is null or sc.expires_at>clock_timestamp())
  and cs.target_kind='subject' and cs.target_id=p_subject_id and cs.signer_account_id=p_account_id
  and cs.signer_principal_id=v_principal and cs.subject_binding_revision=(c->>'subjectBindingRevision')::bigint
  and cs.jurisdiction_revision=(c->>'jurisdictionRevision')::bigint
  and ca.artifact_key='consent.upload-self' and ca.superseded_at is null
  and ca.published_at<=clock_timestamp() and ca.effective_on<=timezone('UTC',clock_timestamp())::date
  and ca.body_sha256=encode(extensions.digest(convert_to(ca.body_markdown,'UTF8'),'sha256'),'hex')
;
 if v_consent is null then raise exception using errcode='55000',message='upload_consent_required'; end if;
 return (c-'birthDateState')||jsonb_build_object('uploadConsentId',v_consent,
  'subjectLifecycleRevision',v_lifecycle,'originatingSessionRevision',v_session);
end;
$function$;
revoke all on function private.own_upload_store_authority_mail_v1(uuid,uuid) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.own_upload_store_authority_mail_v1(uuid,uuid) to service_role;

create function private.own_report_context_mail_v1(p_account_id uuid,p_subject_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog
as $function$
declare c jsonb; p public.subject_principals%rowtype;
begin
 c:=private.own_upload_store_authority_mail_v1(p_account_id,p_subject_id);
 -- Claimed embryo records cannot restart analysis through this ordinary DNA path.
 perform 1 from public.subjects where id=p_subject_id and subject_class='self' and lifecycle='active';
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 select sp.* into p from public.subject_account_bindings b join public.subject_principals sp on sp.id=b.subject_principal_id
 where b.subject_id=p_subject_id and b.account_id=p_account_id and b.status='current'
 and b.binding_revision=(c->>'accountBindingRevision')::bigint and sp.status='active'
 and sp.account_id=p_account_id and sp.subject_id=p_subject_id and sp.principal_kind='account_subject';
 if p.id is null then raise exception using errcode='42501',message='not_found'; end if;
 return c||jsonb_build_object('principalId',p.id,'principalRevision',p.principal_revision);
end;
$function$;
revoke all on function private.own_report_context_mail_v1(uuid,uuid) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.own_report_context_mail_v1(uuid,uuid) to service_role;

create function private.current_own_report_grant_mail_v1(p_account_id uuid,p_file_id uuid,p_purpose text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare f public.genome_files%rowtype; c jsonb; g public.purpose_grants%rowtype; v_key text;
begin
 if p_purpose is null or p_purpose not in ('reports.monogenic','reports.polygenic','ancestry') then
  raise exception using errcode='42501',message='not_found'; end if;
 select * into f from public.genome_files where id=p_file_id and user_id=p_account_id;
 if f.id is null or f.single_logical_sample_verified_at is null or f.subject_id is null then
  raise exception using errcode='42501',message='not_found'; end if;
 c:=private.own_report_context_mail_v1(p_account_id,f.subject_id);
 select * into f from public.genome_files where id=p_file_id and user_id=p_account_id
  and subject_id=f.subject_id;
 if f.id is null or f.single_logical_sample_verified_at is null or f.tier is distinct from 1
  or f.status is null or f.status not in ('stored','annotated')
  or f.structural_validator_version is distinct from 'single-logical-sample-v1'
  or f.normalization_completed_at is null or f.normalization_source_revision is distinct from f.upload_revision
  or f.build is null or f.build not in ('GRCh37','GRCh38') then raise exception using errcode='42501',message='not_found'; end if;
 perform 1 from private.own_normalization_runs n
  join public.genome_storage_objects o on o.genome_file_id=f.id
  join storage.objects s on s.id=o.object_id
 where n.file_id=f.id and n.account_id=p_account_id and n.state='complete'
  and n.manifest->>'rawSha256'=f.sha256 and n.manifest->>'decodedSha256'=f.source_sha256
  and (n.manifest->>'sourceRevision')::bigint=f.upload_revision
  and n.manifest->>'objectId'=f.storage_object_id::text and n.manifest->>'objectKey'=f.bucket_path
  and o.object_id=f.storage_object_id and o.object_name=f.bucket_path and o.bucket_id='genomes'
  and o.sha256=f.sha256 and o.byte_count=f.size_bytes and o.object_revision=f.upload_revision
  and o.state='current' and o.revoked_at is null and s.bucket_id=o.bucket_id and s.name=o.object_name
  and (s.metadata->>'size')::numeric=f.size_bytes;
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 v_key:=case p_purpose when 'reports.monogenic' then 'consent.own-monogenic'
  when 'reports.polygenic' then 'consent.own-polygenic' else 'consent.own-ancestry' end;
 select pg.* into g from public.purpose_grants pg
 join public.directional_grants dg on dg.grant_id=pg.grant_id and dg.grant_revision=pg.grant_revision
 join public.consent_artifacts ca on ca.artifact_key=pg.artifact_key and ca.version=pg.artifact_version
  and ca.body_sha256=pg.artifact_body_sha256
 join public.consent_signatures cs on cs.id=pg.signature_id and cs.artifact_key=ca.artifact_key
  and cs.artifact_version=ca.version and cs.artifact_body_sha256=ca.body_sha256
  and cs.signer_principal_id=pg.signer_principal_id and cs.signer_account_id=p_account_id
  and cs.target_kind=pg.target_kind and cs.target_id=pg.target_id and cs.purpose=pg.purpose
 where pg.target_kind='subject' and pg.target_id=f.subject_id and pg.purpose=p_purpose
  and pg.signer_principal_id=(c->>'principalId')::uuid and pg.data_subject_principal_id=pg.signer_principal_id
  and pg.subject_binding_revision=(c->>'subjectBindingRevision')::bigint
  and pg.jurisdiction_revision=(c->>'jurisdictionRevision')::bigint
  and cs.subject_binding_revision=pg.subject_binding_revision and cs.jurisdiction_revision=pg.jurisdiction_revision
  and pg.revoked_at is null and (pg.expires_at is null or pg.expires_at>clock_timestamp())
  and dg.status='current' and dg.direction='self' and dg.recipient_principal_id=pg.signer_principal_id
  and dg.recipient_account_id=p_account_id and dg.relationship_id is null and dg.pair_id is null
  and dg.relationship_or_pair_revision=(c->>'accountBindingRevision')::bigint
  and dg.self_principal_revision=(c->>'principalRevision')::bigint
  and ca.artifact_key=v_key and ca.superseded_at is null and ca.published_at<=clock_timestamp()
  and ca.effective_on<=timezone('UTC',clock_timestamp())::date
  and ca.body_sha256=encode(extensions.digest(convert_to(ca.body_markdown,'UTF8'),'sha256'),'hex')
;
 if g.grant_id is null then raise exception using errcode='42501',message='not_found'; end if;
 return jsonb_build_object('context',c,'grantId',g.grant_id,'grantRevision',g.grant_revision,
  'sourceRevision',f.upload_revision,'sourceSha256',f.sha256,'normalizedAt',f.normalization_completed_at,'subjectId',f.subject_id);
end;
$function$;
revoke all on function private.current_own_report_grant_mail_v1(uuid,uuid,text) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.current_own_report_grant_mail_v1(uuid,uuid,text) to service_role;

alter table public.mail_outbox add column canonical_readiness jsonb;
alter table public.mail_outbox add constraint mail_canonical_readiness_shape check (
 canonical_readiness is null or (template_id='report-ready' and purpose='report.ready' and target_kind='genome_file'
  and jsonb_typeof(canonical_readiness)='object'));

create function private.own_report_ready_state_v1(p_account_id uuid,p_file_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare f public.genome_files%rowtype; v_purpose text; a jsonb; selections jsonb:='{}';
begin
 select * into f from public.genome_files where id=p_file_id and user_id=p_account_id;
 if f.id is null or f.single_logical_sample_verified_at is null or exists(
  select 1 from private.genome_file_deletions where file_id=f.id) then return null; end if;
 for v_purpose in select pg.purpose from public.purpose_grants pg
  join public.directional_grants dg on dg.grant_id=pg.grant_id and dg.grant_revision=pg.grant_revision
  where pg.target_kind='subject' and pg.target_id=f.subject_id
   and pg.purpose in ('reports.monogenic','reports.polygenic') and pg.revoked_at is null
   and (pg.expires_at is null or pg.expires_at>clock_timestamp())
   and dg.status='current' and dg.direction='self' and dg.recipient_account_id=p_account_id
  order by pg.purpose loop
  a:=private.current_own_report_grant_mail_v1(p_account_id,p_file_id,v_purpose);
  if not private.own_analysis_completion_matches_v1(p_file_id,v_purpose,a) or not exists(
   select 1 from private.own_analysis_runs r where r.file_id=f.id and r.subject_id=f.subject_id and r.account_id=p_account_id
    and r.purpose=v_purpose and r.state='complete' and r.source_revision=f.upload_revision
    and r.source_sha256=f.sha256 and r.normalization_completed_at=f.normalization_completed_at) then return null; end if;
  a:=jsonb_set(a,'{context}',(a->'context')-array['authSessionRevision','originatingSessionRevision']);
  selections:=selections||jsonb_build_object(v_purpose,a);
 end loop;
 if selections='{}'::jsonb then return null; end if;
 perform 1 from auth.users where id=p_account_id and email_confirmed_at is not null and nullif(trim(email),'') is not null;
 if not found then return null; end if;
 return jsonb_build_object('version','own-report-ready-v1','accountId',p_account_id,'fileId',f.id,
  'subjectId',f.subject_id,'computationRevision','own-reports-v1','purposes',selections,
  'recipientContactRevision',(select mail_contact_revision from public.profiles where id=p_account_id));
exception when insufficient_privilege or object_not_in_prerequisite_state then return null;
end; $$;
revoke all on function private.own_report_ready_state_v1(uuid,uuid) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.own_report_ready_state_v1(uuid,uuid) to service_role;

create function private.file_ready_mail_current_v1(m public.mail_outbox)
returns boolean language plpgsql security definer set search_path=pg_catalog,private as $$
declare f public.genome_files%rowtype; sp public.subject_principals%rowtype; ready jsonb;
begin
 if m.template_id<>'report-ready' then return true; end if;
 if m.target_kind<>'genome_file' then return false; end if;
 select * into f from public.genome_files where id=m.target_id;
 select * into sp from public.subject_principals where id=m.recipient_principal_id;
 if f.id is null or sp.id is null or sp.status<>'active' or sp.principal_kind<>'account_subject'
  or sp.principal_revision is distinct from m.recipient_authority_revision
  or f.user_id is distinct from sp.account_id or f.subject_id is distinct from sp.subject_id
  or exists(select 1 from private.genome_file_deletions where file_id=f.id) then return false; end if;
 if f.single_logical_sample_verified_at is null then
  return m.canonical_readiness is null and f.status='annotated';
 end if;
 ready:=private.own_report_ready_state_v1(sp.account_id,f.id);
 return ready is not null and ready=m.canonical_readiness;
end; $$;
revoke all on function private.file_ready_mail_current_v1(public.mail_outbox) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.file_ready_mail_current_v1(public.mail_outbox) to service_role;

create or replace function private.guard_file_ready_mail_insert_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog,private as $$
begin
 if new.template_id='report-ready' then
  perform 1 from public.genome_files where id=new.target_id for share;
  if not private.file_ready_mail_current_v1(new) then
   raise exception using errcode='55000',message='file_target_unavailable'; end if;
 end if;
 return new;
end; $$;

create function private.freeze_canonical_ready_mail_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
 if old.canonical_readiness is not null and (new.canonical_readiness,new.recipient_principal_id,
  new.contact_reference_id,new.recipient_authority_revision,new.idempotency_key,new.expires_at,new.template_payload,
  new.target_id,new.target_kind,new.purpose,new.template_id)
 is distinct from (old.canonical_readiness,old.recipient_principal_id,old.contact_reference_id,
  old.recipient_authority_revision,old.idempotency_key,old.expires_at,old.template_payload,
  old.target_id,old.target_kind,old.purpose,old.template_id) then
  raise exception using errcode='55000',message='immutable_ready_notice'; end if;
 return new;
end; $$;
revoke all on function private.freeze_canonical_ready_mail_v1() from public,anon,authenticated,inherit_upload_only;
create trigger freeze_canonical_ready_mail before update on public.mail_outbox
 for each row execute function private.freeze_canonical_ready_mail_v1();

create function private.enqueue_own_report_ready_v1(p_account_id uuid,p_file_id uuid,p_envelope jsonb)
returns uuid language plpgsql security definer set search_path=pg_catalog,private as $$
declare ready jsonb; principal public.subject_principals%rowtype; contact uuid; outbox uuid; key text;
 v_now timestamptz:=clock_timestamp(); v_expiry timestamptz:=v_now+interval '30 days';
begin
 if jsonb_typeof(p_envelope) is distinct from 'object' or not(p_envelope ?& array['contactCiphertext','contactHmac','dashboardUrl','contactRevision'])
  or p_envelope-array['contactCiphertext','contactHmac','dashboardUrl','contactRevision']<>'{}'::jsonb
  or coalesce(p_envelope->>'contactRevision','')!~'^[1-9][0-9]{0,15}$'
  or coalesce(p_envelope->>'contactCiphertext','')!~'^[0-9a-f]{60,4096}$'
  or length(p_envelope->>'contactCiphertext')%2<>0
  or coalesce(p_envelope->>'contactHmac','')!~'^[0-9a-f]{64}$'
  or coalesce(p_envelope->>'dashboardUrl','')!~'^https?://[^/@?#]+/genome/me/reports$' then
  raise exception using errcode='22023',message='invalid_ready_envelope'; end if;
 -- Match existing generation order: Auth row, then profile, then source/grants
 -- and outbox. Never acquire an Auth/profile lock while holding an outbox claim.
 perform 1 from auth.users where id=p_account_id and deleted_at is null and email_confirmed_at is not null for share;
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 perform 1 from public.profiles where id=p_account_id
  and mail_contact_revision=(p_envelope->>'contactRevision')::bigint for share;
 if not found then raise exception using errcode='42501',message='recipient_authority_stale'; end if;
 ready:=private.own_report_ready_state_v1(p_account_id,p_file_id);
 if ready is null then return null; end if;
 key:=encode(extensions.digest(convert_to(ready::text,'UTF8'),'sha256'),'hex');
 select id into outbox from public.mail_outbox where idempotency_key=key;
 if outbox is not null then return outbox; end if;
 select sp.* into principal from public.subject_principals sp
  join public.subject_account_bindings b on b.subject_principal_id=sp.id and b.status='current'
  where sp.subject_id=(ready->>'subjectId')::uuid and sp.account_id=p_account_id
   and sp.principal_kind='account_subject' and sp.status='active' and b.account_id=p_account_id for share of sp,b;
 if principal.id is null then raise exception using errcode='42501',message='not_found'; end if;
 select e.id into contact from public.encrypted_contact_references e
  where e.principal_id=principal.id and e.contact_hmac=p_envelope->>'contactHmac' and e.status='current'
   and e.authority_revision=principal.principal_revision and e.contact_ciphertext is not null
  order by e.created_at desc limit 1 for update;
 if contact is null then
  update public.encrypted_contact_references set status='rotated',ended_at=v_now where principal_id=principal.id and status='current';
  insert into public.encrypted_contact_references(principal_id,contact_ciphertext,contact_hmac,key_revision,authority_revision,status)
   values(principal.id,decode(p_envelope->>'contactCiphertext','hex'),p_envelope->>'contactHmac',1,principal.principal_revision,'current') returning id into contact;
  insert into public.contact_hmac_indexes(contact_reference_id,contact_hmac,hmac_key_revision,status,expires_at)
   values(contact,p_envelope->>'contactHmac',1,'current',v_expiry);
 end if;
 insert into public.mail_outbox(template_id,purpose,target_kind,target_id,recipient_principal_id,contact_reference_id,
  recipient_authority_revision,semantic_revision,idempotency_key,template_payload,expires_at,canonical_readiness)
 values('report-ready','report.ready','genome_file',p_file_id,principal.id,contact,principal.principal_revision,1,key,
  jsonb_build_object('reportCount',0,'dashboardUrl',p_envelope->>'dashboardUrl'),v_expiry,ready)
 on conflict(idempotency_key) do nothing returning id into outbox;
 if outbox is null then select id into outbox from public.mail_outbox where idempotency_key=key; end if;
 return outbox;
end; $$;
revoke all on function private.enqueue_own_report_ready_v1(uuid,uuid,jsonb) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.enqueue_own_report_ready_v1(uuid,uuid,jsonb) to service_role;

-- Compatibility: the original low-level generation RPC remains unchanged for
-- old deployed callers. Updated application completion exclusively uses this
-- service-only wrapper; enqueue rejection rolls back core completion/PGS rows.
create function public.own_report_generation_with_mail_v1(p_operation text,p_account_id uuid,p_session_id uuid,
 p_file_id uuid,p_purpose text,p_claim uuid default null,p_payload jsonb default null)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare result jsonb; outbox uuid;
begin
 if p_operation='ready' then
  perform private.current_own_report_grant_v1(p_account_id,p_session_id,p_file_id,p_purpose);
  if p_claim is not null then raise exception using errcode='22023',message='invalid_request'; end if;
  outbox:=private.enqueue_own_report_ready_v1(p_account_id,p_file_id,p_payload);
  if outbox is null then raise exception using errcode='55000',message='reports_not_ready'; end if;
  return 'true'::jsonb;
 elsif p_operation='complete' then
  if jsonb_typeof(p_payload) is distinct from 'object' or not(p_payload ? 'readyMail') then
   raise exception using errcode='22023',message='invalid_ready_envelope'; end if;
  result:=private.own_report_generation_v1(p_operation,p_account_id,p_session_id,p_file_id,p_purpose,p_claim,p_payload-'readyMail');
  perform private.enqueue_own_report_ready_v1(p_account_id,p_file_id,p_payload->'readyMail');
  return result;
 end if;
 return private.own_report_generation_v1(p_operation,p_account_id,p_session_id,p_file_id,p_purpose,p_claim,p_payload);
end; $$;
revoke all on function public.own_report_generation_with_mail_v1(text,uuid,uuid,uuid,text,uuid,jsonb) from public,anon,authenticated,inherit_upload_only;
grant execute on function public.own_report_generation_with_mail_v1(text,uuid,uuid,uuid,text,uuid,jsonb) to service_role;

create function private.invalidate_changed_own_ready_mail_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
 if tg_op='DELETE' or new.state is distinct from 'complete' or new.authority is distinct from old.authority then
  update public.mail_outbox set state='invalidated',claimed_at=null,last_outcome_code='file_target_unavailable'
   where template_id='report-ready' and target_kind='genome_file' and target_id=old.file_id
    and canonical_readiness is not null and canonical_readiness->'purposes' ? old.purpose and state in ('queued','claimed');
 end if;
 return null;
end; $$;
revoke all on function private.invalidate_changed_own_ready_mail_v1() from public,anon,authenticated,inherit_upload_only;
create trigger invalidate_changed_own_ready_mail after update or delete on private.own_analysis_runs
 for each row execute function private.invalidate_changed_own_ready_mail_v1();

-- Preserve current invitation/recipient/token behavior; only source readiness
-- is shared between insertion, claiming and immediate pre-provider check.
create or replace function public.claim_mail_outbox()
returns table (
  outbox_id uuid,
  template_id text,
  template_payload jsonb,
  idempotency_key text,
  attempt_ordinal smallint,
  contact_ciphertext bytea,
  delivery_token text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outbox public.mail_outbox%rowtype;
  v_candidate public.token_candidates%rowtype;
  v_raw_token text;
  v_token_hash text;
begin
  perform private.lock_invitation_transitions_v1();
  update public.mail_outbox m
  set state = 'expired', claimed_at = null, last_outcome_code = 'expired'
  where m.state in ('queued', 'claimed')
    and m.expires_at <= clock_timestamp();

  update public.mail_outbox m
  set state = 'invalidated', claimed_at = null,
      last_outcome_code = 'recipient_authority_stale'
  where m.invitation_terminal_notice_id is null
    and m.state in ('queued', 'claimed')
    and not exists (
      select 1
      from public.subject_principals sp
      join public.encrypted_contact_references ecr
        on ecr.id = m.contact_reference_id
       and ecr.principal_id = sp.id
      where sp.id = m.recipient_principal_id
        and (
          sp.status = 'active'
          or (
            m.purpose in ('adult-subject-invitation', 'co-parent-invitation')
            and sp.status = 'pending'
          )
        )
        and sp.principal_revision = m.recipient_authority_revision
        and ecr.status = 'current'
        and ecr.authority_revision = m.recipient_authority_revision
        and ecr.contact_ciphertext is not null
    );

  -- A live contact is not enough: readiness belongs to this exact source.
  -- Invalidated rows retain their ordinary history/retention rules.
  update public.mail_outbox m
  set state = 'invalidated', claimed_at = null,
      last_outcome_code = 'file_target_unavailable'
  where m.template_id = 'report-ready' and m.state in ('queued', 'claimed')
    and not private.file_ready_mail_current_v1(m);

  -- Recheck the exact invitation and all stored contact-key aliases before
  -- token creation, under the same transition lock as refusal/acceptance.
  update public.mail_outbox m set state='invalidated',claimed_at=null,
    last_outcome_code='invitation_authority_stale'
  where m.state in('queued','claimed')
    and m.token_purpose in('adult-subject-invitation','co-parent-invitation')
    and not private.invitation_mail_current_v1(m);

  select m.* into v_outbox
  from public.mail_outbox m
  where m.invitation_terminal_notice_id is null and (
      (m.state = 'queued' and m.not_before <= clock_timestamp())
      or (
        m.state = 'claimed'
        and m.claimed_at < clock_timestamp() - interval '10 minutes'
      )
    )
    and m.expires_at > clock_timestamp()
    and m.attempt_count < 10
    and (m.template_id <> 'report-ready' or private.file_ready_mail_current_v1(m))
  order by m.not_before, m.created_at
  for update skip locked
  limit 1;

  if v_outbox.id is null then return; end if;

  update public.mail_outbox m
  set state = 'claimed',
      claimed_at = clock_timestamp(),
      attempt_count = (m.attempt_count + 1)::smallint,
      last_outcome_code = null
  where m.id = v_outbox.id
  returning m.* into v_outbox;

  if v_outbox.token_purpose in ('adult-subject-invitation', 'co-parent-invitation') then
    if not private.invitation_mail_current_v1(v_outbox) then return; end if;
    select tc.* into strict v_candidate
    from public.token_candidates tc
    where tc.outbox_id = v_outbox.id
      and tc.target_kind = 'subject_invitation'
      and tc.target_id = v_outbox.target_id
      and tc.expires_at > clock_timestamp()
    for update;

    v_raw_token := rtrim(translate(
      encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'
    ), '=');
    v_token_hash := encode(extensions.digest(
      convert_to(v_raw_token, 'UTF8'), 'sha256'
    ), 'hex');

    update public.token_hashes
    set status = 'revoked', ended_at = clock_timestamp()
    where candidate_id = v_candidate.id and status = 'current';

    insert into public.token_hashes (
      candidate_id, token_hash, token_revision, status
    ) values (
      v_candidate.id, v_token_hash, v_candidate.token_revision, 'current'
    );

    update public.token_candidates
    set state = 'issued'
    where id = v_candidate.id;

    update public.subject_invitations
    set token_hash = v_token_hash
    where id = v_candidate.target_id
      and status = 'pending'
      and expires_at > clock_timestamp();
    if not found then
      raise exception using errcode = '55000', message = 'invitation is not current';
    end if;
  end if;

  return query
  select
    v_outbox.id,
    v_outbox.template_id,
    v_outbox.template_payload,
    v_outbox.idempotency_key,
    v_outbox.attempt_count,
    ecr.contact_ciphertext,
    v_raw_token
  from public.encrypted_contact_references ecr
  where ecr.id = v_outbox.contact_reference_id;
end;
$$;
create or replace function private.authorize_mail_submission_v1(p_outbox uuid,p_attempt smallint)
returns boolean language plpgsql security definer set search_path='' as $$
declare m public.mail_outbox%rowtype;
begin
 perform private.lock_invitation_transitions_v1();
 select * into m from public.mail_outbox where id=p_outbox for update;
 if m.id is null or m.state<>'claimed' or m.attempt_count is distinct from p_attempt
  or m.expires_at<=clock_timestamp() or m.invitation_terminal_notice_id is not null then return false; end if;
 if not exists(select 1 from public.encrypted_contact_references e
  join public.subject_principals sp on sp.id=e.principal_id
  where e.id=m.contact_reference_id and sp.id=m.recipient_principal_id
   and e.status='current' and e.contact_ciphertext is not null
   and e.authority_revision=m.recipient_authority_revision and sp.principal_revision=m.recipient_authority_revision
   and (sp.status='active' or (sp.status='pending' and m.token_purpose in('adult-subject-invitation','co-parent-invitation')))
 ) then return false; end if;
 if m.token_purpose in('adult-subject-invitation','co-parent-invitation') then
  if not private.invitation_mail_current_v1(m) or not exists(
   select 1 from public.token_candidates tc join public.token_hashes th on th.candidate_id=tc.id
   join public.subject_invitations i on i.id=tc.target_id and i.token_hash=th.token_hash
   where tc.outbox_id=m.id and tc.state='issued' and th.status='current'
  ) then return false; end if;
 end if;
 if m.template_id='report-ready' and not private.file_ready_mail_current_v1(m) then return false; end if;
 return true;
end;
$$;


-- Auth owns the row before this AFTER trigger runs. Preserve Auth -> profile ->
-- outbox order. Claim/pre-submit resolve current rows without reversing that order;
-- an Auth transition waiting on a claimed outbox terminalizes it before committing.
create function private.invalidate_own_ready_auth_contact_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
 update public.profiles set mail_contact_revision=mail_contact_revision+1 where id=new.id;
 update public.mail_outbox m set state='invalidated',claimed_at=null,last_outcome_code='recipient_authority_stale'
  from public.subject_principals sp where sp.id=m.recipient_principal_id and sp.account_id=new.id
   and m.canonical_readiness is not null and m.state in ('queued','claimed');
 update public.encrypted_contact_references e set status='rotated',ended_at=clock_timestamp()
  where e.status='current' and exists(select 1 from public.mail_outbox m
   join public.subject_principals sp on sp.id=m.recipient_principal_id
   where m.contact_reference_id=e.id and m.canonical_readiness is not null and sp.account_id=new.id);
 update public.contact_hmac_indexes h set status='revoked' where h.status='current'
  and exists(select 1 from public.encrypted_contact_references e join public.mail_outbox m on m.contact_reference_id=e.id
   join public.subject_principals sp on sp.id=m.recipient_principal_id
   where h.contact_reference_id=e.id and e.status='rotated' and m.canonical_readiness is not null and sp.account_id=new.id);
 return new;
end; $$;
revoke all on function private.invalidate_own_ready_auth_contact_v1() from public,anon,authenticated,inherit_upload_only;
create trigger invalidate_own_ready_auth_contact after update of email,email_confirmed_at on auth.users
 for each row when (old.email is distinct from new.email or old.email_confirmed_at is distinct from new.email_confirmed_at)
 execute function private.invalidate_own_ready_auth_contact_v1();
