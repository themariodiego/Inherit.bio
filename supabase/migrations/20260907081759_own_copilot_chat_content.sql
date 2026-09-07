-- Canonical self Copilot: no model authority is inferred from raw-data rights.
-- The provider migration owns the independent purpose/recipient/session gate.
alter table public.chats add column canonical_authority jsonb;
alter table public.chat_messages add column canonical_projection jsonb;
alter table public.chat_messages add column canonical_citations jsonb not null default '[]';
create function private.valid_own_copilot_citations_v1(value jsonb) returns boolean
language plpgsql immutable security invoker set search_path=pg_catalog as $$
begin
 if jsonb_typeof(value) is distinct from 'array' then return false; end if;
 if jsonb_array_length(value)>100 then return false; end if;
 return not exists(select 1 from jsonb_array_elements(value) c where jsonb_typeof(c) is distinct from 'object'
  or c-array['id','label','href']<>'{}'::jsonb or not(c ?& array['id','label','href'])
  or jsonb_typeof(c->'id') is distinct from 'string' or length(coalesce(c->>'id','')) not between 1 and 2000
  or jsonb_typeof(c->'label') is distinct from 'string' or length(coalesce(c->>'label','')) not between 1 and 100000
  or jsonb_typeof(c->'href') is distinct from 'string' or length(coalesce(c->>'href','')) not between 1 and 4000
  or coalesce(c->>'href','') !~ '^(/genome/me/reports/[^/?#]+|https://pubmed\.ncbi\.nlm\.nih\.gov/[0-9]{6,9}/|https://doi\.org/[^[:space:]]+)$');
end; $$;
revoke all on function private.valid_own_copilot_citations_v1(jsonb) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.valid_own_copilot_citations_v1(jsonb) to service_role;
alter table public.chat_messages add constraint canonical_chat_citations_valid
 check(private.valid_own_copilot_citations_v1(canonical_citations) is true);
create table private.own_copilot_nonces (
 nonce_hash text primary key check(nonce_hash ~ '^[0-9a-f]{64}$'),
 account_id uuid not null references auth.users(id) on delete cascade,
 session_id uuid not null references auth.sessions(id) on delete cascade,
 authority_hash text not null,
 projection_hash text not null,
 expires_at timestamptz not null,
 completed_at timestamptz
);
alter table private.own_copilot_nonces enable row level security;
revoke all on private.own_copilot_nonces from public,anon,authenticated,inherit_upload_only;

-- Snapshot only sources that are currently prepared under the exact store,
-- session, subject, object and normalization authority. This function has no
-- standalone public wrapper; every caller first requires Copilot authority.
create function private.own_copilot_projection_v1(a jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare f public.genome_files%rowtype; sources jsonb:='[]'; legacy_sources jsonb:='[]'; completed jsonb; g jsonb; purpose text;
begin
 for f in select * from public.genome_files where subject_id=(a->>'subjectId')::uuid
  and user_id=(a->>'accountId')::uuid and single_logical_sample_verified_at is not null
  order by id for share loop
  if f.tier is distinct from 1 or f.status is null or f.status not in ('stored','annotated')
   or f.structural_validator_version is distinct from 'single-logical-sample-v1'
   or f.normalization_completed_at is null or f.normalization_source_revision is distinct from f.upload_revision
   or f.build is null or f.build not in ('GRCh37','GRCh38') then continue; end if;
  perform 1 from private.own_normalization_runs n join public.genome_storage_objects o on o.genome_file_id=f.id
   join storage.objects s on s.id=o.object_id where n.file_id=f.id and n.account_id=f.user_id and n.state='complete'
   and n.manifest->>'rawSha256'=f.sha256 and n.manifest->>'decodedSha256'=f.source_sha256
   and n.manifest->'sourceRevision'=to_jsonb(f.upload_revision)
   and n.manifest->>'objectId'=f.storage_object_id::text and n.manifest->>'objectKey'=f.bucket_path
   and o.object_id=f.storage_object_id and o.object_name=f.bucket_path and o.bucket_id='genomes'
   and o.sha256=f.sha256 and o.byte_count=f.size_bytes and o.object_revision=f.upload_revision
   and o.state='current' and o.revoked_at is null and s.bucket_id=o.bucket_id and s.name=o.object_name
   and (s.metadata->>'size')::numeric=f.size_bytes;
  if not found then continue; end if;
  completed:='[]';
  foreach purpose in array array['reports.monogenic','reports.polygenic'] loop
   begin
    g:=private.current_own_report_grant_read_v1((a->>'accountId')::uuid,(a->>'sessionId')::uuid,f.id,purpose);
    if private.own_analysis_completion_matches_v1(f.id,purpose,g) is true then
     select completed||jsonb_build_array(jsonb_build_object('purpose',purpose,
      'authority',g #- '{context,authSessionRevision}' #- '{context,originatingSessionRevision}',
      'runId',r.id,'completedAt',r.completed_at,'resultHash',encode(extensions.digest(convert_to(r.result::text,'UTF8'),'sha256'),'hex')))
      into completed from private.own_analysis_runs r where r.file_id=f.id and r.purpose=purpose and r.state='complete';
    end if;
   exception when insufficient_privilege or object_not_in_prerequisite_state then null;
   end;
  end loop;
  sources:=sources||jsonb_build_array(jsonb_build_object('id',f.id,'revision',f.upload_revision,'sha256',f.sha256,
   'decodedSha256',f.source_sha256,'objectId',f.storage_object_id,'normalizedAt',f.normalization_completed_at,
   'build',f.build,'completed',completed));
 end loop;
 -- Compatibility uses the existing processed-file authority, explicitly
 -- without certifying a historical normalization manifest. Canonical source
 -- identity or a finalized restricted lease can never fall into this branch.
 for f in select * from public.genome_files lf where subject_id=(a->>'subjectId')::uuid
  and user_id=(a->>'accountId')::uuid and status='annotated'
  and single_logical_sample_verified_at is null and structural_validator_version is null
  and storage_object_id is null and source_sha256 is null and normalization_completed_at is null
  and sha256 ~ '^[0-9a-f]{64}$' and build in('GRCh37','GRCh38')
  and not exists(select 1 from public.upload_sessions u where u.finalized_file_id=lf.id)
  and not exists(select 1 from private.own_normalization_runs n where n.file_id=lf.id)
  and not exists(select 1 from public.genome_storage_objects o where o.genome_file_id=lf.id)
  order by id for share loop
  legacy_sources:=legacy_sources||jsonb_build_array(jsonb_build_object('id',f.id,'sha256',f.sha256,'build',f.build,'createdAt',f.created_at));
 end loop;
 return jsonb_build_object('sources',sources,'legacySources',legacy_sources,'unavailableSources',coalesce((
  select jsonb_agg(jsonb_build_object('id',uf.id,'reason','source_unavailable') order by uf.id)
  from public.genome_files uf where uf.subject_id=(a->>'subjectId')::uuid
   and not exists(select 1 from jsonb_array_elements(sources||legacy_sources) s where s->>'id'=uf.id::text)
 ),'[]'::jsonb));
end; $$;
revoke all on function private.own_copilot_projection_v1(jsonb) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.own_copilot_projection_v1(jsonb) to service_role;

create function private.own_copilot_chat_v1(p_operation text,p_account_id uuid,p_session_id uuid,p_subject_id uuid,
 p_authority jsonb,p_projection jsonb,p_chat_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare a jsonb; projection jsonb; c public.chats%rowtype; result jsonb; ordinal bigint; turn_id uuid:=gen_random_uuid();
 source jsonb; completed jsonb; item jsonb; cutoff bigint; purpose_keys text[]; grant_revisions bigint[];
begin
 if p_operation is null or p_operation not in ('prepare','begin','check','calls','reports','prs','history','list','commit')
  or p_payload is null or jsonb_typeof(p_payload) is distinct from 'object' then
  raise exception using errcode='22023',message='invalid_request'; end if;
 a:=private.own_copilot_authority_v1(p_account_id,p_session_id,p_subject_id,p_authority);
 if a is null or (p_operation<>'prepare' and a is distinct from p_authority) then
  raise exception using errcode='42501',message='not_found'; end if;
 projection:=private.own_copilot_projection_v1(a);
 if p_operation='prepare' then
  if p_projection is not null or p_chat_id is not null or p_payload<>'{}'::jsonb then
   raise exception using errcode='22023',message='invalid_request'; end if;
  return projection;
 end if;
 if p_operation in ('begin','check','calls','reports','prs','commit') and projection is distinct from p_projection then
  raise exception using errcode='42501',message='not_found'; end if;
 if p_operation='begin' then
  if p_chat_id is not null or p_payload-array['nonceHash','expiresAt']<>'{}'::jsonb
   or not(p_payload ?& array['nonceHash','expiresAt']) or coalesce(p_payload->>'nonceHash','') !~ '^[0-9a-f]{64}$'
   or jsonb_typeof(p_payload->'expiresAt') is distinct from 'string'
   or (p_payload->>'expiresAt')::timestamptz<=clock_timestamp()
   or (p_payload->>'expiresAt')::timestamptz>clock_timestamp()+interval '10 minutes' then
   raise exception using errcode='22023',message='invalid_request'; end if;
  delete from private.own_copilot_nonces where expires_at<clock_timestamp();
  insert into private.own_copilot_nonces values(p_payload->>'nonceHash',p_account_id,p_session_id,
   encode(extensions.digest(convert_to(a::text,'UTF8'),'sha256'),'hex'),
   encode(extensions.digest(convert_to(projection::text,'UTF8'),'sha256'),'hex'),
   (p_payload->>'expiresAt')::timestamptz,null);
  return 'true';
 end if;
 if p_operation='check' then
  if p_payload<>'{}'::jsonb then raise exception using errcode='22023',message='invalid_request'; end if;
  return 'true';
 end if;
 if p_operation='list' then
  if p_payload<>'{}'::jsonb or p_chat_id is not null then raise exception using errcode='22023',message='invalid_request'; end if;
  -- Session refresh is independently checked now; durable scope is preserved.
  select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from (
   select id,created_at from public.chats lc where user_id=p_account_id and subject_id=p_subject_id
    and canonical_authority is not null and not legacy_unverified
    and ((canonical_authority-'sessionId') #- '{context,originatingSessionRevision}' #- '{context,authSessionRevision}')
      = ((a-'sessionId') #- '{context,originatingSessionRevision}' #- '{context,authSessionRevision}')
    and not exists(select 1 from public.chat_messages lm where lm.chat_id=lc.id
     and (lm.canonical_projection is distinct from projection or lm.legacy_unverified is not false))
   order by created_at desc,id limit 50) x;
  return result;
 end if;
 if p_operation in ('history','commit') and p_chat_id is not null then
  select * into c from public.chats where id=p_chat_id and user_id=p_account_id and subject_id=p_subject_id for update;
  if c.id is null or c.legacy_unverified or c.canonical_authority is null
   or ((c.canonical_authority-'sessionId') #- '{context,originatingSessionRevision}' #- '{context,authSessionRevision}')
      is distinct from ((a-'sessionId') #- '{context,originatingSessionRevision}' #- '{context,authSessionRevision}') then
   raise exception using errcode='42501',message='not_found'; end if;
  if exists(select 1 from public.chat_messages cm where cm.chat_id=c.id
   and (cm.canonical_projection is distinct from projection or cm.legacy_unverified is not false)) then
   raise exception using errcode='42501',message='not_found'; end if;
 end if;
 if p_operation='history' then
  if c.id is null or p_payload<>'{}'::jsonb then raise exception using errcode='42501',message='not_found'; end if;
  -- A stale pair invalidates the dependent chain. Never append after an
  -- omitted prefix: callers must start a new conversation. Retention owns the
  -- physical deletion through its frozen exact-grant manifest.
  select min(turn_ordinal) into cutoff from public.chat_messages where chat_id=c.id
   and (canonical_projection is distinct from projection or legacy_unverified is not false);
  if cutoff is not null then raise exception using errcode='42501',message='not_found'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.turn_ordinal,x.role desc),'[]') into result from (
   select id,role,content,canonical_citations as citations,turn_ordinal,created_at from public.chat_messages where chat_id=c.id and user_id=p_account_id
    and not legacy_unverified and (cutoff is null or turn_ordinal<cutoff) order by turn_ordinal desc,role limit 100) x;
  return jsonb_build_object('chatId',c.id,'messages',result,'projection',projection,
   'lastOrdinal',coalesce((select max(turn_ordinal) from public.chat_messages where chat_id=c.id),0));
 end if;
 if p_operation='calls' then
  if p_payload-array['rsids','offset']<>'{}'::jsonb or not(p_payload ?& array['rsids','offset'])
   or jsonb_typeof(p_payload->'rsids') is distinct from 'array' or jsonb_array_length(p_payload->'rsids') not between 1 and 50
   or coalesce(p_payload->>'offset','') !~ '^(0|[1-9][0-9]*)$'
   or exists(select 1 from jsonb_array_elements(p_payload->'rsids') r where r::text !~ '^[1-9][0-9]{0,14}$') then
   raise exception using errcode='22023',message='invalid_request'; end if;
  select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from (
   select v.file_id,v.rsid,v.chrom,v.pos,v.ref,v.alt,v.genotype,true as usable from public.user_variants v
    where v.subject_id=p_subject_id and v.user_id=p_account_id
     and v.file_id in(select (s->>'id')::uuid from jsonb_array_elements((projection->'sources')||(projection->'legacySources')) s)
     and v.rsid in(select r::bigint from jsonb_array_elements_text(p_payload->'rsids') r)
   union all
   select v.file_id,v.rsid,v.chrom,v.pos,v.ref,v.alt,v.genotype,v.usable from public.report_observed_calls v
    join public.genome_files f on f.id=v.file_id where v.subject_id=p_subject_id and v.user_id=p_account_id
     and v.file_id in(select (s->>'id')::uuid from jsonb_array_elements(projection->'sources') s)
     and v.source_sha256=f.sha256 and v.source_build=f.build and v.extraction_version='vcf-literal-diploid-snp-v1'
     and v.rsid in(select r::bigint from jsonb_array_elements_text(p_payload->'rsids') r)
   order by file_id,rsid,chrom,pos,genotype,ref,alt,usable offset (p_payload->>'offset')::integer limit 1000) x;
  return result;
 end if;
 if p_operation in ('reports','prs') then
  if p_payload-array['offset']<>'{}'::jsonb or coalesce(p_payload->>'offset','') !~ '^(0|[1-9][0-9]*)$' then
   raise exception using errcode='22023',message='invalid_request'; end if;
  if p_operation='reports' then
   select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from (
    select f.id as file_id,r.purpose,r.completed_at,v.value as report from jsonb_array_elements(projection->'sources') s
     join public.genome_files f on f.id=(s->>'id')::uuid
     cross join lateral jsonb_array_elements(s->'completed') g
     join private.own_analysis_runs r on r.id=(g->>'runId')::uuid
     cross join lateral jsonb_array_elements(r.result->'reports') with ordinality v(value,ord)
    order by f.id,r.purpose,v.ord offset (p_payload->>'offset')::integer limit 1000) x;
  else
   select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from (
    select v.file_id,v.pgs_id,v.matched,v.computed_at,m.n_variants from public.user_prs v
     left join public.prs_scores m on m.pgs_id=v.pgs_id
    where v.subject_id=p_subject_id and v.user_id=p_account_id and exists(
     select 1 from jsonb_array_elements(projection->'sources') s cross join lateral jsonb_array_elements(s->'completed') g
      where (s->>'id')::uuid=v.file_id and g->>'purpose'='reports.polygenic')
    order by v.file_id,v.pgs_id,v.id offset (p_payload->>'offset')::integer limit 1000) x;
  end if;
  return result;
 end if;
 if p_operation='commit' then
  if p_payload-array['message','answer','citations','lastOrdinal','nonceHash']<>'{}'::jsonb or not(p_payload ?& array['message','answer','citations','lastOrdinal','nonceHash'])
   or jsonb_typeof(p_payload->'message') is distinct from 'string' or jsonb_typeof(p_payload->'answer') is distinct from 'string'
   or length(p_payload->>'message') not between 1 and 8000 or length(p_payload->>'answer') not between 1 and 64000
   or coalesce(p_payload->>'lastOrdinal','') !~ '^(0|[1-9][0-9]*)$'
   or private.valid_own_copilot_citations_v1(p_payload->'citations') is not true then raise exception using errcode='22023',message='invalid_request'; end if;
  if c.id is null then
   if p_chat_id is not null or p_payload->>'lastOrdinal'<>'0' then raise exception using errcode='42501',message='not_found'; end if;
   update private.own_copilot_nonces set completed_at=clock_timestamp()
    where nonce_hash=p_payload->>'nonceHash' and account_id=p_account_id and session_id=p_session_id
     and completed_at is null and expires_at>clock_timestamp()
     and authority_hash=encode(extensions.digest(convert_to(a::text,'UTF8'),'sha256'),'hex')
     and projection_hash=encode(extensions.digest(convert_to(projection::text,'UTF8'),'sha256'),'hex');
   if not found then raise exception using errcode='42501',message='not_found'; end if;
   insert into public.chats(user_id,scope_kind,subject_id,lifecycle_revision,provider_classification,runtime_attestation_revision,
    model_recipient_revision,authorization_fingerprint,legacy_unverified,canonical_authority)
   values(p_account_id,'self',p_subject_id,(a->'context'->>'subjectLifecycleRevision')::bigint,a->>'providerClass',1,
    (a->>'recipientRevision')::bigint,encode(extensions.digest(convert_to(a::text,'UTF8'),'sha256'),'hex'),false,a) returning * into c;
  elsif p_payload->'nonceHash' is distinct from 'null'::jsonb then
   raise exception using errcode='22023',message='invalid_request';
  end if;
  select coalesce(max(turn_ordinal),0)+1 into ordinal from public.chat_messages where chat_id=c.id;
  if ordinal<> (p_payload->>'lastOrdinal')::bigint+1 then raise exception using errcode='40001',message='chat_changed'; end if;
  -- All source purpose grants are conservatively bound, even if a model used a subset.
  select array_agg(distinct g->>'purpose'),array_agg(distinct (g->'authority'->>'grantRevision')::bigint)
   into purpose_keys,grant_revisions from jsonb_array_elements(projection->'sources') s cross join lateral jsonb_array_elements(s->'completed') g;
  for item in select jsonb_build_object('role','user','text',p_payload->>'message') union all
   select jsonb_build_object('role','assistant','text',p_payload->>'answer') loop
   insert into public.chat_messages(chat_id,user_id,role,content,turn_id,turn_ordinal,paired_role,scope_revision,
    authorization_fingerprint,retrieved_subject_ids,retrieved_purpose_keys,contributor_ids,grant_revisions,lifecycle_revisions,
    provider_classification,runtime_attestation_revision,model_recipient_revision,legacy_unverified,canonical_projection,canonical_citations,citation_ids)
   values(c.id,p_account_id,item->>'role',jsonb_build_array(jsonb_build_object('type','text','text',item->>'text')),
    turn_id,ordinal,item->>'role',c.scope_revision,c.authorization_fingerprint,array[p_subject_id],
    array_append(coalesce(purpose_keys,'{}'),case when a->>'providerClass'='local' then 'copilot.local' else 'copilot.cloud' end),
    array[p_account_id],array_append(coalesce(grant_revisions,'{}'),(a->>'copilotGrantRevision')::bigint),
    array[(a->'context'->>'subjectLifecycleRevision')::bigint],a->>'providerClass',1,(a->>'recipientRevision')::bigint,false,projection,
    case when item->>'role'='assistant' then p_payload->'citations' else '[]'::jsonb end,
    case when item->>'role'='assistant' then array(select x->>'id' from jsonb_array_elements(p_payload->'citations') x) else '{}'::text[] end);
  end loop;
  return jsonb_build_object('chatId',c.id);
 end if;
 raise exception using errcode='22023',message='invalid_request';
end; $$;
revoke all on function private.own_copilot_chat_v1(text,uuid,uuid,uuid,jsonb,jsonb,uuid,jsonb) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.own_copilot_chat_v1(text,uuid,uuid,uuid,jsonb,jsonb,uuid,jsonb) to service_role;
create function public.own_copilot_chat_v1(p_operation text,p_account_id uuid,p_session_id uuid,p_subject_id uuid,
 p_authority jsonb,p_projection jsonb default null,p_chat_id uuid default null,p_payload jsonb default '{}')
returns jsonb language sql security invoker set search_path=pg_catalog as $$
 select private.own_copilot_chat_v1(p_operation,p_account_id,p_session_id,p_subject_id,p_authority,p_projection,p_chat_id,p_payload);
$$;
revoke all on function public.own_copilot_chat_v1(text,uuid,uuid,uuid,jsonb,jsonb,uuid,jsonb) from public,anon,authenticated,inherit_upload_only;
grant execute on function public.own_copilot_chat_v1(text,uuid,uuid,uuid,jsonb,jsonb,uuid,jsonb) to service_role;


-- Frozen exact-grant message membership includes the complete dependent suffix.
-- Account/session changes only hide content; this path does not need a live
-- session or grant in order to finish an already authorized deletion.
create function private.own_copilot_purge_messages_v1(p_account uuid,p_subject uuid,p_grant uuid,p_revision bigint)
returns table(id uuid,chat_id uuid,turn_id uuid,projection_hash text)
language sql stable security definer set search_path=pg_catalog as $fn$
 with affected as (
  select m.chat_id,min(m.turn_ordinal) cutoff from public.chat_messages m join public.chats c on c.id=m.chat_id
  where m.user_id=p_account and c.user_id=p_account and c.subject_id=p_subject
   and c.scope_kind='self' and c.legacy_unverified is false and m.legacy_unverified is false
   and c.canonical_authority is not null and m.canonical_projection is not null
   and ((c.canonical_authority->>'copilotGrantId'=p_grant::text
    and c.canonical_authority->>'copilotGrantRevision'=p_revision::text)
   or exists(select 1 from jsonb_array_elements(m.canonical_projection->'sources') s
     cross join lateral jsonb_array_elements(s->'completed') g
     where g->'authority'->>'grantId'=p_grant::text and g->'authority'->>'grantRevision'=p_revision::text))
  group by m.chat_id
 ) select m.id,m.chat_id,m.turn_id,encode(extensions.digest(convert_to(m.canonical_projection::text,'UTF8'),'sha256'),'hex')
 from affected a join public.chat_messages m on m.chat_id=a.chat_id and m.turn_ordinal>=a.cutoff
 where m.user_id=p_account and m.legacy_unverified is false and m.canonical_projection is not null;
$fn$;
revoke all on function private.own_copilot_purge_messages_v1(uuid,uuid,uuid,bigint) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.own_copilot_purge_messages_v1(uuid,uuid,uuid,bigint) to service_role;

create or replace function private.own_report_purge_scope_v1(p_grant uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog as $fn$
 select jsonb_build_object('accountId',d.recipient_account_id,'subjectId',g.target_id,
  'principalId',g.data_subject_principal_id,'grantId',g.grant_id,'grantRevision',g.grant_revision,
  'purpose',g.purpose,'revokedAt',g.revoked_at,'directionStatus',d.status,'lifecycleRevision',s.lifecycle_revision)
 from public.purpose_grants g join public.directional_grants d on d.grant_id=g.grant_id and d.grant_revision=g.grant_revision
 join public.subjects s on s.id=g.target_id
 join public.subject_principals sp on sp.id=g.data_subject_principal_id
 join public.consent_signatures cs on cs.id=g.signature_id
 where g.grant_id=p_grant and g.target_kind='subject' and s.subject_class='self'
 and s.subject_account_id=d.recipient_account_id and sp.account_id=d.recipient_account_id and sp.subject_id=s.id
 and g.signer_principal_id=g.data_subject_principal_id and d.recipient_principal_id=g.data_subject_principal_id
 and d.direction='self' and d.relationship_id is null and d.pair_id is null
 and g.purpose in('reports.monogenic','reports.polygenic','copilot.local','copilot.cloud')
 and (g.purpose in('reports.monogenic','reports.polygenic') or g.copilot_recipient_revision is not null)
 and g.artifact_key=case g.purpose when 'reports.monogenic' then 'consent.own-monogenic'
 when 'reports.polygenic' then 'consent.own-polygenic' when 'copilot.local' then 'consent.own-copilot-local'
 when 'copilot.cloud' then 'consent.own-copilot-cloud' end
 and cs.signer_account_id=d.recipient_account_id and cs.signer_principal_id=g.signer_principal_id
 and cs.target_kind='subject' and cs.target_id=g.target_id and cs.purpose=g.purpose
 and cs.artifact_key=g.artifact_key and cs.artifact_version=g.artifact_version and cs.artifact_body_sha256=g.artifact_body_sha256
 and d.status in('current','revoked','superseded');
$fn$;
create or replace function private.prepare_own_report_purge_v1(p_grant uuid,p_revoked_at timestamptz default null)
returns uuid language plpgsql security definer set search_path=pg_catalog as $fn$
declare c jsonb; r public.retention_rows%rowtype; m uuid; w public.worker_jobs%rowtype;
 e jsonb; fp text; rev bigint;
begin
 c:=private.own_report_purge_scope_v1(p_grant);
 if c is null then raise exception using errcode='55000',message='own_report_purge_unsupported'; end if;
 -- Same account/subject lock order as canonical grant and generation. No live
 -- consent, session, active-subject or analysis-eligibility gate is used.
 perform 1 from public.profiles where id=(c->>'accountId')::uuid for update;
 perform 1 from public.subjects where id=(c->>'subjectId')::uuid for update;
 perform 1 from public.purpose_grants where grant_id=p_grant for update;
 c:=private.own_report_purge_scope_v1(p_grant);
 if c is null then raise exception using errcode='55000',message='own_report_purge_unsupported'; end if;
 if c->>'revokedAt' is null then
  if p_revoked_at is null or c->>'directionStatus'<>'current' then
   raise exception using errcode='55000',message='own_report_purge_unsupported'; end if;
  c:=jsonb_set(c,'{revokedAt}',to_jsonb(p_revoked_at));
 elsif p_revoked_at is not null and p_revoked_at is distinct from (c->>'revokedAt')::timestamptz then
  raise exception using errcode='55000',message='own_report_purge_binding_invalid';
 end if;
 c:=c-'directionStatus';
 select j.* into w from public.worker_jobs j join public.retention_due_phases d on d.retention_row_id=j.source_binding_id
 where j.computation_revision='own-report-revocation-v1' and d.phase_id='own-report-purpose-purge'
 and d.immutable_envelope->>'grantId'=p_grant::text;
 if w.id is not null then return w.id; end if;
 select coalesce(max(retention_revision),0)+1 into rev from public.retention_rows
 where retention_id='purpose.derived-60s' and target_kind='subject' and target_id=(c->>'subjectId')::uuid;
 insert into public.retention_rows(retention_id,target_kind,target_id,retention_revision,target_lifecycle_revision,
 disposition_revision,fixed_deadline)
 values('purpose.derived-60s','subject',(c->>'subjectId')::uuid,rev,(c->>'lifecycleRevision')::bigint,1,
 (c->>'revokedAt')::timestamptz+interval '60 seconds') returning * into r;
 m:=gen_random_uuid();
 e:=c||jsonb_build_object('version','own-report-revocation-v1','dispositionId',r.id,'dispositionRevision',1,
  'retentionId','purpose.derived-60s','phaseId','own-report-purpose-purge','phaseRevision',1,
  'targetKind','subject','manifestId',m,'manifestRevision',1,'claimRevision',0,'holdRevision',0,
  'deadline',r.fixed_deadline,'manifestClass','purpose-derived-only');
 fp:=encode(extensions.digest(convert_to(e::text,'UTF8'),'sha256'),'hex');
 insert into public.retention_due_phases(retention_row_id,retention_id,phase_id,phase_kind,phase_revision,phase_deadline,
 target_kind,target_id,target_lifecycle_revision,disposition_revision,recipient_authority_kind,recipient_authority_revision,immutable_envelope)
 values(r.id,r.retention_id,'own-report-purpose-purge','purge',1,r.fixed_deadline,'subject',r.target_id,
 r.target_lifecycle_revision,1,'exact-revoked-self-report-grant',(c->>'grantRevision')::bigint,e);
 insert into public.purge_manifests(id,retention_row_id,phase_id,phase_revision,manifest_class,manifest_revision,source_binding_fingerprint)
 values(m,r.id,'own-report-purpose-purge',1,'purpose-derived-only',1,fp);
 -- Own reports persist only the selected journal and its coverage rows. Store
 -- primary keys AND the old grant binding: a reused journal id under a new
 -- grant is not an old output. Raw variants/source objects are never members.
 insert into public.purge_manifest_entries(manifest_id,target_id,store_name,row_key,entry_revision)
 select m,'polygenic-results','public.user_prs',jsonb_build_object('id',p.id,'fileId',p.file_id,'grantId',p_grant),
 row_number() over(order by p.id) from public.user_prs p join private.own_analysis_runs a on a.file_id=p.file_id
 where a.grant_id=p_grant and a.grant_revision=(c->>'grantRevision')::bigint and a.purpose='reports.polygenic'
 and a.account_id=(c->>'accountId')::uuid and a.subject_id=(c->>'subjectId')::uuid
 and p.user_id=a.account_id and p.subject_id=a.subject_id;
 insert into public.purge_manifest_entries(manifest_id,target_id,store_name,row_key,entry_revision)
 select m,'generated-artifacts','private.own_analysis_runs',jsonb_build_object('id',a.id,'fileId',a.file_id,'grantId',p_grant),
 row_number() over(order by a.id) from private.own_analysis_runs a
 where a.grant_id=p_grant and a.grant_revision=(c->>'grantRevision')::bigint
 and a.account_id=(c->>'accountId')::uuid and a.subject_id=(c->>'subjectId')::uuid and a.purpose=c->>'purpose';
 insert into public.purge_manifest_entries(manifest_id,target_id,store_name,row_key,entry_revision)
 select m,'chat-derived-contexts','public.chat_messages',jsonb_build_object('id',x.id,'chatId',x.chat_id,
  'turnId',x.turn_id,'projectionHash',x.projection_hash,'grantId',p_grant),row_number() over(order by x.chat_id,x.id)
 from private.own_copilot_purge_messages_v1((c->>'accountId')::uuid,(c->>'subjectId')::uuid,
  p_grant,(c->>'grantRevision')::bigint) x;
 -- The immutable disposition/phase/manifest precede the compliant enqueue.
 w:=private.enqueue_worker_job_v2((c->>'accountId')::uuid,'revoke_purge','lifecycle.revoke-purge',r.target_id,null,
 'revocation-disposition',r.id,1,fp,'own-report-revocation-v1',null,jsonb_build_object('dispositionId',r.id));
 perform private.append_legal_audit_event('purpose.purge-enqueued',null,'api.consent-revoke','accepted',
 jsonb_build_object('purpose',c->>'purpose','revision',c->'grantRevision'));
 return w.id;
end;
$fn$;
create or replace function private.execute_own_report_purge_v1(p_job uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog set lock_timeout='2s' as $fn$
declare j public.worker_jobs%rowtype; d public.retention_due_phases%rowtype; m public.purge_manifests%rowtype;
 c jsonb; e public.purge_manifest_entries%rowtype; fp text; mh text; token text; replacement uuid;
 deleted integer:=0; changed integer; cursor_value integer:=0;
begin
 -- No generic claim and no caller-selected account/job/source. Arbitrary jobs
 -- remain untouched. Validated historical jobs receive a replacement, never
 -- a fabricated cleanup success or a rewritten immutable dispatch binding.
 select w.* into j from public.worker_jobs w
 where w.id=p_job and w.kind='revoke_purge' and w.output_kind='lifecycle.revoke-purge'
 and w.source_binding_kind='revocation-disposition' and w.target_kind='subject' and w.cohort_id is null
 and w.status='queued' and w.not_before<=clock_timestamp() and w.attempts<w.max_attempts
 and (w.computation_revision='own-report-revocation-v1'
  or (w.computation_revision='family-revoke-purge-v1'
   and private.own_report_purge_scope_v1(w.source_binding_id)->>'accountId'=w.user_id::text))
 order by w.created_at,w.id limit 1;
 if j.id is null then return null; end if;
 perform 1 from public.profiles where id=j.user_id for update;
 perform 1 from public.subjects where id=j.subject_id for update;
 select * into j from public.worker_jobs where id=j.id and status='queued' for update skip locked;
 if j.id is null then return null; end if;
 if j.computation_revision='family-revoke-purge-v1' then
  c:=private.own_report_purge_scope_v1(j.source_binding_id);
  fp:=encode(extensions.digest(convert_to(concat_ws(':','family-revoke-purge-v1',j.source_binding_id::text,
   j.subject_id::text,(j.payload-array['retention_id','manifest_class'])::text),'UTF8'),'sha256'),'hex');
  if c is null or c->>'revokedAt' is null or c->>'accountId' is distinct from j.user_id::text or c->>'subjectId' is distinct from j.subject_id::text
   or j.source_binding_revision<>1 or j.file_id is not null or not private.own_report_purge_hash_matches_v1(j.file_sha256,fp)
   or j.payload is distinct from jsonb_build_object('disposition','purpose-revocation','purpose',c->>'purpose',
    'grant_id',j.source_binding_id,'pair_ids','[]'::jsonb,'retention_id','purpose.derived-60s','manifest_class','purpose-derived-only') then
   raise exception using errcode='55000',message='own_report_purge_binding_invalid'; end if;
  replacement:=private.prepare_own_report_purge_v1(j.source_binding_id);
  update public.worker_jobs set status='cancelled',finished_at=clock_timestamp(),
   result=jsonb_build_object('outcome','superseded','replacementJobId',replacement,'cleanupComplete',false)
   where id=j.id;
  perform private.append_legal_audit_event('purpose.purge-superseded',null,'api.jobs.retention','accepted',
   jsonb_build_object('purpose',c->>'purpose','cleanupComplete',false));
  return jsonb_build_object('outcome','superseded','deletedRows',0);
 end if;
 select * into d from public.retention_due_phases where retention_row_id=j.source_binding_id
  and phase_id='own-report-purpose-purge' and phase_revision=1 for update;
 select * into m from public.purge_manifests where retention_row_id=d.retention_row_id
  and phase_id=d.phase_id and phase_revision=d.phase_revision and manifest_revision=1 for update;
 c:=private.own_report_purge_scope_v1((d.immutable_envelope->>'grantId')::uuid);
 fp:=encode(extensions.digest(convert_to(d.immutable_envelope::text,'UTF8'),'sha256'),'hex');
 if d.retention_row_id is null or m.id is null or c is null
  or c->>'revokedAt' is null or c->>'directionStatus' not in('revoked','superseded')
  or d.retention_id<>'purpose.derived-60s' or d.phase_kind<>'purge' or d.status<>'pending'
  or d.immutable_envelope->>'accountId' is distinct from j.user_id::text
  or d.target_id is distinct from j.subject_id or d.target_kind<>'subject'
  or d.immutable_envelope->>'grantId' is distinct from c->>'grantId'
  or d.immutable_envelope->>'grantRevision' is distinct from c->>'grantRevision'
  or d.immutable_envelope->>'principalId' is distinct from c->>'principalId'
  or d.immutable_envelope->>'purpose' is distinct from c->>'purpose'
  or d.immutable_envelope->>'lifecycleRevision' is distinct from d.target_lifecycle_revision::text
  or d.phase_deadline is distinct from (c->>'revokedAt')::timestamptz+interval '60 seconds'
  or d.immutable_envelope->>'manifestId' is distinct from m.id::text
  or m.state<>'frozen' or m.manifest_class<>'purpose-derived-only' or not private.own_report_purge_hash_matches_v1(m.source_binding_fingerprint,fp)
  or not private.own_report_purge_hash_matches_v1(j.file_sha256,fp) or j.source_binding_revision<>1 or j.file_id is not null
  or j.payload is distinct from jsonb_build_object('dispositionId',d.retention_row_id) then
  raise exception using errcode='55000',message='own_report_purge_binding_invalid'; end if;
 -- This synchronous executor has no genetic/Storage transport and supports
 -- the two stores written by canonical own reports. Fail closed if attribution
 -- requires another workflow, rather than infer grant ownership from account.
 if exists(select 1 from public.chats where user_id=j.user_id and subject_id=j.subject_id
   and (canonical_authority is null or legacy_unverified is not false))
  or exists(select 1 from public.copilot_context_tokens where account_id=j.user_id and target_id=j.subject_id)
  or exists(select 1 from public.chat_messages where user_id=j.user_id and retrieved_subject_ids @> array[j.subject_id]
   and (canonical_projection is null or legacy_unverified is not false)) then
  raise exception using errcode='55000',message='own_report_purge_unsupported_outputs'; end if;
 if exists(select 1 from public.purge_manifest_entries x where x.manifest_id=m.id and
  (x.object_id is not null or x.row_key->>'grantId' is distinct from c->>'grantId'
   or not((x.target_id='polygenic-results' and x.store_name='public.user_prs' and c->>'purpose'='reports.polygenic')
     or (x.target_id='generated-artifacts' and x.store_name='private.own_analysis_runs')
     or (x.target_id='chat-derived-contexts' and x.store_name='public.chat_messages')))) then
  raise exception using errcode='55000',message='own_report_purge_membership_invalid'; end if;
 select encode(extensions.digest(convert_to(coalesce(jsonb_agg(jsonb_build_object('target',x.target_id,
  'store',x.store_name,'key',x.row_key,'revision',x.entry_revision) order by t.delete_order,x.store_name,x.entry_revision),'[]'::jsonb)::text,'UTF8'),'sha256'),'hex')
 into mh from public.purge_manifest_entries x join public.purge_targets t on t.target_id=x.target_id where x.manifest_id=m.id;
 token:=encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex');
 update public.worker_jobs set status='running',attempts=attempts+1,started_at=coalesce(started_at,clock_timestamp()),
  claim_token_hash=token,claim_expires_at=clock_timestamp()+interval '5 minutes',claimed_by='own-report-revocation-v1',progress_note='purging' where id=j.id;
 update public.retention_due_phases set status='claimed',claim_token_hash=token,claim_expires_at=clock_timestamp()+interval '5 minutes',attempts=attempts+1
  where retention_row_id=d.retention_row_id and phase_id=d.phase_id and phase_revision=d.phase_revision;
 update public.retention_rows set state='active' where id=d.retention_row_id;
 update public.purge_manifests set state='executing',physical_purge_started_at=clock_timestamp(),frozen_manifest_hash=mh where id=m.id;
 -- One database transaction holds the common locks from start through residual
 -- receipt. A crash rolls back all progress; regrant/generation cannot interleave.
 for e in select x.* from public.purge_manifest_entries x join public.purge_targets t on t.target_id=x.target_id
  where x.manifest_id=m.id order by t.delete_order,x.store_name,x.entry_revision
 loop
  if e.store_name='public.user_prs' then
   delete from public.user_prs p using private.own_analysis_runs a
   where p.id=(e.row_key->>'id')::uuid and p.file_id=(e.row_key->>'fileId')::uuid
    and p.user_id=j.user_id and p.subject_id=j.subject_id and a.file_id=p.file_id
    and a.grant_id=(c->>'grantId')::uuid and a.grant_revision=(c->>'grantRevision')::bigint
    and a.account_id=j.user_id and a.subject_id=j.subject_id and a.purpose='reports.polygenic';
  elsif e.store_name='public.chat_messages' then
   delete from public.chat_messages cm using public.chats cc
   where cm.id=(e.row_key->>'id')::uuid and cm.chat_id=(e.row_key->>'chatId')::uuid
    and cm.turn_id=(e.row_key->>'turnId')::uuid and cm.user_id=j.user_id
    and cc.id=cm.chat_id and cc.user_id=j.user_id and cc.subject_id=j.subject_id and cc.scope_kind='self'
    and cc.legacy_unverified is false and cc.canonical_authority is not null
    and cm.legacy_unverified is false and cm.canonical_projection is not null
    and encode(extensions.digest(convert_to(cm.canonical_projection::text,'UTF8'),'sha256'),'hex')=e.row_key->>'projectionHash';
  else
   delete from private.own_analysis_runs a where a.id=(e.row_key->>'id')::uuid and a.file_id=(e.row_key->>'fileId')::uuid
    and a.grant_id=(c->>'grantId')::uuid and a.grant_revision=(c->>'grantRevision')::bigint
    and a.account_id=j.user_id and a.subject_id=j.subject_id and a.purpose=c->>'purpose';
  end if;
  get diagnostics changed=row_count; deleted:=deleted+changed; cursor_value:=cursor_value+1;
  update public.purge_manifest_entries set status=case when changed=0 then 'missing' else 'deleted' end
   where manifest_id=e.manifest_id and target_id=e.target_id and store_name=e.store_name and entry_revision=e.entry_revision;
 end loop;
 if exists(select 1 from private.own_copilot_purge_messages_v1(j.user_id,j.subject_id,(c->>'grantId')::uuid,(c->>'grantRevision')::bigint))
  or exists(select 1 from private.own_analysis_runs where grant_id=(c->>'grantId')::uuid)
  or (c->>'purpose'='reports.polygenic' and exists(select 1 from public.user_prs p where p.user_id=j.user_id and p.subject_id=j.subject_id
    and not exists(select 1 from private.own_analysis_runs a join public.purpose_grants g on g.grant_id=a.grant_id and g.grant_revision=a.grant_revision
     where a.file_id=p.file_id and a.purpose='reports.polygenic' and a.account_id=p.user_id and a.subject_id=p.subject_id
      and exists(select 1 from public.subjects ns where ns.id=a.subject_id
       and (a.authority->'context'->>'subjectBindingRevision')::bigint=ns.subject_binding_revision
       and g.subject_binding_revision=ns.subject_binding_revision)
      and a.grant_id<>(c->>'grantId')::uuid and g.revoked_at is null and (g.expires_at is null or g.expires_at>clock_timestamp()) and a.state='complete'
      and exists(select 1 from public.genome_files f join private.own_normalization_runs n on n.file_id=f.id
       join public.genome_storage_objects o on o.genome_file_id=f.id and o.object_id=f.storage_object_id
       join storage.objects so on so.id=o.object_id join public.directional_grants dg on dg.grant_id=g.grant_id and dg.grant_revision=g.grant_revision
       where f.id=a.file_id and f.user_id=a.account_id and f.subject_id=a.subject_id and f.single_logical_sample_verified_at is not null
       and a.source_sha256=f.sha256 and a.source_revision=f.upload_revision and a.normalization_completed_at=f.normalization_completed_at
       and f.normalization_source_revision=f.upload_revision and n.state='complete' and n.account_id=f.user_id
       and n.manifest->>'objectId'=f.storage_object_id::text and n.manifest->>'objectKey'=f.bucket_path
       and n.manifest->>'rawSha256'=f.sha256
       and n.manifest->>'decodedSha256'=f.source_sha256 and (n.manifest->>'sourceRevision')::bigint=f.upload_revision
       and o.bucket_id='genomes' and o.state='current' and o.revoked_at is null and o.sha256=f.sha256 and o.byte_count=f.size_bytes
       and o.object_revision=f.upload_revision and o.object_name=f.bucket_path and so.bucket_id=o.bucket_id and so.name=o.object_name
       and (so.metadata->>'size')::bigint=f.size_bytes and dg.status='current' and dg.direction='self' and dg.recipient_account_id=a.account_id)))) then
  raise exception using errcode='55000',message='own_report_purge_residuals'; end if;
 update public.purge_manifests set state='complete',batch_cursor=cursor_value where id=m.id;
 update public.retention_due_phases set status='succeeded',claim_token_hash=null,claim_expires_at=null,
  terminal_outcome_code='exact_grant_residuals_zero',completed_at=clock_timestamp()
  where retention_row_id=d.retention_row_id and phase_id=d.phase_id and phase_revision=d.phase_revision;
 update public.retention_rows set state='complete',ended_at=clock_timestamp() where id=d.retention_row_id;
 update public.worker_jobs set status='done',claim_token_hash=null,claim_expires_at=null,claimed_by=null,
  finished_at=clock_timestamp(),progress=100,progress_note='complete',
  result=jsonb_build_object('outcome','exact_grant_residuals_zero','deletedRows',deleted,'manifestId',m.id,
   'completedWithinDeadline',clock_timestamp()<=d.phase_deadline) where id=j.id;
 perform private.append_legal_audit_event('purpose.purge-complete',null,'api.jobs.retention','accepted',
  jsonb_build_object('purpose',c->>'purpose','deletedRows',deleted,'completedWithinDeadline',clock_timestamp()<=d.phase_deadline));
 return jsonb_build_object('outcome','complete','deletedRows',deleted);
end;
$fn$;

-- Settings/key changes and explicit withdrawal all end the exact Copilot
-- purpose row. Freeze cleanup membership before that transition, not in a
-- later best-effort request and not by deleting rows in a trigger.
create function private.prepare_own_copilot_revocation_v1() returns trigger
language plpgsql security definer set search_path=pg_catalog as $fn$
begin
 if old.revoked_at is null and new.revoked_at is not null and old.copilot_recipient_revision is not null
  and old.purpose in('copilot.local','copilot.cloud') then
  perform private.prepare_own_report_purge_v1(old.grant_id,new.revoked_at);
 end if;
 return new;
end;
$fn$;
revoke all on function private.prepare_own_copilot_revocation_v1() from public,anon,authenticated,inherit_upload_only;
create trigger prepare_own_copilot_revocation before update of revoked_at on public.purpose_grants
 for each row execute function private.prepare_own_copilot_revocation_v1();


-- Selected-file deletion already has a durable, retryable Storage ACK record.
-- Freeze exact canonical message membership in that same record before any
-- derivative removal; it contains only row IDs and integrity hashes.
alter table private.genome_file_deletions add column canonical_chat_manifest jsonb not null default '[]';
create function private.freeze_file_copilot_manifest_v1() returns trigger
language plpgsql security definer set search_path=pg_catalog as $fn$
begin
 if TG_OP='UPDATE' then
  if new.canonical_chat_manifest is distinct from old.canonical_chat_manifest then
   raise exception using errcode='55000',message='file_deletion_manifest_immutable'; end if;
  return new;
 end if;
 with affected as (
  select m.chat_id,min(m.turn_ordinal) cutoff from public.chat_messages m join public.chats c on c.id=m.chat_id
   join public.genome_files f on f.id=new.file_id
  where c.user_id=new.account_id and m.user_id=new.account_id and c.subject_id=f.subject_id and c.scope_kind='self'
   and c.legacy_unverified is false and c.canonical_authority is not null
   and m.legacy_unverified is false and m.canonical_projection is not null
   and exists(select 1 from jsonb_array_elements((m.canonical_projection->'sources')||(m.canonical_projection->'legacySources')||(m.canonical_projection->'unavailableSources')) s
    where s->>'id'=new.file_id::text)
  group by m.chat_id
 ) select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'chatId',m.chat_id,'turnId',m.turn_id,
  'projectionHash',encode(extensions.digest(convert_to(m.canonical_projection::text,'UTF8'),'sha256'),'hex')) order by m.chat_id,m.turn_ordinal,m.role),'[]')
 into new.canonical_chat_manifest from affected a join public.chat_messages m on m.chat_id=a.chat_id and m.turn_ordinal>=a.cutoff
 where m.user_id=new.account_id and m.legacy_unverified is false and m.canonical_projection is not null;
 return new;
end;
$fn$;
revoke all on function private.freeze_file_copilot_manifest_v1() from public,anon,authenticated,inherit_upload_only;
create trigger freeze_file_copilot_manifest before insert or update on private.genome_file_deletions
 for each row execute function private.freeze_file_copilot_manifest_v1();

create or replace function public.prepare_genome_file_deletion_v1(
  p_account_id uuid, p_session_id uuid, p_file_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  f public.genome_files%rowtype;
  s public.subjects%rowtype;
  d private.genome_file_deletions%rowtype;
begin
  if not exists (select 1 from auth.sessions where id=p_session_id and user_id=p_account_id
    and (not_after is null or not_after>clock_timestamp())) then
    raise exception using errcode='42501', message='file_delete_unauthorized';
  end if;
  -- Match canonical model/read locks: account, subject, then source.
  perform 1 from public.profiles where id=p_account_id for update;
  perform 1 from public.subjects where id=(select subject_id from public.genome_files where id=p_file_id and user_id=p_account_id) for update;
  select * into f from public.genome_files where id=p_file_id and user_id=p_account_id for update;
  if f.id is null then
    raise exception using errcode='P0002', message='file_delete_not_found';
  end if;
  select * into s from public.subjects where id=f.subject_id for update;
  if s.subject_class is distinct from 'self' or s.owner_account_id is distinct from p_account_id
    or s.subject_account_id is distinct from p_account_id or s.lifecycle<>'active' or f.cohort_id is not null then
    raise exception using errcode='55000', message='file_delete_subject_unavailable';
  end if;
  -- These graph cases need their existing subject-level disposition, not a
  -- file shortcut that might remove another adult's shared working data.
  if exists (select 1 from public.family_pairs where subject_a_id=s.id or subject_b_id=s.id)
    or exists (select 1 from public.subject_relationships where subject_id=s.id
      and status='current' and recipient_account_id is distinct from p_account_id)
    or exists (select 1 from public.generated_exports where target_kind='subject' and target_id=s.id)
    or exists (select 1 from public.report_artifacts where subject_id=s.id)
    or exists (select 1 from public.embryo_variants where source_file_id=f.id)
    or exists (select 1 from public.chats c where c.user_id=p_account_id and c.subject_id=s.id
      and (c.canonical_authority is null or c.legacy_unverified is not false))
    or exists (select 1 from public.chat_messages cm join public.chats c on c.id=cm.chat_id
      where cm.user_id=p_account_id and c.subject_id=s.id
      and (cm.canonical_projection is null or cm.legacy_unverified is not false)) then
    raise exception using errcode='55000', message='file_delete_shared_graph';
  end if;
  if f.status in ('uploading','parsing','parsed') or exists (
    select 1 from public.worker_jobs where file_id=f.id and status in ('queued','running')
  ) then
    raise exception using errcode='55000', message='file_delete_processing';
  end if;
  if exists (select 1 from public.genome_files where id<>f.id and bucket_path=f.bucket_path)
    or (f.storage_object_id is null and f.bucket_path not like p_account_id::text||'/%')
    or (f.storage_object_id is not null and not exists (
      select 1 from public.genome_storage_objects where object_id=f.storage_object_id
      and genome_file_id=f.id and cohort_id is null and bucket_id='genomes' and object_name=f.bucket_path
    )) or exists (select 1 from public.genome_storage_objects where genome_file_id=f.id
      and (object_id is distinct from f.storage_object_id or bucket_id<>'genomes' or object_name<>f.bucket_path)) then
    raise exception using errcode='55000', message='file_delete_identity_mismatch';
  end if;
  select * into d from private.genome_file_deletions where file_id=f.id;
  if d.file_id is null then
    -- Persist the unreadable/retryable state before freezing subsequent updates.
    update public.genome_files set status='failed', error='File deletion is pending. Try Delete again.' where id=f.id;
    insert into private.genome_file_deletions(file_id,account_id,bucket_id,object_name)
      values(f.id,p_account_id,'genomes',f.bucket_path) returning * into d;
    update public.genome_storage_objects set state='purge_queued',revoked_at=coalesce(revoked_at,clock_timestamp())
      where genome_file_id=f.id;
  end if;
  update public.mail_outbox set state='invalidated', claimed_at=null,
    last_outcome_code='file_target_unavailable'
  where template_id='report-ready' and target_kind='genome_file'
    and target_id=f.id and state in ('queued','claimed');
  return jsonb_build_object('token',d.token,'bucket',d.bucket_id,'name',d.object_name);
end;
$$;
create or replace function public.finish_genome_file_deletion_v1(
  p_account_id uuid, p_session_id uuid, p_file_id uuid, p_token uuid
) returns void language plpgsql security definer set search_path = '' as $$
declare
  d private.genome_file_deletions%rowtype;
begin
  -- Recheck authority, exact bindings and unsupported graph additions.
  perform public.prepare_genome_file_deletion_v1(p_account_id,p_session_id,p_file_id);
  select * into d from private.genome_file_deletions where file_id=p_file_id and account_id=p_account_id for update;
  if d.token is distinct from p_token then
    raise exception using errcode='42501', message='file_delete_unauthorized';
  end if;
  -- Route calls this only after Storage.remove acknowledged success. This
  -- independent metadata check also refuses a direct premature finish call.
  if exists (select 1 from storage.objects where bucket_id=d.bucket_id and name=d.object_name) then
    raise exception using errcode='55000', message='file_delete_storage_incomplete';
  end if;
  delete from public.chat_messages m using public.chats c,jsonb_array_elements(d.canonical_chat_manifest) e
  where m.id=(e->>'id')::uuid and m.chat_id=(e->>'chatId')::uuid and m.turn_id=(e->>'turnId')::uuid
   and m.user_id=p_account_id and c.id=m.chat_id and c.user_id=p_account_id and c.scope_kind='self'
   and c.subject_id=(select subject_id from public.genome_files where id=p_file_id)
   and c.legacy_unverified is false and c.canonical_authority is not null and m.legacy_unverified is false
   and encode(extensions.digest(convert_to(m.canonical_projection::text,'UTF8'),'sha256'),'hex')=e->>'projectionHash';
  if exists(select 1 from public.chat_messages m join jsonb_array_elements(d.canonical_chat_manifest) e on m.id=(e->>'id')::uuid) then
   raise exception using errcode='55000',message='file_delete_chat_residuals'; end if;
  delete from public.download_sessions where object_id in (
    select object_id from public.genome_storage_objects where genome_file_id=p_file_id
  );
  delete from public.analysis_jobs where worker_job_id in (select id from public.worker_jobs where file_id=p_file_id);
  delete from public.worker_jobs where file_id=p_file_id;
  set constraints public.genome_files_storage_object_fk deferred;
  delete from public.genome_storage_objects where genome_file_id=p_file_id;
  delete from public.genome_files where id=p_file_id and user_id=p_account_id;
end;
$$;
