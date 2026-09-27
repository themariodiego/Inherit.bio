-- A Portrait navigation destination depends on current mutual authority, not
-- on whether either participant has uploaded or prepared a genome. This shared
-- metadata reader retains the source-readiness authorization checks and locks.
create function private.family_portrait_authority_v1(
 p_account_id uuid,p_session_id uuid,p_pair_id uuid,p_counterpart_account_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare p public.family_pairs%rowtype; a public.subjects%rowtype; b public.subjects%rowtype;
 initial_pair jsonb; initial_accounts uuid[]; session_receipt jsonb; v_endpoints jsonb; g jsonb; grants jsonb:='[]'; strong boolean:=true;
 owner_id uuid; recipient_id uuid; v_subject_id uuid;
begin
 select * into p from public.family_pairs where id=p_pair_id;
 if p.id is null or p.status is distinct from 'current' then return null; end if;
 select * into a from public.subjects where id=p.subject_a_id;
 select * into b from public.subjects where id=p.subject_b_id;
 if a.subject_account_id is null or b.subject_account_id is null or a.subject_account_id=b.subject_account_id
 or p_account_id is null or p_counterpart_account_id is null
 or (case when a.subject_account_id=p_account_id then b.subject_account_id when b.subject_account_id=p_account_id then a.subject_account_id end) is distinct from p_counterpart_account_id then return null; end if;
 initial_pair:=to_jsonb(p); initial_accounts:=array[a.subject_account_id,b.subject_account_id];
 -- One transaction retains both sides through serialization. Contention refuses
 -- rather than introducing a lock-order cycle with the older grant-first revoker.
 perform 1 from auth.users where id in(a.subject_account_id,b.subject_account_id) order by id for share nowait;
 perform 1 from public.profiles where id in(a.subject_account_id,b.subject_account_id) order by id for share nowait;
 perform 1 from auth.sessions where id=p_session_id and user_id=p_account_id for share nowait;
 perform 1 from public.subjects where id in(a.id,b.id) order by id for share nowait;
 perform 1 from public.subject_account_bindings where subject_id in(a.id,b.id) order by id for share nowait;
 perform 1 from public.subject_principals where account_id in(a.subject_account_id,b.subject_account_id) order by id for share nowait;
 perform 1 from public.family_pairs where id=p_pair_id for share nowait;
 perform 1 from public.purpose_grants where target_kind='subject' and target_id in(a.id,b.id) order by grant_id for share nowait;
 perform 1 from public.directional_grants where pair_id=p.id order by grant_id for share nowait;
 perform 1 from public.consent_signatures where target_kind='subject' and target_id in(a.id,b.id) order by id for share nowait;
 perform 1 from public.consent_artifacts where artifact_key='consent.share-with-adult' order by artifact_key,version for share nowait;
 select * into p from public.family_pairs where id=p_pair_id;
 select * into a from public.subjects where id=p.subject_a_id;
 select * into b from public.subjects where id=p.subject_b_id;
 if to_jsonb(p) is distinct from initial_pair or array[a.subject_account_id,b.subject_account_id] is distinct from initial_accounts
 or p_account_id is null or p_account_id not in(a.subject_account_id,b.subject_account_id)
 or p.status is distinct from 'current' or a.portrait_acknowledged_at is null or b.portrait_acknowledged_at is null
 or a.independent_login_at is null or b.independent_login_at is null then return null; end if;
 session_receipt:=private.family_report_session_v1(p_account_id,p_session_id);
 for owner_id,recipient_id,v_subject_id in select a.subject_account_id,b.subject_account_id,a.id union all select b.subject_account_id,a.subject_account_id,b.id
 loop
  v_endpoints:=private.family_portrait_endpoints_v1(owner_id,v_subject_id,recipient_id,false);
  select jsonb_build_object('id',pg.grant_id,'revision',pg.grant_revision,'endpoints',v_endpoints,
   'strong',fs.grant_id is not null) into g
  from public.purpose_grants pg join public.directional_grants dg on dg.grant_id=pg.grant_id and dg.grant_revision=pg.grant_revision
  join public.consent_signatures cs on cs.id=pg.signature_id
  join public.consent_artifacts ca on ca.artifact_key=pg.artifact_key and ca.version=pg.artifact_version
  left join private.family_portrait_grant_snapshots fs on fs.grant_id=pg.grant_id
  where pg.target_kind='subject' and pg.target_id=v_subject_id and pg.purpose='family.portrait'
  and pg.signer_principal_id=(v_endpoints#>>'{owner,principalId}')::uuid and pg.data_subject_principal_id=pg.signer_principal_id
  and pg.subject_binding_revision=(v_endpoints#>>'{owner,subjectBindingRevision}')::bigint
  and pg.jurisdiction_revision=(v_endpoints#>>'{owner,jurisdictionRevision}')::bigint
  and pg.revoked_at is null and (pg.expires_at is null or pg.expires_at>clock_timestamp())
  and dg.status='current' and dg.direction='subject_to_recipient' and dg.recipient_account_id=recipient_id
  and dg.recipient_principal_id=(v_endpoints#>>'{recipient,principalId}')::uuid and dg.relationship_id is null
  and dg.pair_id=p.id and dg.relationship_or_pair_revision=p.pair_revision
  and cs.signer_account_id=owner_id and cs.signer_principal_id=pg.signer_principal_id
  and cs.target_kind='subject' and cs.target_id=v_subject_id and cs.purpose=pg.purpose
  and cs.artifact_key=pg.artifact_key and cs.artifact_version=pg.artifact_version and cs.artifact_body_sha256=pg.artifact_body_sha256
  and cs.subject_binding_revision=pg.subject_binding_revision and cs.jurisdiction_revision=pg.jurisdiction_revision
  and ca.body_sha256=pg.artifact_body_sha256 and ca.body_sha256=encode(extensions.digest(convert_to(ca.body_markdown,'UTF8'),'sha256'),'hex')
  and ca.superseded_at is null and ca.published_at<=clock_timestamp() and ca.effective_on<=timezone('UTC',clock_timestamp())::date
  and (fs.grant_id is null or (fs.endpoints=v_endpoints and fs.pair_id=p.id and fs.pair_revision=p.pair_revision));
  if g is null then return null; end if;
  if (g->>'strong')::boolean then perform private.family_portrait_endpoints_v1(owner_id,v_subject_id,recipient_id,true);
  else strong:=false; end if;
  grants:=grants||jsonb_build_array(g);
 end loop;
 return jsonb_build_object('session',session_receipt,'pair',to_jsonb(p),'grants',grants,
  'acknowledgments',jsonb_build_array(a.portrait_acknowledged_at,b.portrait_acknowledged_at),
  'independentLogins',jsonb_build_array(a.independent_login_at,b.independent_login_at),
  'strong',strong,'subjectA',jsonb_build_object('id',a.id,'accountId',a.subject_account_id),
  'subjectB',jsonb_build_object('id',b.id,'accountId',b.subject_account_id));
exception when lock_not_available or insufficient_privilege or object_not_in_prerequisite_state or invalid_text_representation then return null;
end; $$;
revoke all on function private.family_portrait_authority_v1(uuid,uuid,uuid,uuid)
 from public,anon,authenticated,inherit_upload_only,service_role;

-- Preserve the existing closed response and exact source-dependent proof.
-- Source locks remain here, in their original order. Rechecking the shared
-- authority after them preserves validation after acquiring those locks.
create or replace function public.family_portrait_source_readiness_v1(
 p_account_id uuid,p_session_id uuid,p_pair_id uuid,p_counterpart_account_id uuid,p_expected text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare authority jsonb; subject_a uuid; subject_b uuid; account_a uuid; account_b uuid; strong boolean;
 proof jsonb; sa jsonb; sb jsonb; legacy_a jsonb; legacy_b jsonb; receipt text;
begin
 authority:=private.family_portrait_authority_v1(p_account_id,p_session_id,p_pair_id,p_counterpart_account_id);
 if authority is null then return null; end if;
 subject_a:=(authority#>>'{subjectA,id}')::uuid; subject_b:=(authority#>>'{subjectB,id}')::uuid;
 account_a:=(authority#>>'{subjectA,accountId}')::uuid; account_b:=(authority#>>'{subjectB,accountId}')::uuid;
 strong:=(authority->>'strong')::boolean;
 perform 1 from public.consent_artifacts where artifact_key in('consent.upload-self','disclosure.insurance-and-discrimination') order by artifact_key,version for share nowait;
 perform 1 from public.subject_consents where subject_id in(subject_a,subject_b) order by id for share nowait;
 perform 1 from public.genome_files where subject_id in(subject_a,subject_b) order by id for share nowait;
 perform 1 from public.genome_storage_objects where genome_file_id in(select id from public.genome_files where subject_id in(subject_a,subject_b)) order by object_id for share nowait;
 perform 1 from storage.objects where id in(select storage_object_id from public.genome_files where subject_id in(subject_a,subject_b)) order by id for share nowait;
 perform 1 from private.own_normalization_runs where file_id in(select id from public.genome_files where subject_id in(subject_a,subject_b)) order by file_id for share nowait;
 if private.family_portrait_authority_v1(p_account_id,p_session_id,p_pair_id,p_counterpart_account_id)
  is distinct from authority then return null; end if;
 if strong then
  sa:=private.family_portrait_prepared_source_v1(account_a,subject_a);
  sb:=private.family_portrait_prepared_source_v1(account_b,subject_b);
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'sha256',sha256,'revision',upload_revision) order by id),'[]') into legacy_a
 from public.genome_files where subject_id=subject_a and status='annotated' and single_logical_sample_verified_at is null
 and structural_validator_version is null and source_sha256 is null;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'sha256',sha256,'revision',upload_revision) order by id),'[]') into legacy_b
 from public.genome_files where subject_id=subject_b and status='annotated' and single_logical_sample_verified_at is null
 and structural_validator_version is null and source_sha256 is null;
 proof:=(authority-'strong'-'subjectA'-'subjectB')||jsonb_build_object('legacyA',legacy_a,'legacyB',legacy_b,'a',sa,'b',sb);
 receipt:=encode(extensions.digest(convert_to(proof::text,'UTF8'),'sha256'),'hex');
 if p_expected is not null and p_expected is distinct from receipt then return null; end if;
 return jsonb_build_object('kind',case when strong then 'canonical' else 'legacy-only' end,'receipt',receipt,
  'a',jsonb_build_object('subjectId',subject_a,'legacyFileIds',jsonb_path_query_array(legacy_a,'$[*].id'),'hasLegacySource',jsonb_array_length(legacy_a)>0,'hasPreparedSource',coalesce(sa->'source'<>'null'::jsonb,false)),
  'b',jsonb_build_object('subjectId',subject_b,'legacyFileIds',jsonb_path_query_array(legacy_b,'$[*].id'),'hasLegacySource',jsonb_array_length(legacy_b)>0,'hasPreparedSource',coalesce(sb->'source'<>'null'::jsonb,false)));
exception when lock_not_available or insufficient_privilege or object_not_in_prerequisite_state or invalid_text_representation then return null;
end; $$;

-- Metadata-only, service-only capture/recheck. No source or result reader is
-- reachable; expected receipts bind both exact grants, endpoints and session.
create function public.family_portrait_navigation_v1(
 p_account_id uuid,p_session_id uuid,p_pair_id uuid,p_counterpart_account_id uuid,p_expected text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare authority jsonb; receipt text;
begin
 authority:=private.family_portrait_authority_v1(p_account_id,p_session_id,p_pair_id,p_counterpart_account_id);
 if authority is null then return null; end if;
 receipt:=encode(extensions.digest(convert_to(authority::text,'UTF8'),'sha256'),'hex');
 if p_expected is not null and p_expected is distinct from receipt then return null; end if;
 return jsonb_build_object('pairId',p_pair_id,'subjectAId',authority#>>'{subjectA,id}',
  'subjectBId',authority#>>'{subjectB,id}','counterpartAccountId',p_counterpart_account_id,'receipt',receipt);
exception when lock_not_available or insufficient_privilege or object_not_in_prerequisite_state or invalid_text_representation then return null;
end; $$;
revoke all on function public.family_portrait_navigation_v1(uuid,uuid,uuid,uuid,text),
 public.family_portrait_source_readiness_v1(uuid,uuid,uuid,uuid,text)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function public.family_portrait_navigation_v1(uuid,uuid,uuid,uuid,text),
 public.family_portrait_source_readiness_v1(uuid,uuid,uuid,uuid,text) to service_role;
