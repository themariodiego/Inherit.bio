-- Closed non-analytical own access under account-export-v1's claimed-bound
-- classifier. No parent grant, analysis grant, source rewrite or new store.
create function private.future_person_bound_source_manifest_v1(p_subject uuid,p_expires timestamptz)
returns jsonb language plpgsql security definer set search_path=pg_catalog set lock_timeout='250ms' as $$
declare actor jsonb; b private.future_person_account_bindings; x private.embryo_canonical_sources;
 parts uuid[]; projected jsonb; n integer; total bigint;
begin
 if not exists(select 1 from private.future_person_binding_config where singleton and enabled)
  or p_expires<=clock_timestamp() or p_expires>clock_timestamp()+interval '30 seconds' then return null;end if;
 actor:=private.future_person_binding_account_v1();if actor is null then return null;end if;
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
revoke all on function private.future_person_bound_source_manifest_v1(uuid,timestamptz)
 from public,anon,authenticated,inherit_upload_only,service_role;

create function public.future_person_bound_source_manifest_v1(p_subject uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog set lock_timeout='250ms' as $$
begin
 if auth.jwt()->>'role' is distinct from 'authenticated' then return null;end if;
 return private.future_person_bound_source_manifest_v1(p_subject,clock_timestamp()+interval '30 seconds');
end $$;
create function public.check_future_person_bound_source_v1(p_subject uuid,p_expected jsonb)
returns boolean language plpgsql security definer set search_path=pg_catalog set lock_timeout='250ms' as $$
declare fresh_receipt jsonb;
begin
 if auth.jwt()->>'role' is distinct from 'authenticated' or jsonb_typeof(p_expected) is distinct from 'object'
  or jsonb_typeof(p_expected->'expiresAt') is distinct from 'string' then return false;end if;
 fresh_receipt:=private.future_person_bound_source_manifest_v1(p_subject,(p_expected->>'expiresAt')::timestamptz);
 return coalesce(fresh_receipt=p_expected,false);
exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then return false;
end $$;
revoke all on function public.future_person_bound_source_manifest_v1(uuid),public.check_future_person_bound_source_v1(uuid,jsonb)
 from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function public.future_person_bound_source_manifest_v1(uuid),public.check_future_person_bound_source_v1(uuid,jsonb) to authenticated;
