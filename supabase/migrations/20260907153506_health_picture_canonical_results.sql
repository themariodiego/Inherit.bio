-- Health Picture: exact reciprocal joint permission is separate from each
-- report layer. No raw canonical calls, new computation, or Portrait pair.
create table private.health_picture_grant_snapshots (
 grant_id uuid primary key references public.purpose_grants(grant_id) on delete cascade,
 endpoints jsonb not null check(jsonb_typeof(endpoints)='object')
);
revoke all on private.health_picture_grant_snapshots from public,anon,authenticated,inherit_upload_only,service_role;
create function public.health_picture_grant_presentation_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,p_recipient_account_id uuid)
returns text language plpgsql security definer set search_path=pg_catalog as $$
declare e jsonb;
begin
 perform private.family_report_session_v1(p_account_id,p_session_id);
 e:=private.family_report_endpoints_v1(p_account_id,p_subject_id,p_recipient_account_id);
 return encode(extensions.digest(convert_to(e::text,'UTF8'),'sha256'),'hex');
end; $$;

create function public.grant_health_picture_purpose_v1(p_account_id uuid,p_session_id uuid,p_data_subject_id uuid,
 p_recipient_principal_id uuid,p_recipient_account_id uuid,p_purpose text,p_artifact_version integer,
 p_artifact_body_sha256 text,p_token_nonce text,p_endpoint_receipt text)
returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare e jsonb; g uuid; old_grant uuid;
begin
 if p_purpose is distinct from 'family.heritability'
  or p_endpoint_receipt is null or p_endpoint_receipt!~'^[0-9a-f]{64}$' then
  raise exception using errcode='22023',message='invalid_request'; end if;
 -- Deterministic endpoint locks cover the interval between receipt comparison
 -- and the existing signed, nonce-consuming transaction. No old grant is
 -- retroactively blessed: explicit new consent revokes/replaces an unproven one.
 perform 1 from auth.users where id in(p_account_id,p_recipient_account_id) order by id for share;
 perform 1 from public.profiles where id in(p_account_id,p_recipient_account_id) order by id for update;
 perform 1 from public.subjects where subject_account_id in(p_account_id,p_recipient_account_id) order by id for update;
 perform 1 from public.subject_account_bindings where account_id in(p_account_id,p_recipient_account_id) order by id for share;
 perform 1 from public.subject_principals where account_id in(p_account_id,p_recipient_account_id) order by id for share;
 perform 1 from public.subject_relationships where subject_id=p_data_subject_id order by id for update;
 perform 1 from auth.sessions where user_id=p_account_id and id=p_session_id for share;
 perform private.family_report_session_v1(p_account_id,p_session_id);
 e:=private.family_report_endpoints_v1(p_account_id,p_data_subject_id,p_recipient_account_id);
 if encode(extensions.digest(convert_to(e::text,'UTF8'),'sha256'),'hex') is distinct from p_endpoint_receipt
  or e#>>'{recipient,principalId}' is distinct from p_recipient_principal_id::text then
  raise exception using errcode='42501',message='not_found'; end if;
 perform 1 from public.consent_artifacts a where a.artifact_key='consent.share-with-adult'
  and a.version=p_artifact_version and a.body_sha256=p_artifact_body_sha256
  and a.body_sha256=encode(extensions.digest(convert_to(a.body_markdown,'UTF8'),'sha256'),'hex')
  and a.superseded_at is null and a.published_at<=clock_timestamp()
  and a.effective_on<=timezone('UTC',clock_timestamp())::date for share;
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 for old_grant in select pg.grant_id from public.purpose_grants pg join public.directional_grants dg
  on dg.grant_id=pg.grant_id and dg.grant_revision=pg.grant_revision
  left join private.health_picture_grant_snapshots fs on fs.grant_id=pg.grant_id
  where pg.target_kind='subject' and pg.target_id=p_data_subject_id and pg.purpose=p_purpose
   and pg.revoked_at is null and dg.status='current' and dg.direction='subject_to_recipient'
   and dg.recipient_account_id=p_recipient_account_id and fs.endpoints is distinct from e
 loop perform public.revoke_directional_purpose_v1(p_account_id,old_grant); end loop;
 g:=public.grant_directional_purpose_v1(p_account_id,p_data_subject_id,p_recipient_principal_id,p_purpose,
  'consent.share-with-adult',p_artifact_version,p_token_nonce);
 e:=private.family_report_endpoints_v1(p_account_id,p_data_subject_id,p_recipient_account_id);
 insert into private.health_picture_grant_snapshots(grant_id,endpoints) values(g,e) on conflict(grant_id) do nothing;
 if not exists(select 1 from private.health_picture_grant_snapshots where grant_id=g and endpoints=e) then
  raise exception using errcode='42501',message='not_found'; end if;
 return g;
end; $$;

create function private.health_picture_direction_v1(p_viewer uuid,p_session uuid,p_account uuid,p_subject uuid,p_purpose text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v_owner uuid; e jsonb; session_receipt jsonb; grant_receipt jsonb; v_proven boolean;
begin
 if p_purpose is distinct from 'family.heritability' then
  raise exception using errcode='42501',message='not_found'; end if;
 session_receipt:=private.family_report_session_v1(p_viewer,p_session);
 select subject_account_id into v_owner from public.subjects where id=p_subject and subject_class='self';
 -- Historical directional permission keeps its independently supported legacy
 -- semantics. It cannot lend missing age/revision proof to canonical sources.
 select exists(select 1 from public.purpose_grants pg join public.directional_grants dg
  on dg.grant_id=pg.grant_id and dg.grant_revision=pg.grant_revision
  join private.health_picture_grant_snapshots fs on fs.grant_id=pg.grant_id
  where pg.target_kind='subject' and pg.target_id=p_subject and pg.purpose=p_purpose
   and pg.revoked_at is null and dg.recipient_account_id=p_account and dg.status='current') into v_proven;
 e:=private.family_report_endpoints_v1(v_owner,p_subject,p_account,v_proven);
 select jsonb_build_object('grantId',pg.grant_id,'grantRevision',pg.grant_revision,'endpoints',e,'session',session_receipt,'legacyOnly',fs.grant_id is null)
 into grant_receipt from public.purpose_grants pg
 join public.directional_grants dg on dg.grant_id=pg.grant_id and dg.grant_revision=pg.grant_revision
 left join private.health_picture_grant_snapshots fs on fs.grant_id=pg.grant_id
 join public.consent_artifacts ca on ca.artifact_key=pg.artifact_key and ca.version=pg.artifact_version and ca.body_sha256=pg.artifact_body_sha256
 join public.consent_signatures cs on cs.id=pg.signature_id and cs.artifact_key=ca.artifact_key
  and cs.artifact_version=ca.version and cs.artifact_body_sha256=ca.body_sha256
 where (fs.grant_id is null or fs.endpoints=e) and pg.target_kind='subject' and pg.target_id=p_subject and pg.purpose=p_purpose
  and pg.signer_principal_id=(e#>>'{owner,principalId}')::uuid and pg.data_subject_principal_id=pg.signer_principal_id
  and pg.subject_binding_revision=(e#>>'{owner,subjectBindingRevision}')::bigint
  and pg.jurisdiction_revision=(e#>>'{owner,jurisdictionRevision}')::bigint
  and cs.signer_principal_id=pg.signer_principal_id and cs.signer_account_id=v_owner
  and cs.target_kind=pg.target_kind and cs.target_id=pg.target_id and cs.purpose=pg.purpose
  and cs.subject_binding_revision=pg.subject_binding_revision and cs.jurisdiction_revision=pg.jurisdiction_revision
  and pg.revoked_at is null and (pg.expires_at is null or pg.expires_at>clock_timestamp())
  and dg.status='current' and dg.direction='subject_to_recipient' and dg.recipient_account_id=p_account
  and dg.recipient_principal_id=(e#>>'{recipient,principalId}')::uuid and dg.pair_id is null
  and dg.relationship_id=(e#>>'{relationship,id}')::uuid
  and dg.relationship_or_pair_revision=(e#>>'{relationship,revision}')::bigint
  and ca.artifact_key='consent.share-with-adult' and ca.superseded_at is null
  and ca.published_at<=clock_timestamp() and ca.effective_on<=timezone('UTC',clock_timestamp())::date
  and ca.body_sha256=encode(extensions.digest(convert_to(ca.body_markdown,'UTF8'),'sha256'),'hex');
 if grant_receipt is null then raise exception using errcode='42501',message='not_found'; end if;
 if not exists(select 1 from public.subjects where id=p_subject and independent_login_at is not null)
 or not exists(select 1 from public.subjects where id=(e#>>'{recipient,subjectId}')::uuid and independent_login_at is not null)
 then raise exception using errcode='42501',message='not_found'; end if;
 return grant_receipt;
end; $$;


create function private.health_picture_context_v1(p_account uuid,p_session uuid,p_self uuid,p_counterparts jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare own_endpoint jsonb; cp jsonb; inbound jsonb; outbound jsonb; joints jsonb:='[]';
 ids uuid[]; legacy jsonb; chosen jsonb;
begin
 if jsonb_typeof(p_counterparts) is distinct from 'array' or jsonb_array_length(p_counterparts) not between 1 and 100 then
 raise exception using errcode='42501',message='not_found'; end if;
 own_endpoint:=private.family_report_endpoint_v1(p_account,p_self,false);
 perform private.family_report_session_v1(p_account,p_session);
 ids:=array[p_self];
 for cp in select value from jsonb_array_elements(p_counterparts) order by value->>'subjectId' loop
  if jsonb_typeof(cp) is distinct from 'object' or cp-array['subjectId','accountId']<>'{}' or not(cp ?& array['subjectId','accountId'])
   or cp->>'subjectId' is null or cp->>'accountId' is null or (cp->>'subjectId')::uuid=any(ids)
   or (cp->>'accountId')::uuid=p_account then raise exception using errcode='42501',message='not_found'; end if;
  if (select count(*) from jsonb_array_elements(p_counterparts) c where c->>'accountId'=cp->>'accountId')<>1 then raise exception using errcode='42501',message='not_found'; end if;
  inbound:=private.health_picture_direction_v1(p_account,p_session,p_account,(cp->>'subjectId')::uuid,'family.heritability');
  outbound:=private.health_picture_direction_v1(p_account,p_session,(cp->>'accountId')::uuid,p_self,'family.heritability');
  if inbound#>>'{endpoints,owner,accountId}' is distinct from cp->>'accountId'
   or outbound#>>'{endpoints,recipient,subjectId}' is distinct from cp->>'subjectId' then raise exception using errcode='42501',message='not_found'; end if;
  joints:=joints||jsonb_build_array(cp||jsonb_build_object('inbound',inbound,'outbound',outbound,
   'legacyOnly',(inbound->>'legacyOnly')::boolean or (outbound->>'legacyOnly')::boolean));
  ids:=array_append(ids,(cp->>'subjectId')::uuid);
 end loop;
 select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'subjectId',f.subject_id,'sha256',f.sha256,'revision',f.upload_revision) order by f.id),'[]') into legacy
 from public.genome_files f where f.subject_id=any(ids) and f.status='annotated'
 and f.single_logical_sample_verified_at is null and f.structural_validator_version is null and f.source_sha256 is null;
 select coalesce(jsonb_agg(to_jsonb(g)||jsonb_build_object('direction',to_jsonb(d)) order by g.grant_id),'[]') into chosen
 from public.purpose_grants g join public.directional_grants d on d.grant_id=g.grant_id
 where g.target_kind='subject' and g.target_id=any(ids) and g.purpose in('reports.monogenic','reports.polygenic','family.heritability');
 return jsonb_build_object('self',own_endpoint,'session',private.family_report_session_v1(p_account,p_session),'joints',joints,'legacy',legacy,'choices',chosen);
end; $$;
create function private.health_picture_own_page_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,
 p_purpose text,p_after_file uuid default null,p_mode text default 'content')
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare direction jsonb; a jsonb; f public.genome_files%rowtype; r private.own_analysis_runs%rowtype;
 n private.own_normalization_runs%rowtype; source_view jsonb; snapshot jsonb; rows jsonb:='[]'; v_last uuid; v_count integer:=0; page jsonb;
begin
 if p_mode is null or p_mode not in('content','readiness') then raise exception using errcode='22023',message='invalid_request'; end if;
 if p_purpose is null or p_purpose not in('reports.monogenic','reports.polygenic') then raise exception using errcode='42501',message='not_found'; end if;
 direction:=jsonb_build_object('context',public.own_report_context_v1(p_account_id,p_session_id,p_subject_id),
  'endpoints',jsonb_build_object('owner',jsonb_build_object('accountId',p_account_id)),'legacyOnly',false);
 for f in select gf.* from public.genome_files gf where gf.subject_id=p_subject_id
  and gf.user_id=(direction#>>'{endpoints,owner,accountId}')::uuid
  and direction->>'legacyOnly'='false' and gf.single_logical_sample_verified_at is not null and (p_after_file is null or gf.id>p_after_file)
  order by gf.id limit 100 loop
  v_last:=f.id; v_count:=v_count+1;
  begin
   if exists(select 1 from private.genome_file_deletions where file_id=f.id) then continue; end if;
   a:=private.family_source_report_authority_v1(f.user_id,f.id,p_purpose);
   if private.own_analysis_completion_matches_v1(f.id,p_purpose,a) is not true then continue; end if;
   select * into r from private.own_analysis_runs where file_id=f.id and purpose=p_purpose and state='complete';
   select * into n from private.own_normalization_runs where file_id=f.id and state='complete';
   if r.file_id is null or n.file_id is null or jsonb_typeof(r.result->'reports') is distinct from 'array' then continue; end if;
   -- Only display facts. Missing historical listed-call facts stay unavailable;
   -- no hashes, file names, paths or raw headers cross the view boundary.
   snapshot:=null;
   if n.provenance->>'version'='listed-calls-v1' and n.provenance->>'sourceSha256'=f.sha256
    and n.provenance->>'sourceBuild'=f.build and n.provenance->>'targetBuild'='GRCh38'
    and (f.build<>'GRCh37' or coalesce(n.provenance->>'chainSha256','')~'^[0-9a-f]{64}$')
    and (f.build<>'GRCh38' or n.provenance->'chainSha256'='null'::jsonb) then
    snapshot:=jsonb_build_object('sourceBuild',n.provenance->'sourceBuild','buildBasis',n.provenance->'buildBasis',
     'targetBuild',n.provenance->'targetBuild','variantRowsMapped',n.provenance->'variantRowsMapped',
     'variantRowsUnmapped',n.provenance->'variantRowsUnmapped','counts',n.provenance->'counts');
   end if;
   source_view:=jsonb_build_object('fileId',f.id,'fileType',f.file_type,'processedAt',f.normalization_completed_at,'snapshot',snapshot);
   if private.family_source_report_authority_v1(f.user_id,f.id,p_purpose) is distinct from a
    or private.own_analysis_completion_matches_v1(f.id,p_purpose,a) is not true then continue; end if;
   rows:=rows||jsonb_build_array(jsonb_build_object('fileId',f.id,
    'receipt',encode(extensions.digest(convert_to(jsonb_build_object('authority',a,'result',r.result,
     'completedAt',r.completed_at,'claim',r.claim,'manifest',n.manifest,'provenance',n.provenance)::text,'UTF8'),'sha256'),'hex'))
    ||case when p_mode='readiness' then jsonb_build_object('hasReports',exists(
     select 1 from jsonb_array_elements(r.result->'reports') item where item->'covered'='true'::jsonb
      and jsonb_typeof(item->'catalogSnapshot')='object' and item->>'slug' not like 'auto-e2e-%'))
     else jsonb_build_object('subjectId',p_subject_id,'purpose',p_purpose,
      'completedAt',r.completed_at,'source',source_view,'reports',r.result->'reports') end);
  exception when insufficient_privilege or object_not_in_prerequisite_state or invalid_text_representation then continue;
  end;
 end loop;
 if jsonb_build_object('context',public.own_report_context_v1(p_account_id,p_session_id,p_subject_id),'endpoints',jsonb_build_object('owner',jsonb_build_object('accountId',p_account_id)),'legacyOnly',false) is distinct from direction then
  raise exception using errcode='42501',message='not_found'; end if;
 page:=jsonb_build_object('authority',encode(extensions.digest(convert_to(direction::text,'UTF8'),'sha256'),'hex'),
  'ownerAccountId',direction#>>'{endpoints,owner,accountId}','subjectId',p_subject_id,'purpose',p_purpose,
  'legacyOnly',(direction->>'legacyOnly')::boolean,'sources',rows,'nextAfter',case when v_count=100 then v_last else null end);
 return page||jsonb_build_object('pageReceipt',encode(extensions.digest(convert_to(page::text,'UTF8'),'sha256'),'hex'));
end; $$;


create function public.health_picture_results_v1(p_account_id uuid,p_session_id uuid,p_self_subject_id uuid,p_counterparts jsonb,
 p_subject_id uuid,p_purpose text,p_after_file uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare ctx jsonb; joint jsonb; layer jsonb; result jsonb; page jsonb; prepared jsonb; legacy_ids jsonb;
 owner_id uuid; access_kind text; is_self boolean;
begin
 if p_purpose is null or p_purpose not in('reports.monogenic','reports.polygenic') then raise exception using errcode='42501',message='not_found'; end if;
 ctx:=private.health_picture_context_v1(p_account_id,p_session_id,p_self_subject_id,p_counterparts);
 is_self:=p_subject_id=p_self_subject_id;
 if is_self then owner_id:=p_account_id; access_kind:='canonical';
 else
  select value into joint from jsonb_array_elements(ctx->'joints') where value->>'subjectId'=p_subject_id::text;
  if joint is null then raise exception using errcode='42501',message='not_found'; end if;
  owner_id:=(joint->>'accountId')::uuid;
  begin layer:=private.family_report_recipient_v1(p_account_id,p_session_id,p_subject_id,p_purpose);
  exception when insufficient_privilege or object_not_in_prerequisite_state then layer:=null; end;
  access_kind:=case when layer is null then 'not-shared' when (joint->>'legacyOnly')::boolean or (layer->>'legacyOnly')::boolean then 'legacy-only' else 'canonical' end;
 end if;
 select coalesce(jsonb_agg(item->'id' order by item->>'id'),'[]') into legacy_ids
 from jsonb_array_elements(ctx->'legacy') item where item->>'subjectId'=p_subject_id::text;
 if is_self or (joint->>'legacyOnly')::boolean is false then prepared:=private.family_portrait_prepared_source_v1(owner_id,p_subject_id); end if;
 if access_kind='canonical' and prepared->'source'<>'null'::jsonb then
  if is_self then result:=private.health_picture_own_page_v1(p_account_id,p_session_id,p_subject_id,p_purpose,p_after_file,'content');
  else result:=public.family_shared_report_results_v1(p_account_id,p_session_id,p_subject_id,p_purpose,p_after_file,'content'); end if;
 end if;
 if private.health_picture_context_v1(p_account_id,p_session_id,p_self_subject_id,p_counterparts) is distinct from ctx then raise exception using errcode='42501',message='not_found'; end if;
 page:=jsonb_build_object('subjectId',p_subject_id,'purpose',p_purpose,'kind',case when is_self then 'own' else 'shared' end,
  'access',access_kind,'legacyFileIds',legacy_ids,'hasPreparedSource',coalesce(prepared->'source'<>'null'::jsonb,false),
  'sources',coalesce(result->'sources','[]'),'nextAfter',coalesce(result->'nextAfter','null'),
  'jointReceipt',encode(extensions.digest(convert_to(ctx::text,'UTF8'),'sha256'),'hex'));
 return page||jsonb_build_object('pageReceipt',encode(extensions.digest(convert_to(jsonb_build_object('page',page,'layer',layer,'result',result,'prepared',prepared)::text,'UTF8'),'sha256'),'hex'));
end; $$;

create function public.confirm_health_picture_results_v1(p_account_id uuid,p_session_id uuid,p_self_subject_id uuid,p_counterparts jsonb,
 p_purposes text[],p_expected jsonb)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare ctx jsonb; account_ids uuid[]; subject_ids uuid[]; v_subject_id uuid; purpose_key text;
 item jsonb; actual jsonb; after_file uuid; cursor_index integer:=0; deadline timestamptz;
begin
 if jsonb_typeof(p_expected) is distinct from 'array' or jsonb_array_length(p_expected) not between 1 and 1000
 or p_purposes is null or cardinality(p_purposes) not between 1 and 2
 or cardinality(p_purposes)<>(select count(distinct x) from unnest(p_purposes) x)
 or exists(select 1 from unnest(p_purposes) x where x is null or x not in('reports.monogenic','reports.polygenic')) then return false; end if;
 ctx:=private.health_picture_context_v1(p_account_id,p_session_id,p_self_subject_id,p_counterparts);
 select array_agg(x order by x) into account_ids from (select p_account_id x union select (c->>'accountId')::uuid from jsonb_array_elements(p_counterparts) c) a;
 select array_agg(x order by x) into subject_ids from (select p_self_subject_id x union select (c->>'subjectId')::uuid from jsonb_array_elements(p_counterparts) c) a;
 -- All columns use one lock transaction. NOWAIT avoids inversions with older
 -- grant-first revoke routines; contention withholds rather than waits.
 perform 1 from auth.users where id=any(account_ids) order by id for share nowait;
 perform 1 from public.profiles where id=any(account_ids) order by id for share nowait;
 perform 1 from auth.sessions where user_id=p_account_id and id=p_session_id for share nowait;
 perform 1 from public.subjects where id=any(subject_ids) order by id for share nowait;
 perform 1 from public.subject_account_bindings where subject_id=any(subject_ids) order by id for share nowait;
 perform 1 from public.subject_principals where account_id=any(account_ids) order by id for share nowait;
 perform 1 from public.subject_relationships where subject_id=any(subject_ids) order by id for share nowait;
 perform 1 from public.genome_files where subject_id=any(subject_ids) order by id for share nowait;
 perform 1 from public.purpose_grants where target_kind='subject' and target_id=any(subject_ids) order by grant_id for share nowait;
 perform 1 from public.directional_grants where grant_id in(select grant_id from public.purpose_grants where target_kind='subject' and target_id=any(subject_ids)) order by grant_id for share nowait;
 perform 1 from private.health_picture_grant_snapshots where grant_id in(select grant_id from public.purpose_grants where target_kind='subject' and target_id=any(subject_ids)) order by grant_id for share nowait;
 perform 1 from private.family_report_grant_snapshots where grant_id in(select grant_id from public.purpose_grants where target_kind='subject' and target_id=any(subject_ids)) order by grant_id for share nowait;
 perform 1 from public.consent_signatures where target_kind='subject' and target_id=any(subject_ids) order by id for share nowait;
 perform 1 from public.consent_artifacts where artifact_key in('disclosure.insurance-and-discrimination','consent.upload-self','consent.own-monogenic','consent.own-polygenic','consent.share-with-adult') order by artifact_key,version for share nowait;
 perform 1 from public.subject_consents where subject_id=any(subject_ids) order by id for share nowait;
 perform 1 from public.genome_storage_objects where genome_file_id in(select id from public.genome_files where subject_id=any(subject_ids)) order by object_id for share nowait;
 perform 1 from storage.objects where id in(select storage_object_id from public.genome_files where subject_id=any(subject_ids)) order by id for share nowait;
 perform 1 from private.own_normalization_runs where file_id in(select id from public.genome_files where subject_id=any(subject_ids)) order by file_id for share nowait;
 perform 1 from private.own_analysis_runs where subject_id=any(subject_ids) order by id for share nowait;
 if private.health_picture_context_v1(p_account_id,p_session_id,p_self_subject_id,p_counterparts) is distinct from ctx then return false; end if;
 -- Locks freeze revisions, not time. The earliest live store or purpose
 -- deadline fences a source checked before another column finishes.
 select min(expires_at) into deadline from (
  select expires_at from public.purpose_grants where target_kind='subject' and target_id=any(subject_ids)
   and purpose in('family.heritability','reports.monogenic','reports.polygenic') and revoked_at is null and expires_at>clock_timestamp()
  union all select expires_at from public.subject_consents where subject_id=any(subject_ids)
   and revoked_at is null and expires_at>clock_timestamp()
 ) deadlines;
 foreach v_subject_id in array subject_ids loop
  for purpose_key in select x from unnest(p_purposes) x order by x loop
   after_file:=null;
   loop
    item:=p_expected->cursor_index;
    if item is null or jsonb_typeof(item) is distinct from 'object' or item-array['subjectId','purpose','afterFile','receipt']<>'{}'
     or not(item ?& array['subjectId','purpose','afterFile','receipt']) or item->>'subjectId' is distinct from v_subject_id::text
     or item->>'purpose' is distinct from purpose_key or (item->>'afterFile')::uuid is distinct from after_file
     or coalesce(item->>'receipt','')!~'^[0-9a-f]{64}$' then return false; end if;
    actual:=public.health_picture_results_v1(p_account_id,p_session_id,p_self_subject_id,p_counterparts,v_subject_id,purpose_key,after_file);
    if actual->>'pageReceipt' is distinct from item->>'receipt' then return false; end if;
    after_file:=(actual->>'nextAfter')::uuid; cursor_index:=cursor_index+1;
    exit when after_file is null;
   end loop;
  end loop;
 end loop;
 if private.health_picture_context_v1(p_account_id,p_session_id,p_self_subject_id,p_counterparts) is distinct from ctx then return false; end if;
 -- Clock fence follows the final authority pass; boolean expression evaluation
 -- order must not move expiry before a potentially long counterpart check.
 return cursor_index=jsonb_array_length(p_expected) and (deadline is null or deadline>clock_timestamp());
exception when lock_not_available or insufficient_privilege or object_not_in_prerequisite_state or invalid_text_representation then return false;
end; $$;
revoke all on function private.health_picture_direction_v1(uuid,uuid,uuid,uuid,text),private.health_picture_context_v1(uuid,uuid,uuid,jsonb),
 private.health_picture_own_page_v1(uuid,uuid,uuid,text,uuid,text) from public,anon,authenticated,inherit_upload_only,service_role;
revoke all on function public.health_picture_grant_presentation_v1(uuid,uuid,uuid,uuid),
 public.grant_health_picture_purpose_v1(uuid,uuid,uuid,uuid,uuid,text,integer,text,text,text),
 public.health_picture_results_v1(uuid,uuid,uuid,jsonb,uuid,text,uuid),
 public.confirm_health_picture_results_v1(uuid,uuid,uuid,jsonb,text[],jsonb) from public,anon,authenticated,inherit_upload_only;
grant execute on function public.health_picture_grant_presentation_v1(uuid,uuid,uuid,uuid),
 public.grant_health_picture_purpose_v1(uuid,uuid,uuid,uuid,uuid,text,integer,text,text,text),
 public.health_picture_results_v1(uuid,uuid,uuid,jsonb,uuid,text,uuid),
 public.confirm_health_picture_results_v1(uuid,uuid,uuid,jsonb,text[],jsonb) to service_role;
