-- Narrow bound own-source consumer for an actual account-origin subject archive.
-- No whole-account projector, public activation, delivery/READY or new stores.
create function private.future_person_archive_account_actor_v1(p_account uuid,p_session uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog set lock_timeout='250ms' as $$
declare p public.profiles; sr bigint;
begin
 perform private.own_export_source_v1(p_account,p_session,null);
 perform private.validate_sensitive_account_session_v1(p_account,p_session);
 select * into p from public.profiles where id=p_account and deletion_requested_at is null for share;
 select coalesce(refresh_token_counter,0)+1 into sr from auth.sessions where id=p_session and user_id=p_account for share;
 if p.id is null or sr is null then return null;end if;
 return jsonb_build_object('accountId',p_account,'sessionId',p_session,
  'account_auth_session_revision',p.auth_session_revision,'session_revision',sr);
exception when insufficient_privilege or invalid_text_representation then return null;
end $$;
revoke all on function private.future_person_archive_account_actor_v1(uuid,uuid)
 from public,anon,authenticated,inherit_upload_only,service_role;

create function private.future_person_bound_source_for_actor_v1(p_subject uuid,p_expires timestamptz,p_actor jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog set lock_timeout='250ms' as $$
declare actor jsonb:=p_actor; b private.future_person_account_bindings; x private.embryo_canonical_sources;
 parts uuid[]; projected jsonb; n integer; total bigint;
begin
 if not exists(select 1 from private.future_person_binding_config where singleton and enabled)
  or p_expires<=clock_timestamp() or p_expires>clock_timestamp()+interval '30 seconds' then return null;end if;
 if actor is null then return null;end if;
 -- The own relationship is resolved before private custody, source or keys.
 perform 1 from public.subjects s where s.id=p_subject and s.lifecycle='claimed_bound'
  and s.subject_class='embryo' and s.owner_account_id=(actor->>'accountId')::uuid
  and s.subject_account_id=s.owner_account_id for share;
 if not found then return null;end if;
 select * into b from private.future_person_account_bindings where subject_id=p_subject
  and account_id=(actor->>'accountId')::uuid for share;
 if b.id is null then return null;end if;
 select cs.* into x from private.embryo_canonical_sources cs
  join private.future_person_custody_slices c on c.subject_id=cs.subject_id and c.source_file_id=cs.file_id
   and c.claimant_principal_id=b.claimant_principal_id and c.source_sha256=cs.source_sha256
   and c.source_membership_sha256=cs.membership_sha256 and c.publication_revision=cs.publication_revision
  join public.genome_files f on f.id=cs.file_id and f.subject_id=cs.subject_id and f.user_id=b.account_id
   and f.cohort_id is null and not f.is_cohort_file and f.status='stored'
   and f.source_publication_state='published' and f.source_publication_revision=cs.publication_revision
   and f.source_sha256=cs.source_sha256
  where cs.subject_id=p_subject and cs.call_immutability_proof='exact-staged-calls-v1' for share of cs,c,f;
 if x.file_id is null or (select count(*) from public.genome_files where subject_id=p_subject)<>1 then return null;end if;
 select array_agg(m.part_id order by m.sequence) into parts from private.embryo_canonical_source_parts m where m.file_id=x.file_id;
 if cardinality(parts) is distinct from x.part_count
  or private.embryo_canonical_source_sha256_v1(x.file_id) is distinct from x.source_sha256
  or private.embryo_canonical_membership_sha256_v1(parts) is distinct from x.membership_sha256 then return null;end if;
 -- Every part must have a committed full-byte swap AND its old disposition ACK.
 -- Pending, failed, legacy and partially moved sources have no readable fallback.
 select count(*),sum(p.byte_count),jsonb_agg(jsonb_build_object('sequence',m.sequence,'partId',p.id,
  'target',private.future_person_relocation_target_v1(a.id,p_expires),
  'identity',jsonb_build_object('providerVersion',a.provider_version,'etag',a.provider_etag,'byteCount',a.observed_bytes)) order by m.sequence)
  into n,total,projected from private.embryo_canonical_source_parts m
  join private.embryo_canonical_parts p on p.id=m.part_id and p.sequence=m.sequence and p.state='landed'
   and p.observed_sha256=p.sha256
  join private.future_person_object_relocations r on r.part_id=p.id and r.source_file_id=m.file_id
   and r.binding_id=b.id and r.state='complete' and private.future_person_relocation_current_v1(r.id)
  join private.future_person_relocation_attempts a on a.relocation_id=r.id and a.state='complete'
   and a.new_key=r.new_key and a.provider_version=r.new_version and a.provider_etag=r.new_etag
   and a.observed_bytes=r.expected_bytes and a.observed_sha256=r.expected_sha256
   and a.disposal_evidence->>'disposition'='payload-tombstoned'
   and a.disposal_evidence->>'etag'='d41d8cd98f00b204e9800998ecf8427e'
   and a.disposal_evidence->'byteCount'='0'::jsonb
   and a.disposal_evidence->>'sha256'='e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  cross join lateral (select private.future_person_canonical_part_location_v1(p.id) value) location
  where m.file_id=x.file_id and location.value->>'bucket'=r.new_bucket
   and location.value->>'objectKey'=a.new_key and location.value->>'providerVersion'=a.provider_version
   and location.value->>'etag'=a.provider_etag and location.value->>'sha256'=p.sha256
   and location.value->'byteCount'=to_jsonb(p.byte_count);
 if n<>x.part_count or total<>x.byte_count or projected is null
  or exists(select 1 from jsonb_array_elements(projected) with ordinality v(value,ordinal)
   where v.value->'target'='null'::jsonb or (v.value->>'sequence')::integer<>v.ordinal-1) then return null;end if;
 return jsonb_build_object('version','bound-future-person-canonical-source-v1','purpose','approved-future-person-export-v1',
  'actor',jsonb_build_object('accountId',actor->'accountId','sessionId',actor->'sessionId',
   'accountAuthSessionRevision',actor->'account_auth_session_revision','sessionRevision',actor->'session_revision'),
  'bindingId',b.id,'claimId',b.claim_id,'claimantPrincipalId',b.claimant_principal_id,
  'claimantRevision',b.claimant_revision,'releaseRevision',b.release_revision,'principalRevision',b.principal_revision,
  'subjectId',b.subject_id,'subjectBindingRevision',b.subject_binding_revision,'subjectLifecycleRevision',b.subject_lifecycle_revision,
  'fileId',x.file_id,'sourceSha256',x.source_sha256,'membershipSha256',x.membership_sha256,
  'publicationRevision',x.publication_revision,'byteCount',x.byte_count,'partCount',x.part_count,
  'expiresAt',p_expires,'parts',projected);
exception when insufficient_privilege or invalid_text_representation or invalid_datetime_format or numeric_value_out_of_range then return null;
end $$;
revoke all on function private.future_person_bound_source_for_actor_v1(uuid,timestamptz,jsonb)
 from public,anon,authenticated,inherit_upload_only,service_role;

create or replace function private.future_person_bound_source_manifest_v1(p_subject uuid,p_expires timestamptz)
returns jsonb language plpgsql security definer set search_path=pg_catalog set lock_timeout='250ms' as $$
begin
 return private.future_person_bound_source_for_actor_v1(p_subject,p_expires,private.future_person_binding_account_v1());
end $$;

create function private.future_person_bound_archive_frame_v1(p_source jsonb)
returns jsonb language sql immutable security definer set search_path=pg_catalog as $$
 select (p_source-'expiresAt'-'parts')||jsonb_build_object('parts',(select jsonb_agg(
  (v.value-'target')||jsonb_build_object('target',(v.value->'target')-'expiresAt') order by v.ordinal)
  from jsonb_array_elements(p_source->'parts') with ordinality v(value,ordinal)));
$$;
revoke all on function private.future_person_bound_archive_frame_v1(jsonb)
 from public,anon,authenticated,inherit_upload_only,service_role;

-- Preserve the ordinary account graph implementation intact. Only the exact
-- owned claimed-bound subject target gets this closed separate projection.
alter function private.export_archive_account_authority_v1(jsonb,text,uuid)
 rename to export_archive_ordinary_account_authority_v1;
create function private.export_archive_account_authority_v1(p_origin jsonb,p_target_kind text,p_target_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog set lock_timeout='250ms' as $$
declare actor jsonb; base jsonb; source jsonb; own_self uuid; s public.subjects; a uuid; sess uuid; receipt text;
begin
 if p_target_kind is distinct from 'subject' or not exists(select 1 from public.subjects
  where id=p_target_id and lifecycle='claimed_bound' and subject_class='embryo') then
  return private.export_archive_ordinary_account_authority_v1(p_origin,p_target_kind,p_target_id);end if;
 if jsonb_typeof(p_origin) is distinct from 'object' or p_origin->>'kind' is distinct from 'account'
  or (select count(*) from jsonb_object_keys(p_origin))<>3 or not(p_origin ?& array['kind','accountId','sessionId']) then
  raise exception using errcode='42501',message='not_found';end if;
 a:=(p_origin->>'accountId')::uuid;sess:=(p_origin->>'sessionId')::uuid;
 actor:=private.future_person_archive_account_actor_v1(a,sess);
 source:=private.future_person_bound_source_for_actor_v1(p_target_id,clock_timestamp()+interval '30 seconds',actor);
 if source is null then raise exception using errcode='55000',message='export_source_unavailable';end if;
 select subj.id into own_self from public.subjects subj join public.subject_account_bindings binding
  on binding.subject_id=subj.id and binding.account_id=a and binding.status='current'
  where subj.subject_account_id=a and subj.subject_class='self' and subj.lifecycle in('active','restricted')
  order by subj.id limit 1;
 base:=private.export_archive_ordinary_account_authority_v1(p_origin,'subject',own_self);
 select * into s from public.subjects where id=p_target_id for share;
 receipt:=encode(extensions.digest(jsonb_build_object('version','bound-account-subject-archive-v1',
  'ordinaryActorReceipt',base->'authorityReceipt','targetKind',p_target_kind,'targetId',p_target_id,
  'source',private.future_person_bound_archive_frame_v1(source),'subject',to_jsonb(s))::text,'sha256'),'hex');
 return base||jsonb_build_object('authorityReceipt',receipt,'lifecycleRevision',s.lifecycle_revision,
  'subjectPartitions',jsonb_build_array(p_target_id),'fileCount',1);
end $$;
revoke all on function private.export_archive_account_authority_v1(jsonb,text,uuid),
 private.export_archive_ordinary_account_authority_v1(jsonb,text,uuid)
 from public,anon,authenticated,inherit_upload_only,service_role;

create function public.export_archive_bound_source_v1(p_operation text,p_export_id uuid,p_attempt_id uuid,
 p_authority_receipt text,p_expected jsonb default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog set lock_timeout='250ms' as $$
declare current_receipt jsonb; j private.export_archive_jobs; e public.generated_exports;
 attempt private.export_archive_attempts; actor jsonb; source jsonb; expiry timestamptz;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' or p_operation is null or p_operation not in('manifest','check')
  or (p_operation='manifest' and p_expected is not null) then
  raise exception using errcode='42501',message='export_source_unavailable';end if;
 current_receipt:=private.export_archive_current_v1(p_export_id,p_authority_receipt);
 select * into j from private.export_archive_jobs where export_id=p_export_id for update;
 select * into e from public.generated_exports where id=p_export_id for update;
 select * into attempt from private.export_archive_attempts where id=p_attempt_id and export_id=p_export_id for update;
 if current_receipt is null or j.origin->>'kind' is distinct from 'account' or j.route_id<>'api.subject-export'
  or j.export_contract<>'subject-export-v1' or e.target_kind<>'subject' or e.status<>'building'
  or j.active_attempt is distinct from p_attempt_id or attempt.state is distinct from 'writing'
  or attempt.authority_receipt is distinct from p_authority_receipt or attempt.lease_expires_at<=clock_timestamp()
  or j.authority_receipt is distinct from p_authority_receipt or j.deadline<=clock_timestamp()+interval '30 seconds'
  or e.subject_partitions is distinct from jsonb_build_array(e.target_id) then
  raise exception using errcode='42501',message='export_source_unavailable';end if;
 -- A stored job alone is not a user-issued request: the real consumed create
 -- envelope must bind this exact route, principal, target, origin and graph.
 if not exists(select 1 from private.export_archive_nonce_uses n where n.export_id=e.id and n.operation='create'
  and n.consumed_at is not null and n.consumed_at<n.expires_at
  and jsonb_typeof(n.envelope)='object' and (select count(*) from jsonb_object_keys(n.envelope))=13
  and n.envelope ?& array['routeId','origin','principalId','targetKind','targetId','exportContract',
   'originBinding','authorityReceipt','csrfBinding','operation','nonceHash','issuedAt','expiresAt']
  and n.envelope->>'csrfBinding'~'^[a-f0-9]{64}$'
  and n.envelope->>'operation'='create' and n.envelope->>'nonceHash'=n.nonce_hash
  and jsonb_typeof(n.envelope->'issuedAt')='number' and jsonb_typeof(n.envelope->'expiresAt')='number'
  and (n.envelope->>'expiresAt')::bigint-(n.envelope->>'issuedAt')::bigint=300000
  and to_timestamp((n.envelope->>'issuedAt')::numeric/1000)<=n.consumed_at
  and to_timestamp((n.envelope->>'expiresAt')::numeric/1000)=n.expires_at
  and n.envelope->>'routeId'=j.route_id and n.envelope->>'origin'='authenticated'
  and n.envelope->>'principalId'=e.requester_principal_id::text and n.envelope->>'targetKind'=e.target_kind
  and n.envelope->>'targetId'=e.target_id::text and n.envelope->>'exportContract'=j.export_contract
  and n.envelope->>'originBinding'=j.origin_binding and n.envelope->>'authorityReceipt'=j.authority_receipt) then
  raise exception using errcode='42501',message='export_source_unavailable';end if;
 actor:=private.future_person_archive_account_actor_v1((j.origin->>'accountId')::uuid,(j.origin->>'sessionId')::uuid);
 if p_operation='check' then
  if jsonb_typeof(p_expected) is distinct from 'object' or jsonb_typeof(p_expected->'expiresAt') is distinct from 'string' then
   raise exception using errcode='42501',message='export_source_unavailable';end if;
  expiry:=(p_expected->>'expiresAt')::timestamptz;
 else expiry:=least(clock_timestamp()+interval '30 seconds',attempt.lease_expires_at,j.deadline-interval '30 seconds');end if;
 source:=private.future_person_bound_source_for_actor_v1(e.target_id,expiry,actor);
 if source is null or (p_operation='check' and source is distinct from p_expected)
  or attempt.lease_expires_at<=clock_timestamp() or j.deadline<=clock_timestamp()+interval '30 seconds'
  or private.export_archive_current_v1(p_export_id,p_authority_receipt) is distinct from current_receipt then
  raise exception using errcode='42501',message='export_source_unavailable';end if;
 return jsonb_build_object('version','bound-account-archive-source-v1','exportId',e.id,'attemptId',attempt.id,
  'authorityReceipt',j.authority_receipt,'source',source);
end $$;
revoke all on function public.export_archive_bound_source_v1(text,uuid,uuid,text,jsonb)
 from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function public.export_archive_bound_source_v1(text,uuid,uuid,text,jsonb) to service_role;
