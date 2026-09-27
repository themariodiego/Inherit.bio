-- Admit exact published own sources without changing grants, tools or history
-- identities. All provider bytes remain behind the scoped server rsID reader.

create or replace function private.own_copilot_projection_v1(a jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare f public.genome_files%rowtype; sources jsonb:='[]'; legacy_sources jsonb:='[]'; completed jsonb; g jsonb; v_purpose text; metadata jsonb; published jsonb;
begin
 for f in select * from public.genome_files cf where subject_id=(a->>'subjectId')::uuid
  and user_id=(a->>'accountId')::uuid and single_logical_sample_verified_at is not null
  and not exists(select 1 from private.genome_file_deletions d where d.file_id=cf.id)
  order by id for share loop
  if f.tier is distinct from 1 or f.status is null or f.status not in ('stored','annotated')
   or f.structural_validator_version is distinct from 'single-logical-sample-v1'
   or f.normalization_completed_at is null or f.normalization_source_revision is distinct from f.upload_revision
   or f.build is null or f.build not in ('GRCh37','GRCh38') then continue; end if;
  metadata:=null; published:=null;
  begin
   -- Backend selection cannot fall back when a prepared attempt is active or
   -- published. The existing helper also owns the exact original-retirement
   -- exception; absence of an original object alone establishes no authority.
   metadata:=private.own_report_source_metadata_v1((a->>'accountId')::uuid,f.id,true);
   if metadata ? 'preparedSource' then
    -- A root-only check would miss revoked or missing unread final members.
    published:=private.read_own_prepared_manifest_v1((a->>'accountId')::uuid,(a->>'sessionId')::uuid,
     f.id,(metadata#>>'{preparedSource,manifestId}')::uuid);
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
     or published#>>'{root,receipt,sha256}' is distinct from metadata#>>'{preparedSource,rootSha256}' then
     raise exception using errcode='42501',message='not_found';
    end if;
   end if;
  exception when insufficient_privilege or object_not_in_prerequisite_state then continue;
  end;
  completed:='[]';
  foreach v_purpose in array array['reports.monogenic','reports.polygenic','ancestry'] loop
   begin
    g:=private.current_own_report_grant_read_v1((a->>'accountId')::uuid,(a->>'sessionId')::uuid,f.id,v_purpose);
    if private.own_analysis_completion_matches_v1(f.id,v_purpose,g) is true then
     select completed||jsonb_build_array(jsonb_build_object('purpose',v_purpose,
      'authority',g #- '{context,authSessionRevision}' #- '{context,originatingSessionRevision}',
      'runId',r.id,'completedAt',r.completed_at,'resultHash',encode(extensions.digest(convert_to(r.result::text,'UTF8'),'sha256'),'hex')))
      into completed from private.own_analysis_runs r where r.file_id=f.id and r.purpose=v_purpose and r.state='complete';
    end if;
   exception when insufficient_privilege or object_not_in_prerequisite_state then null;
   end;
  end loop;
  sources:=sources||jsonb_build_array(jsonb_build_object('id',f.id,'revision',f.upload_revision,'sha256',f.sha256,
   'decodedSha256',f.source_sha256,'objectId',f.storage_object_id,'normalizedAt',f.normalization_completed_at,
   'build',f.build,'completed',completed)
   ||case when metadata ? 'preparedSource' then jsonb_build_object('preparedSource',metadata->'preparedSource') else '{}'::jsonb end);
 end loop;
 -- Compatibility uses the existing processed-file authority, explicitly
 -- without certifying a historical normalization manifest. Canonical source
 -- identity or a finalized restricted lease can never fall into this branch.
 for f in select * from public.genome_files lf where subject_id=(a->>'subjectId')::uuid
  and user_id=(a->>'accountId')::uuid and status='annotated'
  and single_logical_sample_verified_at is null and structural_validator_version is null
  and storage_object_id is null and source_sha256 is null and normalization_completed_at is null
  and sha256 ~ '^[0-9a-f]{64}$' and build in('GRCh37','GRCh38')
  and not exists(select 1 from private.genome_file_deletions d where d.file_id=lf.id)
  and not exists(select 1 from public.upload_sessions u where u.finalized_file_id=lf.id)
  and not exists(select 1 from private.own_normalization_runs n where n.file_id=lf.id)
  and not exists(select 1 from public.genome_storage_objects o where o.genome_file_id=lf.id)
  order by id for share loop
  legacy_sources:=legacy_sources||jsonb_build_array(jsonb_build_object('id',f.id,'sha256',f.sha256,'build',f.build,'createdAt',f.created_at));
 end loop;
 return jsonb_build_object('sources',sources,'legacySources',legacy_sources,'unavailableSources',coalesce((
  select jsonb_agg(jsonb_build_object('id',uf.id,'reason','source_unavailable') order by uf.id)
  from public.genome_files uf where uf.subject_id=(a->>'subjectId')::uuid
   -- Membership is already frozen at deletion prepare. A fresh context must
   -- not acquire a dependency on that target while Storage ACK is pending.
   and not exists(select 1 from private.genome_file_deletions d where d.file_id=uf.id)
   and not exists(select 1 from jsonb_array_elements(sources||legacy_sources) s where s->>'id'=uf.id::text)
 ),'[]'::jsonb));
end; $$;
revoke all on function private.own_copilot_projection_v1(jsonb) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.own_copilot_projection_v1(jsonb) to service_role;

-- The two calls selectors exclude object sources, even if stale database rows
-- exist. Every other operation, predicate, bound and transaction is preserved.
create or replace function private.own_copilot_chat_v1(p_operation text,p_account_id uuid,p_session_id uuid,p_subject_id uuid,
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
  delete from private.own_copilot_nonces where account_id=p_account_id and session_id=p_session_id
   and expires_at<clock_timestamp();
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
    and exists(select 1 from public.chat_messages lm where lm.chat_id=lc.id)
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
  -- Empty shells can remain after exact message retention. Their former
  -- authority cannot revive a purged conversation or authorize a new turn.
  if not exists(select 1 from public.chat_messages cm where cm.chat_id=c.id)
   or exists(select 1 from public.chat_messages cm where cm.chat_id=c.id
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
     and v.file_id in(select (s->>'id')::uuid from jsonb_array_elements((projection->'sources')||(projection->'legacySources')) s where not(s ? 'preparedSource'))
     and v.rsid in(select r::bigint from jsonb_array_elements_text(p_payload->'rsids') r)
   union all
   select v.file_id,v.rsid,v.chrom,v.pos,v.ref,v.alt,v.genotype,v.usable from public.report_observed_calls v
    join public.genome_files f on f.id=v.file_id where v.subject_id=p_subject_id and v.user_id=p_account_id
     and v.file_id in(select (s->>'id')::uuid from jsonb_array_elements(projection->'sources') s where not(s ? 'preparedSource'))
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
