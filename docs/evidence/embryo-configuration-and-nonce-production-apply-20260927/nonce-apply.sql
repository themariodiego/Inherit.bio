-- Guarded production apply of supabase/migrations/20260927130000_embryo_nonce_capabilities.sql
-- (#234, landing #205; file SHA-256 243f7c0196bbbd13b63fd1c226eb65b42f957a3f5da7fbddc9199f629d8abeb2, text MD5 3ffa89ebe766457f7fae6b09a7ac916f).
-- One DO statement, so it is atomic under any client protocol: predecessor checks against the
-- state measured identically on production and on the rehearsal stack, the migration executed
-- verbatim, postchecks against the definitions measured on the tested local stack, and the
-- ledger row under the repository's own version and name.
do $inherit_nc_do$
declare
  migration constant text := $inherit_nc_migration$-- A nonce is consumed by the authorized operation, never by a service caller
-- supplying an arbitrary polymorphic target. Keep the existing operation
-- bodies, target checks, lock order, replay behavior and NULL form target.
revoke all on function private.consume_embryo_operation_nonce_v1(text,uuid,uuid,text,text,uuid)
  from public,anon,authenticated,inherit_upload_only,service_role;
revoke all on table public.embryo_operation_nonces
  from public,anon,authenticated,inherit_upload_only,service_role;
grant select on table public.embryo_operation_nonces to service_role;

-- The retention route previously used the service role's table DELETE grant.
-- Keep its exact no-argument operation behind a narrow private definer. Its
-- existing lock is acquired first; do not add a late lock to nonce consumers.
create function private.expire_invitation_refusal_receipts_v1()
returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 perform private.lock_invitation_transitions_v1();
 delete from public.embryo_operation_nonces where operation='invitation_refuse'
  and rights_receipt_expires_at<=clock_timestamp();
 get diagnostics n=row_count;
 return n;
end;
$$;
revoke all on function private.expire_invitation_refusal_receipts_v1()
  from public,anon,authenticated,inherit_upload_only;
grant execute on function private.expire_invitation_refusal_receipts_v1() to service_role;

create or replace function public.expire_invitation_refusal_receipts_v1()
returns integer language sql security invoker set search_path='' as $$
 select private.expire_invitation_refusal_receipts_v1();
$$;
revoke all on function public.expire_invitation_refusal_receipts_v1()
  from public,anon,authenticated,inherit_upload_only;
grant execute on function public.expire_invitation_refusal_receipts_v1() to service_role;
$inherit_nc_migration$;
  nonces_before bigint;
begin
  if md5(migration) <> '3ffa89ebe766457f7fae6b09a7ac916f' then
    raise exception using message = 'integrity: the embedded migration text is not the reviewed file'; end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20260927130000') then
    raise exception using message = 'predecessor: 20260927130000 is already in the ledger'; end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20260927120000') then
    raise exception using message = 'predecessor: the embryo session configuration row is missing'; end if;
  if to_regprocedure('private.expire_invitation_refusal_receipts_v1()') is not null then
    raise exception using message = 'predecessor: the private expiry function already exists'; end if;
  if md5(pg_get_functiondef('private.consume_embryo_operation_nonce_v1(text,uuid,uuid,text,text,uuid)'::regprocedure)) <> 'db5ce99583d6e1724eae8490eec6a9ef' then
    raise exception using message = 'predecessor: the nonce consumer differs from the tested definition'; end if;
  if md5(pg_get_functiondef('private.lock_invitation_transitions_v1()'::regprocedure)) <> '3a28aeaf4bf736cbba89e3b209649557' then
    raise exception using message = 'predecessor: the invitation transition lock differs from the tested definition'; end if;
  if md5(pg_get_functiondef('public.expire_invitation_refusal_receipts_v1()'::regprocedure)) <> 'c0f3489a91be12a4c7a93adb85e3d62d' then
    raise exception using message = 'predecessor: the public expiry function differs from the tested definition'; end if;
  if (select string_agg(r||'='||has_function_privilege(r,'private.consume_embryo_operation_nonce_v1(text,uuid,uuid,text,text,uuid)','execute')::text, ',' order by r) from unnest(array['anon','authenticated','inherit_upload_only','service_role']) r) <> 'anon=false,authenticated=false,inherit_upload_only=false,service_role=true' then
    raise exception using message = 'predecessor: nonce consumer privileges differ from the tested set'; end if;
  if (select string_agg(r||'='||has_function_privilege(r,'public.expire_invitation_refusal_receipts_v1()','execute')::text, ',' order by r) from unnest(array['anon','authenticated','inherit_upload_only','service_role']) r) <> 'anon=false,authenticated=false,inherit_upload_only=false,service_role=true' then
    raise exception using message = 'predecessor: public expiry privileges differ from the tested set'; end if;
  if (select string_agg(r||':'||p||'='||has_table_privilege(r,'public.embryo_operation_nonces',p)::text, ',' order by r,p) from unnest(array['anon','authenticated','inherit_upload_only','service_role']) r cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p) <> 'anon:DELETE=false,anon:INSERT=false,anon:REFERENCES=false,anon:SELECT=false,anon:TRIGGER=false,anon:TRUNCATE=false,anon:UPDATE=false,authenticated:DELETE=false,authenticated:INSERT=false,authenticated:REFERENCES=false,authenticated:SELECT=false,authenticated:TRIGGER=false,authenticated:TRUNCATE=false,authenticated:UPDATE=false,inherit_upload_only:DELETE=false,inherit_upload_only:INSERT=false,inherit_upload_only:REFERENCES=false,inherit_upload_only:SELECT=false,inherit_upload_only:TRIGGER=false,inherit_upload_only:TRUNCATE=false,inherit_upload_only:UPDATE=false,service_role:DELETE=true,service_role:INSERT=true,service_role:REFERENCES=true,service_role:SELECT=true,service_role:TRIGGER=true,service_role:TRUNCATE=true,service_role:UPDATE=true' then
    raise exception using message = 'predecessor: nonce table privileges differ from the tested set'; end if;
  select count(*) into nonces_before from public.embryo_operation_nonces;

  execute migration;

  if md5(pg_get_functiondef('private.expire_invitation_refusal_receipts_v1()'::regprocedure)) is distinct from 'ac4edfb4dfe8552bda0a1218d86a394e' then
    raise exception using message = 'postcheck: the private expiry function differs from the tested definition'; end if;
  if md5(pg_get_functiondef('public.expire_invitation_refusal_receipts_v1()'::regprocedure)) <> '8db791cfd4d837e55783fa2e6538f9bc' then
    raise exception using message = 'postcheck: the public expiry function differs from the tested definition'; end if;
  if md5(pg_get_functiondef('private.consume_embryo_operation_nonce_v1(text,uuid,uuid,text,text,uuid)'::regprocedure)) <> 'db5ce99583d6e1724eae8490eec6a9ef' then
    raise exception using message = 'postcheck: the nonce consumer body changed'; end if;
  if md5(pg_get_functiondef('private.lock_invitation_transitions_v1()'::regprocedure)) <> '3a28aeaf4bf736cbba89e3b209649557' then
    raise exception using message = 'postcheck: the invitation transition lock changed'; end if;
  if (select string_agg(r||'='||has_function_privilege(r,'private.consume_embryo_operation_nonce_v1(text,uuid,uuid,text,text,uuid)','execute')::text, ',' order by r) from unnest(array['anon','authenticated','inherit_upload_only','service_role']) r) <> 'anon=false,authenticated=false,inherit_upload_only=false,service_role=false' then
    raise exception using message = 'postcheck: a role can still execute the nonce consumer directly'; end if;
  if (select string_agg(r||'='||has_function_privilege(r,'public.expire_invitation_refusal_receipts_v1()','execute')::text, ',' order by r) from unnest(array['anon','authenticated','inherit_upload_only','service_role']) r) <> 'anon=false,authenticated=false,inherit_upload_only=false,service_role=true' then
    raise exception using message = 'postcheck: public expiry privileges differ from the tested result'; end if;
  if (select string_agg(r||'='||has_function_privilege(r,'private.expire_invitation_refusal_receipts_v1()','execute')::text, ',' order by r) from unnest(array['anon','authenticated','inherit_upload_only','service_role']) r) <> 'anon=false,authenticated=false,inherit_upload_only=false,service_role=true' then
    raise exception using message = 'postcheck: private expiry privileges differ from the tested result'; end if;
  if (select string_agg(r||':'||p||'='||has_table_privilege(r,'public.embryo_operation_nonces',p)::text, ',' order by r,p) from unnest(array['anon','authenticated','inherit_upload_only','service_role']) r cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p) <> 'anon:DELETE=false,anon:INSERT=false,anon:REFERENCES=false,anon:SELECT=false,anon:TRIGGER=false,anon:TRUNCATE=false,anon:UPDATE=false,authenticated:DELETE=false,authenticated:INSERT=false,authenticated:REFERENCES=false,authenticated:SELECT=false,authenticated:TRIGGER=false,authenticated:TRUNCATE=false,authenticated:UPDATE=false,inherit_upload_only:DELETE=false,inherit_upload_only:INSERT=false,inherit_upload_only:REFERENCES=false,inherit_upload_only:SELECT=false,inherit_upload_only:TRIGGER=false,inherit_upload_only:TRUNCATE=false,inherit_upload_only:UPDATE=false,service_role:DELETE=false,service_role:INSERT=false,service_role:REFERENCES=false,service_role:SELECT=true,service_role:TRIGGER=false,service_role:TRUNCATE=false,service_role:UPDATE=false' then
    raise exception using message = 'postcheck: nonce table privileges differ from the tested result'; end if;
  if (select not prosecdef or proconfig is distinct from array['search_path=""'] from pg_proc where oid = 'private.expire_invitation_refusal_receipts_v1()'::regprocedure) then
    raise exception using message = 'postcheck: the private expiry function is not security definer with an empty search path'; end if;
  if (select prosecdef or proconfig is distinct from array['search_path=""'] from pg_proc where oid = 'public.expire_invitation_refusal_receipts_v1()'::regprocedure) then
    raise exception using message = 'postcheck: the public expiry function is not security invoker with an empty search path'; end if;
  if (select count(*) from public.embryo_operation_nonces) <> nonces_before then
    raise exception using message = 'postcheck: nonce rows changed'; end if;

  insert into supabase_migrations.schema_migrations (version, name, statements)
  values ('20260927130000', 'embryo_nonce_capabilities', array[migration]);
end
$inherit_nc_do$;
