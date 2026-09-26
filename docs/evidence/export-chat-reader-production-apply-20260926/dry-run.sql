-- Guarded production apply of supabase/migrations/20260925220000_export_archive_chat_reader.sql
-- (merged in #216; file SHA-256 642446117dfd6da459db781c66b57814616e035dec1eb8a8d81df15d75daf11e).
-- One DO statement, so it is atomic under any client protocol: predecessor checks,
-- the migration executed verbatim, postchecks against the definitions measured on
-- the tested local stack, and the ledger row under the repository's version and name.
do $inherit_chat_do$
declare
  migration constant text := $inherit_chat_migration$-- G5.6 step 2, second part: the requester's own Copilot conversations,
-- readable only under an export job and bound to its authority receipt.
--
-- The authority graph becomes export-authority-v3: it adds every own chat on
-- a captured subject with a digest of all its messages, so a new or changed
-- message after capture fails the job. A job captured under v2 no longer
-- matches and fails closed.
--
-- Two closed reader operations: chats lists the exportable chats, 100 per
-- page by id; chat-messages returns one chat's exportable messages in history
-- order, by turn. Which chats and turns are exportable is decided by
-- private.export_archive_chat_messages_v1 below. It writes nothing and makes
-- no model call.

-- One chat's exportable messages, in history order: every message before the
-- first turn that no longer matches the subject's current data projection.
-- With p_limit null it only counts them. The chat must be canonical, not
-- legacy, self-scoped, and its Copilot grant (and cloud provider consent) must
-- still be the same current revision; otherwise nothing is exportable.
create function private.export_archive_chat_messages_v1(p_account uuid,p_session uuid,p_chat uuid,p_after bigint,p_limit integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare c public.chats%rowtype; authority jsonb; projection jsonb; cutoff bigint; rows jsonb; n integer; last_ordinal bigint;
begin
 select * into c from public.chats where id=p_chat and user_id=p_account;
 if c.id is null or c.scope_kind<>'self' or c.legacy_unverified is not false or c.canonical_authority is null then
  return jsonb_build_object('count',0,'messages','[]'::jsonb,'nextAfterOrdinal',null); end if;
 authority:=c.canonical_authority;
 if not exists(select 1 from public.purpose_grants pg join public.directional_grants dg
   on dg.grant_id=pg.grant_id and dg.grant_revision=pg.grant_revision
   where pg.grant_id::text=authority->>'copilotGrantId' and pg.grant_revision::text=authority->>'copilotGrantRevision'
    and pg.revoked_at is null and (pg.expires_at is null or pg.expires_at>clock_timestamp()) and dg.status='current'
    and pg.target_kind='subject' and pg.target_id=c.subject_id)
  or (authority->>'providerClass'='cloud' and not exists(select 1 from public.subject_consents s
   where s.id::text=authority->>'providerGrantId' and s.grant_revision::text=authority->>'providerGrantRevision'
    and s.account_id=p_account and s.subject_id=c.subject_id
    and s.revoked_at is null and (s.expires_at is null or s.expires_at>clock_timestamp()))) then
  return jsonb_build_object('count',0,'messages','[]'::jsonb,'nextAfterOrdinal',null); end if;
 projection:=private.own_copilot_projection_v1(jsonb_build_object('accountId',p_account,'sessionId',p_session,'subjectId',c.subject_id));
 select min(turn_ordinal) into cutoff from public.chat_messages where chat_id=c.id
  and (canonical_projection is distinct from projection or legacy_unverified is not false);
 if p_limit is null then
  select count(*) into n from public.chat_messages where chat_id=c.id and (cutoff is null or turn_ordinal<cutoff);
  return jsonb_build_object('count',n);
 end if;
 select coalesce(jsonb_agg(x.row order by x.turn_ordinal,x.role desc,x.id),'[]'),count(*),max(x.turn_ordinal)
  into rows,n,last_ordinal from (
  select m.id,m.turn_ordinal,m.role,jsonb_build_object('id',m.id,'role',m.role,'content',m.content,
   'citations',coalesce(m.canonical_citations,'[]'::jsonb),'embryoFindings','[]'::jsonb,'createdAt',m.created_at) as row
  from public.chat_messages m where m.chat_id=c.id and (cutoff is null or m.turn_ordinal<cutoff)
   and m.turn_ordinal>coalesce(p_after,0)
   and m.turn_ordinal<=coalesce(p_after,0)+p_limit/2
  order by m.turn_ordinal,m.role desc,m.id) x;
 return jsonb_build_object('count',n,'messages',rows,'nextAfterOrdinal',case when exists(
  select 1 from public.chat_messages m where m.chat_id=c.id and (cutoff is null or m.turn_ordinal<cutoff)
   and m.turn_ordinal>coalesce(last_ordinal,coalesce(p_after,0)+p_limit/2)) then to_jsonb(coalesce(last_ordinal,coalesce(p_after,0)+p_limit/2))
  else 'null'::jsonb end);
end $$;
revoke all on function private.export_archive_chat_messages_v1(uuid,uuid,uuid,bigint,integer)
 from public,anon,authenticated,inherit_upload_only,service_role;

create or replace function private.export_archive_authority_v1(p_origin jsonb,p_target_kind text,p_target_id uuid)
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
 select sp.* into ap from public.subject_account_bindings b join public.subjects subj on subj.id=b.subject_id
  join public.subject_principals sp on sp.id=b.account_principal_id
  join public.subject_principals subject_p on subject_p.id=b.subject_principal_id
  where b.account_id=a and b.status='current' and subj.subject_class='self' and subj.subject_account_id=a
   and subj.lifecycle in ('active','restricted') and sp.account_id=a and sp.status='active' and sp.principal_kind='account_subject'
   and subject_p.account_id=a and subject_p.subject_id=subj.id and subject_p.status='active' and subject_p.principal_kind='account_subject';
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
   or exists(select 1 from public.family_pairs pair join public.subjects subj on subj.id in (pair.subject_a_id,pair.subject_b_id)
    where pair.status<>'purged' and (subj.owner_account_id=a or subj.subject_account_id=a))
   or exists(select 1 from public.directional_grants d join public.purpose_grants g using(grant_id)
    join public.subject_principals recipient on recipient.id=d.recipient_principal_id
    where (d.recipient_account_id=a or recipient.account_id=a) and d.status='current' and g.revoked_at is null
      and (g.expires_at is null or g.expires_at>clock_timestamp()) and (g.target_kind<>'subject' or not exists(
       select 1 from public.subjects subj where subj.id=g.target_id and subj.subject_account_id=a and subj.subject_class in ('self','other_adult')))) then
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
 graph:=jsonb_build_object('version','export-authority-v3','originBinding',origin_binding,'targetKind',p_target_kind,
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
  -- v2: the requester's own history, whole rows, so any change after capture
  -- (a new or revoked legacy consent, a principal, binding, consent or
  -- recipient-grant revision, a demographics edit, a new signature or
  -- attestation) fails the job rather than
  -- being exported against a receipt that no longer describes it.
  'history',jsonb_build_object(
   'legacyConsents',case when p_target_kind='account' then (select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]')
     from public.consent_grants c where c.user_id=a) else '[]'::jsonb end,
   'principals',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.subject_principals x
     where x.account_id=a and (p_target_kind='account' or x.subject_id=p_target_id)),
   'bindings',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.subject_account_bindings x
     where x.account_id=a and (p_target_kind='account' or x.subject_id=p_target_id)),
   'accountConsents',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.subject_consents x
     where x.account_id=a and (p_target_kind='account' or x.subject_id=p_target_id)),
   'recipientGrants',case when p_target_kind='account' then (select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]')
     from public.provider_recipient_grants x where x.account_id=a) else '[]'::jsonb end,
   'demographics',(select coalesce(jsonb_agg(to_jsonb(x) order by x.subject_id),'[]') from public.subject_demographics x
     where x.subject_id in(select (y#>>'{subject,id}')::uuid from jsonb_array_elements(subjects)y)),
   'signatures',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.consent_signatures x
     where x.signer_account_id=a and (p_target_kind='account' or (x.target_kind='subject' and x.target_id=p_target_id))),
   'attestations',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.attestations x
     where (x.principal_id in(select id from public.subject_principals where account_id=a)
       or x.signature_id in(select id from public.consent_signatures where signer_account_id=a))
      and (p_target_kind='account' or (x.target_kind='subject' and x.target_id=p_target_id))),
   -- v3: every own chat on a captured subject, with a digest of all its
   -- messages, so a new or changed message after capture fails the job.
   'chats',(select coalesce(jsonb_agg(jsonb_build_object('chat',to_jsonb(ch),'messages',encode(extensions.digest(
      coalesce((select jsonb_agg(to_jsonb(m) order by m.turn_ordinal,m.role,m.id) from public.chat_messages m
       where m.chat_id=ch.id),'[]'::jsonb)::text,'sha256'),'hex')) order by ch.id),'[]')
     from public.chats ch where ch.user_id=a
      and ch.subject_id in(select (y#>>'{subject,id}')::uuid from jsonb_array_elements(subjects)y))),
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

create or replace function public.export_archive_content_v1(p_operation text,p_export_id uuid,p_attempt_id uuid,
 p_authority_receipt text,p_payload jsonb default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare e public.generated_exports%rowtype; j private.export_archive_jobs%rowtype;
 att private.export_archive_attempts%rowtype; f public.genome_files%rowtype;
 authority jsonb; account_at uuid; session_at uuid; partitions uuid[]; file_at uuid; after_at uuid;
 offset_at integer; snapshot jsonb; page jsonb:='[]'; result jsonb; member uuid; last_at uuid;
 member_count integer:=0; purpose text; grant_authority jsonb; authorities jsonb:='{}';
 history_kind text; history_after uuid;
 chat_after uuid; chat_at uuid; ordinal_after bigint; chat_projection jsonb; chat_row public.chats%rowtype; cutoff bigint;
begin
 if p_operation is null or p_operation not in ('context','files','history','chats','chat-messages','check','variants','observed','reports','prs','ancestry')
  or p_export_id is null or p_attempt_id is null or p_authority_receipt is null
  or p_authority_receipt!~'^[0-9a-f]{64}$' then
  raise exception using errcode='22023',message='invalid_request'; end if;
 -- Closed payload shapes, validated before any authority or source read.
 if p_operation='context' then
  if p_payload is not null then raise exception using errcode='22023',message='invalid_request'; end if;
 elsif p_payload is null or jsonb_typeof(p_payload)<>'object' then
  raise exception using errcode='22023',message='invalid_request';
 elsif p_operation='files' then
  if (select count(*) from jsonb_object_keys(p_payload))<>1 or not(p_payload ? 'afterFileId')
   or jsonb_typeof(p_payload->'afterFileId') not in ('null','string') then
   raise exception using errcode='22023',message='invalid_request'; end if;
 elsif p_operation='chats' then
  if (select count(*) from jsonb_object_keys(p_payload))<>1 or not(p_payload ? 'afterChatId')
   or jsonb_typeof(p_payload->'afterChatId') not in ('null','string') then
   raise exception using errcode='22023',message='invalid_request'; end if;
 elsif p_operation='chat-messages' then
  if (select count(*) from jsonb_object_keys(p_payload))<>2 or not(p_payload ?& array['chatId','afterOrdinal'])
   or jsonb_typeof(p_payload->'chatId') is distinct from 'string'
   or jsonb_typeof(p_payload->'afterOrdinal') is distinct from 'number' or (p_payload->>'afterOrdinal')!~'^[0-9]{1,15}$' then
   raise exception using errcode='22023',message='invalid_request'; end if;
 elsif p_operation='history' then
  if (select count(*) from jsonb_object_keys(p_payload))<>2 or not(p_payload ?& array['kind','afterId'])
   or jsonb_typeof(p_payload->'kind') is distinct from 'string'
   or p_payload->>'kind' not in ('legacy-consents','subjects','demographics','principals','bindings','account-consents','recipient-grants',
    'signatures','attestations')
   or jsonb_typeof(p_payload->'afterId') not in ('null','string') then
   raise exception using errcode='22023',message='invalid_request'; end if;
 elsif (select count(*) from jsonb_object_keys(p_payload))<>(case when p_operation='check' then 2 else 3 end)
  or not(p_payload ?& array['fileId','snapshot']) or jsonb_typeof(p_payload->'fileId') is distinct from 'string'
  or jsonb_typeof(p_payload->'snapshot') is distinct from 'object'
  or (p_operation<>'check' and (not(p_payload ? 'offset') or jsonb_typeof(p_payload->'offset') is distinct from 'number'
   or (p_payload->>'offset')!~'^[0-9]{1,9}$')) then
  raise exception using errcode='22023',message='invalid_request';
 end if;
 begin
  if p_operation='files' and jsonb_typeof(p_payload->'afterFileId')='string' then after_at:=(p_payload->>'afterFileId')::uuid; end if;
  if p_operation='history' then
   history_kind:=p_payload->>'kind';
   if jsonb_typeof(p_payload->'afterId')='string' then history_after:=(p_payload->>'afterId')::uuid; end if;
  end if;
  if p_operation='chats' and jsonb_typeof(p_payload->'afterChatId')='string' then chat_after:=(p_payload->>'afterChatId')::uuid; end if;
  if p_operation='chat-messages' then
   chat_at:=(p_payload->>'chatId')::uuid; ordinal_after:=(p_payload->>'afterOrdinal')::bigint;
  end if;
  if p_operation not in ('context','files','history','chats','chat-messages') then file_at:=(p_payload->>'fileId')::uuid; end if;
 exception when invalid_text_representation then raise exception using errcode='22023',message='invalid_request';
 end;
 if p_operation not in ('context','files','history','chats','chat-messages','check') then offset_at:=(p_payload->>'offset')::integer; end if;

 -- Source locks before job/attempt locks, as in every authority-capable RPC.
 authority:=private.export_archive_current_v1(p_export_id,p_authority_receipt);
 select * into e from public.generated_exports where id=p_export_id for share;
 select * into j from private.export_archive_jobs where export_id=p_export_id for share;
 select * into att from private.export_archive_attempts where id=p_attempt_id and export_id=p_export_id for share;
 if att.id is null or j.active_attempt is distinct from att.id or att.state<>'writing'
  or att.lease_expires_at<=clock_timestamp() or att.authority_receipt is distinct from p_authority_receipt
  or e.status is distinct from 'building' or j.origin->>'kind' is distinct from 'account' then
  raise exception using errcode='42501',message='not_found'; end if;
 account_at:=(j.origin->>'accountId')::uuid; session_at:=(j.origin->>'sessionId')::uuid;
 select coalesce(array_agg(x::uuid order by x),'{}') into partitions from jsonb_array_elements_text(e.subject_partitions) x;
 if file_at is not null and not exists(select 1 from public.genome_files where id=file_at and subject_id=any(partitions)) then
  raise exception using errcode='42501',message='not_found'; end if;

 if p_operation='context' then
  -- Worker-internal only: never an archive member or a client response.
  result:=jsonb_build_object('exportId',e.id,'attemptId',att.id,'routeId',j.route_id,'exportContract',j.export_contract,
   'targetKind',e.target_kind,'targetId',e.target_id,'subjectPartitions',e.subject_partitions,
   'origin',jsonb_build_object('kind','account','accountId',account_at,'sessionId',session_at),
   'authorityReceipt',j.authority_receipt,'fileCount',(authority->>'fileCount')::integer,
   'leaseExpiresAt',att.lease_expires_at,'deadline',j.deadline);
 elsif p_operation='files' then
  -- Every in-scope file, including ones the older list filtered out: a file
  -- without an exact current source refuses the whole page, never disappears.
  for member in select gf.id from public.genome_files gf where gf.subject_id=any(partitions)
   and (after_at is null or gf.id>after_at) order by gf.id limit 100 loop
   snapshot:=private.own_export_source_v1(account_at,session_at,member);
   if snapshot is null then raise exception using errcode='55000',message='export_source_unavailable'; end if;
   page:=page||jsonb_build_array(snapshot); last_at:=member; member_count:=member_count+1;
  end loop;
  result:=jsonb_build_object('files',page,'nextAfterFileId',case when member_count=100 and exists(
   select 1 from public.genome_files gf where gf.subject_id=any(partitions) and gf.id>last_at) then to_jsonb(last_at) else 'null'::jsonb end);
 elsif p_operation='history' then
  -- The requester's own history, the same scoping as the synchronous
  -- export's subject record (src/lib/export/subject-record.ts): subjects and
  -- demographics are the captured partitions; the other classes are keyed to
  -- this account, and a subject export keeps only rows about that subject.
  -- Account-level classes belong to an account export only. Columns are
  -- listed, never whole rows, so a column added later is not exported by
  -- default. Keyset pages of 500 by id (demographics by subject id).
  if history_kind in ('legacy-consents','recipient-grants') and e.target_kind<>'account' then
   raise exception using errcode='22023',message='invalid_request'; end if;
  if history_kind='legacy-consents' then
   select coalesce(jsonb_agg(x.row order by x.id),'[]'),count(*),max(x.id::text)::uuid into page,member_count,last_at from (
    select c.id,jsonb_build_object('id',c.id,'provider_key',c.provider_key,'data_classes',c.data_classes,
     'granted_at',c.granted_at,'revoked_at',c.revoked_at) as row from public.consent_grants c
    where c.user_id=account_at and (history_after is null or c.id>history_after) order by c.id limit 500) x;
  elsif history_kind='subjects' then
   select coalesce(jsonb_agg(x.row order by x.id),'[]'),count(*),max(x.id::text)::uuid into page,member_count,last_at from (
    select s.id,jsonb_build_object('id',s.id,'subject_class',s.subject_class,'upload_class',s.upload_class,
     'display_label',s.display_label,'lifecycle',s.lifecycle,'subject_binding_revision',s.subject_binding_revision,
     'lifecycle_revision',s.lifecycle_revision,'created_at',s.created_at,'updated_at',s.updated_at,
     'portrait_acknowledged_at',s.portrait_acknowledged_at,'independent_login_at',s.independent_login_at) as row
    from public.subjects s where s.id=any(partitions) and (history_after is null or s.id>history_after) order by s.id limit 500) x;
  elsif history_kind='demographics' then
   select coalesce(jsonb_agg(x.row order by x.id),'[]'),count(*),max(x.id::text)::uuid into page,member_count,last_at from (
    select d.subject_id as id,jsonb_build_object('subject_id',d.subject_id,'date_of_birth',d.date_of_birth,
     'chromosomal_sex',d.chromosomal_sex,'demographics_revision',d.demographics_revision,'updated_at',d.updated_at) as row
    from public.subject_demographics d where d.subject_id=any(partitions)
     and (history_after is null or d.subject_id>history_after) order by d.subject_id limit 500) x;
  elsif history_kind='principals' then
   select coalesce(jsonb_agg(x.row order by x.id),'[]'),count(*),max(x.id::text)::uuid into page,member_count,last_at from (
    select p.id,jsonb_build_object('id',p.id,'subject_id',p.subject_id,'principal_kind',p.principal_kind,
     'principal_revision',p.principal_revision,'status',p.status,'created_at',p.created_at) as row
    from public.subject_principals p where p.account_id=account_at
     and (e.target_kind='account' or p.subject_id=e.target_id)
     and (history_after is null or p.id>history_after) order by p.id limit 500) x;
  elsif history_kind='bindings' then
   select coalesce(jsonb_agg(x.row order by x.id),'[]'),count(*),max(x.id::text)::uuid into page,member_count,last_at from (
    select b.id,jsonb_build_object('id',b.id,'subject_id',b.subject_id,'subject_principal_id',b.subject_principal_id,
     'account_principal_id',b.account_principal_id,'binding_kind',b.binding_kind,'binding_revision',b.binding_revision,
     'status',b.status,'bound_at',b.bound_at,'ended_at',b.ended_at) as row
    from public.subject_account_bindings b where b.account_id=account_at
     and (e.target_kind='account' or b.subject_id=e.target_id)
     and (history_after is null or b.id>history_after) order by b.id limit 500) x;
  elsif history_kind='account-consents' then
   select coalesce(jsonb_agg(x.row order by x.id),'[]'),count(*),max(x.id::text)::uuid into page,member_count,last_at from (
    select c.id,jsonb_build_object('id',c.id,'signature_id',c.signature_id,'subject_id',c.subject_id,'cohort_id',c.cohort_id,
     'consent_type',c.consent_type,'scope',c.scope,'provider_key',c.provider_key,'grant_revision',c.grant_revision,
     'granted_at',c.granted_at,'expires_at',c.expires_at,'revoked_at',c.revoked_at,'revocation_reason',c.revocation_reason,
     'copilot_recipient',c.copilot_recipient) as row
    from public.subject_consents c where c.account_id=account_at
     and (e.target_kind='account' or c.subject_id=e.target_id)
     and (history_after is null or c.id>history_after) order by c.id limit 500) x;
  elsif history_kind='signatures' then
   -- Never the encrypted signing name: a signature is exported as what was
   -- signed, about what, and when.
   select coalesce(jsonb_agg(x.row order by x.id),'[]'),count(*),max(x.id::text)::uuid into page,member_count,last_at from (
    select g.id,jsonb_build_object('id',g.id,'artifact_key',g.artifact_key,'artifact_version',g.artifact_version,
     'artifact_body_sha256',g.artifact_body_sha256,'signer_principal_id',g.signer_principal_id,'target_kind',g.target_kind,
     'target_id',g.target_id,'purpose',g.purpose,'statement_keys',g.statement_keys,'jurisdiction_code',g.jurisdiction_code,
     'jurisdiction_revision',g.jurisdiction_revision,'subject_binding_revision',g.subject_binding_revision,
     'signed_at',g.signed_at) as row
    from public.consent_signatures g where g.signer_account_id=account_at
     and (e.target_kind='account' or (g.target_kind='subject' and g.target_id=e.target_id))
     and (history_after is null or g.id>history_after) order by g.id limit 500) x;
  elsif history_kind='attestations' then
   select coalesce(jsonb_agg(x.row order by x.id),'[]'),count(*),max(x.id::text)::uuid into page,member_count,last_at from (
    select t.id,jsonb_build_object('id',t.id,'signature_id',t.signature_id,'principal_id',t.principal_id,
     'target_kind',t.target_kind,'target_id',t.target_id,'kind',t.kind,'statement_keys',t.statement_keys,
     'affirmed',t.affirmed,'attestation_revision',t.attestation_revision,'affirmed_at',t.affirmed_at) as row
    from public.attestations t where (t.principal_id in(select id from public.subject_principals where account_id=account_at)
      or t.signature_id in(select id from public.consent_signatures where signer_account_id=account_at))
     and (e.target_kind='account' or (t.target_kind='subject' and t.target_id=e.target_id))
     and (history_after is null or t.id>history_after) order by t.id limit 500) x;
  else
   select coalesce(jsonb_agg(x.row order by x.id),'[]'),count(*),max(x.id::text)::uuid into page,member_count,last_at from (
    select g.id,jsonb_build_object('id',g.id,'recipient_principal_id',g.recipient_principal_id,'provider_id',g.provider_id,
     'purpose',g.purpose,'artifact_key',g.artifact_key,'artifact_version',g.artifact_version,'grant_revision',g.grant_revision,
     'model_recipient_revision',g.model_recipient_revision,'status',g.status,'created_at',g.created_at,'ended_at',g.ended_at) as row
    from public.provider_recipient_grants g where g.account_id=account_at
     and (history_after is null or g.id>history_after) order by g.id limit 500) x;
  end if;
  -- A full page says whether more follow; the next call starts after it.
  result:=jsonb_build_object('kind',history_kind,'rows',page,
   'nextAfterId',case when member_count=500 then to_jsonb(last_at) else 'null'::jsonb end);
 elsif p_operation in ('chats','chat-messages') then
  -- Own Copilot conversations on a captured subject. A chat is exportable
  -- while the Copilot grant it was created under (and, for a cloud model,
  -- the provider consent) is still the same current revision. The export
  -- reads those grants directly and never the provider configuration or its
  -- transport; changing or deleting the settings supersedes the grants, which
  -- ends the chats here exactly as it ends them in the chat history and
  -- queues their deletion. Legacy unverified chats and every other scope are
  -- not exported. Within a chat,
  -- the first turn answered under a data projection that no longer holds, and
  -- everything after it, is omitted whole (chat-history-projection-v1); a
  -- chat with nothing left is not listed. Only the closed history fields
  -- leave: no target ids, grant revisions, projections or provider payloads.
  if p_operation='chats' then
   select coalesce(jsonb_agg(x.row order by x.id),'[]'),count(*),max(x.id::text)::uuid into page,member_count,last_at from (
    select ch.id,jsonb_build_object('id',ch.id,'subject_id',ch.subject_id,'scope_kind',ch.scope_kind,'created_at',ch.created_at,
     'message_count',(q.v->>'count')::integer) as row
    from public.chats ch cross join lateral (select private.export_archive_chat_messages_v1(account_at,session_at,ch.id,null,null) v) q
    where ch.user_id=account_at and ch.subject_id=any(partitions)
     and (e.target_kind='account' or ch.subject_id=e.target_id)
     and (chat_after is null or ch.id>chat_after) and (q.v->>'count')::integer>0
    order by ch.id limit 100) x;
   result:=jsonb_build_object('chats',page,'nextAfterChatId',case when member_count=100 then to_jsonb(last_at) else 'null'::jsonb end);
  else
   select * into chat_row from public.chats where id=chat_at and user_id=account_at and subject_id=any(partitions)
    and (e.target_kind='account' or subject_id=e.target_id);
   if chat_row.id is null then raise exception using errcode='42501',message='not_found'; end if;
   result:=private.export_archive_chat_messages_v1(account_at,session_at,chat_row.id,ordinal_after,200);
   if (result->>'count')::integer=0 and ordinal_after=0 then raise exception using errcode='42501',message='not_found'; end if;
   result:=result-'count';
  end if;
 elsif p_operation in ('check','variants','observed','ancestry') then
  -- The existing per-file projection keeps its own snapshot, source and grant
  -- checks; ancestry already requires a current grant on both backends.
  result:=private.own_subject_export_content_v1(p_operation,account_at,session_at,file_at,p_payload->'snapshot',coalesce(offset_at,0));
 else
  snapshot:=private.own_export_source_v1(account_at,session_at,file_at);
  if snapshot is null or snapshot is distinct from p_payload->'snapshot' then
   raise exception using errcode='42501',message='not_found'; end if;
  if snapshot ? 'preparedSource' then
   -- The prepared backend already applies the current-purpose gate.
   result:=private.own_subject_export_content_v1(p_operation,account_at,session_at,file_at,snapshot,offset_at);
  elsif not (snapshot->>'normalized')::boolean then result:='[]';
  else
   -- The database backend gets the same gate the older helper applies only to
   -- prepared sources: a completed run is exported only under its purpose's
   -- current grant. Saved results are returned verbatim, never regenerated.
   select * into f from public.genome_files where id=file_at;
   foreach purpose in array array['reports.monogenic','reports.polygenic'] loop
    if p_operation='prs' and purpose<>'reports.polygenic' then continue; end if;
    grant_authority:=null;
    begin
     grant_authority:=private.current_own_report_grant_read_v1(account_at,session_at,f.id,purpose);
     if private.own_analysis_completion_matches_v1(f.id,purpose,grant_authority) is not true then grant_authority:=null; end if;
    exception when insufficient_privilege or object_not_in_prerequisite_state then grant_authority:=null;
    end;
    if grant_authority is not null then authorities:=authorities||jsonb_build_object(purpose,grant_authority); end if;
   end loop;
   with completed as (select r.* from private.own_analysis_runs r where r.file_id=f.id and r.subject_id=f.subject_id
    and r.state='complete' and r.completed_at is not null and r.computation_revision='own-reports-v1'
    and r.source_revision=f.upload_revision and r.source_sha256=f.sha256
    and r.normalization_completed_at=f.normalization_completed_at
    and r.authority->'context'->'subjectBindingRevision'=snapshot->'binding'->'subjectBindingRevision'
    and authorities ? r.purpose and private.own_analysis_completion_matches_v1(f.id,r.purpose,authorities->r.purpose) is true)
   select case when p_operation='reports' then
    (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select r.purpose,r.completed_at,report.value as report
     from completed r cross join lateral jsonb_array_elements(r.result->'reports') with ordinality report(value,ordinality)
     where r.purpose in ('reports.monogenic','reports.polygenic') order by r.purpose,report.ordinality offset offset_at limit 1000) x)
    else (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select v.pgs_id,v.matched,v.computed_at,
     m.name,m.trait,m.ancestry_note,m.n_variants from public.user_prs v left join public.prs_scores m using(pgs_id)
     where v.file_id=f.id and v.subject_id=f.subject_id and v.user_id=f.user_id
      and exists(select 1 from completed r where r.purpose='reports.polygenic')
     order by v.id offset offset_at limit 1000) x) end into result;
   for purpose,grant_authority in select key,value from jsonb_each(authorities) loop
    if private.current_own_report_grant_read_v1(account_at,session_at,f.id,purpose) is distinct from grant_authority
     or private.own_analysis_completion_matches_v1(f.id,purpose,grant_authority) is not true then
     raise exception using errcode='42501',message='not_found'; end if;
   end loop;
   if private.own_export_source_v1(account_at,session_at,file_at) is distinct from snapshot then
    raise exception using errcode='42501',message='not_found'; end if;
  end if;
 end if;

 -- The same job, attempt, lease and full graph must still hold after the read.
 perform private.export_archive_current_v1(p_export_id,p_authority_receipt);
 if not exists(select 1 from private.export_archive_attempts a join private.export_archive_jobs job on job.active_attempt=a.id
   where a.id=att.id and a.export_id=p_export_id and a.state='writing' and a.lease_expires_at>clock_timestamp()
    and a.authority_receipt=p_authority_receipt) then
  raise exception using errcode='42501',message='not_found'; end if;
 return result;
end $$;
$inherit_chat_migration$;
begin
  if md5(migration) <> 'b90a52709fe911eaa1ae866b41a77ee8' then
    raise exception using message = 'integrity: the embedded migration text is not the reviewed file'; end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20260925220000') then
    raise exception using message = 'predecessor: 20260925220000 is already in the ledger'; end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20260925210000' and name = 'export_archive_history_reader') then
    raise exception using message = 'predecessor: the history reader row is missing'; end if;
  -- The two functions this migration replaces must be exactly the applied v2 ones,
  -- and the helper it creates must not exist yet.
  if md5(pg_get_functiondef('private.export_archive_authority_v1(jsonb,text,uuid)'::regprocedure)) <> '195dd68dd9fddd4adf4170ca5e6c1051' then
    raise exception using message = 'predecessor: the export authority is not the applied v2 definition'; end if;
  if md5(pg_get_functiondef('public.export_archive_content_v1(text,uuid,uuid,text,jsonb)'::regprocedure)) <> '2171343767e097f9b78e717e88b11b73' then
    raise exception using message = 'predecessor: the content reader is not the applied history definition'; end if;
  if to_regprocedure('private.export_archive_chat_messages_v1(uuid,uuid,uuid,bigint,integer)') is not null then
    raise exception using message = 'predecessor: the chat helper already exists'; end if;
  if exists (select 1 from private.export_archive_jobs) then
    raise exception using message = 'predecessor: an export job exists and would fail closed under the new receipt'; end if;
  if md5(pg_get_functiondef('private.export_archive_current_v1(uuid,text)'::regprocedure)) <> '707ebdae8b497640dafeb37e666d01f6' then
    raise exception using message = 'predecessor: private.export_archive_current_v1(uuid,text) differs from the tested definition'; end if;
  if md5(pg_get_functiondef('private.own_export_source_v1(uuid,uuid,uuid)'::regprocedure)) <> '27abc582be0eb4a227a7cdeb57c29d6f' then
    raise exception using message = 'predecessor: private.own_export_source_v1(uuid,uuid,uuid) differs from the tested definition'; end if;
  if md5(pg_get_functiondef('private.own_subject_export_content_v1(text,uuid,uuid,uuid,jsonb,integer)'::regprocedure)) <> '17ea9257f1ef000372456000cf4771d2' then
    raise exception using message = 'predecessor: private.own_subject_export_content_v1(text,uuid,uuid,uuid,jsonb,integer) differs from the tested definition'; end if;
  if md5(pg_get_functiondef('private.current_own_report_grant_read_v1(uuid,uuid,uuid,text)'::regprocedure)) <> '9169efeb22713a26c85f638d8880ddf9' then
    raise exception using message = 'predecessor: private.current_own_report_grant_read_v1(uuid,uuid,uuid,text) differs from the tested definition'; end if;
  if md5(pg_get_functiondef('private.own_analysis_completion_matches_v1(uuid,text,jsonb)'::regprocedure)) <> '21fc418c1566f7e70241780a6c5e8d49' then
    raise exception using message = 'predecessor: private.own_analysis_completion_matches_v1(uuid,text,jsonb) differs from the tested definition'; end if;
  if md5(pg_get_functiondef('private.own_copilot_projection_v1(jsonb)'::regprocedure)) <> '1b5b0cb758d5de47ca25d4c0e5286d57' then
    raise exception using message = 'predecessor: private.own_copilot_projection_v1(jsonb) differs from the tested definition'; end if;
  if (select md5(string_agg(a.attname||' '||format_type(a.atttypid,a.atttypmod)||case when a.attnotnull then ' nn' else '' end, ',' order by a.attname))
      from pg_attribute a where a.attrelid = 'public.chat_messages'::regclass and a.attnum > 0 and not a.attisdropped) <> '5d8dbf58f9021500ab46d7d487c0e76f' then
    raise exception using message = 'predecessor: the columns of public.chat_messages differ from the tested schema'; end if;
  if (select md5(string_agg(a.attname||' '||format_type(a.atttypid,a.atttypmod)||case when a.attnotnull then ' nn' else '' end, ',' order by a.attname))
      from pg_attribute a where a.attrelid = 'public.chats'::regclass and a.attnum > 0 and not a.attisdropped) <> '11209f3ba23a5d57d09e4f12b4d68dbc' then
    raise exception using message = 'predecessor: the columns of public.chats differ from the tested schema'; end if;
  if (select md5(string_agg(a.attname||' '||format_type(a.atttypid,a.atttypmod)||case when a.attnotnull then ' nn' else '' end, ',' order by a.attname))
      from pg_attribute a where a.attrelid = 'public.directional_grants'::regclass and a.attnum > 0 and not a.attisdropped) <> '0a79046b71145950b23077110ba9dfde' then
    raise exception using message = 'predecessor: the columns of public.directional_grants differ from the tested schema'; end if;
  if (select md5(string_agg(a.attname||' '||format_type(a.atttypid,a.atttypmod)||case when a.attnotnull then ' nn' else '' end, ',' order by a.attname))
      from pg_attribute a where a.attrelid = 'public.purpose_grants'::regclass and a.attnum > 0 and not a.attisdropped) <> 'b93f12a102c5a34a9773fe41fd3d67a5' then
    raise exception using message = 'predecessor: the columns of public.purpose_grants differ from the tested schema'; end if;
  if (select md5(string_agg(a.attname||' '||format_type(a.atttypid,a.atttypmod)||case when a.attnotnull then ' nn' else '' end, ',' order by a.attname))
      from pg_attribute a where a.attrelid = 'public.subject_consents'::regclass and a.attnum > 0 and not a.attisdropped) <> '2fffaaf8f2d9f4bc799b78a42b607235' then
    raise exception using message = 'predecessor: the columns of public.subject_consents differ from the tested schema'; end if;

  execute migration;

  if md5(pg_get_functiondef('private.export_archive_authority_v1(jsonb,text,uuid)'::regprocedure)) <> 'f46201730da410b9d9a2350bf4f14581' then
    raise exception using message = 'postcheck: the export authority differs from the tested v3 definition'; end if;
  if md5(pg_get_functiondef('public.export_archive_content_v1(text,uuid,uuid,text,jsonb)'::regprocedure)) <> '8f5007d0245b323eb28b3d3c116cc699' then
    raise exception using message = 'postcheck: the content reader differs from the tested definition'; end if;
  if md5(pg_get_functiondef('private.export_archive_chat_messages_v1(uuid,uuid,uuid,bigint,integer)'::regprocedure)) <> 'd690ea2fe2d3daacc75e290cf225839b' then
    raise exception using message = 'postcheck: the chat helper differs from the tested definition'; end if;
  if (select count(*) from pg_proc where oid in ('private.export_archive_authority_v1(jsonb,text,uuid)'::regprocedure, 'public.export_archive_content_v1(text,uuid,uuid,text,jsonb)'::regprocedure, 'private.export_archive_chat_messages_v1(uuid,uuid,uuid,bigint,integer)'::regprocedure)
      and prosecdef and proconfig = array['search_path=pg_catalog, private']) <> 3 then
    raise exception using message = 'postcheck: security definer or search path changed'; end if;
  if has_function_privilege('anon', 'public.export_archive_content_v1(text,uuid,uuid,text,jsonb)', 'execute') or has_function_privilege('authenticated', 'public.export_archive_content_v1(text,uuid,uuid,text,jsonb)', 'execute')
     or has_function_privilege('inherit_upload_only', 'public.export_archive_content_v1(text,uuid,uuid,text,jsonb)', 'execute')
     or has_function_privilege('anon', 'private.export_archive_authority_v1(jsonb,text,uuid)', 'execute') or has_function_privilege('authenticated', 'private.export_archive_authority_v1(jsonb,text,uuid)', 'execute')
     or has_function_privilege('service_role', 'private.export_archive_authority_v1(jsonb,text,uuid)', 'execute')
     or has_function_privilege('public', 'private.export_archive_chat_messages_v1(uuid,uuid,uuid,bigint,integer)', 'execute') or has_function_privilege('anon', 'private.export_archive_chat_messages_v1(uuid,uuid,uuid,bigint,integer)', 'execute')
     or has_function_privilege('authenticated', 'private.export_archive_chat_messages_v1(uuid,uuid,uuid,bigint,integer)', 'execute') or has_function_privilege('inherit_upload_only', 'private.export_archive_chat_messages_v1(uuid,uuid,uuid,bigint,integer)', 'execute')
     or has_function_privilege('service_role', 'private.export_archive_chat_messages_v1(uuid,uuid,uuid,bigint,integer)', 'execute') then
    raise exception using message = 'postcheck: a role gained execution it must not have'; end if;
  if not has_function_privilege('service_role', 'public.export_archive_content_v1(text,uuid,uuid,text,jsonb)', 'execute') then
    raise exception using message = 'postcheck: service_role cannot execute the content reader'; end if;
  if md5(pg_get_functiondef('private.export_archive_current_v1(uuid,text)'::regprocedure)) <> '707ebdae8b497640dafeb37e666d01f6' then
    raise exception using message = 'postcheck: private.export_archive_current_v1(uuid,text) differs from the tested definition'; end if;
  if md5(pg_get_functiondef('private.own_export_source_v1(uuid,uuid,uuid)'::regprocedure)) <> '27abc582be0eb4a227a7cdeb57c29d6f' then
    raise exception using message = 'postcheck: private.own_export_source_v1(uuid,uuid,uuid) differs from the tested definition'; end if;
  if md5(pg_get_functiondef('private.own_subject_export_content_v1(text,uuid,uuid,uuid,jsonb,integer)'::regprocedure)) <> '17ea9257f1ef000372456000cf4771d2' then
    raise exception using message = 'postcheck: private.own_subject_export_content_v1(text,uuid,uuid,uuid,jsonb,integer) differs from the tested definition'; end if;
  if md5(pg_get_functiondef('private.current_own_report_grant_read_v1(uuid,uuid,uuid,text)'::regprocedure)) <> '9169efeb22713a26c85f638d8880ddf9' then
    raise exception using message = 'postcheck: private.current_own_report_grant_read_v1(uuid,uuid,uuid,text) differs from the tested definition'; end if;
  if md5(pg_get_functiondef('private.own_analysis_completion_matches_v1(uuid,text,jsonb)'::regprocedure)) <> '21fc418c1566f7e70241780a6c5e8d49' then
    raise exception using message = 'postcheck: private.own_analysis_completion_matches_v1(uuid,text,jsonb) differs from the tested definition'; end if;
  if md5(pg_get_functiondef('private.own_copilot_projection_v1(jsonb)'::regprocedure)) <> '1b5b0cb758d5de47ca25d4c0e5286d57' then
    raise exception using message = 'postcheck: private.own_copilot_projection_v1(jsonb) differs from the tested definition'; end if;

  insert into supabase_migrations.schema_migrations (version, name, statements)
  values ('20260925220000', 'export_archive_chat_reader', array[migration]);
  raise exception using message = 'DRY_RUN_COMPLETE_ALL_CHECKS_PASSED';
end
$inherit_chat_do$;
