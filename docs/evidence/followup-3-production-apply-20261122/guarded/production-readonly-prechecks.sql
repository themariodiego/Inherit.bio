-- Read-only pre-checks for guarded release 4 (the 21 migrations 20261119110000 ..
-- 20261122200000; one SELECT, one jsonb row; writes nothing). Run AFTER releases 1-3 are
-- applied, merged and deployed (release 3's batch-2 post-state read back EQUAL, and code
-- with release 3's migration tree be49d283 deployed), BEFORE this release's dry runs.
-- Run: python3 -I ../api/api-run.py production-readonly-prechecks.sql $R/prechecks --json-column prechecks
--  (or psql "$DB" -X -q -At -v ON_ERROR_STOP=1 -f production-readonly-prechecks.sql).
-- Written by ../rehearsal/scripts/make-prechecks.py. "guards" re-runs, read-only and in this
-- session's settings (the ones the batches restore before each migration), every md5 pin of
-- the 21 files on a function body that exists before this release and that no earlier
-- migration of the release changes (87 functions; "measure" def is
-- md5(pg_get_functiondef), src is md5(prosrc)); each also needs the ACL the rehearsal mirror
-- holds. "constraint_guards" does the same for the 5 constraint definitions the files
-- pin. Every "must_be_zero" value that is not 0 means a migration guard would refuse, a
-- statement would fail, or an object the release creates already exists, on production as
-- it is now; each key names the migration (mNN = #NN) whose release-notes pre-check it
-- comes from. "context" holds the notes' context counts, for the operator and the owner.
-- "sizes" are the rows of the tables the batches lock (README.md, "Locks"). Expected values
-- (the rehearsal mirror of release 3's post-state) are in README.md, "Pre-check stop rules".
-- A value that reads an object releases 1-3 create is read only when the object exists
-- (NULL otherwise, never 0), so on a state where release 3 is missing this SELECT still
-- answers, and says so (rehearsed: ../rehearsal/data/negatives.tsv, missing-release-3).
with guard(ref, fn, measure, want_md5, want_acl, origin) as (values
  ('#01:62 #01:119', 'private.create_adult_subject_invitation_core_v1(uuid,bytea,text,text,boolean)', 'def', '8c330bee64e40182f7df90fdff39505d', '{postgres=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#01:65 #01:127', 'private.create_embryo_cohort_draft_core_v1(uuid,uuid,text,text,integer,bytea,text,text[],text[],text,boolean)', 'def', '5f87e19b0324a34ef2945c2f2158313d', '{postgres=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#01:66 #01:133', 'private.create_embryo_draft_invitation_core_v1(uuid,uuid,uuid,text,text,text,boolean)', 'def', '6bc9b8cda82896772859a4887ad888c1', '{postgres=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#01:58 #01:171', 'public.claim_due_account_deletion_v1(text,integer)', 'def', 'a67a7a734a1e3bf392f5bdaf40678b6e', '{postgres=X/postgres,service_role=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#01:60 #01:174', 'public.prepare_embryo_ingest_unwind_v1(uuid,bigint)', 'def', '370cf6155b34299765c50ef2a7fefdbc', '{postgres=X/postgres,service_role=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#02:101', 'private.claim_intake_live_v1(private.future_person_claim_intakes)', 'def', 'f76e353669c3f7ff70c66e78e34317a1', '{postgres=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#02:80 #02:190', 'public.consume_session_csrf_v1(text,text,text,timestamp with time zone,uuid,uuid)', 'def', 'ae9a75327090d06a46456efce17625a3', '{postgres=X/postgres,service_role=X/postgres}', 'release 3 (follow-up 2)'),
  ('#03:68', 'private.create_adult_subject_invitation_keyed_v1(uuid,bytea,text,text,boolean,jsonb,jsonb)', 'def', '20bdaa2fe113d92c696af0112fe072b5', '{postgres=X/postgres,service_role=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#03:70', 'public.create_adult_subject_invitation_v1(uuid,bytea,text,text,boolean,jsonb,jsonb)', 'def', '160df78ea5b4bce3a1680fa84cb2cec9', '{postgres=X/postgres,service_role=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#03:73', 'public.create_adult_subject_invitation_with_nonce_v1(uuid,uuid,bytea,text,text,boolean,jsonb,jsonb,text,timestamp with time zone)', 'def', '9819f58145dbbacb8926b651f983c8c2', '{postgres=X/postgres,service_role=X/postgres}', 'release 2 (the follow-up)'),
  ('#04:68 #04:208 #07:69 #07:89', 'private.empty_self_subject_v1(uuid,uuid)', 'def', '85a9ab8159fa7e5bfb18deada62c1215', '{postgres=X/postgres}', 'release 1 (PR 324)'),
  ('#04:73 #07:71 #07:136', 'private.prepare_genome_file_deletion_body_v1(uuid,uuid)', 'def', 'e9f3f4692f0c6d10f6827410db8a0102', '{postgres=X/postgres}', 'release 1 (PR 324)'),
  ('#05:74 #05:255', 'private.delete_path_b_subject_for_route_v1(uuid,text)', 'def', 'f30283fb54afaf87da2462c9a469c85f', '{postgres=X/postgres}', 'release 1 (PR 324)'),
  ('#05:79 #11:125 #13:69', 'private.enqueue_invitation_terminal_notice_v1()', 'def', '689008df933e852391c20f6e8b3afd4a', '{postgres=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#05:87 #09:113', 'private.invitation_contact_barred_v1(text)', 'def', '78c6413be21d2c662e515764a39748b3', '{postgres=X/postgres,service_role=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#05:77 #05:121', 'private.invitation_notice_recipient_current_v1(uuid)', 'def', '261f743d84e3615d4ae56ab2e4e26b9a', '{postgres=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#05:69 #05:109', 'public.delete_subject_v1(uuid,uuid,uuid,text,timestamp with time zone)', 'def', '2f2c32f48e4a223617ba6d31f493a92c', '{postgres=X/postgres,service_role=X/postgres}', 'release 1 (PR 324)'),
  ('#06:73', 'private.consume_account_operation_nonce_v1(uuid,uuid,text,text,timestamp with time zone)', 'def', '6869593d67ff37d93a6d4caea62f01c3', '{postgres=X/postgres}', 'release 3 (follow-up 2)'),
  ('#06:68 #06:154', 'private.legal_audit_person_event_v1(text,text)', 'def', '56990e96581e5dc415222f44f09b5ac0', '{postgres=X/postgres}', 'release 2 (the follow-up)'),
  ('#06:71 #06:318', 'private.queue_refused_invitation_draft_v1(text,uuid,timestamp with time zone,bigint)', 'def', '54ab785feca9114bb097e5fbe1484dd9', '{postgres=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#06:66 #06:119', 'private.restrict_embryo_cohort_core_v1(uuid,uuid,text)', 'def', 'f2e6cb1f392308d4c834f7eef50d7abd', '{postgres=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#07:78 #07:188 #11:111 #13:81 ...', 'public.export_archive_cleanup_v1(text,uuid,uuid,jsonb)', 'def', '25fa3ce71b73fb0c371d1bb9af836bd7', '{postgres=X/postgres,service_role=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#08:60 #08:143', 'public.prepare_genome_file_deletion_v1(uuid,uuid,uuid)', 'def', '8f2f2fd4b5d9dd017c5330907b42e137', '{postgres=X/postgres,service_role=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#08:58 #08:141', 'public.prepare_own_prepared_file_cleanup_v1(uuid,uuid,uuid)', 'def', '8b6c62634d64e9058e2c503def867c4d', '{postgres=X/postgres,service_role=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#09:92 #09:245', 'private.adult_subject_invitation_response_v1(uuid,uuid,text,uuid,text)', 'def', '99dfdec657617a2b4850f6632693ef51', '{postgres=X/postgres}', 'release 3 (follow-up 2)'),
  ('#09:94 #09:263', 'private.confirm_path_b_subject_account_core_v1(text,text,integer,text,text[],bytea,uuid,uuid,text,boolean)', 'def', '2b25a1fb389738bb23397c418612dd63', '{postgres=X/postgres}', 'release 1 (PR 324)'),
  ('#09:105', 'private.enqueue_path_b_normalization_v1(uuid)', 'def', '8299149090c6d48d6ec52cfe75ab1af6', '{postgres=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#09:96 #09:274', 'private.other_adult_mitigation_before_public_appeal_v1(uuid,uuid,text)', 'def', '55892f3ffba0f229626ca024647c134a', '{postgres=X/postgres}', 'release 1 (PR 324)'),
  ('#09:98 #09:360', 'private.path_b_normalization_authority_v1(uuid,text)', 'def', '969bc88e9758fe1b2425289c6e4dd3a5', '{postgres=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#09:102 #09:381', 'public.authorize_invitation_terminal_mail_v1(uuid,smallint)', 'def', 'a4448da4d509e964b4cfe493dc6c8996', '{postgres=X/postgres,service_role=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#09:100 #09:371', 'public.claim_invitation_terminal_mail_v1()', 'def', 'a725fd9deff71e8d32a3d76400112366', '{postgres=X/postgres,service_role=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#10:92 #13:88', 'private.delete_pair_derived_rows_v1(uuid[],uuid,uuid[],text)', 'def', '8a094ce1d0a7ff92e00260204008dc07', '{postgres=X/postgres,service_role=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#10:81', 'private.family_copilot_directional_grant_v1(uuid,uuid,uuid,jsonb,text)', 'def', 'b3a2114bf265870a2fad94337087d733', '{postgres=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#10:83 #12:78 #12:193', 'private.family_copilot_turn_state_v1(uuid,uuid,uuid)', 'def', 'ecaa3458595f82351127ec80e26cd4c2', '{postgres=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#10:87', 'private.family_report_endpoints_v1(uuid,uuid,uuid,boolean)', 'def', '70683c77cef0f00c9803414a394fbd64', '{postgres=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#10:85 #12:70 #12:143', 'private.family_report_recipient_v1(uuid,uuid,uuid,text)', 'def', '692a52e391045b96addc465c8afbce0e', '{postgres=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#10:74 #10:517', 'private.grant_path_b_purpose_v1(uuid,uuid,uuid,text,text,integer,text,text,timestamp with time zone,boolean)', 'def', '9489db2b7f1295f4d1ec114b6c40402a', '{postgres=X/postgres,service_role=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#10:78', 'private.other_adult_mitigation_v1(uuid,uuid,text)', 'def', 'c5d5145da3cd9d178ebc87ea6c19702a', '{postgres=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#10:90 #20:90 #20:185', 'private.path_b_result_read_v1(uuid,uuid,text)', 'def', 'd39c35dab17636d453a18f41bde4ede4', '{postgres=X/postgres}', 'release 1 (PR 324)'),
  ('#11:114 #13:84', 'private.end_other_adult_held_upload_v1(uuid,text)', 'def', '0d5e9e5784297e1a1cb77aacfbe54a43', '{postgres=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#11:116 #13:86', 'private.legal_audit_actor_principal_v1(text,text)', 'def', '7d74f4fc739c03a14c928b5c529ca83a', '{postgres=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#11:102 #11:429 #13:43', 'private.subject_transfer_open_v1()', 'def', 'c4b160e966711cf513e267673c4b5e2f', '{postgres=X/postgres}', 'release 1 (PR 324)'),
  ('#11:93 #11:212', 'private.transfer_subject_v1(uuid,uuid,uuid,text,timestamp with time zone)', 'def', '3707a210e8fab9361b15a1ab6adbe8e0', '{postgres=X/postgres}', 'release 1 (PR 324)'),
  ('#11:105 #11:432 #13:48 #13:119', 'public.transfer_subject_v1(uuid,uuid,uuid,text,timestamp with time zone)', 'def', '0fb41099ef95025c011084190ed1555f', '{postgres=X/postgres,service_role=X/postgres}', 'release 1 (PR 324)'),
  ('#12:72 #12:155', 'private.family_ancestry_recipient_v1(uuid,uuid,uuid,text)', 'def', '5d379a615e41ef4a05ce84f1c8455d51', '{postgres=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#12:76 #12:180', 'private.family_portrait_authority_v1(uuid,uuid,uuid,uuid)', 'def', '1ff3da517b6bc473985e8fd3e073bcaa', '{postgres=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#12:74 #12:167', 'private.health_picture_direction_v1(uuid,uuid,uuid,uuid,text)', 'def', '5433a806e2f7ff6319dd2989a677b130', '{postgres=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#13:94', 'public.claim_subject_transfer_relocation_v1(uuid,text,boolean)', 'def', 'b372f540becd7d760fefcc31b36338d6', '{postgres=X/postgres,service_role=X/postgres}', 'release 1 (PR 324)'),
  ('#13:97', 'public.claim_subject_transfer_retirement_v1(uuid,text,boolean)', 'def', 'cfc2104768e444abd345e714a148d3d3', '{postgres=X/postgres,service_role=X/postgres}', 'release 1 (PR 324)'),
  ('#13:96', 'public.fence_subject_transfer_relocation_v1(uuid,text,boolean)', 'def', 'df65b2547b006b73029821bed37eaf63', '{postgres=X/postgres,service_role=X/postgres}', 'release 1 (PR 324)'),
  ('#13:98', 'public.finish_subject_transfer_retirement_v1(uuid,text,boolean)', 'def', 'dba5d0a0e592ff7d34d38dc2ff11c566', '{postgres=X/postgres,service_role=X/postgres}', 'release 1 (PR 324)'),
  ('#13:93', 'public.subject_transfer_relocation_work_v1(boolean)', 'def', 'b41281a0b8093cb6b08088d43b024404', '{postgres=X/postgres,service_role=X/postgres}', 'release 1 (PR 324)'),
  ('#13:95', 'public.swap_subject_transfer_relocation_v1(uuid,text,uuid,bigint,text,boolean)', 'def', 'bc2a13cbc7522274795eba64ac24c87d', '{postgres=X/postgres,service_role=X/postgres}', 'release 1 (PR 324)'),
  ('#14:131 #14:232 #16:78 #16:139', 'private.account_archive_r2_completed_context_v1(uuid,text,boolean)', 'src', '34ecde85fc7566b3f775ce953834a092', '{postgres=X/postgres}', 'release 1 (PR 324)'),
  ('#14:133 #14:234', 'private.download_target_authorized_v1(uuid,text,uuid,text,bigint,bigint)', 'def', '23296f5b259f177732c47a43bf4ef20f', '{postgres=X/postgres,service_role=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#14:122 #14:225 #16:73 #16:134', 'private.export_archive_current_v1(uuid,text)', 'def', '707ebdae8b497640dafeb37e666d01f6', '{postgres=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#14:129 #14:230', 'private.future_person_ready_export_v1(text,uuid,text)', 'src', 'b46d1c068bf5d0121187fc76d00fee27', '{postgres=X/postgres}', 'release 1 (PR 324)'),
  ('#14:137 #14:237 #16:81 #16:141 ...', 'private.own_export_source_v1(uuid,uuid,uuid)', 'def', '27abc582be0eb4a227a7cdeb57c29d6f', '{postgres=X/postgres,service_role=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#14:124 #14:227 #16:75 #16:136', 'public.export_archive_request_v1(text,jsonb,text,uuid,jsonb,text)', 'def', 'f22a82e34511040aab5f8b8f68f671d0', '{postgres=X/postgres,service_role=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#15:62 #15:92', 'private.account_archive_complete_subject_authority_v1(jsonb,uuid,jsonb)', 'def', '5ee7f9ac82e3bb982e213f675bdb2e43', '{postgres=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#15:60 #15:79', 'private.account_archive_complete_subjects_v1(jsonb)', 'def', '43920b19954c11add72cf3a2949cdaa1', '{postgres=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#15:64 #15:103', 'private.account_archive_export_recipient_v1(jsonb,uuid)', 'def', '26872ed747d7fd37b3824d61a7fa563d', '{postgres=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#15:66 #15:113', 'private.account_archive_raw_authority_v1(jsonb,uuid)', 'def', '13ee8d5c3055d3dd2aef841fb14060ed', '{postgres=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#17:70 #17:176', 'private.export_account_ordinary_readable_authority_v1(jsonb,text,uuid)', 'def', '611957debd6025a4f5c4710a596d67cf', '{postgres=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#17:84 #19:97 #19:197', 'private.export_account_path_b_file_v1(uuid)', 'def', '71e1c10e7b5410f4cb4b77c7ccc10577', '{postgres=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#17:72 #17:199', 'private.export_account_path_b_snapshot_v1(jsonb,uuid)', 'def', '4cc6a1afc5be8b0d8163f3c14a6f23e8', '{postgres=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#17:93', 'private.path_b_account_current_v1(uuid)', 'def', '6372a00f8c0f10e512a31dcf7455333b', '{postgres=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#17:86 #19:91 #19:134', 'private.path_b_person_v1(uuid,uuid,uuid)', 'def', '9f0434499b394a5c8ece4151838918e3', '{postgres=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#17:88 #19:114 #20:95 #20:242 ...', 'private.path_b_subject_v1(uuid,uuid)', 'def', 'd174a83682e35479797ac7e738a65d79', '{postgres=X/postgres,service_role=X/postgres}', 'release 1 (PR 324)'),
  ('#17:91', 'private.transferred_report_binding_current_v1(uuid,uuid)', 'def', '07229b62253f40cc419a32c4b34b1099', '{postgres=X/postgres}', 'release 1 (PR 324)'),
  ('#18:57 #18:81', 'private.export_account_class_projection_v1(uuid,uuid[],text)', 'def', 'd729235af961ceaf364b7127a00a89cb', '{postgres=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#19:105 #19:281', 'private.assert_account_path_b_deletion_supported_v1(uuid)', 'def', '8ef417e756e4b632b6a97c39538c7ee4', '{postgres=X/postgres}', 'release 1 (PR 324)'),
  ('#19:103 #19:254', 'private.end_purged_path_b_grants_v1()', 'def', '0add773cff4bad835ea35bcf80d7a4fc', '{postgres=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#19:111', 'private.guard_permission_document_transition_v1()', 'def', '8631df4b82bcc03e8acfa8de6f07798d', '{postgres=X/postgres}', 'release 1 (PR 324)'),
  ('#19:92 #19:143', 'private.path_b_person_choices_v1(uuid,uuid,boolean)', 'def', '88fdc054ac411342681e08a38834996f', '{postgres=X/postgres,service_role=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#19:94 #19:167', 'private.path_b_report_metadata_v1(uuid,uuid,uuid,boolean)', 'def', '057612020df71da9eeedc4e4212e546a', '{postgres=X/postgres,service_role=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#19:110', 'private.path_b_reviewed_document_approval_v1(uuid,uuid,uuid)', 'def', 'ab0681555da11ebc1f9c3c456d95e76e', '{postgres=X/postgres}', 'release 1 (PR 324)'),
  ('#19:109', 'private.path_b_reviewed_document_basis_current_v1(uuid,uuid)', 'def', '43f3bf4e7782e176523b12851fa6b97b', '{postgres=X/postgres}', 'release 1 (PR 324)'),
  ('#19:93 #19:155', 'private.path_b_uploader_shares_v1(uuid,uuid,boolean)', 'def', '4791a74ac0dd7f919a69cd4899f7a158', '{postgres=X/postgres,service_role=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#19:104 #19:263', 'private.public_appeal_provisional_binding_v1(uuid)', 'def', 'd4b8500ac4a7e6ac2ff76e642ebd0353', '{postgres=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#19:95 #19:176', 'private.subject_held_files_v1(uuid,uuid,boolean)', 'def', '807a31dda5b3c9ed7a674ad37996e519', '{postgres=X/postgres,service_role=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#19:102 #19:245', 'public.expire_due_other_adult_held_uploads_v1()', 'def', '5120605e1f785010cbc13deffcbbe5aa', '{postgres=X/postgres,service_role=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#20:101 #20:246', 'private.complete_own_upload_finalization_v1(uuid,uuid,uuid,uuid,uuid,text,text)', 'def', '50b661f2167a28ba458a5153bb71ace3', '{postgres=X/postgres,service_role=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#20:100 #20:245', 'private.other_adult_upload_store_authority_v1(uuid,uuid,uuid)', 'def', 'b8e13301350522ce9933d646c273d421', '{postgres=X/postgres,service_role=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#20:91 #20:197', 'private.path_b_report_authority_v1(uuid,uuid,text)', 'def', 'a77b3f10be091726b10930ba06b82680', '{postgres=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#20:96 #20:243', 'private.path_b_reviewed_document_retained_v1(uuid)', 'def', 'a8e15740ad618a999aa73a1c9f909817', '{postgres=X/postgres}', 'release 1 (PR 324)'),
  ('#20:97 #20:244', 'private.permission_document_live_v1(private.permission_documents)', 'def', '39de6ef674864bbcd2283003f72c0625', '{postgres=X/postgres}', 'release 1 (PR 324)')),
checked as (
 select g.ref, g.fn, g.measure, g.want_md5, g.want_acl, g.origin, p.oid is not null as present,
  case g.measure when 'def' then md5(pg_catalog.pg_get_functiondef(p.oid)) else md5(p.prosrc) end as have_md5,
  p.proacl::text as acl
 from guard g left join pg_catalog.pg_proc p on p.oid = pg_catalog.to_regprocedure(g.fn)),
cguard(ref, rel, name, want_md5) as (values
  ('#05:85', 'private.invitation_terminal_notices', 'invitation_terminal_notices_notice_kind_check', '9a5c55221b44fc6b6b80079b9460b790'),
  ('#18:71 #19:122', 'public.adult_subject_drafts', 'adult_subject_drafts_adult_flow_check', '5c8b24f18ac62ac45cd1c1647bdd2466'),
  ('#19:123', 'public.adult_subject_drafts', 'adult_subject_drafts_flow_check', '40cf5a7d87b6855d74985956133cc797'),
  ('#19:124', 'public.adult_subject_drafts', 'adult_subject_drafts_state_check', '1b051566996b3857dcc34e514d4185e0'),
  ('#10:101', 'public.chats', 'chats_scope_target_check', '62a1bbb1b82b05d2e9267e691f28cf99')),
cchecked as (
 select g.ref, g.rel, g.name, g.want_md5, md5(pg_catalog.pg_get_constraintdef(c.oid)) as have_md5
 from cguard g left join pg_catalog.pg_constraint c on c.conrelid = pg_catalog.to_regclass(g.rel) and c.conname = g.name
  and c.contype = 'c' and c.convalidated),
bucket(rel, name, def) as (values
  ('public.genome_storage_objects', 'genome_storage_objects_bucket_id_check', 'CHECK ((bucket_id = ANY (ARRAY[''genomes''::text, ''generated-artifacts''::text])))'),
  ('public.account_deletion_storage_entries', 'account_deletion_storage_entries_bucket_id_check', 'CHECK ((bucket_id = ANY (ARRAY[''genomes''::text, ''genomes-staging''::text, ''generated-artifacts''::text, ''legal-evidence''::text])))'),
  ('public.embryo_ingest_delete_objects', 'embryo_ingest_delete_objects_bucket_id_check', 'CHECK (((bucket_id = ANY (ARRAY[''genomes''::text, ''genomes-staging''::text, ''generated-artifacts''::text, ''legal-evidence''::text])) OR (bucket_id ~ ''^inherit-embryo-[a-z0-9-]{1,40}$''::text)))')),
newobj(kind, rel, name) as (values
  ('constraint', 'public.mail_outbox', 'mail_outbox_adult_invitation_note_sealed'),
  ('trigger', 'public.mail_outbox', 'clear_adult_invitation_note_envelope'),
  ('trigger', 'private.invitation_terminal_notices', 'settle_adult_acceptance_notice'),
  ('trigger', 'public.subjects', 'purge_subject_copilot_chats'))
select jsonb_build_object(
 'session', jsonb_build_object(
   'current_user', current_user,
   'statement_timeout', current_setting('statement_timeout'),
   'lock_timeout', current_setting('lock_timeout'),
   'search_path', current_setting('search_path'),
   'server_version', current_setting('server_version')),
 'ledger', (select jsonb_build_object('count', count(*), 'max', max(version),
   'above_release3_max', count(*) filter (where version > '20261025400000'),
   'release3_versions_present', count(*) filter (where version = any(array['20261024110000','20261024220000','20261025200000','20261025400000']::text[])),
   'release_versions_present', count(*) filter (where version = any(array['20261119110000','20261119120000','20261119134500','20261119150000','20261119160000','20261119170000','20261120100000','20261120110000','20261120120000','20261120130000','20261122100000','20261122110000','20261122120000','20261122130000','20261122140000','20261122150000','20261122160000','20261122170000','20261122180000','20261122190000','20261122200000']::text[])))
   from supabase_migrations.schema_migrations),
 'guards', (select jsonb_object_agg(fn || ' ' || measure, jsonb_build_object('refs', ref, 'origin', origin,
   'ok', coalesce(have_md5 = want_md5 and acl = want_acl, false), 'present', present,
   'want_md5', want_md5, 'have_md5', have_md5, 'want_acl', want_acl, 'proacl', acl)) from checked),
 'constraint_guards', (select jsonb_object_agg(rel || '.' || name, jsonb_build_object('refs', ref,
   'ok', coalesce(have_md5 = want_md5, false), 'want_md5', want_md5, 'have_md5', have_md5)) from cchecked),
 'must_be_zero', jsonb_build_object(
   'guarded_bodies_not_as_rehearsed', (select count(*) from checked where not coalesce(have_md5 = want_md5 and acl = want_acl, false)),
   'guarded_constraints_not_as_rehearsed', (select count(*) from cchecked where not coalesce(have_md5 = want_md5, false)),
   -- every existing function (by name) and relation the 21 files name: 98 functions, 62 relations
   'prerequisite_functions_missing', (select count(*) from unnest(array['auth.jwt','private.account_archive_complete_subject_authority_v1','private.account_archive_complete_subjects_v1','private.account_archive_export_recipient_v1','private.account_archive_r2_completed_context_v1','private.account_archive_raw_authority_v1','private.adult_subject_invitation_response_v1','private.append_legal_audit_event','private.assert_account_path_b_deletion_supported_v1','private.claim_intake_live_v1','private.complete_own_upload_finalization_v1','private.confirm_path_b_subject_account_core_v1','private.consume_account_operation_nonce_v1','private.consume_invitation_attempt_quota_v1','private.create_adult_subject_invitation_core_v1','private.create_adult_subject_invitation_keyed_v1','private.create_embryo_cohort_draft_core_v1','private.create_embryo_draft_invitation_core_v1','private.declare_contact_alias_groups_v1','private.delete_embryo_cohort_sources_v1','private.delete_pair_derived_rows_v1','private.delete_path_b_subject_for_route_v1','private.download_target_authorized_v1','private.embryo_cohort_set_v1','private.empty_self_subject_v1','private.end_other_adult_held_upload_v1','private.end_purged_path_b_grants_v1','private.enqueue_invitation_terminal_notice_v1','private.enqueue_path_b_normalization_v1','private.export_account_class_projection_v1','private.export_account_ordinary_readable_authority_v1','private.export_account_path_b_file_v1','private.export_account_path_b_snapshot_v1','private.export_archive_current_v1','private.family_ancestry_recipient_v1','private.family_copilot_directional_grant_v1','private.family_copilot_provider_key_v1','private.family_copilot_turn_state_v1','private.family_portrait_authority_v1','private.family_report_endpoints_v1','private.family_report_recipient_v1','private.family_report_session_v1','private.family_sharing_paused_v1','private.family_source_report_authority_v1','private.future_person_ready_export_v1','private.grant_path_b_purpose_v1','private.guard_permission_document_transition_v1','private.health_picture_direction_v1','private.hmac_active_revision_v1','private.invitation_contact_barred_v1','private.invitation_notice_recipient_current_v1','private.legal_audit_actor_principal_v1','private.legal_audit_person_event_v1','private.lock_invitation_transitions_v1','private.mail_provider_attempt_key_v1','private.other_adult_mitigation_before_public_appeal_v1','private.other_adult_mitigation_v1','private.other_adult_upload_store_authority_v1','private.own_copilot_authority_v1','private.own_export_source_v1','private.path_b_account_current_v1','private.path_b_normalization_authority_v1','private.path_b_person_choices_v1','private.path_b_person_v1','private.path_b_report_authority_v1','private.path_b_report_metadata_v1','private.path_b_result_read_v1','private.path_b_reviewed_document_approval_v1','private.path_b_reviewed_document_basis_current_v1','private.path_b_reviewed_document_retained_v1','private.path_b_subject_v1','private.path_b_uploader_shares_v1','private.permission_document_live_v1','private.prepare_genome_file_deletion_body_v1','private.public_appeal_provisional_binding_v1','private.queue_refused_invitation_draft_v1','private.record_subject_operation_nonce_v1','private.resolve_hmac_set_v1','private.restrict_embryo_cohort_core_v1','private.subject_held_files_v1','private.subject_transfer_open_v1','private.transfer_subject_v1','private.transferred_report_binding_current_v1','private.valid_family_copilot_citations_v1','public.authorize_invitation_terminal_mail_v1','public.claim_due_account_deletion_v1','public.claim_invitation_terminal_mail_v1','public.consume_session_csrf_v1','public.create_adult_subject_invitation_v1','public.create_adult_subject_invitation_with_nonce_v1','public.delete_subject_v1','public.expire_due_other_adult_held_uploads_v1','public.export_archive_cleanup_v1','public.export_archive_request_v1','public.prepare_embryo_ingest_unwind_v1','public.prepare_genome_file_deletion_v1','public.prepare_own_prepared_file_cleanup_v1','public.transfer_subject_v1']::text[]) f
     where not exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname || '.' || p.proname = f)),
   'prerequisite_relations_missing', (select count(*) from unnest(array['auth.sessions','auth.users','private.appeal_document_sessions','private.auth_recovery_sessions','private.claim_document_sessions','private.export_archive_attempts','private.export_archive_jobs','private.future_person_claim_intakes','private.genome_file_deletions','private.invitation_terminal_notices','private.path_b_report_bindings','private.permission_document_sessions','private.permission_documents','private.session_csrf_token_uses','private.subject_ownership_transfers','private.subject_transfer_relocations','public.account_deletion_requests','public.account_deletion_storage_entries','public.account_operation_nonces','public.adult_subject_drafts','public.chat_messages','public.chats','public.consent_artifacts','public.consent_signatures','public.contact_hmac_indexes','public.copilot_context_history','public.copilot_context_tokens','public.copilot_turn_dependencies','public.directional_grants','public.download_sessions','public.embryo_cohort_drafts','public.embryo_cohorts','public.embryo_ingest_delete_objects','public.embryo_ingest_sessions','public.embryo_participant_sets','public.embryo_variants','public.encrypted_contact_references','public.generated_exports','public.genome_files','public.genome_storage_objects','public.invitation_candidates','public.invitation_reminders','public.mail_outbox','public.other_adult_held_uploads','public.profiles','public.purpose_grants','public.retention_due_phases','public.retention_phase_registry','public.retention_registry','public.retention_rows','public.rights_nonces','public.rights_sessions','public.subject_account_bindings','public.subject_consents','public.subject_invitations','public.subject_principals','public.subject_relationships','public.subjects','public.token_candidates','public.token_hashes','public.upload_sessions','public.worker_jobs']::text[]) r where pg_catalog.to_regclass(r) is null),
   'roles_missing', (select count(*) from unnest(array['anon','authenticated','inherit_upload_only','service_role']::text[]) r where not exists (select 1 from pg_catalog.pg_roles where rolname = r)),
   -- every function name the release creates (30), and its constraint and triggers
   'release_functions_present', (select count(*) from unnest(array['private.adult_acceptance_clock_state_v1','private.adult_acceptance_inviter_held_v1','private.adult_acceptance_notice_current_v1','private.clear_adult_invitation_note_envelope_v1','private.embryo_uploader_basis_loss_v1','private.enqueue_self_withdrawal_notice_v1','private.path_b_confirmation_v1','private.purge_subject_copilot_chats_v1','private.queue_subject_transfer_notices_v1','private.record_file_delete_nonce_v1','private.settle_adult_acceptance_notice_v1','private.start_adult_acceptance_clocks_v1','private.subject_copilot_authority_v1','private.subject_copilot_prune_v1','private.subject_copilot_uploader_grant_v1','private.transferred_export_confirmation_v1','private.transferred_export_person_v1','public.adult_acceptance_inviter_held_subjects_v1','public.adult_subject_acceptance_origin_v1','public.consume_session_csrf_v2','public.embryo_uploader_withdrawal_readiness_v1','public.empty_self_subject_with_notice_v1','public.other_adult_withdrawal_readiness_v1','public.prepare_own_prepared_file_cleanup_with_nonce_v1','public.run_due_adult_acceptance_notices_v1','public.self_subject_withdrawal_readiness_v1','public.subject_copilot_chat_v1','public.subject_copilot_scope_v1','public.withdraw_embryo_uploader_consent_v1','public.withdraw_other_adult_upload_v1']::text[]) f
     where exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname || '.' || p.proname = f)),
   'release_objects_present', (select count(*) from newobj o where case o.kind
     when 'constraint' then exists (select 1 from pg_catalog.pg_constraint c where c.conrelid = pg_catalog.to_regclass(o.rel) and c.conname = o.name)
     else exists (select 1 from pg_catalog.pg_trigger t where t.tgrelid = pg_catalog.to_regclass(o.rel) and t.tgname = o.name) end),
   -- #01: each a refusal the migration would raise, and its reviewed bucket checks
   'm01_account_deletion_entries_on_dropped_buckets', (select count(*) from public.account_deletion_storage_entries
     where bucket_id in ('genomes-staging','generated-artifacts')),
   'm01_embryo_unwind_entries_on_dropped_buckets', (select count(*) from public.embryo_ingest_delete_objects
     where bucket_id in ('genomes-staging','generated-artifacts')),
   'm01_recorded_objects_on_dropped_buckets', (select count(*) from public.genome_storage_objects
     where bucket_id in ('genomes-staging','generated-artifacts')),
   'm01_legacy_staging_sessions_reachable_by_embryo_unwind', (select count(*) from public.upload_sessions u where u.storage_bucket = 'genomes-staging'
     and (u.cohort_id is not null or exists (select 1 from public.subjects s where s.id = u.subject_id and s.cohort_id is not null))),
   'm01_dropped_buckets_present', (select count(*) from storage.buckets where id in ('genomes-staging','generated-artifacts')),
   'm01_bucket_checks_not_as_reviewed', (select count(*) from bucket b where not exists (select 1 from pg_catalog.pg_constraint c
     where c.conrelid = pg_catalog.to_regclass(b.rel) and c.conname = b.name and c.contype = 'c' and c.convalidated
       and pg_catalog.pg_get_constraintdef(c.oid) = b.def)),
   -- #02: the spend table as release 3's 20261024220000 made it, and the ingest status check
   'm02_spend_table_not_as_reviewed', (select count(*) from (select 1) x where (select array_agg(column_name::text order by column_name)
     from information_schema.columns where table_schema = 'private' and table_name = 'session_csrf_token_uses')
     is distinct from array['expires_at','route_id','token_hash']),
   'm02_ingest_status_check_missing', (select count(*) from (select 1) x where not exists (select 1 from pg_catalog.pg_constraint c
     where c.conrelid = 'public.embryo_ingest_sessions'::regclass and c.conname = 'embryo_ingest_sessions_status_check' and c.convalidated)),
   -- #03: the table block's refusal, what the new check would refuse, and the pinned provider key
   'm03_plain_notes_on_sendable_rows', (select count(*) from public.mail_outbox where template_id = 'adult-subject-invitation'
     and state in ('queued','claimed') and template_payload ? 'note'),
   'm03_invitation_payloads_outside_request_or_note', (select count(*) from public.mail_outbox where template_id = 'adult-subject-invitation'
     and (template_payload - array['request','note'] <> '{}'::jsonb or (template_payload ? 'request' and template_payload ? 'note'))),
   'm03_provider_attempt_key_not_as_pinned', (select count(*) from (select 1) x where private.mail_provider_attempt_key_v1(
     jsonb_populate_record(null::public.mail_outbox, jsonb_build_object('idempotency_key', repeat('a',64),
     'token_purpose', 'adult-subject-invitation', 'attempt_count', 3)))
     is distinct from '6f1e8bd33056fe66d4fcfd2b65ab888dae730da76626fa0bca5399fe944c4517'),
   -- #04: the door's self branch (pinned by fragment and ACL, not by md5) and the column the notice reads
   'm04_door_without_its_self_branch', (select count(*) from (select 1) x where not exists (select 1 from pg_catalog.pg_proc p
     where p.oid = pg_catalog.to_regprocedure('public.delete_subject_v1(uuid,uuid,uuid,text,timestamp with time zone)')
       and p.proacl::text = '{postgres=X/postgres,service_role=X/postgres}' and p.prosecdef
       and pg_catalog.pg_get_functiondef(p.oid) like '%return private.empty_self_subject_v1(p_account_id,s.id);%')),
   'm04_mail_contact_revision_missing', (select count(*) from (select 1) x where not exists (select 1 from pg_catalog.pg_attribute
     where attrelid = 'public.profiles'::regclass and attname = 'mail_contact_revision' and not attisdropped)),
   -- #05: the terminal notice queue's insert trigger, enabled
   'm05_notice_trigger_missing', (select count(*) from (select 1) x where not exists (select 1 from pg_catalog.pg_trigger t
     where t.tgrelid = 'private.invitation_terminal_notices'::regclass and t.tgname = 'enqueue_invitation_terminal_notice' and t.tgenabled = 'O')),
   -- #07: the archive tables the cleanup door works on
   'm07_archive_tables_missing', 2 - (select count(*) from pg_catalog.pg_class where oid in
     (pg_catalog.to_regclass('private.export_archive_attempts'), pg_catalog.to_regclass('private.export_archive_jobs'))),
   -- #08: the legal-audit actor trigger, and the operation check before its widening
   'm08_actor_trigger_missing', (select count(*) from (select 1) x where not exists (select 1 from pg_catalog.pg_trigger t
     where t.tgrelid = 'public.account_operation_nonces'::regclass and t.tgname = 'legal_audit_actor_on_consumed_insert' and not t.tgisinternal)),
   'm08_check_not_before_widening', (select count(*) from (select 1) x where not exists (select 1 from pg_catalog.pg_constraint c
     where c.conrelid = 'public.account_operation_nonces'::regclass and c.conname = 'account_operation_nonces_operation_check' and c.convalidated
       and pg_catalog.pg_get_constraintdef(c.oid) like '%''provider_setting_delete''%'
       and pg_catalog.pg_get_constraintdef(c.oid) not like '%''file_delete''%')),
   -- #09: the queue's one trigger, the two registered classes and phases, and no clock yet
   'm09_notice_queue_triggers_not_one', abs(1 - (select count(*) from pg_catalog.pg_trigger t
     where t.tgrelid = 'private.invitation_terminal_notices'::regclass and not t.tgisinternal)),
   'm09_retention_classes_missing', 2 - (select count(*) from public.retention_registry where execution_class = 'scheduledDuePhase'
     and retention_id in ('adult.acceptance-hold-72h','adult.re-notice-30d')),
   'm09_retention_phases_missing', 2 - (select count(*) from public.retention_phase_registry where phase_kind = 'notice-enqueue'
     and (retention_id, phase_id) in (('adult.acceptance-hold-72h','adult-acceptance-second-notice'),('adult.re-notice-30d','adult-revocation-renotice'))),
   'm09_clocks', (select count(*) from public.retention_rows where retention_id in ('adult.acceptance-hold-72h','adult.re-notice-30d')),
   -- #11, #13: the transfer switch answers false before the release (#13 opens it)
   'm11_m13_transfer_switch_open', (select count(*) from (select 1) x where (case when pg_catalog.to_regprocedure('private.subject_transfer_open_v1()') is not null then (pg_catalog.xpath('/row/v/text()', pg_catalog.query_to_xml('select (select private.subject_transfer_open_v1()) as v', false, true, '')))[1]::text::boolean end) is distinct from false),
   -- #14, #16: the job table the guard reads
   'm14_job_table_missing', 1 - (select count(*) from pg_catalog.pg_class where oid = pg_catalog.to_regclass('private.export_archive_jobs')),
   -- #20: exactly the five bodies that ask the uploader's read (#19 widens none of them to ask it)
   'm20_uploader_read_callers_not_the_five', (select count(*) from (select 1) x where array(select p.oid from pg_catalog.pg_proc p
     where p.prosrc ~ '[^a-z_]path_b_subject_v1\s*\(' and p.oid is distinct from pg_catalog.to_regprocedure('private.path_b_subject_v1(uuid,uuid)') order by p.oid)
     is distinct from array(select pg_catalog.to_regprocedure(x)::oid from unnest(array['private.complete_own_upload_finalization_v1(uuid,uuid,uuid,uuid,uuid,text,text)','private.export_account_ordinary_readable_authority_v1(jsonb,text,uuid)','private.other_adult_upload_store_authority_v1(uuid,uuid,uuid)','private.path_b_normalization_authority_v1(uuid,text)','private.public_appeal_provisional_binding_v1(uuid)']::text[]) x order by 1))),
 'context', jsonb_build_object(
   'm01_legacy_staging_sessions', (select count(*) from public.upload_sessions where storage_bucket = 'genomes-staging'),
   'm01_legacy_staging_sessions_live', (select count(*) from public.upload_sessions where storage_bucket = 'genomes-staging'
     and status in ('issued','uploaded','validating','held')),
   'm01_account_deletions_in_progress', (select count(*) from public.account_deletion_requests where state = 'delete_started'),
   'm02_spent_hashes', (case when pg_catalog.to_regclass('private.session_csrf_token_uses') is not null then (pg_catalog.xpath('/row/v/text()', pg_catalog.query_to_xml('select (select count(*) from private.session_csrf_token_uses) as v', false, true, '')))[1]::text::bigint end),
   'm02_live_reset_sessions', (case when pg_catalog.to_regclass('private.auth_recovery_sessions') is not null then (pg_catalog.xpath('/row/v/text()', pg_catalog.query_to_xml('select (select count(*) from private.auth_recovery_sessions where expires_at > clock_timestamp()) as v', false, true, '')))[1]::text::bigint end),
   'm03_plain_notes_on_ended_rows', (select count(*) from public.mail_outbox where template_id = 'adult-subject-invitation'
     and state not in ('queued','claimed') and template_payload ? 'note'),
   'm03_invitation_rows', (select count(*) from public.mail_outbox where template_id = 'adult-subject-invitation'),
   'm04_door_md5', (select md5(pg_catalog.pg_get_functiondef(p.oid)) from pg_catalog.pg_proc p
     where p.oid = pg_catalog.to_regprocedure('public.delete_subject_v1(uuid,uuid,uuid,text,timestamp with time zone)')),
   'm04_live_self_upload_consents', (select count(*) from public.subject_consents where consent_type = 'upload_class' and revoked_at is null
     and subject_id in (select id from public.subjects where subject_class = 'self')),
   'm05_account_held_path_b_records', (select count(*) from public.subjects where subject_class = 'other_adult' and lifecycle = 'active'
     and ownership_transferred_at is null and owner_account_id is not null and subject_account_id is not null),
   'm05_m09_terminal_notices', (select count(*) from private.invitation_terminal_notices),
   'm06_third_party_cohorts', (select count(*) from public.embryo_cohorts where upload_class = 'embryo_third_party'),
   'm06_open_third_party_drafts', (select count(*) from public.embryo_cohort_drafts where upload_class = 'embryo_third_party'
     and state in ('draft','evidence_pending','ready')),
   'm07_export_delete_guard', (select count(*) from pg_catalog.pg_trigger t where t.tgrelid = 'public.generated_exports'::regclass
     and t.tgname = 'guard_export_archive_delete' and t.tgenabled = 'O'),
   'm07_m14_self_record_exports', (select count(*) from public.generated_exports e join public.subjects s on s.id = e.target_id
     where e.target_kind = 'subject' and s.subject_class = 'self'),
   'm07_live_self_record_exports', (select count(*) from public.generated_exports e join public.subjects s on s.id = e.target_id
     where e.target_kind = 'subject' and s.subject_class = 'self' and e.status in ('queued','building','ready')),
   'm07_self_record_attempts_holding_objects', (select count(*) from private.export_archive_attempts a
     join public.generated_exports e on e.id = a.export_id join public.subjects s on s.id = e.target_id
     where e.target_kind = 'subject' and s.subject_class = 'self' and a.state in ('writing','bytes_complete')),
   'm07_m15_test_r2_enabled', (select coalesce(bool_or(enabled), false) from private.account_archive_r2_configuration),
   'm08_check_md5', (select md5(pg_catalog.pg_get_constraintdef(c.oid)) from pg_catalog.pg_constraint c
     where c.conrelid = 'public.account_operation_nonces'::regclass and c.conname = 'account_operation_nonces_operation_check'),
   'm08_m14_m16_pending_file_deletions', (select count(*) from private.genome_file_deletions),
   'm09_accepted_adult_invitations', (select count(*) from public.subject_invitations where invitation_kind = 'adult_subject' and status = 'accepted'),
   'm10_subject_chats', (select count(*) from public.chats where scope_kind = 'subject'),
   'm10_live_copilot_local_grants', (select count(*) from public.purpose_grants where purpose = 'copilot.local' and revoked_at is null),
   'm11_m13_records_held_by_their_person', (select count(*) from public.subjects where subject_class = 'other_adult' and upload_class = 'adult'
     and lifecycle = 'active' and subject_account_id is not null and owner_account_id is distinct from subject_account_id),
   'm11_m13_m17_transferred_records', (select count(*) from public.subjects where ownership_transferred_at is not null),
   'm12_m15_accepted_path_a_invitations', (select count(*) from public.subject_invitations i where i.invitation_kind = 'adult_subject'
     and i.status = 'accepted' and not exists (select 1 from public.adult_subject_drafts d where d.subject_id = i.target_id)),
   'm12_current_person_to_person_grants', (select count(*) from public.directional_grants where status = 'current' and direction = 'subject_to_recipient'),
   'm14_live_self_record_copies', (select count(*) from public.generated_exports e join public.subjects s on s.id = e.target_id
     join private.export_archive_jobs j on j.export_id = e.id where e.target_kind = 'subject' and s.subject_class = 'self'
     and j.deadline > clock_timestamp() and (e.status in ('queued','building') or (e.status = 'ready' and e.expires_at > clock_timestamp()))),
   'm14_jobless_copies_being_made', (select count(*) from public.generated_exports e left join private.export_archive_jobs j on j.export_id = e.id
     where e.target_kind = 'subject' and j.export_id is null and e.status in ('queued','building')),
   'm14_ready_account_copies', (select count(*) from public.generated_exports where target_kind = 'account' and status = 'ready'),
   'm15_open_account_archives', (select count(*) from public.generated_exports where target_kind = 'account' and status in ('queued','building','ready')),
   'm16_live_account_copies_with_a_self_record', (select count(*) from public.generated_exports e join private.export_archive_jobs j on j.export_id = e.id
     join public.subjects s on s.subject_account_id = e.target_id and s.subject_class = 'self' and e.subject_partitions @> jsonb_build_array(s.id)
     where e.target_kind = 'account' and j.deadline > clock_timestamp()
     and (e.status in ('queued','building') or (e.status = 'ready' and e.expires_at > clock_timestamp()))),
   'm17_relocations_not_swapped', (case when pg_catalog.to_regclass('private.subject_transfer_relocations') is not null then (pg_catalog.xpath('/row/v/text()', pg_catalog.query_to_xml('select (select count(*) from private.subject_transfer_relocations where state in (''queued'',''copying'')) as v', false, true, '')))[1]::text::bigint end),
   'm17_exports_of_transferred_records', (select count(*) from public.generated_exports e join public.subjects s on s.id = e.target_id
     where e.target_kind = 'subject' and s.ownership_transferred_at is not null),
   'm18_m19_confirmed_reviewed_document_records', (select count(*) from public.adult_subject_drafts
     where adult_flow = 'path-b-reviewed-document' and state = 'confirmed'),
   'm18_accepted_reviewed_document_invitations', (select count(*) from public.subject_invitations i join public.adult_subject_drafts d
     on d.subject_id = i.target_id and d.adult_flow = 'path-b-reviewed-document' and d.state = 'confirmed'
     where i.invitation_kind = 'adult_subject' and i.status = 'accepted'),
   'm19_transferred_reviewed_document_records', (select count(*) from public.subjects s join public.adult_subject_drafts d on d.subject_id = s.id
     where d.adult_flow = 'path-b-reviewed-document' and d.state = 'confirmed' and s.ownership_transferred_at is not null),
   'm19_live_grants_on_reviewed_document_records', (select count(*) from public.purpose_grants g join public.adult_subject_drafts d on d.subject_id = g.target_id
     where g.target_kind = 'subject' and d.adult_flow = 'path-b-reviewed-document' and g.revoked_at is null),
   'm20_m21_records_whose_document_is_no_longer_retained', (case when pg_catalog.to_regprocedure('private.path_b_reviewed_document_retained_v1(uuid)') is not null then (pg_catalog.xpath('/row/v/text()', pg_catalog.query_to_xml('select (select count(*) from public.adult_subject_drafts d join public.subjects s on s.id = d.subject_id where d.adult_flow = ''path-b-reviewed-document'' and d.state = ''confirmed'' and s.lifecycle = ''active'' and not private.path_b_reviewed_document_retained_v1(s.id)) as v', false, true, '')))[1]::text::bigint end)),
 'sizes', jsonb_build_object(
   'genome_storage_objects', (select count(*) from public.genome_storage_objects),
   'account_deletion_storage_entries', (select count(*) from public.account_deletion_storage_entries),
   'embryo_ingest_delete_objects', (select count(*) from public.embryo_ingest_delete_objects),
   'mail_outbox', (select count(*) from public.mail_outbox),
   'invitation_terminal_notices', (select count(*) from private.invitation_terminal_notices),
   'account_operation_nonces', (select count(*) from public.account_operation_nonces),
   'subjects', (select count(*) from public.subjects)),
 'context_locks', jsonb_build_object(
   'unconsumed_account_operation_nonces', (select count(*) from public.account_operation_nonces where consumed_at is null and expires_at > now()),
   'mail_outbox_queued_or_claimed', (select count(*) from public.mail_outbox where state in ('queued','claimed')))
) as prechecks;
