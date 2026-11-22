-- =====================================================================
-- PRODUCTION RELEASE: GUARDED. This migration is applied to local and CI
-- databases only. It must reach a hosted database through the guarded
-- production release (preflight, postflight, receipt), never as a side
-- effect of a merge. Both Path B flows are reached only under the test
-- jurisdiction: every real jurisdiction is unreviewed for the capabilities
-- that create an adult-subject invitation, so in production no Path B record
-- exists and nothing patched here is reachable. It follows 20260930220000
-- (the reading layer whose bodies it patches), 20261001039000 and
-- 20261122160000 (the export bodies and the two transfer helpers it patches),
-- 20261016190000 (the reviewed-document flow and its confirmation),
-- 20261120130000 (the Copilot authority it patches) and 20261122170000 (the
-- mitigation decision, which already reads both flows); it goes into
-- release 4 after 20261122170000.
-- =====================================================================
--
-- D-165 (docs/protocol/defects.md, 22 November 2026): Path B readers other
-- than the mitigation decision recognise only e-signature records. Path B has
-- two confirmation flows: path-b-subject-esignature and
-- path-b-reviewed-document (20261016190000: a permission document the person
-- signed, read in full and approved by a named reviewer before any request is
-- sent). Each reader below joined drafts of the e-signature flow only, so a
-- reviewed-document record reached none of them: its person could not share
-- with the uploader from their choices page, the uploader's reads stopped
-- there, its held files, Copilot authority and account export did not see
-- it, and before and after a transfer the person could export neither the
-- record nor their whole account, so the approved transfer line "You can
-- make a new one." was not true for it.
--
-- What "confirmed" means for a reviewed document. Its draft reaches
-- state 'confirmed' only in the two confirmation transactions
-- (private.confirm_path_b_subject_v1 and its account branch), and only after
-- private.path_b_reviewed_document_basis_current_v1 holds: the request is
-- bound to the exact clean document and to the named reviewer's approval of
-- its exact hash and revision (private.path_b_reviewed_document_approval_v1).
-- The uploader can send the request only after that approval
-- (draft -> invited), and a decided review is final
-- (private.guard_permission_document_transition_v1). A document refused by
-- its reviewer cancels the draft and purges the record; a document not yet
-- approved, or a request the person has not confirmed, leaves the draft
-- 'draft' or 'invited'. So a confirmed reviewed-document draft is one the
-- person confirmed on a document a reviewer approved, and every lookup here
-- takes it exactly where it took a confirmed e-signature draft, as the
-- decision does since 20261122170000 (D-154). Where the e-signature lookup
-- named no state (the purged-grant cleanup, the account-deletion refusal of
-- a grant, the appeal's recheck, which then asks the confirmed binding), the
-- widened lookup names none either. Where a body also pairs the flow with its
-- evidence kind, the reviewed-document flow is paired with its own
-- (uploaded_document), as private.path_b_subject_v1 pairs them.
--
-- Fifteen bodies are patched in place, one anchor each (the appeal's
-- resolution has two), and nothing else in them changes:
--   - the person's read (private.path_b_person_v1: sharing, reports and the
--     export capture), the choices page (private.path_b_person_choices_v1),
--     the uploader's shares (private.path_b_uploader_shares_v1), the saved
--     results metadata (private.path_b_report_metadata_v1), the held files
--     (private.subject_held_files_v1) and the uploader's one-record Copilot
--     (private.subject_copilot_authority_v1);
--   - the account export: the Path B test of a file
--     (private.export_account_path_b_file_v1), the person's saved results
--     (private.export_account_path_b_snapshot_v1), the capture of the record
--     (private.export_account_ordinary_readable_authority_v1), and for a
--     transferred record the two helpers 20261122160000 added
--     (private.transferred_export_person_v1,
--     private.transferred_export_confirmation_v1);
--   - the held-upload job's first pass, which deletes the Path B records of a
--     person who asked to delete their account
--     (public.expire_due_other_adult_held_uploads_v1), and the purged-grant
--     cleanup (private.end_purged_path_b_grants_v1);
--   - two more readers found by searching every body for the e-signature
--     flow: the public appeal's resolution of a subject objection
--     (private.public_appeal_provisional_binding_v1) and account deletion's
--     refusal of a grant on a Path B record
--     (private.assert_account_path_b_deletion_supported_v1).
-- Not changed: the held-upload job's last pass, which expires e-signature
-- drafts never requested (a reviewed-document draft has its own sweep,
-- public.expire_due_path_b_reviewed_documents_v1); the e-signature flow's own
-- doors; and the readers that already read both flows (the original download
-- authority, the account export gate, the decision, the transfer, the
-- withdrawal, the delete door, the upload list and the uploader's
-- confirmation read, private.path_b_subject_v1).
--
-- Every body is patched in place under the md5-guarded convention: the exact
-- predecessor md5 and ACL, one anchor each, the successor md5 and unchanged
-- ACL, volatility and owner asserted (55000 otherwise); a postflight asserts
-- the fifteen successors.

do $predecessor$
begin
 if (select count(distinct x.signature) from pg_proc p join (values
   ('private.path_b_person_v1(uuid,uuid,uuid)','9f0434499b394a5c8ece4151838918e3','{postgres=X/postgres}'),
   ('private.path_b_person_choices_v1(uuid,uuid,boolean)','88fdc054ac411342681e08a38834996f','{postgres=X/postgres,service_role=X/postgres}'),
   ('private.path_b_uploader_shares_v1(uuid,uuid,boolean)','4791a74ac0dd7f919a69cd4899f7a158','{postgres=X/postgres,service_role=X/postgres}'),
   ('private.path_b_report_metadata_v1(uuid,uuid,uuid,boolean)','057612020df71da9eeedc4e4212e546a','{postgres=X/postgres,service_role=X/postgres}'),
   ('private.subject_held_files_v1(uuid,uuid,boolean)','807a31dda5b3c9ed7a674ad37996e519','{postgres=X/postgres,service_role=X/postgres}'),
   ('private.subject_copilot_authority_v1(uuid,uuid,uuid)','835e5f67cb5ef03e9f97735de1aeeb10','{postgres=X/postgres}'),
   ('private.export_account_path_b_file_v1(uuid)','71e1c10e7b5410f4cb4b77c7ccc10577','{postgres=X/postgres}'),
   ('private.export_account_path_b_snapshot_v1(jsonb,uuid)','b9ae87c681a443f9ac3fb1846a69520b','{postgres=X/postgres}'),
   ('private.export_account_ordinary_readable_authority_v1(jsonb,text,uuid)','583e9efa4a60f086e3875fc40e03f491','{postgres=X/postgres}'),
   ('private.transferred_export_person_v1(uuid,uuid,uuid)','80421178d9b4e5fc38f5090756770096','{postgres=X/postgres}'),
   ('private.transferred_export_confirmation_v1(uuid)','0f903e4ee3b7eaf66f226174a7030a80','{postgres=X/postgres}'),
   ('public.expire_due_other_adult_held_uploads_v1()','5120605e1f785010cbc13deffcbbe5aa','{postgres=X/postgres,service_role=X/postgres}'),
   ('private.end_purged_path_b_grants_v1()','0add773cff4bad835ea35bcf80d7a4fc','{postgres=X/postgres}'),
   ('private.public_appeal_provisional_binding_v1(uuid)','d4b8500ac4a7e6ac2ff76e642ebd0353','{postgres=X/postgres}'),
   ('private.assert_account_path_b_deletion_supported_v1(uuid)','8ef417e756e4b632b6a97c39538c7ee4','{postgres=X/postgres}'),
   -- What makes a confirmed reviewed-document draft one approved by a named
   -- reviewer (20261016190000, unchanged): the confirmation's basis check, the
   -- approval it reads, and the finality of a decided review.
   ('private.path_b_reviewed_document_basis_current_v1(uuid,uuid)','43f3bf4e7782e176523b12851fa6b97b','{postgres=X/postgres}'),
   ('private.path_b_reviewed_document_approval_v1(uuid,uuid,uuid)','ab0681555da11ebc1f9c3c456d95e76e','{postgres=X/postgres}'),
   ('private.guard_permission_document_transition_v1()','8631df4b82bcc03e8acfa8de6f07798d','{postgres=X/postgres}'),
   -- The uploader's confirmation read, which the capture and the appeal's
   -- recheck keep calling and which already reads both flows.
   ('private.path_b_subject_v1(uuid,uuid)','d174a83682e35479797ac7e738a65d79','{postgres=X/postgres,service_role=X/postgres}')
  ) as x(signature,body,acl) on p.oid=to_regprocedure(x.signature) and md5(pg_get_functiondef(p.oid))=x.body
   and p.proacl::text=x.acl)<>19
  -- The draft table: exactly Path A and the two Path B flows, each flow with
  -- its own evidence kind, and the five draft states (20261016190000).
  or (select string_agg(c.conname||' '||md5(pg_get_constraintdef(c.oid)),',' order by c.conname) from pg_constraint c
   where c.conrelid='public.adult_subject_drafts'::regclass and c.contype='c' and c.convalidated
    and c.conname in('adult_subject_drafts_adult_flow_check','adult_subject_drafts_flow_check','adult_subject_drafts_state_check'))
   is distinct from 'adult_subject_drafts_adult_flow_check 5c8b24f18ac62ac45cd1c1647bdd2466,'
    ||'adult_subject_drafts_flow_check 40cf5a7d87b6855d74985956133cc797,'
    ||'adult_subject_drafts_state_check 1b051566996b3857dcc34e514d4185e0' then
  raise exception using errcode='55000',message='path b reviewed document readers prerequisite differs'; end if;
end;
$predecessor$;

do $patch_readers$
declare item record;definition text;before_acl aclitem[];before_volatile "char";before_owner oid;
begin
 for item in select * from (values
  -- The person's own read of a Path B record (sharing, reports, exports).
  (1,'private.path_b_person_v1(uuid,uuid,uuid)','9f0434499b394a5c8ece4151838918e3',
   'd4293c9003c615825bb81ca391067ca9','{postgres=X/postgres}',
   $old$  and d.adult_flow='path-b-subject-esignature' and d.state='confirmed') then
$old$,
   $new$  -- 20261122180000 (D-165): a confirmed draft of either Path B flow.
  and d.adult_flow in('path-b-subject-esignature','path-b-reviewed-document') and d.state='confirmed') then
$new$,
   'person read'),
  -- The person's choices page.
  (2,'private.path_b_person_choices_v1(uuid,uuid,boolean)','88fdc054ac411342681e08a38834996f',
   '8f21a23d1a1a16360c0107d6fb26a06c','{postgres=X/postgres,service_role=X/postgres}',
   $old$  join public.adult_subject_drafts d on d.subject_id=s.id and d.adult_flow='path-b-subject-esignature'
   and d.state='confirmed'
$old$,
   $new$  -- 20261122180000 (D-165): a confirmed draft of either Path B flow.
  join public.adult_subject_drafts d on d.subject_id=s.id
   and d.adult_flow in('path-b-subject-esignature','path-b-reviewed-document')
   and d.state='confirmed'
$new$,
   'person choices'),
  -- The uploader's list of what each person shared with them.
  (3,'private.path_b_uploader_shares_v1(uuid,uuid,boolean)','4791a74ac0dd7f919a69cd4899f7a158',
   'b9439ab870b3699821089de38c4b4d6a','{postgres=X/postgres,service_role=X/postgres}',
   $old$  join public.adult_subject_drafts d on d.subject_id=s.id and d.adult_flow='path-b-subject-esignature'
   and d.state='confirmed'
$old$,
   $new$  -- 20261122180000 (D-165): a confirmed draft of either Path B flow.
  join public.adult_subject_drafts d on d.subject_id=s.id
   and d.adult_flow in('path-b-subject-esignature','path-b-reviewed-document')
   and d.state='confirmed'
$new$,
   'uploader shares'),
  -- The saved-results metadata, for the uploader and the person.
  (4,'private.path_b_report_metadata_v1(uuid,uuid,uuid,boolean)','057612020df71da9eeedc4e4212e546a',
   'f62bef1989ac48e4c55ec42710b6d235','{postgres=X/postgres,service_role=X/postgres}',
   $old$   and d.adult_flow='path-b-subject-esignature' and d.state='confirmed') order by sub.id for share
$old$,
   $new$   -- 20261122180000 (D-165): a confirmed draft of either Path B flow.
   and d.adult_flow in('path-b-subject-esignature','path-b-reviewed-document') and d.state='confirmed') order by sub.id for share
$new$,
   'report metadata'),
  -- The person's held files.
  (5,'private.subject_held_files_v1(uuid,uuid,boolean)','807a31dda5b3c9ed7a674ad37996e519',
   '4d4ed19c94e72ab160882b759470954e','{postgres=X/postgres,service_role=X/postgres}',
   $old$  join public.adult_subject_drafts d on d.subject_id=s.id and d.adult_flow='path-b-subject-esignature'
   and d.state='confirmed'
$old$,
   $new$  -- 20261122180000 (D-165): a confirmed draft of either Path B flow.
  join public.adult_subject_drafts d on d.subject_id=s.id
   and d.adult_flow in('path-b-subject-esignature','path-b-reviewed-document')
   and d.state='confirmed'
$new$,
   'held files'),
  -- The uploader's one-record Copilot.
  (6,'private.subject_copilot_authority_v1(uuid,uuid,uuid)','835e5f67cb5ef03e9f97735de1aeeb10',
   '6e29a3a6e809e5d0b1db9df42847abe5','{postgres=X/postgres}',
   $old$   and d.adult_flow='path-b-subject-esignature' and d.state='confirmed') then
$old$,
   $new$   -- 20261122180000 (D-165): a confirmed draft of either Path B flow.
   and d.adult_flow in('path-b-subject-esignature','path-b-reviewed-document') and d.state='confirmed') then
$new$,
   'copilot authority'),
  -- The account export's Path B test of a file.
  (7,'private.export_account_path_b_file_v1(uuid)','71e1c10e7b5410f4cb4b77c7ccc10577',
   'e061731060ee8f717c4f97409c7706dc','{postgres=X/postgres}',
   $old$   and d.adult_flow='path-b-subject-esignature' and d.state='confirmed');
$old$,
   $new$   -- 20261122180000 (D-165): a confirmed draft of either Path B flow.
   and d.adult_flow in('path-b-subject-esignature','path-b-reviewed-document') and d.state='confirmed');
$new$,
   'export path b file'),
  -- The person's saved results of a Path B record, in either capture.
  (8,'private.export_account_path_b_snapshot_v1(jsonb,uuid)','b9ae87c681a443f9ac3fb1846a69520b',
   'e2d07abe4aa844c3c3a913e18be72015','{postgres=X/postgres}',
   $old$   and d.adult_flow='path-b-subject-esignature' and d.state='confirmed') then
$old$,
   $new$   -- 20261122180000 (D-165): a confirmed draft of either Path B flow.
   and d.adult_flow in('path-b-subject-esignature','path-b-reviewed-document') and d.state='confirmed') then
$new$,
   'export snapshot'),
  -- The whole-account and per-record capture of a Path B record.
  (9,'private.export_account_ordinary_readable_authority_v1(jsonb,text,uuid)','583e9efa4a60f086e3875fc40e03f491',
   '5c9fee7018806a025ad537664cd23b69','{postgres=X/postgres}',
   $old$    and d.adult_flow='path-b-subject-esignature' and d.evidence_kind='esignature'
$old$,
   $new$    -- 20261122180000 (D-165): a confirmed draft of either Path B flow, each with its own evidence.
    and ((d.adult_flow='path-b-subject-esignature' and d.evidence_kind='esignature')
     or (d.adult_flow='path-b-reviewed-document' and d.evidence_kind='uploaded_document'))
$new$,
   'export readable authority'),
  -- The person of a transferred record, and its confirmation (20261122160000).
  (10,'private.transferred_export_person_v1(uuid,uuid,uuid)','80421178d9b4e5fc38f5090756770096',
   '5b185a02a35c00b04a43457f2cd08f6e','{postgres=X/postgres}',
   $old$   and d.owner_account_id=t.from_account_id and d.adult_flow='path-b-subject-esignature' and d.state='confirmed') then
$old$,
   $new$   -- 20261122180000 (D-165): the confirmed request of either Path B flow.
   and d.owner_account_id=t.from_account_id
   and d.adult_flow in('path-b-subject-esignature','path-b-reviewed-document') and d.state='confirmed') then
$new$,
   'transferred person'),
  (11,'private.transferred_export_confirmation_v1(uuid)','0f903e4ee3b7eaf66f226174a7030a80',
   '4010fc23e2ff05c5fe3c29a774fdc3a9','{postgres=X/postgres}',
   $old$  and adult_flow='path-b-subject-esignature' and evidence_kind='esignature' and state='confirmed' for share;
$old$,
   $new$  -- 20261122180000 (D-165): the confirmed request of either Path B flow, each with its own evidence.
  and ((adult_flow='path-b-subject-esignature' and evidence_kind='esignature')
   or (adult_flow='path-b-reviewed-document' and evidence_kind='uploaded_document'))
  and state='confirmed' for share;
$new$,
   'transferred confirmation'),
  -- The held-upload job: a person who asked to delete their account.
  (12,'public.expire_due_other_adult_held_uploads_v1()','5120605e1f785010cbc13deffcbbe5aa',
   '591682cc0b9c9377cb8dbeeef44b18b5','{postgres=X/postgres,service_role=X/postgres}',
   $old$  where d.adult_flow='path-b-subject-esignature' and d.state='confirmed' and s.lifecycle='active'
$old$,
   $new$  -- 20261122180000 (D-165): a confirmed record of either Path B flow.
  where d.adult_flow in('path-b-subject-esignature','path-b-reviewed-document') and d.state='confirmed' and s.lifecycle='active'
$new$,
   'held-upload expiry'),
  -- The purged-grant cleanup.
  (13,'private.end_purged_path_b_grants_v1()','0add773cff4bad835ea35bcf80d7a4fc',
   '5163b00a8509ac4a28f9708ae1118258','{postgres=X/postgres}',
   $old$  and d.adult_flow='path-b-subject-esignature') then return null; end if;
$old$,
   $new$  -- 20261122180000 (D-165): a record of either Path B flow.
  and d.adult_flow in('path-b-subject-esignature','path-b-reviewed-document')) then return null; end if;
$new$,
   'purged-grant cleanup'),
  -- The public appeal's resolution of a subject objection.
  (14,'private.public_appeal_provisional_binding_v1(uuid)','d4b8500ac4a7e6ac2ff76e642ebd0353',
   'e05639a338708b169bb878a8d8e6ca0a','{postgres=X/postgres}',
   $old$      and ((d.adult_flow='path-b-subject-esignature' and artifact.artifact_key='consent.subject-adult-esignature'
$old$,
   $new$      -- 20261122180000 (D-165): the Path B confirmation of either flow (the person signs the same text).
      and ((d.adult_flow in('path-b-subject-esignature','path-b-reviewed-document') and artifact.artifact_key='consent.subject-adult-esignature'
$new$,
   'appeal binding confirmation'),
  (15,'private.public_appeal_provisional_binding_v1(uuid)','e05639a338708b169bb878a8d8e6ca0a',
   '7d7b1f82a7703c625b5695ba2aad57b4','{postgres=X/postgres}',
   $old$    if signature_id is not null and exists(select 1 from public.adult_subject_drafts d where d.subject_id=subject_row.id and d.adult_flow='path-b-subject-esignature') then
$old$,
   $new$    -- 20261122180000 (D-165): a record of either Path B flow is rechecked against its confirmed binding.
    if signature_id is not null and exists(select 1 from public.adult_subject_drafts d where d.subject_id=subject_row.id
      and d.adult_flow in('path-b-subject-esignature','path-b-reviewed-document')) then
$new$,
   'appeal binding recheck'),
  -- Account deletion's refusal of a grant on a Path B record.
  (16,'private.assert_account_path_b_deletion_supported_v1(uuid)','8ef417e756e4b632b6a97c39538c7ee4',
   '4f06febdcbf2b30205cdc312045c98ce','{postgres=X/postgres}',
   $old$        where d.subject_id=g.target_id and d.adult_flow='path-b-subject-esignature'))
$old$,
   $new$        -- 20261122180000 (D-165): a grant on a record of either Path B flow.
        where d.subject_id=g.target_id and d.adult_flow in('path-b-subject-esignature','path-b-reviewed-document')))
$new$,
   'deletion guard grants')
 ) as patch(ordinal,target,before_md5,after_md5,acl,old_fragment,new_fragment,label) order by ordinal loop
  select pg_get_functiondef(p.oid),p.proacl,p.provolatile,p.proowner into definition,before_acl,before_volatile,before_owner
   from pg_proc p where p.oid=item.target::regprocedure and md5(pg_get_functiondef(p.oid))=item.before_md5 and p.proacl::text=item.acl;
  if definition is null then raise exception using errcode='55000',message=item.label||' predecessor differs';end if;
  if (length(definition)-length(replace(definition,item.old_fragment,'')))/length(item.old_fragment)<>1 then
   raise exception using errcode='55000',message=item.label||' anchor differs';end if;
  execute replace(definition,item.old_fragment,item.new_fragment);
  if not exists(select 1 from pg_proc p where p.oid=item.target::regprocedure and md5(pg_get_functiondef(p.oid))=item.after_md5
    and p.proacl is not distinct from before_acl and p.provolatile=before_volatile and p.proowner=before_owner) then
   raise exception using errcode='55000',message=item.label||' successor differs';end if;
 end loop;
end;
$patch_readers$;

-- Postflight: the fifteen patched bodies as written, each with its ACL.
do $postflight$
begin
 if (select count(distinct x.signature) from pg_proc p join (values
   ('private.path_b_person_v1(uuid,uuid,uuid)','d4293c9003c615825bb81ca391067ca9','{postgres=X/postgres}'),
   ('private.path_b_person_choices_v1(uuid,uuid,boolean)','8f21a23d1a1a16360c0107d6fb26a06c','{postgres=X/postgres,service_role=X/postgres}'),
   ('private.path_b_uploader_shares_v1(uuid,uuid,boolean)','b9439ab870b3699821089de38c4b4d6a','{postgres=X/postgres,service_role=X/postgres}'),
   ('private.path_b_report_metadata_v1(uuid,uuid,uuid,boolean)','f62bef1989ac48e4c55ec42710b6d235','{postgres=X/postgres,service_role=X/postgres}'),
   ('private.subject_held_files_v1(uuid,uuid,boolean)','4d4ed19c94e72ab160882b759470954e','{postgres=X/postgres,service_role=X/postgres}'),
   ('private.subject_copilot_authority_v1(uuid,uuid,uuid)','6e29a3a6e809e5d0b1db9df42847abe5','{postgres=X/postgres}'),
   ('private.export_account_path_b_file_v1(uuid)','e061731060ee8f717c4f97409c7706dc','{postgres=X/postgres}'),
   ('private.export_account_path_b_snapshot_v1(jsonb,uuid)','e2d07abe4aa844c3c3a913e18be72015','{postgres=X/postgres}'),
   ('private.export_account_ordinary_readable_authority_v1(jsonb,text,uuid)','5c9fee7018806a025ad537664cd23b69','{postgres=X/postgres}'),
   ('private.transferred_export_person_v1(uuid,uuid,uuid)','5b185a02a35c00b04a43457f2cd08f6e','{postgres=X/postgres}'),
   ('private.transferred_export_confirmation_v1(uuid)','4010fc23e2ff05c5fe3c29a774fdc3a9','{postgres=X/postgres}'),
   ('public.expire_due_other_adult_held_uploads_v1()','591682cc0b9c9377cb8dbeeef44b18b5','{postgres=X/postgres,service_role=X/postgres}'),
   ('private.end_purged_path_b_grants_v1()','5163b00a8509ac4a28f9708ae1118258','{postgres=X/postgres}'),
   ('private.public_appeal_provisional_binding_v1(uuid)','7d7b1f82a7703c625b5695ba2aad57b4','{postgres=X/postgres}'),
   ('private.assert_account_path_b_deletion_supported_v1(uuid)','4f06febdcbf2b30205cdc312045c98ce','{postgres=X/postgres}')
  ) as x(signature,body,acl) on p.oid=to_regprocedure(x.signature) and md5(pg_get_functiondef(p.oid))=x.body
   and p.proacl::text=x.acl)<>15 then
  raise exception using errcode='55000',message='path b reviewed document readers successor differs'; end if;
end;
$postflight$;

notify pgrst, 'reload schema';
