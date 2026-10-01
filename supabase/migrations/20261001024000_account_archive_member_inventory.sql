-- TEST-LOCAL complete consumed-account inventory prerequisite. It supplies
-- independent metadata membership/count receipts; it authorizes no caller
-- scope, source descriptor, analytical grant, new store or READY/public door.
-- The original exact unsupported graph refusals remain until their actual
-- non-self/cohort/joint projectors are implemented.
create function private.export_account_history_projection_v1(p_account uuid,p_subjects uuid[],p_kind text)
returns table(projected_id uuid,projected_row jsonb) language plpgsql security definer
 set search_path='' set lock_timeout='250ms' as $$
begin
 if p_kind='legacy-consents' then
  return query select x.id,x.row from(
    select c.id,jsonb_build_object('id',c.id,'provider_key',c.provider_key,'data_classes',c.data_classes,
     'granted_at',c.granted_at,'revoked_at',c.revoked_at) as row from public.consent_grants c
    where c.user_id=p_account  order by c.id
  )x order by x.id;
 elsif p_kind='subjects' then
  return query select x.id,x.row from(
    select s.id,jsonb_build_object('id',s.id,'subject_class',s.subject_class,'upload_class',s.upload_class,
     'display_label',s.display_label,'lifecycle',s.lifecycle,'subject_binding_revision',s.subject_binding_revision,
     'lifecycle_revision',s.lifecycle_revision,'created_at',s.created_at,'updated_at',s.updated_at,
     'portrait_acknowledged_at',s.portrait_acknowledged_at,'independent_login_at',s.independent_login_at) as row
    from public.subjects s where s.id=any(p_subjects)  order by s.id
  )x order by x.id;
 elsif p_kind='demographics' then
  return query select x.id,x.row from(
    select d.subject_id as id,jsonb_build_object('subject_id',d.subject_id,'date_of_birth',d.date_of_birth,
     'chromosomal_sex',d.chromosomal_sex,'demographics_revision',d.demographics_revision,'updated_at',d.updated_at) as row
    from public.subject_demographics d where d.subject_id=any(p_subjects)
      order by d.subject_id
  )x order by x.id;
 elsif p_kind='principals' then
  return query select x.id,x.row from(
    select p.id,jsonb_build_object('id',p.id,'subject_id',p.subject_id,'principal_kind',p.principal_kind,
     'principal_revision',p.principal_revision,'status',p.status,'created_at',p.created_at) as row
    from public.subject_principals p where p.account_id=p_account

      order by p.id
  )x order by x.id;
 elsif p_kind='bindings' then
  return query select x.id,x.row from(
    select b.id,jsonb_build_object('id',b.id,'subject_id',b.subject_id,'subject_principal_id',b.subject_principal_id,
     'account_principal_id',b.account_principal_id,'binding_kind',b.binding_kind,'binding_revision',b.binding_revision,
     'status',b.status,'bound_at',b.bound_at,'ended_at',b.ended_at) as row
    from public.subject_account_bindings b where b.account_id=p_account

      order by b.id
  )x order by x.id;
 elsif p_kind='account-consents' then
  return query select x.id,x.row from(
    select c.id,jsonb_build_object('id',c.id,'signature_id',c.signature_id,'subject_id',c.subject_id,'cohort_id',c.cohort_id,
     'consent_type',c.consent_type,'scope',c.scope,'provider_key',c.provider_key,'grant_revision',c.grant_revision,
     'granted_at',c.granted_at,'expires_at',c.expires_at,'revoked_at',c.revoked_at,'revocation_reason',c.revocation_reason,
     -- Destination history is the person's consent record. Credential and
     -- runtime-transport fingerprints are withheld internal authority fields.
     'copilot_recipient',case when c.copilot_recipient is null then null else jsonb_build_object(
      'providerLabel',c.copilot_recipient->'providerLabel','origin',c.copilot_recipient->'origin',
      'revision',c.copilot_recipient->'revision','providerClass',c.copilot_recipient->'providerClass',
      'baseUrl',c.copilot_recipient->'baseUrl','provider',c.copilot_recipient->'provider','model',c.copilot_recipient->'model')end) as row
    from public.subject_consents c where c.account_id=p_account

      order by c.id
  )x order by x.id;
 elsif p_kind='signatures' then
  return query select x.id,x.row from(
    select g.id,jsonb_build_object('id',g.id,'artifact_key',g.artifact_key,'artifact_version',g.artifact_version,
     'artifact_body_sha256',g.artifact_body_sha256,'signer_principal_id',g.signer_principal_id,'target_kind',g.target_kind,
     'target_id',g.target_id,'purpose',g.purpose,'statement_keys',g.statement_keys,'jurisdiction_code',g.jurisdiction_code,
     'jurisdiction_revision',g.jurisdiction_revision,'subject_binding_revision',g.subject_binding_revision,
     'signed_at',g.signed_at) as row
    from public.consent_signatures g where g.signer_account_id=p_account

      order by g.id
  )x order by x.id;
 elsif p_kind='attestations' then
  return query select x.id,x.row from(
    select t.id,jsonb_build_object('id',t.id,'signature_id',t.signature_id,'principal_id',t.principal_id,
     'target_kind',t.target_kind,'target_id',t.target_id,'kind',t.kind,'statement_keys',t.statement_keys,
     'affirmed',t.affirmed,'attestation_revision',t.attestation_revision,'affirmed_at',t.affirmed_at) as row
    from public.attestations t where (t.principal_id in(select id from public.subject_principals where account_id=p_account)
      or t.signature_id in(select id from public.consent_signatures where signer_account_id=p_account))

      order by t.id
  )x order by x.id;
 elsif p_kind='recipient-grants' then
  return query select x.id,x.row from(
    select g.id,jsonb_build_object('id',g.id,'recipient_principal_id',g.recipient_principal_id,'provider_id',g.provider_id,
     'purpose',g.purpose,'artifact_key',g.artifact_key,'artifact_version',g.artifact_version,'grant_revision',g.grant_revision,
     'model_recipient_revision',g.model_recipient_revision,'status',g.status,'created_at',g.created_at,'ended_at',g.ended_at) as row
    from public.provider_recipient_grants g where g.account_id=p_account
      order by g.id
  )x order by x.id;
 else raise exception using errcode='22023',message='invalid_request';end if;
end $$;
revoke all on function private.export_account_history_projection_v1(uuid,uuid[],text)
 from public,anon,authenticated,service_role,inherit_upload_only;

-- Hash the exact named projection in stable UUID order. No genetic-call
-- plaintext is scanned: its separate per-file statement revision remains.
-- Canonical row text crosses only the service reader and never the archive.
create function private.export_account_history_inventory_v1(p_account uuid,p_subjects uuid[])
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare kind text;item record;digest bytea;n bigint;out jsonb:='[]';
begin
 foreach kind in array array['legacy-consents','subjects','demographics','principals','bindings',
  'account-consents','signatures','attestations','recipient-grants'] loop
  digest:=extensions.digest(convert_to('account-history-members-v1|'||kind,'UTF8'),'sha256');n:=0;
  for item in select * from private.export_account_history_projection_v1(p_account,p_subjects,kind) loop
   digest:=extensions.digest(digest||convert_to(item.projected_id::text||':'||item.projected_row::text||E'\n','UTF8'),'sha256');n:=n+1;
   if n>9007199254740991 then raise exception using errcode='55000',message='export_member_inventory_unavailable';end if;
  end loop;
  out:=out||jsonb_build_array(jsonb_build_object('kind',kind,'rows',n,'membershipSha256',encode(digest,'hex')));
 end loop;
 return out;
end $$;
revoke all on function private.export_account_history_inventory_v1(uuid,uuid[])
 from public,anon,authenticated,service_role,inherit_upload_only;

-- Existing jobs cannot be adopted into a new member frame. A subject-only
-- source retains its original scope; only the real account capture adds this
-- account history receipt. The old helper keeps its strict original refusals.
alter function private.export_account_owned_capture_v1(jsonb,text,uuid)
 rename to export_account_owned_capture_pre_inventory_v1;
create function private.export_account_owned_capture_v1(p_origin jsonb,p_target_kind text,p_target_id uuid)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare capture jsonb;inventory jsonb;subjects uuid[];receipt text;
begin
 capture:=private.export_account_owned_capture_pre_inventory_v1(p_origin,p_target_kind,p_target_id);
 if p_target_kind<>'account' then return capture;end if;
 select array_agg(x::uuid order by x) into subjects from jsonb_array_elements_text(capture#>'{authority,subjectPartitions}')x;
 inventory:=private.export_account_history_inventory_v1((p_origin->>'accountId')::uuid,subjects);
 receipt:=encode(extensions.digest(jsonb_build_object('version','account-history-members-v1',
  'capture',capture,'memberInventory',inventory)::text,'sha256'),'hex');
 return jsonb_set(capture,'{authority,authorityReceipt}',to_jsonb(receipt))||jsonb_build_object('memberInventory',inventory);
end $$;
revoke all on function private.export_account_owned_capture_v1(jsonb,text,uuid),
 private.export_account_owned_capture_pre_inventory_v1(jsonb,text,uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;

create function public.export_archive_account_inventory_v1(p_operation text,p_export_id uuid,p_attempt_id uuid,
 p_authority_receipt text,p_kind text default null,p_after_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare permit jsonb;capture jsonb;subjects uuid[];result jsonb;rows jsonb;last_id uuid;n integer;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception using errcode='42501',message='not_found';end if;
 if p_operation is null or p_operation not in('context','history')
  or (p_operation='context' and (p_kind is not null or p_after_id is not null))
  or (p_operation='history' and (p_kind is null or p_kind not in('legacy-consents','subjects','demographics',
   'principals','bindings','account-consents','signatures','attestations','recipient-grants'))) then
  raise exception using errcode='22023',message='invalid_request';end if;
 permit:=private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt);
 if permit->>'targetKind' is distinct from 'account' then raise exception using errcode='42501',message='not_found';end if;
 capture:=private.export_account_owned_capture_v1(permit->'origin','account',(permit->>'targetId')::uuid);
 if capture#>'{authority,subjectPartitions}' is distinct from permit->'partitions' then
  raise exception using errcode='42501',message='not_found';end if;
 select array_agg(x::uuid order by x) into subjects from jsonb_array_elements_text(permit->'partitions')x;
 if p_operation='context' then
  result:=jsonb_build_object('version','account-history-inventory-v1','authorityReceipt',p_authority_receipt,
   'classes',capture->'memberInventory');
 else
  select coalesce(jsonb_agg(x.row order by x.id),'[]'),count(*),max(x.id::text)::uuid into rows,n,last_id from(
   select projected_id id,jsonb_build_object('id',projected_id,'rowText',projected_row::text)row
   from private.export_account_history_projection_v1((permit#>>'{origin,accountId}')::uuid,subjects,p_kind)
   where p_after_id is null or projected_id>p_after_id order by projected_id limit 500)x;
  result:=jsonb_build_object('version','account-history-page-v1','kind',p_kind,'rows',rows,
   'nextAfterId',case when n=500 then to_jsonb(last_id) else 'null'::jsonb end);
 end if;
 if private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt) is distinct from permit
  or private.export_account_owned_capture_v1(permit->'origin','account',(permit->>'targetId')::uuid) is distinct from capture then
  raise exception using errcode='42501',message='not_found';end if;
 return result;
end $$;
revoke all on function public.export_archive_account_inventory_v1(text,uuid,uuid,text,text,uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.export_archive_account_inventory_v1(text,uuid,uuid,text,text,uuid) to service_role;
