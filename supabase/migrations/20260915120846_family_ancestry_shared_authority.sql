-- D-123: separate recipient ancestry authority. No owner reader, artifact,
-- historical grant or existing ACL is changed. Prepared sources are withheld.
create table private.family_ancestry_grant_snapshots (
 grant_id uuid primary key references public.purpose_grants(grant_id) on delete cascade,
 endpoints jsonb not null
);
alter table private.family_ancestry_grant_snapshots enable row level security;
revoke all on private.family_ancestry_grant_snapshots from public,anon,authenticated,inherit_upload_only,service_role;

create function private.grant_family_ancestry_purpose_v1(p_account_id uuid,p_session_id uuid,p_data_subject_id uuid,
 p_recipient_principal_id uuid,p_recipient_account_id uuid,p_purpose text,p_artifact_version integer,
 p_artifact_body_sha256 text,p_token_nonce text,p_endpoint_receipt text)
returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare e jsonb; g uuid; old_grant uuid;
begin
 if p_purpose is null or p_purpose <> 'ancestry'
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
  left join private.family_ancestry_grant_snapshots fs on fs.grant_id=pg.grant_id
  where pg.target_kind='subject' and pg.target_id=p_data_subject_id and pg.purpose=p_purpose
   and pg.revoked_at is null and dg.status='current' and dg.direction='subject_to_recipient'
   and dg.recipient_account_id=p_recipient_account_id and fs.endpoints is distinct from e
 loop perform public.revoke_directional_purpose_v1(p_account_id,old_grant); end loop;
 g:=public.grant_directional_purpose_v1(p_account_id,p_data_subject_id,p_recipient_principal_id,p_purpose,
  'consent.share-with-adult',p_artifact_version,p_token_nonce);
 e:=private.family_report_endpoints_v1(p_account_id,p_data_subject_id,p_recipient_account_id);
 insert into private.family_ancestry_grant_snapshots(grant_id,endpoints) values(g,e) on conflict(grant_id) do nothing;
 if not exists(select 1 from private.family_ancestry_grant_snapshots where grant_id=g and endpoints=e) then
  raise exception using errcode='42501',message='not_found'; end if;
 return g;
end; $$;


create function private.family_ancestry_recipient_v1(p_account uuid,p_session uuid,p_subject uuid,p_purpose text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v_owner uuid; e jsonb; session_receipt jsonb; grant_receipt jsonb; v_proven boolean;
begin
 if p_purpose is null or p_purpose <> 'ancestry' then
  raise exception using errcode='42501',message='not_found'; end if;
 session_receipt:=private.family_report_session_v1(p_account,p_session);
 select subject_account_id into v_owner from public.subjects where id=p_subject and subject_class='self';
 -- Historical directional permission keeps its independently supported legacy
 -- semantics. It cannot lend missing age/revision proof to canonical sources.
 select exists(select 1 from public.purpose_grants pg join public.directional_grants dg
  on dg.grant_id=pg.grant_id and dg.grant_revision=pg.grant_revision
  join private.family_ancestry_grant_snapshots fs on fs.grant_id=pg.grant_id
  where pg.target_kind='subject' and pg.target_id=p_subject and pg.purpose=p_purpose
   and pg.revoked_at is null and dg.recipient_account_id=p_account and dg.status='current') into v_proven;
 e:=private.family_report_endpoints_v1(v_owner,p_subject,p_account,v_proven);
 select jsonb_build_object('grantId',pg.grant_id,'grantRevision',pg.grant_revision,'endpoints',e,'session',session_receipt,'legacyOnly',fs.grant_id is null)
 into grant_receipt from public.purpose_grants pg
 join public.directional_grants dg on dg.grant_id=pg.grant_id and dg.grant_revision=pg.grant_revision
 left join private.family_ancestry_grant_snapshots fs on fs.grant_id=pg.grant_id
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


create function private.family_source_ancestry_grant_v1(
  p_account_id uuid, p_subject_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'private'
as $fn$
declare c jsonb; g public.purpose_grants%rowtype; v_key text;
begin

 if p_subject_id is null then raise exception using errcode='42501',message='not_found'; end if;
 -- The counterpart owns this context; the recipient has its own live session.
 c:=private.family_source_report_context_v1(p_account_id,p_subject_id);
 v_key:='consent.own-ancestry';
 select pg.* into g from public.purpose_grants pg
 join public.directional_grants dg on dg.grant_id=pg.grant_id and dg.grant_revision=pg.grant_revision
 join public.consent_artifacts ca on ca.artifact_key=pg.artifact_key and ca.version=pg.artifact_version
  and ca.body_sha256=pg.artifact_body_sha256
 join public.consent_signatures cs on cs.id=pg.signature_id and cs.artifact_key=ca.artifact_key
  and cs.artifact_version=ca.version and cs.artifact_body_sha256=ca.body_sha256
  and cs.signer_principal_id=pg.signer_principal_id and cs.signer_account_id=p_account_id
  and cs.target_kind=pg.target_kind and cs.target_id=pg.target_id and cs.purpose=pg.purpose
 where pg.target_kind='subject' and pg.target_id=p_subject_id and pg.purpose='ancestry'
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
  'subjectId',p_subject_id);
end;
$fn$;


create function private.family_source_ancestry_authority_v1(p_account_id uuid,p_file_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare f public.genome_files%rowtype; c jsonb; g public.purpose_grants%rowtype; v_key text;
begin

 select * into f from public.genome_files where id=p_file_id and user_id=p_account_id;
 if f.id is null or f.single_logical_sample_verified_at is null or f.subject_id is null then
  raise exception using errcode='42501',message='not_found'; end if;
 if exists(select 1 from private.own_prepared_manifests where file_id=f.id)
  or exists(select 1 from private.own_preparation_jobs where file_id=f.id and state<>'frozen') then
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
 v_key:='consent.own-ancestry';
 select pg.* into g from public.purpose_grants pg
 join public.directional_grants dg on dg.grant_id=pg.grant_id and dg.grant_revision=pg.grant_revision
 join public.consent_artifacts ca on ca.artifact_key=pg.artifact_key and ca.version=pg.artifact_version
  and ca.body_sha256=pg.artifact_body_sha256
 join public.consent_signatures cs on cs.id=pg.signature_id and cs.artifact_key=ca.artifact_key
  and cs.artifact_version=ca.version and cs.artifact_body_sha256=ca.body_sha256
  and cs.signer_principal_id=pg.signer_principal_id and cs.signer_account_id=p_account_id
  and cs.target_kind=pg.target_kind and cs.target_id=pg.target_id and cs.purpose=pg.purpose
 where pg.target_kind='subject' and pg.target_id=f.subject_id and pg.purpose='ancestry'
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

create function private.family_ancestry_grant_presentation_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,p_recipient_account_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare e jsonb; old_grant boolean;
begin
 perform private.family_report_session_v1(p_account_id,p_session_id);
 e:=private.family_report_endpoints_v1(p_account_id,p_subject_id,p_recipient_account_id);
 select exists(select 1 from public.purpose_grants pg join public.directional_grants dg
  on dg.grant_id=pg.grant_id and dg.grant_revision=pg.grant_revision
  left join private.family_ancestry_grant_snapshots fs on fs.grant_id=pg.grant_id
  where pg.target_kind='subject' and pg.target_id=p_subject_id and pg.purpose='ancestry'
   and pg.revoked_at is null and (pg.expires_at is null or pg.expires_at>clock_timestamp())
   and dg.status='current' and dg.direction='subject_to_recipient' and dg.recipient_account_id=p_recipient_account_id
   and fs.endpoints is distinct from e) into old_grant;
 return jsonb_build_object('receipt',encode(extensions.digest(convert_to(e::text,'UTF8'),'sha256'),'hex'),'requiresConfirmation',old_grant);
end; $$;

-- Validated display facts only. The raw provenance and identity used to qualify
-- them stay inside the page receipt, never inside component props.
create function private.family_ancestry_input_view_v1(f public.genome_files,p jsonb,legacy boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare snapshot jsonb; finished timestamptz;
begin
 finished:=case when legacy then f.processing_finished_at else f.normalization_completed_at end;
 if p->>'version'='listed-calls-v1' and p->>'sourceSha256'=(case when legacy then f.input_source_sha256 else f.sha256 end)
  and p->>'sourceBuild' in('GRCh37','GRCh38') and p->>'buildBasis' in('source-declared','format-assumption')
  and p->>'targetBuild'='GRCh38' and p->>'sourceSha256'~'^[0-9a-f]{64}$'
  and (not legacy or (f.status='annotated' and (p->>'completedAt')::timestamptz=finished))
  and (legacy or p->>'sourceBuild'=f.build)
  and (p->>'sourceBuild'<>'GRCh37' or coalesce(p->>'chainSha256','')~'^[0-9a-f]{64}$')
  and (p->>'sourceBuild'<>'GRCh38' or p->'chainSha256'='null'::jsonb) then
  snapshot:=jsonb_build_object('sourceBuild',p->'sourceBuild','buildBasis',p->'buildBasis','targetBuild',p->'targetBuild',
   'variantRowsMapped',p->'variantRowsMapped','variantRowsUnmapped',p->'variantRowsUnmapped','counts',p->'counts');
 end if;
 return jsonb_build_object('fileId',f.id,'fileType',f.file_type,'processedAt',finished,'snapshot',snapshot);
exception when invalid_datetime_format or datetime_field_overflow then
 return jsonb_build_object('fileId',f.id,'fileType',f.file_type,'processedAt',finished,'snapshot',null);
end; $$;

create function private.family_shared_ancestry_results_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,
 p_after_file uuid default null,p_mode text default 'content')
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare direction jsonb; owner_grant jsonb; checked jsonb; a jsonb; f public.genome_files%rowtype;
 r private.own_analysis_runs%rowtype; n private.own_normalization_runs%rowtype; legacy_rows jsonb; entry jsonb;
 rows jsonb:='[]'; identities jsonb:='[]'; v_last uuid; v_count integer:=0; file_count integer:=0;
 prepared_unavailable boolean:=false; preparing boolean:=false; page jsonb;
begin
 if p_mode is null or p_mode not in('content','permission') then raise exception using errcode='22023',message='invalid_request'; end if;
 direction:=private.family_ancestry_recipient_v1(p_account_id,p_session_id,p_subject_id,'ancestry');
 if p_mode='content' then
  begin owner_grant:=private.family_source_ancestry_grant_v1((direction#>>'{endpoints,owner,accountId}')::uuid,p_subject_id);
  exception when insufficient_privilege or object_not_in_prerequisite_state then owner_grant:=null; end;
 end if;
 if owner_grant is not null then
  for f in select gf.* from public.genome_files gf where gf.subject_id=p_subject_id
   and gf.user_id=(direction#>>'{endpoints,owner,accountId}')::uuid
   and (direction->>'legacyOnly'='false' or gf.single_logical_sample_verified_at is null)
   and (p_after_file is null or gf.id>p_after_file) order by gf.id limit 100 loop
   v_last:=f.id; v_count:=v_count+1;
   if exists(select 1 from private.genome_file_deletions where file_id=f.id) then continue; end if;
   if f.status is null or f.status not in('uploading','uploaded','parsing','parsed','stored','annotated') then continue; end if;
   -- These private identities also cover absent results and preparation state.
   identities:=identities||jsonb_build_array(to_jsonb(f));
   file_count:=file_count+1;
   if exists(select 1 from private.own_prepared_manifests where file_id=f.id)
    or exists(select 1 from private.own_preparation_jobs where file_id=f.id and state<>'frozen') then
    prepared_unavailable:=true; continue;
   end if;
   if f.single_logical_sample_verified_at is null then
    -- Match the shared file-preparation states. Storage alone is not analysis.
    if f.status<>'annotated' then
     preparing:=preparing or f.status in('uploading','uploaded','parsing','parsed'); continue;
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('kind',ar.kind,'result',ar.result,'support_note',ar.support_note,
     'file_id',ar.file_id,'model_id',ar.model_id,'model_version',ar.model_version,'created_at',ar.created_at)
     order by ar.created_at desc,ar.id),'[]'::jsonb) into legacy_rows from public.ancestry_results ar
     where ar.file_id=f.id and ar.subject_id=p_subject_id and ar.user_id=f.user_id and ar.kind in('admixture','mtdna','ydna');
    if legacy_rows='[]'::jsonb then continue; end if;
    entry:=jsonb_build_object('kind','legacy','fileId',f.id,'rows',legacy_rows,
     'source',private.family_ancestry_input_view_v1(f,f.input_provenance,true));
   else
    begin
     a:=private.family_source_ancestry_authority_v1(f.user_id,f.id);
     if private.own_analysis_completion_matches_v1(f.id,'ancestry',a) is not true then continue; end if;
     select * into r from private.own_analysis_runs where file_id=f.id and purpose='ancestry'
      and account_id=f.user_id and subject_id=p_subject_id and state='complete';
     if r.id is null or r.result-'ancestry'<>'{}'::jsonb then continue; end if;
     perform private.validate_own_ancestry_content_v1(r.result->'ancestry',f.id,p_subject_id,a,r.ancestry_source->>'callEncoding');
     select * into n from private.own_normalization_runs where file_id=f.id and state='complete';
     if n.file_id is null then continue; end if;
     identities:=identities||jsonb_build_array(jsonb_build_object('authority',a,'run',to_jsonb(r),'normalization',to_jsonb(n)));
     entry:=jsonb_build_object('kind','canonical','fileId',f.id,'completedAt',r.completed_at,'content',r.result->'ancestry',
      'source',private.family_ancestry_input_view_v1(f,n.provenance,false));
    exception when insufficient_privilege or object_not_in_prerequisite_state or invalid_text_representation or invalid_parameter_value then
     preparing:=preparing or f.normalization_completed_at is null; continue;
    end;
   end if;
   rows:=rows||jsonb_build_array(entry);
  end loop;
  begin checked:=private.family_source_ancestry_grant_v1((direction#>>'{endpoints,owner,accountId}')::uuid,p_subject_id);
  exception when insufficient_privilege or object_not_in_prerequisite_state then checked:=null; end;
  if checked is distinct from owner_grant then raise exception using errcode='42501',message='not_found'; end if;
 end if;
 if private.family_ancestry_recipient_v1(p_account_id,p_session_id,p_subject_id,'ancestry') is distinct from direction then
  raise exception using errcode='42501',message='not_found'; end if;
 page:=jsonb_build_object('authority',encode(extensions.digest(convert_to(jsonb_build_object('recipient',direction,'owner',owner_grant)::text,'UTF8'),'sha256'),'hex'),
  'ownerAccountId',direction#>>'{endpoints,owner,accountId}','subjectId',p_subject_id,'legacyOnly',(direction->>'legacyOnly')::boolean,
  'sources',rows,'fileCount',file_count,'preparing',preparing,'preparedUnavailable',prepared_unavailable,
  'nextAfter',case when v_count=100 then v_last else null end);
 return page||jsonb_build_object('pageReceipt',encode(extensions.digest(convert_to(jsonb_build_object('page',page,'identities',identities)::text,'UTF8'),'sha256'),'hex'));
end; $$;

create function private.confirm_family_shared_ancestry_results_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,p_mode text,p_expected jsonb)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare owner_id uuid; item jsonb; actual jsonb; next_file uuid; first_page boolean:=true;
begin
 if p_mode is null or p_mode not in('content','permission') or jsonb_typeof(p_expected) is distinct from 'array'
  or jsonb_array_length(p_expected) not between 1 and 1000 then return false; end if;
 select subject_account_id into owner_id from public.subjects where id=p_subject_id;
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
 perform 1 from private.family_ancestry_grant_snapshots where grant_id in(select grant_id from public.purpose_grants where target_kind='subject' and target_id=p_subject_id) order by grant_id for share nowait;
 perform 1 from public.consent_signatures where target_kind='subject' and target_id=p_subject_id order by id for share nowait;
 perform 1 from public.consent_artifacts where artifact_key in('disclosure.insurance-and-discrimination','consent.upload-self',
  'consent.own-ancestry','consent.share-with-adult') order by artifact_key,version for share nowait;
 perform 1 from public.subject_consents where subject_id=p_subject_id order by id for share nowait;
 perform 1 from public.genome_storage_objects where genome_file_id in(select id from public.genome_files where subject_id=p_subject_id) order by object_id for share nowait;
 perform 1 from storage.objects where id in(select storage_object_id from public.genome_files where subject_id=p_subject_id) order by id for share nowait;
 perform 1 from private.own_normalization_runs where file_id in(select id from public.genome_files where subject_id=p_subject_id) order by file_id for share nowait;
 perform 1 from private.own_analysis_runs where subject_id=p_subject_id order by id for share nowait;

 perform 1 from public.ancestry_results where subject_id=p_subject_id order by id for share nowait;
 perform 1 from private.own_preparation_jobs where subject_id=p_subject_id order by id for share nowait;
 perform 1 from private.own_prepared_manifests where file_id in(select id from public.genome_files where subject_id=p_subject_id) order by id for share nowait;
 for item in select value from jsonb_array_elements(p_expected) loop
  if jsonb_typeof(item) is distinct from 'object' or item-array['afterFile','receipt']<>'{}'::jsonb
   or not(item ?& array['afterFile','receipt']) or coalesce(item->>'receipt','')!~'^[0-9a-f]{64}$' then return false; end if;
  if first_page then
   if item->'afterFile' is distinct from 'null'::jsonb then return false; end if;
  elsif next_file is null or (item->>'afterFile')::uuid is distinct from next_file then return false; end if;
  actual:=private.family_shared_ancestry_results_v1(p_account_id,p_session_id,p_subject_id,(item->>'afterFile')::uuid,p_mode);
  if actual->>'pageReceipt' is distinct from item->>'receipt' then return false; end if;
  first_page:=false; next_file:=(actual->>'nextAfter')::uuid;
 end loop;
 return next_file is null;
exception when lock_not_available or insufficient_privilege or object_not_in_prerequisite_state or invalid_text_representation then return false;
end; $$;

create function public.family_ancestry_grant_presentation_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,p_recipient_account_id uuid) returns jsonb language sql security invoker set search_path=pg_catalog as $$ select private.family_ancestry_grant_presentation_v1(p_account_id,p_session_id,p_subject_id,p_recipient_account_id); $$;
revoke all on function private.family_ancestry_grant_presentation_v1(uuid,uuid,uuid,uuid) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.family_ancestry_grant_presentation_v1(uuid,uuid,uuid,uuid) to service_role;
revoke all on function public.family_ancestry_grant_presentation_v1(uuid,uuid,uuid,uuid) from public,anon,authenticated,inherit_upload_only;
grant execute on function public.family_ancestry_grant_presentation_v1(uuid,uuid,uuid,uuid) to service_role;

create function public.grant_family_ancestry_purpose_v1(p_account_id uuid,p_session_id uuid,p_data_subject_id uuid,p_recipient_principal_id uuid,p_recipient_account_id uuid,p_purpose text,p_artifact_version integer,p_artifact_body_sha256 text,p_token_nonce text,p_endpoint_receipt text) returns uuid language sql security invoker set search_path=pg_catalog as $$ select private.grant_family_ancestry_purpose_v1(p_account_id,p_session_id,p_data_subject_id,p_recipient_principal_id,p_recipient_account_id,p_purpose,p_artifact_version,p_artifact_body_sha256,p_token_nonce,p_endpoint_receipt); $$;
revoke all on function private.grant_family_ancestry_purpose_v1(uuid,uuid,uuid,uuid,uuid,text,integer,text,text,text) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.grant_family_ancestry_purpose_v1(uuid,uuid,uuid,uuid,uuid,text,integer,text,text,text) to service_role;
revoke all on function public.grant_family_ancestry_purpose_v1(uuid,uuid,uuid,uuid,uuid,text,integer,text,text,text) from public,anon,authenticated,inherit_upload_only;
grant execute on function public.grant_family_ancestry_purpose_v1(uuid,uuid,uuid,uuid,uuid,text,integer,text,text,text) to service_role;

create function public.family_shared_ancestry_results_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,p_after_file uuid default null,p_mode text default 'content') returns jsonb language sql security invoker set search_path=pg_catalog as $$ select private.family_shared_ancestry_results_v1(p_account_id,p_session_id,p_subject_id,p_after_file,p_mode); $$;
revoke all on function private.family_shared_ancestry_results_v1(uuid,uuid,uuid,uuid,text) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.family_shared_ancestry_results_v1(uuid,uuid,uuid,uuid,text) to service_role;
revoke all on function public.family_shared_ancestry_results_v1(uuid,uuid,uuid,uuid,text) from public,anon,authenticated,inherit_upload_only;
grant execute on function public.family_shared_ancestry_results_v1(uuid,uuid,uuid,uuid,text) to service_role;

create function public.confirm_family_shared_ancestry_results_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,p_mode text,p_expected jsonb) returns boolean language sql security invoker set search_path=pg_catalog as $$ select private.confirm_family_shared_ancestry_results_v1(p_account_id,p_session_id,p_subject_id,p_mode,p_expected); $$;
revoke all on function private.confirm_family_shared_ancestry_results_v1(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.confirm_family_shared_ancestry_results_v1(uuid,uuid,uuid,text,jsonb) to service_role;
revoke all on function public.confirm_family_shared_ancestry_results_v1(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,inherit_upload_only;
grant execute on function public.confirm_family_shared_ancestry_results_v1(uuid,uuid,uuid,text,jsonb) to service_role;
revoke all on function private.family_ancestry_recipient_v1(uuid,uuid,uuid,text) from public,anon,authenticated,inherit_upload_only,service_role;
revoke all on function private.family_source_ancestry_grant_v1(uuid,uuid) from public,anon,authenticated,inherit_upload_only,service_role;
revoke all on function private.family_source_ancestry_authority_v1(uuid,uuid) from public,anon,authenticated,inherit_upload_only,service_role;
revoke all on function private.family_ancestry_input_view_v1(public.genome_files,jsonb,boolean) from public,anon,authenticated,inherit_upload_only,service_role;

-- Operational proof is a child of the registered purpose-grant lifecycle, not
-- retained consent evidence. Terminal grants keep their signed history, while
-- this copied endpoint JSON loses its purpose and is removed in that same write.
-- A pause changes no grant row and therefore preserves proof for later resume.
create function private.clear_family_ancestry_snapshot_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
 delete from private.family_ancestry_grant_snapshots where grant_id=old.grant_id;
 if tg_op='DELETE' then return old; end if;
 return new;
end; $$;
revoke all on function private.clear_family_ancestry_snapshot_v1()
 from public,anon,authenticated,inherit_upload_only,service_role;

create trigger clear_family_ancestry_snapshot_on_purpose_change
 after update of revoked_at,grant_revision on public.purpose_grants
 for each row when (new.revoked_at is not null or new.grant_revision is distinct from old.grant_revision)
 execute function private.clear_family_ancestry_snapshot_v1();
create trigger clear_family_ancestry_snapshot_on_direction_change
 after update of status,grant_revision on public.directional_grants
 for each row when (new.status is distinct from 'current' or new.grant_revision is distinct from old.grant_revision)
 execute function private.clear_family_ancestry_snapshot_v1();
create trigger clear_family_ancestry_snapshot_on_direction_delete
 after delete on public.directional_grants
 for each row execute function private.clear_family_ancestry_snapshot_v1();
-- Purpose-grant deletion already deletes this exact child through its FK.
comment on table private.family_ancestry_grant_snapshots is
 'Operational child of public.purpose_grants: subject-bound-authority-and-lifecycle-terminalization. Remove on revocation, revision change, direction terminalization/deletion, or parent deletion; pause preserves proof. Not retained signed evidence or an export of counterpart endpoint identifiers. Time-only expiry denies reads but awaits a terminal transition or parent deletion for cleanup.';
