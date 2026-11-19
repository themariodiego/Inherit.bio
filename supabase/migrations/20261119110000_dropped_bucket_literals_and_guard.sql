-- =====================================================================
-- PRODUCTION RELEASE: GUARDED. This migration is applied to local and CI
-- databases only. It must reach a hosted database through the guarded
-- production release (preflight, postflight, receipt), never as a side
-- effect of a merge. It goes into a release after the four migrations of
-- docs/evidence/followup-2-production-apply-20261119/, none of which it
-- touches. It follows 20260930238000 and 20260930132000, whose two manifest
-- builders it holds unchanged, 20260930140000 and 20260930140100, which
-- dropped the two buckets, and 20260928130100, whose three cores it patches.
-- =====================================================================
--
-- Two dropped buckets leave the bucket CHECKs, and one jurisdiction guard
-- shape stops letting a NULL flag through.
--
--   1. D-130 and docs/register-contract-divergence.json#allowlistedBucketNotCreated.
--      Both manifest builders already read upload_sessions.storage_bucket
--      for their upload-staging leg: public.prepare_embryo_ingest_unwind_v1
--      since 20260929101000 (restated by 20260930132000), and
--      public.claim_due_account_deletion_v1 since 20260930235000 (restated by
--      20260930238000). Neither is restated here; the preflight holds both to
--      their reviewed bodies and ACLs. What was left is the CHECKs:
--        - 'genomes-staging' (dropped by 20260930140000) leaves the bucket
--          CHECKs of public.account_deletion_storage_entries and
--          public.embryo_ingest_delete_objects;
--        - 'generated-artifacts' (dropped by 20260930140100) leaves those two
--          and the bucket CHECK of public.genome_storage_objects.
--      Every bucket that exists and was admitted stays admitted ('genomes',
--      'legal-evidence', and the embryo R2 bucket pattern). Before any check
--      changes, the three tables are locked ACCESS EXCLUSIVE, in a fixed
--      order, and the migration refuses (55000, writing nothing) if any row
--      still names a removed bucket, or if a legacy upload session that names
--      'genomes-staging' is one an embryo unwind would inventory (the
--      embryo leg copies the session's bucket without a Storage join, so
--      such a session would now make the plan refuse instead of recording
--      an unsupported entry). Each check is then dropped and re-added by
--      name, validated in place: the tables are small, the lock is held to
--      commit either way, so NOT VALID would shorten nothing.
--   2. D-140. Three cores refuse unless the jurisdiction flag is true, as
--      every other p_test_jurisdiction guard does. Their guard was
--      `if not p_test_jurisdiction ...`, which a NULL flag passed (not NULL
--      is NULL): private.create_adult_subject_invitation_core_v1,
--      private.create_embryo_cohort_draft_core_v1 and
--      private.create_embryo_draft_invitation_core_v1. Each is patched in
--      place, md5-guarded with its exact reviewed ACL, one anchor, with the
--      successor md5 and unchanged ACL asserted (55000 otherwise). true and
--      false behave as before; NULL now refuses like false.
--
-- No function signature, grant, column, wording or other constraint
-- changes. None of the five functions is among the bodies production holds
-- comment-stripped; production's recorded digests equal the ones pinned
-- here.

do $predecessor$
begin
 -- Each function its reviewed body and ACL. Distinct signatures are counted,
 -- so no body can stand in for another.
 if (select count(distinct x.signature) from pg_proc p join (values
    ('public.claim_due_account_deletion_v1(text,integer)','a67a7a734a1e3bf392f5bdaf40678b6e',
     '{postgres=X/postgres,service_role=X/postgres}'),
    ('public.prepare_embryo_ingest_unwind_v1(uuid,bigint)','370cf6155b34299765c50ef2a7fefdbc',
     '{postgres=X/postgres,service_role=X/postgres}'),
    ('private.create_adult_subject_invitation_core_v1(uuid,bytea,text,text,boolean)','8c330bee64e40182f7df90fdff39505d',
     '{postgres=X/postgres}'),
    ('private.create_embryo_cohort_draft_core_v1(uuid,uuid,text,text,integer,bytea,text,text[],text[],text,boolean)',
     '5f87e19b0324a34ef2945c2f2158313d','{postgres=X/postgres}'),
    ('private.create_embryo_draft_invitation_core_v1(uuid,uuid,uuid,text,text,text,boolean)','6bc9b8cda82896772859a4887ad888c1',
     '{postgres=X/postgres}')
   ) as x(signature,body,acl) on p.oid=to_regprocedure(x.signature) and md5(pg_get_functiondef(p.oid))=x.body
    and p.proacl::text=x.acl)<>5
  -- Each bucket check exactly as the migrations left it, validated.
  or (select count(*) from pg_constraint c join (values
    ('public.genome_storage_objects','genome_storage_objects_bucket_id_check',
     'CHECK ((bucket_id = ANY (ARRAY[''genomes''::text, ''generated-artifacts''::text])))'),
    ('public.account_deletion_storage_entries','account_deletion_storage_entries_bucket_id_check',
     'CHECK ((bucket_id = ANY (ARRAY[''genomes''::text, ''genomes-staging''::text, ''generated-artifacts''::text, ''legal-evidence''::text])))'),
    ('public.embryo_ingest_delete_objects','embryo_ingest_delete_objects_bucket_id_check',
     'CHECK (((bucket_id = ANY (ARRAY[''genomes''::text, ''genomes-staging''::text, ''generated-artifacts''::text, ''legal-evidence''::text])) OR (bucket_id ~ ''^inherit-embryo-[a-z0-9-]{1,40}$''::text)))')
   ) as x(relation,name,definition) on c.conrelid=to_regclass(x.relation) and c.conname=x.name
    and c.contype='c' and c.convalidated and pg_get_constraintdef(c.oid)=x.definition)<>3
  -- Both buckets are gone.
  or exists(select 1 from storage.buckets where id in ('genomes-staging','generated-artifacts')) then
  raise exception using errcode='55000',message='dropped bucket literals prerequisite differs'; end if;
end;
$predecessor$;

-- 1. The bucket checks lose the dropped buckets. The lock comes first, so the
-- refusals read exactly the rows the checks then validate.
do $tighten$
begin
 lock table public.account_deletion_storage_entries,public.embryo_ingest_delete_objects,public.genome_storage_objects
  in access exclusive mode;
 if exists(select 1 from public.account_deletion_storage_entries where bucket_id in ('genomes-staging','generated-artifacts')) then
  raise exception using errcode='55000',message='dropped bucket recorded in public.account_deletion_storage_entries'; end if;
 if exists(select 1 from public.embryo_ingest_delete_objects where bucket_id in ('genomes-staging','generated-artifacts')) then
  raise exception using errcode='55000',message='dropped bucket recorded in public.embryo_ingest_delete_objects'; end if;
 if exists(select 1 from public.genome_storage_objects where bucket_id in ('genomes-staging','generated-artifacts')) then
  raise exception using errcode='55000',message='dropped bucket recorded in public.genome_storage_objects'; end if;
 if exists(select 1 from public.upload_sessions u where u.storage_bucket='genomes-staging'
   and (u.cohort_id is not null or exists(select 1 from public.subjects s where s.id=u.subject_id and s.cohort_id is not null))) then
  raise exception using errcode='55000',message='legacy genomes-staging session reachable by an embryo unwind'; end if;
 alter table public.account_deletion_storage_entries
  drop constraint account_deletion_storage_entries_bucket_id_check,
  add constraint account_deletion_storage_entries_bucket_id_check check (bucket_id in ('genomes','legal-evidence'));
 alter table public.embryo_ingest_delete_objects
  drop constraint embryo_ingest_delete_objects_bucket_id_check,
  add constraint embryo_ingest_delete_objects_bucket_id_check check (bucket_id in ('genomes','legal-evidence')
   or bucket_id ~ '^inherit-embryo-[a-z0-9-]{1,40}$');
 alter table public.genome_storage_objects
  drop constraint genome_storage_objects_bucket_id_check,
  add constraint genome_storage_objects_bucket_id_check check (bucket_id in ('genomes'));
end;
$tighten$;

-- 2. Guarded in-place patch: a NULL jurisdiction flag refuses.
do $patch_test_jurisdiction$
declare item record;definition text;before_acl aclitem[];
begin
 for item in select * from (values
  (1,'private.create_adult_subject_invitation_core_v1(uuid,bytea,text,text,boolean)','8c330bee64e40182f7df90fdff39505d',
   '72ea3d6e8b41bfe74d8645259f7cfad7','{postgres=X/postgres}',
   $old$  if not p_test_jurisdiction
    or p_contact_ciphertext is null$old$,
   $new$  if p_test_jurisdiction is distinct from true
    or p_contact_ciphertext is null$new$,
   'adult invitation jurisdiction guard'),
  (2,'private.create_embryo_cohort_draft_core_v1(uuid,uuid,text,text,integer,bytea,text,text[],text[],text,boolean)',
   '5f87e19b0324a34ef2945c2f2158313d','f8f19fa7d430d55b00359703eee53faa','{postgres=X/postgres}',
   $old$  if not p_test_jurisdiction then
    raise exception using errcode = '42501', message = 'embryo analysis unavailable';$old$,
   $new$  if p_test_jurisdiction is distinct from true then
    raise exception using errcode = '42501', message = 'embryo analysis unavailable';$new$,
   'embryo cohort draft jurisdiction guard'),
  (3,'private.create_embryo_draft_invitation_core_v1(uuid,uuid,uuid,text,text,text,boolean)','6bc9b8cda82896772859a4887ad888c1',
   '4e6272c513d728aa62b5fba27916bcc7','{postgres=X/postgres}',
   $old$  if not p_test_jurisdiction
    or p_contact_hmac !~ '^[0-9a-f]{64}$'$old$,
   $new$  if p_test_jurisdiction is distinct from true
    or p_contact_hmac !~ '^[0-9a-f]{64}$'$new$,
   'embryo draft invitation jurisdiction guard')
 ) as patch(ordinal,target,before_md5,after_md5,acl,old_fragment,new_fragment,label) order by ordinal loop
  select pg_get_functiondef(p.oid),p.proacl into definition,before_acl from pg_proc p
   where p.oid=item.target::regprocedure and md5(pg_get_functiondef(p.oid))=item.before_md5 and p.proacl::text=item.acl;
  if definition is null then raise exception using errcode='55000',message=item.label||' predecessor differs';end if;
  if (length(definition)-length(replace(definition,item.old_fragment,'')))/length(item.old_fragment)<>1 then
   raise exception using errcode='55000',message=item.label||' anchor differs';end if;
  execute replace(definition,item.old_fragment,item.new_fragment);
  if not exists(select 1 from pg_proc p where p.oid=item.target::regprocedure and md5(pg_get_functiondef(p.oid))=item.after_md5
    and p.proacl is not distinct from before_acl) then
   raise exception using errcode='55000',message=item.label||' successor differs';end if;
 end loop;
end;
$patch_test_jurisdiction$;

-- Postflight: the checks read exactly as reviewed, the builders are still
-- their reviewed bodies and ACLs, and no function that takes the flag still
-- guards it with `if not p_test_jurisdiction`. The case keeps
-- pg_get_functiondef off aggregates, which it refuses.
do $postflight$
begin
 if (select count(*) from pg_constraint c join (values
    ('public.genome_storage_objects','genome_storage_objects_bucket_id_check',
     'CHECK ((bucket_id = ''genomes''::text))'),
    ('public.account_deletion_storage_entries','account_deletion_storage_entries_bucket_id_check',
     'CHECK ((bucket_id = ANY (ARRAY[''genomes''::text, ''legal-evidence''::text])))'),
    ('public.embryo_ingest_delete_objects','embryo_ingest_delete_objects_bucket_id_check',
     'CHECK (((bucket_id = ANY (ARRAY[''genomes''::text, ''legal-evidence''::text])) OR (bucket_id ~ ''^inherit-embryo-[a-z0-9-]{1,40}$''::text)))')
   ) as x(relation,name,definition) on c.conrelid=to_regclass(x.relation) and c.conname=x.name
    and c.contype='c' and c.convalidated and pg_get_constraintdef(c.oid)=x.definition)<>3
  or (select md5(pg_get_functiondef(oid))||' '||proacl::text from pg_proc
    where oid='public.claim_due_account_deletion_v1(text,integer)'::regprocedure)
   is distinct from 'a67a7a734a1e3bf392f5bdaf40678b6e {postgres=X/postgres,service_role=X/postgres}'
  or (select md5(pg_get_functiondef(oid))||' '||proacl::text from pg_proc
    where oid='public.prepare_embryo_ingest_unwind_v1(uuid,bigint)'::regprocedure)
   is distinct from '370cf6155b34299765c50ef2a7fefdbc {postgres=X/postgres,service_role=X/postgres}'
  or exists(select 1 from pg_proc p where case when p.prokind in ('f','p') and 'p_test_jurisdiction'=any(p.proargnames)
    then pg_get_functiondef(p.oid) ~ 'if not p_test_jurisdiction' else false end) then
  raise exception using errcode='55000',message='dropped bucket literals successor differs'; end if;
end;
$postflight$;

notify pgrst, 'reload schema';
