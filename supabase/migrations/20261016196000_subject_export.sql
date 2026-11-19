-- =====================================================================
-- PRODUCTION RELEASE: GUARDED. This migration is applied to local and CI
-- databases only. It must reach a hosted database through the guarded
-- production release (preflight, postflight, receipt), never as a side
-- effect of a merge.
-- =====================================================================
--
-- api.subject-export (POST/GET /api/subjects/[id]/export), owner decision
-- of 16 October 2026 ("Subject export with joint results: built in two
-- steps", docs/protocol/decisions.md): the one-subject export ships first,
-- on the account producer, and refuses with a stated reason while the
-- subject has live joint results. A later slice adds the live-permission
-- joint-result projection and lifts that refusal; nothing here builds it.
--
--   1. Scope. The route subject is the caller's self record, or an adult
--      record whose subject_account_id is the caller (the register's
--      self-or-adult case, actorRole route-subject.subject_account_id),
--      active or restricted. public.subject_export_request_v1 admits only
--      that case and hands it to the unchanged request door
--      (export_archive_request_v1, target 'subject'), so the job carries the
--      api.subject-export route and the subject-export-v1 contract the
--      request door already records. A claimed embryo, an unclaimed or
--      parent-controlled embryo, another person's record and an unknown id
--      all answer 42501, which the route returns as resource-not-found-v1.
--      The claimed-bound subject capture itself is unchanged.
--   2. Refusal. While the subject has live joint results (a family pair
--      that is not purged, a Portrait result naming it as a parent, or a
--      role in an embryo cohort that is not purged), its authority raises
--      0A000 'export_joint_results_pending'. The authority is recomputed by
--      every request step and every worker read
--      (private.export_archive_current_v1), so joint results that appear
--      after the request fail the job too. Any other cohort role (a purged
--      cohort's history) is refused as the whole-account export already
--      refuses it: 0A000 export_partition_projection_unavailable.
--   3. Capture. The owned capture chain, which already accepted target
--      'subject' at its member frame, now continues for one ordinary subject
--      instead of returning early: the subject's own history inventory
--      (no account-level legacy consents or recipient grants, as the
--      subject receipt has always recorded), its own original frames, its
--      own Path B results, a readable graph anchored on the subject that
--      routes only its own pair history, its own class inventory (the same
--      29 kinds and modes; every count is the subject's own), and its own
--      statements. A Path B subject is captured through its confirmation
--      receipt for a subject target as it already was for the account.
--   4. Doors. The nine member doors the account producer reads (content,
--      metadata, history inventory, classes, originals, both graph pages,
--      Path B results and own statements) accept the permit of one ordinary
--      subject job and capture that target. The audit door stays account
--      only: an audit event records no subject, so a subject export cannot
--      select its own events, and the worker writes that stated reason in
--      place of the log. The audit schema is unchanged. The complete-capture
--      door stays account only: a subject job never reads it.
--   5. Worker and TEST R2. export_archive_subject_due_v1 lists queued
--      ordinary subject jobs; the account due reader is unchanged. The TEST
--      R2 write, completion, READY, delivery, cleanup and disposal
--      functions and the publication guard admit an ordinary subject job
--      through one closed predicate, private.account_archive_job_scope_v1.
--      Nothing here calls a provider; the TEST R2 step itself runs only in
--      provider-qualified CI.
--
-- Every new function is private or service-role only. No existing
-- migration, table, column, audit event or grant changes.

-- The one ordinary subject a subject export may take: the caller's own self
-- record or an adult record whose subject_account_id is the caller.
create function private.export_subject_ordinary_target_v1(p_account uuid, p_subject uuid)
returns boolean language plpgsql stable security definer set search_path = ''
as $function$
begin
 return p_account is not null and p_subject is not null and exists(select 1 from public.subjects s
  where s.id=p_subject and s.subject_account_id=p_account and s.subject_class in('self','other_adult')
   and s.lifecycle in('active','restricted'));
end $function$;
revoke all on function private.export_subject_ordinary_target_v1(uuid, uuid)
 from public, anon, authenticated, inherit_upload_only, service_role;

-- Any role of this subject in an embryo cohort, through one of its own
-- principals, whatever the cohort's status.
create function private.export_subject_cohort_role_v1(p_subject uuid)
returns boolean language plpgsql stable security definer set search_path = ''
as $function$
begin
 return exists(select 1 from public.embryo_participant_sets ps join public.subject_principals sp on sp.id=ps.principal_id
   where sp.subject_id=p_subject)
  or exists(select 1 from public.embryo_donor_attributions d join public.subject_principals sp on sp.id=d.donor_principal_id
   where sp.subject_id=p_subject)
  or exists(select 1 from public.embryo_disposition_proposals p join public.subject_principals sp on sp.id=p.proposer_principal_id
   where sp.subject_id=p_subject)
  or exists(select 1 from public.embryo_disposition_confirmations c join public.subject_principals sp on sp.id=c.confirmer_principal_id
   where sp.subject_id=p_subject);
end $function$;
revoke all on function private.export_subject_cohort_role_v1(uuid)
 from public, anon, authenticated, inherit_upload_only, service_role;

-- Live joint results: results computed from this subject together with
-- another contributor that still exist. A pair counts until it is purged,
-- as the whole-account export already counts it.
create function private.export_subject_joint_results_v1(p_subject uuid)
returns boolean language plpgsql stable security definer set search_path = ''
as $function$
begin
 return exists(select 1 from public.family_pairs p where p.status<>'purged' and p_subject in(p.subject_a_id,p.subject_b_id))
  or exists(select 1 from public.portrait_results r where p_subject in(r.parent_a_subject_id,r.parent_b_subject_id))
  or exists(select 1 from public.embryo_cohorts c where c.status<>'purged' and (
   exists(select 1 from public.embryo_participant_sets ps join public.subject_principals sp on sp.id=ps.principal_id
    where ps.cohort_id=c.id and sp.subject_id=p_subject)
   or exists(select 1 from public.embryo_donor_attributions d join public.subject_principals sp on sp.id=d.donor_principal_id
    where d.cohort_id=c.id and sp.subject_id=p_subject)));
end $function$;
revoke all on function private.export_subject_joint_results_v1(uuid)
 from public, anon, authenticated, inherit_upload_only, service_role;

-- The subject export's scope and its one stated refusal. 42501 for anything
-- that is not this caller's ordinary subject; 0A000
-- export_joint_results_pending while joint results are live.
create function private.export_subject_scope_v1(p_origin jsonb, p_subject uuid)
returns void language plpgsql stable security definer set search_path = ''
as $function$
declare a uuid;s public.subjects;
begin
 if jsonb_typeof(p_origin) is distinct from 'object' or p_origin->>'kind' is distinct from 'account'
  or coalesce(p_origin->>'accountId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or p_subject is null then
  raise exception using errcode='42501',message='not_found';end if;
 a:=(p_origin->>'accountId')::uuid;
 select * into s from public.subjects where id=p_subject;
 if s.id is null or s.subject_account_id is distinct from a then raise exception using errcode='42501',message='not_found';end if;
 -- The account's own non-adult or inactive record keeps the refusal the
 -- subject capture has always given it.
 if s.subject_class not in('self','other_adult') or s.lifecycle not in('active','restricted') then
  raise exception using errcode='0A000',message='export_partition_projection_unavailable';end if;
 if private.export_subject_joint_results_v1(s.id) then
  raise exception using errcode='0A000',message='export_joint_results_pending';end if;
 if private.export_subject_cohort_role_v1(s.id) then
  raise exception using errcode='0A000',message='export_partition_projection_unavailable';end if;
end $function$;
revoke all on function private.export_subject_scope_v1(jsonb, uuid)
 from public, anon, authenticated, inherit_upload_only, service_role;

-- True when a capture for target 'subject' is exactly one ordinary partition,
-- that subject. A claimed-bound subject capture is never this case.
create function private.export_capture_ordinary_subject_v1(p_target_kind text, p_target_id uuid, p_capture jsonb)
returns boolean language plpgsql immutable security definer set search_path = ''
as $function$
begin
 return p_target_kind='subject' and p_target_id is not null and jsonb_typeof(p_capture->'partitions')='array'
  and jsonb_array_length(p_capture->'partitions')=1 and p_capture#>>'{partitions,0,class}'='ordinary'
  and p_capture#>>'{partitions,0,subjectId}'=p_target_id::text
  and p_capture#>'{authority,subjectPartitions}'=jsonb_build_array(p_target_id);
end $function$;
revoke all on function private.export_capture_ordinary_subject_v1(text, uuid, jsonb)
 from public, anon, authenticated, inherit_upload_only, service_role;

-- History rows of one ordinary subject: its record and demographics, and
-- the principals, bindings, consents, signatures and attestations that name
-- it. Account-level legacy consents and recipient grants are not a subject's
-- (subject-export-v1 alwaysExcluded: unrelated-account-legacy-consents).
create function private.export_subject_history_projection_v1(p_account uuid, p_subjects uuid[], p_kind text)
returns table(projected_id uuid, projected_row jsonb) language plpgsql stable security definer set search_path = ''
set lock_timeout = '250ms'
as $function$
begin
 if p_account is null or cardinality(p_subjects) is distinct from 1 or p_subjects[1] is null then
  raise exception using errcode='42501',message='not_found';end if;
 if p_kind in('legacy-consents','recipient-grants') then return;
 elsif p_kind in('subjects','demographics') then
  return query select x.projected_id,x.projected_row from private.export_account_history_projection_v1(p_account,p_subjects,p_kind)x;
 elsif p_kind in('principals','bindings','account-consents') then
  return query select x.projected_id,x.projected_row from private.export_account_history_projection_v1(p_account,p_subjects,p_kind)x
   where x.projected_row->>'subject_id'=p_subjects[1]::text;
 elsif p_kind in('signatures','attestations') then
  return query select x.projected_id,x.projected_row from private.export_account_history_projection_v1(p_account,p_subjects,p_kind)x
   where x.projected_row->>'target_kind'='subject' and x.projected_row->>'target_id'=p_subjects[1]::text;
 else raise exception using errcode='22023',message='invalid_request';end if;
end $function$;
revoke all on function private.export_subject_history_projection_v1(uuid, uuid[], text)
 from public, anon, authenticated, inherit_upload_only, service_role;

-- Metadata class rows of one ordinary subject: only rows whose projected
-- subject is that subject. Account-level rows (no subject) are not its.
create function private.export_subject_class_projection_v1(p_account uuid, p_subjects uuid[], p_kind text)
returns table(projected_id uuid, projected_subject uuid, projected_row jsonb) language plpgsql stable security definer
set search_path = '' set lock_timeout = '250ms'
as $function$
begin
 if p_account is null or cardinality(p_subjects) is distinct from 1 or p_subjects[1] is null then
  raise exception using errcode='42501',message='not_found';end if;
 return query select x.projected_id,x.projected_subject,x.projected_row
  from private.export_account_class_projection_v1(p_account,p_subjects,p_kind)x where x.projected_subject=p_subjects[1];
end $function$;
revoke all on function private.export_subject_class_projection_v1(uuid, uuid[], text)
 from public, anon, authenticated, inherit_upload_only, service_role;

-- Graph rows of one ordinary subject: its own pair history. A subject with
-- any cohort role is refused before capture, so no cohort row is its.
create function private.export_subject_graph_projection_v1(p_account uuid, p_subjects uuid[], p_kind text)
returns table(projected_key jsonb, projected_row jsonb) language plpgsql stable security definer
set search_path = '' set lock_timeout = '250ms'
as $function$
begin
 if p_account is null or cardinality(p_subjects) is distinct from 1 or p_subjects[1] is null then
  raise exception using errcode='42501',message='not_found';end if;
 if p_kind='family_pairs' then
  return query select x.projected_key,x.projected_row from private.export_account_graph_projection_v1(p_account,p_subjects,p_kind)x;
 elsif p_kind in('embryo_cohorts','embryo_basis_bindings','embryo_participant_sets','embryo_donor_attributions',
  'embryo_disposition_proposals','embryo_disposition_confirmations') then return;
 else raise exception using errcode='22023',message='invalid_request';end if;
end $function$;
revoke all on function private.export_subject_graph_projection_v1(uuid, uuid[], text)
 from public, anon, authenticated, inherit_upload_only, service_role;

-- The doors' projection for a permit's target kind.
create function private.export_scoped_history_projection_v1(p_target_kind text, p_account uuid, p_subjects uuid[], p_kind text)
returns table(projected_id uuid, projected_row jsonb) language plpgsql stable security definer
set search_path = '' set lock_timeout = '250ms'
as $function$
begin
 if p_target_kind='account' then
  return query select x.projected_id,x.projected_row from private.export_account_history_projection_v1(p_account,p_subjects,p_kind)x;
 elsif p_target_kind='subject' then
  return query select x.projected_id,x.projected_row from private.export_subject_history_projection_v1(p_account,p_subjects,p_kind)x;
 else raise exception using errcode='42501',message='not_found';end if;
end $function$;
revoke all on function private.export_scoped_history_projection_v1(text, uuid, uuid[], text)
 from public, anon, authenticated, inherit_upload_only, service_role;

create function private.export_scoped_class_projection_v1(p_target_kind text, p_account uuid, p_subjects uuid[], p_kind text)
returns table(projected_id uuid, projected_subject uuid, projected_row jsonb) language plpgsql stable security definer
set search_path = '' set lock_timeout = '250ms'
as $function$
begin
 if p_target_kind='account' then
  return query select x.projected_id,x.projected_subject,x.projected_row from private.export_account_class_projection_v1(p_account,p_subjects,p_kind)x;
 elsif p_target_kind='subject' then
  return query select x.projected_id,x.projected_subject,x.projected_row from private.export_subject_class_projection_v1(p_account,p_subjects,p_kind)x;
 else raise exception using errcode='42501',message='not_found';end if;
end $function$;
revoke all on function private.export_scoped_class_projection_v1(text, uuid, uuid[], text)
 from public, anon, authenticated, inherit_upload_only, service_role;

create function private.export_scoped_graph_projection_v1(p_target_kind text, p_account uuid, p_subjects uuid[], p_kind text)
returns table(projected_key jsonb, projected_row jsonb) language plpgsql stable security definer
set search_path = '' set lock_timeout = '250ms'
as $function$
begin
 if p_target_kind='account' then
  return query select x.projected_key,x.projected_row from private.export_account_graph_projection_v1(p_account,p_subjects,p_kind)x;
 elsif p_target_kind='subject' then
  return query select x.projected_key,x.projected_row from private.export_subject_graph_projection_v1(p_account,p_subjects,p_kind)x;
 else raise exception using errcode='42501',message='not_found';end if;
end $function$;
revoke all on function private.export_scoped_graph_projection_v1(text, uuid, uuid[], text)
 from public, anon, authenticated, inherit_upload_only, service_role;

-- A member door's permit: the whole account, exactly as before, or one
-- ordinary subject job whose permit partitions are that subject. Anything
-- else, including a claimed-bound subject job, is refused here.
create function private.export_account_door_scope_v1(p_permit jsonb)
returns text language plpgsql stable security definer set search_path = ''
as $function$
begin
 if p_permit->>'targetKind'='account' then return 'account';end if;
 if p_permit->>'targetKind'='subject' and jsonb_typeof(p_permit->'partitions')='array'
  and p_permit->'partitions'=jsonb_build_array(p_permit->'targetId')
  and private.export_subject_ordinary_target_v1((p_permit#>>'{origin,accountId}')::uuid,(p_permit->>'targetId')::uuid) then
  return 'subject';end if;
 raise exception using errcode='42501',message='not_found';
end $function$;
revoke all on function private.export_account_door_scope_v1(jsonb)
 from public, anon, authenticated, inherit_upload_only, service_role;

-- The closed TEST R2 job predicate: the account job exactly as the R2
-- functions admitted it, or an ordinary subject job of the same account.
create function private.account_archive_job_scope_v1(p_job private.export_archive_jobs, p_export public.generated_exports)
returns boolean language plpgsql stable security definer set search_path = ''
as $function$
begin
 if p_job.export_id is null or p_export.id is distinct from p_job.export_id
  or p_job.origin->>'kind' is distinct from 'account' or p_job.origin->>'accountId' is distinct from p_export.account_id::text then
  return false;end if;
 if p_job.export_contract='account-export-v1' then
  return p_job.route_id='api.export' and p_export.export_kind='account_portable'
   and p_export.target_kind='account' and p_export.target_id is not distinct from p_export.account_id;end if;
 return p_job.export_contract='subject-export-v1' and p_job.route_id='api.subject-export'
  and p_export.target_kind='subject' and p_export.export_kind='subject_raw'
  and private.export_subject_ordinary_target_v1(p_export.account_id,p_export.target_id);
end $function$;
revoke all on function private.account_archive_job_scope_v1(private.export_archive_jobs, public.generated_exports)
 from public, anon, authenticated, inherit_upload_only, service_role;

-- Authority: an ordinary subject target now takes the owned capture, after
-- its scope check, with the subject's own lifecycle revision. The account
-- and claimed-bound branches are unchanged.
CREATE OR REPLACE FUNCTION private.export_archive_account_authority_v1(p_origin jsonb, p_target_kind text, p_target_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
 SET lock_timeout TO '250ms'
AS $function$
begin
 if p_target_kind='account' then return private.export_account_owned_capture_v1(p_origin,p_target_kind,p_target_id)->'authority';end if;
 if not exists(select 1 from public.subjects where subject_account_id=(p_origin->>'accountId')::uuid
  and subject_class='embryo' and lifecycle='claimed_bound' and id=p_target_id) then
  perform private.export_subject_scope_v1(p_origin,p_target_id);
  return (private.export_account_owned_capture_v1(p_origin,'subject',p_target_id)->'authority')
   ||jsonb_build_object('lifecycleRevision',(select lifecycle_revision from public.subjects where id=p_target_id));end if;
 return private.export_account_owned_capture_v1(p_origin,p_target_kind,p_target_id)->'authority';
end $function$;

-- The route's request door: only the register's self-or-adult case reaches
-- the unchanged request door. Every other route subject is 42501.
create function public.subject_export_request_v1(p_operation text, p_origin jsonb, p_subject_id uuid,
 p_payload jsonb default null, p_csrf_binding text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
begin
 if jsonb_typeof(p_origin) is distinct from 'object' or p_origin->>'kind' is distinct from 'account'
  or coalesce(p_origin->>'accountId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or not private.export_subject_ordinary_target_v1((p_origin->>'accountId')::uuid,p_subject_id) then
  raise exception using errcode='42501',message='not_found';end if;
 return public.export_archive_request_v1(p_operation,p_origin,'subject',p_subject_id,p_payload,p_csrf_binding);
end $function$;
revoke all on function public.subject_export_request_v1(text, jsonb, uuid, jsonb, text)
 from public, anon, authenticated, inherit_upload_only;
grant execute on function public.subject_export_request_v1(text, jsonb, uuid, jsonb, text) to service_role;

-- The subject worker's due reader: queued ordinary subject jobs only, with
-- the same origin and deadline rules as the account due reader.
create function public.export_archive_subject_due_v1(p_after uuid default null)
returns jsonb language plpgsql security definer set search_path = 'pg_catalog' set lock_timeout = '250ms'
as $function$
declare result jsonb;
begin
 if current_setting('role',true) is distinct from 'service_role'
  or auth.jwt()->>'role' is distinct from 'service_role' then
  raise exception using errcode='42501',message='not_found';
 end if;
 select coalesce(jsonb_agg(to_jsonb(page) order by "exportId"),'[]'::jsonb) into result from(
  select j.export_id as "exportId",j.authority_receipt as "authorityReceipt",j.principal_hash as "principalHash",
   j.deadline-interval '30 seconds' as "deadline"
  from private.export_archive_jobs j join public.generated_exports e on e.id=j.export_id
  where e.status='queued' and e.origin_kind='account' and e.target_kind='subject'
   and e.export_kind='subject_raw' and e.purpose='raw.export' and e.archive_version='archive-segments-v1'
   and j.route_id='api.subject-export' and j.export_contract='subject-export-v1'
   and jsonb_typeof(j.origin)='object' and (select count(*) from jsonb_object_keys(j.origin))=3
   and j.origin ?& array['kind','accountId','sessionId'] and j.origin->>'kind'='account'
   and j.origin->>'accountId'=e.account_id::text
   and private.export_subject_ordinary_target_v1(e.account_id,e.target_id)
   and coalesce(j.origin->>'sessionId','')~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   and j.active_attempt is null and j.deadline>clock_timestamp()+interval '1 minute'
   and (p_after is null or j.export_id>p_after)
  order by j.export_id limit 16
 )page;
 return result;
end $function$;
revoke all on function public.export_archive_subject_due_v1(uuid) from public, anon, authenticated, inherit_upload_only;
grant execute on function public.export_archive_subject_due_v1(uuid) to service_role;

-- ---------------------------------------------------------------------
-- Subject-scope copies of the account inventories and graph capture.
-- ---------------------------------------------------------------------
-- The history inventory of one ordinary subject: the same nine kinds, digests and format, over the subject projection.
CREATE OR REPLACE FUNCTION private.export_subject_history_inventory_v1(p_account uuid, p_subjects uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '250ms'
AS $function$
declare kind text;item record;digest bytea;n bigint;out jsonb:='[]';
begin
 foreach kind in array array['legacy-consents','subjects','demographics','principals','bindings',
  'account-consents','signatures','attestations','recipient-grants'] loop
  digest:=extensions.digest(convert_to('account-history-members-v1|'||kind,'UTF8'),'sha256');n:=0;
  for item in select * from private.export_subject_history_projection_v1(p_account,p_subjects,kind) loop
   digest:=extensions.digest(digest||convert_to(item.projected_id::text||':'||item.projected_row::text||E'\n','UTF8'),'sha256');n:=n+1;
   if n>9007199254740991 then raise exception using errcode='55000',message='export_member_inventory_unavailable';end if;
  end loop;
  out:=out||jsonb_build_array(jsonb_build_object('kind',kind,'rows',n,'membershipSha256',encode(digest,'hex')));
 end loop;
 return out;
end $function$;

-- The readable graph of one ordinary subject: the subject is the anchor, and only its own pair history is routed.
CREATE OR REPLACE FUNCTION private.export_subject_graph_capture_v1(p_account uuid, p_capture jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '250ms'
AS $function$
declare subjects uuid[];anchor uuid;kind text;item record;identity text;digest bytea;n bigint;inventory jsonb:='[]';
begin
 select array_agg(x::uuid order by x) into subjects from jsonb_array_elements_text(p_capture#>'{authority,subjectPartitions}')x;
 select s.id into anchor from public.subjects s where cardinality(subjects)=1 and s.id=any(subjects) and s.subject_class in('self','other_adult')
  and s.subject_account_id=p_account and s.lifecycle in('active','restricted') for share nowait;
 if anchor is null then raise exception using errcode='42501',message='not_found';end if;
 -- One subject's export has no cohort partition at all. Its scope check has
 -- already refused any cohort role of this subject; this repeats it here so
 -- the graph can never be captured around one.
 if private.export_subject_cohort_role_v1(anchor) then
  raise exception using errcode='0A000',message='export_partition_projection_unavailable';end if;
 foreach kind in array array['embryo_cohorts','embryo_basis_bindings','embryo_participant_sets','embryo_donor_attributions',
  'embryo_disposition_proposals','embryo_disposition_confirmations','family_pairs'] loop
  digest:=extensions.digest(convert_to('account-graph-routed-v2|'||kind,'UTF8'),'sha256');n:=0;
  for item in select * from private.export_subject_graph_projection_v1(p_account,subjects,kind)
   order by (projected_key->>0) collate "C",coalesce(projected_key->>1,'') collate "C",
    coalesce(projected_key->>2,'') collate "C",coalesce((projected_key->>3)::bigint,0) loop
   identity:=private.export_account_graph_cursor_v1(kind,item.projected_key);
   if octet_length(item.projected_row::text)>8192 then raise exception using errcode='55000',message='export_class_projection_unavailable';end if;
   n:=n+1;if n>9007199254740991 then raise exception using errcode='55000',message='export_class_projection_unavailable';end if;
   digest:=extensions.digest(digest||convert_to(identity||':'||anchor::text||':requester-account-history:'||item.projected_row::text||E'\n','UTF8'),'sha256');
  end loop;
  inventory:=inventory||jsonb_build_array(jsonb_build_object('kind',kind,'rows',n,'membershipSha256',encode(digest,'hex'),
   'partitions',case when n=0 then '[]'::jsonb else jsonb_build_array(jsonb_build_object('subjectId',anchor,'rows',n)) end));
 end loop;
 return jsonb_build_object('anchorSubjectId',anchor,'inventory',inventory,
  'pairSourceFrame',(select coalesce(jsonb_agg(to_jsonb(fp) order by fp.id),'[]') from public.family_pairs fp
   where fp.subject_a_id=any(subjects) or fp.subject_b_id=any(subjects)));
end $function$;

-- The class inventory of one ordinary subject: the same 29 kinds and modes; every count and row is the subject's own.
CREATE OR REPLACE FUNCTION private.export_subject_class_inventory_v1(p_account uuid, p_capture jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '250ms'
AS $function$
declare subjects uuid[];cohorts uuid[];kind text;handling text;item record;n bigint;digest bytea;counts jsonb;out jsonb:='[]';
 scientific_frame jsonb;ordinary uuid[];requester_frame jsonb;
begin
 select array_agg(x::uuid order by x) into subjects from jsonb_array_elements_text(p_capture#>'{authority,subjectPartitions}')x;
 select array_agg((x->>'subjectId')::uuid order by x->>'subjectId') into ordinary from jsonb_array_elements(p_capture->'partitions')x
  where x->>'class'='ordinary';
 if cardinality(subjects) is distinct from 1 or cardinality(ordinary) is distinct from 1 or subjects[1] is distinct from ordinary[1] then
  raise exception using errcode='42501',message='not_found';end if;
 select array_agg(id order by id) into cohorts from(select s.cohort_id id from public.embryo_participant_sets s join public.subject_principals p on p.id=s.principal_id where p.subject_id=any(subjects)
  union select d.cohort_id from public.embryo_donor_attributions d join public.subject_principals p on p.id=d.donor_principal_id where p.subject_id=any(subjects))x;
 scientific_frame:=(select coalesce(jsonb_agg(x->'capture' order by x->>'subjectId'),'[]') from jsonb_array_elements(p_capture->'partitions')x
  where x->>'class'='claimed-bound');
 foreach kind in array array['ancestry_regions','appeal_intakes','attestation_contradictions','correction_requests','directional_grants',
  'embryo_basis_bindings','embryo_cohorts','embryo_disposition_confirmations','embryo_disposition_proposals','embryo_donor_attributions',
  'embryo_figures','embryo_participant_sets','embryo_qc','embryo_scores','embryo_variants','embryos','family_pairs','family_sharing_pauses',
  'family_sharing_stops','future_person_claim_objections','future_person_claimant_principals','future_person_claims','portrait_results',
  'report_artifacts','subject_control_refusal_authorities','subject_relationships','suppressions','other_adult_held_uploads','path_b_report_bindings'] loop
  n:=0;counts:='[]';digest:=extensions.digest(convert_to('account-class-members-v1|'||kind,'UTF8'),'sha256');
  if kind in('attestation_contradictions','directional_grants','family_sharing_pauses','family_sharing_stops','future_person_claim_objections',
   'future_person_claimant_principals','future_person_claims','subject_control_refusal_authorities','subject_relationships','suppressions') then
   handling:='metadata';
   for item in select * from private.export_subject_class_projection_v1(p_account,subjects,kind) loop
    if octet_length(item.projected_row::text)>8192 then raise exception using errcode='55000',message='export_class_projection_unavailable';end if;
    n:=n+1;digest:=extensions.digest(digest||convert_to(item.projected_id::text||':'||coalesce(item.projected_subject::text,'')||':'||item.projected_row::text||E'\n','UTF8'),'sha256');
   end loop;
   select coalesce(jsonb_agg(jsonb_build_object('subjectId',x.subject,'rows',x.n) order by x.subject),'[]') into counts from(
    select projected_subject subject,count(*) n from private.export_subject_class_projection_v1(p_account,subjects,kind)
    where projected_subject is not null group by projected_subject)x;
  elsif kind in('embryo_figures','embryo_qc','embryo_scores','embryo_variants','embryos','report_artifacts') then
   handling:='claimed-bound';
   -- Original bound capture already independently validates full source,
   -- immutable calls and exact complete QC/finding/figure/report membership.
   -- Parent-cohort files and ordinary arbitrary artifact payloads are refused.
   if exists(select 1 from public.embryos e where e.subject_id=any(ordinary))
    or (kind='report_artifacts' and exists(select 1 from public.report_artifacts r where r.subject_id=any(ordinary) or r.cohort_id=any(cohorts))) then
    raise exception using errcode='0A000',message='export_class_projection_unavailable';end if;
   for item in select x->>'subjectId' subject,x->'capture' snapshot from jsonb_array_elements(p_capture->'partitions')x where x->>'class'='claimed-bound' loop
    n:=case kind when 'embryos' then 1 when 'embryo_qc' then (item.snapshot#>>'{membership,qualityReports}')::bigint
     when 'embryo_scores' then (item.snapshot#>>'{membership,scores}')::bigint when 'embryo_figures' then (item.snapshot#>>'{membership,figures}')::bigint
     when 'embryo_variants' then (item.snapshot#>>'{membership,variants}')::bigint when 'report_artifacts' then (item.snapshot#>>'{membership,reports}')::bigint end;
    if n>0 then counts:=counts||jsonb_build_array(jsonb_build_object('subjectId',item.subject,'rows',n));end if;
   end loop;
   select coalesce(sum((x->>'rows')::bigint),0) into n from jsonb_array_elements(counts)x;
   digest:=extensions.digest(convert_to('account-class-members-v1|'||kind||'|'||scientific_frame::text,'UTF8'),'sha256');
  elsif kind in('embryo_basis_bindings','embryo_cohorts','embryo_disposition_confirmations','embryo_disposition_proposals',
   'embryo_donor_attributions','embryo_participant_sets','family_pairs') then
   handling:='graph';
   select (x->>'rows')::bigint,decode(x->>'membershipSha256','hex'),x->'partitions' into n,digest,counts
    from jsonb_array_elements(p_capture#>'{readableGraph,inventory}')x where x->>'kind'=kind;
   if n is null or digest is null or counts is null then raise exception using errcode='55000',message='export_class_projection_unavailable';end if;
  elsif kind='path_b_report_bindings' then
   handling:='path-b-results';
   for item in select x->>'id' id,x->>'subjectId' subject,x->>'rowText' row_text
    from jsonb_array_elements(p_capture->'pathBResults')s cross join lateral jsonb_array_elements(s->'records')x
    order by (x->>'id') collate "C" loop
    n:=n+1;digest:=extensions.digest(digest||convert_to(item.id||':'||item.subject||':'||item.row_text||E'\n','UTF8'),'sha256');
   end loop;
   select coalesce(jsonb_agg(jsonb_build_object('subjectId',x->'subjectId','rows',x->'rows') order by x->>'subjectId'),'[]') into counts
    from jsonb_array_elements(p_capture->'pathBResults')x where (x->>'rows')::bigint>0;
   -- Exact recipient-scoped internal bindings have a registered result-only
   -- subject projection. Other recipients' grants/results are not borrowed.
   if n<>(select count(*) from private.path_b_report_bindings b where b.recipient_account_id=p_account and b.subject_id=any(subjects)) then
    raise exception using errcode='0A000',message='export_result_projection_unavailable';end if;
  elsif kind='other_adult_held_uploads' then
   handling:='excluded';
   select count(*) into n from public.other_adult_held_uploads h where h.subject_id=any(subjects);
   if n<>coalesce((select sum((x->>'excludedHeldUploads')::bigint) from jsonb_array_elements(p_capture->'pathBResults')x),0) then
    raise exception using errcode='0A000',message='export_result_projection_unavailable';end if;
   digest:=extensions.digest(convert_to('account-excluded-held-objects-v1|'||coalesce((select jsonb_agg(to_jsonb(h) order by h.id)
    from public.other_adult_held_uploads h where h.subject_id=any(subjects)),'[]')::text,'UTF8'),'sha256');
  elsif kind in('correction_requests','appeal_intakes') then
   handling:='requester-statements';
   requester_frame:=private.export_account_own_statement_capture_v1(p_account,p_capture)->'classes'->kind;
   n:=(requester_frame->>'rows')::bigint;digest:=decode(requester_frame->>'membershipSha256','hex');counts:=requester_frame->'partitions';
  else
   handling:='unsupported';
   case kind
    when 'ancestry_regions' then select count(*) into n from public.ancestry_regions where subject_id=any(subjects);
    when 'appeal_intakes' then select count(*) into n from public.appeal_intakes where appellant_account_id=p_account or appellant_principal_id in(select id from public.subject_principals where account_id=p_account);
    when 'correction_requests' then select count(*) into n from public.correction_requests where subject_id=any(subjects) or claimant_principal_id in(select id from public.subject_principals where account_id=p_account);
    when 'embryo_basis_bindings' then select count(*) into n from public.embryo_basis_bindings where cohort_id=any(cohorts);
    when 'embryo_cohorts' then n:=coalesce(cardinality(cohorts),0);
    when 'embryo_disposition_confirmations' then select count(*) into n from public.embryo_disposition_confirmations c join public.embryo_disposition_proposals p on p.id=c.proposal_id join public.embryos e on e.id=p.embryo_id where e.cohort_id=any(cohorts) or c.confirmer_principal_id in(select id from public.subject_principals where account_id=p_account);
    when 'embryo_disposition_proposals' then select count(*) into n from public.embryo_disposition_proposals p join public.embryos e on e.id=p.embryo_id where e.cohort_id=any(cohorts) or p.proposer_principal_id in(select id from public.subject_principals where account_id=p_account);
    when 'embryo_donor_attributions' then select count(*) into n from public.embryo_donor_attributions where cohort_id=any(cohorts) or donor_principal_id in(select id from public.subject_principals where account_id=p_account);
    when 'embryo_participant_sets' then select count(*) into n from public.embryo_participant_sets where cohort_id=any(cohorts) or principal_id in(select id from public.subject_principals where account_id=p_account);
    when 'family_pairs' then select count(*) into n from public.family_pairs where subject_a_id=any(subjects) or subject_b_id=any(subjects);
    when 'portrait_results' then select count(*) into n from public.portrait_results where parent_a_subject_id=any(subjects) or parent_b_subject_id=any(subjects);
    when 'other_adult_held_uploads' then select count(*) into n from public.other_adult_held_uploads where subject_id=any(subjects);
    when 'path_b_report_bindings' then select count(*) into n from private.path_b_report_bindings where subject_id=any(subjects);
    else raise exception using errcode='22023',message='invalid_request';
   end case;
   if n<>0 then raise exception using errcode='0A000',message='export_class_projection_unavailable';end if;
  end if;
  if n is null or n<0 or n>9007199254740991 then raise exception using errcode='55000',message='export_class_projection_unavailable';end if;
  out:=out||jsonb_build_array(jsonb_build_object('kind',kind,'mode',handling,'rows',n,'membershipSha256',encode(digest,'hex'),'partitions',counts));
 end loop;
 return out;
end $function$;
revoke all on function private.export_subject_history_inventory_v1(uuid, uuid[])
 from public, anon, authenticated, inherit_upload_only, service_role;
revoke all on function private.export_subject_graph_capture_v1(uuid, jsonb)
 from public, anon, authenticated, inherit_upload_only, service_role;
revoke all on function private.export_subject_class_inventory_v1(uuid, jsonb)
 from public, anon, authenticated, inherit_upload_only, service_role;

-- ---------------------------------------------------------------------
-- The owned capture chain, continued for one ordinary subject.
-- ---------------------------------------------------------------------
-- Member frame: a Path B subject is captured through its own confirmation receipt whether the target is the account or that subject.
CREATE OR REPLACE FUNCTION private.export_account_owned_capture_pre_member_frame_v1(p_origin jsonb, p_target_kind text, p_target_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
 SET lock_timeout TO '250ms'
AS $function$
declare a uuid;s record;current_part jsonb;base jsonb;parts jsonb:='[]';ids jsonb:='[]';
 frame jsonb;files bigint:=0;receipt text;
begin
 if jsonb_typeof(p_origin) is distinct from 'object' or p_origin->>'kind' is distinct from 'account'
  or (select count(*) from jsonb_object_keys(p_origin))<>3 or not(p_origin ?& array['kind','accountId','sessionId'])
  or p_target_kind not in('account','subject') or p_target_kind is null or p_target_id is null then
  raise exception using errcode='42501',message='not_found';end if;
 a:=(p_origin->>'accountId')::uuid;
 if p_target_kind='account' then
  if p_target_id<>a then raise exception using errcode='42501',message='not_found';end if;
  if exists(select 1 from public.subjects where owner_account_id=a and lifecycle<>'purged'
    and (subject_account_id is distinct from a or (subject_class not in ('self','other_adult')
      and not(subject_class='embryo' and lifecycle='claimed_bound' and owner_account_id=a))))
   or exists(select 1 from public.subjects where subject_account_id=a and lifecycle<>'purged'
    and subject_class not in ('self','other_adult')
    and not(subject_class='embryo' and lifecycle='claimed_bound' and owner_account_id=a))
   or exists(select 1 from public.embryo_cohorts c where c.status<>'purged' and (c.owner_account_id=a or exists(
    select 1 from public.embryo_participant_sets ps join public.subject_principals sp on sp.id=ps.principal_id
     where ps.cohort_id=c.id and sp.account_id=a and ps.revoked_at is null)))
   or exists(select 1 from public.directional_grants d join public.purpose_grants g using(grant_id)
    join public.subject_principals recipient on recipient.id=d.recipient_principal_id
    where (d.recipient_account_id=a or recipient.account_id=a) and d.status='current' and g.revoked_at is null
      and (g.expires_at is null or g.expires_at>clock_timestamp()) and (g.target_kind<>'subject' or not exists(
       select 1 from public.subjects subj where subj.id=g.target_id and subj.subject_account_id=a and (subj.subject_class in ('self','other_adult') or (subj.subject_class='embryo' and subj.lifecycle='claimed_bound' and subj.owner_account_id=a))))) then
   raise exception using errcode='0A000',message='export_partition_projection_unavailable';
  end if;

 end if;
 for s in select * from public.subjects where subject_account_id=a and lifecycle<>'purged'
  and (p_target_kind='account' or id=p_target_id) order by id for share loop
  if s.subject_class in('self','other_adult') then
   current_part:=case when exists(select 1 from public.genome_files gf
    where gf.subject_id=s.id and private.export_account_path_b_file_v1(gf.id))
    then private.export_account_ordinary_readable_authority_v1(p_origin,'subject',s.id)
    else private.export_archive_ordinary_account_authority_v1(p_origin,'subject',s.id) end;
   parts:=parts||jsonb_build_array(jsonb_build_object('subjectId',s.id,'class','ordinary','capture',current_part));
   files:=files+(current_part->>'fileCount')::bigint;
   if s.subject_class='self' and base is null then base:=current_part;end if;
  elsif s.subject_class='embryo' and s.lifecycle='claimed_bound' and s.owner_account_id=a then
   current_part:=private.future_person_bound_export_snapshot_v1(p_origin,s.id);
   parts:=parts||jsonb_build_array(jsonb_build_object('subjectId',s.id,'class','claimed-bound','capture',current_part));
   files:=files+1;
  else raise exception using errcode='0A000',message='export_partition_projection_unavailable';end if;
  ids:=ids||jsonb_build_array(s.id);
 end loop;
 if jsonb_array_length(parts)=0 then raise exception using errcode='42501',message='not_found';end if;
 -- A genuine current self account principal remains the account origin anchor.
 if base is null then
  select subj.id into s from public.subjects subj where subj.subject_account_id=a and subj.subject_class='self'
   and subj.lifecycle in('active','restricted') order by subj.id limit 1;
  if s.id is null then raise exception using errcode='42501',message='not_found';end if;
  base:=private.export_archive_ordinary_account_authority_v1(p_origin,'subject',s.id);
 end if;
 frame:=jsonb_build_object('version','owned-account-archive-v1','origin',p_origin,'targetKind',p_target_kind,
  'targetId',p_target_id,'partitions',parts,
  'legacyConsents',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from public.consent_grants c where c.user_id=a),
  'providerRecipients',(select coalesce(jsonb_agg(to_jsonb(g) order by g.id),'[]') from public.provider_recipient_grants g where g.account_id=a),
  'principals',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') from public.subject_principals p where p.account_id=a),
  'bindings',(select coalesce(jsonb_agg(to_jsonb(b) order by b.id),'[]') from public.subject_account_bindings b where b.account_id=a),
  'consents',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from public.subject_consents c where c.account_id=a),
  'signatures',(select coalesce(jsonb_agg(to_jsonb(sig) order by sig.id),'[]') from public.consent_signatures sig where sig.signer_account_id=a),
  'attestations',(select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') from public.attestations t
    where t.principal_id in(select id from public.subject_principals where account_id=a)
     or t.signature_id in(select id from public.consent_signatures where signer_account_id=a)),
  'legalAudit',(select coalesce(jsonb_agg(to_jsonb(l) order by l.seq),'[]') from public.legal_audit_log l
    join private.legal_audit_account_principals m on m.audit_principal_id=l.audit_principal_id where m.account_id=a));
 receipt:=encode(extensions.digest(frame::text,'sha256'),'hex');
 return jsonb_build_object('authority',base||jsonb_build_object('authorityReceipt',receipt,'subjectPartitions',ids,'fileCount',files),
  'partitions',parts);
end $function$;

-- History members: an ordinary subject target gets the subject's own history inventory.
CREATE OR REPLACE FUNCTION private.export_account_owned_capture_pre_original_v1(p_origin jsonb, p_target_kind text, p_target_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '250ms'
AS $function$
declare capture jsonb;inventory jsonb;subjects uuid[];receipt text;
begin
 capture:=private.export_account_owned_capture_pre_inventory_v1(p_origin,p_target_kind,p_target_id);
 if p_target_kind<>'account' and not private.export_capture_ordinary_subject_v1(p_target_kind,p_target_id,capture) then return capture;end if;
 select array_agg(x::uuid order by x) into subjects from jsonb_array_elements_text(capture#>'{authority,subjectPartitions}')x;
 inventory:=case when p_target_kind='account' then private.export_account_history_inventory_v1((p_origin->>'accountId')::uuid,subjects)
  else private.export_subject_history_inventory_v1((p_origin->>'accountId')::uuid,subjects) end;
 receipt:=encode(extensions.digest(jsonb_build_object('version','account-history-members-v1',
  'capture',capture,'memberInventory',inventory)::text,'sha256'),'hex');
 return jsonb_set(capture,'{authority,authorityReceipt}',to_jsonb(receipt))||jsonb_build_object('memberInventory',inventory);
end $function$;

-- Original frames: an ordinary subject target frames its own files the same way.
CREATE OR REPLACE FUNCTION private.export_account_owned_capture_pre_readable_graph_v1(p_origin jsonb, p_target_kind text, p_target_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '250ms'
AS $function$
declare captured jsonb;item record;source jsonb;frames jsonb:='[]';receipt text;
begin
 captured:=private.export_account_owned_capture_pre_original_v1(p_origin,p_target_kind,p_target_id);
 if p_target_kind<>'account' and not private.export_capture_ordinary_subject_v1(p_target_kind,p_target_id,captured) then return captured;end if;
 for item in select gf.id from public.genome_files gf where exists(select 1 from jsonb_array_elements(captured->'partitions')x
  where x->>'class'='ordinary' and x->>'subjectId'=gf.subject_id::text)
  and not private.export_account_path_b_file_v1(gf.id) order by gf.id loop
  source:=private.own_export_source_v1((p_origin->>'accountId')::uuid,(p_origin->>'sessionId')::uuid,item.id);
  if source is null then raise exception using errcode='42501',message='not_found';end if;
  frames:=frames||jsonb_build_array(private.export_account_original_frame_v1(item.id,source ? 'preparedSource'));
 end loop;
 receipt:=encode(extensions.digest(jsonb_build_object('version','account-original-frame-v1',
  'capture',captured,'originalFrames',frames)::text,'sha256'),'hex');
 return jsonb_set(captured,'{authority,authorityReceipt}',to_jsonb(receipt))||jsonb_build_object('originalFrames',frames);
end $function$;

-- Results and graph: an ordinary subject target gets its own Path B results and its own graph.
CREATE OR REPLACE FUNCTION private.export_account_owned_capture_pre_classes_v1(p_origin jsonb, p_target_kind text, p_target_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '250ms'
AS $function$
declare captured jsonb;result_sources jsonb:='[]';s record;graph jsonb;receipt text;
begin
 captured:=private.export_account_owned_capture_pre_readable_graph_v1(p_origin,p_target_kind,p_target_id);
 if p_target_kind<>'account' and not private.export_capture_ordinary_subject_v1(p_target_kind,p_target_id,captured) then return captured;end if;
 for s in select sub.id from public.subjects sub where sub.subject_account_id=(p_origin->>'accountId')::uuid
  and sub.lifecycle<>'purged' and sub.subject_class='other_adult' and (p_target_kind='account' or sub.id=p_target_id)
  and exists(select 1 from public.genome_files gf
   where gf.subject_id=sub.id and private.export_account_path_b_file_v1(gf.id)) order by sub.id loop
  result_sources:=result_sources||jsonb_build_array(private.export_account_path_b_snapshot_v1(p_origin,s.id));
  if octet_length(result_sources::text)>4000000 then raise exception using errcode='54000',message='export_result_projection_unavailable';end if;
 end loop;
 graph:=case when p_target_kind='account' then private.export_account_graph_capture_v1((p_origin->>'accountId')::uuid,captured)
  else private.export_subject_graph_capture_v1((p_origin->>'accountId')::uuid,captured) end;
 receipt:=encode(extensions.digest(jsonb_build_object('version','account-readable-graph-capture-v1',
  'capture',captured,'graph',graph,'pathBResults',result_sources)::text,'sha256'),'hex');
 return jsonb_set(captured,'{authority,authorityReceipt}',to_jsonb(receipt))||jsonb_build_object('readableGraph',graph,'pathBResults',result_sources);
end $function$;

-- Class inventory: an ordinary subject target gets the subject's own class inventory.
CREATE OR REPLACE FUNCTION private.export_account_owned_capture_pre_requester_v1(p_origin jsonb, p_target_kind text, p_target_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '250ms'
AS $function$
declare captured jsonb;classes jsonb;receipt text;
begin
 captured:=private.export_account_owned_capture_pre_classes_v1(p_origin,p_target_kind,p_target_id);
 if p_target_kind<>'account' and not private.export_capture_ordinary_subject_v1(p_target_kind,p_target_id,captured) then return captured;end if;
 classes:=case when p_target_kind='account' then private.export_account_class_inventory_v1((p_origin->>'accountId')::uuid,captured)
  else private.export_subject_class_inventory_v1((p_origin->>'accountId')::uuid,captured) end;
 receipt:=encode(extensions.digest(jsonb_build_object('version','account-class-inventory-v1','capture',captured,'classes',classes)::text,'sha256'),'hex');
 return jsonb_set(captured,'{authority,authorityReceipt}',to_jsonb(receipt))||jsonb_build_object('classInventory',classes);
end $function$;

-- Own statements: an ordinary subject target captures the subject's own statements (already subject-restricted).
CREATE OR REPLACE FUNCTION private.export_account_owned_capture_pre_complete_v1(p_origin jsonb, p_target_kind text, p_target_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '250ms'
AS $function$
declare captured jsonb;statements jsonb;receipt text;
begin
 captured:=private.export_account_owned_capture_pre_requester_v1(p_origin,p_target_kind,p_target_id);
 if p_target_kind<>'account' and not private.export_capture_ordinary_subject_v1(p_target_kind,p_target_id,captured) then return captured;end if;
 statements:=private.export_account_own_statement_capture_v1((p_origin->>'accountId')::uuid,captured);
 receipt:=encode(extensions.digest(jsonb_build_object('version','account-requester-statements-v2','capture',captured,'ownStatements',statements)::text,'sha256'),'hex');
 return jsonb_set(captured,'{authority,authorityReceipt}',to_jsonb(receipt))||jsonb_build_object('ownStatements',statements);
end $function$;

-- ---------------------------------------------------------------------
-- Member doors and the TEST R2 / delivery functions.
-- ---------------------------------------------------------------------
-- public.export_archive_account_content_v1: one ordinary subject target as well as the whole account.
CREATE OR REPLACE FUNCTION public.export_archive_account_content_v1(p_operation text, p_export_id uuid, p_attempt_id uuid, p_authority_receipt text, p_payload jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare permit jsonb;capture jsonb;result jsonb;f uuid;subject uuid;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception using errcode='42501',message='not_found';end if;
 if p_operation is null or p_operation not in('history','chats','chat-messages','check','variants','observed','reports','prs','ancestry')
  or jsonb_typeof(p_payload) is distinct from 'object' then raise exception using errcode='22023',message='invalid_request';end if;
 permit:=private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt);
 perform private.export_account_door_scope_v1(permit);
 capture:=private.export_account_owned_capture_v1(permit->'origin',permit->>'targetKind',(permit->>'targetId')::uuid);
 if capture#>'{authority,subjectPartitions}' is distinct from permit->'partitions' then
  raise exception using errcode='42501',message='not_found';end if;
 -- This door composes the existing exact ordinary per-file authority. A genuine
 -- bound source must use its distinct current-location reader and cannot borrow
 -- an ordinary source descriptor or a former uploader's original.
 if p_operation in('check','variants','observed','reports','prs','ancestry') then
  if jsonb_typeof(p_payload->'fileId') is distinct from 'string' then raise exception using errcode='22023',message='invalid_request';end if;
  f:=(p_payload->>'fileId')::uuid;
  select subject_id into subject from public.genome_files where id=f;
  if subject is null or not exists(select 1 from jsonb_array_elements(capture->'partitions') x
   where x->>'subjectId'=subject::text and x->>'class'='ordinary') then
   raise exception using errcode='42501',message='not_found';end if;
 end if;
 -- The original reader validates its complete closed payload, pages and scope,
 -- preserves current purpose/source checks and applies current chat projections.
 -- All account/session/target values are selected from the real stored job.
 result:=public.export_archive_content_v1(p_operation,p_export_id,p_attempt_id,p_authority_receipt,p_payload);
 if private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt) is distinct from permit
  or private.export_account_owned_capture_v1(permit->'origin',permit->>'targetKind',(permit->>'targetId')::uuid) is distinct from capture then
  raise exception using errcode='42501',message='not_found';end if;
 return result;
end $function$;

-- public.export_archive_account_metadata_v1: one ordinary subject target as well as the whole account.
CREATE OR REPLACE FUNCTION public.export_archive_account_metadata_v1(p_operation text, p_export_id uuid, p_attempt_id uuid, p_authority_receipt text, p_after_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '250ms'
AS $function$
declare permit jsonb;capture jsonb;result jsonb;subjects uuid[];account uuid;page jsonb;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception using errcode='42501',message='not_found';end if;
 if p_operation is null or p_operation not in('context','profile','purpose-grants','legacy-counts')
  or (p_operation in('context','profile') and p_after_id is not null) then
  raise exception using errcode='22023',message='invalid_request';end if;
 permit:=private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt);
 perform private.export_account_door_scope_v1(permit);
 capture:=private.export_account_owned_capture_v1(permit->'origin',permit->>'targetKind',(permit->>'targetId')::uuid);
 if capture#>'{authority,subjectPartitions}' is distinct from permit->'partitions' then
  raise exception using errcode='42501',message='not_found';end if;
 account:=(permit#>>'{origin,accountId}')::uuid;
 select array_agg((x->>'subjectId')::uuid order by x->>'subjectId') into subjects from jsonb_array_elements(capture->'partitions')x;
 if p_operation='context' then
  page:=jsonb_build_array(jsonb_build_object('profileCount',(select count(*) from public.profiles where id=account),
   'purposeGrantCount',(select count(*) from public.purpose_grants g join public.consent_signatures s on s.id=g.signature_id
    where s.signer_account_id=account and g.target_kind='subject' and g.target_id=any(subjects)),
   'fileCount',(select count(*) from public.genome_files f join public.subjects s on s.id=f.subject_id
    where s.id=any(subjects) and s.subject_class in('self','other_adult') and not private.export_account_path_b_file_v1(f.id))));
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
   where s.id=any(subjects) and s.subject_class in('self','other_adult') and not private.export_account_path_b_file_v1(f.id) and (p_after_id is null or f.id>p_after_id)
    order by f.id limit 100)x;
 end if;
 result:=jsonb_build_object('version','account-archive-metadata-v1','operation',p_operation,'rows',page);
 if private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt) is distinct from permit
  or private.export_account_owned_capture_v1(permit->'origin',permit->>'targetKind',(permit->>'targetId')::uuid) is distinct from capture then
  raise exception using errcode='42501',message='not_found';end if;
 return result;
end $function$;

-- public.export_archive_account_inventory_v1: one ordinary subject target as well as the whole account.
CREATE OR REPLACE FUNCTION public.export_archive_account_inventory_v1(p_operation text, p_export_id uuid, p_attempt_id uuid, p_authority_receipt text, p_kind text DEFAULT NULL::text, p_after_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '250ms'
AS $function$
declare permit jsonb;capture jsonb;subjects uuid[];result jsonb;rows jsonb;last_id uuid;n integer;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception using errcode='42501',message='not_found';end if;
 if p_operation is null or p_operation not in('context','history')
  or (p_operation='context' and (p_kind is not null or p_after_id is not null))
  or (p_operation='history' and (p_kind is null or p_kind not in('legacy-consents','subjects','demographics',
   'principals','bindings','account-consents','signatures','attestations','recipient-grants'))) then
  raise exception using errcode='22023',message='invalid_request';end if;
 permit:=private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt);
 perform private.export_account_door_scope_v1(permit);
 capture:=private.export_account_owned_capture_v1(permit->'origin',permit->>'targetKind',(permit->>'targetId')::uuid);
 if capture#>'{authority,subjectPartitions}' is distinct from permit->'partitions' then
  raise exception using errcode='42501',message='not_found';end if;
 select array_agg((x->>'subjectId')::uuid order by x->>'subjectId') into subjects from jsonb_array_elements(capture->'partitions')x;
 if p_operation='context' then
  result:=jsonb_build_object('version','account-history-inventory-v1','authorityReceipt',p_authority_receipt,
   'classes',capture->'memberInventory');
 else
  select coalesce(jsonb_agg(x.row order by x.id),'[]'),count(*),max(x.id::text)::uuid into rows,n,last_id from(
   select projected_id id,jsonb_build_object('id',projected_id,'rowText',projected_row::text)row
   from private.export_scoped_history_projection_v1(permit->>'targetKind',(permit#>>'{origin,accountId}')::uuid,subjects,p_kind)
   where p_after_id is null or projected_id>p_after_id order by projected_id limit 500)x;
  result:=jsonb_build_object('version','account-history-page-v1','kind',p_kind,'rows',rows,
   'nextAfterId',case when n=500 then to_jsonb(last_id) else 'null'::jsonb end);
 end if;
 if private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt) is distinct from permit
  or private.export_account_owned_capture_v1(permit->'origin',permit->>'targetKind',(permit->>'targetId')::uuid) is distinct from capture then
  raise exception using errcode='42501',message='not_found';end if;
 return result;
end $function$;

-- public.export_archive_account_classes_v1: one ordinary subject target as well as the whole account.
CREATE OR REPLACE FUNCTION public.export_archive_account_classes_v1(p_operation text, p_export_id uuid, p_attempt_id uuid, p_authority_receipt text, p_kind text DEFAULT NULL::text, p_after_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '250ms'
AS $function$
declare permit jsonb;captured jsonb;subjects uuid[];result jsonb;rows jsonb;n integer;last_id uuid;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception using errcode='42501',message='not_found';end if;
 if p_operation is null or p_operation not in('context','metadata')
  or (p_operation='context' and (p_kind is not null or p_after_id is not null))
  or (p_operation='metadata' and (p_kind is null or p_kind not in('attestation_contradictions','directional_grants','family_sharing_pauses',
   'family_sharing_stops','future_person_claim_objections','future_person_claimant_principals','future_person_claims',
   'subject_control_refusal_authorities','subject_relationships','suppressions'))) then raise exception using errcode='22023',message='invalid_request';end if;
 permit:=private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt);
 perform private.export_account_door_scope_v1(permit);
 captured:=private.export_account_owned_capture_v1(permit->'origin',permit->>'targetKind',(permit->>'targetId')::uuid);
 if captured#>'{authority,subjectPartitions}' is distinct from permit->'partitions' then raise exception using errcode='42501',message='not_found';end if;
 select array_agg((x->>'subjectId')::uuid order by x->>'subjectId') into subjects from jsonb_array_elements(captured->'partitions')x;
 if p_operation='context' then result:=jsonb_build_object('version','account-class-inventory-v1','authorityReceipt',p_authority_receipt,'classes',captured->'classInventory',
   'ownStatements',captured->'ownStatements',
   'boundSnapshots',(select coalesce(jsonb_agg(jsonb_set(x->'capture','{authority,authorityReceipt}',to_jsonb(p_authority_receipt))
     order by x->>'subjectId'),'[]') from jsonb_array_elements(captured->'partitions')x where x->>'class'='claimed-bound'));
 else
  select coalesce(jsonb_agg(x.row order by x.id),'[]'),count(*),max(x.id::text)::uuid into rows,n,last_id from(
   select projected_id id,jsonb_build_object('id',projected_id,'subjectId',projected_subject,'rowText',projected_row::text)row
    from private.export_scoped_class_projection_v1(permit->>'targetKind',(permit#>>'{origin,accountId}')::uuid,subjects,p_kind)
    where p_after_id is null or projected_id>p_after_id order by projected_id limit 500)x;
  result:=jsonb_build_object('version','account-class-page-v1','kind',p_kind,'rows',rows,'nextAfterId',case when n=500 then to_jsonb(last_id) else 'null'::jsonb end);
 end if;
 if private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt) is distinct from permit
  or private.export_account_owned_capture_v1(permit->'origin',permit->>'targetKind',(permit->>'targetId')::uuid) is distinct from captured then
  raise exception using errcode='42501',message='not_found';end if;
 return result;
end $function$;

-- public.export_archive_account_original_v1: one ordinary subject target as well as the whole account.
CREATE OR REPLACE FUNCTION public.export_archive_account_original_v1(p_operation text, p_export_id uuid, p_attempt_id uuid, p_authority_receipt text, p_file_id uuid, p_expected jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '250ms'
AS $function$
declare permit jsonb;captured jsonb;snapshot jsonb;frame jsonb;state jsonb;source jsonb;receipt jsonb;result jsonb;
 expiry timestamptz;expected_expiry timestamptz;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception using errcode='42501',message='not_found';end if;
 if p_operation is null or p_operation not in('descriptor','check') or p_file_id is null
  or (p_operation='descriptor' and p_expected is not null) or (p_operation='check' and p_expected is null)
  or (p_expected is not null and (jsonb_typeof(p_expected) is distinct from 'object'
   or octet_length(p_expected::text)>8192)) then
  raise exception using errcode='22023',message='invalid_request';end if;
 if p_expected is not null and ((select count(*) from jsonb_object_keys(p_expected))<>9
  or not(p_expected ?& array['version','exportId','attemptId','authorityReceipt','fileId','state','source','decodedSha256','actor'])) then
  raise exception using errcode='22023',message='invalid_request';end if;
 permit:=private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt);
 perform private.export_account_door_scope_v1(permit);
 captured:=private.export_account_owned_capture_v1(permit->'origin',permit->>'targetKind',(permit->>'targetId')::uuid);
 if captured#>'{authority,subjectPartitions}' is distinct from permit->'partitions' then
  raise exception using errcode='42501',message='not_found';end if;
 select x into frame from jsonb_array_elements(captured->'originalFrames')x where x->>'fileId'=p_file_id::text;
 if frame is null then raise exception using errcode='42501',message='not_found';end if;
 snapshot:=private.own_export_source_v1((permit#>>'{origin,accountId}')::uuid,(permit#>>'{origin,sessionId}')::uuid,p_file_id);
 if snapshot is null then raise exception using errcode='42501',message='not_found';end if;
 state:=frame->'state';
 if (state->>'retired')::boolean is true then source:=null;
 else
  expiry:=least(clock_timestamp()+interval '270 seconds',(permit->>'leaseExpiresAt')::timestamptz,
   (permit->>'deadline')::timestamptz-interval '30 seconds');
  if p_expected is not null then
   begin expected_expiry:=(p_expected#>>'{source,expiresAt}')::timestamptz;
   exception when invalid_datetime_format or datetime_field_overflow then
    raise exception using errcode='22023',message='invalid_request';end;
   if expected_expiry is null or expected_expiry>expiry then raise exception using errcode='42501',message='not_found';end if;
   expiry:=expected_expiry;
  end if;
  if (state->>'prepared')::boolean is true then
   receipt:=public.authorize_own_prepared_original_v1((permit#>>'{origin,accountId}')::uuid,
    (permit#>>'{origin,sessionId}')::uuid,p_file_id,case when p_expected is null then null else p_expected->'source' end);
   source:=receipt->'source';
   if (source->>'manifestId')::uuid is distinct from (snapshot#>>'{preparedSource,manifestId}')::uuid
    or (source->>'fileId')::uuid is distinct from p_file_id then raise exception using errcode='42501',message='not_found';end if;
   expiry:=least(expiry,(source->>'expiresAt')::timestamptz);
   source:=jsonb_set(source,'{expiresAt}',to_jsonb(expiry));
   receipt:=public.authorize_own_prepared_original_v1((permit#>>'{origin,accountId}')::uuid,
    (permit#>>'{origin,sessionId}')::uuid,p_file_id,source);
   if receipt->'source' is distinct from source then raise exception using errcode='42501',message='not_found';end if;
  else
   if ((frame#>>'{physical,storageVersion}')~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') is not true then
    raise exception using errcode='42501',message='not_found';end if;
   source:=jsonb_build_object('version','account-original-download-v1','fileId',p_file_id,
    'sourceRevision',frame#>'{physical,sourceRevision}','rawSha256',frame#>'{physical,rawSha256}',
    'bucket',frame#>'{physical,bucket}','objectId',frame#>'{physical,objectId}','objectKey',frame#>'{physical,objectKey}',
    'storageVersion',frame#>'{physical,storageVersion}','sizeBytes',frame#>'{physical,sizeBytes}','expiresAt',expiry);
  end if;
  if expiry<=clock_timestamp() then raise exception using errcode='42501',message='not_found';end if;
 end if;
 result:=jsonb_build_object('version','account-archive-original-v1','exportId',p_export_id,'attemptId',p_attempt_id,
  'authorityReceipt',p_authority_receipt,'fileId',p_file_id,'state',state,'source',source,'decodedSha256',snapshot#>'{file,source_sha256}',
  'actor',jsonb_build_object('accountId',permit#>'{origin,accountId}','sessionId',permit#>'{origin,sessionId}'));
 if (p_expected is not null and result is distinct from p_expected)
  or private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt) is distinct from permit
  or private.export_account_owned_capture_v1(permit->'origin',permit->>'targetKind',(permit->>'targetId')::uuid) is distinct from captured
  or private.own_export_source_v1((permit#>>'{origin,accountId}')::uuid,(permit#>>'{origin,sessionId}')::uuid,p_file_id) is distinct from snapshot then
  raise exception using errcode='42501',message='not_found';end if;
 return result;
end $function$;

-- public.export_archive_account_graph_rows_v1: one ordinary subject target as well as the whole account.
CREATE OR REPLACE FUNCTION public.export_archive_account_graph_rows_v1(p_export_id uuid, p_attempt_id uuid, p_authority_receipt text, p_kind text, p_after_key jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '250ms'
AS $function$
declare permit jsonb;captured jsonb;subjects uuid[];item record;rows jsonb:='[]';total bigint:=0;page_count integer:=0;last_key jsonb;
 digest bytea;identity text;exists_after boolean:=p_after_key is null;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception using errcode='42501',message='not_found';end if;
 if p_kind is null or p_kind not in('embryo_cohorts','embryo_basis_bindings','embryo_participant_sets','embryo_donor_attributions',
  'embryo_disposition_proposals','embryo_disposition_confirmations','family_pairs') then raise exception using errcode='22023',message='invalid_request';end if;
 if p_after_key is not null then perform private.export_account_graph_cursor_v1(p_kind,p_after_key);end if;
 permit:=private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt);
 perform private.export_account_door_scope_v1(permit);
 -- DO NOT replace with a projected/presence-derived permission. In this release
 -- the unchanged014/029 guards still refuse every nonempty unproved graph.
 captured:=private.export_account_owned_capture_v1(permit->'origin',permit->>'targetKind',(permit->>'targetId')::uuid);
 if captured#>'{authority,subjectPartitions}' is distinct from permit->'partitions' then raise exception using errcode='42501',message='not_found';end if;
 select array_agg((x->>'subjectId')::uuid order by x->>'subjectId') into subjects from jsonb_array_elements(captured->'partitions')x;
 digest:=extensions.digest(convert_to('account-graph-source-v1|'||p_kind,'UTF8'),'sha256');
 for item in select * from private.export_scoped_graph_projection_v1(permit->>'targetKind',(permit#>>'{origin,accountId}')::uuid,subjects,p_kind)
  order by (projected_key->>0) collate "C",coalesce(projected_key->>1,'') collate "C",coalesce(projected_key->>2,'') collate "C",coalesce((projected_key->>3)::bigint,0) loop
  identity:=private.export_account_graph_cursor_v1(p_kind,item.projected_key);
  if octet_length(item.projected_row::text)>8192 then raise exception using errcode='55000',message='export_class_projection_unavailable';end if;
  total:=total+1;
  digest:=extensions.digest(digest||convert_to(identity||':'||item.projected_row::text||E'\n','UTF8'),'sha256');
  if item.projected_key=p_after_key then exists_after:=true;end if;
  if page_count<500 and (p_after_key is null or
   ((item.projected_key->>0) collate "C",coalesce(item.projected_key->>1,'') collate "C",coalesce(item.projected_key->>2,'') collate "C",coalesce((item.projected_key->>3)::bigint,0))>
   ((p_after_key->>0) collate "C",coalesce(p_after_key->>1,'') collate "C",coalesce(p_after_key->>2,'') collate "C",coalesce((p_after_key->>3)::bigint,0))) then
   rows:=rows||jsonb_build_array(jsonb_build_object('identity',identity,'rowText',item.projected_row::text));page_count:=page_count+1;last_key:=item.projected_key;
  end if;
 end loop;
 if total>9007199254740991 or not exists_after then raise exception using errcode='22023',message='invalid_request';end if;
 if private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt) is distinct from permit
  or private.export_account_owned_capture_v1(permit->'origin',permit->>'targetKind',(permit->>'targetId')::uuid) is distinct from captured then
  raise exception using errcode='42501',message='not_found';end if;
 return jsonb_build_object('version','account-graph-page-v1','kind',p_kind,'authorityReceipt',p_authority_receipt,
  'membership',jsonb_build_object('rows',total,'sha256',encode(digest,'hex')),'rows',rows,'nextAfterKey',case when page_count=500 then last_key else null end);
end $function$;

-- public.export_archive_account_graph_rows_v2: one ordinary subject target as well as the whole account.
CREATE OR REPLACE FUNCTION public.export_archive_account_graph_rows_v2(p_export_id uuid, p_attempt_id uuid, p_authority_receipt text, p_kind text, p_after_key jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '250ms'
AS $function$
declare permit jsonb;captured jsonb;subjects uuid[];anchor uuid;item record;rows jsonb:='[]';total bigint:=0;page_count integer:=0;last_key jsonb;
 digest bytea;identity text;exists_after boolean:=p_after_key is null;expected jsonb;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception using errcode='42501',message='not_found';end if;
 if p_kind is null or p_kind not in('embryo_cohorts','embryo_basis_bindings','embryo_participant_sets','embryo_donor_attributions',
  'embryo_disposition_proposals','embryo_disposition_confirmations','family_pairs') then raise exception using errcode='22023',message='invalid_request';end if;
 if p_after_key is not null then perform private.export_account_graph_cursor_v1(p_kind,p_after_key);end if;
 permit:=private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt);
 perform private.export_account_door_scope_v1(permit);
 captured:=private.export_account_owned_capture_v1(permit->'origin',permit->>'targetKind',(permit->>'targetId')::uuid);
 if captured#>'{authority,subjectPartitions}' is distinct from permit->'partitions' then raise exception using errcode='42501',message='not_found';end if;
 select array_agg((x->>'subjectId')::uuid order by x->>'subjectId') into subjects from jsonb_array_elements(captured->'partitions')x;
 anchor:=(captured#>>'{readableGraph,anchorSubjectId}')::uuid;
 select x into expected from jsonb_array_elements(captured#>'{readableGraph,inventory}')x where x->>'kind'=p_kind;
 if anchor is null or expected is null or not(anchor=any(subjects)) then raise exception using errcode='42501',message='not_found';end if;
 digest:=extensions.digest(convert_to('account-graph-routed-v2|'||p_kind,'UTF8'),'sha256');
 for item in select * from private.export_scoped_graph_projection_v1(permit->>'targetKind',(permit#>>'{origin,accountId}')::uuid,subjects,p_kind)
  order by (projected_key->>0) collate "C",coalesce(projected_key->>1,'') collate "C",coalesce(projected_key->>2,'') collate "C",coalesce((projected_key->>3)::bigint,0) loop
  identity:=private.export_account_graph_cursor_v1(p_kind,item.projected_key);
  if octet_length(item.projected_row::text)>8192 then raise exception using errcode='55000',message='export_class_projection_unavailable';end if;
  total:=total+1;
  digest:=extensions.digest(digest||convert_to(identity||':'||anchor::text||':requester-account-history:'||item.projected_row::text||E'\n','UTF8'),'sha256');
  if item.projected_key=p_after_key then exists_after:=true;end if;
  if page_count<500 and (p_after_key is null or
   ((item.projected_key->>0) collate "C",coalesce(item.projected_key->>1,'') collate "C",coalesce(item.projected_key->>2,'') collate "C",coalesce((item.projected_key->>3)::bigint,0))>
   ((p_after_key->>0) collate "C",coalesce(p_after_key->>1,'') collate "C",coalesce(p_after_key->>2,'') collate "C",coalesce((p_after_key->>3)::bigint,0))) then
   rows:=rows||jsonb_build_array(jsonb_build_object('identity',identity,'subjectId',anchor,
    'scope','requester-account-history','rowText',item.projected_row::text));page_count:=page_count+1;last_key:=item.projected_key;
  end if;
 end loop;
 if total>9007199254740991 or not exists_after then raise exception using errcode='22023',message='invalid_request';end if;
 if total is distinct from(expected->>'rows')::bigint or encode(digest,'hex') is distinct from expected->>'membershipSha256'
  or private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt) is distinct from permit
  or private.export_account_owned_capture_v1(permit->'origin',permit->>'targetKind',(permit->>'targetId')::uuid) is distinct from captured then
  raise exception using errcode='42501',message='not_found';end if;
 return jsonb_build_object('version','account-graph-page-v2','kind',p_kind,'authorityReceipt',p_authority_receipt,
  'membership',jsonb_build_object('rows',total,'sha256',encode(digest,'hex')),'rows',rows,'nextAfterKey',case when page_count=500 then last_key else null end);
end $function$;

-- public.export_archive_account_path_b_v1: one ordinary subject target as well as the whole account.
CREATE OR REPLACE FUNCTION public.export_archive_account_path_b_v1(p_export_id uuid, p_attempt_id uuid, p_authority_receipt text, p_subject_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '250ms'
 SET extra_float_digits TO '3'
AS $function$
declare permit jsonb;captured jsonb;result jsonb;snapshot jsonb;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception using errcode='42501',message='not_found';end if;
 if p_subject_id is null then raise exception using errcode='22023',message='invalid_request';end if;
 permit:=private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt);
 if private.export_account_door_scope_v1(permit) is null or not(permit->'partitions' ? p_subject_id::text) then
  raise exception using errcode='42501',message='not_found';end if;
 captured:=private.export_account_owned_capture_v1(permit->'origin',permit->>'targetKind',(permit->>'targetId')::uuid);
 if captured#>'{authority,subjectPartitions}' is distinct from permit->'partitions' then raise exception using errcode='42501',message='not_found';end if;
 select x into snapshot from jsonb_array_elements(captured->'pathBResults')x where x->>'subjectId'=p_subject_id::text;
 if snapshot is null then
  if exists(select 1 from public.genome_files gf where gf.subject_id=p_subject_id and private.export_account_path_b_file_v1(gf.id)) then
   raise exception using errcode='42501',message='not_found';end if;
  snapshot:=jsonb_build_object('subjectId',p_subject_id,'records','[]'::jsonb,'rows',0,
   'sha256',encode(extensions.digest(convert_to('account-class-members-v1|path_b_report_bindings','UTF8'),'sha256'),'hex'),'excludedHeldUploads',0);
 end if;
 result:=jsonb_build_object('version','account-path-b-results-v1','authorityReceipt',p_authority_receipt,'snapshot',snapshot);
 if octet_length(result::text)>4000000 then raise exception using errcode='54000',message='export_result_projection_unavailable';end if;
 if private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt) is distinct from permit
  or private.export_account_owned_capture_v1(permit->'origin',permit->>'targetKind',(permit->>'targetId')::uuid) is distinct from captured then
  raise exception using errcode='42501',message='not_found';end if;
 return result;
end $function$;

-- public.export_archive_account_members_v1: one ordinary subject target as well as the whole account.
CREATE OR REPLACE FUNCTION public.export_archive_account_members_v1(p_operation text, p_export_id uuid, p_attempt_id uuid, p_authority_receipt text, p_subject_id uuid DEFAULT NULL::uuid, p_after_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '250ms'
AS $function$
declare permit jsonb;capture jsonb;result jsonb;account uuid;session uuid;rev bigint;session_rev bigint;
begin
 if p_operation is distinct from 'own-statements' then
  return public.export_archive_account_members_pre_requester_v1(p_operation,p_export_id,p_attempt_id,p_authority_receipt,p_subject_id,p_after_id);end if;
 if auth.jwt()->>'role' is distinct from 'service_role' or p_subject_id is null then raise exception using errcode='42501',message='not_found';end if;
 permit:=private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt);
 if private.export_account_door_scope_v1(permit) is null or not(permit->'partitions' ? p_subject_id::text) then raise exception using errcode='42501',message='not_found';end if;
 account:=(permit#>>'{origin,accountId}')::uuid;session:=(permit#>>'{origin,sessionId}')::uuid;
 capture:=private.export_account_owned_capture_v1(permit->'origin',permit->>'targetKind',(permit->>'targetId')::uuid);
 if not exists(select 1 from jsonb_array_elements(capture->'partitions')x where x->>'subjectId'=p_subject_id::text) then raise exception using errcode='42501',message='not_found';end if;
 select auth_session_revision into rev from public.profiles where id=account;
 select coalesce(refresh_token_counter,0)+1 into session_rev from auth.sessions where id=session and user_id=account;
 if rev is null or session_rev is null then raise exception using errcode='42501',message='not_found';end if;
 select jsonb_build_object('rows',coalesce(jsonb_agg(jsonb_build_object('id',x.id,'frame',jsonb_build_object('scope',x.scope,'envelope',x.envelope,
  'binding',jsonb_build_object('accountId',account,'sessionId',session,'bindingId',x.binding_id,'principalId',x.principal_id,'subjectId',x.subject_id,
   'accountAuthSessionRevision',rev,'sessionRevision',session_rev,'principalRevision',x.principal_revision,'lifecycleRevision',x.lifecycle_revision,
   'bindingRevision',x.binding_revision,'sourceReceipt',p_authority_receipt,'caseHash',x.case_hash))) order by x.id),'[]'),
   'count',count(*),'nextAfterId',max(x.id::text)) into result
  from(select * from private.export_account_requester_rows_v1(account,array[p_subject_id]) r
   where p_after_id is null or r.id>p_after_id::uuid order by r.id limit 32)x;
 if octet_length(result::text)>2000000 then raise exception using errcode='55000',message='export_source_unavailable';end if;
 if private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt) is distinct from permit
  or private.export_account_owned_capture_v1(permit->'origin',permit->>'targetKind',(permit->>'targetId')::uuid) is distinct from capture then raise exception using errcode='42501',message='not_found';end if;
 return result;
end $function$;

-- TEST R2 write context: an ordinary subject job as well as the account job.
CREATE OR REPLACE FUNCTION private.account_archive_r2_write_context_v1(p_attempt uuid, p_receipt text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'private'
AS $function$
declare job_row private.export_archive_jobs;attempt_row private.export_archive_attempts;export_row public.generated_exports;
begin
 select * into attempt_row from private.export_archive_attempts where id=p_attempt;
 if attempt_row.id is null then raise exception using errcode='42501',message='account_archive_r2_unavailable';end if;
 perform private.export_archive_current_v1(attempt_row.export_id,p_receipt);
 select * into export_row from public.generated_exports where id=attempt_row.export_id for update;
 select * into job_row from private.export_archive_jobs where export_id=attempt_row.export_id for update;
 select * into attempt_row from private.export_archive_attempts where id=p_attempt for update;
 if private.account_archive_job_scope_v1(job_row,export_row) is not true
  or export_row.status<>'building' or job_row.active_attempt is distinct from p_attempt
  or job_row.authority_receipt is distinct from p_receipt or attempt_row.authority_receipt is distinct from p_receipt
  or attempt_row.state<>'writing' or least(attempt_row.lease_expires_at,job_row.deadline-interval '30 seconds')<=clock_timestamp() then
  raise exception using errcode='42501',message='account_archive_r2_unavailable';end if;
end $function$;

-- TEST R2 completed context (TEST completion and READY): an ordinary subject job as well.
CREATE OR REPLACE FUNCTION private.account_archive_r2_completed_context_v1(p_attempt uuid, p_receipt text, p_ready boolean)
 RETURNS private.export_archive_attempts
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'private'
AS $function$
declare ar private.export_archive_attempts;er public.generated_exports;jr private.export_archive_jobs;
 cr private.account_archive_r2_configuration;counts record;
begin
 if current_user<>'postgres' or session_user<>'postgres' or p_ready is null then
  raise exception using errcode='42501',message='account_archive_test_unavailable';end if;
 select * into ar from private.export_archive_attempts where id=p_attempt;
 if ar.id is null then raise exception using errcode='42501',message='account_archive_test_unavailable';end if;
 perform private.export_archive_current_v1(ar.export_id,p_receipt);
 select * into er from public.generated_exports where id=ar.export_id for update;
 select * into jr from private.export_archive_jobs where export_id=ar.export_id for update;
 select * into ar from private.export_archive_attempts where id=p_attempt for update;
 select * into cr from private.account_archive_r2_configuration where singleton for share;
 perform 1 from private.export_archive_segments where attempt_id=p_attempt order by ordinal for share;
 perform 1 from private.account_archive_r2_allocations where attempt_id=p_attempt order by ordinal for share;
 select count(*) n,coalesce(sum(byte_count),0) bytes,min(ordinal) first,max(ordinal) last
  into counts from private.export_archive_segments where attempt_id=p_attempt;
 if cr.enabled is distinct from true or private.account_archive_job_scope_v1(jr,er) is not true or jr.active_attempt is distinct from p_attempt
  or jr.authority_receipt is distinct from p_receipt or ar.authority_receipt is distinct from p_receipt
  or er.status is distinct from (case when p_ready then 'ready' else 'building' end)
  or ar.state is distinct from 'bytes_complete' or ar.archive_sha256 is null or ar.manifest_sha256 is null or jr.deadline<=clock_timestamp()
  or (p_ready and (ar.account_r2_completion is null or er.expires_at<=clock_timestamp()
   or ar.account_r2_completion->>'authorityReceipt' is distinct from p_receipt
   or ar.account_r2_completion->>'archiveSha256' is distinct from ar.archive_sha256
   or ar.account_r2_completion->>'manifestSha256' is distinct from ar.manifest_sha256
   or (ar.account_r2_completion->>'sizeBytes')::bigint is distinct from ar.byte_count
   or (ar.account_r2_completion->>'expiresAt')::timestamptz is distinct from er.expires_at))
  or (not p_ready and ar.account_r2_completion is not null)
  or counts.n=0 or counts.n<>ar.segment_count or counts.bytes<>ar.byte_count
  or counts.first<>0 or counts.last<>counts.n-1
  or ar.segment_count<>(ar.byte_count+3999999)/4000000 or ar.page_count<>(ar.segment_count+127)/128
  or (select count(*) from private.export_archive_manifest_pages where attempt_id=p_attempt)<>ar.page_count
  or (select count(*) from private.account_archive_r2_allocations where attempt_id=p_attempt)<>counts.n
  or exists(select 1 from private.export_archive_segments s left join private.account_archive_r2_allocations r
   on r.attempt_id=s.attempt_id and r.ordinal=s.ordinal where s.attempt_id=p_attempt and
   (s.byte_offset<>s.ordinal*4000000 or (s.ordinal<ar.segment_count-1 and s.byte_count<>4000000) or s.acknowledged_at is null or s.delete_acknowledged_at is not null
    or s.object_id is distinct from r.object_id or r.written_at is null or r.disposal_claim is not null
    or r.disposed_at is not null or r.original_deadline<=clock_timestamp()
    or r.bucket is distinct from cr.bucket or r.configuration_sha256 is distinct from cr.binding_sha256
    or r.write_identity->>'exportId' is distinct from ar.export_id::text
    or r.write_identity->>'attemptId' is distinct from p_attempt::text
    or r.write_identity->>'authorityReceipt' is distinct from p_receipt
    or (r.write_identity->>'ordinal')::bigint is distinct from s.ordinal
    or (r.write_identity->>'offset')::bigint is distinct from s.byte_offset
    or (r.write_identity->>'byteCount')::bigint is distinct from s.byte_count
    or r.write_identity->>'sha256' is distinct from s.sha256
    or r.write_identity->>'logicalKey' is distinct from s.object_key)) then
  raise exception using errcode='42501',message='account_archive_test_unavailable';end if;
 return ar;
end $function$;

-- TEST R2 disposal frame: the subject contract's reserved objects are disposed of the same way.
CREATE OR REPLACE FUNCTION private.account_archive_r2_disposal_frame_v1(p_attempt uuid, p_ordinal bigint, p_claim text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'private'
AS $function$
declare allocation_row private.account_archive_r2_allocations;attempt_row private.export_archive_attempts;
 job_row private.export_archive_jobs;value jsonb;
begin
 if session_user<>'postgres' or current_user<>'postgres' then raise exception using errcode='42501',message='account_archive_r2_unavailable';end if;
 select * into attempt_row from private.export_archive_attempts where id=p_attempt;
 perform 1 from public.generated_exports where id=attempt_row.export_id for update;
 select * into job_row from private.export_archive_jobs where export_id=attempt_row.export_id for update;
 select * into attempt_row from private.export_archive_attempts where id=p_attempt for update;
 select * into allocation_row from private.account_archive_r2_allocations where attempt_id=p_attempt and ordinal=p_ordinal for update;
 if allocation_row.attempt_id is null or job_row.origin->>'kind' is distinct from 'account'
  or job_row.export_contract not in('account-export-v1','subject-export-v1') or attempt_row.state<>'cleanup_pending'
  or attempt_row.cleanup_not_before>clock_timestamp() or allocation_row.original_deadline+interval '30 seconds'>clock_timestamp()
  or allocation_row.disposal_claim is distinct from p_claim or allocation_row.disposal_claim_expires_at<=clock_timestamp()
  or allocation_row.disposed_at is not null then
  raise exception using errcode='42501',message='account_archive_r2_unavailable';end if;
 value:=jsonb_build_object('version','archive-r2-current-cleanup-reservation-v1','exportId',job_row.export_id,
  'attemptId',p_attempt,'ordinal',p_ordinal,'authorityReceipt',job_row.authority_receipt,'locator',allocation_row.write_identity->'locator',
  'writeIdentity',allocation_row.write_identity,'writeBindingSha256',allocation_row.write_binding_sha256,
  'allocationSha256',allocation_row.allocation_sha256,'cleanupNotBefore',greatest(attempt_row.cleanup_not_before,allocation_row.original_deadline+interval '30 seconds'),
  'claimExpiresAt',allocation_row.disposal_claim_expires_at);
 return value||jsonb_build_object('reservationSha256',encode(extensions.digest(convert_to(value::text,'UTF8'),'sha256'),'hex'));
end $function$;

-- TEST R2 disposal claim: the subject contract's reserved objects are disposed of the same way.
CREATE OR REPLACE FUNCTION private.claim_account_archive_r2_disposal_v1(p_attempt uuid, p_ordinal bigint, p_claim text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'private'
AS $function$
declare allocation_row private.account_archive_r2_allocations;attempt_row private.export_archive_attempts;job_row private.export_archive_jobs;
begin
 if session_user<>'postgres' or current_user<>'postgres' or p_claim is null or p_claim!~'^[0-9a-f]{64}$' then
  raise exception using errcode='42501',message='account_archive_r2_unavailable';end if;
 select * into attempt_row from private.export_archive_attempts where id=p_attempt;
 perform 1 from public.generated_exports where id=attempt_row.export_id for update;
 select * into job_row from private.export_archive_jobs where export_id=attempt_row.export_id for update;
 select * into attempt_row from private.export_archive_attempts where id=p_attempt for update;
 select * into allocation_row from private.account_archive_r2_allocations where attempt_id=p_attempt and ordinal=p_ordinal for update;
 if allocation_row.attempt_id is null or job_row.origin->>'kind' is distinct from 'account' or job_row.export_contract not in('account-export-v1','subject-export-v1')
  or attempt_row.state<>'cleanup_pending' or attempt_row.cleanup_not_before>clock_timestamp()
  or allocation_row.original_deadline+interval '30 seconds'>clock_timestamp() or allocation_row.disposed_at is not null
  or allocation_row.disposal_claim_expires_at>clock_timestamp() then
  raise exception using errcode='42501',message='account_archive_r2_unavailable';end if;
 update private.account_archive_r2_allocations set disposal_claim=p_claim,disposal_claim_expires_at=clock_timestamp()+interval '30 seconds'
  where attempt_id=p_attempt and ordinal=p_ordinal;
 return private.account_archive_r2_disposal_frame_v1(p_attempt,p_ordinal,p_claim);
end $function$;

-- TEST cleanup due: stopped subject attempts are cleaned up the same way.
CREATE OR REPLACE FUNCTION private.account_archive_test_cleanup_due_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
 SET lock_timeout TO '250ms'
AS $function$
declare result jsonb;
begin
 perform private.account_archive_test_configuration_v1();
 select coalesce(jsonb_agg(to_jsonb(page) order by "attemptId"),'[]'::jsonb) into result from(
  select a.export_id as "exportId",a.id as "attemptId"
   from private.export_archive_attempts a join private.export_archive_jobs j on j.export_id=a.export_id
   join public.generated_exports e on e.id=a.export_id
  where e.origin_kind='account' and private.account_archive_job_scope_v1(j,e)
   and e.purpose='raw.export' and e.archive_version='archive-segments-v1'
   and jsonb_typeof(j.origin)='object' and (select count(*) from jsonb_object_keys(j.origin))=3
   and j.origin ?& array['kind','accountId','sessionId'] and j.origin->>'kind'='account'
   and j.origin->>'accountId'=e.account_id::text
   and coalesce(j.origin->>'sessionId','')~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   and ((a.state='writing' and a.lease_expires_at<=clock_timestamp())
    or (a.state='bytes_complete' and j.deadline<=clock_timestamp())
    or (a.state='cleanup_pending' and a.cleanup_not_before<=clock_timestamp()))
  order by a.id limit 16
 )page;
 return result;
end $function$;

-- TEST disposal due: a stopped subject attempt's objects are disposed of the same way.
CREATE OR REPLACE FUNCTION private.account_archive_test_disposal_due_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
 SET lock_timeout TO '250ms'
AS $function$
declare value jsonb;
begin
 if current_user<>'postgres' or session_user<>'postgres' then
  raise exception using errcode='42501',message='account_archive_test_unavailable';end if;
 select coalesce(jsonb_agg(jsonb_build_object('attemptId',x.attempt_id,'ordinal',x.ordinal)
   order by x.attempt_id,x.ordinal),'[]'::jsonb) into value from(
  select allocation.attempt_id,allocation.ordinal from private.account_archive_r2_allocations allocation
   join private.export_archive_attempts attempt on attempt.id=allocation.attempt_id
   join private.export_archive_jobs job on job.export_id=attempt.export_id
   join public.generated_exports export on export.id=job.export_id
  where job.origin->>'kind'='account' and export.origin_kind='account'
   and private.account_archive_job_scope_v1(job,export)
   and job.origin->>'accountId'=export.account_id::text
   and attempt.state='cleanup_pending' and attempt.stopped_at is not null
   and attempt.cleanup_not_before<=clock_timestamp()
   and allocation.original_deadline+interval '30 seconds'<=clock_timestamp()
   and allocation.disposed_at is null
   and (allocation.disposal_claim_expires_at is null or allocation.disposal_claim_expires_at<=clock_timestamp())
  order by allocation.attempt_id,allocation.ordinal limit 128
 )x;
 return value;
end $function$;

-- TEST delivery context: a ready subject export's download session uses the same chunk door.
CREATE OR REPLACE FUNCTION private.account_archive_test_delivery_context_v1(p_download_id uuid, p_download_hash text, p_origin jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
 SET lock_timeout TO '250ms'
AS $function$
declare d private.export_archive_downloads;j private.export_archive_jobs;a private.export_archive_attempts;ready jsonb;
begin
 if current_user<>'postgres' or session_user<>'postgres' then
  raise exception using errcode='42501',message='account_archive_test_unavailable';end if;
 select dr.* into d from private.export_archive_downloads dr
  join private.export_archive_jobs job on job.export_id=dr.export_id
  join public.generated_exports er on er.id=dr.export_id
  where dr.id=p_download_id and er.origin_kind='account' and private.account_archive_job_scope_v1(job,er);
 -- Only a genuinely different download family can fall through the router.
 if d.id is null then return null;end if;
 perform private.account_archive_test_configuration_v1();
 if d.cookie_hash is distinct from p_download_hash then
  raise exception using errcode='42501',message='account_archive_test_unavailable';end if;
 a:=private.account_archive_test_download_context_v1(d.attempt_id,d.authority_receipt,p_download_hash,p_origin);
 select * into d from private.export_archive_downloads where id=p_download_id and cookie_hash=p_download_hash for update;
 select * into j from private.export_archive_jobs where export_id=d.export_id;
 if d.id is null or d.attempt_id is distinct from a.id or d.authority_receipt is distinct from j.authority_receipt
  or p_origin is distinct from j.origin or d.next_sequence>a.segment_count then
  raise exception using errcode='42501',message='account_archive_test_unavailable';end if;
 ready:=private.account_archive_test_ready_v1(p_origin,j.export_id,j.export_cookie_hash);
 return jsonb_build_object('sessionId',d.id,'nextSequence',d.next_sequence,'ready',ready);
end $function$;

-- Publication guard: READY only through the same TEST completion proof, for an ordinary subject job too.
CREATE OR REPLACE FUNCTION private.guard_segmented_export_publication_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'private'
AS $function$
begin
 if tg_op='UPDATE' and old.archive_version='archive-segments-v1' and row(new.archive_version,new.account_id,
  new.requester_principal_id,new.export_kind,new.target_kind,new.target_id,new.purpose,new.lifecycle_revision,
  new.grant_revision,new.principal_graph_revision,new.principal_graph_fingerprint,new.export_revision,new.subject_partitions,new.requested_at)
  is distinct from row(old.archive_version,old.account_id,old.requester_principal_id,old.export_kind,old.target_kind,old.target_id,
  old.purpose,old.lifecycle_revision,old.grant_revision,old.principal_graph_revision,old.principal_graph_fingerprint,old.export_revision,old.subject_partitions,old.requested_at) then
  raise exception using errcode='23514',message='export_identity_immutable';end if;
 if new.archive_version='archive-segments-v1' and new.status='ready' and not(
  session_user='postgres' and new.target_kind in('account','subject') and exists(select 1 from private.export_archive_jobs j
   join private.export_archive_attempts a on a.id=j.active_attempt and a.export_id=j.export_id
   join private.account_archive_r2_configuration c on c.singleton where j.export_id=new.id and c.enabled
   and private.account_archive_job_scope_v1(j,new) and a.state='bytes_complete'
   and a.account_r2_completion is not null and a.account_r2_completion->>'authorityReceipt'=j.authority_receipt
   and a.account_r2_completion->>'archiveSha256'=new.archive_sha256
   and a.account_r2_completion->>'manifestSha256'=new.manifest_sha256
   and (a.account_r2_completion->>'sizeBytes')::bigint=new.byte_count
   and (a.account_r2_completion->>'expiresAt')::timestamptz=new.expires_at)) then
  raise exception using errcode='55000',message='export_publication_not_integrated';end if;
 return new;
end $function$;
