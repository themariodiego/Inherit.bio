-- Select one completed own-report source before the server reads any calls.
-- The receipt is a recheck token, not authority: every invocation repeats the
-- live session, store, purpose, completion and full prepared membership checks.
create function private.own_report_call_source_v1(p_account_id uuid,p_session_id uuid,
 p_file_id uuid,p_purpose text,p_expected text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare f public.genome_files%rowtype; r private.own_analysis_runs%rowtype; n private.own_normalization_runs%rowtype;
 a jsonb; metadata jsonb; published jsonb; selection jsonb; output jsonb; deadline timestamptz;
begin
 if p_account_id is null or p_session_id is null or p_file_id is null
  or p_purpose is null or p_purpose not in ('reports.monogenic','reports.polygenic')
  or (p_expected is not null and p_expected !~ '^[0-9a-f]{64}$') then return null; end if;
 -- The existing grant contract takes the account/session/store locks before
 -- the file lock and forbids falling back from active or published preparation.
 a:=private.current_own_report_grant_v1(p_account_id,p_session_id,p_file_id,p_purpose);
 select * into f from public.genome_files where id=p_file_id and user_id=p_account_id for share;
 if f.id is null or f.subject_id is distinct from (a->>'subjectId')::uuid
  or f.upload_revision is null or f.upload_revision<1 or f.upload_revision>9007199254740991
  or coalesce(f.sha256,'') !~ '^[0-9a-f]{64}$' or coalesce(f.source_sha256,'') !~ '^[0-9a-f]{64}$'
  or f.normalization_completed_at is null
  or exists(select 1 from private.genome_file_deletions where file_id=f.id) then return null; end if;
 select * into r from private.own_analysis_runs where file_id=f.id and purpose=p_purpose for share;
 if r.id is null or r.account_id is distinct from p_account_id or r.subject_id is distinct from f.subject_id
  or r.state is distinct from 'complete' or r.completed_at is null or r.result is null
  or r.grant_id is distinct from (a->>'grantId')::uuid
  or r.grant_revision is distinct from (a->>'grantRevision')::bigint
  or r.source_revision is distinct from f.upload_revision or r.source_sha256 is distinct from f.sha256
  or r.normalization_completed_at is distinct from f.normalization_completed_at
  or private.own_analysis_completion_matches_v1(f.id,p_purpose,a) is not true then return null; end if;
 metadata:=private.own_report_source_metadata_v1(p_account_id,f.id,true);
 if (metadata->'preparedSource') is distinct from (a->'preparedSource') then return null; end if;
 if metadata ? 'preparedSource' then
  -- This checks every final member and the exact original-retirement exception,
  -- not just the root object. Missing members never become database sources.
  published:=private.read_own_prepared_manifest_v1(p_account_id,p_session_id,f.id,
   (metadata#>>'{preparedSource,manifestId}')::uuid);
  if published->>'version' is distinct from 'own-prepared-source-v1'
   or published->>'backend' is distinct from 'prepared-object-v1'
   or published->>'fileId' is distinct from f.id::text
   or published->>'subjectId' is distinct from f.subject_id::text
   or published->'sourceRevision' is distinct from to_jsonb(f.upload_revision)
   or published->>'rawSha256' is distinct from f.sha256
   or published->>'decodedSha256' is distinct from f.source_sha256
   or (published->>'preparedAt')::timestamptz is distinct from f.normalization_completed_at
   or published->>'manifestId' is distinct from metadata#>>'{preparedSource,manifestId}'
   or published->>'membershipSha256' is distinct from metadata#>>'{preparedSource,membershipSha256}'
   or published#>>'{root,receipt,artifactId}' is distinct from metadata#>>'{preparedSource,rootArtifactId}'
   or published#>>'{root,receipt,sha256}' is distinct from metadata#>>'{preparedSource,rootSha256}' then return null; end if;
 else
  select * into n from private.own_normalization_runs
   where file_id=f.id and account_id=p_account_id and state='complete' for share;
  if n.file_id is null then return null; end if;
 end if;
 select least(s.not_after,c.expires_at,g.expires_at) into deadline
  from auth.sessions s join public.subject_consents c on c.id=(a#>>'{context,uploadConsentId}')::uuid
  join public.purpose_grants g on g.grant_id=r.grant_id
  where s.id=p_session_id and s.user_id=p_account_id;
 if not found then return null; end if;
 selection:=jsonb_build_object('fileId',f.id,'subjectId',f.subject_id,'sourceRevision',f.upload_revision,
  'sourceSha256',f.sha256,'decodedSha256',f.source_sha256,'normalizedAt',f.normalization_completed_at)
  ||case when metadata ? 'preparedSource' then jsonb_build_object('preparedSource',metadata->'preparedSource') else '{}'::jsonb end;
 output:=jsonb_build_object('backend',case when metadata ? 'preparedSource' then 'prepared-object-v1' else 'database-v1' end,
  'selection',selection,'receipt',encode(extensions.digest(convert_to(jsonb_build_object(
   'accountId',p_account_id,'sessionId',p_session_id,'purpose',p_purpose,'authority',a,
   'selection',selection,'sourceMetadata',metadata,'published',published,'normalizationManifest',n.manifest,
   'runId',r.id,'claim',r.claim,'completedAt',r.completed_at,
   'resultSha256',encode(extensions.digest(convert_to(r.result::text,'UTF8'),'sha256'),'hex'))::text,'UTF8'),'sha256'),'hex'));
 if p_expected is not null and output->>'receipt' is distinct from p_expected then return null; end if;
 -- Full source validation and the report grant's clock fence apply again after
 -- receipt construction; refresh or regrant cannot revive a captured receipt.
 if metadata ? 'preparedSource' and private.read_own_prepared_manifest_v1(p_account_id,p_session_id,f.id,
  (metadata#>>'{preparedSource,manifestId}')::uuid) is distinct from published then return null; end if;
 if private.current_own_report_grant_v1(p_account_id,p_session_id,f.id,p_purpose) is distinct from a
  or private.own_report_source_metadata_v1(p_account_id,f.id,true) is distinct from metadata
  or (deadline is not null and deadline<=clock_timestamp()) then return null; end if;
 return output;
exception when lock_not_available or insufficient_privilege or object_not_in_prerequisite_state
 or invalid_text_representation or invalid_datetime_format or datetime_field_overflow then return null;
end; $$;

create function public.own_report_call_source_v1(p_account_id uuid,p_session_id uuid,
 p_file_id uuid,p_purpose text,p_expected text default null)
returns jsonb language sql security invoker set search_path='' as $$
 select private.own_report_call_source_v1(p_account_id,p_session_id,p_file_id,p_purpose,p_expected);
$$;
revoke all on function private.own_report_call_source_v1(uuid,uuid,uuid,text,text),
 public.own_report_call_source_v1(uuid,uuid,uuid,text,text) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function private.own_report_call_source_v1(uuid,uuid,uuid,text,text),
 public.own_report_call_source_v1(uuid,uuid,uuid,text,text) to service_role;
