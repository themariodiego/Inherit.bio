-- Admit the four already-registered consumer array formats to the dedicated
-- confirmed-revision Path B queue. All authority, source and ACL checks remain.
do $array_predecessor$
declare p pg_proc;
begin
 select * into p from pg_proc where oid=to_regprocedure('private.enqueue_path_b_normalization_v1(uuid)');
 if p.oid is null or md5(p.prosrc) is distinct from 'd760bae87d3146dedb8d8c13cd3bd0ab'
  or p.proowner is distinct from 'postgres'::regrole
  or p.prolang is distinct from (select oid from pg_language where lanname='plpgsql')
  or p.prokind<>'f' or p.provolatile<>'v' or p.proparallel<>'u' or p.proisstrict or not p.prosecdef or p.proleakproof
  or p.procost is distinct from 100 or p.prorows is distinct from 0 or p.probin is not null
  or p.prosupport is distinct from 0::oid or p.prosqlbody is not null
  or p.prorettype is distinct from 'uuid'::regtype or p.proretset or p.pronargs<>1 or p.pronargdefaults<>0
  or p.provariadic<>0 or p.proallargtypes is not null or p.proargmodes is not null
  or p.proargtypes[0] is distinct from 'uuid'::regtype
  or p.proargnames is distinct from array['p_revision_id']::text[]
  or p.proargdefaults is not null or p.proconfig is distinct from array['search_path=""']::text[]
  or (select count(*) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))))<>1
  or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where a.grantee<>p.proowner or a.grantor<>p.proowner or a.privilege_type<>'EXECUTE' or a.is_grantable) then
  raise exception using errcode='55000',message='path_b_array_normalization_definition_changed';end if;
end $array_predecessor$;
create or replace function private.enqueue_path_b_normalization_v1(p_revision_id uuid)
returns uuid language plpgsql security definer set search_path=''
as $$
declare h public.other_adult_held_uploads%rowtype; a jsonb; j public.worker_jobs%rowtype;
begin
 a:=private.path_b_normalization_authority_v1(p_revision_id,'analysis-enqueue');
 select * into h from public.other_adult_held_uploads where id=p_revision_id for update;
 if h.file_type not in('array_23andme','array_ancestry','array_myheritage','array_ftdna','vcf','gvcf') then return null; end if;
 insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,sha256,status,
  upload_revision,structural_validator_version,single_logical_sample_verified_at,source_sha256)
 values(h.id,h.uploader_account_id,h.subject_id,h.object_name,'Genome file',h.file_type,1,h.size_bytes,h.raw_sha256,
  'uploaded',h.upload_revision,'single-logical-sample-v1',h.held_at,h.decoded_sha256)
 on conflict(id) do nothing;
 if not exists(select 1 from public.genome_files f where f.id=h.id and f.user_id=h.uploader_account_id
  and f.subject_id=h.subject_id and f.storage_object_id is null and f.bucket_path=h.object_name
  and f.sha256=h.raw_sha256 and f.source_sha256=h.decoded_sha256 and f.upload_revision=h.upload_revision
  and f.file_type=h.file_type and f.size_bytes=h.size_bytes and f.tier=1) then
  raise exception using errcode='42501',message='not_found'; end if;
 j:=private.enqueue_worker_job_v2(h.uploader_account_id,'annotate_vcf','ingest.normalize',h.subject_id,null,
  'genome-file',h.id,h.upload_revision,h.raw_sha256,'path-b-normalization-v1',h.id,
  jsonb_build_object('authority',a));
 update public.other_adult_held_uploads set analysis_state=case when exists(select 1 from public.purpose_grants pg
  where pg.target_kind='subject' and pg.target_id=h.subject_id and pg.revoked_at is null
   and (pg.expires_at is null or pg.expires_at>clock_timestamp())) then 'queued' else 'confirmed_awaiting_purpose' end
 where id=h.id;
 return j.id;
end;
$$;
do $array_successor$
declare p pg_proc;
begin
 select * into p from pg_proc where oid=to_regprocedure('private.enqueue_path_b_normalization_v1(uuid)');
 if p.oid is null or md5(p.prosrc) is distinct from '6908fe88715d613b8b1efd15eebda757'
  or p.proowner is distinct from 'postgres'::regrole
  or p.prolang is distinct from (select oid from pg_language where lanname='plpgsql')
  or p.prokind<>'f' or p.provolatile<>'v' or p.proparallel<>'u' or p.proisstrict or not p.prosecdef or p.proleakproof
  or p.procost is distinct from 100 or p.prorows is distinct from 0 or p.probin is not null
  or p.prosupport is distinct from 0::oid or p.prosqlbody is not null
  or p.prorettype is distinct from 'uuid'::regtype or p.proretset or p.pronargs<>1 or p.pronargdefaults<>0
  or p.provariadic<>0 or p.proallargtypes is not null or p.proargmodes is not null
  or p.proargtypes[0] is distinct from 'uuid'::regtype
  or p.proargnames is distinct from array['p_revision_id']::text[]
  or p.proargdefaults is not null or p.proconfig is distinct from array['search_path=""']::text[]
  or (select count(*) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))))<>1
  or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where a.grantee<>p.proowner or a.grantor<>p.proowner or a.privilege_type<>'EXECUTE' or a.is_grantable) then
  raise exception using errcode='55000',message='path_b_array_normalization_definition_changed';end if;
end $array_successor$;
