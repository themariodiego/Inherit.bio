-- Durable archive metadata. No worker, Storage write, route or scheduler is
-- activated here. Every RPC is service-only; SQL never substitutes a caller's
-- receipt for current origin/source authority. Unsupported partitions refuse
-- the WHOLE request, rather than quietly producing a self-only account export.

-- Whole internal archive objects only; no original-genome backend change.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('exports','exports',false,4000000,array['application/octet-stream']) on conflict(id) do nothing;
do $$ begin
 if not exists(select 1 from storage.buckets where id='exports' and name='exports' and public=false
  and file_size_limit=4000000 and allowed_mime_types=array['application/octet-stream']) then
  raise exception using errcode='55000',message='export_bucket_incompatible'; end if;
end $$;
-- No client Storage policy is added: the only surviving client insert policy
-- is restricted to genomes and its upload-only role. Service transport owns
-- exact reserved keys; actual provider late-write fencing remains unproved.

alter table public.generated_exports
 add column archive_version text check (archive_version is null or archive_version='archive-segments-v1');
-- Preserve the original single-object invariant for all existing exports.
do $$ declare c record; matched integer:=0; begin
 for c in select conname from pg_constraint where conrelid='public.generated_exports'::regclass
  and contype='c' and pg_get_constraintdef(oid) like '%completed_at IS NOT NULL%object_id IS NOT NULL%' loop
  execute format('alter table public.generated_exports drop constraint %I',c.conname);
  matched:=matched+1;
 end loop;
 if matched<>1 then raise exception using errcode='55000',message='export_ready_constraint_unexpected'; end if;
end $$;
alter table public.generated_exports add constraint generated_exports_ready_representation check (
 (status='ready')=(completed_at is not null and expires_at is not null
 and (case when archive_version is null then object_id is not null else object_id is null end)
 and archive_sha256 is not null and manifest_sha256 is not null and byte_count is not null));

create table private.export_archive_jobs (
 export_id uuid primary key references public.generated_exports(id) on delete restrict,
 origin jsonb not null,
 route_id text not null check(route_id in ('api.export','api.subject-export','api.future-person-export','api.third-party-subject-export')),
 export_contract text not null check(export_contract in ('account-export-v1','subject-export-v1','approved-future-person-export-v1','token-target-export-v1')),
 origin_binding text not null check(origin_binding ~ '^[0-9a-f]{64}$'),
 authority_receipt text not null check(authority_receipt ~ '^[0-9a-f]{64}$'),
 export_cookie_hash text not null unique check(export_cookie_hash ~ '^[0-9a-f]{64}$'),
 principal_hash text not null check(principal_hash ~ '^[0-9a-f]{64}$'),
 generation_revision text not null default 'archive-zip64-v1' check(generation_revision='archive-zip64-v1'),
 active_attempt uuid,
 created_at timestamptz not null default clock_timestamp(),
 deadline timestamptz not null,
 check(deadline>created_at and deadline<=created_at+interval '24 hours'),
 check(jsonb_typeof(origin)='object')
);
create table private.export_archive_nonce_uses (
 nonce_hash text primary key check(nonce_hash ~ '^[0-9a-f]{64}$'),
 export_id uuid references private.export_archive_jobs(export_id) on delete set null,
 operation text check(operation in ('create','open-ready')),
 envelope jsonb,
 expires_at timestamptz not null,
 consumed_at timestamptz default clock_timestamp(),
 check(case when export_id is null then operation is null and envelope is null and consumed_at is null
  else operation is not null and envelope is not null and consumed_at is not null end)
);
create table private.export_archive_attempts (
 id uuid primary key,
 export_id uuid not null references private.export_archive_jobs(export_id) on delete restrict,
 state text not null default 'writing' check(state in ('writing','bytes_complete','cleanup_pending','cleaned')),
 authority_receipt text not null check(authority_receipt ~ '^[0-9a-f]{64}$'),
 lease_expires_at timestamptz not null,
 started_at timestamptz not null default clock_timestamp(),
 stopped_at timestamptz,
 cleanup_not_before timestamptz,
 segment_count bigint not null default 0 check(segment_count between 0 and 2251799814),
 byte_count bigint not null default 0 check(byte_count between 0 and 9007199254740991),
 page_count bigint not null default 0 check(page_count between 0 and 17592187),
 archive_sha256 text check(archive_sha256 ~ '^[0-9a-f]{64}$'),
 manifest_sha256 text check(manifest_sha256 ~ '^[0-9a-f]{64}$'),
 unique(export_id,id),
 check(lease_expires_at>started_at and lease_expires_at<=started_at+interval '24 hours'),
 check((state='writing')=(stopped_at is null)),
 check(state='writing' or cleanup_not_before is not null)
);
alter table private.export_archive_jobs add constraint export_archive_active_attempt_fk
 foreign key(export_id,active_attempt) references private.export_archive_attempts(export_id,id) deferrable initially deferred;
create table private.export_archive_segments (
 attempt_id uuid not null references private.export_archive_attempts(id) on delete restrict,
 ordinal bigint not null check(ordinal between 0 and 2251799813),
 byte_offset bigint not null check(byte_offset=ordinal*4000000),
 byte_count integer not null check(byte_count between 1 and 4000000),
 sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
 object_key text not null unique,
 object_id uuid unique,
 reserved_at timestamptz not null default clock_timestamp(),
 acknowledged_at timestamptz,
 delete_acknowledged_at timestamptz,
 primary key(attempt_id,ordinal),
 check(byte_offset+byte_count<=9007199254740991),
 check((object_id is null)=(acknowledged_at is null))
);
create table private.export_archive_manifest_pages (
 attempt_id uuid not null references private.export_archive_attempts(id) on delete restrict,
 page bigint not null check(page>=0),
 first_ordinal bigint not null check(first_ordinal=page*128),
 segments jsonb not null check(jsonb_typeof(segments)='array' and jsonb_array_length(segments) between 1 and 128),
 page_sha256 text not null check(page_sha256 ~ '^[0-9a-f]{64}$'),
 primary key(attempt_id,page)
);
create table private.export_archive_downloads (
 id uuid primary key default gen_random_uuid(),
 export_id uuid not null references private.export_archive_jobs(export_id) on delete restrict,
 attempt_id uuid not null references private.export_archive_attempts(id) on delete restrict,
 export_revision bigint not null check(export_revision between 1 and 9007199254740991),
 cookie_hash text not null unique check(cookie_hash ~ '^[0-9a-f]{64}$'),
 authority_receipt text not null check(authority_receipt ~ '^[0-9a-f]{64}$'),
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null,
 idle_expires_at timestamptz not null,
 next_sequence bigint not null default 0 check(next_sequence>=0),
 revoked_at timestamptz,
 check(expires_at>created_at and expires_at<=created_at+interval '1 hour'),
 check(idle_expires_at>created_at and idle_expires_at<=expires_at)
);
create index export_archive_attempt_cleanup_idx on private.export_archive_attempts(cleanup_not_before,id)
 where state='cleanup_pending';
create index export_archive_attempt_export_idx on private.export_archive_attempts(export_id,id);
create index export_archive_nonce_export_idx on private.export_archive_nonce_uses(export_id);
create index export_archive_download_export_idx on private.export_archive_downloads(export_id);

do $$ declare t text; begin
 foreach t in array array['export_archive_jobs','export_archive_nonce_uses','export_archive_attempts',
  'export_archive_segments','export_archive_manifest_pages','export_archive_downloads'] loop
  execute format('alter table private.%I enable row level security',t);
  execute format('revoke all on table private.%I from public,anon,authenticated,service_role,inherit_upload_only',t);
 end loop;
end $$;

-- The first reachable projection is own adult data. All other registered
-- partitions remain explicit failures until their real projection is supplied.
-- This includes a cohort held through an evidenced parent, not only ownership.
create function private.export_archive_authority_v1(p_origin jsonb,p_target_kind text,p_target_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare a uuid; sess uuid; p public.profiles%rowtype; ap public.subject_principals%rowtype;
 origin_binding text; receipt text; graph jsonb; subjects jsonb:='[]'; sources jsonb:='[]';
 s record; f record; snapshot jsonb; binding jsonb; session_revision bigint; file_ids uuid[]:='{}';
begin
 if p_origin is null or jsonb_typeof(p_origin)<>'object' then raise exception using errcode='22023',message='invalid_request'; end if;
 if p_origin->>'kind' is distinct from 'account' then
  raise exception using errcode='0A000',message='export_origin_projection_unavailable'; end if;
 if (select count(*) from jsonb_object_keys(p_origin))<>3 or not(p_origin ?& array['kind','accountId','sessionId'])
  or p_target_kind is null or p_target_kind not in ('account','subject') or p_target_id is null then
  raise exception using errcode='22023',message='invalid_request'; end if;
 a:=(p_origin->>'accountId')::uuid; sess:=(p_origin->>'sessionId')::uuid;
 perform private.own_export_source_v1(a,sess,null);
 select * into p from public.profiles where id=a;
 select coalesce(refresh_token_counter,0)+1 into session_revision from auth.sessions where id=sess and user_id=a;
 select sp.* into ap from public.subject_account_bindings b join public.subjects s on s.id=b.subject_id
  join public.subject_principals sp on sp.id=b.account_principal_id
  join public.subject_principals subject_p on subject_p.id=b.subject_principal_id
  where b.account_id=a and b.status='current' and s.subject_class='self' and s.subject_account_id=a
   and s.lifecycle in ('active','restricted') and sp.account_id=a and sp.status='active' and sp.principal_kind='account_subject'
   and subject_p.account_id=a and subject_p.subject_id=s.id and subject_p.status='active' and subject_p.principal_kind='account_subject';
 if ap.id is null then raise exception using errcode='42501',message='not_found'; end if;
 if p_target_kind='account' then
  if p_target_id<>a then raise exception using errcode='42501',message='not_found'; end if;
  if exists(select 1 from public.subjects where owner_account_id=a and lifecycle<>'purged'
    and (subject_account_id is distinct from a or subject_class not in ('self','other_adult')))
   or exists(select 1 from public.subjects where subject_account_id=a and lifecycle<>'purged'
    and subject_class not in ('self','other_adult'))
   or exists(select 1 from public.embryo_cohorts c where c.status<>'purged' and (c.owner_account_id=a or exists(
    select 1 from public.embryo_participant_sets ps join public.subject_principals sp on sp.id=ps.principal_id
     where ps.cohort_id=c.id and sp.account_id=a and ps.revoked_at is null)))
   or exists(select 1 from public.family_pairs pair join public.subjects s on s.id in (pair.subject_a_id,pair.subject_b_id)
    where pair.status<>'purged' and (s.owner_account_id=a or s.subject_account_id=a))
   or exists(select 1 from public.directional_grants d join public.purpose_grants g using(grant_id)
    join public.subject_principals recipient on recipient.id=d.recipient_principal_id
    where (d.recipient_account_id=a or recipient.account_id=a) and d.status='current' and g.revoked_at is null
      and (g.expires_at is null or g.expires_at>clock_timestamp()) and (g.target_kind<>'subject' or not exists(
       select 1 from public.subjects s where s.id=g.target_id and s.subject_account_id=a and s.subject_class in ('self','other_adult')))) then
   raise exception using errcode='0A000',message='export_partition_projection_unavailable';
  end if;
 end if;
 for s in select * from public.subjects where subject_account_id=a and lifecycle<>'purged'
  and (p_target_kind='account' or id=p_target_id) order by id for share loop
  if s.subject_class not in ('self','other_adult') or s.lifecycle not in ('active','restricted') then
   raise exception using errcode='0A000',message='export_partition_projection_unavailable'; end if;
  select jsonb_build_object('binding',to_jsonb(b),'subjectPrincipal',to_jsonb(sp),'accountPrincipal',to_jsonb(ac)) into binding
   from public.subject_account_bindings b join public.subject_principals sp on sp.id=b.subject_principal_id
    join public.subject_principals ac on ac.id=b.account_principal_id
   where b.subject_id=s.id and b.account_id=a and b.status='current' and sp.subject_id=s.id and sp.account_id=a
    and sp.status='active' and sp.principal_kind='account_subject' and ac.account_id=a and ac.status='active'
    and ac.principal_kind='account_subject';
  if binding is null then raise exception using errcode='42501',message='not_found'; end if;
  subjects:=subjects||jsonb_build_array(jsonb_build_object('subject',to_jsonb(s),'binding',binding));
  -- Enumerate every file: the content list's exclusion filter must not silently
  -- omit an uploading, mismatched or otherwise unavailable member.
  for f in select id from public.genome_files where subject_id=s.id order by id loop
   snapshot:=private.own_export_source_v1(a,sess,f.id);
   if snapshot is null then raise exception using errcode='55000',message='export_source_unavailable'; end if;
   sources:=sources||jsonb_build_array(snapshot); file_ids:=array_append(file_ids,f.id);
  end loop;
 end loop;
 if jsonb_array_length(subjects)=0 then raise exception using errcode='42501',message='not_found'; end if;
 origin_binding:=encode(extensions.digest(jsonb_build_object('origin',p_origin,'accountRevision',p.account_revision,
  'authSessionRevision',p.auth_session_revision,'sessionRevision',session_revision,
  'jurisdictionRevision',p.jurisdiction_revision,'principal',to_jsonb(ap))::text,'sha256'),'hex');
 graph:=jsonb_build_object('version','export-authority-v1','originBinding',origin_binding,'targetKind',p_target_kind,
  'targetId',p_target_id,'profile',to_jsonb(p),'subjects',subjects,'sources',sources,
  'principalGraphRevision',(select greatest(coalesce(max(principal_revision),1),1) from public.subject_principals where account_id=a),
  'grants',(select coalesce(jsonb_agg(jsonb_build_object('grant',to_jsonb(g),'signature',to_jsonb(sig),
    'artifact',to_jsonb(artifact),'live',g.revoked_at is null and (g.expires_at is null or g.expires_at>clock_timestamp())) order by g.grant_id),'[]')
    from public.purpose_grants g join public.consent_signatures sig on sig.id=g.signature_id
     join public.consent_artifacts artifact on artifact.artifact_key=g.artifact_key and artifact.version=g.artifact_version
    where g.target_kind='subject' and g.target_id in(select (x#>>'{subject,id}')::uuid from jsonb_array_elements(subjects)x)),
  'consents',(select coalesce(jsonb_agg(jsonb_build_object('consent',to_jsonb(c),
    'live',c.revoked_at is null and (c.expires_at is null or c.expires_at>clock_timestamp())) order by c.id),'[]') from public.subject_consents c
    where c.subject_id in(select (x#>>'{subject,id}')::uuid from jsonb_array_elements(subjects)x)),
  'analysis',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]') from private.own_analysis_runs r where r.file_id=any(file_ids)));
 receipt:=encode(extensions.digest(graph::text,'sha256'),'hex');
 -- Capture returns only closed metadata and a digest. The digest also hashes
 -- stored analysis content internally; no raw variants or source bytes return.
 -- The archive producer must still prove complete authorized membership.
 return jsonb_build_object('principalId',ap.id,'principalHash',encode(extensions.digest(ap.id::text,'sha256'),'hex'),
  'originBinding',origin_binding,'authorityReceipt',receipt,'accountRevision',p.account_revision,
  'lifecycleRevision',case when p_target_kind='account' then p.account_revision else
   (select lifecycle_revision from public.subjects where id=p_target_id) end,
  'principalGraphRevision',(select greatest(coalesce(max(principal_revision),1),1) from public.subject_principals where account_id=a),
  'subjectPartitions',(select jsonb_agg(x#>'{subject,id}') from jsonb_array_elements(subjects)x),
  'fileCount',cardinality(file_ids));
end $$;

create function private.export_archive_current_v1(p_export uuid,p_expected text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare e public.generated_exports%rowtype; j private.export_archive_jobs%rowtype; current_authority jsonb;
begin
 select * into e from public.generated_exports where id=p_export;
 select * into j from private.export_archive_jobs where export_id=p_export;
 if e.id is null or j.export_id is null or e.archive_version is distinct from 'archive-segments-v1'
  or e.status not in ('queued','building','ready') or j.deadline<=clock_timestamp()
  or p_expected is distinct from j.authority_receipt then raise exception using errcode='42501',message='not_found'; end if;
 current_authority:=private.export_archive_authority_v1(j.origin,e.target_kind,e.target_id);
 if current_authority->>'authorityReceipt' is distinct from j.authority_receipt
  or current_authority->>'originBinding' is distinct from j.origin_binding
  or current_authority->>'principalId' is distinct from e.requester_principal_id::text
  or current_authority->'subjectPartitions' is distinct from e.subject_partitions then
  raise exception using errcode='42501',message='not_found'; end if;
 return current_authority;
end $$;

-- The service adapter must independently verify HMAC and session-bound CSRF.
-- This helper independently binds every envelope scope/receipt to current SQL
-- authority; replay consumption commits with the create/open transaction only.
create function private.export_archive_nonce_v1(p_export uuid,p_operation text,p_envelope jsonb,p_csrf_binding text)
returns void language plpgsql security definer set search_path=pg_catalog,private as $$
declare e public.generated_exports%rowtype; j private.export_archive_jobs%rowtype; n bigint;
begin
 select * into e from public.generated_exports where id=p_export;
 select * into j from private.export_archive_jobs where export_id=p_export;
 n:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
 if p_envelope is null or jsonb_typeof(p_envelope)<>'object' or p_csrf_binding is null or p_csrf_binding!~'^[0-9a-f]{64}$'
  or (select count(*) from jsonb_object_keys(p_envelope))<>(case when p_operation='create' then 13 else 15 end)
  or not(p_envelope ?& array['routeId','origin','principalId','targetKind','targetId','exportContract','originBinding',
    'authorityReceipt','csrfBinding','operation','nonceHash','issuedAt','expiresAt'])
  or p_envelope->>'routeId' is distinct from j.route_id or p_envelope->>'origin' is distinct from 'authenticated'
  or p_envelope->>'principalId' is distinct from e.requester_principal_id::text
  or p_envelope->>'targetKind' is distinct from e.target_kind or p_envelope->>'targetId' is distinct from e.target_id::text
  or p_envelope->>'exportContract' is distinct from j.export_contract
  or p_envelope->>'originBinding' is distinct from j.origin_binding
  or p_envelope->>'authorityReceipt' is distinct from j.authority_receipt
  or p_envelope->>'csrfBinding' is distinct from p_csrf_binding or p_envelope->>'operation' is distinct from p_operation
  or coalesce(p_envelope->>'nonceHash','')!~'^[0-9a-f]{64}$'
  or jsonb_typeof(p_envelope->'issuedAt') is distinct from 'number'
  or jsonb_typeof(p_envelope->'expiresAt') is distinct from 'number'
  or (p_envelope->>'issuedAt')::bigint<0
  or (p_envelope->>'issuedAt')::bigint>n or (p_envelope->>'expiresAt')::bigint<=n
  or (p_envelope->>'expiresAt')::bigint-(p_envelope->>'issuedAt')::bigint<>300000
  or (p_operation='open-ready' and (p_envelope->>'exportId' is distinct from e.id::text
    or (p_envelope->>'exportRevision')::bigint is distinct from e.export_revision)) then
  raise exception using errcode='42501',message='not_found'; end if;
 insert into private.export_archive_nonce_uses(nonce_hash,export_id,operation,envelope,expires_at)
 values(p_envelope->>'nonceHash',p_export,p_operation,p_envelope,to_timestamp((p_envelope->>'expiresAt')::numeric/1000));
end $$;

create function public.export_archive_request_v1(p_operation text,p_origin jsonb,p_target_kind text,p_target_id uuid,
 p_payload jsonb default null,p_csrf_binding text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare capture jsonb; e public.generated_exports%rowtype; j private.export_archive_jobs%rowtype;
 new_id uuid; download_id uuid; expiry timestamptz; now_at timestamptz:=clock_timestamp();
begin
 if p_operation is null or p_operation not in ('capture','create','check','open-ready') then
  raise exception using errcode='22023',message='invalid_request'; end if;
 capture:=private.export_archive_authority_v1(p_origin,p_target_kind,p_target_id);
 if p_operation='capture' then
  if p_payload is not null or p_csrf_binding is not null then raise exception using errcode='22023',message='invalid_request'; end if;
  return capture;
 elsif p_operation='create' then
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or (select count(*) from jsonb_object_keys(p_payload))<>2
   or not(p_payload ?& array['envelope','exportCookieHash'])
   or coalesce(p_payload->>'exportCookieHash','')!~'^[0-9a-f]{64}$' then raise exception using errcode='22023',message='invalid_request'; end if;
  -- The originating profile is already locked by the authority helper. All
  -- create calls for this account therefore serialize this complete live check.
  if exists(select 1 from public.generated_exports old left join private.export_archive_jobs prior on old.id=prior.export_id
   where old.requester_principal_id=(capture->>'principalId')::uuid
    and old.target_kind=p_target_kind and old.target_id=p_target_id
    and (prior.route_id=case when p_target_kind='account' then 'api.export' else 'api.subject-export' end or old.archive_version is null)
    and old.status in ('queued','building','ready')
    and coalesce(prior.deadline,old.expires_at,old.requested_at+interval '24 hours')>clock_timestamp()) then
   raise exception using errcode='55000',message='export_already_pending'; end if;
  insert into public.generated_exports(account_id,requester_principal_id,export_kind,target_kind,target_id,purpose,
   lifecycle_revision,principal_graph_revision,principal_graph_fingerprint,export_revision,subject_partitions,archive_version)
  values((p_origin->>'accountId')::uuid,(capture->>'principalId')::uuid,
   case when p_target_kind='account' then 'account_portable' else 'subject_raw' end,p_target_kind,p_target_id,'raw.export',
   (capture->>'lifecycleRevision')::bigint,(capture->>'principalGraphRevision')::bigint,capture->>'authorityReceipt',1,
   capture->'subjectPartitions','archive-segments-v1') returning id into new_id;
  insert into private.export_archive_jobs(export_id,origin,route_id,export_contract,origin_binding,authority_receipt,export_cookie_hash,principal_hash,created_at,deadline)
  values(new_id,p_origin,case when p_target_kind='account' then 'api.export' else 'api.subject-export' end,
   case when p_target_kind='account' then 'account-export-v1' else 'subject-export-v1' end,
   capture->>'originBinding',capture->>'authorityReceipt',p_payload->>'exportCookieHash',capture->>'principalHash',now_at,now_at+interval '24 hours');
  perform private.export_archive_nonce_v1(new_id,'create',p_payload->'envelope',p_csrf_binding);
  perform private.export_archive_current_v1(new_id,capture->>'authorityReceipt');
  return jsonb_build_object('exportId',new_id,'exportRevision',1,'status','queued','authorityReceipt',capture->>'authorityReceipt');
 end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or not(p_payload ? 'exportId') then
  raise exception using errcode='22023',message='invalid_request'; end if;
 select * into e from public.generated_exports where id=(p_payload->>'exportId')::uuid for update;
 select * into j from private.export_archive_jobs where export_id=e.id for update;
 if e.id is null or j.origin is distinct from p_origin or e.target_kind is distinct from p_target_kind
  or e.target_id is distinct from p_target_id
  or p_payload->>'exportCookieHash' is distinct from j.export_cookie_hash then raise exception using errcode='42501',message='not_found'; end if;
 perform private.export_archive_current_v1(e.id,capture->>'authorityReceipt');
 if p_operation='check' then
  if (select count(*) from jsonb_object_keys(p_payload))<>2 or not(p_payload ? 'exportCookieHash') or p_csrf_binding is not null then
   raise exception using errcode='22023',message='invalid_request'; end if;
  return jsonb_build_object('exportId',e.id,'exportRevision',e.export_revision,'status',e.status,'expiresAt',e.expires_at);
 end if;
 if (select count(*) from jsonb_object_keys(p_payload))<>4 or not(p_payload ?& array['envelope','downloadCookieHash','exportCookieHash'])
  or coalesce(p_payload->>'downloadCookieHash','')!~'^[0-9a-f]{64}$' or e.status<>'ready' or e.expires_at<=clock_timestamp()
  or not exists(select 1 from private.export_archive_attempts a where a.id=j.active_attempt and a.state='bytes_complete') then
  raise exception using errcode='42501',message='not_found'; end if;
 perform private.export_archive_nonce_v1(e.id,'open-ready',p_payload->'envelope',p_csrf_binding);
 expiry:=least(e.expires_at,clock_timestamp()+interval '1 hour');
 insert into private.export_archive_downloads(export_id,attempt_id,export_revision,cookie_hash,authority_receipt,expires_at,idle_expires_at)
 values(e.id,j.active_attempt,e.export_revision,p_payload->>'downloadCookieHash',j.authority_receipt,expiry,least(expiry,clock_timestamp()+interval '5 minutes'))
 returning id into download_id;
 perform private.export_archive_current_v1(e.id,j.authority_receipt);
 return jsonb_build_object('downloadSessionId',download_id,'expiresAt',expiry,'chunkBytes',4000000,'sizeBytes',e.byte_count,'sha256',e.archive_sha256);
end $$;

-- One fresh attempt per claim. Lease renewal never adopts old attempt bytes;
-- an expired attempt must enter cleanup and a replacement begins at ordinal 0.
create function public.export_archive_worker_v1(p_operation text,p_export_id uuid,p_attempt_id uuid,
 p_authority_receipt text,p_payload jsonb default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare e public.generated_exports%rowtype; j private.export_archive_jobs%rowtype;
 a private.export_archive_attempts%rowtype; s private.export_archive_segments%rowtype;
 n bigint; off_at bigint; size_at integer; key_at text; item jsonb; descriptors jsonb; count_at bigint;
 bytes_at bigint; pages_at bigint; deadline_at timestamptz; actual_page bigint; result jsonb;
begin
 if p_operation is null or p_operation not in ('preflight','begin','check','renew','reserve','acknowledge','page','bytes-complete')
  or p_attempt_id is null or p_attempt_id::text!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
  raise exception using errcode='22023',message='invalid_request'; end if;
 -- Follow source locks before job/attempt locks in every authority-capable RPC.
 perform private.export_archive_current_v1(p_export_id,p_authority_receipt);
 select * into e from public.generated_exports where id=p_export_id for update;
 select * into j from private.export_archive_jobs where export_id=p_export_id for update;
 if p_operation='preflight' then
  if p_payload is not null or e.status<>'queued' or j.active_attempt is not null
   or exists(select 1 from private.export_archive_attempts where id=p_attempt_id) then
   raise exception using errcode='42501',message='not_found'; end if;
  -- The core checks authority before beginAttempt. This check admits no write
  -- and cannot resurrect an existing attempt; begin still performs its own CAS.
  perform private.export_archive_current_v1(p_export_id,p_authority_receipt);
  return jsonb_build_object('authorityReceipt',j.authority_receipt,'principalHash',j.principal_hash,
   'deadline',j.deadline-interval '30 seconds');
 end if;
 if p_operation='begin' then
  if p_payload is not null or e.status not in ('queued','building') or (j.active_attempt is not null and exists(
   select 1 from private.export_archive_attempts where id=j.active_attempt and state in ('writing','bytes_complete'))) then
   raise exception using errcode='55000',message='export_attempt_unavailable'; end if;
  deadline_at:=least(clock_timestamp()+interval '5 minutes',j.deadline-interval '30 seconds');
  if deadline_at<=clock_timestamp()+interval '30 seconds' then raise exception using errcode='55000',message='export_expired'; end if;
  insert into private.export_archive_attempts(id,export_id,authority_receipt,lease_expires_at)
   values(p_attempt_id,p_export_id,j.authority_receipt,deadline_at);
  update private.export_archive_jobs set active_attempt=p_attempt_id where export_id=p_export_id;
  update public.generated_exports set status='building' where id=p_export_id;
  perform private.export_archive_current_v1(p_export_id,p_authority_receipt);
  return jsonb_build_object('attemptId',p_attempt_id,'leaseExpiresAt',deadline_at,'principalHash',j.principal_hash);
 end if;
 select * into a from private.export_archive_attempts where id=p_attempt_id and export_id=p_export_id for update;
 if a.id is null or j.active_attempt is distinct from a.id or a.state<>'writing'
  or a.lease_expires_at<=clock_timestamp() or a.authority_receipt is distinct from p_authority_receipt then
  raise exception using errcode='42501',message='not_found'; end if;
 if p_operation in ('check','renew') then
  if p_payload is not null then raise exception using errcode='22023',message='invalid_request'; end if;
  if p_operation='renew' then
   update private.export_archive_attempts set lease_expires_at=least(clock_timestamp()+interval '5 minutes',j.deadline-interval '30 seconds')
    where id=a.id returning lease_expires_at into deadline_at;
  else deadline_at:=a.lease_expires_at; end if;
  result:=jsonb_build_object('authorityReceipt',j.authority_receipt,'leaseExpiresAt',deadline_at);
 elsif p_operation in ('reserve','acknowledge') then
  if p_payload is null or jsonb_typeof(p_payload)<>'object'
   or (select count(*) from jsonb_object_keys(p_payload))<>(case when p_operation='reserve' then 5 else 6 end)
   or not(p_payload ?& array['ordinal','offset','sizeBytes','sha256','objectKey'])
   or jsonb_typeof(p_payload->'ordinal') is distinct from 'number'
   or jsonb_typeof(p_payload->'offset') is distinct from 'number'
   or jsonb_typeof(p_payload->'sizeBytes') is distinct from 'number'
   or (p_operation='acknowledge' and (not(p_payload ? 'objectId') or jsonb_typeof(p_payload->'objectId') is distinct from 'string')) then
   raise exception using errcode='22023',message='invalid_request'; end if;
  n:=(p_payload->>'ordinal')::bigint; off_at:=(p_payload->>'offset')::bigint; size_at:=(p_payload->>'sizeBytes')::integer;
  key_at:=j.principal_hash||'/'||e.id::text||'/'||a.id::text||'-'||n::text||'.part';
  if n is null or off_at is null or size_at is null or n<0 or n>2251799813 or off_at<>n*4000000
   or size_at not between 1 and 4000000 or off_at+size_at>9007199254740991
   or p_payload->>'objectKey' is distinct from key_at or coalesce(p_payload->>'sha256','')!~'^[0-9a-f]{64}$' then
   raise exception using errcode='22023',message='invalid_request'; end if;
  if p_operation='reserve' then
   -- One outstanding reservation, sequential extents, no object adoption.
   if a.lease_expires_at<=clock_timestamp()+interval '30 seconds'
    or exists(select 1 from private.export_archive_segments where attempt_id=a.id and acknowledged_at is null)
    or n<>a.segment_count or off_at<>a.byte_count then raise exception using errcode='55000',message='export_sequence'; end if;
   insert into private.export_archive_segments(attempt_id,ordinal,byte_offset,byte_count,sha256,object_key)
    values(a.id,n,off_at,size_at,p_payload->>'sha256',key_at);
  else
   select * into s from private.export_archive_segments where attempt_id=a.id and ordinal=n for update;
   if s.attempt_id is null or s.acknowledged_at is not null or s.byte_offset<>off_at or s.byte_count<>size_at
    or s.sha256 is distinct from p_payload->>'sha256' or s.object_key is distinct from key_at
    or (p_payload->>'objectId')::uuid is null then raise exception using errcode='42501',message='not_found'; end if;
   perform 1 from storage.objects obj where obj.id=(p_payload->>'objectId')::uuid and obj.bucket_id='exports'
    and obj.name=key_at and jsonb_typeof(obj.metadata->'size')='number' and (obj.metadata->>'size')::numeric=size_at for share;
   if not found then raise exception using errcode='42501',message='export_object_unavailable'; end if;
   update private.export_archive_segments set object_id=(p_payload->>'objectId')::uuid,acknowledged_at=clock_timestamp()
    where attempt_id=a.id and ordinal=n;
   update private.export_archive_attempts set segment_count=segment_count+1,byte_count=byte_count+size_at where id=a.id;
  end if;
  result:=jsonb_build_object('ordinal',n,'authorityReceipt',j.authority_receipt);
 elsif p_operation='page' then
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or (select count(*) from jsonb_object_keys(p_payload))<>2
   or not(p_payload ?& array['page','segments']) or jsonb_typeof(p_payload->'segments')<>'array'
   or jsonb_typeof(p_payload->'page') is distinct from 'number'
   or jsonb_array_length(p_payload->'segments') not between 1 and 128 then
   raise exception using errcode='22023',message='invalid_request'; end if;
  actual_page:=(p_payload->>'page')::bigint;
  if actual_page is null or actual_page<>a.page_count or (actual_page>0 and exists(
    select 1 from private.export_archive_manifest_pages where attempt_id=a.id and page=actual_page-1 and jsonb_array_length(segments)<>128)) then
   raise exception using errcode='55000',message='export_sequence'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('ordinal',s.ordinal,'offset',s.byte_offset,'sizeBytes',s.byte_count,
   'sha256',s.sha256,'objectKey',s.object_key,'objectId',s.object_id) order by s.ordinal),'[]') into descriptors
   from private.export_archive_segments s where s.attempt_id=a.id and s.ordinal>=actual_page*128
    and s.ordinal<actual_page*128+jsonb_array_length(p_payload->'segments') and s.acknowledged_at is not null;
  if descriptors is distinct from p_payload->'segments' then raise exception using errcode='42501',message='not_found'; end if;
  insert into private.export_archive_manifest_pages(attempt_id,page,first_ordinal,segments,page_sha256)
   values(a.id,actual_page,actual_page*128,descriptors,encode(extensions.digest(descriptors::text,'sha256'),'hex'));
  update private.export_archive_attempts set page_count=page_count+1 where id=a.id;
  result:=jsonb_build_object('page',actual_page,'authorityReceipt',j.authority_receipt);
 else
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or (select count(*) from jsonb_object_keys(p_payload))<>5
   or not(p_payload ?& array['sizeBytes','segmentCount','pageCount','sha256','manifestSha256'])
   or jsonb_typeof(p_payload->'sizeBytes') is distinct from 'number'
   or jsonb_typeof(p_payload->'segmentCount') is distinct from 'number'
   or jsonb_typeof(p_payload->'pageCount') is distinct from 'number'
   or coalesce(p_payload->>'sha256','')!~'^[0-9a-f]{64}$' or coalesce(p_payload->>'manifestSha256','')!~'^[0-9a-f]{64}$' then
   raise exception using errcode='22023',message='invalid_request'; end if;
  select count(*),coalesce(sum(byte_count),0) into count_at,bytes_at from private.export_archive_segments where attempt_id=a.id;
  select coalesce(sum(jsonb_array_length(segments)),0) into pages_at from private.export_archive_manifest_pages where attempt_id=a.id;
  if count_at=0 or exists(select 1 from private.export_archive_segments where attempt_id=a.id and acknowledged_at is null)
   or count_at<>a.segment_count or bytes_at<>a.byte_count or pages_at<>count_at
   or a.page_count<>(count_at+127)/128
   or (p_payload->>'sizeBytes')::bigint is distinct from bytes_at
   or (p_payload->>'segmentCount')::bigint is distinct from count_at
   or (p_payload->>'pageCount')::bigint is distinct from a.page_count then
   raise exception using errcode='55000',message='export_incomplete'; end if;
  -- These producer digests are recorded, not independently recomputed from
  -- provider bytes by SQL. ZIP64/member completion and publication stay held.
  update private.export_archive_attempts set state='bytes_complete',stopped_at=clock_timestamp(),
   cleanup_not_before=lease_expires_at+interval '30 seconds',archive_sha256=p_payload->>'sha256',
   manifest_sha256=p_payload->>'manifestSha256' where id=a.id;
  result:=jsonb_build_object('state','bytes-complete','authorityReceipt',j.authority_receipt,
   'sizeBytes',bytes_at,'segmentCount',count_at,'pageCount',a.page_count);
 end if;
 perform private.export_archive_current_v1(p_export_id,p_authority_receipt);
 if (select lease_expires_at from private.export_archive_attempts where id=a.id)<=clock_timestamp() then
  raise exception using errcode='42501',message='not_found'; end if;
 return result;
end $$;

-- Cleanup survives logout/revocation. Its selection is exact owned reservations,
-- never a bucket prefix scan. ACK records are retained until a separately proved
-- provider late-write fence permits completion; this migration has no such RPC.
create function public.export_archive_cleanup_v1(p_operation text,p_export_id uuid,p_attempt_id uuid,p_payload jsonb default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare e public.generated_exports%rowtype; j private.export_archive_jobs%rowtype;
 a private.export_archive_attempts%rowtype; result jsonb; after_ordinal bigint;
begin
 if p_operation is null or p_operation not in ('stop','list','acknowledge-delete') then
  raise exception using errcode='22023',message='invalid_request'; end if;
 select * into e from public.generated_exports where id=p_export_id for update;
 select * into j from private.export_archive_jobs where export_id=p_export_id for update;
 select * into a from private.export_archive_attempts where id=p_attempt_id and export_id=p_export_id for update;
 if j.export_id is null or a.id is null then raise exception using errcode='42501',message='not_found'; end if;
 if p_operation='stop' then
  if p_payload is not null or a.state not in ('writing','bytes_complete','cleanup_pending') then
   raise exception using errcode='22023',message='invalid_request'; end if;
  update private.export_archive_attempts set state='cleanup_pending',stopped_at=coalesce(stopped_at,clock_timestamp()),
   cleanup_not_before=greatest(coalesce(cleanup_not_before,'-infinity'),lease_expires_at+interval '30 seconds') where id=a.id;
  update private.export_archive_downloads set revoked_at=coalesce(revoked_at,clock_timestamp()) where attempt_id=a.id;
  if j.active_attempt=a.id then
   update private.export_archive_jobs set active_attempt=null where export_id=e.id;
   update public.generated_exports set status='failed',completed_at=null,expires_at=null where id=e.id;
  end if;
  return jsonb_build_object('state','cleanup-pending','notBefore',a.lease_expires_at+interval '30 seconds');
 end if;
 if a.state<>'cleanup_pending' or a.cleanup_not_before>clock_timestamp() then
  raise exception using errcode='55000',message='export_cleanup_not_due'; end if;
 if p_operation='list' then
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or (select count(*) from jsonb_object_keys(p_payload))<>1
   or not(p_payload ? 'afterOrdinal') then raise exception using errcode='22023',message='invalid_request'; end if;
  after_ordinal:=(p_payload->>'afterOrdinal')::bigint;
  if after_ordinal is null or after_ordinal< -1 then raise exception using errcode='22023',message='invalid_request'; end if;
  select coalesce(jsonb_agg(to_jsonb(page) order by ordinal),'[]') into result from (
   select ordinal,object_key as "objectKey",object_id as "objectId" from private.export_archive_segments
    where attempt_id=a.id and ordinal>after_ordinal order by ordinal limit 128)page;
  return result;
 end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or (select count(*) from jsonb_object_keys(p_payload))<>2
  or not(p_payload ?& array['ordinal','objectKey']) then raise exception using errcode='22023',message='invalid_request'; end if;
 update private.export_archive_segments set delete_acknowledged_at=clock_timestamp()
  where attempt_id=a.id and ordinal=(p_payload->>'ordinal')::bigint and object_key=p_payload->>'objectKey';
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 return jsonb_build_object('state','delete-acknowledged','cleanupComplete',false);
end $$;

-- The byte-only core cannot prove complete authorized archive membership or
-- provider late-write exclusion. Do not expose a ready session until those
-- remaining integrations replace this explicit publication hold.
create function private.guard_segmented_export_publication_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog,private as $$
begin
 if tg_op='UPDATE' and old.archive_version='archive-segments-v1' and row(new.archive_version,new.account_id,
  new.requester_principal_id,new.export_kind,new.target_kind,new.target_id,new.purpose,new.lifecycle_revision,
  new.grant_revision,new.principal_graph_revision,new.principal_graph_fingerprint,new.export_revision,new.subject_partitions,new.requested_at)
  is distinct from row(old.archive_version,old.account_id,old.requester_principal_id,old.export_kind,old.target_kind,old.target_id,
  old.purpose,old.lifecycle_revision,old.grant_revision,old.principal_graph_revision,old.principal_graph_fingerprint,old.export_revision,old.subject_partitions,old.requested_at) then
  raise exception using errcode='23514',message='export_identity_immutable'; end if;
 if new.archive_version='archive-segments-v1' and new.status='ready' then
  raise exception using errcode='55000',message='export_publication_not_integrated'; end if;
 return new;
end $$;
create trigger guard_segmented_export_publication before insert or update on public.generated_exports
 for each row execute function private.guard_segmented_export_publication_v1();

revoke all on function private.export_archive_authority_v1(jsonb,text,uuid),private.export_archive_current_v1(uuid,text),
 private.export_archive_nonce_v1(uuid,text,jsonb,text),private.guard_segmented_export_publication_v1()
 from public,anon,authenticated,inherit_upload_only,service_role;
revoke all on function public.export_archive_request_v1(text,jsonb,text,uuid,jsonb,text),
 public.export_archive_worker_v1(text,uuid,uuid,text,jsonb),public.export_archive_cleanup_v1(text,uuid,uuid,jsonb)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function public.export_archive_request_v1(text,jsonb,text,uuid,jsonb,text),
 public.export_archive_worker_v1(text,uuid,uuid,text,jsonb),public.export_archive_cleanup_v1(text,uuid,uuid,jsonb) to service_role;

-- Existing account deletion removes generated_exports. Empty queues/attempts
-- have admitted no object write and must not strand that path. Reserved keys
-- always survive: no cascade or metadata deletion can stand in for Storage ACK
-- plus the still-unimplemented late-write fence. Nonce identities are stripped
-- while their one-use hash survives the short token replay window.
create function private.guard_export_archive_delete_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog,private as $$
begin
 if old.archive_version is distinct from 'archive-segments-v1' then return old; end if;
 perform 1 from private.export_archive_jobs where export_id=old.id for update;
 perform 1 from private.export_archive_attempts where export_id=old.id order by id for update;
 if exists(select 1 from private.export_archive_segments s join private.export_archive_attempts a on a.id=s.attempt_id
   where a.export_id=old.id) then raise exception using errcode='55000',message='export_cleanup_incomplete'; end if;
 update private.export_archive_jobs set active_attempt=null where export_id=old.id;
 delete from private.export_archive_downloads where export_id=old.id;
 delete from private.export_archive_manifest_pages where attempt_id in(select id from private.export_archive_attempts where export_id=old.id);
 delete from private.export_archive_attempts where export_id=old.id;
 update private.export_archive_nonce_uses set envelope=null,operation=null,consumed_at=null,export_id=null where export_id=old.id;
 delete from private.export_archive_jobs where export_id=old.id;
 return old;
end $$;
revoke all on function private.guard_export_archive_delete_v1() from public,anon,authenticated,inherit_upload_only,service_role;
create trigger guard_export_archive_delete before delete on public.generated_exports
 for each row execute function private.guard_export_archive_delete_v1();

-- Bounded discovery for a future dispatcher. Selecting an ID authorizes no
-- source or object read; begin/stop still take their exact locks and checks.
create function public.export_archive_due_v1(p_kind text,p_after uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare result jsonb;
begin
 if p_kind='generation' then
  select coalesce(jsonb_agg(to_jsonb(page) order by "exportId"),'[]') into result from (
   select j.export_id as "exportId",j.authority_receipt as "authorityReceipt",j.principal_hash as "principalHash",
    j.deadline-interval '30 seconds' as "deadline" from private.export_archive_jobs j
    join public.generated_exports e on e.id=j.export_id where e.status='queued' and j.active_attempt is null
     and j.deadline>clock_timestamp()+interval '1 minute' and (p_after is null or j.export_id>p_after)
    order by j.export_id limit 16)page;
 elsif p_kind='cleanup' then
  select coalesce(jsonb_agg(to_jsonb(page) order by "attemptId"),'[]') into result from (
   select a.export_id as "exportId",a.id as "attemptId" from private.export_archive_attempts a
    join private.export_archive_jobs j on j.export_id=a.export_id
    where (p_after is null or a.id>p_after) and
     ((a.state='writing' and a.lease_expires_at<=clock_timestamp())
      or (a.state='bytes_complete' and j.deadline<=clock_timestamp())
      or (a.state='cleanup_pending' and a.cleanup_not_before<=clock_timestamp())) order by a.id limit 16)page;
 else raise exception using errcode='22023',message='invalid_request'; end if;
 return result;
end $$;
revoke all on function public.export_archive_due_v1(text,uuid) from public,anon,authenticated,inherit_upload_only;
grant execute on function public.export_archive_due_v1(text,uuid) to service_role;
