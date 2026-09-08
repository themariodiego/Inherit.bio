-- New ordinary sources: current store permission permits preparation, not every result layer.
create function private.current_own_report_grant_v1(p_account_id uuid,p_session_id uuid,p_file_id uuid,p_purpose text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare f public.genome_files%rowtype; c jsonb; g public.purpose_grants%rowtype; v_key text;
begin
 if p_purpose is null or p_purpose not in ('reports.monogenic','reports.polygenic','ancestry') then
  raise exception using errcode='42501',message='not_found'; end if;
 select * into f from public.genome_files where id=p_file_id and user_id=p_account_id;
 if f.id is null or f.single_logical_sample_verified_at is null or f.subject_id is null then
  raise exception using errcode='42501',message='not_found'; end if;
 c:=public.own_report_context_v1(p_account_id,p_session_id,f.subject_id);
 select * into f from public.genome_files where id=p_file_id and user_id=p_account_id
  and subject_id=f.subject_id for share;
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
  and (s.metadata->>'size')::numeric=f.size_bytes for share of n,o,s;
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
 for share of pg,dg,ca,cs;
 if g.grant_id is null then raise exception using errcode='42501',message='not_found'; end if;
 return jsonb_build_object('context',c,'grantId',g.grant_id,'grantRevision',g.grant_revision,
  'sourceRevision',f.upload_revision,'sourceSha256',f.sha256,'normalizedAt',f.normalization_completed_at,'subjectId',f.subject_id);
end;
$function$;
revoke all on function private.current_own_report_grant_v1(uuid,uuid,uuid,text) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.current_own_report_grant_v1(uuid,uuid,uuid,text) to service_role;

create function public.read_own_report_calls_v1(p_account_id uuid,p_session_id uuid,p_file_id uuid,p_purpose text,
 p_rsids bigint[],p_offset integer)
returns jsonb language plpgsql security invoker set search_path=pg_catalog
as $function$
declare a jsonb; rows jsonb; f public.genome_files%rowtype;
begin
 if p_purpose not in ('reports.monogenic','reports.polygenic') or p_purpose is null
  or p_rsids is null or cardinality(p_rsids) not between 1 and 200 or p_offset is null or p_offset<0
  or exists(select 1 from unnest(p_rsids) x where x is null or x<=0) then
  raise exception using errcode='22023',message='invalid_request'; end if;
 a:=private.current_own_report_grant_v1(p_account_id,p_session_id,p_file_id,p_purpose);
 if not private.own_analysis_completion_matches_v1(p_file_id,p_purpose,a) then
  raise exception using errcode='42501',message='not_found'; end if;
 select * into f from public.genome_files where id=p_file_id;
 select coalesce(jsonb_agg(jsonb_build_object('file_id',p_file_id,'rsid',q.rsid,'chrom',q.chrom,'pos',q.pos,
  'ref',q.ref,'alt',q.alt,'genotype',q.genotype,'usable',q.usable)),'[]'::jsonb) into rows from (
   select u.rsid,u.chrom,u.pos,u.ref,u.alt,u.genotype,true as usable,0 as kind,u.id as row_key
   from public.user_variants u where u.file_id=p_file_id and u.user_id=p_account_id
    and u.subject_id=(a->>'subjectId')::uuid and u.rsid=any(p_rsids)
   union all
   select o.rsid,o.chrom,o.pos,o.ref,o.alt,o.genotype,o.usable,1 as kind,o.source_line as row_key
   from public.report_observed_calls o where o.file_id=p_file_id and o.user_id=p_account_id
    and o.subject_id=(a->>'subjectId')::uuid and o.rsid=any(p_rsids)
    and o.extraction_version='vcf-literal-diploid-snp-v1'
    and o.source_build=f.build and o.source_sha256=f.sha256
   order by kind,row_key offset p_offset limit 1000
  ) q;
 return rows;
end;
$function$;
revoke all on function public.read_own_report_calls_v1(uuid,uuid,uuid,text,bigint[],integer) from public,anon,authenticated,inherit_upload_only;
grant execute on function public.read_own_report_calls_v1(uuid,uuid,uuid,text,bigint[],integer) to service_role;

-- Closed until the selected-generation migration installs its exact completed-run check.
create function private.own_analysis_completion_matches_v1(p_file_id uuid,p_purpose text,p_authorization jsonb)
returns boolean language sql security invoker set search_path=pg_catalog as $function$ select false; $function$;
revoke all on function private.own_analysis_completion_matches_v1(uuid,text,jsonb) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.own_analysis_completion_matches_v1(uuid,text,jsonb) to service_role;

create function public.filter_own_analysis_files_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,p_purpose text,
 p_file_ids uuid[],p_stored_result boolean)
returns uuid[] language plpgsql security invoker set search_path=pg_catalog
as $function$
declare v_id uuid; a jsonb; allowed uuid[]:='{}';
begin
 if p_file_ids is null or cardinality(p_file_ids)>1000 or p_stored_result is null then
  raise exception using errcode='22023',message='invalid_request'; end if;
 for v_id in select distinct unnest(p_file_ids) loop
  begin
   a:=private.current_own_report_grant_v1(p_account_id,p_session_id,v_id,p_purpose);
   if a->>'subjectId'=p_subject_id::text and (not p_stored_result or
    private.own_analysis_completion_matches_v1(v_id,p_purpose,a)) then allowed:=array_append(allowed,v_id); end if;
  exception when insufficient_privilege or object_not_in_prerequisite_state then null;
  end;
 end loop;
 return allowed;
end;
$function$;
revoke all on function public.filter_own_analysis_files_v1(uuid,uuid,uuid,text,uuid[],boolean) from public,anon,authenticated,inherit_upload_only;
grant execute on function public.filter_own_analysis_files_v1(uuid,uuid,uuid,text,uuid[],boolean) to service_role;

-- Read-only mirrors for authenticated PostgREST GET transactions. These perform no row locks.
-- Keep predicates/JSON equivalent to the locked service path; regression tests compare both.
create function private.own_upload_context_read_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare
 p public.profiles%rowtype;
 s public.subjects%rowtype;
 b public.subject_account_bindings%rowtype;
begin
 perform 1 from auth.users u where u.id=p_account_id and u.deleted_at is null;
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 perform 1 from auth.sessions a where a.id=p_session_id and a.user_id=p_account_id
  and (a.not_after is null or a.not_after>clock_timestamp());
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 select * into p from public.profiles where id=p_account_id;
 if p.id is null or p.deletion_requested_at is not null then
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
revoke all on function private.own_upload_context_read_v1(uuid,uuid,uuid) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.own_upload_context_read_v1(uuid,uuid,uuid) to service_role;

create function private.own_upload_store_authority_read_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare c jsonb; v_consent uuid; v_principal uuid; v_lifecycle bigint; v_session bigint;
begin
 c:=private.own_upload_context_read_v1(p_account_id,p_session_id,p_subject_id);
 perform 1 from auth.users where id=p_account_id and (banned_until is null or banned_until<=clock_timestamp());
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 if c->>'birthDateState'<>'adult' then raise exception using errcode='55000',message='adult_account_required'; end if;
 select lifecycle_revision into v_lifecycle from public.subjects where id=p_subject_id;
 select coalesce(refresh_token_counter,0)+1 into v_session from auth.sessions where id=p_session_id and user_id=p_account_id;
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
revoke all on function private.own_upload_store_authority_read_v1(uuid,uuid,uuid) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.own_upload_store_authority_read_v1(uuid,uuid,uuid) to service_role;

create function private.own_report_context_read_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog
as $function$
declare c jsonb; p public.subject_principals%rowtype;
begin
 c:=private.own_upload_store_authority_read_v1(p_account_id,p_session_id,p_subject_id);
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
revoke all on function private.own_report_context_read_v1(uuid,uuid,uuid) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.own_report_context_read_v1(uuid,uuid,uuid) to service_role;

create function private.current_own_report_grant_read_v1(p_account_id uuid,p_session_id uuid,p_file_id uuid,p_purpose text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare f public.genome_files%rowtype; c jsonb; g public.purpose_grants%rowtype; v_key text;
begin
 if p_purpose is null or p_purpose not in ('reports.monogenic','reports.polygenic','ancestry') then
  raise exception using errcode='42501',message='not_found'; end if;
 select * into f from public.genome_files where id=p_file_id and user_id=p_account_id;
 if f.id is null or f.single_logical_sample_verified_at is null or f.subject_id is null then
  raise exception using errcode='42501',message='not_found'; end if;
 c:=private.own_report_context_read_v1(p_account_id,p_session_id,f.subject_id);
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
revoke all on function private.current_own_report_grant_read_v1(uuid,uuid,uuid,text) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.current_own_report_grant_read_v1(uuid,uuid,uuid,text) to service_role;

create function private.own_stored_analysis_readable_v1(p_file_id uuid,p_purpose text)
returns boolean language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare f public.genome_files%rowtype; a jsonb; v_account uuid:=auth.uid(); v_session uuid;
begin
 if v_account is null then return false; end if;
 select * into f from public.genome_files where id=p_file_id and user_id=v_account;
 if f.id is null then return false; end if;
 -- Existing, independently authorized legacy files retain their owner policy.
 if f.single_logical_sample_verified_at is null then return true; end if;
 v_session:=(auth.jwt()->>'session_id')::uuid;
 if v_session is null then return false; end if;
 a:=private.current_own_report_grant_read_v1(v_account,v_session,p_file_id,p_purpose);
 return private.own_analysis_completion_matches_v1(p_file_id,p_purpose,a);
exception when insufficient_privilege or object_not_in_prerequisite_state or invalid_text_representation then return false;
end;
$function$;
revoke all on function private.own_stored_analysis_readable_v1(uuid,text) from public,anon,inherit_upload_only;
grant execute on function private.own_stored_analysis_readable_v1(uuid,text) to authenticated,service_role;
create policy own_ancestry_live_purpose on public.ancestry_results as restrictive for select to authenticated
 using(private.own_stored_analysis_readable_v1(file_id,'ancestry'));
create policy own_prs_live_purpose on public.user_prs as restrictive for select to authenticated
 using(private.own_stored_analysis_readable_v1(file_id,'reports.polygenic'));
