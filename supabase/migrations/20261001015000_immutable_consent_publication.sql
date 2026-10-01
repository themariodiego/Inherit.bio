-- Administrative legal publication preserves each signed predecessor exactly.
-- No API role, including service_role, receives this owner-only capability.
-- The one-use authority lives only in the publisher's owned temporary table;
-- caller-set configuration or a caller-owned lookalike is never authority.
create function private.guard_consent_artifact_publication_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_capability oid; v_owner oid; v_consumed integer;
begin
  if old.superseded_at is not null or new.superseded_at is null
    or (to_jsonb(new)-'superseded_at') is distinct from (to_jsonb(old)-'superseded_at') then
    raise exception using errcode='55000',message='immutable row';
  end if;
  select p.proowner into v_owner from pg_catalog.pg_proc p
    where p.oid='private.publish_consent_artifact_v1(text,integer,text,integer,text,text,date,text)'::regprocedure;
  select c.oid into v_capability from pg_catalog.pg_class c
    where c.relnamespace=pg_catalog.pg_my_temp_schema()
      and c.relname='inherit_consent_publication_v1' and c.relkind='r'
      and c.relpersistence='t' and c.relowner=v_owner;
  if v_capability is null then raise exception using errcode='55000',message='immutable row';end if;
  delete from pg_temp.inherit_consent_publication_v1
    where predecessor=to_jsonb(old) and published_at=new.superseded_at
      and next_version=old.version+1 and next_body_sha256 ~ '^[0-9a-f]{64}$';
  get diagnostics v_consumed=row_count;
  if v_consumed<>1 then raise exception using errcode='55000',message='immutable row';end if;
  return new;
end $$;
revoke all on function private.guard_consent_artifact_publication_v1()
  from public,anon,authenticated,service_role,inherit_upload_only;

create function private.publish_consent_artifact_v1(p_artifact_key text,p_predecessor_version integer,
  p_predecessor_sha256 text,p_next_version integer,p_body text,p_summary text,p_effective date,p_changes text)
returns void language plpgsql security definer set search_path='' as $$
declare
  v_previous public.consent_artifacts; v_published timestamptz; v_body_sha256 text;
begin
  if p_artifact_key is null or p_predecessor_version is null or p_next_version is null
    or p_predecessor_sha256 is null or p_predecessor_sha256 !~ '^[0-9a-f]{64}$'
    or p_predecessor_version<1 or p_predecessor_version=2147483647
    or p_next_version<>p_predecessor_version+1 or p_effective is null
    or nullif(btrim(p_body),'') is null or nullif(btrim(p_summary),'') is null
    or nullif(btrim(p_changes),'') is null then
    raise exception using errcode='22023',message='invalid consent publication';
  end if;
  select * into v_previous from public.consent_artifacts
    where artifact_key=p_artifact_key and version=p_predecessor_version for update;
  if not found or v_previous.superseded_at is not null
    or v_previous.body_sha256<>p_predecessor_sha256
    or v_previous.body_sha256<>encode(extensions.digest(v_previous.body_markdown,'sha256'),'hex')
    or exists(select 1 from public.consent_artifacts a where a.artifact_key=p_artifact_key
      and a.version>p_predecessor_version) then
    raise exception using errcode='55000',message='consent predecessor changed';
  end if;
  if exists(select 1 from pg_catalog.pg_class c where c.relnamespace=pg_catalog.pg_my_temp_schema()
    and c.relname='inherit_consent_publication_v1') then
    raise exception using errcode='55000',message='consent publication capability unavailable';
  end if;
  v_published:=clock_timestamp();
  if v_published<v_previous.published_at then
    raise exception using errcode='55000',message='consent predecessor changed';
  end if;
  v_body_sha256:=encode(extensions.digest(p_body,'sha256'),'hex');
  create temporary table inherit_consent_publication_v1(
    predecessor jsonb not null, next_version integer not null,
    next_body_sha256 text not null, published_at timestamptz not null
  ) on commit drop;
  revoke all on pg_temp.inherit_consent_publication_v1 from public,anon,authenticated,service_role,inherit_upload_only;
  insert into pg_temp.inherit_consent_publication_v1 values(to_jsonb(v_previous),p_next_version,v_body_sha256,v_published);
  update public.consent_artifacts set superseded_at=v_published
    where artifact_key=p_artifact_key and version=p_predecessor_version;
  if exists(select 1 from pg_temp.inherit_consent_publication_v1) then
    raise exception using errcode='55000',message='consent publication capability not consumed';
  end if;
  insert into public.consent_artifacts(artifact_key,version,body_sha256,body_markdown,summary_markdown,
    effective_on,summary_of_changes,published_at)
  values(p_artifact_key,p_next_version,v_body_sha256,p_body,p_summary,p_effective,p_changes,v_published);
  drop table pg_temp.inherit_consent_publication_v1;
end $$;
revoke all on function private.publish_consent_artifact_v1(text,integer,text,integer,text,text,date,text)
  from public,anon,authenticated,service_role,inherit_upload_only;

drop trigger consent_artifacts_immutable on public.consent_artifacts;
create trigger consent_artifacts_immutable before update on public.consent_artifacts
  for each row execute function private.guard_consent_artifact_publication_v1();
-- private.reject_immutable_row_update and every other immutable trigger remain
-- unchanged. No artifact, signature, deadline, consent or grant is backfilled.
