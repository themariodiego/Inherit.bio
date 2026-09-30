-- The Family group Copilot scope (register copilot-route-scope-v1 `family`,
-- scope-derived-v1 `family:individual-risks`, chat-scope-v1). A family group
-- conversation belongs to one asking account and reads only what each other
-- adult has currently granted to that account, member by member:
--
--   * `copilot.local`, signed by that adult for exactly this recipient: the
--     Copilot purpose, separate from every result purpose;
--   * `family.heritability`, from that adult to this recipient, as the
--     register's `requiredLivePurposeFromEachReferencedSubject`;
--   * the result layer itself (`reports.monogenic`, `reports.polygenic`),
--     through the existing canonical recipient authority
--     private.family_report_recipient_v1, never its legacy-only branch.
--
-- A current pause, a changed relationship, principal, binding or jurisdiction
-- revision, an ended adult endpoint or any missing grant removes the adult
-- from the next check. Nothing here reads a genotype outside a captured
-- report; content is still read only through family_shared_report_results_v1.
--
-- A group conversation has no single target row, so a family chat anchored on
-- no pair is allowed only as a canonical, non-legacy group chat. Each turn
-- records exactly whose data its tools returned: retrieved_subject_ids,
-- retrieved_purpose_keys and one copilot_turn_dependencies row per grant,
-- subject and source. The existing revocation helper
-- private.delete_pair_derived_rows_v1 therefore deletes an affected turn and
-- its suffix synchronously when any of those grants is withdrawn, and the
-- history reader hides a whole conversation while any dependency is not
-- current (for example a pause), so no later turn can build on it.
--
-- No table is added. Service-only doors; browsers call none of them.

alter table public.chats drop constraint chats_scope_target_check;
alter table public.chats add constraint chats_scope_target_check check (
  (scope_kind in ('self', 'subject') and subject_id is not null and num_nonnulls(cohort_id, family_pair_id, report_id) = 0)
  or (scope_kind = 'cohort' and cohort_id is not null and num_nonnulls(subject_id, family_pair_id, report_id) = 0)
  or (scope_kind = 'family' and family_pair_id is not null and num_nonnulls(subject_id, cohort_id, report_id) = 0)
  or (scope_kind = 'family' and num_nonnulls(subject_id, cohort_id, family_pair_id, report_id) = 0
    and legacy_unverified is false and canonical_authority is not null
    and canonical_authority->>'scope' = 'family-group')
  or (scope_kind = 'report' and report_id is not null and num_nonnulls(subject_id, cohort_id, family_pair_id) = 0)
);

-- One exact current directional grant from the owner of p_subject to
-- p_recipient for one purpose, under the endpoints just resolved. The
-- predicate is private.family_report_recipient_v1's, without its report-only
-- grant snapshot table: signer, data subject principal, binding and
-- jurisdiction revisions, the signature, the current hash-verified
-- share-with-adult artifact, the recipient principal and the relationship
-- revision all have to match. Null when there is none.
create function private.family_copilot_directional_grant_v1(p_owner uuid, p_subject uuid, p_recipient uuid,
 p_endpoints jsonb, p_purpose text)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare receipt jsonb;
begin
 if p_purpose is null or p_purpose not in ('copilot.local','family.heritability') then return null; end if;
 select jsonb_build_object('purpose',pg.purpose,'grantId',pg.grant_id,'grantRevision',pg.grant_revision) into receipt
 from public.purpose_grants pg
 join public.directional_grants dg on dg.grant_id=pg.grant_id and dg.grant_revision=pg.grant_revision
 join public.consent_artifacts ca on ca.artifact_key=pg.artifact_key and ca.version=pg.artifact_version and ca.body_sha256=pg.artifact_body_sha256
 join public.consent_signatures cs on cs.id=pg.signature_id and cs.artifact_key=ca.artifact_key
  and cs.artifact_version=ca.version and cs.artifact_body_sha256=ca.body_sha256
 where pg.target_kind='subject' and pg.target_id=p_subject and pg.purpose=p_purpose
  and pg.signer_principal_id=(p_endpoints#>>'{owner,principalId}')::uuid and pg.data_subject_principal_id=pg.signer_principal_id
  and pg.subject_binding_revision=(p_endpoints#>>'{owner,subjectBindingRevision}')::bigint
  and pg.jurisdiction_revision=(p_endpoints#>>'{owner,jurisdictionRevision}')::bigint
  and cs.signer_principal_id=pg.signer_principal_id and cs.signer_account_id=p_owner
  and cs.target_kind=pg.target_kind and cs.target_id=pg.target_id and cs.purpose=pg.purpose
  and cs.subject_binding_revision=pg.subject_binding_revision and cs.jurisdiction_revision=pg.jurisdiction_revision
  and pg.revoked_at is null and (pg.expires_at is null or pg.expires_at>clock_timestamp())
  and dg.status='current' and dg.direction='subject_to_recipient' and dg.recipient_account_id=p_recipient
  and dg.recipient_principal_id=(p_endpoints#>>'{recipient,principalId}')::uuid and dg.pair_id is null
  and dg.relationship_id=(p_endpoints#>>'{relationship,id}')::uuid
  and dg.relationship_or_pair_revision=(p_endpoints#>>'{relationship,revision}')::bigint
  and ca.artifact_key='consent.share-with-adult' and ca.superseded_at is null
  and ca.published_at<=clock_timestamp() and ca.effective_on<=timezone('UTC',clock_timestamp())::date
  and ca.body_sha256=encode(extensions.digest(convert_to(ca.body_markdown,'UTF8'),'sha256'),'hex')
 order by pg.grant_id limit 1;
 return receipt;
end; $$;

-- One adult of the asking account's family group, or not_found. The returned
-- object is the exact authority a turn is bound to; a later check compares it
-- whole, so any change to any part of it withdraws the adult.
create function private.family_copilot_member_v1(p_account uuid, p_session uuid, p_subject uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v_owner uuid; v_lifecycle bigint; e jsonb; copilot jsonb; heritability jsonb; layers jsonb:='[]'; layer jsonb; purpose_key text;
begin
 perform private.family_report_session_v1(p_account,p_session);
 select s.subject_account_id,s.lifecycle_revision into v_owner,v_lifecycle from public.subjects s
  where s.id=p_subject and s.subject_class='self' and s.lifecycle='active' and s.independent_login_at is not null;
 if v_owner is null or v_owner=p_account then raise exception using errcode='42501',message='not_found'; end if;
 -- Both adult endpoints, no current pause, and the one current relationship.
 e:=private.family_report_endpoints_v1(v_owner,p_subject,p_account,true);
 if jsonb_typeof(e->'relationship') is distinct from 'object' then raise exception using errcode='42501',message='not_found'; end if;
 copilot:=private.family_copilot_directional_grant_v1(v_owner,p_subject,p_account,e,'copilot.local');
 heritability:=private.family_copilot_directional_grant_v1(v_owner,p_subject,p_account,e,'family.heritability');
 if copilot is null or heritability is null then raise exception using errcode='42501',message='not_found'; end if;
 foreach purpose_key in array array['reports.monogenic','reports.polygenic'] loop
  begin
   layer:=private.family_report_recipient_v1(p_account,p_session,p_subject,purpose_key);
   if (layer->>'legacyOnly')::boolean is false and layer->'endpoints'=e then
    layers:=layers||jsonb_build_array(jsonb_build_object('purpose',purpose_key,
     'grantId',layer->'grantId','grantRevision',layer->'grantRevision'));
   end if;
  exception when insufficient_privilege or object_not_in_prerequisite_state then null;
  end;
 end loop;
 return jsonb_build_object('subjectId',p_subject,'accountId',v_owner,'lifecycleRevision',v_lifecycle,
  'relationship',e->'relationship','copilot',copilot,'heritability',heritability,'layers',layers);
end; $$;

-- The group as it stands now: every adult who has a current copilot.local
-- grant to this account and passes the whole member check with at least one
-- canonical result layer. Ordered by subject id; capped at 100.
create function public.family_copilot_scope_v1(p_account_id uuid, p_session_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare members jsonb:='[]'; member jsonb; v_subject uuid;
begin
 perform private.family_report_session_v1(p_account_id,p_session_id);
 for v_subject in select distinct pg.target_id from public.purpose_grants pg
  join public.directional_grants dg on dg.grant_id=pg.grant_id and dg.grant_revision=pg.grant_revision
  join public.subjects s on s.id=pg.target_id
  where pg.purpose='copilot.local' and pg.target_kind='subject' and pg.revoked_at is null
   and (pg.expires_at is null or pg.expires_at>clock_timestamp())
   and dg.status='current' and dg.direction='subject_to_recipient' and dg.recipient_account_id=p_account_id
   and s.subject_class='self' and s.subject_account_id is distinct from p_account_id
  order by pg.target_id limit 100
 loop
  begin
   member:=private.family_copilot_member_v1(p_account_id,p_session_id,v_subject);
   if jsonb_array_length(member->'layers')>0 then members:=members||jsonb_build_array(member); end if;
  exception when insufficient_privilege or object_not_in_prerequisite_state then null;
  end;
 end loop;
 return members;
end; $$;

-- Replies carry only these links: a person's Family page, one of their shared
-- report pages, or a publication. The model supplies none of them. Like its
-- own-scope twin, it is an invoker function the row constraint below calls.
create function private.valid_family_copilot_citations_v1(value jsonb)
returns boolean language plpgsql immutable security invoker set search_path=pg_catalog as $$
begin
 if jsonb_typeof(value) is distinct from 'array' or jsonb_array_length(value)>100 then return false; end if;
 return not exists(select 1 from jsonb_array_elements(value) c where jsonb_typeof(c) is distinct from 'object'
  or c-array['id','label','href']<>'{}'::jsonb or not(c ?& array['id','label','href'])
  or jsonb_typeof(c->'id') is distinct from 'string' or length(coalesce(c->>'id','')) not between 1 and 2000
  or jsonb_typeof(c->'label') is distinct from 'string' or length(coalesce(c->>'label','')) not between 1 and 1000
  or jsonb_typeof(c->'href') is distinct from 'string' or length(coalesce(c->>'href','')) not between 1 and 4000
  or coalesce(c->>'href','') !~ '^(/family/s-[0-9a-f-]{36}|/genome/s-[0-9a-f-]{36}/reports/[^/?#]+|https://pubmed\.ncbi\.nlm\.nih\.gov/[0-9]{6,9}/|https://doi\.org/[^[:space:]]+)$');
end; $$;
revoke all on function private.valid_family_copilot_citations_v1(jsonb) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.valid_family_copilot_citations_v1(jsonb) to service_role;
-- Stored citations are either the own scope's or the group scope's closed
-- set. Each dispatcher validates its own set before it writes.
alter table public.chat_messages drop constraint canonical_chat_citations_valid;
alter table public.chat_messages add constraint canonical_chat_citations_valid
 check(private.valid_own_copilot_citations_v1(canonical_citations) is true
  or private.valid_family_copilot_citations_v1(canonical_citations) is true);

-- The state of one turn's recorded dependencies: 'ended' when any grant is
-- no longer the same current revision (revoked, expired or replaced), any
-- adult's self subject is no longer active at its lifecycle revision, or any
-- source file is gone or changed; 'paused' when the only obstacle is a
-- current pause between the two accounts; otherwise 'current'.
create function private.family_copilot_turn_state_v1(p_account uuid, p_chat uuid, p_turn uuid)
returns text language sql stable security definer set search_path=pg_catalog as $$
 select case
  when exists(select 1 from public.copilot_turn_dependencies d where d.chat_id=p_chat and d.turn_id=p_turn and (
   (d.dependency_kind='grant' and not exists(select 1 from public.purpose_grants g
     join public.directional_grants dg on dg.grant_id=g.grant_id and dg.grant_revision=g.grant_revision
     where g.grant_id=d.dependency_id and g.grant_revision=d.dependency_revision and g.revoked_at is null
      and (g.expires_at is null or g.expires_at>clock_timestamp()) and dg.status='current'))
   or (d.dependency_kind='subject' and not exists(select 1 from public.subjects s
     where s.id=d.dependency_id and s.lifecycle='active' and s.lifecycle_revision=d.dependency_revision
      and s.subject_account_id is not null))
   or (d.dependency_kind='file' and not exists(select 1 from public.genome_files f
     where f.id=d.dependency_id and f.upload_revision=d.dependency_revision
      and not exists(select 1 from private.genome_file_deletions x where x.file_id=f.id)))
   or d.dependency_kind not in ('grant','subject','file'))) then 'ended'
  when exists(select 1 from public.copilot_turn_dependencies d join public.subjects s on s.id=d.dependency_id
   where d.chat_id=p_chat and d.turn_id=p_turn and d.dependency_kind='subject'
    and private.family_sharing_paused_v1(s.subject_account_id,p_account) is not false) then 'paused'
  else 'current' end
$$;

-- Stale state deletes the complete paired-turn dependency set: the first
-- ended turn and every later turn of the conversation, both roles, with their
-- dependency and context rows. A paused turn is kept but makes the whole
-- conversation unreadable until the pause ends. Returns true when the
-- conversation still has turns and every one of them is current.
create function private.family_copilot_prune_v1(p_account uuid, p_chat uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare cutoff bigint;
begin
 select min(m.turn_ordinal) into cutoff from public.chat_messages m where m.chat_id=p_chat
  and (m.legacy_unverified is not false or private.family_copilot_turn_state_v1(p_account,p_chat,m.turn_id)='ended');
 if cutoff is not null then
  delete from public.copilot_turn_dependencies d using public.chat_messages m
   where d.chat_id=p_chat and m.chat_id=p_chat and d.turn_id=m.turn_id and m.turn_ordinal>=cutoff;
  delete from public.copilot_context_history h using public.chat_messages m
   where h.chat_id=p_chat and m.chat_id=p_chat and h.turn_id=m.turn_id and m.turn_ordinal>=cutoff;
  delete from public.chat_messages where chat_id=p_chat and turn_ordinal>=cutoff;
 end if;
 return exists(select 1 from public.chat_messages m where m.chat_id=p_chat)
  and not exists(select 1 from public.chat_messages m where m.chat_id=p_chat
   and private.family_copilot_turn_state_v1(p_account,p_chat,m.turn_id)<>'current');
end; $$;

-- The provider authority a group chat was created under, without the fields
-- a refreshed sign-in changes (the own chat reader compares the same way).
create function private.family_copilot_provider_key_v1(p_provider jsonb)
returns jsonb language sql immutable set search_path=pg_catalog as $$
 select (p_provider-'sessionId') #- '{context,originatingSessionRevision}' #- '{context,authSessionRevision}'
$$;

-- Service-only dispatcher: check, list, history, commit.
create function public.family_copilot_chat_v1(p_operation text, p_account_id uuid, p_session_id uuid,
 p_chat_id uuid default null, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v_chat public.chats%rowtype; v_member jsonb; v_fresh jsonb; v_layer jsonb; v_used jsonb; v_purpose text; v_file jsonb;
 v_self uuid; v_self_lifecycle bigint; v_provider jsonb; v_result jsonb; v_ordinal bigint; v_turn uuid:=gen_random_uuid();
 v_subjects uuid[]:='{}'; v_accounts uuid[]:='{}'; v_purposes text[]:='{}'; v_revisions bigint[]:='{}'; v_lifecycles bigint[]:='{}';
 v_deps jsonb:='[]'; v_source jsonb; v_fingerprint text; v_role text; v_id uuid;
begin
 if p_operation is null or p_operation not in ('check','list','history','commit') or p_payload is null
  or jsonb_typeof(p_payload) is distinct from 'object' then raise exception using errcode='22023',message='invalid_request'; end if;
 perform private.family_report_session_v1(p_account_id,p_session_id);

 if p_operation='check' then
  if p_chat_id is not null or p_payload-array['members']<>'{}'::jsonb or jsonb_typeof(p_payload->'members') is distinct from 'array'
   or jsonb_array_length(p_payload->'members')>100 then raise exception using errcode='22023',message='invalid_request'; end if;
  for v_member in select value from jsonb_array_elements(p_payload->'members') loop
   if jsonb_typeof(v_member) is distinct from 'object' or jsonb_typeof(v_member->'subjectId') is distinct from 'string' then
    raise exception using errcode='22023',message='invalid_request'; end if;
   if private.family_copilot_member_v1(p_account_id,p_session_id,(v_member->>'subjectId')::uuid) is distinct from v_member then
    raise exception using errcode='42501',message='not_found'; end if;
  end loop;
  return 'true'::jsonb;
 end if;

 if p_operation='list' then
  if p_chat_id is not null or p_payload<>'{}'::jsonb then raise exception using errcode='22023',message='invalid_request'; end if;
  v_result:='[]';
  for v_id in select ch.id from public.chats ch where ch.user_id=p_account_id and ch.scope_kind='family'
   and ch.family_pair_id is null and ch.legacy_unverified is false and ch.canonical_authority->>'scope'='family-group'
   order by ch.created_at desc,ch.id limit 200 loop
   if private.family_copilot_prune_v1(p_account_id,v_id) and jsonb_array_length(v_result)<50 then
    v_result:=v_result||jsonb_build_array((select jsonb_build_object('id',ch.id,'created_at',ch.created_at)
     from public.chats ch where ch.id=v_id));
   end if;
  end loop;
  return v_result;
 end if;

 select s.id,s.lifecycle_revision into v_self,v_self_lifecycle from public.subjects s
  where s.subject_account_id=p_account_id and s.subject_class='self' and s.lifecycle='active' order by s.created_at,s.id limit 1;
 if v_self is null or jsonb_typeof(p_payload->'provider') is distinct from 'object' then
  raise exception using errcode='42501',message='not_found'; end if;
 v_provider:=p_payload->'provider';
 -- Group scopes are true non-self scopes: local transport only, under the
 -- asker's own exact current Copilot configuration and permission.
 if v_provider->>'providerClass' is distinct from 'local'
  or private.own_copilot_authority_v1(p_account_id,p_session_id,v_self,v_provider) is null then
  raise exception using errcode='42501',message='not_found'; end if;

 if p_chat_id is not null then
  select * into v_chat from public.chats where id=p_chat_id and user_id=p_account_id for update;
  if v_chat.id is null or v_chat.scope_kind<>'family' or v_chat.family_pair_id is not null or v_chat.legacy_unverified is not false
   or v_chat.canonical_authority->>'scope' is distinct from 'family-group'
   or private.family_copilot_provider_key_v1(v_chat.canonical_authority->'provider')
    is distinct from private.family_copilot_provider_key_v1(v_provider) then
   raise exception using errcode='42501',message='not_found'; end if;
  -- Not an exception: the deletion of ended turns must commit even though
  -- the conversation is no longer readable. The caller treats null as 404.
  if private.family_copilot_prune_v1(p_account_id,v_chat.id) is not true then return 'null'::jsonb; end if;
 end if;

 if p_operation='history' then
  if v_chat.id is null or p_payload-array['provider']<>'{}'::jsonb then
   raise exception using errcode='42501',message='not_found'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.turn_ordinal,x.role desc),'[]') into v_result from (
   select m.id,m.role,m.content,m.canonical_citations as citations,m.turn_ordinal,m.created_at from public.chat_messages m
   where m.chat_id=v_chat.id and m.user_id=p_account_id order by m.turn_ordinal desc,m.role limit 100) x;
  return jsonb_build_object('chatId',v_chat.id,'messages',v_result,
   'lastOrdinal',coalesce((select max(turn_ordinal) from public.chat_messages where chat_id=v_chat.id),0));
 end if;

 -- commit: one validated question/answer pair, bound to exactly the adults
 -- whose data the turn's tools returned.
 if p_payload-array['message','answer','citations','lastOrdinal','nonceHash','expiresAt','provider','used']<>'{}'::jsonb
  or not(p_payload ?& array['message','answer','citations','lastOrdinal','nonceHash','expiresAt','provider','used'])
  or jsonb_typeof(p_payload->'message') is distinct from 'string' or jsonb_typeof(p_payload->'answer') is distinct from 'string'
  or length(p_payload->>'message') not between 1 and 8000 or length(p_payload->>'answer') not between 1 and 64000
  or coalesce(p_payload->>'lastOrdinal','') !~ '^(0|[1-9][0-9]*)$'
  or jsonb_typeof(p_payload->'used') is distinct from 'array' or jsonb_array_length(p_payload->'used')>100
  or private.valid_family_copilot_citations_v1(p_payload->'citations') is not true then
  raise exception using errcode='22023',message='invalid_request'; end if;

 select coalesce(array_agg(distinct (u#>>'{authority,subjectId}')::uuid),'{}') into v_subjects from jsonb_array_elements(p_payload->'used') u;
 if cardinality(v_subjects)<>jsonb_array_length(p_payload->'used') then raise exception using errcode='22023',message='invalid_request'; end if;
 perform 1 from public.subjects where id=any(v_subjects) order by id for share nowait;
 perform 1 from public.purpose_grants where target_kind='subject' and target_id=any(v_subjects) order by grant_id for share nowait;
 perform 1 from public.directional_grants where grant_id in(select grant_id from public.purpose_grants
  where target_kind='subject' and target_id=any(v_subjects)) order by grant_id for share nowait;
 perform 1 from public.genome_files where subject_id=any(v_subjects) order by id for share nowait;

 for v_used in select value from jsonb_array_elements(p_payload->'used') order by value#>>'{authority,subjectId}' loop
  if jsonb_typeof(v_used) is distinct from 'object' or v_used-array['authority','purposes','files']<>'{}'::jsonb
   or not(v_used ?& array['authority','purposes','files']) or jsonb_typeof(v_used->'authority') is distinct from 'object'
   or jsonb_typeof(v_used->'purposes') is distinct from 'array' or jsonb_array_length(v_used->'purposes') not between 1 and 2
   or jsonb_typeof(v_used->'files') is distinct from 'array' or jsonb_array_length(v_used->'files') not between 1 and 200 then
   raise exception using errcode='22023',message='invalid_request'; end if;
  v_member:=v_used->'authority';
  v_fresh:=private.family_copilot_member_v1(p_account_id,p_session_id,(v_member->>'subjectId')::uuid);
  if v_fresh is distinct from v_member then raise exception using errcode='42501',message='not_found'; end if;
  v_fingerprint:=encode(extensions.digest(convert_to(v_fresh::text,'UTF8'),'sha256'),'hex');
  v_deps:=v_deps||jsonb_build_array(
   jsonb_build_object('kind','subject','id',v_fresh->>'subjectId','revision',(v_fresh->>'lifecycleRevision')::bigint,'fp',v_fingerprint),
   jsonb_build_object('kind','grant','id',v_fresh#>>'{copilot,grantId}','revision',(v_fresh#>>'{copilot,grantRevision}')::bigint,'fp',v_fingerprint),
   jsonb_build_object('kind','grant','id',v_fresh#>>'{heritability,grantId}','revision',(v_fresh#>>'{heritability,grantRevision}')::bigint,'fp',v_fingerprint));
  v_revisions:=v_revisions||(v_fresh#>>'{copilot,grantRevision}')::bigint||(v_fresh#>>'{heritability,grantRevision}')::bigint;
  for v_purpose in select value from jsonb_array_elements_text(v_used->'purposes') loop
   -- A turn may use a result layer only through that layer's own grant.
   v_layer:=null;
   select value into v_layer from jsonb_array_elements(v_fresh->'layers') where value->>'purpose'=v_purpose;
   if v_layer is null then raise exception using errcode='42501',message='not_found'; end if;
   v_deps:=v_deps||jsonb_build_array(jsonb_build_object('kind','grant','id',v_layer->>'grantId',
    'revision',(v_layer->>'grantRevision')::bigint,'fp',v_fingerprint));
   v_revisions:=v_revisions||(v_layer->>'grantRevision')::bigint;
   v_purposes:=array_append(v_purposes,v_purpose);
  end loop;
  for v_file in select value from jsonb_array_elements(v_used->'files') loop
   if jsonb_typeof(v_file) is distinct from 'object' or v_file-array['fileId','purpose']<>'{}'::jsonb
    or jsonb_typeof(v_file->'fileId') is distinct from 'string' or jsonb_typeof(v_file->'purpose') is distinct from 'string'
    or not(v_used->'purposes' ? (v_file->>'purpose')) then raise exception using errcode='22023',message='invalid_request'; end if;
   -- The adult's own current authority over this exact completed source.
   v_source:=private.family_source_report_authority_v1((v_fresh->>'accountId')::uuid,(v_file->>'fileId')::uuid,v_file->>'purpose');
   if v_source->>'subjectId' is distinct from v_fresh->>'subjectId' then raise exception using errcode='42501',message='not_found'; end if;
   v_deps:=v_deps||jsonb_build_array(
    jsonb_build_object('kind','grant','id',v_source->>'grantId','revision',(v_source->>'grantRevision')::bigint,'fp',v_fingerprint),
    jsonb_build_object('kind','file','id',v_file->>'fileId','revision',(v_source->>'sourceRevision')::bigint,'fp',v_fingerprint));
  end loop;
  v_accounts:=array_append(v_accounts,(v_fresh->>'accountId')::uuid);
  v_lifecycles:=array_append(v_lifecycles,(v_fresh->>'lifecycleRevision')::bigint);
 end loop;
 if cardinality(v_subjects)>0 then
  select array_agg(distinct x order by x) into v_purposes from unnest(array['copilot.local','family.heritability']||v_purposes) x;
 end if;

 if v_chat.id is null then
  if p_payload->>'lastOrdinal'<>'0' or jsonb_typeof(p_payload->'nonceHash') is distinct from 'string'
   or coalesce(p_payload->>'nonceHash','') !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_payload->'expiresAt') is distinct from 'string'
   or (p_payload->>'expiresAt')::timestamptz<=clock_timestamp()
   or (p_payload->>'expiresAt')::timestamptz>clock_timestamp()+interval '10 minutes' then
   raise exception using errcode='42501',message='not_found'; end if;
  delete from public.copilot_context_tokens where account_id=p_account_id and scope_kind='family'
   and target_id=p_account_id and expires_at<=clock_timestamp();
  -- The page's single-use context: a second presentation fails closed.
  begin
   insert into public.copilot_context_tokens(account_id,chat_id,scope_kind,target_id,issuing_route_id,nonce_hash,
    authorization_fingerprint,token_revision,expires_at,redeemed_at)
   values(p_account_id,null,'family',p_account_id,'copilot.scope',p_payload->>'nonceHash',
    encode(extensions.digest(convert_to(v_provider::text,'UTF8'),'sha256'),'hex'),1,(p_payload->>'expiresAt')::timestamptz,clock_timestamp());
  exception when unique_violation then raise exception using errcode='42501',message='not_found';
  end;
  insert into public.chats(user_id,scope_kind,lifecycle_revision,provider_classification,runtime_attestation_revision,
   model_recipient_revision,authorization_fingerprint,legacy_unverified,canonical_authority)
  values(p_account_id,'family',v_self_lifecycle,'local',1,(v_provider->>'recipientRevision')::bigint,
   encode(extensions.digest(convert_to(v_provider::text,'UTF8'),'sha256'),'hex'),false,
   jsonb_build_object('scope','family-group','provider',v_provider)) returning * into v_chat;
 elsif p_payload->'nonceHash' is distinct from 'null'::jsonb or p_payload->'expiresAt' is distinct from 'null'::jsonb then
  raise exception using errcode='22023',message='invalid_request';
 end if;
 select coalesce(max(turn_ordinal),0)+1 into v_ordinal from public.chat_messages where chat_id=v_chat.id;
 if v_ordinal<>(p_payload->>'lastOrdinal')::bigint+1 then raise exception using errcode='40001',message='chat_changed'; end if;

 foreach v_role in array array['user','assistant'] loop
  insert into public.chat_messages(chat_id,user_id,role,content,turn_id,turn_ordinal,paired_role,scope_revision,
   authorization_fingerprint,retrieved_subject_ids,retrieved_purpose_keys,contributor_ids,grant_revisions,lifecycle_revisions,
   provider_classification,runtime_attestation_revision,model_recipient_revision,legacy_unverified,canonical_citations,citation_ids)
  values(v_chat.id,p_account_id,v_role,jsonb_build_array(jsonb_build_object('type','text','text',
    case when v_role='user' then p_payload->>'message' else p_payload->>'answer' end)),
   v_turn,v_ordinal,v_role,v_chat.scope_revision,v_chat.authorization_fingerprint,
   (select coalesce(array_agg(x order by x),'{}') from unnest(v_subjects) x),coalesce(v_purposes,'{}'),
   (select coalesce(array_agg(x order by x),'{}') from unnest(v_accounts) x),v_revisions,v_lifecycles,
   'local',1,v_chat.model_recipient_revision,false,
   case when v_role='assistant' then p_payload->'citations' else '[]'::jsonb end,
   case when v_role='assistant' then array(select x->>'id' from jsonb_array_elements(p_payload->'citations') x) else '{}'::text[] end);
 end loop;
 insert into public.copilot_turn_dependencies(chat_id,turn_id,dependency_kind,dependency_id,dependency_revision,source_binding_fingerprint)
 select v_chat.id,v_turn,d->>'kind',(d->>'id')::uuid,(d->>'revision')::bigint,d->>'fp' from jsonb_array_elements(v_deps) d
 on conflict do nothing;
 return jsonb_build_object('chatId',v_chat.id);
exception when lock_not_available then raise exception using errcode='42501',message='not_found';
end; $$;

revoke all on function private.family_copilot_directional_grant_v1(uuid,uuid,uuid,jsonb,text),
 private.family_copilot_member_v1(uuid,uuid,uuid),
 private.family_copilot_turn_state_v1(uuid,uuid,uuid),private.family_copilot_prune_v1(uuid,uuid),
 private.family_copilot_provider_key_v1(jsonb)
 from public,anon,authenticated,inherit_upload_only,service_role;
revoke all on function public.family_copilot_scope_v1(uuid,uuid),public.family_copilot_chat_v1(text,uuid,uuid,uuid,jsonb)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function public.family_copilot_scope_v1(uuid,uuid),public.family_copilot_chat_v1(text,uuid,uuid,uuid,jsonb)
 to service_role;
