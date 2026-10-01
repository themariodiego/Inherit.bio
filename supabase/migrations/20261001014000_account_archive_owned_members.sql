-- TEST-LOCAL owned-account archive member continuation. No new store, human
-- JWT persistence, analytical grant, public activation, READY or delivery.
-- Private helpers remain denied to every API role. Bound source descriptors
-- stay immutable and the original authenticated-only human reader is unchanged.
create function private.future_person_bound_export_audit_v1(p_subject uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.future_person_custody_slices;b private.future_person_account_bindings;
 item public.legal_audit_log;total bigint:=0;binding_events integer:=0;started timestamptz;
 state_hash bytea:=extensions.digest(convert_to('bound-claimant-ledger-v1','UTF8'),'sha256');
begin
 select * into b from private.future_person_account_bindings where subject_id=p_subject;
 select * into c from private.future_person_custody_slices where subject_id=p_subject and claimant_principal_id=b.claimant_principal_id;
 if b.id is null or c.subject_id is null or b.audit_principal_id is null
  or b.audit_principal_id is not distinct from c.audit_principal_id then raise exception using errcode='42501',message='not_found';end if;
 perform private.assert_future_person_subject_custody_v1(p_subject);
 select started_at into strict started from private.legal_audit_attribution_config where singleton;
 for item in select * from public.legal_audit_log where audit_principal_id=b.audit_principal_id
  or (c.audit_principal_id is not null and audit_principal_id=c.audit_principal_id) order by seq loop
  if item.seq>9007199254740991 or item.coded_context is distinct from '{}'::jsonb then
   raise exception using errcode='55000',message='export_audit_unavailable';end if;
  if item.audit_principal_id=b.audit_principal_id then
   if (item.event_code='claimant.account_bound' and item.route_id='api.future-person-claimant-bind'
    and item.outcome_code='accepted') is not true then raise exception using errcode='55000',message='export_audit_unavailable';end if;
   binding_events:=binding_events+1;
  elsif ((item.event_code='claimant.analysis_stopped' and item.route_id='api.future-person-analysis-stop' and item.outcome_code='accepted')
   or (item.event_code='claimant.deletion_requested' and item.route_id='api.future-person-delete' and item.outcome_code='accepted')
   or (item.event_code='claimant.deleted' and item.route_id='api.future-person-delete' and item.outcome_code='purged')) is not true then
   raise exception using errcode='55000',message='export_audit_unavailable';end if;
  state_hash:=extensions.digest(state_hash||convert_to(to_jsonb(item)::text,'UTF8'),'sha256');total:=total+1;
 end loop;
 if binding_events<>1 then raise exception using errcode='55000',message='export_audit_unavailable';end if;
 return jsonb_build_object('metadata',jsonb_build_object('attribution','assigned','attributionStartedAt',started),
  'count',total,'membershipSha256',encode(state_hash,'hex'));
end $$;
revoke all on function private.future_person_bound_export_audit_v1(uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;

create function private.future_person_bound_export_snapshot_v1(p_origin jsonb,p_subject uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 actor jsonb; b private.future_person_account_bindings; s public.subjects; x private.embryo_canonical_sources;
 source_frame jsonb; expires timestamptz; ledger jsonb;
 custody private.future_person_custody_slices; f public.genome_files; item record;
 state_hash bytea; count_variants bigint:=0; count_scores bigint:=0; count_figures bigint:=0;
 count_reports bigint:=0; count_qc bigint:=0; parts uuid[]; origin_hash text; receipt text; agreements jsonb;
begin
 if jsonb_typeof(p_origin) is distinct from 'object' or p_origin->>'kind' is distinct from 'account'
  or (select count(*) from jsonb_object_keys(p_origin))<>3 or not(p_origin ?& array['kind','accountId','sessionId']) then
  raise exception using errcode='42501',message='not_found';end if;
 actor:=private.future_person_archive_account_actor_v1((p_origin->>'accountId')::uuid,(p_origin->>'sessionId')::uuid);
 source_frame:=private.future_person_bound_source_for_actor_v1(p_subject,clock_timestamp()+interval '30 seconds',actor);
 if source_frame is null then raise exception using errcode='42501',message='not_found';end if;
 select least(ss.created_at+interval '15 minutes',ss.not_after) into expires from auth.sessions ss
  where ss.id=(actor->>'sessionId')::uuid and ss.user_id=(actor->>'accountId')::uuid;
 if expires is null or expires<=clock_timestamp() then raise exception using errcode='42501',message='not_found';end if;
 select * into b from private.future_person_account_bindings where subject_id=p_subject and account_id=(actor->>'accountId')::uuid;
 select * into s from public.subjects where id=p_subject;
 if exists(select 1 from public.portrait_results where parent_a_subject_id=s.id or parent_b_subject_id=s.id) then
  raise exception using errcode='0A000',message='export_partition_projection_unavailable';end if;
 select * into custody from private.future_person_custody_slices where subject_id=s.id;
 select * into x from private.embryo_canonical_sources where file_id=custody.source_file_id and subject_id=s.id;
 select * into f from public.genome_files where id=x.file_id;
 select array_agg(m.part_id order by m.sequence) into parts from private.embryo_canonical_source_parts m where m.file_id=x.file_id;
 if x.call_immutability_proof is distinct from 'exact-staged-calls-v1' then
  raise exception using errcode='55000',message='export_source_immutability_unproven';end if;
 if x.file_id is null or f.id is null or f.user_id is distinct from (actor->>'accountId')::uuid or f.subject_id<>s.id
  or f.cohort_id is not null or f.is_cohort_file or f.status<>'stored' or f.source_publication_state<>'published' or f.source_publication_revision<>x.publication_revision or f.source_sha256<>x.source_sha256
  or (select count(*) from public.genome_files where subject_id=s.id)<>1
  or cardinality(parts) is distinct from x.part_count
  or private.embryo_canonical_source_sha256_v1(x.file_id) is distinct from x.source_sha256
  or private.embryo_canonical_membership_sha256_v1(parts) is distinct from x.membership_sha256
  or exists(select 1 from private.embryo_canonical_parts p where p.id=any(parts)
    and (p.state<>'landed' or p.provider_version is null or p.provider_etag is null or p.observed_sha256<>p.sha256)) then
   raise exception using errcode='42501',message='not_found'; end if;
 agreements:=custody.agreement_slice;
 -- Old abbreviated custody snapshots are not silently relabeled complete.
 -- The original signed body must hash to the recorded signed body, and a
 -- genuine signing-name ciphertext plus individually affirmed statements
 -- must exist. Original identity-document bytes are never a fallback.
 if jsonb_array_length(agreements)=0 or exists(select 1 from jsonb_array_elements(agreements) a where
   a->>'version' is distinct from 'future-person-agreement-v2'
   or a->>'bodySha256' is distinct from a->>'recomputedBodySha256'
   or encode(extensions.digest(convert_to(a->>'bodyMarkdown','UTF8'),'sha256'),'hex') is distinct from a->>'bodySha256'
   or a->>'signingNameCiphertext' is null or length(a->>'signingNameCiphertext')<58
   or (a->>'signingNameCiphertext')!~'^[0-9a-f]+$' or length(a->>'signingNameCiphertext')%2<>0
   or jsonb_typeof(a->'statementKeys') is distinct from 'array' or jsonb_array_length(a->'statementKeys')=0
   or a->>'recordedRole' is null or a->>'signaturePurpose' is null
   or not(case a->>'artifactKey' when 'consent.upload-embryo' then a->>'signaturePurpose' in ('embryo-upload-parent-class','embryo-upload-uploader-class')
     when 'attestation.embryo-parentage' then a->>'signaturePurpose'='embryo-parentage-attestation'
     when 'attestation.embryo-disposition-rights' then a->>'signaturePurpose'='embryo-disposition-rights-attestation'
     when 'attestation.embryo-single-parent-basis' then a->>'signaturePurpose'='embryo-single-parent-basis-attestation'
     when 'charter.future-person' then a->>'signaturePurpose'='future-person-charter-acknowledgement'
     when 'disclosure.insurance-and-discrimination' then a->>'signaturePurpose'='disclosure-acknowledgement' else false end)
   or jsonb_typeof(a->'attestations') is distinct from 'array'
   or ((a->>'artifactKey' like 'attestation.%' or a->>'artifactKey'='charter.future-person') and jsonb_array_length(a->'attestations')=0)
   or exists(select 1 from jsonb_array_elements(a->'attestations') t where t->>'affirmed' is distinct from 'true'
      or jsonb_typeof(t->'statementKeys') is distinct from 'array' or jsonb_array_length(t->'statementKeys')=0)) then
  raise exception using errcode='55000',message='export_historical_agreement_unavailable'; end if;
 origin_hash:=encode(extensions.digest(jsonb_build_object('version','bound-own-export-origin-v1',
   'actor',actor,'binding',to_jsonb(b),'source',private.future_person_bound_archive_frame_v1(source_frame))::text,'sha256'),'hex');
 state_hash:=extensions.digest(jsonb_build_object('origin',origin_hash,'custody',to_jsonb(custody),
   'source',to_jsonb(x),'file',to_jsonb(f))::text,'sha256');
 -- Canonical publication inserted every exact staged call under the immutable
 -- copy guard, and the approval transaction checked complete cardinality.
 -- Claimed rows cannot be inserted, updated or partially deleted thereafter.
 -- This permits constant source checking without rescanning ten million calls
 -- for each bounded page. Canonical parts/source remain independently frozen.
 count_variants:=x.variant_count;
 state_hash:=extensions.digest(state_hash||convert_to('immutable-canonical-calls-v1:'||x.source_sha256||':'||count_variants,'UTF8'),'sha256');
 for item in select * from public.embryo_qc where embryo_id=x.embryo_id order by embryo_id loop
  state_hash:=extensions.digest(state_hash||convert_to('qc:'||to_jsonb(item)::text,'UTF8'),'sha256'); count_qc:=count_qc+1;
 end loop;
 for item in select * from public.embryo_scores where embryo_id=x.embryo_id order by id loop
  if item.source_binding_fingerprint<>x.source_sha256 then raise exception using errcode='55000',message='export_source_unavailable'; end if;
  state_hash:=extensions.digest(state_hash||convert_to('scores:'||to_jsonb(item)::text,'UTF8'),'sha256'); count_scores:=count_scores+1;
 end loop;
 for item in select fig.* from public.embryo_figures fig join public.embryo_scores score on score.id=fig.finding_id
   where score.embryo_id=x.embryo_id order by fig.id loop
  state_hash:=extensions.digest(state_hash||convert_to('figures:'||to_jsonb(item)::text,'UTF8'),'sha256'); count_figures:=count_figures+1;
 end loop;
 for item in select * from public.report_artifacts where subject_id=s.id order by id loop
  if item.source_binding_fingerprint<>x.source_sha256 then raise exception using errcode='55000',message='export_source_unavailable'; end if;
  state_hash:=extensions.digest(state_hash||convert_to('reports:'||to_jsonb(item)::text,'UTF8'),'sha256'); count_reports:=count_reports+1;
 end loop;
 ledger:=private.future_person_bound_export_audit_v1(p_subject);
 state_hash:=extensions.digest(state_hash||convert_to(ledger::text,'UTF8'),'sha256');
 receipt:=encode(state_hash,'hex');
 return jsonb_build_object('authority',jsonb_build_object('principalId',b.claimant_principal_id,'subjectId',s.id,
   'originBinding',origin_hash,'authorityReceipt',receipt,'lifecycleRevision',s.lifecycle_revision,
   'bindingRevision',s.subject_binding_revision,'credentialRevision',b.release_revision,'expiresAt',expires),
  'source',jsonb_build_object('fileId',x.file_id,'subjectId',s.id,'referenceBuild',x.reference_build,
    'sourceSha256',x.source_sha256,'membershipSha256',x.membership_sha256,'publicationRevision',x.publication_revision,
    'variantCount',count_variants,'publishedAt',x.published_at),
  'membership',jsonb_build_object('variants',count_variants,'qualityReports',count_qc,'scores',count_scores,
    'figures',count_figures,'reports',count_reports,'agreements',jsonb_array_length(agreements),'legalAuditEvents',ledger->'count'),
  'legalAudit',ledger->'metadata');
end $$;
revoke all on function private.future_person_bound_export_snapshot_v1(jsonb,uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;

-- Server-enumerated own partitions only. Unsupported cohorts, granted/joint
-- partitions and owned non-self adults still reject the WHOLE account request.
create function private.export_account_owned_capture_v1(p_origin jsonb,p_target_kind text,p_target_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog set lock_timeout='250ms' as $$
declare a uuid;s record;current_part jsonb;base jsonb;parts jsonb:='[]';ids jsonb:='[]';
 frame jsonb;files bigint:=0;receipt text;
begin
 if jsonb_typeof(p_origin) is distinct from 'object' or p_origin->>'kind' is distinct from 'account'
  or (select count(*) from jsonb_object_keys(p_origin))<>3 or not(p_origin ?& array['kind','accountId','sessionId'])
  or p_target_kind not in('account','subject') or p_target_kind is null or p_target_id is null then
  raise exception using errcode='42501',message='not_found';end if;
 a:=(p_origin->>'accountId')::uuid;
 if p_target_kind='account' then
  if p_target_id<>a then raise exception using errcode='42501',message='not_found';end if;
  if exists(select 1 from public.subjects where owner_account_id=a and lifecycle<>'purged'
    and (subject_account_id is distinct from a or (subject_class not in ('self','other_adult')
      and not(subject_class='embryo' and lifecycle='claimed_bound' and owner_account_id=a))))
   or exists(select 1 from public.subjects where subject_account_id=a and lifecycle<>'purged'
    and subject_class not in ('self','other_adult')
    and not(subject_class='embryo' and lifecycle='claimed_bound' and owner_account_id=a))
   or exists(select 1 from public.embryo_cohorts c where c.status<>'purged' and (c.owner_account_id=a or exists(
    select 1 from public.embryo_participant_sets ps join public.subject_principals sp on sp.id=ps.principal_id
     where ps.cohort_id=c.id and sp.account_id=a and ps.revoked_at is null)))
   or exists(select 1 from public.family_pairs pair join public.subjects subj on subj.id in (pair.subject_a_id,pair.subject_b_id)
    where pair.status<>'purged' and (subj.owner_account_id=a or subj.subject_account_id=a))
   or exists(select 1 from public.directional_grants d join public.purpose_grants g using(grant_id)
    join public.subject_principals recipient on recipient.id=d.recipient_principal_id
    where (d.recipient_account_id=a or recipient.account_id=a) and d.status='current' and g.revoked_at is null
      and (g.expires_at is null or g.expires_at>clock_timestamp()) and (g.target_kind<>'subject' or not exists(
       select 1 from public.subjects subj where subj.id=g.target_id and subj.subject_account_id=a and (subj.subject_class in ('self','other_adult') or (subj.subject_class='embryo' and subj.lifecycle='claimed_bound' and subj.owner_account_id=a))))) then
   raise exception using errcode='0A000',message='export_partition_projection_unavailable';
  end if;

 end if;
 for s in select * from public.subjects where subject_account_id=a and lifecycle<>'purged'
  and (p_target_kind='account' or id=p_target_id) order by id for share loop
  if s.subject_class in('self','other_adult') then
   current_part:=private.export_archive_ordinary_account_authority_v1(p_origin,'subject',s.id);
   parts:=parts||jsonb_build_array(jsonb_build_object('subjectId',s.id,'class','ordinary','capture',current_part));
   files:=files+(current_part->>'fileCount')::bigint;
   if s.subject_class='self' and base is null then base:=current_part;end if;
  elsif s.subject_class='embryo' and s.lifecycle='claimed_bound' and s.owner_account_id=a then
   current_part:=private.future_person_bound_export_snapshot_v1(p_origin,s.id);
   parts:=parts||jsonb_build_array(jsonb_build_object('subjectId',s.id,'class','claimed-bound','capture',current_part));
   files:=files+1;
  else raise exception using errcode='0A000',message='export_partition_projection_unavailable';end if;
  ids:=ids||jsonb_build_array(s.id);
 end loop;
 if jsonb_array_length(parts)=0 then raise exception using errcode='42501',message='not_found';end if;
 -- A genuine current self account principal remains the account origin anchor.
 if base is null then
  select subj.id into s from public.subjects subj where subj.subject_account_id=a and subj.subject_class='self'
   and subj.lifecycle in('active','restricted') order by subj.id limit 1;
  if s.id is null then raise exception using errcode='42501',message='not_found';end if;
  base:=private.export_archive_ordinary_account_authority_v1(p_origin,'subject',s.id);
 end if;
 frame:=jsonb_build_object('version','owned-account-archive-v1','origin',p_origin,'targetKind',p_target_kind,
  'targetId',p_target_id,'partitions',parts,
  'legacyConsents',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from public.consent_grants c where c.user_id=a),
  'providerRecipients',(select coalesce(jsonb_agg(to_jsonb(g) order by g.id),'[]') from public.provider_recipient_grants g where g.account_id=a),
  'principals',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') from public.subject_principals p where p.account_id=a),
  'bindings',(select coalesce(jsonb_agg(to_jsonb(b) order by b.id),'[]') from public.subject_account_bindings b where b.account_id=a),
  'consents',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from public.subject_consents c where c.account_id=a),
  'signatures',(select coalesce(jsonb_agg(to_jsonb(sig) order by sig.id),'[]') from public.consent_signatures sig where sig.signer_account_id=a),
  'attestations',(select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') from public.attestations t
    where t.principal_id in(select id from public.subject_principals where account_id=a)
     or t.signature_id in(select id from public.consent_signatures where signer_account_id=a)),
  'legalAudit',(select coalesce(jsonb_agg(to_jsonb(l) order by l.seq),'[]') from public.legal_audit_log l
    join private.legal_audit_account_principals m on m.audit_principal_id=l.audit_principal_id where m.account_id=a));
 receipt:=encode(extensions.digest(frame::text,'sha256'),'hex');
 return jsonb_build_object('authority',base||jsonb_build_object('authorityReceipt',receipt,'subjectPartitions',ids,'fileCount',files),
  'partitions',parts);
end $$;
revoke all on function private.export_account_owned_capture_v1(jsonb,text,uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;

create or replace function private.export_archive_account_authority_v1(p_origin jsonb,p_target_kind text,p_target_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog set lock_timeout='250ms' as $$
begin
 -- Preserve ordinary account behavior and every unsupported graph refusal.
 if not exists(select 1 from public.subjects where subject_account_id=(p_origin->>'accountId')::uuid
  and subject_class='embryo' and lifecycle='claimed_bound' and (p_target_kind='account' or id=p_target_id)) then
  return private.export_archive_ordinary_account_authority_v1(p_origin,p_target_kind,p_target_id);end if;
 return private.export_account_owned_capture_v1(p_origin,p_target_kind,p_target_id)->'authority';
end $$;
revoke all on function private.export_archive_account_authority_v1(jsonb,text,uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;

create function private.export_account_archive_attempt_v1(p_export uuid,p_attempt uuid,p_receipt text)
returns jsonb language plpgsql security definer set search_path=pg_catalog set lock_timeout='250ms' as $$
declare current_receipt jsonb;j private.export_archive_jobs;e public.generated_exports;attempt private.export_archive_attempts;
begin
 current_receipt:=private.export_archive_current_v1(p_export,p_receipt);
 select * into j from private.export_archive_jobs where export_id=p_export for update;
 select * into e from public.generated_exports where id=p_export for update;
 select * into attempt from private.export_archive_attempts where id=p_attempt and export_id=p_export for update;
 if current_receipt is null or j.origin->>'kind' is distinct from 'account' or e.origin_kind is distinct from 'account'
  or e.account_id is distinct from (j.origin->>'accountId')::uuid or e.status is distinct from 'building'
  or ((e.target_kind='account' and j.route_id='api.export' and j.export_contract='account-export-v1')
   or (e.target_kind='subject' and j.route_id='api.subject-export' and j.export_contract='subject-export-v1')) is not true
  or j.active_attempt is distinct from p_attempt or attempt.state is distinct from 'writing'
  or attempt.authority_receipt is distinct from p_receipt or attempt.lease_expires_at<=clock_timestamp()
  or j.authority_receipt is distinct from p_receipt or j.deadline<=clock_timestamp()+interval '30 seconds' then
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

 return jsonb_build_object('origin',j.origin,'targetKind',e.target_kind,'targetId',e.target_id,
  'partitions',e.subject_partitions,'authorityReceipt',j.authority_receipt,'deadline',j.deadline,'capturedAt',e.requested_at,
  'leaseExpiresAt',attempt.lease_expires_at);
end $$;
revoke all on function private.export_account_archive_attempt_v1(uuid,uuid,text)
 from public,anon,authenticated,service_role,inherit_upload_only;

create function public.export_archive_account_members_v1(p_operation text,p_export_id uuid,p_attempt_id uuid,
 p_authority_receipt text,p_subject_id uuid default null,p_after_id text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare permit jsonb;capture jsonb;c jsonb;result jsonb;member jsonb;actor uuid[];
 source uuid;embryo uuid;page jsonb;n integer;after_id uuid;last_id uuid;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception using errcode='42501',message='not_found';end if;
 if p_operation is null or p_operation not in('context','ordinary-files','bound-context','agreements','quality','scores','figures','reports','variants','legal-audit')
  or (p_operation='context' and (p_subject_id is not null or p_after_id is not null))
  or (p_operation='ordinary-files' and p_subject_id is not null)
  or (p_operation not in('context','ordinary-files') and p_subject_id is null)
  or (p_operation not in('scores','figures','reports','variants','legal-audit','ordinary-files') and p_after_id is not null) then
  raise exception using errcode='22023',message='invalid_request';end if;
 if p_after_id is not null and p_operation not in('variants','legal-audit') then after_id:=p_after_id::uuid;end if;
 permit:=private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt);
 capture:=private.export_account_owned_capture_v1(permit->'origin',permit->>'targetKind',(permit->>'targetId')::uuid);
 if capture#>'{authority,subjectPartitions}' is distinct from permit->'partitions' then
  raise exception using errcode='42501',message='not_found';end if;
 if p_operation='context' then
  result:=jsonb_build_object('version','account-archive-members-v1','targetKind',permit->'targetKind','targetId',permit->'targetId',
   'authorityReceipt',p_authority_receipt,'deadline',permit->'deadline','capturedAt',permit->'capturedAt',
   'actor',jsonb_build_object('accountId',permit#>'{origin,accountId}','sessionId',permit#>'{origin,sessionId}),'fileCount',capture#>'{authority,fileCount}',
   'partitions',(select jsonb_agg(jsonb_build_object('subjectId',x->'subjectId','class',x->'class',
     'fileCount',case when x->>'class'='claimed-bound' then '1'::jsonb else x#>'{capture,fileCount}' end,
     'fileIds',(select coalesce(jsonb_agg(gf.id order by gf.id),'[]') from public.genome_files gf where gf.subject_id=(x->>'subjectId')::uuid)) order by x->>'subjectId')
    from jsonb_array_elements(capture->'partitions')x));
 elsif p_operation='ordinary-files' then
  result:='[]'::jsonb;
  for source in select gf.id from public.genome_files gf
   where (p_after_id is null or gf.id>after_id) and exists(select 1 from jsonb_array_elements(capture->'partitions')x
     where x->>'class'='ordinary' and gf.subject_id=(x->>'subjectId')::uuid) order by gf.id limit 100 loop
   c:=private.own_export_source_v1((permit#>>'{origin,accountId}')::uuid,(permit#>>'{origin,sessionId}')::uuid,source);
   if c is null then raise exception using errcode='55000',message='export_source_unavailable';end if;
   result:=result||jsonb_build_array(c);
  end loop;
 else
  select x into member from jsonb_array_elements(capture->'partitions')x
   where x->>'subjectId'=p_subject_id::text and x->>'class'='claimed-bound';
  if member is null or not(permit->'partitions' ? p_subject_id::text) then raise exception using errcode='42501',message='not_found';end if;
  c:=jsonb_set(member->'capture','{authority,authorityReceipt}',to_jsonb(p_authority_receipt));
  source:=(c#>>'{source,fileId}')::uuid;
  select embryo_id into embryo from private.embryo_canonical_sources where file_id=source;
  if p_operation='bound-context' then result:=c;
  elsif p_operation='agreements' then select agreement_slice into result from private.future_person_custody_slices where subject_id=p_subject_id;
  elsif p_operation='quality' then select coalesce(jsonb_agg(to_jsonb(q)-'embryo_id'),'[]') into result from public.embryo_qc q where q.embryo_id=embryo;
  elsif p_operation in('variants','legal-audit') then
   if p_after_id is not null and (p_after_id!~'^[1-9][0-9]{0,18}$' or p_after_id::numeric>9223372036854775807) then
    raise exception using errcode='22023',message='invalid_request';end if;
   if p_operation='variants' then
    select jsonb_build_object('rows',coalesce(jsonb_agg(v.row order by v.id),'[]'),'count',count(*),'nextAfterId',max(v.id)::text)
     into result from (select id,jsonb_build_object('id',id::text,'chromosome',chromosome,'position',position,
      'referenceAllele',reference_allele,'alternateAllele',alternate_allele,'genotype',genotype) row
      from public.embryo_variants where source_file_id=source and (p_after_id is null or id>p_after_id::bigint) order by id limit 500)v;
   else
    select array[b.audit_principal_id,custody.audit_principal_id] into actor from private.future_person_account_bindings b
     join private.future_person_custody_slices custody on custody.subject_id=b.subject_id where b.subject_id=p_subject_id;
    select jsonb_build_object('rows',coalesce(jsonb_agg(v.row order by v.seq),'[]'),'count',count(*),'nextAfterId',max(v.seq)::text)
     into result from (select l.seq,jsonb_build_object('id',l.seq::text,'event',jsonb_build_object('seq',l.seq,'occurred_at',l.occurred_at,
      'event_code',l.event_code,'route_id',l.route_id,'outcome_code',l.outcome_code,'coded_context',l.coded_context)) row
      from public.legal_audit_log l where l.audit_principal_id=any(actor) and (p_after_id is null or l.seq>p_after_id::bigint) order by l.seq limit 500)v;
   end if;
  else
   if p_operation='scores' then
    select coalesce(jsonb_agg(x.row order by x.id),'[]'),count(*),max(x.id::text)::uuid into page,n,last_id from (
     select score.id,to_jsonb(score)-'embryo_id' row from public.embryo_scores score where score.embryo_id=embryo
      and (after_id is null or score.id>after_id) order by score.id limit 500)x;
   elsif p_operation='figures' then
    select coalesce(jsonb_agg(x.row order by x.id),'[]'),count(*),max(x.id::text)::uuid into page,n,last_id from (
     select fig.id,to_jsonb(fig)||jsonb_build_object('findingRecord',to_jsonb(score)-'embryo_id') row
      from public.embryo_figures fig join public.embryo_scores score on score.id=fig.finding_id
      where score.embryo_id=embryo and (after_id is null or fig.id>after_id) order by fig.id limit 500)x;
   else
    select coalesce(jsonb_agg(x.row order by x.id),'[]'),count(*),max(x.id::text)::uuid into page,n,last_id from (
     select report.id,(to_jsonb(report)-'subject_id'-'cohort_id')||jsonb_build_object('embryoId',embryo) row
      from public.report_artifacts report where report.subject_id=p_subject_id
      and (after_id is null or report.id>after_id) order by report.id limit 500)x;
   end if;
   result:=jsonb_build_object('rows',page,'nextAfterId',last_id,'count',n);
  end if;
 end if;
 if octet_length(result::text)>4000000 then raise exception using errcode='55000',message='export_source_unavailable';end if;
 if private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt) is distinct from permit
  or private.export_account_owned_capture_v1(permit->'origin',permit->>'targetKind',(permit->>'targetId')::uuid) is distinct from capture then
  raise exception using errcode='42501',message='not_found';end if;
 return result;
end $$;
revoke all on function public.export_archive_account_members_v1(text,uuid,uuid,text,uuid,text)
 from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.export_archive_account_members_v1(text,uuid,uuid,text,uuid,text) to service_role;

create function public.export_archive_account_bound_source_v1(p_operation text,p_export_id uuid,p_attempt_id uuid,
 p_authority_receipt text,p_subject_id uuid,p_expected jsonb default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog set lock_timeout='250ms' as $$
declare permit jsonb;actor jsonb;source jsonb;expiry timestamptz;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' or p_operation is null or p_operation not in('manifest','check')
  or p_subject_id is null or (p_operation='manifest' and p_expected is not null) then
  raise exception using errcode='42501',message='export_source_unavailable';end if;
 permit:=private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt);
 if not(permit->'partitions' ? p_subject_id::text) then raise exception using errcode='42501',message='not_found';end if;
 actor:=private.future_person_archive_account_actor_v1((permit#>>'{origin,accountId}')::uuid,(permit#>>'{origin,sessionId}')::uuid);
 if p_operation='check' then
  if jsonb_typeof(p_expected) is distinct from 'object' or jsonb_typeof(p_expected->'expiresAt') is distinct from 'string' then
   raise exception using errcode='42501',message='export_source_unavailable';end if;
  expiry:=(p_expected->>'expiresAt')::timestamptz;
 else expiry:=least(clock_timestamp()+interval '30 seconds',(permit->>'leaseExpiresAt')::timestamptz,
   (permit->>'deadline')::timestamptz-interval '30 seconds');end if;
 source:=private.future_person_bound_source_for_actor_v1(p_subject_id,expiry,actor);
 if source is null or (p_operation='check' and source is distinct from p_expected)
  or private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt) is distinct from permit then
  raise exception using errcode='42501',message='export_source_unavailable';end if;
 return jsonb_build_object('version','bound-account-archive-source-v1','exportId',p_export_id,'attemptId',p_attempt_id,
  'authorityReceipt',p_authority_receipt,'source',source);
end $$;
revoke all on function public.export_archive_account_bound_source_v1(text,uuid,uuid,text,uuid,jsonb)
 from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.export_archive_account_bound_source_v1(text,uuid,uuid,text,uuid,jsonb) to service_role;
