-- Two registered other-adult report outputs. This continuation is TEST-LOCAL
-- only and never invokes the self-only synchronous report exception.
alter table public.worker_jobs drop constraint worker_jobs_kind_check;
alter table public.worker_jobs add constraint worker_jobs_kind_check check(kind in(
 'annotate_vcf','align_fastq','call_variants','split_cohort_vcf','score_embryo','compute_portrait',
 'compute_ancestry_regional','revoke_purge','retention_purge','compute_monogenic_report','compute_polygenic_report'));
alter table public.worker_jobs drop constraint worker_jobs_output_kind_check;
alter table public.worker_jobs add constraint worker_jobs_output_kind_check check(output_kind in(
 'ingest.normalize','embryo.single-locus','embryo.statistical-estimate','embryo.carrier-match','family.portrait',
 'ancestry.estimate','lifecycle.revoke-purge','lifecycle.retention-purge','report.monogenic','report.polygenic'));
alter table public.worker_jobs drop constraint worker_jobs_dispatch_check;
alter table public.worker_jobs add constraint worker_jobs_dispatch_check check(
 (kind='annotate_vcf' and output_kind='ingest.normalize' and source_binding_kind='genome-file')
 or(kind='split_cohort_vcf' and output_kind='ingest.normalize' and source_binding_kind='embryo-ingest-fragment-set')
 or(kind='score_embryo' and output_kind in('embryo.single-locus','embryo.statistical-estimate','embryo.carrier-match') and source_binding_kind='cohort-source-set')
 or(kind='compute_portrait' and output_kind='family.portrait' and source_binding_kind='family-pair-source-set')
 or(kind='compute_ancestry_regional' and output_kind='ancestry.estimate' and source_binding_kind='genome-file')
 or(kind='revoke_purge' and output_kind='lifecycle.revoke-purge' and source_binding_kind='revocation-disposition')
 or(kind='retention_purge' and output_kind='lifecycle.retention-purge' and source_binding_kind='retention-disposition')
 or(kind='compute_monogenic_report' and output_kind='report.monogenic' and source_binding_kind='genome-file')
 or(kind='compute_polygenic_report' and output_kind='report.polygenic' and source_binding_kind='genome-file'));

-- Only an actual grant operation records its signing session. No session is
-- selected arbitrarily from auth.sessions after source normalization.
-- The scalar has no FK: session expiry/removal must never prevent Auth cleanup.
alter table public.purpose_grants add column path_b_originating_session_id uuid;
create function private.guard_path_b_report_session_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.path_b_originating_session_id is not null and new.path_b_originating_session_id is distinct from old.path_b_originating_session_id then
  raise exception using errcode='23514',message='Path B signing session is immutable'; end if;
 return new;
end;
$$;
revoke all on function private.guard_path_b_report_session_v1() from public,anon,authenticated,inherit_upload_only,service_role;
create trigger purpose_grants_path_b_session_immutable before update on public.purpose_grants
 for each row execute function private.guard_path_b_report_session_v1();

-- One registered private store holds the immutable purpose/source binding,
-- finite execution claim, bounded unpublished result and completed result.
create table private.path_b_report_bindings(
 id uuid primary key default gen_random_uuid(),
 binding_revision bigint generated always as identity unique check(binding_revision>0),
 file_id uuid not null references public.genome_files(id) on delete cascade,
 subject_id uuid not null references public.subjects(id) on delete cascade,
 recipient_account_id uuid not null references auth.users(id) on delete cascade,
 grant_id uuid not null references public.purpose_grants(grant_id) on delete cascade,
 grant_revision bigint not null check(grant_revision>0),
 purpose text not null check(purpose in('reports.monogenic','reports.polygenic')),
 authority jsonb not null,
 authority_sha256 text not null check(authority_sha256~'^[0-9a-f]{64}$'),
 computation_revision text not null check(computation_revision~'^path-b-reports-v1:[0-9a-f]{64}$'),
 job_id uuid unique references public.worker_jobs(id) on delete cascade,
 state text not null default 'queued' check(state in('queued','running','complete','failed')),
 claim uuid,
 expires_at timestamptz,
 staged_result jsonb check(staged_result is null or octet_length(staged_result::text)<=4000000),
 result jsonb check(result is null or octet_length(result::text)<=4000000),
 completed_at timestamptz,
 unique(file_id,binding_revision),
 unique(file_id,grant_id,grant_revision,recipient_account_id,authority_sha256,computation_revision),
 check((state='complete')=(result is not null and completed_at is not null)),
 check(state<>'running' or(claim is not null and expires_at is not null))
);
alter table private.path_b_report_bindings enable row level security;
revoke all on private.path_b_report_bindings from public,anon,authenticated,inherit_upload_only,service_role;
insert into public.purge_target_stores(target_id,store_name,store_order)
 values('generated-artifacts','private.path_b_report_bindings',6);

create function private.guard_path_b_report_binding_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if row(new.id,new.binding_revision,new.file_id,new.subject_id,new.recipient_account_id,new.grant_id,new.grant_revision,
  new.purpose,new.authority,new.authority_sha256,new.computation_revision)
  is distinct from row(old.id,old.binding_revision,old.file_id,old.subject_id,old.recipient_account_id,old.grant_id,
   old.grant_revision,old.purpose,old.authority,old.authority_sha256,old.computation_revision)
  or(old.job_id is not null and new.job_id is distinct from old.job_id) then
  raise exception using errcode='23514',message='Path B report binding is immutable'; end if;
 if old.state='complete' and row(new.state,new.result,new.completed_at) is distinct from row(old.state,old.result,old.completed_at) then
  raise exception using errcode='23514',message='Path B completed result is immutable'; end if;
 return new;
end;
$$;
revoke all on function private.guard_path_b_report_binding_v1() from public,anon,authenticated,inherit_upload_only,service_role;
create trigger path_b_report_binding_immutable before update on private.path_b_report_bindings
 for each row execute function private.guard_path_b_report_binding_v1();

create function private.guard_path_b_report_job_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.computation_revision like 'path-b-reports-v1:%'
  and row(new.payload,new.user_id,new.file_id) is distinct from row(old.payload,old.user_id,old.file_id) then
  raise exception using errcode='23514',message='Path B report authority is immutable'; end if;
 return new;
end;
$$;
revoke all on function private.guard_path_b_report_job_v1() from public,anon,authenticated,inherit_upload_only,service_role;
create trigger worker_jobs_path_b_report_authority_immutable before update on public.worker_jobs
 for each row execute function private.guard_path_b_report_job_v1();

create function private.path_b_report_insurance_v1(p_account_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 select cs.id into v_id from public.consent_signatures cs
 join public.subjects s on s.id=cs.target_id and s.subject_class='self' and s.subject_account_id=p_account_id and s.lifecycle='active'
 join public.subject_principals sp on sp.id=cs.signer_principal_id and sp.subject_id=s.id
  and sp.account_id=p_account_id and sp.principal_kind='account_subject' and sp.status='active'
 join public.profiles pr on pr.id=p_account_id and pr.deletion_requested_at is null
  and pr.date_of_birth<=(timezone('UTC',clock_timestamp())::date-interval '18 years')::date
 join public.consent_artifacts ja on ja.artifact_key='attestation.jurisdiction'
  and ja.version=pr.jurisdiction_attestation_version and ja.body_sha256=pr.jurisdiction_attestation_sha256
  and ja.superseded_at is null and ja.published_at<=clock_timestamp()
  and ja.effective_on<=timezone('UTC',clock_timestamp())::date
  and ja.body_sha256=encode(extensions.digest(convert_to(ja.body_markdown,'UTF8'),'sha256'),'hex')
 join public.consent_artifacts ca on ca.artifact_key=cs.artifact_key and ca.version=cs.artifact_version
  and ca.body_sha256=cs.artifact_body_sha256 and ca.superseded_at is null
 where cs.target_kind='subject' and cs.signer_account_id=p_account_id
  and cs.subject_binding_revision=s.subject_binding_revision and cs.jurisdiction_revision=pr.jurisdiction_revision
  and ca.artifact_key='disclosure.insurance-and-discrimination' and ca.published_at<=clock_timestamp()
  and ca.effective_on<=timezone('UTC',clock_timestamp())::date
  and ca.body_sha256=encode(extensions.digest(convert_to(ca.body_markdown,'UTF8'),'sha256'),'hex')
 order by cs.signed_at desc limit 1 for share of cs,s,sp,pr,ca,ja;
 if v_id is null then raise exception using errcode='42501',message='not_found'; end if;
 return v_id;
end;
$$;
revoke all on function private.path_b_report_insurance_v1(uuid) from public,anon,authenticated,inherit_upload_only,service_role;

create function private.path_b_report_authority_v1(p_file_id uuid,p_grant_id uuid,p_checkpoint text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare f public.genome_files%rowtype; n private.own_normalization_runs%rowtype;
 g public.purpose_grants%rowtype; d public.directional_grants%rowtype;
 s public.subjects%rowtype; sp public.subject_principals%rowtype; rp public.subject_principals%rowtype;
 pr public.profiles%rowtype; rel public.subject_relationships%rowtype;
 a jsonb; c jsonb; v_deadline timestamptz; v_session_deadline timestamptz; v_catalog text;
 v_subject_insurance uuid; v_recipient_insurance uuid;
begin
 perform private.lock_invitation_transitions_v1();
 a:=private.path_b_normalization_authority_v1(p_file_id,p_checkpoint);
 select * into f from public.genome_files where id=p_file_id for share;
 select * into n from private.own_normalization_runs where file_id=f.id for share;
 if f.id is null or f.user_id is distinct from(a->>'uploaderAccountId')::uuid
  or f.subject_id is distinct from(a->>'subjectId')::uuid or f.sha256 is distinct from a->>'rawSha256'
  or f.source_sha256 is distinct from a->>'decodedSha256' or f.storage_object_id is not null
  or f.bucket_path is distinct from a->>'objectKey' or f.size_bytes is distinct from(a->>'sizeBytes')::bigint
  or f.file_type::text is distinct from a->>'fileType'
  or f.upload_revision is distinct from(a->>'sourceRevision')::bigint
  or f.single_logical_sample_verified_at is null or f.structural_validator_version is null
  or n.state<>'complete' or n.authority is distinct from a
  or n.provenance->>'version'<>'path-b-normalization-v1' or f.normalization_completed_at is null
  or f.normalization_source_revision<>f.upload_revision or f.build not in('GRCh37','GRCh38')
  or not exists(select 1 from public.worker_jobs j where j.id=n.session_id and j.file_id=f.id
   and j.status='done' and j.output_kind='ingest.normalize' and j.computation_revision='path-b-normalization-v1') then
  raise exception using errcode='42501',message='not_found'; end if;
 select * into s from public.subjects where id=f.subject_id for share;
 select * into g from public.purpose_grants where grant_id=p_grant_id for share;
 select * into d from public.directional_grants where grant_id=p_grant_id for share;
 if g.grant_id is null or g.target_kind<>'subject' or g.target_id<>s.id
  or g.purpose not in('reports.monogenic','reports.polygenic') or g.revoked_at is not null
  or(g.expires_at is not null and g.expires_at<=clock_timestamp()) or d.status<>'current'
  or d.grant_revision<>g.grant_revision or g.subject_binding_revision<>s.subject_binding_revision
  or g.path_b_originating_session_id is null then raise exception using errcode='42501',message='not_found'; end if;
 c:=private.path_b_person_v1(s.subject_account_id,g.path_b_originating_session_id,s.id);
 select * into sp from public.subject_principals where id=g.data_subject_principal_id and status='active' for share;
 select * into rp from public.subject_principals where id=d.recipient_principal_id and status='active' for share;
 select * into pr from public.profiles where id=d.recipient_account_id for share;
 if sp.id is null or sp.subject_id<>s.id or sp.account_id<>s.subject_account_id or sp.id<>g.signer_principal_id
  or sp.id<>(c->>'principalId')::uuid or rp.id is null or rp.account_id<>pr.id
  or not private.path_b_account_current_v1(pr.id) or pr.date_of_birth is null
  or pr.date_of_birth>(timezone('UTC',clock_timestamp())::date-interval '18 years')::date
  or pr.jurisdiction_code='XX' or g.jurisdiction_code='XX'
  or(a->>'uploaderJurisdictionRevision')::bigint<>(select jurisdiction_revision from public.profiles where id=(a->>'uploaderAccountId')::uuid)
  or(select jurisdiction_code from public.profiles where id=(a->>'uploaderAccountId')::uuid)='XX'
  or g.jurisdiction_revision<>(c->>'jurisdictionRevision')::bigint
  or not exists(select 1 from auth.users where id=pr.id and deleted_at is null
   and(banned_until is null or banned_until<=clock_timestamp())) then
  raise exception using errcode='42501',message='not_found'; end if;
 if d.direction='self' then
  if d.relationship_id is not null or rp.id<>sp.id or d.recipient_account_id<>sp.account_id
   or d.self_principal_revision<>sp.principal_revision
   or d.relationship_or_pair_revision<>s.subject_binding_revision
   or g.artifact_key<>(case g.purpose when 'reports.monogenic' then 'consent.own-monogenic' else 'consent.own-polygenic' end) then
   raise exception using errcode='42501',message='not_found'; end if;
 elsif d.direction='subject_to_recipient' then
  select * into rel from public.subject_relationships where id=d.relationship_id for share;
  if rel.id is null or rel.status<>'current' or rel.relationship_kind<>'uploader'
   or rel.subject_id<>s.id or rel.data_subject_principal_id<>sp.id or rel.recipient_principal_id<>rp.id
   or rel.recipient_account_id<>pr.id or pr.id<>s.owner_account_id
   or rel.relationship_revision<>d.relationship_or_pair_revision or g.artifact_key<>'consent.share-with-adult' then
   raise exception using errcode='42501',message='not_found'; end if;
 else raise exception using errcode='42501',message='not_found'; end if;
 perform 1 from public.consent_artifacts ca join public.consent_signatures cs on cs.id=g.signature_id
  where ca.artifact_key=g.artifact_key and ca.version=g.artifact_version and ca.body_sha256=g.artifact_body_sha256
   and ca.superseded_at is null and ca.published_at<=clock_timestamp()
   and ca.effective_on<=timezone('UTC',clock_timestamp())::date
   and ca.body_sha256=encode(extensions.digest(convert_to(ca.body_markdown,'UTF8'),'sha256'),'hex')
   and cs.artifact_key=ca.artifact_key and cs.artifact_version=ca.version and cs.artifact_body_sha256=ca.body_sha256
   and cs.signer_account_id=sp.account_id and cs.signer_principal_id=sp.id and cs.target_kind='subject'
   and cs.target_id=s.id and cs.purpose=g.purpose and cs.subject_binding_revision=s.subject_binding_revision
   and cs.jurisdiction_revision=g.jurisdiction_revision
   and cs.statement_keys=case d.direction when 'self' then array['make-this-result-for-me']
    else array['one-purpose','one-named-adult','own-account','pause-or-stop-any-time'] end for share of ca,cs;
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 v_subject_insurance:=private.path_b_report_insurance_v1(sp.account_id);
 v_recipient_insurance:=private.path_b_report_insurance_v1(pr.id);
 if private.path_b_report_insurance_v1((a->>'uploaderAccountId')::uuid) is distinct from(a->>'insuranceSignatureId')::uuid then
  raise exception using errcode='42501',message='not_found'; end if;
 select not_after into v_session_deadline from auth.sessions where id=g.path_b_originating_session_id
  and user_id=sp.account_id and(not_after is null or not_after>clock_timestamp()) for share;
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 v_deadline:=least((a->>'authorityExpiresAt')::timestamptz,coalesce(g.expires_at,'infinity'::timestamptz),
  coalesce(v_session_deadline,'infinity'::timestamptz));
 if v_deadline<=clock_timestamp() then raise exception using errcode='42501',message='not_found'; end if;
 perform t.slug from public.report_templates t where t.status='published'
  and t.layer::text=case g.purpose when 'reports.monogenic' then 'variant_call' else 'estimate' end
  order by t.slug for share;
 select encode(extensions.digest(convert_to(coalesce(jsonb_agg(jsonb_build_object(
  'slug',t.slug,'category',t.category,'title',t.title,'summary',t.summary,'evidence',t.evidence,
  'variants',t.variants,'pgs_id',t.pgs_id,'citations',t.citations,'layer',t.layer,'estimate_kind',t.estimate_kind)
  order by t.slug),'[]'::jsonb)::text,'UTF8'),'sha256'),'hex') into v_catalog
  from public.report_templates t where t.status='published'
   and t.layer::text=case g.purpose when 'reports.monogenic' then 'variant_call' else 'estimate' end;
 return jsonb_build_object('source',a,'fileId',f.id,'subjectId',s.id,'sourcePublicationRevision',f.source_publication_revision,
  'normalizationClaim',n.claim,'normalizedAt',f.normalization_completed_at,'variantCount',f.variant_count,
  'grantId',g.grant_id,'grantRevision',g.grant_revision,'purpose',g.purpose,'signatureId',g.signature_id,
  'artifactKey',g.artifact_key,'artifactVersion',g.artifact_version,'artifactSha256',g.artifact_body_sha256,
  'grantOriginatingSessionId',g.path_b_originating_session_id,'direction',d.direction,'recipientAccountId',pr.id,
  'subjectInsuranceSignatureId',v_subject_insurance,'recipientInsuranceSignatureId',v_recipient_insurance,
  'recipientPrincipalId',rp.id,'recipientPrincipalRevision',rp.principal_revision,
  'recipientAuthRevision',pr.auth_session_revision,'recipientJurisdictionRevision',pr.jurisdiction_revision,
  'relationshipId',d.relationship_id,'relationshipRevision',d.relationship_or_pair_revision,
  'catalogSha256',v_catalog,'authorityExpiresAt',v_deadline);
end;
$$;
revoke all on function private.path_b_report_authority_v1(uuid,uuid,text) from public,anon,authenticated,inherit_upload_only,service_role;

create function private.enqueue_path_b_reports_v1(p_subject_id uuid,p_test_jurisdiction boolean)
returns integer language plpgsql security definer set search_path='' as $$
declare x record; a jsonb; b private.path_b_report_bindings%rowtype; j public.worker_jobs%rowtype;
 v_hash text; v_computation text; v_count integer:=0;
begin
 if p_test_jurisdiction is distinct from true then raise exception using errcode='42501',message='not_found'; end if;
 perform private.lock_invitation_transitions_v1();
 for x in select f.id file_id,g.grant_id from public.genome_files f
  join public.subjects s on s.id=f.subject_id and s.subject_class='other_adult' and s.lifecycle='active'
  join public.purpose_grants g on g.target_kind='subject' and g.target_id=s.id
   and g.purpose in('reports.monogenic','reports.polygenic') and g.revoked_at is null
  where s.id=p_subject_id and f.normalization_completed_at is not null order by f.id,g.grant_id
 loop
  begin
   a:=private.path_b_report_authority_v1(x.file_id,x.grant_id,'analysis-enqueue');
   v_hash:=encode(extensions.digest(convert_to(a::text,'UTF8'),'sha256'),'hex');
   v_computation:='path-b-reports-v1:'||(a->>'catalogSha256');
   insert into private.path_b_report_bindings(file_id,subject_id,recipient_account_id,grant_id,grant_revision,purpose,
    authority,authority_sha256,computation_revision)
   values(x.file_id,p_subject_id,(a->>'recipientAccountId')::uuid,x.grant_id,(a->>'grantRevision')::bigint,a->>'purpose',a,v_hash,v_computation)
   on conflict(file_id,grant_id,grant_revision,recipient_account_id,authority_sha256,computation_revision) do nothing;
   select * into strict b from private.path_b_report_bindings where file_id=x.file_id and grant_id=x.grant_id
    and grant_revision=(a->>'grantRevision')::bigint and recipient_account_id=(a->>'recipientAccountId')::uuid
    and authority_sha256=v_hash and computation_revision=v_computation for update;
   if b.authority is distinct from a then raise exception using errcode='23514',message='binding_hash_collision'; end if;
   j:=private.enqueue_worker_job_v2(b.recipient_account_id,
    case b.purpose when 'reports.monogenic' then 'compute_monogenic_report' else 'compute_polygenic_report' end,
    case b.purpose when 'reports.monogenic' then 'report.monogenic' else 'report.polygenic' end,
    b.subject_id,null,'genome-file',b.file_id,b.binding_revision,a->'source'->>'rawSha256',b.computation_revision,
    b.file_id,jsonb_build_object('bindingId',b.id));
   if b.job_id is not null and b.job_id<>j.id then raise exception using errcode='23514',message='binding_job_collision'; end if;
   update private.path_b_report_bindings set job_id=j.id where id=b.id;
   if b.state='failed' or j.status in('failed','cancelled') then
    -- Replays never revive a terminal execution or a withdrawn result.
    continue;
   end if;
   if private.path_b_report_authority_v1(b.file_id,b.grant_id,'analysis-enqueue') is distinct from b.authority then
    raise exception using errcode='42501',message='not_found'; end if;
   v_count:=v_count+1;
  exception when insufficient_privilege then null;
  end;
 end loop;
 return v_count;
end;
$$;
revoke all on function private.enqueue_path_b_reports_v1(uuid,boolean) from public,anon,authenticated,inherit_upload_only,service_role;
create function public.enqueue_path_b_reports_v1(p_subject_id uuid,p_test_jurisdiction boolean)
returns integer language sql security definer set search_path=''
as $$select private.enqueue_path_b_reports_v1(p_subject_id,p_test_jurisdiction);$$;
revoke all on function public.enqueue_path_b_reports_v1(uuid,boolean) from public,anon,authenticated,inherit_upload_only;
grant execute on function public.enqueue_path_b_reports_v1(uuid,boolean) to service_role;

-- Preserve the existing grant receipt and exact grant semantics; only this
-- already-verified signing session is recorded and considered for queued work.
create or replace function public.grant_path_b_purpose_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,
 p_purpose text,p_direction text,p_artifact_version integer,p_artifact_body_sha256 text,p_nonce_hash text,
 p_expires_at timestamptz,p_test_jurisdiction boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;
begin
 r:=private.grant_path_b_purpose_v1(p_account_id,p_session_id,p_subject_id,p_purpose,p_direction,
  p_artifact_version,p_artifact_body_sha256,p_nonce_hash,p_expires_at,p_test_jurisdiction);
 update public.purpose_grants set path_b_originating_session_id=p_session_id
  where grant_id=(r->>'recordId')::uuid and path_b_originating_session_id is null;
 perform private.enqueue_path_b_reports_v1(p_subject_id,p_test_jurisdiction);
 return r;
end;
$$;
revoke all on function public.grant_path_b_purpose_v1(uuid,uuid,uuid,text,text,integer,text,text,timestamptz,boolean)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function public.grant_path_b_purpose_v1(uuid,uuid,uuid,text,text,integer,text,text,timestamptz,boolean) to service_role;

create or replace function public.path_b_normalization_v1(p_operation text,p_job_id uuid,p_claim_hash text,
 p_claim uuid,p_payload jsonb,p_test_jurisdiction boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb; v_subject uuid;
begin
 r:=private.path_b_normalization_v1(p_operation,p_job_id,p_claim_hash,p_claim,p_payload,p_test_jurisdiction);
 if p_operation='complete' then
  select subject_id into strict v_subject from public.genome_files where id=(r->>'fileId')::uuid;
  perform private.enqueue_path_b_reports_v1(v_subject,p_test_jurisdiction);
 end if;
 return r;
end;
$$;
revoke all on function public.path_b_normalization_v1(text,uuid,text,uuid,jsonb,boolean) from public,anon,authenticated,inherit_upload_only;
grant execute on function public.path_b_normalization_v1(text,uuid,text,uuid,jsonb,boolean) to service_role;

-- Revocation discards both staged and completed output for precisely this
-- grant; a cancelled job retains only coded lifecycle metadata.
create function private.cancel_path_b_report_binding_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.worker_jobs set status='cancelled',finished_at=clock_timestamp(),
  claim_token_hash=null,claim_expires_at=null,result=null,error='path_b_report_cancelled'
  where id=old.job_id and status in('queued','running','done');
 return old;
end;
$$;
revoke all on function private.cancel_path_b_report_binding_v1() from public,anon,authenticated,inherit_upload_only,service_role;
create trigger cancel_deleted_path_b_report_binding after delete on private.path_b_report_bindings
 for each row execute function private.cancel_path_b_report_binding_v1();
create function private.clear_ended_path_b_report_outputs_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_ended boolean;
begin
 if tg_table_name='purpose_grants' then v_ended:=new.revoked_at is not null;
 else v_ended:=new.status<>'current'; end if;
 if v_ended then
  delete from private.path_b_report_bindings where grant_id=new.grant_id;
 end if;
 return new;
end;
$$;
revoke all on function private.clear_ended_path_b_report_outputs_v1() from public,anon,authenticated,inherit_upload_only,service_role;
create trigger clear_revoked_path_b_reports after update of revoked_at on public.purpose_grants
 for each row execute function private.clear_ended_path_b_report_outputs_v1();
create trigger clear_ended_path_b_reports after update of status on public.directional_grants
 for each row execute function private.clear_ended_path_b_report_outputs_v1();

-- Capture exact published references and the existing honest outcome schema.
-- Counts/percentiles, extra worker fields and omitted templates are refused.
create function private.capture_path_b_report_result_v1(p_purpose text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare item jsonb; v jsonb; o jsonb; captured jsonb; expected jsonb; reports jsonb:='[]';
 v_sha text; v_index bigint; v_prs jsonb;
begin
 if p_purpose is null or p_purpose not in('reports.monogenic','reports.polygenic') or jsonb_typeof(p_payload) is distinct from 'object'
  or not(p_payload ?& array['reports','prs']) or p_payload-array['reports','prs']<>'{}'
  or jsonb_typeof(p_payload->'reports')<>'array' or jsonb_typeof(p_payload->'prs')<>'array'
  or octet_length(p_payload::text)>4000000 or jsonb_array_length(p_payload->'reports')>1000
  or jsonb_array_length(p_payload->'prs')>100
  or(p_purpose='reports.monogenic' and p_payload->'prs'<>'[]') then
  raise exception using errcode='22023',message='invalid_request'; end if;
 perform t.slug from public.report_templates t where t.status='published'
  and t.layer::text=case p_purpose when 'reports.monogenic' then 'variant_call' else 'estimate' end
  order by t.slug for share;
 if jsonb_array_length(p_payload->'reports')<>(select count(*) from public.report_templates t where t.status='published'
   and t.layer::text=case p_purpose when 'reports.monogenic' then 'variant_call' else 'estimate' end)
  or(select count(distinct x->>'slug') from jsonb_array_elements(p_payload->'reports') x)<>jsonb_array_length(p_payload->'reports') then
  raise exception using errcode='22023',message='invalid_report_catalog'; end if;
 for item in select value from jsonb_array_elements(p_payload->'reports') loop
  if jsonb_typeof(item)<>'object' or not(item ?& array['slug','covered','catalogSnapshot','variants','conflictingRsids'])
   or item-array['slug','covered','catalogSnapshot','variants','conflictingRsids']<>'{}'
   or jsonb_typeof(item->'covered')<>'boolean' or jsonb_typeof(item->'variants')<>'array'
   or jsonb_typeof(item->'conflictingRsids')<>'array' or jsonb_array_length(item->'conflictingRsids')>1000 then
   raise exception using errcode='22023',message='invalid_request'; end if;
  captured:=item->'catalogSnapshot';
  if jsonb_typeof(captured)<>'object' or not(captured ?& array['schemaVersion','template'])
   or captured->'schemaVersion'<>'1' or captured-array['schemaVersion','template','templateSha256']<>'{}' then
   raise exception using errcode='22023',message='invalid_report_catalog'; end if;
  select jsonb_build_object('slug',t.slug,'category',t.category,'title',t.title,'summary',t.summary,
   'evidence',t.evidence,'variants',t.variants,'pgs_id',t.pgs_id,'citations',t.citations,
   'layer',t.layer,'estimate_kind',t.estimate_kind) into expected from public.report_templates t
   where t.slug=item->>'slug' and t.status='published'
    and t.layer::text=case p_purpose when 'reports.monogenic' then 'variant_call' else 'estimate' end;
  if expected is null or captured->'template' is distinct from expected
   or jsonb_array_length(item->'variants')<>jsonb_array_length(expected->'variants') then
   raise exception using errcode='22023',message='invalid_report_catalog'; end if;
  v_sha:=encode(extensions.digest(convert_to(expected::text,'UTF8'),'sha256'),'hex');
  if captured ? 'templateSha256' and captured->>'templateSha256' is distinct from v_sha then
   raise exception using errcode='22023',message='invalid_report_catalog'; end if;
  for v,v_index in select value,ordinality from jsonb_array_elements(item->'variants') with ordinality loop
   o:=v->'outcome';
   if jsonb_typeof(v)<>'object' or not(v ?& array['rsid','outcome']) or v-array['rsid','outcome']<>'{}'
    or v->'rsid' is distinct from expected->'variants'->(v_index::integer-1)->'rsid'
    or jsonb_typeof(o) is distinct from 'object' or o->>'status' is null
    or o->>'status' not in('genotyped','no-call','not-covered','unrecognized') then
    raise exception using errcode='22023',message='invalid_request'; end if;
   if o->>'status' in('no-call','not-covered') then
    if o-'status'<>'{}' then raise exception using errcode='22023',message='invalid_request'; end if;
   elsif o->>'status'='unrecognized' then
    if not(o ?& array['status','genotype']) or o-array['status','genotype']<>'{}'
     or jsonb_typeof(o->'genotype')<>'string' or length(o->>'genotype')>64 then
     raise exception using errcode='22023',message='invalid_request'; end if;
   else
    if not(o ?& array['status','genotype','interpretation','strandFlipped'])
     or o-array['status','genotype','interpretation','strandFlipped']<>'{}'
     or jsonb_typeof(o->'genotype')<>'string' or length(o->>'genotype')>64
     or jsonb_typeof(o->'interpretation')<>'string' or length(o->>'interpretation')>100000
     or jsonb_typeof(o->'strandFlipped')<>'boolean' then
     raise exception using errcode='22023',message='invalid_request'; end if;
   end if;
  end loop;
  if(item->>'covered')::boolean is distinct from exists(select 1 from jsonb_array_elements(item->'variants') q
   where q->'outcome'->>'status'='genotyped') or exists(select 1 from jsonb_array_elements(item->'conflictingRsids') q
   where not exists(select 1 from jsonb_array_elements(expected->'variants') ev where ev->'rsid'=q)) then
   raise exception using errcode='22023',message='invalid_request'; end if;
  reports:=reports||jsonb_build_array(jsonb_set(item,'{catalogSnapshot,templateSha256}',to_jsonb(v_sha)));
 end loop;
 for v_prs in select value from jsonb_array_elements(p_payload->'prs') loop
  if jsonb_typeof(v_prs)<>'object' or not(v_prs ?& array['pgs_id','raw_score','coverage','matched'])
   or v_prs-array['pgs_id','raw_score','coverage','matched']<>'{}'
   or jsonb_typeof(v_prs->'raw_score')<>'number' or jsonb_typeof(v_prs->'coverage')<>'number'
   or(v_prs->>'coverage')::numeric not between 0 and 1 or v_prs->>'matched'!~'^(0|[1-9][0-9]{0,6})$'
   or not exists(select 1 from public.prs_scores where pgs_id=v_prs->>'pgs_id') then
   raise exception using errcode='22023',message='invalid_request'; end if;
 end loop;
 if(select count(distinct q->>'pgs_id') from jsonb_array_elements(p_payload->'prs') q)<>jsonb_array_length(p_payload->'prs') then
  raise exception using errcode='22023',message='invalid_request'; end if;
 return jsonb_build_object('reports',reports,'prs',p_payload->'prs');
end;
$$;
revoke all on function private.capture_path_b_report_result_v1(text,jsonb) from public,anon,authenticated,inherit_upload_only,service_role;

create function private.path_b_report_v1(p_operation text,p_job_id uuid,p_claim_hash text,
 p_claim uuid,p_payload jsonb,p_test_jurisdiction boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.worker_jobs%rowtype; b private.path_b_report_bindings%rowtype;
 a jsonb; receipt jsonb; v_result jsonb; v_attempt integer; v_now timestamptz;
begin
 if p_test_jurisdiction is distinct from true then raise exception using errcode='42501',message='not_found'; end if;
 if p_operation is null or p_operation not in('claim','check','read-variants','read-observed','stage','complete','fail')
  or p_claim_hash is null or p_claim_hash!~'^[0-9a-f]{64}$' then
  raise exception using errcode='22023',message='invalid_request'; end if;
 perform private.lock_invitation_transitions_v1();
 if p_operation='claim' then
  if p_job_id is not null or p_claim is not null or p_payload is not null then
   raise exception using errcode='22023',message='invalid_request'; end if;
  for v_attempt in 1..20 loop
   select w.* into j from public.worker_jobs w join private.path_b_report_bindings r on r.job_id=w.id
    where w.status='queued' and r.state='queued' and w.not_before<=clock_timestamp() and w.attempts<w.max_attempts
     and w.kind in('compute_monogenic_report','compute_polygenic_report')
     and w.computation_revision like 'path-b-reports-v1:%'
    order by w.created_at,w.id limit 1 for update of w skip locked;
   if j.id is null then return null; end if;
   select * into strict b from private.path_b_report_bindings where job_id=j.id for update;
   begin
    a:=private.path_b_report_authority_v1(b.file_id,b.grant_id,'worker-claim');
    if a is distinct from b.authority then raise exception using errcode='42501',message='not_found'; end if;
   exception when insufficient_privilege then
    delete from private.path_b_report_bindings where id=b.id;
    continue;
   end;
   exit;
  end loop;
  if b.id is null or not exists(select 1 from private.path_b_report_bindings where id=b.id) then return null; end if;
 else
  select * into j from public.worker_jobs where id=p_job_id for update;
  select * into b from private.path_b_report_bindings where job_id=p_job_id for update;
  if j.id is null or b.id is null or j.status<>'running' or b.state<>'running'
   or j.claim_token_hash is distinct from p_claim_hash or b.claim is distinct from p_claim or p_claim is null then
   raise exception using errcode='42501',message='not_found'; end if;
 end if;
 if j.user_id<>b.recipient_account_id or j.file_id<>b.file_id or j.subject_id<>b.subject_id or j.cohort_id is not null
  or j.source_binding_kind<>'genome-file' or j.source_binding_id<>b.file_id or j.source_binding_revision<>b.binding_revision
  or j.computation_revision<>b.computation_revision or j.file_sha256<>b.authority->'source'->>'rawSha256'
  or j.payload is distinct from jsonb_build_object('bindingId',b.id)
  or j.kind<>(case b.purpose when 'reports.monogenic' then 'compute_monogenic_report' else 'compute_polygenic_report' end)
  or j.output_kind<>(case b.purpose when 'reports.monogenic' then 'report.monogenic' else 'report.polygenic' end) then
  raise exception using errcode='42501',message='not_found'; end if;
 if p_operation='fail' then
  if p_payload is not null then raise exception using errcode='22023',message='invalid_request'; end if;
  update private.path_b_report_bindings set state='failed',staged_result=null where id=b.id;
  update public.worker_jobs set status='failed',finished_at=clock_timestamp(),error='path_b_report_failed',
   claim_token_hash=null,claim_expires_at=null where id=j.id;
  return 'true';
 end if;
 a:=private.path_b_report_authority_v1(b.file_id,b.grant_id,case p_operation when 'claim' then 'worker-claim'
  when 'check' then 'source-read-and-every-bounded-range' when 'read-variants' then 'source-read-and-every-bounded-range'
  when 'read-observed' then 'source-read-and-every-bounded-range' else 'derived-write-and-read' end);
 if a is distinct from b.authority then raise exception using errcode='42501',message='not_found'; end if;
 if p_operation='claim' then
  p_claim:=gen_random_uuid(); v_now:=least(clock_timestamp()+interval '5 minutes',(a->>'authorityExpiresAt')::timestamptz);
  update public.worker_jobs set status='running',attempts=attempts+1,claim_token_hash=p_claim_hash,
   claim_expires_at=v_now,claimed_by='path-b-reports-v1',started_at=coalesce(started_at,clock_timestamp()) where id=j.id returning * into j;
  update private.path_b_report_bindings set state='running',claim=p_claim,expires_at=v_now where id=b.id returning * into b;
 end if;
 if least(j.claim_expires_at,b.expires_at,(a->>'authorityExpiresAt')::timestamptz)<=clock_timestamp() then
  raise exception using errcode='42501',message='not_found'; end if;
 receipt:=jsonb_build_object('jobId',j.id,'claim',b.claim,'claimExpiresAt',j.claim_expires_at,
  'fileId',b.file_id,'subjectId',b.subject_id,'purpose',b.purpose,'bindingRevision',b.binding_revision,
  'sourceRevision',a->'source'->'sourceRevision','sourceSha256',a->'source'->'decodedSha256',
  'normalizedAt',a->'normalizedAt','computationRevision',b.computation_revision,'authoritySha256',b.authority_sha256);
 if p_operation in('claim','check') then
  if p_payload is not null then raise exception using errcode='22023',message='invalid_request'; end if;
  return receipt;
 end if;
 if p_operation in('read-variants','read-observed') then
  if jsonb_typeof(p_payload) is distinct from 'object' or not(p_payload ?& array['loci','offset'])
   or p_payload-array['loci','offset']<>'{}' or jsonb_typeof(p_payload->'loci') is distinct from 'array'
   or jsonb_array_length(p_payload->'loci') not between 1 and 200
   or jsonb_typeof(p_payload->'offset') is distinct from 'number' or p_payload->>'offset'!~'^(0|[1-9][0-9]{0,6})$'
   or exists(select 1 from jsonb_array_elements(p_payload->'loci') q where jsonb_typeof(q)<>'object'
    or not(q ?& array['chrom','pos']) or q-array['chrom','pos']<>'{}'
    or jsonb_typeof(q->'chrom') is distinct from 'number' or jsonb_typeof(q->'pos') is distinct from 'number'
    or q->>'chrom'!~'^([1-9]|1[0-9]|2[0-5])$'
    or q->>'pos'!~'^[1-9][0-9]{0,8}$') then raise exception using errcode='22023',message='invalid_request'; end if;
  if p_operation='read-variants' then
   select coalesce(jsonb_agg(to_jsonb(x)),'[]') into v_result from(select v.file_id,v.rsid,v.chrom,v.pos,v.ref,v.alt,v.genotype
    from public.user_variants v where v.file_id=b.file_id and v.subject_id=b.subject_id
     and exists(select 1 from jsonb_to_recordset(p_payload->'loci') p(chrom integer,pos integer) where p.chrom=v.chrom and p.pos=v.pos)
    order by v.id offset(p_payload->>'offset')::integer limit 1000) x;
  else
   select coalesce(jsonb_agg(to_jsonb(x)),'[]') into v_result from(select v.file_id,v.rsid,v.chrom,v.pos,v.ref,v.alt,v.genotype,v.usable
    from public.report_observed_calls v where v.file_id=b.file_id and v.subject_id=b.subject_id
     and v.source_sha256=a->'source'->>'decodedSha256' and v.extraction_version='vcf-literal-diploid-snp-v1'
     and exists(select 1 from jsonb_to_recordset(p_payload->'loci') p(chrom integer,pos integer) where p.chrom=v.chrom and p.pos=v.pos)
    order by v.source_line offset(p_payload->>'offset')::integer limit 1000) x;
  end if;
  if octet_length(v_result::text)>4000000 then raise exception using errcode='22023',message='invalid_request'; end if;
 elsif p_operation='stage' then
  if b.staged_result is not null then raise exception using errcode='22023',message='invalid_request'; end if;
  v_result:=private.capture_path_b_report_result_v1(b.purpose,p_payload);
  update private.path_b_report_bindings set staged_result=v_result where id=b.id;
  perform private.path_b_report_v1('check',j.id,p_claim_hash,b.claim,null,p_test_jurisdiction);
  v_result:='true';
 else
  if p_payload is not null or b.staged_result is null then raise exception using errcode='22023',message='invalid_request'; end if;
  v_result:=private.capture_path_b_report_result_v1(b.purpose,b.staged_result);
  -- Coverage metadata is the only PGS projection; no personal raw score,
  -- calibrated risk, percentile, or a different purpose's rows are published.
  v_result:=jsonb_build_object('reports',v_result->'reports','prsCount',jsonb_array_length(v_result->'prs'),
   'prsCoverage',(select coalesce(jsonb_agg(q-'raw_score'),'[]') from jsonb_array_elements(v_result->'prs') q));
  update private.path_b_report_bindings set state='complete',completed_at=clock_timestamp(),staged_result=null,result=v_result where id=b.id;
  update public.worker_jobs set status='done',finished_at=clock_timestamp(),claim_token_hash=null,claim_expires_at=null,
   result=jsonb_build_object('analysis','complete') where id=j.id;
  v_result:=jsonb_build_object('status','complete','purpose',b.purpose);
 end if;
 -- Every genetic read and write rechecks both live authority and the fixed
 -- pre-write claim deadline. Expiry inside a write rolls back its statement.
 if private.path_b_report_authority_v1(b.file_id,b.grant_id,'derived-write-and-read') is distinct from b.authority
  or least(j.claim_expires_at,b.expires_at,(a->>'authorityExpiresAt')::timestamptz,
   (select expires_at from private.path_b_report_bindings where id=b.id))<=clock_timestamp() then
  raise exception using errcode='42501',message='not_found'; end if;
 return v_result;
end;
$$;
revoke all on function private.path_b_report_v1(text,uuid,text,uuid,jsonb,boolean) from public,anon,authenticated,inherit_upload_only,service_role;
create function public.path_b_report_v1(p_operation text,p_job_id uuid,p_claim_hash text,p_claim uuid,p_payload jsonb,p_test_jurisdiction boolean)
returns jsonb language sql security definer set search_path=''
as $$select private.path_b_report_v1(p_operation,p_job_id,p_claim_hash,p_claim,p_payload,p_test_jurisdiction);$$;
revoke all on function public.path_b_report_v1(text,uuid,text,uuid,jsonb,boolean) from public,anon,authenticated,inherit_upload_only;
grant execute on function public.path_b_report_v1(text,uuid,text,uuid,jsonb,boolean) to service_role;

create function private.path_b_report_results_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,p_purpose text,p_test_jurisdiction boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b private.path_b_report_bindings%rowtype; a jsonb; result jsonb:='[]'; v_bindings uuid[]:='{}'; v_id uuid;
begin
 if p_test_jurisdiction is distinct from true then raise exception using errcode='42501',message='not_found'; end if;
 if p_purpose is null or p_purpose not in('reports.monogenic','reports.polygenic') then
  raise exception using errcode='22023',message='invalid_request'; end if;
 perform 1 from auth.sessions x join auth.users u on u.id=x.user_id where x.id=p_session_id and x.user_id=p_account_id
  and(x.not_after is null or x.not_after>clock_timestamp()) and u.deleted_at is null
  and(u.banned_until is null or u.banned_until<=clock_timestamp()) for share of x,u;
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 perform private.lock_invitation_transitions_v1();
 for b in select * from private.path_b_report_bindings where subject_id=p_subject_id and purpose=p_purpose
  and recipient_account_id=p_account_id and state='complete' order by file_id,binding_revision for share
 loop
  begin
   a:=private.path_b_report_authority_v1(b.file_id,b.grant_id,'derived-write-and-read');
   if a is distinct from b.authority then raise exception using errcode='42501',message='not_found'; end if;
   if(a->>'authorityExpiresAt')::timestamptz<=clock_timestamp() then
    raise exception using errcode='42501',message='not_found'; end if;
   result:=result||jsonb_build_array(jsonb_build_object('fileId',b.file_id,'subjectId',b.subject_id,'purpose',b.purpose,
    'completedAt',b.completed_at,'sourceRevision',a->'source'->'sourceRevision','sourceSha256',a->'source'->'decodedSha256',
    'normalizedAt',a->'normalizedAt','computationRevision',b.computation_revision,'result',b.result));
   v_bindings:=array_append(v_bindings,b.id);
  exception when insufficient_privilege then null;
  end;
 end loop;
 if octet_length(result::text)>4000000 then raise exception using errcode='22023',message='invalid_request'; end if;
 foreach v_id in array v_bindings loop
  select * into strict b from private.path_b_report_bindings where id=v_id;
  if private.path_b_report_authority_v1(b.file_id,b.grant_id,'derived-write-and-read') is distinct from b.authority then
   raise exception using errcode='42501',message='not_found'; end if;
 end loop;
 perform 1 from auth.sessions where id=p_session_id and user_id=p_account_id
  and(not_after is null or not_after>clock_timestamp());
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 return result;
end;
$$;
revoke all on function private.path_b_report_results_v1(uuid,uuid,uuid,text,boolean) from public,anon,authenticated,inherit_upload_only,service_role;
create function public.path_b_report_results_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,p_purpose text,p_test_jurisdiction boolean)
returns jsonb language sql security definer set search_path=''
as $$select private.path_b_report_results_v1(p_account_id,p_session_id,p_subject_id,p_purpose,p_test_jurisdiction);$$;
revoke all on function public.path_b_report_results_v1(uuid,uuid,uuid,text,boolean) from public,anon,authenticated,inherit_upload_only;
grant execute on function public.path_b_report_results_v1(uuid,uuid,uuid,text,boolean) to service_role;

create function private.path_b_report_read_ready_v1(p_account_id uuid,p_subject_id uuid,p_purpose text)
returns boolean language plpgsql security definer set search_path='' as $$
declare b private.path_b_report_bindings%rowtype;
begin
 for b in select * from private.path_b_report_bindings where recipient_account_id=p_account_id
  and subject_id=p_subject_id and purpose=p_purpose and state='complete' order by binding_revision desc for share
 loop
  begin
   if private.path_b_report_authority_v1(b.file_id,b.grant_id,'derived-write-and-read')=b.authority then return true; end if;
  exception when insufficient_privilege then null;
  end;
 end loop;
 return false;
end;
$$;
revoke all on function private.path_b_report_read_ready_v1(uuid,uuid,text) from public,anon,authenticated,inherit_upload_only,service_role;
-- Extend the current closed-source gate without overwriting any legal or
-- normalization edits. Only an exact completed per-recipient operation opens.
do $patch$
declare body text:=pg_get_functiondef('private.path_b_result_read_v1(uuid,uuid,text)'::regprocedure);
 old_fragment text:=$old$return jsonb_build_object('allowed',false,'gate','analysis-not-generated');$old$;
 new_fragment text:=$new$if private.path_b_report_read_ready_v1(p_account_id,p_subject_id,p_purpose) then
     return jsonb_build_object('allowed',true,'gate','ready'); end if;
    return jsonb_build_object('allowed',false,'gate','analysis-not-generated');$new$;
begin
 if(length(body)-length(replace(body,old_fragment,'')))/length(old_fragment)<>1 then
  raise exception using errcode='55000',message='path_b_read_gate_body_changed'; end if;
 execute replace(body,old_fragment,new_fragment);
end;
$patch$;
