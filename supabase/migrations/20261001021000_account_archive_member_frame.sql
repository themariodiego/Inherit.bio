-- TEST-LOCAL complete member-frame prerequisite. Existing source/API guards,
-- exact owned graph and consumed request/attempt remain. No new store, JWT,
-- analytical grant, public/READY transition or provider delivery.
alter table public.genome_files add column export_content_revision bigint not null default 1
 check(export_content_revision between 1 and 9007199254740991);
comment on column public.genome_files.export_content_revision is
 'Internal monotonic statement-owned legacy content revision; excluded from archive members. Existing file retention and cascade disposal apply.';

-- Trigger-owned counter: a caller cannot choose, rewind, skip or forge it.
-- Only the denied statement trigger's actual owner may advance exactly once,
-- and only while nested in that actual source mutation trigger.
create function private.guard_export_content_revision_v1() returns trigger
 language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='INSERT' then
  if new.export_content_revision is distinct from 1::bigint then
   raise exception using errcode='23514',message='export content revision is trigger-owned';end if;
 elsif new.export_content_revision is distinct from old.export_content_revision then
  if pg_trigger_depth()<2 or current_user is distinct from
   (select pg_get_userbyid(p.proowner) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and p.proname='advance_export_content_revision_v1' and p.pronargs=0)
   or new.export_content_revision is distinct from old.export_content_revision+1 then
   raise exception using errcode='23514',message='export content revision is trigger-owned';end if;
 end if;
 return new;
end $$;
revoke all on function private.guard_export_content_revision_v1()
 from public,anon,authenticated,service_role,inherit_upload_only;

-- Every actual statement touches each old/new file once, in stable row-lock
-- order. It never reads plaintext genetic columns. Cascades may already have
-- removed the file: the UPDATE then touches zero rows and cannot revive it.
create function private.advance_export_content_revision_v1() returns trigger
 language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare ids uuid[];file uuid;
begin
 if tg_table_schema<>'public' or tg_table_name not in('user_variants','report_observed_calls') then
  raise exception using errcode='42501',message='export content mutation unavailable';end if;
 if tg_op='INSERT' then
  select array_agg(file_id order by file_id) into ids from(select distinct file_id from new_content_rows)x;
 elsif tg_op='UPDATE' then
  select array_agg(file_id order by file_id) into ids from(
   select file_id from new_content_rows union select file_id from old_content_rows)x;
 elsif tg_op='DELETE' then
  select array_agg(file_id order by file_id) into ids from(select distinct file_id from old_content_rows)x;
 elsif tg_op='TRUNCATE' then
  -- Privileged maintenance is tracked as well. API roles have no TRUNCATE
  -- privilege; there is no public maintenance door.
  if tg_table_name='user_variants' then
   select array_agg(file_id order by file_id) into ids from(select distinct file_id from public.user_variants)x;
  else
   select array_agg(file_id order by file_id) into ids from(select distinct file_id from public.report_observed_calls)x;
  end if;
 else raise exception using errcode='42501',message='export content mutation unavailable';end if;
 foreach file in array coalesce(ids,'{}'::uuid[]) loop
  update public.genome_files set export_content_revision=export_content_revision+1 where id=file;
 end loop;
 return null;
end $$;
revoke all on function private.advance_export_content_revision_v1()
 from public,anon,authenticated,service_role,inherit_upload_only;
create trigger export_content_revision_insert before insert on public.genome_files
 for each row execute function private.guard_export_content_revision_v1();
create trigger export_content_revision_update before update of export_content_revision on public.genome_files
 for each row execute function private.guard_export_content_revision_v1();
create trigger export_variant_content_insert after insert on public.user_variants
 referencing new table as new_content_rows for each statement execute function private.advance_export_content_revision_v1();
create trigger export_variant_content_update after update on public.user_variants
 referencing old table as old_content_rows new table as new_content_rows
 for each statement execute function private.advance_export_content_revision_v1();
create trigger export_variant_content_delete after delete on public.user_variants
 referencing old table as old_content_rows for each statement execute function private.advance_export_content_revision_v1();
create trigger export_variant_content_truncate before truncate on public.user_variants
 for each statement execute function private.advance_export_content_revision_v1();
create trigger export_observed_content_insert after insert on public.report_observed_calls
 referencing new table as new_content_rows for each statement execute function private.advance_export_content_revision_v1();
create trigger export_observed_content_update after update on public.report_observed_calls
 referencing old table as old_content_rows new table as new_content_rows
 for each statement execute function private.advance_export_content_revision_v1();
create trigger export_observed_content_delete after delete on public.report_observed_calls
 referencing old table as old_content_rows for each statement execute function private.advance_export_content_revision_v1();
create trigger export_observed_content_truncate before truncate on public.report_observed_calls
 for each statement execute function private.advance_export_content_revision_v1();
revoke truncate on public.user_variants,public.report_observed_calls
 from public,anon,authenticated,service_role,inherit_upload_only;

-- Preserve the original whole-request unsupported/non-current graph refusals.
-- The exact metadata and monotonic content frame supplements that authority;
-- it cannot convert a missing source or permission into a valid one.
alter function private.export_account_owned_capture_v1(jsonb,text,uuid)
 rename to export_account_owned_capture_pre_member_frame_v1;
create function private.export_account_owned_capture_v1(p_origin jsonb,p_target_kind text,p_target_id uuid)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare capture jsonb;account uuid;subjects uuid[];frame jsonb;receipt text;
begin
 capture:=private.export_account_owned_capture_pre_member_frame_v1(p_origin,p_target_kind,p_target_id);
 account:=(p_origin->>'accountId')::uuid;
 select array_agg(x::uuid order by x) into subjects from jsonb_array_elements_text(capture#>'{authority,subjectPartitions}')x;
 frame:=jsonb_build_object('version','owned-account-complete-member-frame-v1','capture',capture,
  'profile',(select to_jsonb(p) from public.profiles p where id=account),
  'demographics',(select coalesce(jsonb_agg(to_jsonb(d) order by subject_id),'[]') from public.subject_demographics d where subject_id=any(subjects)),
  'ownPurposeGrants',(select coalesce(jsonb_agg(to_jsonb(g) order by grant_id),'[]') from public.purpose_grants g
    join public.consent_signatures s on s.id=g.signature_id where g.target_kind='subject' and g.target_id=any(subjects) and s.signer_account_id=account),
  'fileContentRevisions',(select coalesce(jsonb_agg(jsonb_build_object('fileId',id,'revision',export_content_revision) order by id),'[]')
    from public.genome_files where subject_id=any(subjects)));
 receipt:=encode(extensions.digest(frame::text,'sha256'),'hex');
 return jsonb_set(capture,'{authority,authorityReceipt}',to_jsonb(receipt));
end $$;
revoke all on function private.export_account_owned_capture_v1(jsonb,text,uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;
revoke all on function private.export_account_owned_capture_pre_member_frame_v1(jsonb,text,uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;
create or replace function private.export_archive_account_authority_v1(p_origin jsonb,p_target_kind text,p_target_id uuid)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
begin
 return private.export_account_owned_capture_v1(p_origin,p_target_kind,p_target_id)->'authority';
end $$;
revoke all on function private.export_archive_account_authority_v1(jsonb,text,uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;

-- Internal worker metadata only. Neither the origin nor the selected files
-- may be supplied by a caller. Count scans happen only at bounded preparation,
-- not during every subsequent source check; the file clock pins their content.
create function public.export_archive_account_metadata_v1(p_operation text,p_export_id uuid,p_attempt_id uuid,
 p_authority_receipt text,p_after_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare permit jsonb;capture jsonb;result jsonb;subjects uuid[];account uuid;page jsonb;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception using errcode='42501',message='not_found';end if;
 if p_operation is null or p_operation not in('context','profile','purpose-grants','legacy-counts')
  or (p_operation in('context','profile') and p_after_id is not null) then
  raise exception using errcode='22023',message='invalid_request';end if;
 permit:=private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt);
 if permit->>'targetKind' is distinct from 'account' then raise exception using errcode='42501',message='not_found';end if;
 capture:=private.export_account_owned_capture_v1(permit->'origin','account',(permit->>'targetId')::uuid);
 if capture#>'{authority,subjectPartitions}' is distinct from permit->'partitions' then
  raise exception using errcode='42501',message='not_found';end if;
 account:=(permit#>>'{origin,accountId}')::uuid;
 select array_agg(x::uuid order by x) into subjects from jsonb_array_elements_text(permit->'partitions')x;
 if p_operation='context' then
  page:=jsonb_build_array(jsonb_build_object('profileCount',(select count(*) from public.profiles where id=account),
   'purposeGrantCount',(select count(*) from public.purpose_grants g join public.consent_signatures s on s.id=g.signature_id
    where s.signer_account_id=account and g.target_kind='subject' and g.target_id=any(subjects)),
   'fileCount',(select count(*) from public.genome_files f join public.subjects s on s.id=f.subject_id
    where s.id=any(subjects) and s.subject_class in('self','other_adult'))));
 elsif p_operation='profile' then
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'date_of_birth',date_of_birth,'jurisdiction_code',jurisdiction_code,
   'jurisdiction_subdivision',jurisdiction_subdivision,'jurisdiction_revision',jurisdiction_revision,
   'jurisdiction_declared_at',jurisdiction_declared_at,'jurisdiction_attestation_version',jurisdiction_attestation_version,
   'jurisdiction_attestation_sha256',jurisdiction_attestation_sha256)),'[]') into page from public.profiles where id=account;
 elsif p_operation='purpose-grants' then
  select coalesce(jsonb_agg(x.row order by x.id),'[]') into page from(
   select g.grant_id id,jsonb_build_object('grant_id',g.grant_id,'grant_revision',g.grant_revision,'target_kind',g.target_kind,
    'target_id',g.target_id,'purpose',g.purpose,'artifact_key',g.artifact_key,'artifact_version',g.artifact_version,
    'artifact_body_sha256',g.artifact_body_sha256,'signature_id',g.signature_id,'signer_principal_id',g.signer_principal_id,
    'data_subject_principal_id',g.data_subject_principal_id,'subject_binding_revision',g.subject_binding_revision,
    'jurisdiction_code',g.jurisdiction_code,'jurisdiction_revision',g.jurisdiction_revision,'granted_at',g.granted_at,
    'expires_at',g.expires_at,'revoked_at',g.revoked_at,'revocation_reason',g.revocation_reason)row
   from public.purpose_grants g join public.consent_signatures s on s.id=g.signature_id
   where s.signer_account_id=account and g.target_kind='subject' and g.target_id=any(subjects)
    and (p_after_id is null or g.grant_id>p_after_id) order by g.grant_id limit 500)x;
 else
  select coalesce(jsonb_agg(x.row order by x.id),'[]') into page from(
   select f.id,jsonb_build_object('fileId',f.id,'subjectId',f.subject_id,'revision',f.export_content_revision,
    'variantCount',(select count(*) from public.user_variants v where v.file_id=f.id),
    'observedCallCount',(select count(*) from public.report_observed_calls o where o.file_id=f.id))row
   from public.genome_files f join public.subjects s on s.id=f.subject_id
   where s.id=any(subjects) and s.subject_class in('self','other_adult') and (p_after_id is null or f.id>p_after_id)
    order by f.id limit 100)x;
 end if;
 result:=jsonb_build_object('version','account-archive-metadata-v1','operation',p_operation,'rows',page);
 if private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt) is distinct from permit
  or private.export_account_owned_capture_v1(permit->'origin','account',(permit->>'targetId')::uuid) is distinct from capture then
  raise exception using errcode='42501',message='not_found';end if;
 return result;
end $$;
revoke all on function public.export_archive_account_metadata_v1(text,uuid,uuid,text,uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.export_archive_account_metadata_v1(text,uuid,uuid,text,uuid) to service_role;
