-- The combined pending canonical/Path B graph must retain both existing
-- generic owner-list refusals. Ownership alone authorizes neither source.
do $privacy$
declare expected_qual text; actual_qual text;
begin
  if not exists(select 1 from pg_catalog.pg_class file_table
    join pg_catalog.pg_namespace namespace on namespace.oid=file_table.relnamespace
    join pg_catalog.pg_policy policy on policy.polrelid=file_table.oid
    where namespace.nspname='public' and file_table.relname='genome_files'
      and file_table.relkind='r' and file_table.relrowsecurity
      and file_table.relowner=(select oid from pg_catalog.pg_roles where rolname='postgres')
      and policy.polname='genome_files_select_own' and policy.polcmd='r' and policy.polpermissive
      and policy.polroles=array[(select oid from pg_catalog.pg_roles where rolname='authenticated')]::oid[]
      and policy.polwithcheck is null)
    or exists(select 1 from pg_catalog.pg_policy policy
      where policy.polrelid='public.genome_files'::regclass and policy.polcmd in('r','*')
        and policy.polname<>'genome_files_select_own') then
    raise exception using errcode='55000',message='unexpected source file policy';end if;
  if (select count(*) from pg_catalog.pg_proc helper where helper.oid in(
    'private.genome_file_owner_listable_v1(uuid)'::regprocedure,'private.is_path_b_file_v1(uuid)'::regprocedure)
    and helper.proowner=(select oid from pg_catalog.pg_roles where rolname='postgres')
    and helper.prosecdef and helper.provolatile='s' and helper.prorettype='boolean'::regtype
    and helper.prolang=(select oid from pg_catalog.pg_language where lanname='sql')
    and helper.proconfig=array['search_path=""']::text[]
    and md5(helper.prosrc)=case helper.oid
      when 'private.genome_file_owner_listable_v1(uuid)'::regprocedure then 'ccfd04d2e9b2dd90db3dfb33bb3968d1'
      when 'private.is_path_b_file_v1(uuid)'::regprocedure then 'fae16b4a98c3e99447754ac6b284a412' end
    and has_function_privilege('authenticated',helper.oid,'execute')
    and not has_function_privilege('anon',helper.oid,'execute')
    and not has_function_privilege('inherit_upload_only',helper.oid,'execute')
    and not has_function_privilege('service_role',helper.oid,'execute'))<>2 then
    raise exception using errcode='55000',message='unexpected source file policy helper';end if;
  -- Parse the exact reviewed predecessor using the same actual table shape.
  -- This owner-created empty transaction-local relation carries no user rows
  -- and avoids accepting a guessed deparser spelling or a caller-set flag.
  create temporary table source_file_policy_predecessor(like public.genome_files) on commit drop;
  create policy source_file_policy_predecessor on source_file_policy_predecessor to authenticated
    using(user_id=(select auth.uid()) and not private.is_path_b_file_v1(id));
  select pg_catalog.pg_get_expr(policy.polqual,policy.polrelid) into expected_qual
    from pg_catalog.pg_policy policy where policy.polrelid='pg_temp.source_file_policy_predecessor'::regclass;
  select pg_catalog.pg_get_expr(policy.polqual,policy.polrelid) into actual_qual
    from pg_catalog.pg_policy policy where policy.polrelid='public.genome_files'::regclass
      and policy.polname='genome_files_select_own';
  drop table source_file_policy_predecessor;
  if actual_qual is distinct from expected_qual then
    raise exception using errcode='55000',message='unexpected source file policy predecessor';end if;
  alter policy genome_files_select_own on public.genome_files to authenticated
    using(user_id=(select auth.uid()) and private.genome_file_owner_listable_v1(id)
      and not private.is_path_b_file_v1(id));
end
$privacy$;
notify pgrst,'reload schema';
