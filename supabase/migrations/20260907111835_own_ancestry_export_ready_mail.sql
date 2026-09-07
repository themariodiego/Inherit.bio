-- Depends on canonical own ancestry generation. No backfill, sends or workers.
-- Preserve queued own-report-ready-v1 events and their immutable 30-day expiry.
-- The existing insert/claim/pre-submit hooks share the version-aware resolver.

create function private.own_report_ready_state_v2(p_account_id uuid,p_file_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare f public.genome_files%rowtype; v_purpose text; a jsonb; selections jsonb:='{}';
begin
 select * into f from public.genome_files where id=p_file_id and user_id=p_account_id;
 if f.id is null or f.single_logical_sample_verified_at is null or exists(
  select 1 from private.genome_file_deletions where file_id=f.id) then return null; end if;
 for v_purpose in select pg.purpose from public.purpose_grants pg
  join public.directional_grants dg on dg.grant_id=pg.grant_id and dg.grant_revision=pg.grant_revision
  where pg.target_kind='subject' and pg.target_id=f.subject_id
   and pg.purpose in ('reports.monogenic','reports.polygenic','ancestry') and pg.revoked_at is null
   and (pg.expires_at is null or pg.expires_at>clock_timestamp())
   and dg.status='current' and dg.direction='self' and dg.recipient_account_id=p_account_id
  order by pg.purpose loop
  a:=private.current_own_report_grant_mail_v1(p_account_id,p_file_id,v_purpose);
  if private.own_analysis_completion_matches_v1(p_file_id,v_purpose,a) is not true or not exists(
   select 1 from private.own_analysis_runs r where r.file_id=f.id and r.subject_id=f.subject_id and r.account_id=p_account_id
    and r.purpose=v_purpose and r.state='complete' and r.source_revision=f.upload_revision
    and r.source_sha256=f.sha256 and r.normalization_completed_at=f.normalization_completed_at) then return null; end if;
  a:=jsonb_set(a,'{context}',(a->'context')-array['authSessionRevision','originatingSessionRevision']);
  selections:=selections||jsonb_build_object(v_purpose,a);
 end loop;
 if not(selections ? 'ancestry') then return null; end if;
 perform 1 from auth.users where id=p_account_id and email_confirmed_at is not null and nullif(trim(email),'') is not null;
 if not found then return null; end if;
 return jsonb_build_object('version','own-report-ready-v2','accountId',p_account_id,'fileId',f.id,
  'subjectId',f.subject_id,'computationRevisions',(select jsonb_object_agg(k,case k when 'ancestry' then 'own-ancestry-v1' else 'own-reports-v1' end) from jsonb_object_keys(selections) k),'purposes',selections,
  'recipientContactRevision',(select mail_contact_revision from public.profiles where id=p_account_id));
exception when insufficient_privilege or object_not_in_prerequisite_state then return null;
end; $$;
revoke all on function private.own_report_ready_state_v2(uuid,uuid) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.own_report_ready_state_v2(uuid,uuid) to service_role;

create or replace function private.file_ready_mail_current_v1(m public.mail_outbox)
returns boolean language plpgsql security definer set search_path=pg_catalog,private as $$
declare f public.genome_files%rowtype; sp public.subject_principals%rowtype; ready jsonb;
begin
 if m.template_id is null then return false; end if;
 if m.template_id<>'report-ready' then return true; end if;
 if m.target_kind is distinct from 'genome_file' then return false; end if;
 select * into f from public.genome_files where id=m.target_id;
 select * into sp from public.subject_principals where id=m.recipient_principal_id;
 if f.id is null or sp.id is null or sp.status is distinct from 'active' or sp.principal_kind is distinct from 'account_subject'
  or sp.principal_revision is distinct from m.recipient_authority_revision
  or f.user_id is distinct from sp.account_id or f.subject_id is distinct from sp.subject_id
  or exists(select 1 from private.genome_file_deletions where file_id=f.id) then return false; end if;
 if f.single_logical_sample_verified_at is null then
  return (m.canonical_readiness is null and f.status='annotated') is true;
 end if;
 ready:=case m.canonical_readiness->>'version'
  when 'own-report-ready-v1' then private.own_report_ready_state_v1(sp.account_id,f.id)
  when 'own-report-ready-v2' then private.own_report_ready_state_v2(sp.account_id,f.id)
  else null end;
 return (ready is not null and ready=m.canonical_readiness) is true;
end; $$;
revoke all on function private.file_ready_mail_current_v1(public.mail_outbox) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.file_ready_mail_current_v1(public.mail_outbox) to service_role;

create or replace function private.enqueue_own_report_ready_v1(p_account_id uuid,p_file_id uuid,p_envelope jsonb)
returns uuid language plpgsql security definer set search_path=pg_catalog,private as $$
declare ready jsonb; principal public.subject_principals%rowtype; contact uuid; outbox uuid; key text;
 v_now timestamptz:=clock_timestamp(); v_expiry timestamptz:=v_now+interval '30 days';
begin
 if jsonb_typeof(p_envelope) is distinct from 'object' or not(p_envelope ?& array['contactCiphertext','contactHmac','dashboardUrl','contactRevision'])
  or p_envelope-array['contactCiphertext','contactHmac','dashboardUrl','contactRevision']<>'{}'::jsonb
  or coalesce(p_envelope->>'contactRevision','')!~'^[1-9][0-9]{0,15}$'
  or length(p_envelope->>'contactCiphertext') not between 60 and 4096
  or coalesce(p_envelope->>'contactCiphertext','')!~'^[0-9a-f]+$'
  or length(p_envelope->>'contactCiphertext')%2<>0
  or coalesce(p_envelope->>'contactHmac','')!~'^[0-9a-f]{64}$'
  or coalesce(p_envelope->>'dashboardUrl','')!~'^https?://[^/@?#]+/genome/me/reports$' then
  raise exception using errcode='22023',message='invalid_ready_envelope'; end if;
 -- Match existing generation order: Auth row, then profile, then source/grants
 -- and outbox. Never acquire an Auth/profile lock while holding an outbox claim.
 perform 1 from auth.users where id=p_account_id and deleted_at is null and email_confirmed_at is not null for share;
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 perform 1 from public.profiles where id=p_account_id
  and mail_contact_revision=(p_envelope->>'contactRevision')::bigint for share;
 if not found then raise exception using errcode='42501',message='recipient_authority_stale'; end if;
 -- Version is part of the hashed event identity. Report-only sets retain v1;
 -- ancestry-selected sets cannot enqueue until every selected purpose is ready.
 if exists(select 1 from public.purpose_grants pg
  join public.directional_grants dg on dg.grant_id=pg.grant_id and dg.grant_revision=pg.grant_revision
  join public.genome_files f on f.subject_id=pg.target_id
  where f.id=p_file_id and f.user_id=p_account_id and pg.target_kind='subject' and pg.purpose='ancestry'
   and pg.revoked_at is null and (pg.expires_at is null or pg.expires_at>clock_timestamp())
   and dg.status='current' and dg.direction='self' and dg.recipient_account_id=p_account_id) then
  ready:=private.own_report_ready_state_v2(p_account_id,p_file_id);
 else
  ready:=private.own_report_ready_state_v1(p_account_id,p_file_id);
 end if;
 if ready is null then return null; end if;
 key:=encode(extensions.digest(convert_to(ready::text,'UTF8'),'sha256'),'hex');
 select id into outbox from public.mail_outbox where idempotency_key=key;
 if outbox is not null then return outbox; end if;
 select sp.* into principal from public.subject_principals sp
  join public.subject_account_bindings b on b.subject_principal_id=sp.id and b.status='current'
  where sp.subject_id=(ready->>'subjectId')::uuid and sp.account_id=p_account_id
   and sp.principal_kind='account_subject' and sp.status='active' and b.account_id=p_account_id for share of sp,b;
 if principal.id is null then raise exception using errcode='42501',message='not_found'; end if;
 select e.id into contact from public.encrypted_contact_references e
  where e.principal_id=principal.id and e.contact_hmac=p_envelope->>'contactHmac' and e.status='current'
   and e.authority_revision=principal.principal_revision and e.contact_ciphertext is not null
  order by e.created_at desc limit 1 for update;
 if contact is null then
  update public.encrypted_contact_references set status='rotated',ended_at=v_now where principal_id=principal.id and status='current';
  insert into public.encrypted_contact_references(principal_id,contact_ciphertext,contact_hmac,key_revision,authority_revision,status)
   values(principal.id,decode(p_envelope->>'contactCiphertext','hex'),p_envelope->>'contactHmac',1,principal.principal_revision,'current') returning id into contact;
  insert into public.contact_hmac_indexes(contact_reference_id,contact_hmac,hmac_key_revision,status,expires_at)
   values(contact,p_envelope->>'contactHmac',1,'current',v_expiry);
 end if;
 insert into public.mail_outbox(template_id,purpose,target_kind,target_id,recipient_principal_id,contact_reference_id,
  recipient_authority_revision,semantic_revision,idempotency_key,template_payload,expires_at,canonical_readiness)
 values('report-ready','report.ready','genome_file',p_file_id,principal.id,contact,principal.principal_revision,1,key,
  jsonb_build_object('reportCount',0,'dashboardUrl',p_envelope->>'dashboardUrl'),v_expiry,ready)
 on conflict(idempotency_key) do nothing returning id into outbox;
 if outbox is null then select id into outbox from public.mail_outbox where idempotency_key=key; end if;
 return outbox;
end; $$;
revoke all on function private.enqueue_own_report_ready_v1(uuid,uuid,jsonb) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.enqueue_own_report_ready_v1(uuid,uuid,jsonb) to service_role;

create or replace function public.own_report_generation_with_mail_v1(p_operation text,p_account_id uuid,p_session_id uuid,
 p_file_id uuid,p_purpose text,p_claim uuid default null,p_payload jsonb default null)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare result jsonb; outbox uuid;
begin
 if p_operation='ready' then
  if (p_purpose in ('reports.monogenic','reports.polygenic','ancestry')) is not true then
   raise exception using errcode='22023',message='invalid_request'; end if;
  perform private.current_own_report_grant_v1(p_account_id,p_session_id,p_file_id,p_purpose);
  if p_claim is not null then raise exception using errcode='22023',message='invalid_request'; end if;
  outbox:=private.enqueue_own_report_ready_v1(p_account_id,p_file_id,p_payload);
  if outbox is null then raise exception using errcode='55000',message='reports_not_ready'; end if;
  return 'true'::jsonb;
 elsif p_operation='complete' then
  if jsonb_typeof(p_payload) is distinct from 'object' or not(p_payload ? 'readyMail') then
   raise exception using errcode='22023',message='invalid_ready_envelope'; end if;
  result:=private.own_report_generation_v1(p_operation,p_account_id,p_session_id,p_file_id,p_purpose,p_claim,p_payload-'readyMail');
  perform private.enqueue_own_report_ready_v1(p_account_id,p_file_id,p_payload->'readyMail');
  return result;
 end if;
 return private.own_report_generation_v1(p_operation,p_account_id,p_session_id,p_file_id,p_purpose,p_claim,p_payload);
end; $$;
revoke all on function public.own_report_generation_with_mail_v1(text,uuid,uuid,uuid,text,uuid,jsonb) from public,anon,authenticated,inherit_upload_only;
grant execute on function public.own_report_generation_with_mail_v1(text,uuid,uuid,uuid,text,uuid,jsonb) to service_role;

create or replace function private.own_subject_export_content_v1(p_operation text,p_account_id uuid,p_session_id uuid,
 p_file_id uuid,p_snapshot jsonb,p_offset integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare snapshot jsonb; result jsonb; f public.genome_files%rowtype; ancestry_authority jsonb;
begin
 if p_operation is null or p_operation not in ('list','check','variants','observed','reports','prs','ancestry')
  or p_offset is null or p_offset<0 then raise exception using errcode='22023',message='invalid_request'; end if;
 if p_operation='list' then
  if p_file_id is not null or p_snapshot is not null then raise exception using errcode='22023',message='invalid_request'; end if;
  -- Validate the account even when it has no files. Null source returns null.
  perform private.own_export_source_v1(p_account_id,p_session_id,null);
  -- Apply pagination before aggregating snapshots, not to an all-account JSON value.
  select coalesce(jsonb_agg(page.snapshot order by page.id),'[]') into result from (
   select x.id,x.snapshot from (
    select gf.id,private.own_export_source_v1(p_account_id,p_session_id,gf.id) snapshot
    from public.genome_files gf join public.subjects s on s.id=gf.subject_id
    where s.subject_account_id=p_account_id and gf.single_logical_sample_verified_at is not null
   ) x where x.snapshot is not null order by x.id offset p_offset limit 100
  ) page;
  return result;
 end if;
 snapshot:=private.own_export_source_v1(p_account_id,p_session_id,p_file_id);
 if snapshot is null or snapshot is distinct from p_snapshot then raise exception using errcode='42501',message='not_found'; end if;
 if p_operation='check' then return snapshot; end if;
 if not (snapshot->>'normalized')::boolean then return '[]'; end if;
 select * into f from public.genome_files where id=p_file_id;
 if p_operation='variants' then
  select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from (select v.rsid,v.chrom,v.pos,v.ref,v.alt,v.genotype
   from public.user_variants v where v.file_id=f.id and v.subject_id=f.subject_id and v.user_id=f.user_id
   order by v.id offset p_offset limit 1000) x;
 elsif p_operation='observed' then
  select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from (select v.source_line,v.source_sha256,v.source_build,
   v.source_chrom,v.source_pos,v.source_ref,v.source_alt,v.source_gt,v.rsid,v.chrom,v.pos,
   v.ref,v.alt,v.genotype,v.quality_state,v.usable
   from public.report_observed_calls v where v.file_id=f.id and v.subject_id=f.subject_id and v.user_id=f.user_id
    and v.source_sha256=f.sha256 and v.source_build=f.build and v.extraction_version='vcf-literal-diploid-snp-v1'
   order by v.source_line offset p_offset limit 1000) x;
 elsif p_operation='ancestry' then
  -- Raw export authority alone never reveals a canonical ancestry result.
  -- Missing/revoked analysis permission leaves raw source export usable.
  begin
   ancestry_authority:=private.current_own_report_grant_read_v1(p_account_id,p_session_id,f.id,'ancestry');
  exception when insufficient_privilege or object_not_in_prerequisite_state then return '[]'::jsonb;
  end;
  if private.own_analysis_completion_matches_v1(f.id,'ancestry',ancestry_authority) is not true then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into result from (
   select r.purpose,r.completed_at,ancestry_authority->>'grantId' as grant_id,
    (ancestry_authority->>'grantRevision')::bigint as grant_revision,r.result->'ancestry' as result
   from private.own_analysis_runs r where r.file_id=f.id and r.subject_id=f.subject_id and r.account_id=p_account_id
    and r.purpose='ancestry' and r.state='complete' and r.completed_at is not null
    and r.computation_revision='own-ancestry-v1' and r.source_revision=f.upload_revision
    and r.source_sha256=f.sha256 and r.normalization_completed_at=f.normalization_completed_at
   order by r.id offset p_offset limit 1000) x;
  if private.own_export_source_v1(p_account_id,p_session_id,p_file_id) is distinct from snapshot
   or private.current_own_report_grant_read_v1(p_account_id,p_session_id,f.id,'ancestry') is distinct from ancestry_authority
   or private.own_analysis_completion_matches_v1(f.id,'ancestry',ancestry_authority) is not true then
   raise exception using errcode='42501',message='not_found'; end if;
 else
  -- The own right can retrieve existing results; it cannot make or refresh any.
  -- Old subject-binding results remain inaccessible after an account claim.
  with completed as (select r.* from private.own_analysis_runs r where r.file_id=f.id and r.subject_id=f.subject_id
   and r.state='complete' and r.completed_at is not null and r.computation_revision='own-reports-v1'
   and r.source_revision=f.upload_revision and r.source_sha256=f.sha256
   and r.normalization_completed_at=f.normalization_completed_at
   and r.authority->'context'->'subjectBindingRevision'=snapshot->'binding'->'subjectBindingRevision')
  select case when p_operation='reports' then
   (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select r.purpose,r.completed_at,report.value as report
    from completed r cross join lateral jsonb_array_elements(r.result->'reports') with ordinality report(value,ordinality)
    where r.purpose in ('reports.monogenic','reports.polygenic') order by r.purpose,report.ordinality offset p_offset limit 1000) x)
   else (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select v.pgs_id,v.matched,v.computed_at,
    m.name,m.trait,m.ancestry_note,m.n_variants from public.user_prs v left join public.prs_scores m using(pgs_id)
    where v.file_id=f.id and v.subject_id=f.subject_id and v.user_id=f.user_id
     and exists(select 1 from completed r where r.purpose='reports.polygenic')
    order by v.id offset p_offset limit 1000) x) end into result;
 end if;
 return result;
end; $$;
revoke all on function private.own_subject_export_content_v1(text,uuid,uuid,uuid,jsonb,integer) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.own_subject_export_content_v1(text,uuid,uuid,uuid,jsonb,integer) to service_role;
