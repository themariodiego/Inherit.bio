-- Private, claim-scoped source-position bookkeeping for incremental parsing.
-- Existing normalization manifests, stage/complete ABI and publication fences
-- remain unchanged; legacy callers need not register positions.
alter table private.own_normalization_runs
 add column position_sequence integer not null default 0 check(position_sequence>=0),
 add column position_source_build text check(position_source_build in('GRCh37','GRCh38')),
 add column position_attempted bigint not null default 0 check(position_attempted between 0 and 9007199254740991),
 add column position_unmapped bigint not null default 0 check(position_unmapped between 0 and position_attempted);

create table private.own_normalization_positions (
 file_id uuid not null references private.own_normalization_runs(file_id) on delete cascade,
 claim uuid not null,
 source_chrom smallint not null check(source_chrom between 1 and 25),
 source_pos bigint not null check(source_pos between 1 and 9007199254740991),
 variant jsonb check(variant is null or jsonb_typeof(variant)='object'),
 mapped boolean,
 primary key(file_id,source_chrom,source_pos)
);
alter table private.own_normalization_positions enable row level security;
revoke all on private.own_normalization_positions from public,anon,authenticated,inherit_upload_only,service_role;
insert into public.purge_target_stores(target_id,store_name,store_order)
 select 'variant-rows','private.own_normalization_positions',coalesce(max(store_order),0)+1
 from public.purge_target_stores where target_id='variant-rows';

-- The expired-run reaper retains its run row. A run FK alone would leave its
-- genetic working data behind. This also covers fail, restart, rejection and
-- completion within their original transactions and terminal deadline fences.
create function private.clear_own_normalization_positions_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog,private as $$
begin
 if new.claim is distinct from old.claim or new.state<>'running' then
  delete from private.own_normalization_positions where file_id=old.file_id;
  new.position_sequence:=0; new.position_source_build:=null;
  new.position_attempted:=0; new.position_unmapped:=0;
 end if;
 return new;
end;
$$;
revoke all on function private.clear_own_normalization_positions_v1() from public,anon,authenticated,inherit_upload_only,service_role;
create trigger clear_own_normalization_positions before update of claim,state
 on private.own_normalization_runs for each row execute function private.clear_own_normalization_positions_v1();

create function private.register_own_normalization_positions_v1(p_account_id uuid,p_session_id uuid,
 p_file_id uuid,p_claim uuid,p_sequence integer,p_source_build text,p_entries jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare r private.own_normalization_runs%rowtype; v_entry jsonb; v jsonb; c jsonb;
 v_ordinals jsonb; v_attempted bigint; v_unmapped bigint; v_deadline timestamptz;
begin
 if p_sequence is null or p_sequence<0 or p_sequence=2147483647
  or p_source_build is null or p_source_build not in('GRCh37','GRCh38')
  or jsonb_typeof(p_entries) is distinct from 'array' then
  raise exception using errcode='22023',message='invalid_request'; end if;
 -- Preserve an old-valid near-4MB singleton variant despite this new source
 -- registration envelope. Only 1024 metadata bytes are added; the existing
 -- stage payload remains <=4000000 and upload/decoded ceilings do not change.
 if jsonb_array_length(p_entries) not between 1 and 1000 or octet_length(p_entries::text)>4001024 then
  raise exception using errcode='22023',message='invalid_request'; end if;
 for v_entry in select value from jsonb_array_elements(p_entries) loop
  if jsonb_typeof(v_entry) is distinct from 'object' or not(v_entry ?& array['source_chrom','source_pos','variant','mapped'])
   or v_entry-array['source_chrom','source_pos','variant','mapped']<>'{}'::jsonb
   or jsonb_typeof(v_entry->'source_chrom') is distinct from 'number' or v_entry->>'source_chrom'!~'^[1-9][0-9]*$'
   or jsonb_typeof(v_entry->'source_pos') is distinct from 'number' or v_entry->>'source_pos'!~'^[1-9][0-9]*$' then
   raise exception using errcode='22023',message='invalid_request'; end if;
  if (v_entry->>'source_chrom')::numeric not between 1 and 25 or (v_entry->>'source_pos')::numeric>9007199254740991 then
   raise exception using errcode='22023',message='invalid_request'; end if;
  if p_source_build='GRCh37' and (v_entry->>'source_chrom')::integer between 1 and 22 then
   if jsonb_typeof(v_entry->'mapped') is distinct from 'boolean' then
    raise exception using errcode='22023',message='invalid_request'; end if;
  elsif v_entry->'mapped' is distinct from 'null'::jsonb then
   raise exception using errcode='22023',message='invalid_request'; end if;
  v:=v_entry->'variant';
  if v is distinct from 'null'::jsonb then
   if jsonb_typeof(v) is distinct from 'object' or not(v ?& array['rsid','chrom','pos','ref','alt','genotype'])
    or v-array['rsid','chrom','pos','ref','alt','genotype']<>'{}'::jsonb
    or v->'chrom' is distinct from v_entry->'source_chrom' or v->'pos' is distinct from v_entry->'source_pos'
    or jsonb_typeof(v->'genotype') is distinct from 'string' or length(v->>'genotype')=0
    or jsonb_typeof(v->'ref') not in('string','null') or jsonb_typeof(v->'alt') not in('string','null')
    or jsonb_typeof(v->'rsid') not in('number','null') then
    raise exception using errcode='22023',message='invalid_request'; end if;
   if v->'rsid'<>'null'::jsonb and ((v->>'rsid')!~'^[0-9]+$' or (v->>'rsid')::numeric>9007199254740991) then
    raise exception using errcode='22023',message='invalid_request'; end if;
  end if;
 end loop;
 -- Existing check locks authority account/subject, file and exact live run.
 c:=private.own_upload_normalization_v1('check',p_account_id,p_session_id,p_file_id,p_claim,null);
 select * into strict r from private.own_normalization_runs where file_id=p_file_id;
 if r.position_sequence<>p_sequence or (r.position_source_build is not null and r.position_source_build<>p_source_build) then
  raise exception using errcode='22023',message='invalid_request'; end if;
 -- Check conflicting duplicates BEFORE choosing a representative. JSONB exact
 -- value equality preserves the closed parser record, never hash-only equality.
 if exists(select 1 from jsonb_array_elements(p_entries) x
  group by x->'source_chrom',x->'source_pos'
  having count(distinct x->'variant') filter(where x->'variant'<>'null'::jsonb)>1
   or count(distinct x->'mapped')>1) then
  raise exception using errcode='22023',message='normalization_position_conflict'; end if;
 if exists(select 1 from jsonb_array_elements(p_entries) e
  join private.own_normalization_positions d on d.file_id=p_file_id
   and d.source_chrom=(e->>'source_chrom')::smallint and d.source_pos=(e->>'source_pos')::bigint
  where d.claim is distinct from p_claim or d.mapped is distinct from (e->>'mapped')::boolean
   or (d.variant is not null and e->'variant'<>'null'::jsonb and d.variant is distinct from e->'variant')) then
  raise exception using errcode='22023',message='normalization_position_conflict'; end if;
 with candidates as (
  select distinct on(e->'source_chrom',e->'source_pos') e,ordinality-1 ordinal
  from jsonb_array_elements(p_entries) with ordinality a(e,ordinality)
  where e->'variant'<>'null'::jsonb order by e->'source_chrom',e->'source_pos',ordinality
 ) select coalesce(jsonb_agg(ordinal order by ordinal),'[]'::jsonb) into v_ordinals
 from candidates x left join private.own_normalization_positions d on d.file_id=p_file_id
  and d.source_chrom=(x.e->>'source_chrom')::smallint and d.source_pos=(x.e->>'source_pos')::bigint
 where d.variant is null;
 -- Insert only unseen positions; counters derive from RETURNING rather than a
 -- growing full-index scan. One position may first arrive as an observation.
 with input as (
  select distinct on(e->'source_chrom',e->'source_pos') e from jsonb_array_elements(p_entries) e
  order by e->'source_chrom',e->'source_pos',(e->'variant'='null'::jsonb)
 ), inserted as (
  insert into private.own_normalization_positions(file_id,claim,source_chrom,source_pos,variant,mapped)
  select p_file_id,p_claim,(e->>'source_chrom')::smallint,(e->>'source_pos')::bigint,
   nullif(e->'variant','null'::jsonb),(e->>'mapped')::boolean from input
  on conflict(file_id,source_chrom,source_pos) do nothing returning source_chrom,mapped
 ) select count(*) filter(where p_source_build='GRCh37' and source_chrom between 1 and 22),
  count(*) filter(where p_source_build='GRCh37' and source_chrom between 1 and 22 and not mapped)
  into v_attempted,v_unmapped from inserted;
 with input as (
  select distinct on(e->'source_chrom',e->'source_pos') e from jsonb_array_elements(p_entries) e
  where e->'variant'<>'null'::jsonb order by e->'source_chrom',e->'source_pos'
 ) update private.own_normalization_positions d set variant=e->'variant'
 from input where d.file_id=p_file_id and d.source_chrom=(e->>'source_chrom')::smallint
  and d.source_pos=(e->>'source_pos')::bigint and d.variant is null;
 update private.own_normalization_runs set position_sequence=p_sequence+1,position_source_build=p_source_build,
  position_attempted=position_attempted+v_attempted,position_unmapped=position_unmapped+v_unmapped
 where file_id=p_file_id returning * into r;
 -- Include bookkeeping in the live claim/session/store deadline. All mutations
 -- roll back if authorization or time expires while the batch is processed.
 perform private.own_upload_normalization_v1('check',p_account_id,p_session_id,p_file_id,p_claim,null);
 select least(r.expires_at,a.not_after,sc.expires_at) into v_deadline
 from auth.sessions a join public.subject_consents sc on sc.id=(r.authority->>'uploadConsentId')::uuid
 where a.id=p_session_id and a.user_id=p_account_id and sc.account_id=p_account_id and sc.subject_id=(c->>'subjectId')::uuid;
 if not found or v_deadline is null or clock_timestamp()>=v_deadline then
  raise exception using errcode='42501',message='not_found'; end if;
 return jsonb_build_object('acceptedVariantOrdinals',v_ordinals,'attempted',r.position_attempted,'unmapped',r.position_unmapped);
end;
$$;
revoke all on function private.register_own_normalization_positions_v1(uuid,uuid,uuid,uuid,integer,text,jsonb)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function private.register_own_normalization_positions_v1(uuid,uuid,uuid,uuid,integer,text,jsonb) to service_role;
create function public.register_own_normalization_positions_v1(p_account_id uuid,p_session_id uuid,
 p_file_id uuid,p_claim uuid,p_sequence integer,p_source_build text,p_entries jsonb)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
 select private.register_own_normalization_positions_v1(p_account_id,p_session_id,p_file_id,p_claim,p_sequence,p_source_build,p_entries);
$$;
revoke all on function public.register_own_normalization_positions_v1(uuid,uuid,uuid,uuid,integer,text,jsonb)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function public.register_own_normalization_positions_v1(uuid,uuid,uuid,uuid,integer,text,jsonb) to service_role;
