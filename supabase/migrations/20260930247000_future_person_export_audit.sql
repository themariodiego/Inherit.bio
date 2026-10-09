-- Receipt-bound complete claimant ledger members. No actor reconstruction,
-- new store, provider, READY, retention or current account reader change.
create function private.future_person_export_snapshot_v1(p_session_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 rs public.rights_sessions; s public.subjects; x private.embryo_canonical_sources;
 custody private.future_person_custody_slices; f public.genome_files; item record;
 state_hash bytea; count_variants bigint:=0; count_scores bigint:=0; count_figures bigint:=0;
 count_reports bigint:=0; count_qc bigint:=0; parts uuid[]; origin_hash text; receipt text; agreements jsonb;
begin
 rs:=private.future_person_rights_session_v1(p_session_hash,false);
 if rs.id is null then raise exception using errcode='42501',message='not_found'; end if;
 select * into s from public.subjects where id=rs.target_id;
 select * into custody from private.future_person_custody_slices where subject_id=s.id;
 select * into x from private.embryo_canonical_sources where file_id=custody.source_file_id and subject_id=s.id;
 select * into f from public.genome_files where id=x.file_id;
 select array_agg(m.part_id order by m.sequence) into parts from private.embryo_canonical_source_parts m where m.file_id=x.file_id;
 if x.call_immutability_proof is distinct from 'exact-staged-calls-v1' then
  raise exception using errcode='55000',message='export_source_immutability_unproven';end if;
 if x.file_id is null or f.id is null or f.user_id is not null or f.subject_id<>s.id
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
 origin_hash:=encode(extensions.digest(jsonb_build_object('version','future-person-export-origin-v1',
   'session',rs.id,'principal',rs.principal_id,'purpose',rs.purpose,'target',rs.target_id,
   'authorityRevision',rs.authority_revision,'expiresAt',rs.expires_at,'tokenHashId',rs.token_hash_id,
   'lifecycleRevision',s.lifecycle_revision,'bindingRevision',s.subject_binding_revision)::text,'sha256'),'hex');
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
 receipt:=encode(state_hash,'hex');
 return jsonb_build_object('authority',jsonb_build_object('principalId',rs.principal_id,'subjectId',s.id,
   'originBinding',origin_hash,'authorityReceipt',receipt,'lifecycleRevision',s.lifecycle_revision,
   'bindingRevision',s.subject_binding_revision,'credentialRevision',rs.authority_revision,'expiresAt',rs.expires_at),
  'source',jsonb_build_object('fileId',x.file_id,'subjectId',s.id,'referenceBuild',x.reference_build,
    'sourceSha256',x.source_sha256,'membershipSha256',x.membership_sha256,'publicationRevision',x.publication_revision,
    'variantCount',count_variants,'publishedAt',x.published_at),
  'membership',jsonb_build_object('variants',count_variants,'qualityReports',count_qc,'scores',count_scores,
    'figures',count_figures,'reports',count_reports,'agreements',jsonb_array_length(agreements)));
end $$;
revoke all on function private.future_person_export_snapshot_v1(text)
 from public,anon,authenticated,service_role,inherit_upload_only;

-- Only newly issued exact custody selectors resolve an actor. Legacy NULL
-- remains unassigned; no lookup, inferred ciphertext or identity backfill.
create function private.future_person_export_audit_v1(p_subject uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid;started timestamptz;item public.legal_audit_log;total bigint:=0;
 state_hash bytea:=extensions.digest(convert_to('claimant-ledger-v1','UTF8'),'sha256');
begin
 perform private.assert_future_person_subject_custody_v1(p_subject);
 select audit_principal_id into actor from private.future_person_custody_slices where subject_id=p_subject;
 if actor is null then
  return jsonb_build_object('metadata',jsonb_build_object('attribution','unrecorded','attributionStartedAt',null),
   'count',0,'membershipSha256',encode(state_hash,'hex'));
 end if;
 actor:=private.future_person_audit_selector_v1(p_subject);
 -- The same non-personal reference clock used by the canonical account
 -- ledger member, never a column from the excluded actor-pseudonym store.
 select started_at into strict started from private.legal_audit_attribution_config where singleton;
 for item in select * from public.legal_audit_log where audit_principal_id=actor order by seq loop
  if item.coded_context is distinct from '{}'::jsonb or item.seq>9007199254740991 or (
   (item.event_code='claimant.analysis_stopped' and item.route_id='api.future-person-analysis-stop' and item.outcome_code='accepted')
   or (item.event_code='claimant.deletion_requested' and item.route_id='api.future-person-delete' and item.outcome_code='accepted')
   or (item.event_code='claimant.deleted' and item.route_id='api.future-person-delete' and item.outcome_code='purged')) is not true then
    raise exception using errcode='55000',message='export_audit_unavailable';end if;
  -- Complete actual ledger identity/order/content binds internally. Neither
  -- the actor nor chain hashes become a member field or a caller selector.
  state_hash:=extensions.digest(state_hash||convert_to(to_jsonb(item)::text,'UTF8'),'sha256');total:=total+1;
 end loop;
 return jsonb_build_object('metadata',jsonb_build_object('attribution','assigned','attributionStartedAt',started),
  'count',total,'membershipSha256',encode(state_hash,'hex'));
end $$;
revoke all on function private.future_person_export_audit_v1(uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;

create or replace function private.future_person_export_capture_v1(p_session_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c jsonb;ledger jsonb;receipt text;
begin
 c:=private.future_person_export_snapshot_v1(p_session_hash);
 ledger:=private.future_person_export_audit_v1((c#>>'{authority,subjectId}')::uuid);
 receipt:=encode(extensions.digest(convert_to('future-person-export-ledger-v1:'||
  (c#>>'{authority,authorityReceipt}')||':'||ledger::text,'UTF8'),'sha256'),'hex');
 return jsonb_set(c,'{authority,authorityReceipt}',to_jsonb(receipt))||jsonb_build_object(
  'legalAudit',ledger->'metadata','membership',(c->'membership')||jsonb_build_object('legalAuditEvents',ledger->'count'));
end $$;
revoke all on function private.future_person_export_capture_v1(text)
 from public,anon,authenticated,service_role,inherit_upload_only;

create or replace function public.future_person_export_members_v1(p_operation text,p_export_id uuid,p_attempt_id uuid,
 p_authority_receipt text,p_after_id text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.generated_exports;j private.export_archive_jobs;a private.export_archive_attempts;
 c jsonb;source uuid;embryo uuid;subject uuid;result jsonb;page jsonb;n integer;after_id uuid;last_id uuid;actor uuid;
begin
 if p_operation is null or p_operation not in ('context','agreements','quality','scores','figures','reports','variants','legal-audit')
  or (p_operation not in('scores','figures','reports','variants','legal-audit') and p_after_id is not null) then raise exception using errcode='22023',message='invalid_request';end if;
 if p_after_id is not null and p_operation not in('variants','legal-audit') then after_id:=p_after_id::uuid;end if;
 perform private.export_archive_current_v1(p_export_id,p_authority_receipt);
 select * into e from public.generated_exports where id=p_export_id;
 select * into j from private.export_archive_jobs where export_id=e.id;
 select * into a from private.export_archive_attempts where id=p_attempt_id and export_id=e.id;
 if e.id is null or e.origin_kind<>'independent-rights' or e.status<>'building' or j.route_id<>'api.future-person-export'
  or a.id is null or j.active_attempt is distinct from a.id or a.state<>'writing'
  or a.lease_expires_at<=clock_timestamp() or a.authority_receipt is distinct from p_authority_receipt then
   raise exception using errcode='42501',message='not_found';end if;
 c:=private.future_person_export_capture_v1(j.origin->>'sessionHash');
 subject:=(c#>>'{authority,subjectId}')::uuid;source:=(c#>>'{source,fileId}')::uuid;
 select embryo_id into embryo from private.embryo_canonical_sources where file_id=source;
 if p_operation='context' then result:=c;
 elsif p_operation='agreements' then select agreement_slice into result from private.future_person_custody_slices where subject_id=subject;
 elsif p_operation='legal-audit' then
  if p_after_id is not null then
   if p_after_id!~'^[1-9][0-9]{0,18}$' then raise exception using errcode='22023',message='invalid_request';end if;
   if p_after_id::numeric>9223372036854775807 then raise exception using errcode='22023',message='invalid_request';end if;
  end if;
  select audit_principal_id into actor from private.future_person_custody_slices where subject_id=subject;
  if actor is not null then actor:=private.future_person_audit_selector_v1(subject);end if;
  select jsonb_build_object('rows',coalesce(jsonb_agg(x.row order by x.seq),'[]'),'count',count(*),'nextAfterId',max(x.seq)::text)
   into result from (
   select l.seq,jsonb_build_object('id',l.seq::text,'event',jsonb_build_object('seq',l.seq,'occurred_at',l.occurred_at,
    'event_code',l.event_code,'route_id',l.route_id,'outcome_code',l.outcome_code,'coded_context',l.coded_context)) row
   from public.legal_audit_log l where l.audit_principal_id=actor and (p_after_id is null or l.seq>p_after_id::bigint)
   order by l.seq limit 500)x;
 elsif p_operation='variants' then
  if p_after_id is not null and (p_after_id!~'^[0-9]+$' or p_after_id::bigint<0) then raise exception using errcode='22023',message='invalid_request';end if;
  select jsonb_build_object('rows',coalesce(jsonb_agg(v.row order by v.id),'[]'),'count',count(*),'nextAfterId',max(v.id)::text) into result from (
   select id,jsonb_build_object('id',id::text,'chromosome',chromosome,'position',position,'referenceAllele',reference_allele,
    'alternateAllele',alternate_allele,'genotype',genotype) row from public.embryo_variants where source_file_id=source
    and (p_after_id is null or id>p_after_id::bigint) order by id limit 500)v;
 elsif p_operation='quality' then select coalesce(jsonb_agg(to_jsonb(q)-'embryo_id'),'[]') into result from public.embryo_qc q where q.embryo_id=embryo;
 else
  if p_operation='scores' then
   select coalesce(jsonb_agg(x.row order by x.id),'[]'),count(*),max(x.id::text)::uuid into page,n,last_id from (
    select score.id,to_jsonb(score)-'embryo_id' row from public.embryo_scores score where score.embryo_id=embryo
      and (after_id is null or score.id>after_id) order by score.id limit 500)x;
  elsif p_operation='figures' then
   select coalesce(jsonb_agg(x.row order by x.id),'[]'),count(*),max(x.id::text)::uuid into page,n,last_id from (
    select fig.id,to_jsonb(fig)||jsonb_build_object('findingRecord',to_jsonb(score)-'embryo_id') row from public.embryo_figures fig join public.embryo_scores score on score.id=fig.finding_id
     where score.embryo_id=embryo and (after_id is null or fig.id>after_id) order by fig.id limit 500)x;
  else
   select coalesce(jsonb_agg(x.row order by x.id),'[]'),count(*),max(x.id::text)::uuid into page,n,last_id from (
    select report.id,(to_jsonb(report)-'subject_id'-'cohort_id')||jsonb_build_object('embryoId',embryo) row from public.report_artifacts report where report.subject_id=subject
     and (after_id is null or report.id>after_id) order by report.id limit 500)x;
  end if;
  result:=jsonb_build_object('rows',page,'nextAfterId',last_id,'count',n);
 end if;
 if octet_length(result::text)>4000000 then raise exception using errcode='55000',message='export_source_unavailable';end if;
 perform private.export_archive_current_v1(p_export_id,p_authority_receipt);
 if not exists(select 1 from private.export_archive_attempts att where att.id=p_attempt_id and att.state='writing'
  and att.lease_expires_at>clock_timestamp()) then raise exception using errcode='42501',message='not_found';end if;
 return result;
end $$;
revoke all on function public.future_person_export_members_v1(text,uuid,uuid,text,text) from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.future_person_export_members_v1(text,uuid,uuid,text,text) to service_role;

create or replace function public.stop_future_person_analysis_v1(p_session_hash text,p_nonce text)
returns timestamptz language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare rs public.rights_sessions;stopped timestamptz;audit uuid;
begin
 rs:=private.future_person_rights_session_v1(p_session_hash,true);
 if rs.id is null or not private.rights_action_permitted_v1(rs.purpose,'analysis-stop','api.future-person-analysis-stop')
   or exists(select 1 from public.subjects where id=rs.target_id and analysis_stopped_at is not null) then
   raise exception using errcode='42501',message='claimant rights unavailable';end if;
 perform private.consume_future_person_rights_nonce_v1(rs,p_nonce);
 update public.subjects set analysis_stopped_at=clock_timestamp() where id=rs.target_id
   returning analysis_stopped_at into stopped;
 update public.worker_jobs set status='cancelled',finished_at=clock_timestamp(),claim_token_hash=null,
   claim_expires_at=null,claimed_by=null where status in('queued','running')
   and (subject_id=rs.target_id or file_id in(select id from public.genome_files where subject_id=rs.target_id))
   and kind not in('revoke_purge','retention_purge');
 select audit_principal_id into audit from private.future_person_custody_slices where subject_id=rs.target_id;
 if audit is not null then audit:=private.future_person_audit_selector_v1(rs.target_id);end if;
 perform private.append_legal_audit_event('claimant.analysis_stopped',audit,'api.future-person-analysis-stop','accepted','{}');
 return stopped;
end $$;
revoke all on function public.stop_future_person_analysis_v1(text,text) from public,anon,authenticated,service_role;
grant execute on function public.stop_future_person_analysis_v1(text,text) to service_role;
