-- Metadata-only Portrait prerequisite. No clinical computation or result is
-- created, and historical grants are never upgraded implicitly.
create table private.family_portrait_grant_snapshots (
 grant_id uuid primary key references public.purpose_grants(grant_id) on delete cascade,
 endpoints jsonb not null check(jsonb_typeof(endpoints)='object'),
 pair_id uuid not null,
 pair_revision bigint not null check(pair_revision>0)
);
revoke all on private.family_portrait_grant_snapshots from public,anon,authenticated,inherit_upload_only,service_role;

create function private.family_portrait_endpoints_v1(p_account uuid,p_subject uuid,p_recipient uuid,p_require_adult boolean default true)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare a jsonb; b jsonb;
begin
 if p_account is null or p_recipient is null or p_account=p_recipient then raise exception using errcode='42501',message='not_found'; end if;
 a:=private.family_report_endpoint_v1(p_account,p_subject,p_require_adult);
 b:=private.family_report_endpoint_v1(p_recipient,null,p_require_adult);
 if private.family_sharing_paused_v1(p_account,p_recipient) is not false then raise exception using errcode='42501',message='not_found'; end if;
 return jsonb_build_object('owner',a,'recipient',b);
end; $$;

create function public.family_portrait_grant_presentation_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,p_recipient_account_id uuid)
returns text language plpgsql security definer set search_path=pg_catalog as $$
declare e jsonb; p jsonb;
begin
 perform private.family_report_session_v1(p_account_id,p_session_id);
 e:=private.family_portrait_endpoints_v1(p_account_id,p_subject_id,p_recipient_account_id);
 select jsonb_build_object('id',id,'revision',pair_revision,'status',status) into p from public.family_pairs
 where subject_low_id=least(p_subject_id,(e#>>'{recipient,subjectId}')::uuid)
 and subject_high_id=greatest(p_subject_id,(e#>>'{recipient,subjectId}')::uuid);
 return encode(extensions.digest(convert_to(jsonb_build_object('endpoints',e,'pair',p)::text,'UTF8'),'sha256'),'hex');
end; $$;

create function public.grant_family_portrait_purpose_v1(p_account_id uuid,p_session_id uuid,p_data_subject_id uuid,
 p_recipient_principal_id uuid,p_recipient_account_id uuid,p_purpose text,p_artifact_version integer,
 p_artifact_body_sha256 text,p_token_nonce text,p_endpoint_receipt text)
returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare e jsonb; g uuid; old_grant uuid; d public.directional_grants%rowtype;
begin
 if p_purpose is distinct from 'family.portrait' or p_endpoint_receipt is null or p_endpoint_receipt!~'^[0-9a-f]{64}$' then
 raise exception using errcode='22023',message='invalid_request'; end if;
 perform 1 from auth.users where id in(p_account_id,p_recipient_account_id) order by id for share;
 perform 1 from public.profiles where id in(p_account_id,p_recipient_account_id) order by id for update;
 perform 1 from public.subjects where subject_account_id in(p_account_id,p_recipient_account_id) order by id for update;
 perform 1 from public.subject_account_bindings where account_id in(p_account_id,p_recipient_account_id) order by id for share;
 perform 1 from public.subject_principals where account_id in(p_account_id,p_recipient_account_id) order by id for share;
 perform 1 from auth.sessions where user_id=p_account_id and id=p_session_id for share;
 e:=private.family_portrait_endpoints_v1(p_account_id,p_data_subject_id,p_recipient_account_id);
 perform 1 from public.family_pairs where subject_low_id=least(p_data_subject_id,(e#>>'{recipient,subjectId}')::uuid)
 and subject_high_id=greatest(p_data_subject_id,(e#>>'{recipient,subjectId}')::uuid) for update;
 if public.family_portrait_grant_presentation_v1(p_account_id,p_session_id,p_data_subject_id,p_recipient_account_id) is distinct from p_endpoint_receipt
 or e#>>'{recipient,principalId}' is distinct from p_recipient_principal_id::text then raise exception using errcode='42501',message='not_found'; end if;
 perform 1 from public.consent_artifacts where artifact_key='consent.share-with-adult' and version=p_artifact_version
 and body_sha256=p_artifact_body_sha256 and body_sha256=encode(extensions.digest(convert_to(body_markdown,'UTF8'),'sha256'),'hex')
 and superseded_at is null and published_at<=clock_timestamp() and effective_on<=timezone('UTC',clock_timestamp())::date for share;
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 -- A historical grant needs a fresh explicit signature, never a backfill. The
 -- existing revoker closes the old pair and any outputs before replacement.
 for old_grant in select pg.grant_id from public.purpose_grants pg join public.directional_grants dg
 on dg.grant_id=pg.grant_id and dg.grant_revision=pg.grant_revision
 left join private.family_portrait_grant_snapshots fs on fs.grant_id=pg.grant_id
 where pg.target_kind='subject' and pg.target_id=p_data_subject_id and pg.purpose='family.portrait'
 and pg.revoked_at is null and dg.status='current' and dg.direction='subject_to_recipient'
 and dg.recipient_account_id=p_recipient_account_id and fs.endpoints is distinct from e
 loop perform public.revoke_directional_purpose_v1(p_account_id,old_grant); end loop;
 g:=public.grant_directional_purpose_v1(p_account_id,p_data_subject_id,p_recipient_principal_id,'family.portrait',
 'consent.share-with-adult',p_artifact_version,p_token_nonce);
 select * into strict d from public.directional_grants where grant_id=g;
 insert into private.family_portrait_grant_snapshots(grant_id,endpoints,pair_id,pair_revision)
 values(g,e,d.pair_id,d.relationship_or_pair_revision) on conflict(grant_id) do nothing;
 if not exists(select 1 from private.family_portrait_grant_snapshots where grant_id=g and endpoints=e
 and pair_id=d.pair_id and pair_revision=d.relationship_or_pair_revision) then raise exception using errcode='42501',message='not_found'; end if;
 return g;
end; $$;

-- These are only file/source/normalization metadata; no observed-call, variant,
-- score, clinical-reference, ROH, or analysis-result table is read.
create function private.family_portrait_prepared_source_v1(p_account uuid,p_subject uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare c jsonb; f public.genome_files%rowtype; n private.own_normalization_runs%rowtype;
begin
 if not exists(select 1 from public.genome_files where subject_id=p_subject and
  (single_logical_sample_verified_at is not null or structural_validator_version is not null or source_sha256 is not null)) then
 return jsonb_build_object('source',null,'store',null); end if;
 c:=private.family_source_store_v1(p_account,p_subject);
 for f in select * from public.genome_files where subject_id=p_subject and user_id=p_account
 and single_logical_sample_verified_at is not null and structural_validator_version='single-logical-sample-v1'
 and tier=1 and status in('stored','annotated') and build in('GRCh37','GRCh38')
 and normalization_completed_at is not null and normalization_source_revision=upload_revision order by id
 loop
  select nr.* into n from private.own_normalization_runs nr
  join public.genome_storage_objects o on o.genome_file_id=f.id join storage.objects so on so.id=o.object_id
  where nr.file_id=f.id and nr.account_id=p_account and nr.state='complete'
  and nr.manifest->>'rawSha256'=f.sha256 and nr.manifest->>'decodedSha256'=f.source_sha256
  and (nr.manifest->>'sourceRevision')::bigint=f.upload_revision
  and nr.manifest->>'objectId'=f.storage_object_id::text and nr.manifest->>'objectKey'=f.bucket_path
  and o.object_id=f.storage_object_id and o.object_name=f.bucket_path and o.bucket_id='genomes'
  and o.sha256=f.sha256 and o.byte_count=f.size_bytes and o.object_revision=f.upload_revision
  and o.state='current' and o.revoked_at is null and so.bucket_id=o.bucket_id and so.name=o.object_name
  and (so.metadata->>'size')::numeric=f.size_bytes;
  if found then return jsonb_build_object('store',c,'source',jsonb_build_object('fileId',f.id,'revision',f.upload_revision,
   'rawSha256',f.sha256,'decodedSha256',f.source_sha256,'normalizedAt',f.normalization_completed_at,'manifest',n.manifest)); end if;
 end loop;
 return jsonb_build_object('source',null,'store',c);
end; $$;

create function public.family_portrait_source_readiness_v1(p_account_id uuid,p_session_id uuid,p_pair_id uuid,p_counterpart_account_id uuid,p_expected text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare p public.family_pairs%rowtype; a public.subjects%rowtype; b public.subjects%rowtype;
 initial_pair jsonb; initial_accounts uuid[]; session_receipt jsonb; v_endpoints jsonb; g jsonb; grants jsonb:='[]'; strong boolean:=true;
 owner_id uuid; recipient_id uuid; v_subject_id uuid; proof jsonb; sa jsonb; sb jsonb; legacy_a jsonb; legacy_b jsonb; receipt text;
begin
 select * into p from public.family_pairs where id=p_pair_id;
 if p.id is null or p.status is distinct from 'current' then return null; end if;
 select * into a from public.subjects where id=p.subject_a_id;
 select * into b from public.subjects where id=p.subject_b_id;
 if a.subject_account_id is null or b.subject_account_id is null or a.subject_account_id=b.subject_account_id
 or p_account_id is null or p_counterpart_account_id is null
 or (case when a.subject_account_id=p_account_id then b.subject_account_id when b.subject_account_id=p_account_id then a.subject_account_id end) is distinct from p_counterpart_account_id then return null; end if;
 initial_pair:=to_jsonb(p); initial_accounts:=array[a.subject_account_id,b.subject_account_id];
 -- One transaction retains both sides through serialization. Contention refuses
 -- rather than introducing a lock-order cycle with the older grant-first revoker.
 perform 1 from auth.users where id in(a.subject_account_id,b.subject_account_id) order by id for share nowait;
 perform 1 from public.profiles where id in(a.subject_account_id,b.subject_account_id) order by id for share nowait;
 perform 1 from auth.sessions where id=p_session_id and user_id=p_account_id for share nowait;
 perform 1 from public.subjects where id in(a.id,b.id) order by id for share nowait;
 perform 1 from public.subject_account_bindings where subject_id in(a.id,b.id) order by id for share nowait;
 perform 1 from public.subject_principals where account_id in(a.subject_account_id,b.subject_account_id) order by id for share nowait;
 perform 1 from public.family_pairs where id=p_pair_id for share nowait;
 perform 1 from public.purpose_grants where target_kind='subject' and target_id in(a.id,b.id) order by grant_id for share nowait;
 perform 1 from public.directional_grants where pair_id=p.id order by grant_id for share nowait;
 perform 1 from public.consent_signatures where target_kind='subject' and target_id in(a.id,b.id) order by id for share nowait;
 perform 1 from public.consent_artifacts where artifact_key in('consent.share-with-adult','consent.upload-self','disclosure.insurance-and-discrimination') order by artifact_key,version for share nowait;
 perform 1 from public.subject_consents where subject_id in(a.id,b.id) order by id for share nowait;
 perform 1 from public.genome_files where subject_id in(a.id,b.id) order by id for share nowait;
 perform 1 from public.genome_storage_objects where genome_file_id in(select id from public.genome_files where subject_id in(a.id,b.id)) order by object_id for share nowait;
 perform 1 from storage.objects where id in(select storage_object_id from public.genome_files where subject_id in(a.id,b.id)) order by id for share nowait;
 perform 1 from private.own_normalization_runs where file_id in(select id from public.genome_files where subject_id in(a.id,b.id)) order by file_id for share nowait;
 select * into p from public.family_pairs where id=p_pair_id;
 select * into a from public.subjects where id=p.subject_a_id;
 select * into b from public.subjects where id=p.subject_b_id;
 if to_jsonb(p) is distinct from initial_pair or array[a.subject_account_id,b.subject_account_id] is distinct from initial_accounts
 or p_account_id is null or p_account_id not in(a.subject_account_id,b.subject_account_id)
 or p.status is distinct from 'current' or a.portrait_acknowledged_at is null or b.portrait_acknowledged_at is null
 or a.independent_login_at is null or b.independent_login_at is null then return null; end if;
 session_receipt:=private.family_report_session_v1(p_account_id,p_session_id);
 for owner_id,recipient_id,v_subject_id in select a.subject_account_id,b.subject_account_id,a.id union all select b.subject_account_id,a.subject_account_id,b.id
 loop
  v_endpoints:=private.family_portrait_endpoints_v1(owner_id,v_subject_id,recipient_id,false);
  select jsonb_build_object('id',pg.grant_id,'revision',pg.grant_revision,'endpoints',v_endpoints,
   'strong',fs.grant_id is not null) into g
  from public.purpose_grants pg join public.directional_grants dg on dg.grant_id=pg.grant_id and dg.grant_revision=pg.grant_revision
  join public.consent_signatures cs on cs.id=pg.signature_id
  join public.consent_artifacts ca on ca.artifact_key=pg.artifact_key and ca.version=pg.artifact_version
  left join private.family_portrait_grant_snapshots fs on fs.grant_id=pg.grant_id
  where pg.target_kind='subject' and pg.target_id=v_subject_id and pg.purpose='family.portrait'
  and pg.signer_principal_id=(v_endpoints#>>'{owner,principalId}')::uuid and pg.data_subject_principal_id=pg.signer_principal_id
  and pg.subject_binding_revision=(v_endpoints#>>'{owner,subjectBindingRevision}')::bigint
  and pg.jurisdiction_revision=(v_endpoints#>>'{owner,jurisdictionRevision}')::bigint
  and pg.revoked_at is null and (pg.expires_at is null or pg.expires_at>clock_timestamp())
  and dg.status='current' and dg.direction='subject_to_recipient' and dg.recipient_account_id=recipient_id
  and dg.recipient_principal_id=(v_endpoints#>>'{recipient,principalId}')::uuid and dg.relationship_id is null
  and dg.pair_id=p.id and dg.relationship_or_pair_revision=p.pair_revision
  and cs.signer_account_id=owner_id and cs.signer_principal_id=pg.signer_principal_id
  and cs.target_kind='subject' and cs.target_id=v_subject_id and cs.purpose=pg.purpose
  and cs.artifact_key=pg.artifact_key and cs.artifact_version=pg.artifact_version and cs.artifact_body_sha256=pg.artifact_body_sha256
  and cs.subject_binding_revision=pg.subject_binding_revision and cs.jurisdiction_revision=pg.jurisdiction_revision
  and ca.body_sha256=pg.artifact_body_sha256 and ca.body_sha256=encode(extensions.digest(convert_to(ca.body_markdown,'UTF8'),'sha256'),'hex')
  and ca.superseded_at is null and ca.published_at<=clock_timestamp() and ca.effective_on<=timezone('UTC',clock_timestamp())::date
  and (fs.grant_id is null or (fs.endpoints=v_endpoints and fs.pair_id=p.id and fs.pair_revision=p.pair_revision));
  if g is null then return null; end if;
  if (g->>'strong')::boolean then perform private.family_portrait_endpoints_v1(owner_id,v_subject_id,recipient_id,true);
  else strong:=false; end if;
  grants:=grants||jsonb_build_array(g);
 end loop;
 if strong then
  sa:=private.family_portrait_prepared_source_v1(a.subject_account_id,a.id);
  sb:=private.family_portrait_prepared_source_v1(b.subject_account_id,b.id);
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'sha256',sha256,'revision',upload_revision) order by id),'[]') into legacy_a
 from public.genome_files where subject_id=a.id and status='annotated' and single_logical_sample_verified_at is null
 and structural_validator_version is null and source_sha256 is null;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'sha256',sha256,'revision',upload_revision) order by id),'[]') into legacy_b
 from public.genome_files where subject_id=b.id and status='annotated' and single_logical_sample_verified_at is null
 and structural_validator_version is null and source_sha256 is null;
 proof:=jsonb_build_object('legacyA',legacy_a,'legacyB',legacy_b,'session',session_receipt,'pair',to_jsonb(p),'grants',grants,'a',sa,'b',sb,
  'acknowledgments',jsonb_build_array(a.portrait_acknowledged_at,b.portrait_acknowledged_at),
  'independentLogins',jsonb_build_array(a.independent_login_at,b.independent_login_at));
 receipt:=encode(extensions.digest(convert_to(proof::text,'UTF8'),'sha256'),'hex');
 if p_expected is not null and p_expected is distinct from receipt then return null; end if;
 return jsonb_build_object('kind',case when strong then 'canonical' else 'legacy-only' end,'receipt',receipt,
  'a',jsonb_build_object('subjectId',a.id,'legacyFileIds',jsonb_path_query_array(legacy_a,'$[*].id'),'hasLegacySource',jsonb_array_length(legacy_a)>0,'hasPreparedSource',coalesce(sa->'source'<>'null'::jsonb,false)),
  'b',jsonb_build_object('subjectId',b.id,'legacyFileIds',jsonb_path_query_array(legacy_b,'$[*].id'),'hasLegacySource',jsonb_array_length(legacy_b)>0,'hasPreparedSource',coalesce(sb->'source'<>'null'::jsonb,false)));
exception when lock_not_available or insufficient_privilege or object_not_in_prerequisite_state or invalid_text_representation then return null;
end; $$;
revoke all on function private.family_portrait_endpoints_v1(uuid,uuid,uuid,boolean),private.family_portrait_prepared_source_v1(uuid,uuid)
 from public,anon,authenticated,inherit_upload_only,service_role;
revoke all on function public.family_portrait_grant_presentation_v1(uuid,uuid,uuid,uuid),
 public.grant_family_portrait_purpose_v1(uuid,uuid,uuid,uuid,uuid,text,integer,text,text,text),
 public.family_portrait_source_readiness_v1(uuid,uuid,uuid,uuid,text) from public,anon,authenticated,inherit_upload_only;
grant execute on function public.family_portrait_grant_presentation_v1(uuid,uuid,uuid,uuid),
 public.grant_family_portrait_purpose_v1(uuid,uuid,uuid,uuid,uuid,text,integer,text,text,text),
 public.family_portrait_source_readiness_v1(uuid,uuid,uuid,uuid,text) to service_role;
