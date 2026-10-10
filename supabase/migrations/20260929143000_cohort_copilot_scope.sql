-- The Embryo (cohort) group Copilot scope (register copilot-route-scope-v1
-- `c-{cohort}`, scope-derived-v1 `cohort:*`, chat-scope-v1, shape
-- `copilotCohortContext`). TEST-LOCAL only in the product: the app builds the
-- scope only under the TEST-LOCAL acceptance row, and it runs only on a
-- server-attested same-host model.
--
-- It is read-only over one PUBLISHED cohort, exactly as the comparison page
-- reads it, and under the same authority:
--
--   * the cohort is `active` with a publication revision;
--   * the reader is a current required upload principal of the cohort, or the
--     current non-parent uploader owner of an `embryo_third_party` cohort;
--   * every current required upload principal holds a current
--     `embryo.analysis` grant for this cohort at the current participant-set
--     revision (both grant tables, same revision);
--   * no attestation contradiction is open;
--   * each embryo it names is in a published QC state with an active subject.
--
-- The model context is donor-neutral by construction (embryo autosomal QC and
-- registered findings only; there are no registered findings while
-- data/embryo/allowed_conditions.json is empty), so the explicit
-- `donor-neutral` classification is part of the bound authority.
--
-- The authority is one closed JSON value; its SHA-256 is the chat's
-- `cohort_authority_fingerprint`. Every turn is bound to it, with one
-- copilot_turn_dependencies row per grant, embryo subject, the cohort
-- publication, the basis revision, the participant-set revision and the donor
-- classification. When any of that changes, the next read or turn deletes the
-- account's stale conversation content for the cohort, and the revocation of
-- any embryo.analysis grant for the cohort deletes every account's cohort
-- conversation content for it in the same transaction.
--
-- No table is added. Service-only doors; browsers call none of them.

-- The one authority a cohort Copilot turn may read under, or null.
create function private.cohort_copilot_authority_v1(p_account uuid, p_cohort uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare c public.embryo_cohorts%rowtype; v_role text; v_required uuid[]; v_grants jsonb; v_embryos jsonb;
begin
 select * into c from public.embryo_cohorts where id=p_cohort;
 if c.id is null or c.status<>'active' or c.publication_revision is null then return null; end if;

 select coalesce(array_agg(ps.principal_id order by ps.principal_id),'{}') into v_required
 from public.embryo_participant_sets ps
 where ps.cohort_id=c.id and ps.set_kind='required_upload_principals' and ps.revoked_at is null
  and ps.set_revision=c.participant_set_revision;
 if cardinality(v_required)=0 or exists(select 1 from public.embryo_participant_sets ps
   where ps.cohort_id=c.id and ps.revoked_at is null and ps.set_revision<>c.participant_set_revision) then
  return null; end if;

 if exists(select 1 from public.subject_principals sp where sp.account_id=p_account and sp.status='active'
   and sp.id=any(v_required)) then v_role:='required_upload_principal';
 elsif c.owner_account_id=p_account and c.upload_class='embryo_third_party' then v_role:='nonparent_uploader_owner';
 else return null; end if;

 if exists(select 1 from public.attestation_contradictions a where a.cohort_id=c.id and a.resolved_at is null) then
  return null; end if;

 -- One current analysis grant per required principal, at this set revision.
 select jsonb_agg(g order by g->>'principalId') into v_grants from (
  select distinct on (pg.signer_principal_id) jsonb_build_object('principalId',pg.signer_principal_id,
   'grantId',pg.grant_id,'grantRevision',pg.grant_revision) g
  from public.purpose_grants pg
  join public.directional_grants dg on dg.grant_id=pg.grant_id and dg.grant_revision=pg.grant_revision
  where pg.target_kind='cohort' and pg.target_id=c.id and pg.purpose='embryo.analysis'
   and pg.signer_principal_id=any(v_required) and pg.revoked_at is null
   and (pg.expires_at is null or pg.expires_at>clock_timestamp())
   and pg.subject_binding_revision=c.participant_set_revision and dg.status='current'
  order by pg.signer_principal_id,pg.grant_id) x;
 if coalesce(jsonb_array_length(v_grants),0)<>cardinality(v_required) then return null; end if;

 select jsonb_agg(jsonb_build_object('embryoId',e.id,'subjectId',s.id,'lifecycleRevision',s.lifecycle_revision)
   order by e.sample_ordinal) into v_embryos
 from public.embryos e join public.subjects s on s.id=e.subject_id
 where e.cohort_id=c.id and e.status in ('qc_pass','qc_marginal','qc_fail')
  and s.subject_class='embryo' and s.cohort_id=c.id and s.lifecycle='active';
 if v_embryos is null then return null; end if;

 return jsonb_build_object('cohortId',c.id,'role',v_role,'publicationRevision',c.publication_revision,
  'basisCase',c.basis_case,'basisRevision',c.basis_revision,'participantSetRevision',c.participant_set_revision,
  'cohortRevision',c.lifecycle_revision,'donorAttributionRevision',c.donor_attribution_revision,
  'donorClassification','donor-neutral','grants',v_grants,'embryos',v_embryos);
end; $$;

create function private.cohort_copilot_fingerprint_v1(p_authority jsonb)
returns text language sql immutable set search_path=pg_catalog as $$
 select encode(extensions.digest(convert_to(p_authority::text,'UTF8'),'sha256'),'hex')
$$;

-- The closed citation set a cohort answer may store: the cohort's comparison
-- and each embryo's own page.
create function private.valid_cohort_copilot_citations_v1(p_value jsonb)
returns boolean language sql immutable set search_path=pg_catalog as $$
 select jsonb_typeof(p_value)='array' and jsonb_array_length(p_value)<=50 and not exists(
  select 1 from jsonb_array_elements(p_value) x
  where jsonb_typeof(x)<>'object' or x-array['id','label','href']<>'{}'::jsonb
   or jsonb_typeof(x->'id') is distinct from 'string' or jsonb_typeof(x->'label') is distinct from 'string'
   or jsonb_typeof(x->'href') is distinct from 'string'
   or length(x->>'id') not between 1 and 200 or length(x->>'label') not between 1 and 200
   or not ((x->>'href') ~ '^/embryos/compare\?cohort=[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or (x->>'href') ~ '^/embryos/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'))
$$;
revoke all on function private.valid_cohort_copilot_citations_v1(jsonb) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.valid_cohort_copilot_citations_v1(jsonb) to service_role;
alter table public.chat_messages drop constraint canonical_chat_citations_valid;
alter table public.chat_messages add constraint canonical_chat_citations_valid
 check(private.valid_own_copilot_citations_v1(canonical_citations) is true
  or private.valid_family_copilot_citations_v1(canonical_citations) is true
  or private.valid_cohort_copilot_citations_v1(canonical_citations) is true);

-- Deletes the stored content of cohort conversations for one cohort: every
-- turn, both roles, with their dependency and context rows. The chat rows
-- stay, empty and unreadable (their scope is immutable). p_account null means
-- every account; p_keep, when given, keeps conversations bound to that exact
-- authority fingerprint.
create function private.cohort_copilot_prune_v1(p_cohort uuid, p_account uuid, p_keep text)
returns void language plpgsql security definer set search_path=pg_catalog as $$
declare v_chats uuid[];
begin
 select coalesce(array_agg(ch.id),'{}') into v_chats from public.chats ch
 where ch.scope_kind='cohort' and ch.cohort_id=p_cohort and (p_account is null or ch.user_id=p_account)
  and (p_keep is null or ch.cohort_authority_fingerprint is distinct from p_keep);
 if cardinality(v_chats)=0 then return; end if;
 delete from public.copilot_turn_dependencies where chat_id=any(v_chats);
 delete from public.copilot_context_history where chat_id=any(v_chats);
 delete from public.chat_messages where chat_id=any(v_chats);
end; $$;

-- Withdrawing an analysis grant, however it happens (cohort restriction, a
-- jurisdiction change, a parent's withdrawal), ends every cohort conversation
-- built on it in the same transaction.
create function private.cohort_copilot_revocation_v1() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if old.revoked_at is null and new.revoked_at is not null and new.purpose='embryo.analysis' and new.target_kind='cohort' then
  perform private.cohort_copilot_prune_v1(new.target_id,null,null);
 end if;
 return null;
end; $$;
revoke all on function private.cohort_copilot_revocation_v1() from public,anon,authenticated,inherit_upload_only,service_role;
create trigger cohort_copilot_revocation after update of revoked_at on public.purpose_grants
 for each row execute function private.cohort_copilot_revocation_v1();

-- Service-only dispatcher: authority, list, history, commit. Every operation
-- first resolves the authority afresh; a stale conversation's content is
-- deleted, and the caller reads 'null' as 404 so the deletion commits.
create function public.cohort_copilot_chat_v1(p_operation text, p_account_id uuid, p_session_id uuid,
 p_cohort_id uuid, p_chat_id uuid default null, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v_authority jsonb; v_fingerprint text; v_chat public.chats%rowtype; v_self uuid; v_self_lifecycle bigint;
 v_provider jsonb; v_result jsonb; v_ordinal bigint; v_turn uuid:=gen_random_uuid(); v_role text; v_deps jsonb;
begin
 if p_operation is null or p_operation not in ('authority','list','history','commit') or p_payload is null
  or jsonb_typeof(p_payload) is distinct from 'object' or p_cohort_id is null then
  raise exception using errcode='22023',message='invalid_request'; end if;
 perform private.family_report_session_v1(p_account_id,p_session_id);

 v_authority:=private.cohort_copilot_authority_v1(p_account_id,p_cohort_id);
 v_fingerprint:=case when v_authority is null then null else private.cohort_copilot_fingerprint_v1(v_authority) end;
 if v_authority is null then
  -- Nothing about this cohort is readable now: nothing stored of it survives.
  perform private.cohort_copilot_prune_v1(p_cohort_id,p_account_id,null);
  return 'null'::jsonb;
 end if;
 perform private.cohort_copilot_prune_v1(p_cohort_id,p_account_id,v_fingerprint);

 if p_operation='authority' then
  if p_chat_id is not null or p_payload<>'{}'::jsonb then raise exception using errcode='22023',message='invalid_request'; end if;
  return v_authority;
 end if;

 if p_operation='list' then
  if p_chat_id is not null or p_payload<>'{}'::jsonb then raise exception using errcode='22023',message='invalid_request'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'created_at',x.created_at) order by x.created_at desc,x.id),'[]')
   into v_result from (select ch.id,ch.created_at from public.chats ch
    where ch.user_id=p_account_id and ch.scope_kind='cohort' and ch.cohort_id=p_cohort_id
     and ch.cohort_authority_fingerprint=v_fingerprint and ch.legacy_unverified is false
     and exists(select 1 from public.chat_messages m where m.chat_id=ch.id)
    order by ch.created_at desc,ch.id limit 50) x;
  return v_result;
 end if;

 select s.id,s.lifecycle_revision into v_self,v_self_lifecycle from public.subjects s
  where s.subject_account_id=p_account_id and s.subject_class='self' and s.lifecycle='active' order by s.created_at,s.id limit 1;
 if v_self is null or jsonb_typeof(p_payload->'provider') is distinct from 'object' then
  raise exception using errcode='42501',message='not_found'; end if;
 v_provider:=p_payload->'provider';
 -- A true non-self scope: local transport only, under the asker's own exact
 -- current Copilot configuration and permission.
 if v_provider->>'providerClass' is distinct from 'local'
  or private.own_copilot_authority_v1(p_account_id,p_session_id,v_self,v_provider) is null then
  raise exception using errcode='42501',message='not_found'; end if;

 if p_chat_id is not null then
  select * into v_chat from public.chats where id=p_chat_id and user_id=p_account_id for update;
  if v_chat.id is null or v_chat.scope_kind<>'cohort' or v_chat.cohort_id is distinct from p_cohort_id
   or v_chat.legacy_unverified is not false or v_chat.canonical_authority->>'scope' is distinct from 'cohort'
   or private.family_copilot_provider_key_v1(v_chat.canonical_authority->'provider')
    is distinct from private.family_copilot_provider_key_v1(v_provider) then
   raise exception using errcode='42501',message='not_found'; end if;
  -- Bound to another authority (already emptied above), or never used.
  if v_chat.cohort_authority_fingerprint is distinct from v_fingerprint
   or not exists(select 1 from public.chat_messages m where m.chat_id=v_chat.id) then return 'null'::jsonb; end if;
 end if;

 if p_operation='history' then
  if v_chat.id is null or p_payload-array['provider']<>'{}'::jsonb then
   raise exception using errcode='42501',message='not_found'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.turn_ordinal,x.role desc),'[]') into v_result from (
   select m.id,m.role,m.content,m.canonical_citations as citations,m.embryo_findings,m.turn_ordinal,m.created_at
   from public.chat_messages m where m.chat_id=v_chat.id and m.user_id=p_account_id
   order by m.turn_ordinal desc,m.role limit 100) x;
  return jsonb_build_object('chatId',v_chat.id,'messages',v_result,
   'lastOrdinal',coalesce((select max(turn_ordinal) from public.chat_messages where chat_id=v_chat.id),0));
 end if;

 -- commit: one validated question/answer pair, bound to exactly the authority
 -- the turn read under.
 if p_payload-array['message','answer','citations','lastOrdinal','nonceHash','expiresAt','provider','authority']<>'{}'::jsonb
  or not(p_payload ?& array['message','answer','citations','lastOrdinal','nonceHash','expiresAt','provider','authority'])
  or jsonb_typeof(p_payload->'message') is distinct from 'string' or jsonb_typeof(p_payload->'answer') is distinct from 'string'
  or length(p_payload->>'message') not between 1 and 8000 or length(p_payload->>'answer') not between 1 and 64000
  or coalesce(p_payload->>'lastOrdinal','') !~ '^(0|[1-9][0-9]*)$'
  or private.valid_cohort_copilot_citations_v1(p_payload->'citations') is not true then
  raise exception using errcode='22023',message='invalid_request'; end if;
 -- Every citation names this cohort or one of the embryos the turn read.
 if exists(select 1 from jsonb_array_elements(p_payload->'citations') x
   where (x->>'href')<>'/embryos/compare?cohort='||p_cohort_id::text
    and not exists(select 1 from jsonb_array_elements(v_authority->'embryos') e
     where (x->>'href')='/embryos/'||(e->>'embryoId'))) then
  raise exception using errcode='22023',message='invalid_request'; end if;

 perform 1 from public.embryo_cohorts where id=p_cohort_id for share nowait;
 perform 1 from public.embryo_participant_sets where cohort_id=p_cohort_id order by set_kind,principal_id for share nowait;
 perform 1 from public.purpose_grants where target_kind='cohort' and target_id=p_cohort_id order by grant_id for share nowait;
 perform 1 from public.directional_grants where grant_id in(select grant_id from public.purpose_grants
  where target_kind='cohort' and target_id=p_cohort_id) order by grant_id for share nowait;
 perform 1 from public.embryos where cohort_id=p_cohort_id order by id for share nowait;
 perform 1 from public.subjects where cohort_id=p_cohort_id order by id for share nowait;
 -- Re-read under the locks: the authority the turn read under must still be current.
 v_authority:=private.cohort_copilot_authority_v1(p_account_id,p_cohort_id);
 if v_authority is null or v_authority is distinct from p_payload->'authority' then
  raise exception using errcode='42501',message='not_found'; end if;

 if v_chat.id is null then
  if p_payload->>'lastOrdinal'<>'0' or jsonb_typeof(p_payload->'nonceHash') is distinct from 'string'
   or coalesce(p_payload->>'nonceHash','') !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_payload->'expiresAt') is distinct from 'string'
   or (p_payload->>'expiresAt')::timestamptz<=clock_timestamp()
   or (p_payload->>'expiresAt')::timestamptz>clock_timestamp()+interval '10 minutes' then
   raise exception using errcode='42501',message='not_found'; end if;
  delete from public.copilot_context_tokens where account_id=p_account_id and scope_kind='cohort'
   and target_id=p_cohort_id and chat_id is null and expires_at<=clock_timestamp();
  -- The page's single-use context: a second presentation fails closed.
  begin
   insert into public.copilot_context_tokens(account_id,chat_id,scope_kind,target_id,issuing_route_id,nonce_hash,
    authorization_fingerprint,token_revision,expires_at,redeemed_at)
   values(p_account_id,null,'cohort',p_cohort_id,'copilot.scope',p_payload->>'nonceHash',v_fingerprint,1,
    (p_payload->>'expiresAt')::timestamptz,clock_timestamp());
  exception when unique_violation then raise exception using errcode='42501',message='not_found';
  end;
  insert into public.chats(user_id,scope_kind,cohort_id,lifecycle_revision,provider_classification,runtime_attestation_revision,
   model_recipient_revision,authorization_fingerprint,cohort_authority_fingerprint,legacy_unverified,canonical_authority)
  values(p_account_id,'cohort',p_cohort_id,v_self_lifecycle,'local',1,(v_provider->>'recipientRevision')::bigint,
   private.cohort_copilot_fingerprint_v1(v_provider),v_fingerprint,false,
   jsonb_build_object('scope','cohort','provider',v_provider,'authority',v_authority)) returning * into v_chat;
 elsif p_payload->'nonceHash' is distinct from 'null'::jsonb or p_payload->'expiresAt' is distinct from 'null'::jsonb then
  raise exception using errcode='22023',message='invalid_request';
 end if;
 select coalesce(max(turn_ordinal),0)+1 into v_ordinal from public.chat_messages where chat_id=v_chat.id;
 if v_ordinal<>(p_payload->>'lastOrdinal')::bigint+1 then raise exception using errcode='40001',message='chat_changed'; end if;

 foreach v_role in array array['user','assistant'] loop
  insert into public.chat_messages(chat_id,user_id,role,content,turn_id,turn_ordinal,paired_role,scope_revision,
   authorization_fingerprint,retrieved_subject_ids,retrieved_purpose_keys,contributor_ids,grant_revisions,lifecycle_revisions,
   provider_classification,runtime_attestation_revision,model_recipient_revision,cohort_authority_fingerprint,embryo_findings,
   legacy_unverified,canonical_citations,citation_ids)
  values(v_chat.id,p_account_id,v_role,jsonb_build_array(jsonb_build_object('type','text','text',
    case when v_role='user' then p_payload->>'message' else p_payload->>'answer' end)),
   v_turn,v_ordinal,v_role,v_chat.scope_revision,v_chat.authorization_fingerprint,
   array(select (e->>'subjectId')::uuid from jsonb_array_elements(v_authority->'embryos') e order by 1),
   array['embryo.analysis'],
   array(select (g->>'principalId')::uuid from jsonb_array_elements(v_authority->'grants') g order by 1),
   array(select (g->>'grantRevision')::bigint from jsonb_array_elements(v_authority->'grants') g order by g->>'principalId'),
   array(select (e->>'lifecycleRevision')::bigint from jsonb_array_elements(v_authority->'embryos') e order by e->>'subjectId'),
   'local',1,v_chat.model_recipient_revision,v_fingerprint,'[]'::jsonb,false,
   case when v_role='assistant' then p_payload->'citations' else '[]'::jsonb end,
   case when v_role='assistant' then array(select x->>'id' from jsonb_array_elements(p_payload->'citations') x) else '{}'::text[] end);
 end loop;

 v_deps:=jsonb_build_array(
  jsonb_build_object('kind','cohort','id',p_cohort_id,'revision',(v_authority->>'publicationRevision')::bigint),
  jsonb_build_object('kind','basis','id',p_cohort_id,'revision',(v_authority->>'basisRevision')::bigint),
  jsonb_build_object('kind','participant_set','id',p_cohort_id,'revision',(v_authority->>'participantSetRevision')::bigint),
  jsonb_build_object('kind','donor_attribution','id',p_cohort_id,'revision',(v_authority->>'donorAttributionRevision')::bigint))
  ||coalesce((select jsonb_agg(jsonb_build_object('kind','grant','id',g->>'grantId','revision',(g->>'grantRevision')::bigint))
   from jsonb_array_elements(v_authority->'grants') g),'[]')
  ||coalesce((select jsonb_agg(jsonb_build_object('kind','subject','id',e->>'subjectId','revision',(e->>'lifecycleRevision')::bigint))
   from jsonb_array_elements(v_authority->'embryos') e),'[]');
 insert into public.copilot_turn_dependencies(chat_id,turn_id,dependency_kind,dependency_id,dependency_revision,source_binding_fingerprint)
 select v_chat.id,v_turn,d->>'kind',(d->>'id')::uuid,(d->>'revision')::bigint,v_fingerprint from jsonb_array_elements(v_deps) d
 on conflict do nothing;
 return jsonb_build_object('chatId',v_chat.id);
exception when lock_not_available then raise exception using errcode='42501',message='not_found';
end; $$;

revoke all on function private.cohort_copilot_authority_v1(uuid,uuid),private.cohort_copilot_fingerprint_v1(jsonb),
 private.cohort_copilot_prune_v1(uuid,uuid,text)
 from public,anon,authenticated,inherit_upload_only,service_role;
revoke all on function public.cohort_copilot_chat_v1(text,uuid,uuid,uuid,uuid,jsonb)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function public.cohort_copilot_chat_v1(text,uuid,uuid,uuid,uuid,jsonb) to service_role;
