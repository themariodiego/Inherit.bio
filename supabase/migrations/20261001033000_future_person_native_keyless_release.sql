-- Native own-JWT entry to the already rehearsed documentary transaction.
-- A pending notice grants no claimant/custody/release authority. Original
-- independently wrapped minimum/document keys and fixed clocks remain exact.
do $native_keyless_predecessor$
declare predecessor oid:=to_regprocedure('private.prepare_keyless_owner_notice_v1(uuid,bigint,text,bytea,bytea,date,boolean,jsonb,jsonb,text,bytea,bytea,uuid,bytea,jsonb)');
begin
  if predecessor is null or to_regprocedure('public.prepare_keyless_owner_notice_v1(uuid,bigint,text,bytea,bytea,date,boolean,jsonb,jsonb,text,bytea,bytea,uuid,bytea,jsonb)') is not null
    or not exists(select 1 from pg_proc p join pg_language lang on lang.oid=p.prolang
      join pg_roles owner_role on owner_role.oid=p.proowner
      where p.oid=predecessor and owner_role.rolname='postgres' and lang.lanname='plpgsql'
        and p.prosecdef and p.prokind='f' and not p.proretset and p.prorettype='jsonb'::regtype
        and p.pronargs=15 and p.pronargdefaults=0 and p.provariadic=0 and p.proallargtypes is null
        and p.proargnames=array['p_review','p_revision','p_nonce_hash','p_reason','p_attestation','p_verified_birth',
          'p_parent_link_confirmed','p_identity_set','p_profile_set','p_comparison_receipt','p_minimum_ciphertext',
          'p_minimum_wrapped_key','p_contact_id','p_contact_ciphertext','p_contact_set']::text[]
        and p.proconfig=array['search_path=""','lock_timeout=250ms']::text[]
        and md5(p.prosrc)='ffab04c15fb5ac220e5604d8e3f703b4')
    or exists(select 1 from unnest(array['anon','authenticated','inherit_upload_only','service_role']) role_name
      where has_function_privilege(role_name,predecessor,'execute'))
    or exists(select 1 from pg_proc p,lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
      where p.oid=predecessor and acl.privilege_type='EXECUTE' and acl.grantee<>p.proowner) then
    raise exception using errcode='55000',message='native keyless prepare predecessor differs';end if;
end;
$native_keyless_predecessor$;

create function public.prepare_keyless_owner_notice_v1(
  p_review uuid,p_revision bigint,p_nonce_hash text,p_reason bytea,p_attestation bytea,
  p_verified_birth date,p_parent_link_confirmed boolean,p_identity_set jsonb,p_profile_set jsonb,p_comparison_receipt text,
  p_minimum_ciphertext bytea,p_minimum_wrapped_key bytea,
  p_contact_id uuid,p_contact_ciphertext bytea,p_contact_set jsonb
) returns jsonb language sql security definer set search_path='' set lock_timeout='250ms' as $$
  select private.prepare_keyless_owner_notice_v1(p_review,p_revision,p_nonce_hash,p_reason,p_attestation,
    p_verified_birth,p_parent_link_confirmed,p_identity_set,p_profile_set,p_comparison_receipt,
    p_minimum_ciphertext,p_minimum_wrapped_key,p_contact_id,p_contact_ciphertext,p_contact_set);
$$;
revoke all on function public.prepare_keyless_owner_notice_v1(uuid,bigint,text,bytea,bytea,date,boolean,jsonb,jsonb,text,bytea,bytea,uuid,bytea,jsonb)
  from public,anon,inherit_upload_only,service_role;
grant execute on function public.prepare_keyless_owner_notice_v1(uuid,bigint,text,bytea,bytea,date,boolean,jsonb,jsonb,text,bytea,bytea,uuid,bytea,jsonb) to authenticated;
