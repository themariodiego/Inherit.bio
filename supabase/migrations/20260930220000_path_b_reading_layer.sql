-- Path B's reading layer (brief §5.2 Path B; G2.6 adult half; G5.3), under
-- TEST-LOCAL: the subject-level reading and purpose-grant layer the owner
-- named after the account branch (docs/protocol/decisions.md, 2026-09-28
-- evening). No table is added.
--
--   1. other-adult-mitigation-state-v1, as one decision every Path B reader,
--      grant and future job must ask for its checkpoint: allow,
--      subject-own-right-only or deny, and when it denies, the exact gate.
--   2. directional-purpose-grant-v1 for a Path B subject bound to the
--      person's own account: one result layer at a time, for themselves
--      (direction self, the approved own-result text for that layer) or for
--      the uploader (direction subject_to_recipient over an `uploader`
--      relationship, consent.share-with-adult). The uploader direction is
--      created only when the mitigation decision allows it at
--      purpose-grant-create. Revocation is the existing
--      revoke_directional_purpose_v1, which already requires the data
--      subject's own account.
--   3. The read decision for a result layer: the person needs their own
--      grant; the uploader needs the mitigation decision and the person's
--      grant to them. Both then stop at the gate this layer cannot open:
--      analysis-eligibility-v1's other_adult common gate "a subject-bound
--      source a reader can use". A held Path B revision has no genome_files
--      row and no other_adult ingest.normalize job exists, so no result can
--      exist and nothing is enqueued. A confirmed revision stays
--      confirmed_blocked_current_gate.
--   4. What each side sees: the person, their own choices and why the
--      uploader direction is closed; the uploader, which layers the person
--      shared and that nothing is made yet.
--   5. When a Path B subject is purged, every grant and uploader relationship
--      on it ends in the same statement.
--
-- A person who confirmed with no account has no grant surface here: the
-- register gives them one through an adult-subject-control rights session,
-- and their route to an account is api.adult-subject-bind.

-- 1. other-adult-mitigation-state-v1 ------------------------------------------
-- The register's cases, as far as this deployment can prove them. Every case
-- whose state is not recorded fails closed and names itself:
--   * no-account-path-b: the adult.non-account-holder-24mo confirmation state
--     is not built, so an uploader is always denied;
--   * account-created-from-invitation: the server-owned creation binding is
--     not built, so an account created after the request was sent is treated
--     as created from it, and the adult.acceptance-hold-72h and independent
--     boundary notice (neither built) keep the uploader denied;
--   * all-class-b-re-notice: from the fixed 30-day boundary after the
--     person's acceptance, the re-notice (not built) keeps the uploader denied.
-- The person's own account is subject-own-right-only: the consumer applies
-- the subjectOwnRightsBypass itself.
create function private.other_adult_mitigation_v1(p_subject_id uuid,p_account_id uuid,p_checkpoint text)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog
as $function$
declare s public.subjects%rowtype; v_invited_at timestamptz; v_accepted_at timestamptz; v_created timestamptz;
begin
 if p_checkpoint is null or p_checkpoint not in ('purpose-grant-create','route-read-before-fetch',
  'model-context-before-retrieval','analysis-enqueue','worker-claim','source-read-and-every-bounded-range',
  'derived-write-and-read','export-create','export-source-read','download-session-create','every-download-chunk') then
  raise exception using errcode='22023',message='invalid_request'; end if;
 select * into s from public.subjects where id=p_subject_id;
 select i.created_at,i.accepted_at into v_invited_at,v_accepted_at from public.subject_invitations i
  join public.adult_subject_drafts d on d.subject_id=i.target_id and d.adult_flow='path-b-subject-esignature'
   and d.state='confirmed'
  where i.target_kind='subject' and i.target_id=p_subject_id and i.invitation_kind='adult_subject'
   and i.status='accepted'
  order by i.accepted_at desc limit 1;
 if s.id is null or v_accepted_at is null or s.lifecycle<>'active' or s.subject_class<>'other_adult'
  or p_account_id is null then
  return jsonb_build_object('decision','deny','gate','not-found'); end if;
 if p_account_id=s.subject_account_id then
  return jsonb_build_object('decision','subject-own-right-only','gate',null); end if;
 -- Path B has no grantee but the uploader yet.
 if p_account_id is distinct from s.owner_account_id then
  return jsonb_build_object('decision','deny','gate','not-found'); end if;
 if s.subject_account_id is null then
  return jsonb_build_object('decision','deny','gate','adult.non-account-holder-24mo'); end if;
 select u.created_at into v_created from auth.users u where u.id=s.subject_account_id;
 if v_created is null or v_created>=v_invited_at then
  return jsonb_build_object('decision','deny','gate','adult.acceptance-hold-72h'); end if;
 if clock_timestamp()>=v_accepted_at+interval '30 days' then
  return jsonb_build_object('decision','deny','gate','adult.re-notice-30d'); end if;
 return jsonb_build_object('decision','allow','gate',null);
end;
$function$;
revoke all on function private.other_adult_mitigation_v1(uuid,uuid,text)
 from public,anon,authenticated,inherit_upload_only,service_role;

-- 2. The person, acting on a Path B subject bound to their account ------------
create function private.path_b_person_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog
as $function$
declare s public.subjects%rowtype; p public.subject_principals%rowtype; up public.subject_principals%rowtype;
 pr public.profiles%rowtype;
begin
 perform 1 from auth.sessions x where x.id=p_session_id and x.user_id=p_account_id
  and (x.not_after is null or x.not_after>clock_timestamp());
 if not found or not private.path_b_account_current_v1(p_account_id) then
  raise exception using errcode='42501',message='not_found'; end if;
 select * into s from public.subjects where id=p_subject_id and subject_account_id=p_account_id
  and owner_account_id<>p_account_id and subject_class='other_adult' and lifecycle='active' for update;
 if s.id is null or not exists(select 1 from public.adult_subject_drafts d where d.subject_id=s.id
  and d.adult_flow='path-b-subject-esignature' and d.state='confirmed') then
  raise exception using errcode='42501',message='not_found'; end if;
 select * into p from public.subject_principals where subject_id=s.id and principal_kind='account_subject'
  and account_id=p_account_id and status='active' for update;
 -- The uploader's own account principal: the one recipient a share can name.
 select sp.* into up from public.subject_principals sp join public.subjects us on us.id=sp.subject_id
  where sp.account_id=s.owner_account_id and sp.principal_kind='account_subject' and sp.status='active'
   and us.subject_class='self' and us.subject_account_id=s.owner_account_id and us.lifecycle='active'
  order by sp.created_at limit 1;
 select * into pr from public.profiles where id=p_account_id for update;
 if p.id is null then raise exception using errcode='42501',message='not_found'; end if;
 return jsonb_build_object('subjectId',s.id,'subjectBindingRevision',s.subject_binding_revision,
  'principalId',p.id,'principalRevision',p.principal_revision,'uploaderAccountId',s.owner_account_id,
  'uploaderPrincipalId',up.id,'jurisdictionCode',pr.jurisdiction_code,'jurisdictionRevision',pr.jurisdiction_revision);
end;
$function$;
revoke all on function private.path_b_person_v1(uuid,uuid,uuid) from public,anon,authenticated,inherit_upload_only,service_role;

-- One result layer, one direction. The presentation nonce is recorded before
-- any write, so a presentation grants at most once.
create function private.grant_path_b_purpose_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,
 p_purpose text,p_direction text,p_artifact_version integer,p_artifact_body_sha256 text,p_nonce_hash text,
 p_expires_at timestamptz,p_test_jurisdiction boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog
as $function$
declare c jsonb; a public.consent_artifacts%rowtype; g public.purpose_grants%rowtype; m jsonb;
 v_key text; v_principal uuid; v_recipient uuid; v_recipient_account uuid; v_relationship uuid;
 v_relationship_revision bigint; v_signature uuid; v_now timestamptz:=clock_timestamp(); v_direction text;
begin
 if p_test_jurisdiction is distinct from true then raise exception using errcode='42501',message='not_found'; end if;
 if p_purpose is null or p_purpose not in ('reports.monogenic','reports.polygenic','ancestry')
  or p_direction is null or p_direction not in ('self','uploader')
  or p_nonce_hash is null or p_nonce_hash!~'^[0-9a-f]{64}$'
  or p_expires_at is null or p_expires_at<=v_now or p_expires_at>v_now+interval '10 minutes' then
  raise exception using errcode='22023',message='invalid_request'; end if;
 perform private.lock_invitation_transitions_v1();
 c:=private.path_b_person_v1(p_account_id,p_session_id,p_subject_id);
 v_principal:=(c->>'principalId')::uuid;
 if p_direction='self' then
  v_key:=case p_purpose when 'reports.monogenic' then 'consent.own-monogenic'
   when 'reports.polygenic' then 'consent.own-polygenic' else 'consent.own-ancestry' end;
  v_direction:='self'; v_recipient:=v_principal; v_recipient_account:=p_account_id;
 else
  -- other-adult-mitigation-state-v1 at purpose-grant-create, for the uploader.
  m:=private.other_adult_mitigation_v1(p_subject_id,(c->>'uploaderAccountId')::uuid,'purpose-grant-create');
  if m->>'decision'<>'allow' or c->>'uploaderPrincipalId' is null then
   raise exception using errcode='55000',message='uploader_share_unavailable'; end if;
  v_key:='consent.share-with-adult'; v_direction:='subject_to_recipient';
  v_recipient:=(c->>'uploaderPrincipalId')::uuid; v_recipient_account:=(c->>'uploaderAccountId')::uuid;
 end if;
 select * into a from public.consent_artifacts where artifact_key=v_key and version=p_artifact_version
  and body_sha256=p_artifact_body_sha256 and superseded_at is null and published_at<=v_now
  and effective_on<=timezone('UTC',v_now)::date
  and body_sha256=encode(extensions.digest(convert_to(body_markdown,'UTF8'),'sha256'),'hex') for share;
 if a.artifact_key is null then raise exception using errcode='55000',message='consent_artifact_changed'; end if;
 insert into public.purpose_grant_nonces(nonce_hash,account_id) values(p_nonce_hash,p_account_id);
 if p_direction='uploader' then
  select id,relationship_revision into v_relationship,v_relationship_revision from public.subject_relationships
   where subject_id=p_subject_id and data_subject_principal_id=v_principal and recipient_principal_id=v_recipient
    and relationship_kind='uploader' and status='current' for update;
  if v_relationship is null then
   insert into public.subject_relationships(subject_id,data_subject_principal_id,recipient_principal_id,
    recipient_account_id,relationship_kind,relationship_revision,status)
   values(p_subject_id,v_principal,v_recipient,v_recipient_account,'uploader',1,'current')
   returning id,relationship_revision into v_relationship,v_relationship_revision;
  end if;
 end if;
 select pg.* into g from public.purpose_grants pg join public.directional_grants dg
  on dg.grant_id=pg.grant_id and dg.grant_revision=pg.grant_revision
 where pg.target_kind='subject' and pg.target_id=p_subject_id and pg.purpose=p_purpose
  and pg.signer_principal_id=v_principal and pg.data_subject_principal_id=v_principal
  and pg.revoked_at is null and (pg.expires_at is null or pg.expires_at>v_now)
  and pg.subject_binding_revision=(c->>'subjectBindingRevision')::bigint
  and pg.jurisdiction_revision=(c->>'jurisdictionRevision')::bigint
  and pg.artifact_key=a.artifact_key and pg.artifact_version=a.version and pg.artifact_body_sha256=a.body_sha256
  and dg.status='current' and dg.direction=v_direction and dg.recipient_principal_id=v_recipient
  and dg.recipient_account_id=v_recipient_account and dg.relationship_id is not distinct from v_relationship
 for update of pg,dg;
 if g.grant_id is null then
  -- End only stale grants of this one layer in this one direction.
  with ended as (
   update public.purpose_grants pg set revoked_at=v_now,revocation_reason='superseded'
   from public.directional_grants dg where dg.grant_id=pg.grant_id and dg.grant_revision=pg.grant_revision
    and pg.target_kind='subject' and pg.target_id=p_subject_id and pg.purpose=p_purpose
    and pg.revoked_at is null and dg.direction=v_direction and dg.recipient_account_id=v_recipient_account
   returning pg.grant_id
  ) update public.directional_grants set status='superseded',ended_at=v_now where grant_id in(select grant_id from ended);
  insert into public.consent_signatures(artifact_key,artifact_version,artifact_body_sha256,signer_principal_id,
   signer_account_id,target_kind,target_id,purpose,statement_keys,jurisdiction_code,jurisdiction_revision,subject_binding_revision)
  values(a.artifact_key,a.version,a.body_sha256,v_principal,p_account_id,'subject',p_subject_id,p_purpose,
   case when p_direction='self' then array['make-this-result-for-me']
    else array['one-purpose','one-named-adult','own-account','pause-or-stop-any-time'] end,
   c->>'jurisdictionCode',(c->>'jurisdictionRevision')::bigint,(c->>'subjectBindingRevision')::bigint)
  returning id into v_signature;
  insert into public.purpose_grants(grant_revision,target_kind,target_id,purpose,artifact_key,artifact_version,
   artifact_body_sha256,signature_id,signer_principal_id,data_subject_principal_id,subject_binding_revision,
   jurisdiction_code,jurisdiction_revision)
  values(1,'subject',p_subject_id,p_purpose,a.artifact_key,a.version,a.body_sha256,v_signature,v_principal,v_principal,
   (c->>'subjectBindingRevision')::bigint,c->>'jurisdictionCode',(c->>'jurisdictionRevision')::bigint)
  returning * into g;
  insert into public.directional_grants(grant_id,grant_revision,recipient_principal_id,recipient_account_id,
   relationship_id,relationship_or_pair_revision,direction,self_principal_revision)
  values(g.grant_id,g.grant_revision,v_recipient,v_recipient_account,v_relationship,
   coalesce(v_relationship_revision,(c->>'subjectBindingRevision')::bigint),v_direction,
   case when p_direction='self' then (c->>'principalRevision')::bigint end);
 end if;
 update public.purpose_grant_nonces set grant_id=g.grant_id where nonce_hash=p_nonce_hash;
 perform private.append_legal_audit_event('purpose.granted',null,'api.consents','accepted',
  jsonb_build_object('purpose',p_purpose,'direction',v_direction,'upload_class','other_adult',
   'revision',g.grant_revision));
 -- Nothing is enqueued: analysis-eligibility-v1's subject-bound source gate is closed.
 return jsonb_build_object('recordKind','purpose_grant','recordId',g.grant_id,'artifactKey',a.artifact_key,
  'artifactVersion',a.version,'purposeKey',p_purpose,'signedAt',g.granted_at);
end;
$function$;
revoke all on function private.grant_path_b_purpose_v1(uuid,uuid,uuid,text,text,integer,text,text,timestamptz,boolean)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function private.grant_path_b_purpose_v1(uuid,uuid,uuid,text,text,integer,text,text,timestamptz,boolean)
 to service_role;
create function public.grant_path_b_purpose_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,
 p_purpose text,p_direction text,p_artifact_version integer,p_artifact_body_sha256 text,p_nonce_hash text,
 p_expires_at timestamptz,p_test_jurisdiction boolean)
returns jsonb language sql security invoker set search_path=pg_catalog
as $function$ select private.grant_path_b_purpose_v1(p_account_id,p_session_id,p_subject_id,p_purpose,p_direction,p_artifact_version,p_artifact_body_sha256,p_nonce_hash,p_expires_at,p_test_jurisdiction); $function$;
revoke all on function public.grant_path_b_purpose_v1(uuid,uuid,uuid,text,text,integer,text,text,timestamptz,boolean)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function public.grant_path_b_purpose_v1(uuid,uuid,uuid,text,text,integer,text,text,timestamptz,boolean)
 to service_role;

-- 3. The read decision for one result layer -----------------------------------
-- Every future Path B result reader, export and job calls this first. Today
-- it never allows: whoever passes the grant checks reaches the closed
-- subject-bound source gate.
create function private.path_b_result_read_v1(p_account_id uuid,p_subject_id uuid,p_purpose text)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog
as $function$
declare m jsonb; s public.subjects%rowtype; v_now timestamptz:=clock_timestamp();
begin
 if p_purpose is null or p_purpose not in ('reports.monogenic','reports.polygenic','ancestry') then
  return jsonb_build_object('allowed',false,'gate','purpose'); end if;
 m:=private.other_adult_mitigation_v1(p_subject_id,p_account_id,'route-read-before-fetch');
 if m->>'decision'='deny' then return jsonb_build_object('allowed',false,'gate',m->>'gate'); end if;
 select * into s from public.subjects where id=p_subject_id;
 -- The exact current grant of this layer to this reader, by the person.
 if not exists(select 1 from public.purpose_grants pg
  join public.directional_grants dg on dg.grant_id=pg.grant_id and dg.grant_revision=pg.grant_revision
  join public.subject_principals sp on sp.id=pg.data_subject_principal_id
   and sp.account_id=s.subject_account_id and sp.subject_id=s.id and sp.status='active'
  left join public.subject_relationships r on r.id=dg.relationship_id
  where pg.target_kind='subject' and pg.target_id=s.id and pg.purpose=p_purpose
   and pg.revoked_at is null and (pg.expires_at is null or pg.expires_at>v_now)
   and pg.subject_binding_revision=s.subject_binding_revision
   and dg.status='current' and dg.recipient_account_id=p_account_id
   and ((m->>'decision'='subject-own-right-only' and dg.direction='self' and dg.relationship_id is null)
    or (m->>'decision'='allow' and dg.direction='subject_to_recipient' and r.relationship_kind='uploader'
     and r.status='current' and r.recipient_account_id=p_account_id
     and dg.relationship_or_pair_revision=r.relationship_revision))) then
  return jsonb_build_object('allowed',false,'gate','directional-purpose-grant-v1'); end if;
 -- analysis-eligibility-v1, other_adult common gate: a subject-bound source a
 -- reader can use. A held revision has no genome_files row and no other_adult
 -- ingest.normalize job exists, so no result can exist for anyone to read.
 return jsonb_build_object('allowed',false,'gate','subject-bound-source');
end;
$function$;
revoke all on function private.path_b_result_read_v1(uuid,uuid,text)
 from public,anon,authenticated,inherit_upload_only,service_role;

-- 4. What each side sees -----------------------------------------------------
-- The person: for each Path B subject bound to their account, each layer's
-- current grant in each direction, and the uploader direction's decision.
create function private.path_b_person_choices_v1(p_account_id uuid,p_session_id uuid,p_test_jurisdiction boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog
as $function$
declare v_result jsonb;
begin
 if p_test_jurisdiction is distinct from true then return '[]'::jsonb; end if;
 perform 1 from auth.sessions x where x.id=p_session_id and x.user_id=p_account_id
  and (x.not_after is null or x.not_after>clock_timestamp());
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 select coalesce(jsonb_agg(t.item order by t.created_at,t.id),'[]'::jsonb) into v_result from (
  select s.id,s.created_at,jsonb_build_object('subjectId',s.id,'label',s.display_label,
   'uploaderShare',private.other_adult_mitigation_v1(s.id,s.owner_account_id,'purpose-grant-create'),
   'readGate',(select jsonb_object_agg(x.purpose,private.path_b_result_read_v1(p_account_id,s.id,x.purpose)->>'gate')
     from unnest(array['reports.monogenic','reports.polygenic','ancestry']) x(purpose)),
   'grants',coalesce((select jsonb_agg(jsonb_build_object('grantId',pg.grant_id,'purpose',pg.purpose,
      'direction',case dg.direction when 'self' then 'self' else 'uploader' end,'grantedAt',pg.granted_at)
      order by pg.purpose,dg.direction)
     from public.purpose_grants pg join public.directional_grants dg on dg.grant_id=pg.grant_id
      and dg.grant_revision=pg.grant_revision
     where pg.target_kind='subject' and pg.target_id=s.id and pg.data_subject_principal_id=p.id
      and pg.revoked_at is null and dg.status='current'
      and pg.subject_binding_revision=s.subject_binding_revision),'[]'::jsonb)) as item
  from public.subjects s
  join public.adult_subject_drafts d on d.subject_id=s.id and d.adult_flow='path-b-subject-esignature'
   and d.state='confirmed'
  join public.subject_principals p on p.subject_id=s.id and p.principal_kind='account_subject'
   and p.account_id=p_account_id and p.status='active'
  where s.subject_account_id=p_account_id and s.owner_account_id<>p_account_id
   and s.subject_class='other_adult' and s.lifecycle='active'
 ) t;
 return v_result;
end;
$function$;
revoke all on function private.path_b_person_choices_v1(uuid,uuid,boolean)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function private.path_b_person_choices_v1(uuid,uuid,boolean) to service_role;
create function public.path_b_person_choices_v1(p_account_id uuid,p_session_id uuid,p_test_jurisdiction boolean)
returns jsonb language sql security invoker set search_path=pg_catalog
as $function$ select private.path_b_person_choices_v1(p_account_id,p_session_id,p_test_jurisdiction); $function$;
revoke all on function public.path_b_person_choices_v1(uuid,uuid,boolean) from public,anon,authenticated,inherit_upload_only;
grant execute on function public.path_b_person_choices_v1(uuid,uuid,boolean) to service_role;

-- The uploader: which layers each person shared with them, and the gate that
-- still stands in front of each. Never a grant id, a date or an identifier.
create function private.path_b_uploader_shares_v1(p_account_id uuid,p_session_id uuid,p_test_jurisdiction boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog
as $function$
declare v_result jsonb;
begin
 if p_test_jurisdiction is distinct from true then return '[]'::jsonb; end if;
 perform 1 from auth.sessions x where x.id=p_session_id and x.user_id=p_account_id
  and (x.not_after is null or x.not_after>clock_timestamp());
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 select coalesce(jsonb_agg(t.item order by t.created_at,t.id),'[]'::jsonb) into v_result from (
  select s.id,s.created_at,jsonb_build_object('label',s.display_label,
   'shared',(select coalesce(jsonb_agg(jsonb_build_object('purpose',x.purpose,
      'gate',private.path_b_result_read_v1(p_account_id,s.id,x.purpose)->>'gate') order by x.purpose),'[]'::jsonb)
     from unnest(array['reports.monogenic','reports.polygenic','ancestry']) x(purpose)
     where exists(select 1 from public.purpose_grants pg join public.directional_grants dg
      on dg.grant_id=pg.grant_id and dg.grant_revision=pg.grant_revision
      where pg.target_kind='subject' and pg.target_id=s.id and pg.purpose=x.purpose and pg.revoked_at is null
       and dg.status='current' and dg.direction='subject_to_recipient' and dg.recipient_account_id=p_account_id))) as item
  from public.subjects s
  join public.adult_subject_drafts d on d.subject_id=s.id and d.adult_flow='path-b-subject-esignature'
   and d.state='confirmed'
  where s.owner_account_id=p_account_id and s.subject_account_id is not null
   and s.subject_account_id<>p_account_id and s.subject_class='other_adult' and s.lifecycle='active'
 ) t;
 return v_result;
end;
$function$;
revoke all on function private.path_b_uploader_shares_v1(uuid,uuid,boolean)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function private.path_b_uploader_shares_v1(uuid,uuid,boolean) to service_role;
create function public.path_b_uploader_shares_v1(p_account_id uuid,p_session_id uuid,p_test_jurisdiction boolean)
returns jsonb language sql security invoker set search_path=pg_catalog
as $function$ select private.path_b_uploader_shares_v1(p_account_id,p_session_id,p_test_jurisdiction); $function$;
revoke all on function public.path_b_uploader_shares_v1(uuid,uuid,boolean) from public,anon,authenticated,inherit_upload_only;
grant execute on function public.path_b_uploader_shares_v1(uuid,uuid,boolean) to service_role;

-- 5. A purged Path B subject keeps no grant -----------------------------------
create function private.end_purged_path_b_grants_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog
as $function$
declare v_now timestamptz:=clock_timestamp();
begin
 if not exists(select 1 from public.adult_subject_drafts d where d.subject_id=new.id
  and d.adult_flow='path-b-subject-esignature') then return null; end if;
 with ended as (
  update public.purpose_grants set revoked_at=v_now,revocation_reason='subject_deleted'
  where target_kind='subject' and target_id=new.id and revoked_at is null returning grant_id
 ) update public.directional_grants set status='revoked',ended_at=v_now
   where grant_id in (select grant_id from ended) and status='current';
 update public.subject_relationships set status='revoked',ended_at=v_now
  where subject_id=new.id and relationship_kind='uploader' and status='current';
 return null;
end;
$function$;
revoke all on function private.end_purged_path_b_grants_v1() from public,anon,authenticated,inherit_upload_only,service_role;
create trigger end_purged_path_b_grants after update of lifecycle on public.subjects
 for each row when (new.lifecycle='purged' and old.lifecycle<>'purged' and new.subject_class='other_adult')
 execute function private.end_purged_path_b_grants_v1();
