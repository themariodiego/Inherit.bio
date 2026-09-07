-- Path A only: an adult shares an independently completed own result.
-- These new private predicates are not mail or own-reader authorization aliases.
-- No owner session is synthesized. Genetic content is returned only by the
-- final recipient RPC after its separate exact directional authorization.
create function private.family_source_context_v1(p_account_id uuid,p_subject_id uuid)
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
  or (s.subject_class in ('self','other_adult')) is not true or (s.lifecycle in ('active','claimed_bound')) is not true then
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
revoke all on function private.family_source_context_v1(uuid,uuid) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.family_source_context_v1(uuid,uuid) to service_role;

create function private.family_source_store_v1(p_account_id uuid,p_subject_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare c jsonb; v_consent uuid; v_principal uuid; v_lifecycle bigint; v_session bigint;
begin
 c:=private.family_source_context_v1(p_account_id,p_subject_id);
 perform 1 from auth.users where id=p_account_id and (banned_until is null or banned_until<=clock_timestamp());
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 if c->>'birthDateState' is distinct from 'adult' then raise exception using errcode='55000',message='adult_account_required'; end if;
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
revoke all on function private.family_source_store_v1(uuid,uuid) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.family_source_store_v1(uuid,uuid) to service_role;

create function private.family_source_report_context_v1(p_account_id uuid,p_subject_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog
as $function$
declare c jsonb; p public.subject_principals%rowtype;
begin
 c:=private.family_source_store_v1(p_account_id,p_subject_id);
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
revoke all on function private.family_source_report_context_v1(uuid,uuid) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.family_source_report_context_v1(uuid,uuid) to service_role;

create function private.family_source_report_authority_v1(p_account_id uuid,p_file_id uuid,p_purpose text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare f public.genome_files%rowtype; c jsonb; g public.purpose_grants%rowtype; v_key text;
begin
 if p_purpose is null or p_purpose not in ('reports.monogenic','reports.polygenic') then
  raise exception using errcode='42501',message='not_found'; end if;
 select * into f from public.genome_files where id=p_file_id and user_id=p_account_id;
 if f.id is null or f.single_logical_sample_verified_at is null or f.subject_id is null then
  raise exception using errcode='42501',message='not_found'; end if;
 c:=private.family_source_report_context_v1(p_account_id,f.subject_id);
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
revoke all on function private.family_source_report_authority_v1(uuid,uuid,text) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.family_source_report_authority_v1(uuid,uuid,text) to service_role;

-- A grant-time snapshot is never backfilled onto historical permission.
create table private.family_report_grant_snapshots (
 grant_id uuid primary key references public.purpose_grants(grant_id) on delete cascade,
 endpoints jsonb not null check(jsonb_typeof(endpoints)='object')
);
revoke all on private.family_report_grant_snapshots from public,anon,authenticated,inherit_upload_only,service_role;

create function private.family_report_endpoint_v1(p_account uuid,p_subject uuid default null,p_require_adult boolean default true)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb;
begin
 select jsonb_build_object('accountId',p.id,'accountRevision',p.account_revision,
  'jurisdictionCode',p.jurisdiction_code,'jurisdictionRevision',p.jurisdiction_revision,
  'subjectId',s.id,'subjectBindingRevision',s.subject_binding_revision,'lifecycleRevision',s.lifecycle_revision,
  'principalId',sp.id,'principalRevision',sp.principal_revision,
  'accountPrincipalId',ap.id,'accountPrincipalRevision',ap.principal_revision,
  'bindingId',b.id,'bindingRevision',b.binding_revision) into result
 from public.profiles p join auth.users u on u.id=p.id
 join public.subjects s on s.subject_account_id=p.id and s.subject_class='self' and s.lifecycle='active'
 join public.subject_account_bindings b on b.subject_id=s.id and b.account_id=p.id and b.status='current'
 join public.subject_principals sp on sp.id=b.subject_principal_id and sp.subject_id=s.id and sp.account_id=p.id
  and sp.principal_kind='account_subject' and sp.status='active'
 join public.subject_principals ap on ap.id=b.account_principal_id and ap.account_id=p.id and ap.status='active'
 where p.id=p_account and (p_subject is null or s.id=p_subject) and u.deleted_at is null
  and (u.banned_until is null or u.banned_until<=clock_timestamp()) and p.deletion_requested_at is null
  and (p_require_adult is false or p.date_of_birth<=(timezone('UTC',clock_timestamp())::date-interval '18 years')::date)
  and not exists(select 1 from public.account_deletion_requests d where d.account_id=p.id
   and (d.state in('delete_started','complete') or d.delete_started_at is not null or d.database_purged_at is not null));
 if result is null then raise exception using errcode='42501',message='not_found'; end if;
 return result;
end; $$;

create function private.family_report_endpoints_v1(p_owner uuid,p_subject uuid,p_recipient uuid,p_require_adult boolean default true)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare a jsonb; b jsonb; r jsonb;
begin
 if p_owner is null or p_recipient is null or p_owner=p_recipient or p_subject is null then
  raise exception using errcode='42501',message='not_found'; end if;
 a:=private.family_report_endpoint_v1(p_owner,p_subject,p_require_adult);
 b:=private.family_report_endpoint_v1(p_recipient,null,p_require_adult);
 if private.family_sharing_paused_v1(p_owner,p_recipient) is not false then
  raise exception using errcode='42501',message='not_found'; end if;
 select jsonb_build_object('id',sr.id,'revision',sr.relationship_revision) into r
 from public.subject_relationships sr where sr.subject_id=p_subject
  and sr.data_subject_principal_id=(a->>'principalId')::uuid
  and sr.recipient_principal_id=(b->>'principalId')::uuid and sr.recipient_account_id=p_recipient
  and sr.relationship_kind='family_member' and sr.status='current';
 return jsonb_build_object('owner',a,'recipient',b,'relationship',r);
end; $$;

create function private.family_report_session_v1(p_account uuid,p_session uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare receipt jsonb;
begin
 select jsonb_build_object('accountId',p.id,'sessionId',s.id,'accountRevision',p.account_revision,
  'authSessionRevision',p.auth_session_revision,'sessionRevision',coalesce(s.refresh_token_counter,0)+1) into receipt
 from public.profiles p join auth.users u on u.id=p.id join auth.sessions s on s.user_id=u.id
 where p.id=p_account and s.id=p_session and (s.not_after is null or s.not_after>clock_timestamp())
  and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp())
  and p.deletion_requested_at is null and not exists(select 1 from public.account_deletion_requests d where d.account_id=p.id
   and (d.state in('delete_started','complete') or d.delete_started_at is not null or d.database_purged_at is not null));
 if receipt is null then raise exception using errcode='42501',message='not_found'; end if;
 return receipt;
end; $$;

create function public.family_report_grant_presentation_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,p_recipient_account_id uuid)
returns text language plpgsql security definer set search_path=pg_catalog as $$
declare e jsonb;
begin
 perform private.family_report_session_v1(p_account_id,p_session_id);
 e:=private.family_report_endpoints_v1(p_account_id,p_subject_id,p_recipient_account_id);
 return encode(extensions.digest(convert_to(e::text,'UTF8'),'sha256'),'hex');
end; $$;

create function public.grant_family_report_purpose_v1(p_account_id uuid,p_session_id uuid,p_data_subject_id uuid,
 p_recipient_principal_id uuid,p_recipient_account_id uuid,p_purpose text,p_artifact_version integer,
 p_artifact_body_sha256 text,p_token_nonce text,p_endpoint_receipt text)
returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare e jsonb; g uuid; old_grant uuid;
begin
 if p_purpose is null or p_purpose not in('reports.monogenic','reports.polygenic')
  or p_endpoint_receipt is null or p_endpoint_receipt!~'^[0-9a-f]{64}$' then
  raise exception using errcode='22023',message='invalid_request'; end if;
 -- Deterministic endpoint locks cover the interval between receipt comparison
 -- and the existing signed, nonce-consuming transaction. No old grant is
 -- retroactively blessed: explicit new consent revokes/replaces an unproven one.
 perform 1 from auth.users where id in(p_account_id,p_recipient_account_id) order by id for share;
 perform 1 from public.profiles where id in(p_account_id,p_recipient_account_id) order by id for update;
 perform 1 from public.subjects where subject_account_id in(p_account_id,p_recipient_account_id) order by id for update;
 perform 1 from public.subject_account_bindings where account_id in(p_account_id,p_recipient_account_id) order by id for share;
 perform 1 from public.subject_principals where account_id in(p_account_id,p_recipient_account_id) order by id for share;
 perform 1 from public.subject_relationships where subject_id=p_data_subject_id order by id for update;
 perform 1 from auth.sessions where user_id=p_account_id and id=p_session_id for share;
 perform private.family_report_session_v1(p_account_id,p_session_id);
 e:=private.family_report_endpoints_v1(p_account_id,p_data_subject_id,p_recipient_account_id);
 if encode(extensions.digest(convert_to(e::text,'UTF8'),'sha256'),'hex') is distinct from p_endpoint_receipt
  or e#>>'{recipient,principalId}' is distinct from p_recipient_principal_id::text then
  raise exception using errcode='42501',message='not_found'; end if;
 perform 1 from public.consent_artifacts a where a.artifact_key='consent.share-with-adult'
  and a.version=p_artifact_version and a.body_sha256=p_artifact_body_sha256
  and a.body_sha256=encode(extensions.digest(convert_to(a.body_markdown,'UTF8'),'sha256'),'hex')
  and a.superseded_at is null and a.published_at<=clock_timestamp()
  and a.effective_on<=timezone('UTC',clock_timestamp())::date for share;
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 for old_grant in select pg.grant_id from public.purpose_grants pg join public.directional_grants dg
  on dg.grant_id=pg.grant_id and dg.grant_revision=pg.grant_revision
  left join private.family_report_grant_snapshots fs on fs.grant_id=pg.grant_id
  where pg.target_kind='subject' and pg.target_id=p_data_subject_id and pg.purpose=p_purpose
   and pg.revoked_at is null and dg.status='current' and dg.direction='subject_to_recipient'
   and dg.recipient_account_id=p_recipient_account_id and fs.endpoints is distinct from e
 loop perform public.revoke_directional_purpose_v1(p_account_id,old_grant); end loop;
 g:=public.grant_directional_purpose_v1(p_account_id,p_data_subject_id,p_recipient_principal_id,p_purpose,
  'consent.share-with-adult',p_artifact_version,p_token_nonce);
 e:=private.family_report_endpoints_v1(p_account_id,p_data_subject_id,p_recipient_account_id);
 insert into private.family_report_grant_snapshots(grant_id,endpoints) values(g,e) on conflict(grant_id) do nothing;
 if not exists(select 1 from private.family_report_grant_snapshots where grant_id=g and endpoints=e) then
  raise exception using errcode='42501',message='not_found'; end if;
 return g;
end; $$;

create function private.family_report_recipient_v1(p_account uuid,p_session uuid,p_subject uuid,p_purpose text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v_owner uuid; e jsonb; session_receipt jsonb; grant_receipt jsonb; v_proven boolean;
begin
 if p_purpose is null or p_purpose not in('reports.monogenic','reports.polygenic') then
  raise exception using errcode='42501',message='not_found'; end if;
 session_receipt:=private.family_report_session_v1(p_account,p_session);
 select subject_account_id into v_owner from public.subjects where id=p_subject and subject_class='self';
 -- Historical directional permission keeps its independently supported legacy
 -- semantics. It cannot lend missing age/revision proof to canonical sources.
 select exists(select 1 from public.purpose_grants pg join public.directional_grants dg
  on dg.grant_id=pg.grant_id and dg.grant_revision=pg.grant_revision
  join private.family_report_grant_snapshots fs on fs.grant_id=pg.grant_id
  where pg.target_kind='subject' and pg.target_id=p_subject and pg.purpose=p_purpose
   and pg.revoked_at is null and dg.recipient_account_id=p_account and dg.status='current') into v_proven;
 e:=private.family_report_endpoints_v1(v_owner,p_subject,p_account,v_proven);
 select jsonb_build_object('grantId',pg.grant_id,'grantRevision',pg.grant_revision,'endpoints',e,'session',session_receipt,'legacyOnly',fs.grant_id is null)
 into grant_receipt from public.purpose_grants pg
 join public.directional_grants dg on dg.grant_id=pg.grant_id and dg.grant_revision=pg.grant_revision
 left join private.family_report_grant_snapshots fs on fs.grant_id=pg.grant_id
 join public.consent_artifacts ca on ca.artifact_key=pg.artifact_key and ca.version=pg.artifact_version and ca.body_sha256=pg.artifact_body_sha256
 join public.consent_signatures cs on cs.id=pg.signature_id and cs.artifact_key=ca.artifact_key
  and cs.artifact_version=ca.version and cs.artifact_body_sha256=ca.body_sha256
 where (fs.grant_id is null or fs.endpoints=e) and pg.target_kind='subject' and pg.target_id=p_subject and pg.purpose=p_purpose
  and pg.signer_principal_id=(e#>>'{owner,principalId}')::uuid and pg.data_subject_principal_id=pg.signer_principal_id
  and pg.subject_binding_revision=(e#>>'{owner,subjectBindingRevision}')::bigint
  and pg.jurisdiction_revision=(e#>>'{owner,jurisdictionRevision}')::bigint
  and cs.signer_principal_id=pg.signer_principal_id and cs.signer_account_id=v_owner
  and cs.target_kind=pg.target_kind and cs.target_id=pg.target_id and cs.purpose=pg.purpose
  and cs.subject_binding_revision=pg.subject_binding_revision and cs.jurisdiction_revision=pg.jurisdiction_revision
  and pg.revoked_at is null and (pg.expires_at is null or pg.expires_at>clock_timestamp())
  and dg.status='current' and dg.direction='subject_to_recipient' and dg.recipient_account_id=p_account
  and dg.recipient_principal_id=(e#>>'{recipient,principalId}')::uuid and dg.pair_id is null
  and dg.relationship_id=(e#>>'{relationship,id}')::uuid
  and dg.relationship_or_pair_revision=(e#>>'{relationship,revision}')::bigint
  and ca.artifact_key='consent.share-with-adult' and ca.superseded_at is null
  and ca.published_at<=clock_timestamp() and ca.effective_on<=timezone('UTC',clock_timestamp())::date
  and ca.body_sha256=encode(extensions.digest(convert_to(ca.body_markdown,'UTF8'),'sha256'),'hex');
 if grant_receipt is null then raise exception using errcode='42501',message='not_found'; end if;
 return grant_receipt;
end; $$;

create function public.family_shared_report_results_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,
 p_purpose text,p_after_file uuid default null,p_mode text default 'content')
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare direction jsonb; a jsonb; f public.genome_files%rowtype; r private.own_analysis_runs%rowtype;
 n private.own_normalization_runs%rowtype; source_view jsonb; snapshot jsonb; rows jsonb:='[]'; v_last uuid; v_count integer:=0; page jsonb;
begin
 if p_mode is null or p_mode not in('content','readiness') then raise exception using errcode='22023',message='invalid_request'; end if;
 direction:=private.family_report_recipient_v1(p_account_id,p_session_id,p_subject_id,p_purpose);
 for f in select gf.* from public.genome_files gf where gf.subject_id=p_subject_id
  and gf.user_id=(direction#>>'{endpoints,owner,accountId}')::uuid
  and direction->>'legacyOnly'='false' and gf.single_logical_sample_verified_at is not null and (p_after_file is null or gf.id>p_after_file)
  order by gf.id limit 100 loop
  v_last:=f.id; v_count:=v_count+1;
  begin
   if exists(select 1 from private.genome_file_deletions where file_id=f.id) then continue; end if;
   a:=private.family_source_report_authority_v1(f.user_id,f.id,p_purpose);
   if private.own_analysis_completion_matches_v1(f.id,p_purpose,a) is not true then continue; end if;
   select * into r from private.own_analysis_runs where file_id=f.id and purpose=p_purpose and state='complete';
   select * into n from private.own_normalization_runs where file_id=f.id and state='complete';
   if r.file_id is null or n.file_id is null or jsonb_typeof(r.result->'reports') is distinct from 'array' then continue; end if;
   -- Only display facts. Missing historical listed-call facts stay unavailable;
   -- no hashes, file names, paths or raw headers cross the view boundary.
   snapshot:=null;
   if n.provenance->>'version'='listed-calls-v1' and n.provenance->>'sourceSha256'=f.sha256
    and n.provenance->>'sourceBuild'=f.build and n.provenance->>'targetBuild'='GRCh38'
    and (f.build<>'GRCh37' or coalesce(n.provenance->>'chainSha256','')~'^[0-9a-f]{64}$')
    and (f.build<>'GRCh38' or n.provenance->'chainSha256'='null'::jsonb) then
    snapshot:=jsonb_build_object('sourceBuild',n.provenance->'sourceBuild','buildBasis',n.provenance->'buildBasis',
     'targetBuild',n.provenance->'targetBuild','variantRowsMapped',n.provenance->'variantRowsMapped',
     'variantRowsUnmapped',n.provenance->'variantRowsUnmapped','counts',n.provenance->'counts');
   end if;
   source_view:=jsonb_build_object('fileId',f.id,'fileType',f.file_type,'processedAt',f.normalization_completed_at,'snapshot',snapshot);
   if private.family_source_report_authority_v1(f.user_id,f.id,p_purpose) is distinct from a
    or private.own_analysis_completion_matches_v1(f.id,p_purpose,a) is not true then continue; end if;
   rows:=rows||jsonb_build_array(jsonb_build_object('fileId',f.id,
    'receipt',encode(extensions.digest(convert_to(jsonb_build_object('authority',a,'result',r.result,
     'completedAt',r.completed_at,'claim',r.claim,'manifest',n.manifest,'provenance',n.provenance)::text,'UTF8'),'sha256'),'hex'))
    ||case when p_mode='readiness' then jsonb_build_object('hasReports',exists(
     select 1 from jsonb_array_elements(r.result->'reports') item where item->'covered'='true'::jsonb
      and jsonb_typeof(item->'catalogSnapshot')='object' and item->>'slug' not like 'auto-e2e-%'))
     else jsonb_build_object('subjectId',p_subject_id,'purpose',p_purpose,
      'completedAt',r.completed_at,'source',source_view,'reports',r.result->'reports') end);
  exception when insufficient_privilege or object_not_in_prerequisite_state or invalid_text_representation then continue;
  end;
 end loop;
 if private.family_report_recipient_v1(p_account_id,p_session_id,p_subject_id,p_purpose) is distinct from direction then
  raise exception using errcode='42501',message='not_found'; end if;
 page:=jsonb_build_object('authority',encode(extensions.digest(convert_to(direction::text,'UTF8'),'sha256'),'hex'),
  'ownerAccountId',direction#>>'{endpoints,owner,accountId}','subjectId',p_subject_id,'purpose',p_purpose,
  'legacyOnly',(direction->>'legacyOnly')::boolean,'sources',rows,'nextAfter',case when v_count=100 then v_last else null end);
 return page||jsonb_build_object('pageReceipt',encode(extensions.digest(convert_to(page::text,'UTF8'),'sha256'),'hex'));
end; $$;

revoke all on function private.family_report_endpoint_v1(uuid,uuid,boolean),private.family_report_endpoints_v1(uuid,uuid,uuid,boolean),
 private.family_report_session_v1(uuid,uuid),private.family_report_recipient_v1(uuid,uuid,uuid,text)
 from public,anon,authenticated,inherit_upload_only,service_role;
revoke all on function public.family_report_grant_presentation_v1(uuid,uuid,uuid,uuid),
 public.grant_family_report_purpose_v1(uuid,uuid,uuid,uuid,uuid,text,integer,text,text,text),
 public.family_shared_report_results_v1(uuid,uuid,uuid,text,uuid,text) from public,anon,authenticated,inherit_upload_only;
grant execute on function public.family_report_grant_presentation_v1(uuid,uuid,uuid,uuid),
 public.grant_family_report_purpose_v1(uuid,uuid,uuid,uuid,uuid,text,integer,text,text,text),
 public.family_shared_report_results_v1(uuid,uuid,uuid,text,uuid,text) to service_role;

-- Terminal confirmation is ONE transaction across all purposes/pages. NOWAIT
-- avoids a lock-order cycle with older revokers that lock the grant first:
-- contested data is withheld, never waited on or returned from stale memory.
create function public.confirm_family_shared_report_results_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,
 p_mode text,p_expected jsonb)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare owner_id uuid; item jsonb; actual jsonb; previous_purpose text; next_file uuid;
begin
 if p_mode is null or p_mode not in('content','readiness') or jsonb_typeof(p_expected) is distinct from 'array'
  or jsonb_array_length(p_expected) not between 1 and 1000 then return false; end if;
 select subject_account_id into owner_id from public.subjects where id=p_subject_id;
 -- Account -> subject -> source matches selected-file deletion. Every later
 -- row-lock acquisition is nonblocking to preserve existing revoke ordering.
 perform 1 from auth.users where id in(p_account_id,owner_id) order by id for share nowait;
 perform 1 from public.profiles where id in(p_account_id,owner_id) order by id for share nowait;
 perform 1 from auth.sessions where id=p_session_id and user_id=p_account_id for share nowait;
 perform 1 from public.subjects where subject_account_id in(p_account_id,owner_id) order by id for share nowait;
 perform 1 from public.subject_account_bindings where account_id in(p_account_id,owner_id) order by id for share nowait;
 perform 1 from public.subject_principals where account_id in(p_account_id,owner_id) order by id for share nowait;
 perform 1 from public.subject_relationships where subject_id=p_subject_id order by id for share nowait;
 perform 1 from public.genome_files where subject_id=p_subject_id order by id for share nowait;
 perform 1 from public.purpose_grants where target_kind='subject' and target_id=p_subject_id order by grant_id for share nowait;
 perform 1 from public.directional_grants where grant_id in(select grant_id from public.purpose_grants where target_kind='subject' and target_id=p_subject_id) order by grant_id for share nowait;
 perform 1 from private.family_report_grant_snapshots where grant_id in(select grant_id from public.purpose_grants where target_kind='subject' and target_id=p_subject_id) order by grant_id for share nowait;
 perform 1 from public.consent_signatures where target_kind='subject' and target_id=p_subject_id order by id for share nowait;
 perform 1 from public.consent_artifacts where artifact_key in('disclosure.insurance-and-discrimination','consent.upload-self',
  'consent.own-monogenic','consent.own-polygenic','consent.share-with-adult') order by artifact_key,version for share nowait;
 perform 1 from public.subject_consents where subject_id=p_subject_id order by id for share nowait;
 perform 1 from public.genome_storage_objects where genome_file_id in(select id from public.genome_files where subject_id=p_subject_id) order by object_id for share nowait;
 perform 1 from storage.objects where id in(select storage_object_id from public.genome_files where subject_id=p_subject_id) order by id for share nowait;
 perform 1 from private.own_normalization_runs where file_id in(select id from public.genome_files where subject_id=p_subject_id) order by file_id for share nowait;
 perform 1 from private.own_analysis_runs where subject_id=p_subject_id order by id for share nowait;
 for item in select value from jsonb_array_elements(p_expected) loop
  if jsonb_typeof(item) is distinct from 'object' or item-array['purpose','afterFile','receipt']<>'{}'::jsonb
   or not(item ?& array['purpose','afterFile','receipt']) or coalesce(item->>'receipt','')!~'^[0-9a-f]{64}$'
   or coalesce(item->>'purpose','') not in('reports.monogenic','reports.polygenic') then return false; end if;
  if previous_purpose is distinct from item->>'purpose' then
   if next_file is not null or (previous_purpose is not null and previous_purpose>=item->>'purpose')
    or item->'afterFile' is distinct from 'null'::jsonb then return false; end if;
  elsif (item->>'afterFile')::uuid is distinct from next_file or next_file is null then return false;
  end if;
  actual:=public.family_shared_report_results_v1(p_account_id,p_session_id,p_subject_id,item->>'purpose',(item->>'afterFile')::uuid,p_mode);
  if actual->>'pageReceipt' is distinct from item->>'receipt' then return false; end if;
  previous_purpose:=item->>'purpose'; next_file:=(actual->>'nextAfter')::uuid;
 end loop;
 return next_file is null;
exception when lock_not_available or insufficient_privilege or object_not_in_prerequisite_state or invalid_text_representation then return false;
end; $$;
revoke all on function public.confirm_family_shared_report_results_v1(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,inherit_upload_only;
grant execute on function public.confirm_family_shared_report_results_v1(uuid,uuid,uuid,text,jsonb) to service_role;

-- A hub may show several adults. Successful inner confirmations retain their
-- locks until this outer transaction returns; a later person's work cannot
-- make an earlier person's cached readiness escape a completed withdrawal.
create function public.confirm_family_shared_readiness_v1(p_account_id uuid,p_session_id uuid,p_checks jsonb)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare item jsonb;
begin
 if jsonb_typeof(p_checks) is distinct from 'array' or jsonb_array_length(p_checks) not between 1 and 100 then return false; end if;
 for item in select value from jsonb_array_elements(p_checks) loop
  if jsonb_typeof(item) is distinct from 'object' or item-array['subjectId','expected']<>'{}'::jsonb
   or not(item ?& array['subjectId','expected']) or item->>'subjectId' is null then return false; end if;
  if public.confirm_family_shared_report_results_v1(p_account_id,p_session_id,(item->>'subjectId')::uuid,
   'readiness',item->'expected') is not true then return false; end if;
 end loop;
 return true;
exception when invalid_text_representation then return false;
end; $$;
revoke all on function public.confirm_family_shared_readiness_v1(uuid,uuid,jsonb) from public,anon,authenticated,inherit_upload_only;
grant execute on function public.confirm_family_shared_readiness_v1(uuid,uuid,jsonb) to service_role;
