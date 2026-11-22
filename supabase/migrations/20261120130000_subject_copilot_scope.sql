-- =====================================================================
-- PRODUCTION RELEASE: GUARDED. This migration is applied to local and CI
-- databases only. It must reach a hosted database through the guarded
-- production release (preflight, postflight, receipt), never as a side
-- effect of a merge. Nothing here opens on the hosted service: the scope it
-- serves runs only on a server-attested same-host local model, which the
-- hosted service never has, and it needs third_party_adult_analysis, which
-- no real jurisdiction permits. Path B, whose door it widens, is TEST-LOCAL
-- only. It follows 20260929140000 (the Family group scope it reuses),
-- 20260930220000 and 20260930236000 (Path B's reading layer and reports),
-- 20261009224500 and 20261120120000 (the mitigation decision it calls) and
-- 20261016181000 (the subject-delete purge it mirrors).
-- =====================================================================
--
-- G8.5, owner decision of 19 November 2026 ("G8.5: Copilot for another
-- adult's record opens", docs/protocol/decisions.md): Copilot for ONE other
-- adult's record on a self-hosted install with a local model only, the
-- register's scope-derived-v1 `subject:adult` / `uploader-or-grantee` case.
-- The cloud path is not built: copilot-transport-availability-v1 keeps every
-- such scope unavailable off a same-host local model, and nothing here
-- accepts a cloud provider.
--
-- Two relationships, both the register's uploader-or-grantee:
--   * grantee: the subject is another account's own `self` record, read
--     through the current Family relationship (the same recipient authority
--     the Family pages and the Family group scope read);
--   * uploader: the subject is a confirmed Path B `other_adult` record the
--     asker owns, bound to the person's own account.
--
-- The order of checks is the register's: other-adult-mitigation-state-v1 at
-- model-context-before-retrieval first (for an `other_adult` record; the
-- decision has no case for a `self` record, whose Family reader has never
-- asked it), then `copilot.local` signed by the exact current adult subject
-- principal for this recipient relationship, then each report layer's own
-- purpose (`reports.monogenic`, `reports.polygenic`). Ancestry and raw
-- variants are not read in this version, although the register would allow
-- them with further grants. The jurisdiction capability and the local
-- transport are the application's, before any of this is asked.
--
-- This migration adds:
--   1. private.subject_copilot_uploader_grant_v1: one exact current grant
--      from the Path B person to the uploader over their `uploader`
--      relationship, or null.
--   2. private.subject_copilot_authority_v1 and its service-only door
--      public.subject_copilot_scope_v1: ready (with the exact authority a
--      turn is bound to), held, permission-missing, or not_found.
--   3. private.subject_copilot_prune_v1 and public.subject_copilot_chat_v1
--      (check, list, history, commit), modelled on family_copilot_chat_v1.
--      A conversation is a canonical `chats` row with scope_kind 'subject',
--      the subject's id and canonical_authority.scope 'subject-adult'. Every
--      turn records retrieved_subject_ids [subject], retrieved_purpose_keys
--      (copilot.local and each layer read) and one copilot_turn_dependencies
--      row per subject, grant and source, so the existing purges find it:
--      private.delete_pair_derived_rows_v1 (purpose revocation and stop),
--      private.empty_self_subject_v1 (a self record emptied), the account
--      purge, the Path B transfer.
--   4. A trigger on public.subjects that, when an other_adult record is
--      purged (the person's delete, the uploader's withdrawal of a record no
--      person holds), purges every chat turn that read it and deletes its
--      subject-scope conversations. Until now nothing could read such a
--      record into a conversation, so the Path B purge had no chat step.
--   5. private.grant_path_b_purpose_v1 patched in place (md5-guarded, one
--      anchor): `copilot.local`, for the person who added the file only, is
--      one more choice the Path B person turns on and off. It is signed
--      exactly as that person's other choices for the uploader are
--      (consent.share-with-adult, the same four statements, the mitigation
--      decision at purpose-grant-create, the same one-time presentation) and
--      withdrawn by the same revoke_directional_purpose_with_nonce_v1.
-- No table or column is added. Every function is service-only or private.

do $predecessor$
begin
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.grant_path_b_purpose_v1(uuid,uuid,uuid,text,text,integer,text,text,timestamptz,boolean)')
   and md5(pg_get_functiondef(p.oid))='9489db2b7f1295f4d1ec114b6c40402a'
   and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')
  -- The decision as 20261120120000 left its outer body (the appeal hold first).
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.other_adult_mitigation_v1(uuid,uuid,text)')
   and md5(pg_get_functiondef(p.oid))='c5d5145da3cd9d178ebc87ea6c19702a' and p.proacl::text='{postgres=X/postgres}')
  -- The Family recipient authority and group helpers it reuses unchanged.
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.family_copilot_directional_grant_v1(uuid,uuid,uuid,jsonb,text)')
   and md5(pg_get_functiondef(p.oid))='b3a2114bf265870a2fad94337087d733' and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.family_copilot_turn_state_v1(uuid,uuid,uuid)')
   and md5(pg_get_functiondef(p.oid))='ecaa3458595f82351127ec80e26cd4c2' and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.family_report_recipient_v1(uuid,uuid,uuid,text)')
   and md5(pg_get_functiondef(p.oid))='692a52e391045b96addc465c8afbce0e' and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.family_report_endpoints_v1(uuid,uuid,uuid,boolean)')
   and md5(pg_get_functiondef(p.oid))='70683c77cef0f00c9803414a394fbd64' and p.proacl::text='{postgres=X/postgres}')
  -- Path B's read decision for a layer, and the shared revocation purge.
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.path_b_result_read_v1(uuid,uuid,text)')
   and md5(pg_get_functiondef(p.oid))='d39c35dab17636d453a18f41bde4ede4' and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.delete_pair_derived_rows_v1(uuid[],uuid,uuid[],text)')
   and md5(pg_get_functiondef(p.oid))='8a094ce1d0a7ff92e00260204008dc07')
  or to_regprocedure('private.family_report_session_v1(uuid,uuid)') is null
  or to_regprocedure('private.family_source_report_authority_v1(uuid,uuid,text)') is null
  or to_regprocedure('private.family_copilot_provider_key_v1(jsonb)') is null
  or to_regprocedure('private.valid_family_copilot_citations_v1(jsonb)') is null
  or to_regprocedure('private.own_copilot_authority_v1(uuid,uuid,uuid,jsonb)') is null
  -- A subject-scope conversation is already a permitted chat target.
  or (select md5(pg_get_constraintdef(c.oid)) from pg_constraint c where c.conrelid='public.chats'::regclass
   and c.conname='chats_scope_target_check' and c.contype='c' and c.convalidated)
   is distinct from '62a1bbb1b82b05d2e9267e691f28cf99'
  or to_regprocedure('public.subject_copilot_scope_v1(uuid,uuid,uuid)') is not null
  or to_regprocedure('public.subject_copilot_chat_v1(text,uuid,uuid,uuid,uuid,jsonb)') is not null
  or exists(select 1 from pg_trigger t where t.tgrelid='public.subjects'::regclass and t.tgname='purge_subject_copilot_chats') then
  raise exception using errcode='55000',message='subject copilot scope prerequisite differs'; end if;
end;
$predecessor$;

-- 1. One exact current grant from a Path B person to the uploader ----------------
-- Signer and data subject the person's current account principal, the
-- signature theirs at the record's binding and their jurisdiction revision,
-- the current hash-verified consent.share-with-adult, and the direction to
-- this recipient over this exact uploader relationship and revision.
create function private.subject_copilot_uploader_grant_v1(p_subject uuid,p_purpose text,p_principal uuid,
 p_person_account uuid,p_binding_revision bigint,p_jurisdiction_revision bigint,p_recipient_account uuid,
 p_recipient_principal uuid,p_relationship uuid,p_relationship_revision bigint)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('purpose',pg.purpose,'grantId',pg.grant_id,'grantRevision',pg.grant_revision)
 from public.purpose_grants pg
 join public.directional_grants dg on dg.grant_id=pg.grant_id and dg.grant_revision=pg.grant_revision
 join public.consent_artifacts ca on ca.artifact_key=pg.artifact_key and ca.version=pg.artifact_version
  and ca.body_sha256=pg.artifact_body_sha256
 join public.consent_signatures cs on cs.id=pg.signature_id and cs.artifact_key=ca.artifact_key
  and cs.artifact_version=ca.version and cs.artifact_body_sha256=ca.body_sha256
 where p_purpose in ('copilot.local','reports.monogenic','reports.polygenic')
  and pg.target_kind='subject' and pg.target_id=p_subject and pg.purpose=p_purpose
  and pg.signer_principal_id=p_principal and pg.data_subject_principal_id=p_principal
  and pg.subject_binding_revision=p_binding_revision and pg.jurisdiction_revision=p_jurisdiction_revision
  and cs.signer_principal_id=p_principal and cs.signer_account_id=p_person_account
  and cs.target_kind='subject' and cs.target_id=p_subject and cs.purpose=p_purpose
  and cs.subject_binding_revision=p_binding_revision and cs.jurisdiction_revision=p_jurisdiction_revision
  and pg.revoked_at is null and (pg.expires_at is null or pg.expires_at>clock_timestamp())
  and dg.status='current' and dg.direction='subject_to_recipient' and dg.pair_id is null
  and dg.recipient_account_id=p_recipient_account and dg.recipient_principal_id=p_recipient_principal
  and dg.relationship_id=p_relationship and dg.relationship_or_pair_revision=p_relationship_revision
  and ca.artifact_key='consent.share-with-adult' and ca.superseded_at is null
  and ca.published_at<=clock_timestamp() and ca.effective_on<=timezone('UTC',clock_timestamp())::date
  and ca.body_sha256=encode(extensions.digest(convert_to(ca.body_markdown,'UTF8'),'sha256'),'hex')
 order by pg.grant_id limit 1
$$;

-- 2. The scope for one subject ---------------------------------------------------
-- {state:'ready', authority} | {state:'held'} | {state:'permission-missing'},
-- or not_found when the asker has no uploader-or-grantee relationship to the
-- record at all. The authority is compared whole on every later check, so a
-- change to any part of it ends the turn.
create function private.subject_copilot_authority_v1(p_account uuid,p_session uuid,p_subject uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.subjects%rowtype; m jsonb; e jsonb; v_copilot jsonb; v_layer jsonb; v_layers jsonb:='[]';
 v_purpose text; p public.subject_principals%rowtype; up public.subject_principals%rowtype;
 r public.subject_relationships%rowtype; v_jurisdiction bigint;
 missing constant jsonb:=jsonb_build_object('state','permission-missing');
begin
 perform private.family_report_session_v1(p_account,p_session);
 select * into s from public.subjects where id=p_subject;
 if s.id is null or s.lifecycle<>'active' then raise exception using errcode='42501',message='not_found'; end if;

 if s.subject_class='self' then
  -- grantee: another account's own record, through the Family relationship.
  if s.subject_account_id is null or s.subject_account_id=p_account then
   raise exception using errcode='42501',message='not_found'; end if;
  -- As the Family group scope reads an adult: after their own later sign-in.
  if s.independent_login_at is null then return missing; end if;
  begin
   e:=private.family_report_endpoints_v1(s.subject_account_id,s.id,p_account,true);
  exception when insufficient_privilege then return missing;
  end;
  if jsonb_typeof(e->'relationship') is distinct from 'object' then return missing; end if;
  v_copilot:=private.family_copilot_directional_grant_v1(s.subject_account_id,s.id,p_account,e,'copilot.local');
  if v_copilot is null then return missing; end if;
  foreach v_purpose in array array['reports.monogenic','reports.polygenic'] loop
   begin
    v_layer:=private.family_report_recipient_v1(p_account,p_session,s.id,v_purpose);
    if (v_layer->>'legacyOnly')::boolean is false and v_layer->'endpoints'=e then
     v_layers:=v_layers||jsonb_build_array(jsonb_build_object('purpose',v_purpose,
      'grantId',v_layer->'grantId','grantRevision',v_layer->'grantRevision'));
    end if;
   exception when insufficient_privilege or object_not_in_prerequisite_state then null;
   end;
  end loop;
  if jsonb_array_length(v_layers)=0 then return missing; end if;
  return jsonb_build_object('state','ready','authority',jsonb_build_object('case','grantee','subjectId',s.id,
   'accountId',s.subject_account_id,'lifecycleRevision',s.lifecycle_revision,
   'subjectBindingRevision',(e#>>'{owner,subjectBindingRevision}')::bigint,
   'relationship',e->'relationship','copilot',v_copilot,'layers',v_layers));
 end if;

 if s.subject_class<>'other_adult' then raise exception using errcode='42501',message='not_found'; end if;
 -- other-adult-mitigation-state-v1 at the model-retrieval checkpoint, before
 -- anything else about the record is read. The decision alone says who may.
 m:=private.other_adult_mitigation_v1(s.id,p_account,'model-context-before-retrieval');
 if m->>'decision'='subject-own-right-only' or (m->>'decision'='deny' and m->>'gate'='not-found') then
  raise exception using errcode='42501',message='not_found'; end if;
 if m->>'decision' is distinct from 'allow' then return jsonb_build_object('state','held'); end if;
 -- The decision allows only the uploader of a confirmed Path B record.
 if s.owner_account_id is distinct from p_account or s.ownership_transferred_at is not null
  or not exists(select 1 from public.adult_subject_drafts d where d.subject_id=s.id
   and d.adult_flow='path-b-subject-esignature' and d.state='confirmed') then
  raise exception using errcode='42501',message='not_found'; end if;
 -- A person with no account of their own has no reader for the uploader.
 if s.subject_account_id is null then return missing; end if;
 select * into p from public.subject_principals where subject_id=s.id and principal_kind='account_subject'
  and account_id=s.subject_account_id and status='active';
 select sp.* into up from public.subject_principals sp join public.subjects us on us.id=sp.subject_id
  where sp.account_id=p_account and sp.principal_kind='account_subject' and sp.status='active'
   and us.subject_class='self' and us.subject_account_id=p_account and us.lifecycle='active'
  order by sp.created_at limit 1;
 select * into r from public.subject_relationships where subject_id=s.id and data_subject_principal_id=p.id
  and recipient_principal_id=up.id and recipient_account_id=p_account and relationship_kind='uploader' and status='current';
 select pr.jurisdiction_revision into v_jurisdiction from public.profiles pr
  where pr.id=s.subject_account_id and pr.deletion_requested_at is null;
 if p.id is null or up.id is null or r.id is null or v_jurisdiction is null then return missing; end if;
 v_copilot:=private.subject_copilot_uploader_grant_v1(s.id,'copilot.local',p.id,s.subject_account_id,
  s.subject_binding_revision,v_jurisdiction,p_account,up.id,r.id,r.relationship_revision);
 if v_copilot is null then return missing; end if;
 foreach v_purpose in array array['reports.monogenic','reports.polygenic'] loop
  -- The uploader's own read decision for this layer, then its exact grant.
  if private.path_b_result_read_v1(p_account,s.id,v_purpose)='{"allowed":true,"gate":"ready"}'::jsonb then
   v_layer:=private.subject_copilot_uploader_grant_v1(s.id,v_purpose,p.id,s.subject_account_id,
    s.subject_binding_revision,v_jurisdiction,p_account,up.id,r.id,r.relationship_revision);
   if v_layer is not null then v_layers:=v_layers||jsonb_build_array(v_layer); end if;
  end if;
 end loop;
 if jsonb_array_length(v_layers)=0 then return missing; end if;
 return jsonb_build_object('state','ready','authority',jsonb_build_object('case','uploader','subjectId',s.id,
  'accountId',s.subject_account_id,'lifecycleRevision',s.lifecycle_revision,
  'subjectBindingRevision',s.subject_binding_revision,
  'relationship',jsonb_build_object('id',r.id,'revision',r.relationship_revision),'copilot',v_copilot,'layers',v_layers));
end $$;

create function public.subject_copilot_scope_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid)
returns jsonb language sql security definer set search_path='' as $$
 select private.subject_copilot_authority_v1(p_account_id,p_session_id,p_subject_id)
$$;

-- 3. Conversations ------------------------------------------------------------------
-- Ended turns (a grant, the record or a source no longer the same current
-- revision) are deleted with every later turn, as the Family group's are. A
-- whole conversation is unreadable while a pause stands between the two
-- accounts or, for an other_adult record, while the mitigation decision does
-- not allow a derived read; nothing is deleted for that. True when the
-- conversation still has turns and every one of them is readable now.
create function private.subject_copilot_prune_v1(p_account uuid,p_chat uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare cutoff bigint; s public.subjects%rowtype;
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
 select su.* into s from public.subjects su join public.chats c on c.subject_id=su.id
  where c.id=p_chat and c.user_id=p_account and c.scope_kind='subject';
 if s.id is null then return false; end if;
 if s.subject_class='other_adult'
  and private.other_adult_mitigation_v1(s.id,p_account,'derived-write-and-read')->>'decision' is distinct from 'allow' then
  return false; end if;
 return exists(select 1 from public.chat_messages m where m.chat_id=p_chat)
  and not exists(select 1 from public.chat_messages m where m.chat_id=p_chat
   and private.family_copilot_turn_state_v1(p_account,p_chat,m.turn_id)<>'current');
end $$;

-- Service-only dispatcher: check, list, history, commit. The conversation's
-- subject is the chat row's; a named subject must equal it.
create function public.subject_copilot_chat_v1(p_operation text,p_account_id uuid,p_session_id uuid,
 p_subject_id uuid default null,p_chat_id uuid default null,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_chat public.chats%rowtype; v_subject uuid; v_scope jsonb; v_authority jsonb; v_used jsonb; v_layer jsonb;
 v_file jsonb; v_source jsonb; v_purpose text; v_self uuid; v_provider jsonb; v_result jsonb; v_ordinal bigint;
 v_turn uuid:=gen_random_uuid(); v_purposes text[]:=array['copilot.local']; v_revisions bigint[]; v_deps jsonb;
 v_fingerprint text; v_role text; v_id uuid; v_file_revision bigint;
begin
 if p_operation is null or p_operation not in ('check','list','history','commit') or p_payload is null
  or jsonb_typeof(p_payload) is distinct from 'object' then raise exception using errcode='22023',message='invalid_request'; end if;
 perform private.family_report_session_v1(p_account_id,p_session_id);
 if p_chat_id is not null then
  select * into v_chat from public.chats where id=p_chat_id and user_id=p_account_id for update;
  if v_chat.id is null or v_chat.scope_kind<>'subject' or v_chat.subject_id is null or v_chat.legacy_unverified is not false
   or v_chat.canonical_authority->>'scope' is distinct from 'subject-adult'
   or (p_subject_id is not null and p_subject_id<>v_chat.subject_id) then
   raise exception using errcode='42501',message='not_found'; end if;
  v_subject:=v_chat.subject_id;
 else
  v_subject:=p_subject_id;
 end if;
 if v_subject is null then raise exception using errcode='42501',message='not_found'; end if;

 if p_operation='check' then
  if p_chat_id is not null or p_payload-array['authority']<>'{}'::jsonb
   or jsonb_typeof(p_payload->'authority') is distinct from 'object' then
   raise exception using errcode='22023',message='invalid_request'; end if;
  v_scope:=private.subject_copilot_authority_v1(p_account_id,p_session_id,v_subject);
  if v_scope->>'state' is distinct from 'ready' or v_scope->'authority' is distinct from p_payload->'authority' then
   raise exception using errcode='42501',message='not_found'; end if;
  return 'true'::jsonb;
 end if;

 if p_operation='list' then
  if p_chat_id is not null or p_payload<>'{}'::jsonb then raise exception using errcode='22023',message='invalid_request'; end if;
  v_result:='[]';
  for v_id in select ch.id from public.chats ch where ch.user_id=p_account_id and ch.scope_kind='subject'
   and ch.subject_id=v_subject and ch.legacy_unverified is false and ch.canonical_authority->>'scope'='subject-adult'
   order by ch.created_at desc,ch.id limit 200 loop
   if private.subject_copilot_prune_v1(p_account_id,v_id) and jsonb_array_length(v_result)<50 then
    v_result:=v_result||jsonb_build_array((select jsonb_build_object('id',ch.id,'created_at',ch.created_at)
     from public.chats ch where ch.id=v_id));
   end if;
  end loop;
  return v_result;
 end if;

 select s.id into v_self from public.subjects s
  where s.subject_account_id=p_account_id and s.subject_class='self' and s.lifecycle='active' order by s.created_at,s.id limit 1;
 if v_self is null or jsonb_typeof(p_payload->'provider') is distinct from 'object' then
  raise exception using errcode='42501',message='not_found'; end if;
 v_provider:=p_payload->'provider';
 -- A true non-self scope: local transport only, under the asker's own exact
 -- current Copilot configuration and permission. No cloud provider passes.
 if v_provider->>'providerClass' is distinct from 'local'
  or private.own_copilot_authority_v1(p_account_id,p_session_id,v_self,v_provider) is null then
  raise exception using errcode='42501',message='not_found'; end if;

 if v_chat.id is not null then
  if private.family_copilot_provider_key_v1(v_chat.canonical_authority->'provider')
   is distinct from private.family_copilot_provider_key_v1(v_provider) then
   raise exception using errcode='42501',message='not_found'; end if;
  -- Not an exception: the deletion of ended turns must commit even though
  -- the conversation is no longer readable. The caller treats null as 404.
  if private.subject_copilot_prune_v1(p_account_id,v_chat.id) is not true then return 'null'::jsonb; end if;
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

 -- commit: one validated question/answer pair, bound to this one record.
 if p_payload-array['message','answer','citations','lastOrdinal','nonceHash','expiresAt','provider','authority','used']<>'{}'::jsonb
  or not(p_payload ?& array['message','answer','citations','lastOrdinal','nonceHash','expiresAt','provider','authority','used'])
  or jsonb_typeof(p_payload->'message') is distinct from 'string' or jsonb_typeof(p_payload->'answer') is distinct from 'string'
  or length(p_payload->>'message') not between 1 and 8000 or length(p_payload->>'answer') not between 1 and 64000
  or coalesce(p_payload->>'lastOrdinal','') !~ '^(0|[1-9][0-9]*)$'
  or jsonb_typeof(p_payload->'authority') is distinct from 'object'
  or jsonb_typeof(p_payload->'used') is distinct from 'array' or jsonb_array_length(p_payload->'used')>1
  or private.valid_family_copilot_citations_v1(p_payload->'citations') is not true then
  raise exception using errcode='22023',message='invalid_request'; end if;

 perform 1 from public.subjects where id=v_subject for share nowait;
 perform 1 from public.purpose_grants where target_kind='subject' and target_id=v_subject order by grant_id for share nowait;
 perform 1 from public.directional_grants where grant_id in(select grant_id from public.purpose_grants
  where target_kind='subject' and target_id=v_subject) order by grant_id for share nowait;
 perform 1 from public.genome_files where subject_id=v_subject order by id for share nowait;
 v_scope:=private.subject_copilot_authority_v1(p_account_id,p_session_id,v_subject);
 v_authority:=v_scope->'authority';
 if v_scope->>'state' is distinct from 'ready' or v_authority is distinct from p_payload->'authority'
  or (v_chat.id is not null and v_chat.canonical_authority->>'relationship' is distinct from v_authority->>'case') then
  raise exception using errcode='42501',message='not_found'; end if;
 v_fingerprint:=encode(extensions.digest(convert_to(v_authority::text,'UTF8'),'sha256'),'hex');
 -- Every turn of the conversation depends on the record and its Copilot grant,
 -- whether or not the model asked for a report this turn.
 v_deps:=jsonb_build_array(
  jsonb_build_object('kind','subject','id',v_authority->>'subjectId','revision',(v_authority->>'lifecycleRevision')::bigint,'fp',v_fingerprint),
  jsonb_build_object('kind','grant','id',v_authority#>>'{copilot,grantId}','revision',(v_authority#>>'{copilot,grantRevision}')::bigint,'fp',v_fingerprint));
 v_revisions:=array[(v_authority#>>'{copilot,grantRevision}')::bigint];
 for v_used in select value from jsonb_array_elements(p_payload->'used') loop
  if jsonb_typeof(v_used) is distinct from 'object' or v_used-array['authority','purposes','files']<>'{}'::jsonb
   or not(v_used ?& array['authority','purposes','files']) or v_used->'authority' is distinct from v_authority
   or jsonb_typeof(v_used->'purposes') is distinct from 'array' or jsonb_array_length(v_used->'purposes') not between 1 and 2
   or jsonb_typeof(v_used->'files') is distinct from 'array' or jsonb_array_length(v_used->'files') not between 1 and 200 then
   raise exception using errcode='22023',message='invalid_request'; end if;
  for v_purpose in select value from jsonb_array_elements_text(v_used->'purposes') loop
   -- A turn may use a result layer only through that layer's own grant.
   v_layer:=null;
   select value into v_layer from jsonb_array_elements(v_authority->'layers') where value->>'purpose'=v_purpose;
   if v_layer is null or v_purpose=any(v_purposes) then raise exception using errcode='42501',message='not_found'; end if;
   v_deps:=v_deps||jsonb_build_array(jsonb_build_object('kind','grant','id',v_layer->>'grantId',
    'revision',(v_layer->>'grantRevision')::bigint,'fp',v_fingerprint));
   v_revisions:=v_revisions||(v_layer->>'grantRevision')::bigint;
   v_purposes:=array_append(v_purposes,v_purpose);
  end loop;
  for v_file in select value from jsonb_array_elements(v_used->'files') loop
   if jsonb_typeof(v_file) is distinct from 'object' or v_file-array['fileId','purpose']<>'{}'::jsonb
    or jsonb_typeof(v_file->'fileId') is distinct from 'string' or jsonb_typeof(v_file->'purpose') is distinct from 'string'
    or not(v_used->'purposes' ? (v_file->>'purpose')) then raise exception using errcode='22023',message='invalid_request'; end if;
   if v_authority->>'case'='grantee' then
    -- The adult's own current authority over this exact completed source.
    v_source:=private.family_source_report_authority_v1((v_authority->>'accountId')::uuid,(v_file->>'fileId')::uuid,v_file->>'purpose');
    if v_source->>'subjectId' is distinct from v_subject::text then raise exception using errcode='42501',message='not_found'; end if;
    v_deps:=v_deps||jsonb_build_array(
     jsonb_build_object('kind','grant','id',v_source->>'grantId','revision',(v_source->>'grantRevision')::bigint,'fp',v_fingerprint),
     jsonb_build_object('kind','file','id',v_file->>'fileId','revision',(v_source->>'sourceRevision')::bigint,'fp',v_fingerprint));
   else
    -- The uploader's own saved result of this layer from this exact source,
    -- computed under the layer grant the authority names.
    select f.upload_revision into v_file_revision from public.genome_files f
     join private.path_b_report_bindings b on b.file_id=f.id and b.subject_id=f.subject_id
     join jsonb_array_elements(v_authority->'layers') l on l->>'purpose'=b.purpose
      and l->>'grantId'=b.grant_id::text and (l->>'grantRevision')::bigint=b.grant_revision
     where f.id=(v_file->>'fileId')::uuid and f.subject_id=v_subject and b.recipient_account_id=p_account_id
      and b.purpose=v_file->>'purpose' and b.state='complete'
      and not exists(select 1 from private.genome_file_deletions x where x.file_id=f.id)
     limit 1;
    if v_file_revision is null then raise exception using errcode='42501',message='not_found'; end if;
    v_deps:=v_deps||jsonb_build_array(jsonb_build_object('kind','file','id',v_file->>'fileId',
     'revision',v_file_revision,'fp',v_fingerprint));
   end if;
  end loop;
 end loop;
 select array_agg(distinct x order by x) into v_purposes from unnest(v_purposes) x;

 if v_chat.id is null then
  if p_payload->>'lastOrdinal'<>'0' or jsonb_typeof(p_payload->'nonceHash') is distinct from 'string'
   or coalesce(p_payload->>'nonceHash','') !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_payload->'expiresAt') is distinct from 'string'
   or (p_payload->>'expiresAt')::timestamptz<=clock_timestamp()
   or (p_payload->>'expiresAt')::timestamptz>clock_timestamp()+interval '10 minutes' then
   raise exception using errcode='42501',message='not_found'; end if;
  delete from public.copilot_context_tokens where account_id=p_account_id and scope_kind='subject'
   and target_id=v_subject and expires_at<=clock_timestamp();
  -- The page's single-use context: a second presentation fails closed.
  begin
   insert into public.copilot_context_tokens(account_id,chat_id,scope_kind,target_id,issuing_route_id,nonce_hash,
    authorization_fingerprint,token_revision,expires_at,redeemed_at)
   values(p_account_id,null,'subject',v_subject,'copilot.scope',p_payload->>'nonceHash',
    encode(extensions.digest(convert_to(jsonb_build_object('authority',v_authority,'provider',v_provider)::text,'UTF8'),'sha256'),'hex'),
    1,(p_payload->>'expiresAt')::timestamptz,clock_timestamp());
  exception when unique_violation then raise exception using errcode='42501',message='not_found';
  end;
  insert into public.chats(user_id,scope_kind,subject_id,lifecycle_revision,grant_revision,relationship_revision,
   provider_classification,runtime_attestation_revision,model_recipient_revision,authorization_fingerprint,
   legacy_unverified,canonical_authority)
  values(p_account_id,'subject',v_subject,(v_authority->>'lifecycleRevision')::bigint,
   (v_authority#>>'{copilot,grantRevision}')::bigint,(v_authority#>>'{relationship,revision}')::bigint,'local',1,
   (v_provider->>'recipientRevision')::bigint,
   encode(extensions.digest(convert_to(v_provider::text,'UTF8'),'sha256'),'hex'),false,
   jsonb_build_object('scope','subject-adult','relationship',v_authority->>'case','provider',v_provider)) returning * into v_chat;
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
   array[v_subject],v_purposes,array[(v_authority->>'accountId')::uuid],v_revisions,
   array[(v_authority->>'lifecycleRevision')::bigint],
   'local',1,v_chat.model_recipient_revision,false,
   case when v_role='assistant' then p_payload->'citations' else '[]'::jsonb end,
   case when v_role='assistant' then array(select x->>'id' from jsonb_array_elements(p_payload->'citations') x) else '{}'::text[] end);
 end loop;
 insert into public.copilot_turn_dependencies(chat_id,turn_id,dependency_kind,dependency_id,dependency_revision,source_binding_fingerprint)
 select v_chat.id,v_turn,d->>'kind',(d->>'id')::uuid,(d->>'revision')::bigint,d->>'fp' from jsonb_array_elements(v_deps) d
 on conflict do nothing;
 return jsonb_build_object('chatId',v_chat.id);
exception when lock_not_available then raise exception using errcode='42501',message='not_found';
end $$;

-- 4. A purged other_adult record takes its conversations with it -----------------
-- Every turn of every account's conversation that read the record goes, with
-- its suffix, through the shared revocation purge; then the record's own
-- subject-scope conversations are deleted whole, as the subject-delete purge
-- deletes "every chat about this record".
create function private.purge_subject_copilot_chats_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_reader uuid; v_chats uuid[];
begin
 for v_reader in select distinct c.user_id from public.chats c where (c.scope_kind='subject' and c.subject_id=new.id)
   or exists(select 1 from public.chat_messages m where m.chat_id=c.id and m.retrieved_subject_ids && array[new.id])
   or exists(select 1 from public.copilot_context_history h where h.chat_id=c.id and h.retrieved_subject_ids && array[new.id])
  order by c.user_id loop
  perform private.delete_pair_derived_rows_v1('{}'::uuid[],v_reader,array[new.id],null);
 end loop;
 v_chats:=array(select c.id from public.chats c where c.scope_kind='subject' and c.subject_id=new.id
  and c.canonical_authority->>'scope'='subject-adult' order by c.id);
 perform 1 from public.chats where id=any(v_chats) order by id for update;
 delete from public.copilot_context_tokens where chat_id=any(v_chats) or (scope_kind='subject' and target_id=new.id);
 delete from public.copilot_context_history where chat_id=any(v_chats);
 delete from public.copilot_turn_dependencies where chat_id=any(v_chats);
 delete from public.chat_messages where chat_id=any(v_chats);
 delete from public.chats where id=any(v_chats);
 return null;
end $$;
create trigger purge_subject_copilot_chats after update of lifecycle on public.subjects for each row
 when (new.lifecycle='purged' and old.lifecycle<>'purged' and new.subject_class='other_adult')
 execute function private.purge_subject_copilot_chats_v1();

-- 5. Path B: copilot.local is one more choice for the person who added the file --
-- Pattern of 20261120120000: the exact predecessor md5 and ACL, one anchor,
-- the successor md5 and unchanged ACL, volatility and owner asserted.
do $patch_copilot_choice$
declare definition text; before_acl aclitem[]; before_volatile "char"; before_owner oid;
 old_fragment constant text:=$old$ if p_purpose is null or p_purpose not in ('reports.monogenic','reports.polygenic','ancestry')
  or p_direction is null or p_direction not in ('self','uploader')
$old$;
 new_fragment constant text:=$new$ -- 20261120130000 (G8.5): copilot.local, for the person who added the file
 -- only, signed and withdrawn exactly as the three result layers are.
 if p_purpose is null or p_purpose not in ('reports.monogenic','reports.polygenic','ancestry','copilot.local')
  or (p_purpose='copilot.local' and p_direction is distinct from 'uploader')
  or p_direction is null or p_direction not in ('self','uploader')
$new$;
begin
 select pg_get_functiondef(p.oid),p.proacl,p.provolatile,p.proowner into definition,before_acl,before_volatile,before_owner
  from pg_proc p where p.oid='private.grant_path_b_purpose_v1(uuid,uuid,uuid,text,text,integer,text,text,timestamptz,boolean)'::regprocedure
   and md5(pg_get_functiondef(p.oid))='9489db2b7f1295f4d1ec114b6c40402a'
   and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}';
 if definition is null then raise exception using errcode='55000',message='path b grant predecessor differs'; end if;
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then
  raise exception using errcode='55000',message='path b grant anchor differs'; end if;
 execute replace(definition,old_fragment,new_fragment);
 if not exists(select 1 from pg_proc p
   where p.oid='private.grant_path_b_purpose_v1(uuid,uuid,uuid,text,text,integer,text,text,timestamptz,boolean)'::regprocedure
    and md5(pg_get_functiondef(p.oid))='31c75e79e6660f3ab92d2e640fca693f'
    and p.proacl is not distinct from before_acl and p.provolatile=before_volatile and p.proowner=before_owner) then
  raise exception using errcode='55000',message='path b grant successor differs'; end if;
end;
$patch_copilot_choice$;

revoke all on function private.subject_copilot_uploader_grant_v1(uuid,text,uuid,uuid,bigint,bigint,uuid,uuid,uuid,bigint),
 private.subject_copilot_authority_v1(uuid,uuid,uuid),private.subject_copilot_prune_v1(uuid,uuid),
 private.purge_subject_copilot_chats_v1()
 from public,anon,authenticated,inherit_upload_only,service_role;
revoke all on function public.subject_copilot_scope_v1(uuid,uuid,uuid),
 public.subject_copilot_chat_v1(text,uuid,uuid,uuid,uuid,jsonb)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function public.subject_copilot_scope_v1(uuid,uuid,uuid),
 public.subject_copilot_chat_v1(text,uuid,uuid,uuid,uuid,jsonb)
 to service_role;

do $postflight$
begin
 if (select count(*) from pg_proc p where p.oid in (
   to_regprocedure('private.subject_copilot_uploader_grant_v1(uuid,text,uuid,uuid,bigint,bigint,uuid,uuid,uuid,bigint)'),
   to_regprocedure('private.subject_copilot_authority_v1(uuid,uuid,uuid)'),
   to_regprocedure('private.subject_copilot_prune_v1(uuid,uuid)'),
   to_regprocedure('private.purge_subject_copilot_chats_v1()'))
   and p.proacl::text='{postgres=X/postgres}' and p.prosecdef)<>4
  or (select count(*) from pg_proc p where p.oid in (
   to_regprocedure('public.subject_copilot_scope_v1(uuid,uuid,uuid)'),
   to_regprocedure('public.subject_copilot_chat_v1(text,uuid,uuid,uuid,uuid,jsonb)'))
   and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}' and p.prosecdef)<>2
  or not exists(select 1 from pg_trigger t where t.tgrelid='public.subjects'::regclass and t.tgname='purge_subject_copilot_chats'
   and t.tgfoid='private.purge_subject_copilot_chats_v1()'::regprocedure and t.tgenabled='O') then
  raise exception using errcode='55000',message='subject copilot scope successor differs'; end if;
end;
$postflight$;
