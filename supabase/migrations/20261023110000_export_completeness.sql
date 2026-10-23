-- =====================================================================
-- PRODUCTION RELEASE: GUARDED. This migration is applied to local and CI
-- databases only. It must reach a hosted database through the guarded
-- production release (preflight, postflight, receipt), never as a side
-- effect of a merge. It follows 20261023100000_subject_export_joint_results
-- and patches bodies that migration and 20261016196000_subject_export.sql
-- install, so it can only follow both.
-- =====================================================================
--
-- G5.6, owner decisions of 23 October 2026 ("Export completeness: family
-- conversations, cohorts, empty classes", docs/protocol/decisions.md).
--
--   1. Family Copilot conversations (one-record export). The record's own
--      conversation turns leave as written while every grant each turn used
--      is still current, as private.family_copilot_turn_state_v1 judges it
--      for the conversation history: a revoked, expired or replaced grant, an
--      ended adult record, a changed source file or a current pause leaves
--      the turn out, and, as the history drops the same suffix, every later
--      turn of that conversation with it. The record's conversations are the
--      canonical family group conversations of its account, which are
--      anchored on the account's self record; an adult record has none.
--      Legacy unverified conversations stay unexported (owner decision,
--      26 September). In citations only structured identifiers are removed:
--      an id or link that holds a UUID (a person's record) is dropped, a
--      publication id or link stays, and a label that holds a UUID refuses
--      the whole request. The turn ordinal orders the transport only. The
--      turns are bound into the authority receipt, so a grant that ends
--      mid-job fails the job. This replaces the conversation refusal.
--   2. Embryo cohorts. A parent's export carries the parent's own cohort
--      records and no embryo results. The whole-account export no longer
--      refuses an owned embryo record or a live cohort role: the account's
--      own cohort, basis-binding, participant-set, donor-attribution,
--      disposition-proposal and confirmation rows leave through the existing
--      redacted graph projections (the other parent and any donor appear
--      only as "is requester" flags), with the account's own signatures and
--      attestations, and embryo results (embryos, quality, scores, variants,
--      figures, report artifacts) are left out. The one-record export of the
--      account's self record carries the same cohort rows and the account's
--      own cohort signatures and attestations; an adult record carries none.
--      No cohort role refuses either export any more.
--   3. Classes with no production writer. public.own_export_writerless_rows_v1
--      gives the synchronous archive its pinned refusal: any row of ancestry
--      regions, attestation contradictions, subject-control refusal
--      authorities, suppressions or report artifacts in the requester's
--      scope refuses the export.
--   4. Person attribution is the next migration,
--      20261023120000_legal_audit_attribution_completeness.sql.
--   5. The TEST complete account archive's Portrait output carries the same
--      minimal fields as the one-record export, and refuses a result that
--      holds an identifier.
--
-- One joint result still refuses with the stated reason
-- export_joint_results_pending: a canonical family conversation anchored on
-- a pair naming the record. No writer makes one and this release has no
-- projection for it. The route keeps its closed reason.
--
-- Pattern: md5-guarded in-place patches, as in 20261023100000. Each
-- predecessor is checked by md5(pg_get_functiondef) with its exact reviewed
-- ACL; each anchor must occur exactly once; the successor md5 and the
-- unchanged ACL are asserted; any difference raises 55000. Predecessors are
-- PR 324's bodies (538dcee6) or 20261023100000's successors; the account
-- graph capture and the complete-archive class rows are the bodies
-- production already holds.
--
-- No table, column, grant on an existing object, audit event, route or
-- wording changes. One function is dropped: the conversation predicate this
-- branch added in 20261023100000, which nothing calls any more.

-- 1. The record's family conversation turns -----------------------------------
create function private.export_subject_family_turn_rows_v1(p_origin jsonb, p_subject uuid)
returns table(projected_key jsonb, projected_row jsonb) language plpgsql security definer
set search_path = '' set lock_timeout = '250ms'
as $function$
declare a uuid;s public.subjects;m record;citations jsonb;
 uuid_pattern constant text:='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
begin
 if jsonb_typeof(p_origin) is distinct from 'object' or p_origin->>'kind' is distinct from 'account'
  or coalesce(p_origin->>'accountId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
  raise exception using errcode='42501',message='not_found';end if;
 a:=(p_origin->>'accountId')::uuid;
 if not private.export_subject_ordinary_target_v1(a,p_subject) then raise exception using errcode='42501',message='not_found';end if;
 select * into s from public.subjects where id=p_subject;
 -- No writer makes a canonical family conversation anchored on a pair. One
 -- naming the record is refused by the scope (export_subject_joint_results_v1);
 -- this repeats it so its turns can never be read here.
 if exists(select 1 from public.chats ch join public.family_pairs fp on fp.id=ch.family_pair_id
   where ch.user_id=a and ch.scope_kind='family' and ch.legacy_unverified is false and p_subject in(fp.subject_a_id,fp.subject_b_id)
    and exists(select 1 from public.chat_messages t where t.chat_id=ch.id)) then
  raise exception using errcode='0A000',message='export_class_projection_unavailable';end if;
 -- A group conversation is anchored on the account's self record; an adult
 -- record has none.
 if s.subject_class is distinct from 'self' then return;end if;
 -- A turn leaves only while it and every earlier turn of its conversation are
 -- current: a later answer was written with the earlier turns in view, and the
 -- conversation history drops the same suffix (private.family_copilot_prune_v1).
 for m in with groups as (select ch.id,ch.created_at from public.chats ch where ch.user_id=a and ch.scope_kind='family'
    and ch.family_pair_id is null and ch.legacy_unverified is false and ch.canonical_authority->>'scope'='family-group'),
   cut as (select g.id chat_id,min(e.turn_ordinal) cutoff from groups g join public.chat_messages e on e.chat_id=g.id
    where e.user_id is distinct from a or e.legacy_unverified is not false
     or private.family_copilot_turn_state_v1(a,g.id,e.turn_id) is distinct from 'current' group by g.id)
  select g.id chat_id,g.created_at chat_created_at,msg.id,msg.turn_ordinal,msg.role,msg.paired_role,msg.content,
   msg.canonical_citations,msg.created_at
  from groups g join public.chat_messages msg on msg.chat_id=g.id left join cut on cut.chat_id=g.id
  where cut.cutoff is null or msg.turn_ordinal<cut.cutoff
  order by g.id,msg.turn_ordinal,case msg.role when 'user' then 0 else 1 end
 loop
  if m.role not in('user','assistant') or m.role is distinct from m.paired_role
   or jsonb_typeof(m.content) is distinct from 'array' or jsonb_array_length(m.content)<>1
   or (m.content->0)-array['type','text']<>'{}'::jsonb or m.content->0->>'type' is distinct from 'text'
   or jsonb_typeof(m.content->0->'text') is distinct from 'string'
   or private.valid_family_copilot_citations_v1(m.canonical_citations) is not true
   or exists(select 1 from jsonb_array_elements(m.canonical_citations) c where c->>'label'~*uuid_pattern) then
   raise exception using errcode='0A000',message='export_class_projection_unavailable';end if;
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('label',x.c->>'label',
    'id',case when x.c->>'id'!~*uuid_pattern then x.c->>'id' end,
    'href',case when x.c->>'href'!~*uuid_pattern then x.c->>'href' end)) order by x.ord),'[]')
   into citations from jsonb_array_elements(m.canonical_citations) with ordinality x(c,ord);
  -- The ordinal orders the transport key only; it never enters a row.
  projected_key:=jsonb_build_array(m.chat_id,m.turn_ordinal,case m.role when 'user' then 0 else 1 end);
  projected_row:=jsonb_build_object('chat_id',m.chat_id,'chat_created_at',m.chat_created_at,'id',m.id,
   'role',m.role,'content',m.content->0->>'text','citations',citations,'created_at',m.created_at);
  return next;
 end loop;
end $function$;
revoke all on function private.export_subject_family_turn_rows_v1(jsonb, uuid)
 from public, anon, authenticated, inherit_upload_only, service_role;

-- Their count and ordered membership digest, bound into the authority receipt.
create function private.export_subject_family_turn_capture_v1(p_origin jsonb, p_subject uuid)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '250ms'
as $function$
declare item record;n bigint:=0;digest bytea:=extensions.digest(convert_to('account-family-turns-v1','UTF8'),'sha256');
begin
 for item in select x.projected_key,x.projected_row from private.export_subject_family_turn_rows_v1(p_origin,p_subject)x
  order by (x.projected_key->>0)::uuid,(x.projected_key->>1)::bigint,(x.projected_key->>2)::integer loop
  if octet_length(item.projected_row::text)>1048576 then raise exception using errcode='55000',message='export_class_projection_unavailable';end if;
  n:=n+1;digest:=extensions.digest(digest||convert_to(item.projected_key::text||':'||item.projected_row::text||E'\n','UTF8'),'sha256');
 end loop;
 return jsonb_build_object('version','account-family-turns-v1','rows',n,'membershipSha256',encode(digest,'hex'));
end $function$;
revoke all on function private.export_subject_family_turn_capture_v1(jsonb, uuid)
 from public, anon, authenticated, inherit_upload_only, service_role;

-- 3. The synchronous archive's pinned refusal for classes with no writer ------
-- The requester's scope: its own records and the records it holds, its own
-- principals and the cohorts it owns or takes part in. Any row refuses.
create function public.own_export_writerless_rows_v1(p_account_id uuid, p_session_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare subjects uuid[];principals uuid[];cohorts uuid[];n bigint;
begin
 if p_account_id is null or p_session_id is null then raise exception using errcode='22023',message='invalid_request';end if;
 perform private.own_export_source_v1(p_account_id,p_session_id,null);
 select coalesce(array_agg(id),'{}') into subjects from public.subjects where subject_account_id=p_account_id or owner_account_id=p_account_id;
 select coalesce(array_agg(id),'{}') into principals from public.subject_principals where account_id=p_account_id;
 select coalesce(array_agg(id),'{}') into cohorts from(select c.id from public.embryo_cohorts c where c.owner_account_id=p_account_id
  union select ps.cohort_id from public.embryo_participant_sets ps where ps.principal_id=any(principals))x;
 n:=(select count(*) from public.ancestry_regions where subject_id=any(subjects))
  +(select count(*) from public.attestation_contradictions where subject_id=any(subjects) or principal_id=any(principals) or cohort_id=any(cohorts))
  +(select count(*) from public.subject_control_refusal_authorities where subject_id=any(subjects) or principal_id=any(principals))
  +(select count(*) from public.suppressions where subject_id=any(subjects))
  +(select count(*) from public.report_artifacts where subject_id=any(subjects) or cohort_id=any(cohorts));
 return jsonb_build_object('version','export-writerless-classes-v1','rows',n);
end $function$;
revoke all on function public.own_export_writerless_rows_v1(uuid, uuid) from public, anon, authenticated, inherit_upload_only;
grant execute on function public.own_export_writerless_rows_v1(uuid, uuid) to service_role;

-- The predicate this branch added in 20261023100000 is replaced by the
-- projection above; nothing calls it after the patches below.
drop function private.export_subject_family_conversation_v1(uuid);

-- Guarded in-place patches, in order.
do $patch_export_completeness$
declare item record;definition text;before_acl aclitem[];
begin
 for item in select * from (values
  -- 1/2. Nothing left refuses with the stated reason.
  (1,'private.export_subject_joint_results_v1(uuid)','387df71020e0de94355ae38cc2139d91','ca2b57f4fd138c2d092f3838f7524049','{postgres=X/postgres}',
   $old$ -- 20261023100000: a family pair and a Portrait result are projected under
 -- live permission (private.export_subject_portrait_rows_v1); a live cohort
 -- role and a family conversation on the record still refuse.
 return private.export_subject_family_conversation_v1(p_subject)
  or exists(select 1 from public.embryo_cohorts c where c.status<>'purged' and (
   exists(select 1 from public.embryo_participant_sets ps join public.subject_principals sp on sp.id=ps.principal_id
    where ps.cohort_id=c.id and sp.subject_id=p_subject)
   or exists(select 1 from public.embryo_donor_attributions d join public.subject_principals sp on sp.id=d.donor_principal_id
    where d.cohort_id=c.id and sp.subject_id=p_subject)));$old$,
   $new$ -- 20261023110000 (owner decisions of 23 October): a pair, a Portrait
 -- result, the record's family group conversations and the account's own
 -- cohort records are all projected now. What remains is a canonical family
 -- conversation anchored on a pair naming the record: no writer makes one and
 -- this release has no projection for it, so it still refuses.
 return p_subject is not null and exists(select 1 from public.subjects s join public.chats ch on ch.user_id=s.subject_account_id
  join public.family_pairs fp on fp.id=ch.family_pair_id
  where s.id=p_subject and ch.scope_kind='family' and ch.legacy_unverified is false and p_subject in(fp.subject_a_id,fp.subject_b_id)
   and exists(select 1 from public.chat_messages m where m.chat_id=ch.id));$new$,
   'subject joint results'),
  -- 2. A cohort role no longer refuses the one-record export.
  (2,'private.export_subject_scope_v1(jsonb,uuid)','fe31c38687c4f5dba894d687c7e72d5c','b9cf572a0acb97a94f4f187a012202d3','{postgres=X/postgres}',
   $old$ if private.export_subject_cohort_role_v1(s.id) then
  raise exception using errcode='0A000',message='export_partition_projection_unavailable';end if;$old$,
   $new$ -- 20261023110000: a cohort role no longer refuses; the self record
 -- carries the account's own cohort records and no embryo results.$new$,
   'subject scope'),
  (3,'private.export_subject_graph_capture_v1(uuid,jsonb)','23a4c87eb5002d72e9816009021079bd','27ec5e70b113d228e3fc8fff676cdd0b','{postgres=X/postgres}',
   $old$ -- One subject's export has no cohort partition at all. Its scope check has
 -- already refused any cohort role of this subject; this repeats it here so
 -- the graph can never be captured around one.
 if private.export_subject_cohort_role_v1(anchor) then
  raise exception using errcode='0A000',message='export_partition_projection_unavailable';end if;$old$,
   $new$ -- 20261023110000: the self record routes the account's own cohort rows
 -- (export_subject_graph_projection_v1); there is still no cohort partition.$new$,
   'subject graph capture'),
  (4,'private.export_subject_graph_projection_v1(uuid,uuid[],text)','b3d75d95193c0c6a752ba21ba23155e0','127d23a68878b575b04456ed9bf7841b','{postgres=X/postgres}',
   $old$ elsif p_kind in('embryo_cohorts','embryo_basis_bindings','embryo_participant_sets','embryo_donor_attributions',
  'embryo_disposition_proposals','embryo_disposition_confirmations') then return;$old$,
   $new$ elsif p_kind in('embryo_cohorts','embryo_basis_bindings','embryo_participant_sets','embryo_donor_attributions',
  'embryo_disposition_proposals','embryo_disposition_confirmations') then
  -- 20261023110000: the account's own cohort records, redacted as in the
  -- whole-account export, for the account's self record only.
  if exists(select 1 from public.subjects s where s.id=p_subjects[1] and s.subject_class='self' and s.subject_account_id=p_account) then
   return query select x.projected_key,x.projected_row from private.export_account_graph_projection_v1(p_account,p_subjects,p_kind)x;
  end if;
  return;$new$,
   'subject graph projection'),
  (5,'private.export_subject_history_projection_v1(uuid,uuid[],text)','59bb66b368b8769f0e4de3bc7cf87003','1418f196abefb0de5d26d6b1c31f0de8','{postgres=X/postgres}',
   $old$   where x.projected_row->>'target_kind'='subject' and x.projected_row->>'target_id'=p_subjects[1]::text;$old$,
   $new$   where (x.projected_row->>'target_kind'='subject' and x.projected_row->>'target_id'=p_subjects[1]::text)
    -- 20261023110000: the self record also carries the account's own cohort
    -- signatures and attestations.
    or (x.projected_row->>'target_kind' in('cohort','cohort_draft','donor_attribution')
     and exists(select 1 from public.subjects s where s.id=p_subjects[1] and s.subject_class='self' and s.subject_account_id=p_account));$new$,
   'subject history projection'),
  (6,'private.export_subject_class_inventory_v1(uuid,jsonb)','8eda83e8821d527d0f1985e38b893a80','4c56e0db2f05075fc393b4d8e815b9bb','{postgres=X/postgres}',
   $old$ select array_agg(id order by id) into cohorts from(select s.cohort_id id from public.embryo_participant_sets s join public.subject_principals p on p.id=s.principal_id where p.subject_id=any(subjects)
  union select d.cohort_id from public.embryo_donor_attributions d join public.subject_principals p on p.id=d.donor_principal_id where p.subject_id=any(subjects))x;$old$,
   $new$ select array_agg(id order by id) into cohorts from(select s.cohort_id id from public.embryo_participant_sets s join public.subject_principals p on p.id=s.principal_id where p.subject_id=any(subjects)
  union select d.cohort_id from public.embryo_donor_attributions d join public.subject_principals p on p.id=d.donor_principal_id where p.subject_id=any(subjects)
  -- 20261023110000: the self record also sees the account's own cohorts.
  union select c.id from public.embryo_cohorts c where c.owner_account_id=p_account
   and exists(select 1 from public.subjects r where r.id=any(subjects) and r.subject_class='self' and r.subject_account_id=p_account)
  union select s.cohort_id from public.embryo_participant_sets s join public.subject_principals p on p.id=s.principal_id where p.account_id=p_account
   and exists(select 1 from public.subjects r where r.id=any(subjects) and r.subject_class='self' and r.subject_account_id=p_account))x;$new$,
   'one-record class inventory'),
  -- 1. The one-record capture binds its family conversation turns.
  (7,'private.export_account_owned_capture_pre_requester_v1(jsonb,text,uuid)','be85c35c4d6996088bb0498856da1ff6','1fc9c2b4e5c05b72857e628c1854deb4','{postgres=X/postgres}',
   $old$declare captured jsonb;classes jsonb;receipt text;$old$,
   $new$declare captured jsonb;classes jsonb;receipt text;conversations jsonb;$new$,
   'class inventory capture declarations'),
  (8,'private.export_account_owned_capture_pre_requester_v1(jsonb,text,uuid)','1fc9c2b4e5c05b72857e628c1854deb4','32b11ad705abb2fea5b67d90a3bd6b0b','{postgres=X/postgres}',
   $old$ receipt:=encode(extensions.digest(jsonb_build_object('version','account-class-inventory-v1','capture',captured,'classes',classes)::text,'sha256'),'hex');
 return jsonb_set(captured,'{authority,authorityReceipt}',to_jsonb(receipt))||jsonb_build_object('classInventory',classes);$old$,
   $new$ -- 20261023110000: a one-record export also binds its family conversation turns.
 if p_target_kind='subject' then conversations:=private.export_subject_family_turn_capture_v1(p_origin,p_target_id);end if;
 receipt:=encode(extensions.digest((jsonb_build_object('version','account-class-inventory-v1','capture',captured,'classes',classes)
  ||case when conversations is null then '{}'::jsonb else jsonb_build_object('familyConversations',conversations) end)::text,'sha256'),'hex');
 return jsonb_set(captured,'{authority,authorityReceipt}',to_jsonb(receipt))||jsonb_build_object('classInventory',classes)
  ||case when conversations is null then '{}'::jsonb else jsonb_build_object('familyConversations',conversations) end;$new$,
   'class inventory capture'),
  -- 1. The content door pages the turns for a subject job.
  (9,'public.export_archive_account_content_v1(text,uuid,uuid,text,jsonb)','25ab819a16105020897e9c0cf7e1fef1','da176e225a91f83004f65d02f8375243','{postgres=X/postgres,service_role=X/postgres}',
   $old$ if p_operation is null or p_operation not in('history','chats','chat-messages','check','variants','observed','reports','prs','ancestry')$old$,
   $new$ if p_operation is null or p_operation not in('history','chats','chat-messages','check','variants','observed','reports','prs','ancestry','family-turns')$new$,
   'content door operations'),
  (10,'public.export_archive_account_content_v1(text,uuid,uuid,text,jsonb)','da176e225a91f83004f65d02f8375243','08da915036328b359af391e1dc7d08ac','{postgres=X/postgres,service_role=X/postgres}',
   $old$ result:=public.export_archive_content_v1(p_operation,p_export_id,p_attempt_id,p_authority_receipt,p_payload);$old$,
   $new$ if p_operation='family-turns' then
  -- 20261023110000: one page of the record's current family conversation
  -- turns, for a one-record job only, after the captured key.
  if permit->>'targetKind' is distinct from 'subject' or p_payload-'afterKey'<>'{}'::jsonb or not(p_payload ? 'afterKey')
   or (p_payload->'afterKey'<>'null'::jsonb and (jsonb_typeof(p_payload->'afterKey') is distinct from 'array'
    or jsonb_array_length(p_payload->'afterKey')<>3 or coalesce(p_payload->'afterKey'->>0,'')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(p_payload->'afterKey'->>1,'')!~'^[1-9][0-9]{0,17}$' or coalesce(p_payload->'afterKey'->>2,'') not in('0','1')))
   or jsonb_typeof(capture->'familyConversations') is distinct from 'object' then
   raise exception using errcode='22023',message='invalid_request';end if;
  select jsonb_build_object('version','account-family-turns-page-v1','membership',capture->'familyConversations',
   'rows',coalesce(jsonb_agg(jsonb_build_object('identity',x.projected_key::text,'rowText',x.projected_row::text) order by x.k0,x.k1,x.k2),'[]'),
   'nextAfterKey',case when count(*)=25 then (array_agg(x.projected_key order by x.k0 desc,x.k1 desc,x.k2 desc))[1] else 'null'::jsonb end)
   into result from(select r.projected_key,r.projected_row,(r.projected_key->>0)::uuid k0,(r.projected_key->>1)::bigint k1,(r.projected_key->>2)::integer k2
    from private.export_subject_family_turn_rows_v1(permit->'origin',(permit->>'targetId')::uuid) r
    where p_payload->'afterKey'='null'::jsonb or ((r.projected_key->>0)::uuid,(r.projected_key->>1)::bigint,(r.projected_key->>2)::integer)
     >((p_payload->'afterKey'->>0)::uuid,(p_payload->'afterKey'->>1)::bigint,(p_payload->'afterKey'->>2)::integer)
    order by 3,4,5 limit 25)x;
 else
  result:=public.export_archive_content_v1(p_operation,p_export_id,p_attempt_id,p_authority_receipt,p_payload);
 end if;$new$,
   'content door turns'),
  -- 2. The whole-account export carries the parent's own cohort records.
  (11,'private.export_account_owned_capture_pre_member_frame_v1(jsonb,text,uuid)','65c53bbe4787500a69c764f2bd50951f','59330a34da35d934bdf3f429fea99586','{postgres=X/postgres}',
   $old$  if exists(select 1 from public.subjects where owner_account_id=a and lifecycle<>'purged'
    and (subject_account_id is distinct from a or (subject_class not in ('self','other_adult')
      and not(subject_class='embryo' and lifecycle='claimed_bound' and owner_account_id=a))))
   or exists(select 1 from public.subjects where subject_account_id=a and lifecycle<>'purged'
    and subject_class not in ('self','other_adult')
    and not(subject_class='embryo' and lifecycle='claimed_bound' and owner_account_id=a))
   or exists(select 1 from public.embryo_cohorts c where c.status<>'purged' and (c.owner_account_id=a or exists(
    select 1 from public.embryo_participant_sets ps join public.subject_principals sp on sp.id=ps.principal_id
     where ps.cohort_id=c.id and sp.account_id=a and ps.revoked_at is null)))
   or exists($old$,
   $new$  -- 20261023110000: an owned embryo record and a live cohort role no longer
  -- refuse. The account's own cohort records leave through the graph; the
  -- embryos are not partitions, so no embryo result leaves.
  if exists(select 1 from public.subjects where owner_account_id=a and lifecycle<>'purged'
    and not(subject_class='embryo' and lifecycle<>'claimed_bound')
    and (subject_account_id is distinct from a or (subject_class not in ('self','other_adult')
      and not(subject_class='embryo' and lifecycle='claimed_bound' and owner_account_id=a))))
   or exists(select 1 from public.subjects where subject_account_id=a and lifecycle<>'purged'
    and subject_class not in ('self','other_adult')
    and not(subject_class='embryo' and lifecycle='claimed_bound' and owner_account_id=a))
   or exists($new$,
   'account member frame'),
  (12,'private.export_account_graph_capture_v1(uuid,jsonb)','26513cf7d20ed98f3fb4316283a96e14','704b14605825d33cd0c794cdd7a78e09','{postgres=X/postgres}',
   $old$ -- This release has no complete parent-cohort scientific partition. Physical
 -- foreign/revoked cohort membership never becomes a read grant. The original
 -- non-purged cohort refusal remains; retained cohort science is refused too.
 if exists(select 1 from public.embryos e join public.embryo_cohorts c on c.id=e.cohort_id
  where c.owner_account_id=p_account or exists(select 1 from public.embryo_participant_sets ps
   join public.subject_principals sp on sp.id=ps.principal_id where ps.cohort_id=c.id and sp.account_id=p_account)) then
  raise exception using errcode='0A000',message='export_partition_projection_unavailable';end if;$old$,
   $new$ -- 20261023110000: there is still no parent-cohort scientific partition.
 -- The account's own cohort records are routed below; embryo results are
 -- left out (owner decision, 23 October), not refused.$new$,
   'account graph capture'),
  -- 5. The TEST complete archive's Portrait rows, minimally.
  (13,'private.account_archive_complete_class_rows_v1(jsonb,jsonb,jsonb,text)','bf340049d6858f1f7f8c6b21f0886bd7','d6517d477aefe2ef1fdf6f4ee6d558c9','{postgres=X/postgres}',
   $old$   identity:=r.id::text;subject_id:=sid;row_text:=to_jsonb(r)::text;return next;$old$,
   $new$   -- 20261023110000: the record's own fields only; a result holding an
   -- identifier refuses, as in the one-record export.
   if jsonb_typeof(r.result) is distinct from 'object'
    or r.result::text~*'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' then
    raise exception using errcode='0A000',message='export_class_projection_unavailable';end if;
   identity:=r.id::text;subject_id:=sid;row_text:=jsonb_build_object('id',r.id,'family_pair_id',r.family_pair_id,'kind',r.kind,
    'trait_key',r.trait_key,'result',r.result,'coverage',r.coverage,'method_version',r.method_version,
    'computation_revision',r.computation_revision,'computed_at',r.computed_at)::text;return next;$new$,
   'complete archive portrait rows')
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
$patch_export_completeness$;
