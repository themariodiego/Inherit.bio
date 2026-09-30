begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- G5.6: the export member plan, held against the real catalog.
--
-- docs/export-member-plan.json names every table in the public and private
-- schemas and says whether the export carries it, excludes it (as a
-- credential, protected value or machinery), leaves it out of scope, has not
-- built it yet, or holds no person's data. This file is the set equality
-- between that plan and the database: a new table, a dropped one, or a new
-- column on an exported table fails here until the plan says what happens to
-- it. The plan travels in the generated block below because the test runner
-- cannot read repository files; src/lib/export/member-plan.test.ts fails when
-- the block and the JSON differ.
--
-- Everything here rolls back, including the planted tables at the end.

-- BEGIN GENERATED from docs/export-member-plan.json by scripts/export-member-plan.ts; do not edit by hand.
create temporary table export_member_plan as select $plan$
{
  "version": "export-member-plan-v1",
  "universe": "Every ordinary table in the public and private schemas. Set equality between this list and the database catalog is checked by supabase/tests/export_member_plan.sql, so a new table fails CI until it has an entry here.",
  "personScoped": "A table is person-scoped when a column is named user_id or account_id or ends in _user_id or _account_id, when it has a foreign key to auth.users or public.audit_principals, or when it has a foreign key to a person-scoped table. A person-scoped table may never be classified reference.",
  "dispositions": {
    "exported": "The requester's own rows leave in the export. columns and withheld classify every column; withheld columns never leave. A member named archive: is a member of the synchronous archive; one named reader: is an asynchronous reader class whose rows become archive content.",
    "excluded-credential": "A credential, key, token, nonce or session, or its hash. Exporting it would be a security defect.",
    "excluded-protected": "A contact value, identity HMAC, evidence document or other ciphertext the export contracts always exclude.",
    "excluded-internal": "Processing, delivery, retention or security machinery. It is not the person's record.",
    "out-of-scope": "About a person, but not the requester's own record: a short-lived draft about someone else, or staff workflow.",
    "deferred": "Belongs in a complete export under a registered contract, but no reader exists yet. These are the open gaps.",
    "reference": "Holds no person's data: catalogs, registries and service configuration."
  },
  "objects": {
    "genomes": {
      "disposition": "exported",
      "members": [
        "archive:originals/"
      ],
      "reason": "Original uploads, byte for byte, while the retention period has not ended. A retired original is named in manifest.json warnings."
    },
    "prepared-artifacts": {
      "disposition": "exported",
      "members": [
        "archive:canonical/"
      ],
      "reason": "Prepared canonical records, complete, as canonical/{file_id}.jsonl."
    }
  },
  "tables": {
    "private.embryo_ingest_object_config": {
      "disposition": "reference",
      "reason": "The operator's embryo fragment storage backend selection: provider, bucket and gateway audience. It holds no person's data."
    },
    "private.embryo_ingest_object_disposals": {
      "disposition": "excluded-internal",
      "reason": "Claim tokens and provider disposal evidence for an unwound embryo upload's storage objects. It is machinery, not the person's record."
    },
    "private.embryo_ingest_write_fences": {
      "disposition": "excluded-internal",
      "reason": "Embryo ingest write fences and their drain state. It is machinery, not the person's record."
    },
    "private.embryo_ingest_write_intents": {
      "disposition": "excluded-internal",
      "reason": "Embryo ingest write intents: fenced object names, reserved sizes and landing state. It is machinery, not the person's record."
    },
    "private.export_archive_attempts": {
      "disposition": "excluded-internal",
      "reason": "Export attempt leases and byte counts. It is machinery, not the person's record."
    },
    "private.export_archive_downloads": {
      "disposition": "excluded-credential",
      "reason": "Export download sessions and cookie hashes. Exporting it would be a security defect, not completeness."
    },
    "private.export_archive_jobs": {
      "disposition": "excluded-credential",
      "reason": "Export jobs: the export cookie hash and the originating session. Exporting it would be a security defect, not completeness."
    },
    "private.export_archive_manifest_pages": {
      "disposition": "excluded-internal",
      "reason": "Pages of an export's segment manifest. It is machinery, not the person's record."
    },
    "private.export_archive_nonce_uses": {
      "disposition": "excluded-credential",
      "reason": "Export operation nonce hashes. Exporting it would be a security defect, not completeness."
    },
    "private.export_archive_segments": {
      "disposition": "excluded-internal",
      "reason": "An export's own stored segments and their object keys. It is machinery, not the person's record."
    },
    "private.family_ancestry_grant_snapshots": {
      "disposition": "excluded-internal",
      "reason": "Grant endpoint snapshots for family ancestry. It is machinery, not the person's record."
    },
    "private.family_portrait_grant_snapshots": {
      "disposition": "excluded-internal",
      "reason": "Grant endpoint snapshots for the portrait. It is machinery, not the person's record."
    },
    "private.family_report_grant_snapshots": {
      "disposition": "excluded-internal",
      "reason": "Grant endpoint snapshots for family reports. It is machinery, not the person's record."
    },
    "private.genome_file_deletions": {
      "disposition": "excluded-credential",
      "reason": "Deletion work items carrying a claim token and its hash. Exporting it would be a security defect, not completeness."
    },
    "private.health_picture_grant_snapshots": {
      "disposition": "excluded-internal",
      "reason": "Grant endpoint snapshots for the health picture. It is machinery, not the person's record."
    },
    "private.hmac_key_versions": {
      "disposition": "excluded-credential",
      "reason": "Revision states of the HMAC keys behind contact and rate-limit lookups. It holds no key material, but it is key-management state, so it stays with the credentials it describes."
    },
    "private.invitation_terminal_notices": {
      "disposition": "excluded-protected",
      "reason": "Terminal notices carrying an encrypted contact. The export contracts always exclude contact values, identity documents and evidence bytes."
    },
    "private.legal_audit_account_principals": {
      "disposition": "excluded-internal",
      "reason": "The link from an account to its audit pseudonym, which selects the requester's own events. It is deleted with the account, leaving the ledger unlinkable (L-49). It is machinery, not the person's record."
    },
    "private.legal_audit_attribution_config": {
      "disposition": "reference",
      "reason": "When the ledger began recording who acted. The export states it; it holds no person's data."
    },
    "private.own_analysis_runs": {
      "disposition": "exported",
      "reason": "Saved report and ancestry results, returned verbatim under the purpose's current grant and never regenerated.",
      "scope": "account_id = the requesting account, for its exported files.",
      "members": [
        "archive:reports.json",
        "archive:reports.txt",
        "archive:ancestry.json",
        "reader:reports",
        "reader:ancestry"
      ],
      "columns": [
        "file_id",
        "purpose",
        "completed_at",
        "result"
      ],
      "withheld": [
        "id",
        "subject_id",
        "account_id",
        "grant_id",
        "grant_revision",
        "authority",
        "source_revision",
        "source_sha256",
        "normalization_completed_at",
        "computation_revision",
        "state",
        "claim",
        "expires_at",
        "ancestry_source"
      ]
    },
    "private.own_copilot_nonces": {
      "disposition": "excluded-credential",
      "reason": "Copilot operation nonces. Exporting it would be a security defect, not completeness."
    },
    "private.own_normalization_batches": {
      "disposition": "excluded-internal",
      "reason": "Normalization batches; their output is user_variants. It is machinery, not the person's record."
    },
    "private.own_normalization_positions": {
      "disposition": "excluded-internal",
      "reason": "Normalization position mapping; its output is user_variants. It is machinery, not the person's record."
    },
    "private.own_normalization_runs": {
      "disposition": "excluded-internal",
      "reason": "Normalization runs with their claim and authority. It is machinery, not the person's record."
    },
    "private.own_original_retention_config": {
      "disposition": "reference",
      "reason": "Service configuration. It holds no person's data."
    },
    "private.own_original_retirements": {
      "disposition": "excluded-internal",
      "reason": "The retirement ledger of originals; a retired original is named in manifest.json warnings. It is machinery, not the person's record."
    },
    "private.own_preparation_artifacts": {
      "disposition": "excluded-internal",
      "reason": "Prepared artifact objects; their records are exported as canonical/{file_id}.jsonl. It is machinery, not the person's record."
    },
    "private.own_preparation_checkpoints": {
      "disposition": "excluded-internal",
      "reason": "Preparation checkpoints. It is machinery, not the person's record."
    },
    "private.own_preparation_config": {
      "disposition": "reference",
      "reason": "Service configuration. It holds no person's data."
    },
    "private.own_preparation_jobs": {
      "disposition": "excluded-internal",
      "reason": "Preparation jobs with their claim token hash. It is machinery, not the person's record."
    },
    "private.own_preparation_monthly_admissions": {
      "disposition": "reference",
      "reason": "A service-wide monthly counter. It holds no person's data."
    },
    "private.own_prepared_cleanup_entries": {
      "disposition": "excluded-internal",
      "reason": "Prepared-object cleanup entries. It is machinery, not the person's record."
    },
    "private.own_prepared_cleanups": {
      "disposition": "excluded-internal",
      "reason": "Prepared-object cleanups. It is machinery, not the person's record."
    },
    "private.own_prepared_manifest_members": {
      "disposition": "excluded-internal",
      "reason": "Prepared manifest membership. It is machinery, not the person's record."
    },
    "private.own_prepared_manifests": {
      "disposition": "excluded-internal",
      "reason": "Prepared manifests; the records they index are exported as canonical/{file_id}.jsonl, whose header names the manifest. It is machinery, not the person's record."
    },
    "private.own_upload_finalization_attempts": {
      "disposition": "excluded-internal",
      "reason": "Upload finalization leases. It is machinery, not the person's record."
    },
    "private.own_upload_finalization_checkpoints": {
      "disposition": "excluded-internal",
      "reason": "Upload finalization checkpoints. It is machinery, not the person's record."
    },
    "private.upload_authorization_config": {
      "disposition": "reference",
      "reason": "Service configuration. It holds no person's data."
    },
    "public.abuse_events": {
      "disposition": "excluded-internal",
      "reason": "Abuse-control events keyed to an audit pseudonym. It is machinery, not the person's record."
    },
    "public.account_deletion_requests": {
      "disposition": "excluded-internal",
      "reason": "Account deletion machinery with its claim token hash. The pending deletion is shown on the settings page. It is machinery, not the person's record."
    },
    "public.account_deletion_storage_entries": {
      "disposition": "excluded-internal",
      "reason": "Objects queued for deletion. It is machinery, not the person's record."
    },
    "public.account_operation_nonces": {
      "disposition": "excluded-credential",
      "reason": "Account operation nonces. Exporting it would be a security defect, not completeness."
    },
    "public.account_security_states": {
      "disposition": "excluded-internal",
      "reason": "Security control counters. Exporting lockout state would tell whoever holds a session how close the account is to lockout. It is machinery, not the person's record."
    },
    "public.adult_subject_drafts": {
      "disposition": "out-of-scope",
      "reason": "A short-lived draft about another adult. That adult's rights begin at their own binding. It is not the requester's own record."
    },
    "public.analysis_jobs": {
      "disposition": "excluded-internal",
      "reason": "Analysis queue rows. It is machinery, not the person's record."
    },
    "public.ancestry_regions": {
      "disposition": "deferred",
      "reason": "Regional ancestry estimates. No writer ships today; when one does they belong in ancestry.json."
    },
    "public.ancestry_results": {
      "disposition": "exported",
      "reason": "Legacy ancestry results for the account's legacy files, while the ancestry purpose is live (D-097).",
      "scope": "user_id = the requesting account, and the file is one of its legacy files.",
      "members": [
        "archive:ancestry.json"
      ],
      "columns": [
        "id",
        "user_id",
        "file_id",
        "kind",
        "result",
        "support_note",
        "created_at",
        "subject_id",
        "model_id",
        "model_version",
        "computation_revision",
        "source_binding_fingerprint",
        "coverage",
        "result_state",
        "not_covered_reason"
      ],
      "withheld": []
    },
    "public.appeal_assignments": {
      "disposition": "out-of-scope",
      "reason": "Staff appeal assignments; the outcome is on the appeal itself. It is not the requester's own record."
    },
    "public.appeal_evidence": {
      "disposition": "excluded-protected",
      "reason": "Evidence documents attached to an appeal. The export contracts always exclude contact values, identity documents and evidence bytes."
    },
    "public.appeal_intakes": {
      "disposition": "deferred",
      "reason": "The person's own appeals. No appeal surface ships and the statement is ciphertext. Belongs to the non-self and independent projections (docs/export-member-selection-design.md, step 3), which are not built."
    },
    "public.attestation_contradictions": {
      "disposition": "deferred",
      "reason": "Recorded contradictions of an attestation. Belongs to the non-self and independent projections (docs/export-member-selection-design.md, step 3), which are not built."
    },
    "public.attestations": {
      "disposition": "exported",
      "reason": "The affirmations this account's principals made or its own signatures carry.",
      "scope": "principal_id is one of this account's principals, or signature_id is one of its signatures.",
      "members": [
        "archive:subject-record.json",
        "reader:history.attestations"
      ],
      "columns": [
        "id",
        "signature_id",
        "principal_id",
        "target_kind",
        "target_id",
        "kind",
        "statement_keys",
        "affirmed",
        "attestation_revision",
        "affirmed_at"
      ],
      "withheld": []
    },
    "public.audit_principal_link_keys": {
      "disposition": "excluded-credential",
      "reason": "Envelope keys for the encrypted audit links. Exporting it would be a security defect, not completeness."
    },
    "public.audit_principal_links": {
      "disposition": "excluded-protected",
      "reason": "Encrypted links from an audit pseudonym to an account or subject. The export contracts always exclude contact values, identity documents and evidence bytes."
    },
    "public.audit_principals": {
      "disposition": "excluded-internal",
      "reason": "Audit pseudonyms. The requester's own is used only to select their events and never leaves. It is machinery, not the person's record."
    },
    "public.carrier_condition_reviews": {
      "disposition": "out-of-scope",
      "reason": "Staff workflow: the named reviewer's decision to activate or deactivate a carrier condition. It is about the reviewer, not a requester's record."
    },
    "public.carrier_conditions": {
      "disposition": "reference",
      "reason": "The carrier-condition registry: gene, inheritance, the reviewed assertion release and whether the condition is active. It holds no person's data."
    },
    "public.changelog_entries": {
      "disposition": "reference",
      "reason": "The public changelog. It holds no person's data."
    },
    "public.chat_messages": {
      "disposition": "exported",
      "reason": "The turns of an exported chat, up to the first one answered from data that has since changed. Only the history fields leave: no projection, retrieval ids, grant revisions or provider classification.",
      "scope": "chat_id is an exported chat.",
      "members": [
        "archive:chats.json",
        "reader:chat-messages"
      ],
      "columns": [
        "id",
        "chat_id",
        "role",
        "content",
        "created_at",
        "canonical_citations"
      ],
      "withheld": [
        "user_id",
        "turn_id",
        "turn_ordinal",
        "paired_role",
        "scope_revision",
        "authorization_fingerprint",
        "retrieved_subject_ids",
        "retrieved_purpose_keys",
        "contributor_ids",
        "grant_revisions",
        "lifecycle_revisions",
        "provider_classification",
        "runtime_attestation_revision",
        "model_recipient_revision",
        "cohort_authority_fingerprint",
        "citation_ids",
        "embryo_findings",
        "legacy_unverified",
        "canonical_projection"
      ]
    },
    "public.chats": {
      "disposition": "exported",
      "reason": "Saved Copilot conversations, as the chat history shows them (owner decision, 2026-09-26). Canonical chats never set a title; legacy chats are not exported. No grant revision, fingerprint or authority leaves.",
      "scope": "user_id = the requesting account, self scope, a subject this account IS, and the chat's own grants still current.",
      "members": [
        "archive:chats.json",
        "reader:chats"
      ],
      "columns": [
        "id",
        "created_at",
        "scope_kind",
        "subject_id"
      ],
      "withheld": [
        "user_id",
        "title",
        "cohort_id",
        "family_pair_id",
        "report_id",
        "scope_revision",
        "lifecycle_revision",
        "grant_revision",
        "relationship_revision",
        "provider_classification",
        "runtime_attestation_revision",
        "model_recipient_revision",
        "cohort_authority_fingerprint",
        "authorization_fingerprint",
        "legacy_unverified",
        "canonical_authority"
      ]
    },
    "public.clinical_assertion_releases": {
      "disposition": "reference",
      "reason": "Imported ClinVar assertion releases: source, date and digests. It holds no person's data."
    },
    "public.clinical_assertions": {
      "disposition": "reference",
      "reason": "Reviewed clinical assertions by variant and condition, imported from ClinVar. It holds no person's data."
    },
    "public.cloud_model_calls": {
      "disposition": "excluded-internal",
      "reason": "Provider call records keyed by request-id HMACs. It is machinery, not the person's record."
    },
    "public.cloud_provider_attempts": {
      "disposition": "excluded-internal",
      "reason": "Provider call attempts. It is machinery, not the person's record."
    },
    "public.cloud_provider_payloads": {
      "disposition": "excluded-protected",
      "reason": "Encrypted provider payloads, held only for their retention window. The conversation itself is exported in chats.json. The export contracts always exclude contact values, identity documents and evidence bytes."
    },
    "public.condition_registry": {
      "disposition": "reference",
      "reason": "The condition catalog. It holds no person's data."
    },
    "public.consent_artifacts": {
      "disposition": "reference",
      "reason": "The published legal texts. A signature names the key, version and body hash it signed; the text is public. It holds no person's data."
    },
    "public.consent_grants": {
      "disposition": "exported",
      "reason": "The person's legacy cloud-model consent history.",
      "scope": "user_id = the requesting account.",
      "members": [
        "archive:consents.json",
        "reader:history.legacy-consents"
      ],
      "columns": [
        "id",
        "provider_key",
        "data_classes",
        "granted_at",
        "revoked_at"
      ],
      "withheld": [
        "user_id"
      ]
    },
    "public.consent_purposes": {
      "disposition": "reference",
      "reason": "The purpose catalog. It holds no person's data."
    },
    "public.consent_signatures": {
      "disposition": "exported",
      "reason": "The consents and disclosures this account signed. Never the encrypted signing name: a signature leaves as what was signed, about what, and when.",
      "scope": "signer_account_id = the requesting account.",
      "members": [
        "archive:subject-record.json",
        "reader:history.signatures"
      ],
      "columns": [
        "id",
        "artifact_key",
        "artifact_version",
        "artifact_body_sha256",
        "signer_principal_id",
        "target_kind",
        "target_id",
        "purpose",
        "statement_keys",
        "jurisdiction_code",
        "jurisdiction_revision",
        "subject_binding_revision",
        "signed_at"
      ],
      "withheld": [
        "signer_account_id",
        "signing_name_encrypted"
      ]
    },
    "public.contact_hmac_indexes": {
      "disposition": "excluded-protected",
      "reason": "Contact HMAC indexes. The export contracts always exclude contact values, identity documents and evidence bytes."
    },
    "public.contact_refusal_bars": {
      "disposition": "excluded-protected",
      "reason": "HMACs of contacts that refused an invitation. The export contracts always exclude contact values, identity documents and evidence bytes."
    },
    "public.copilot_context_history": {
      "disposition": "excluded-internal",
      "reason": "Retrieval context fingerprints behind a Copilot turn. It is machinery, not the person's record."
    },
    "public.copilot_context_tokens": {
      "disposition": "excluded-credential",
      "reason": "Single-use Copilot context tokens and their nonce hashes. Exporting it would be a security defect, not completeness."
    },
    "public.copilot_generation_sessions": {
      "disposition": "excluded-credential",
      "reason": "Copilot generation sessions. Exporting it would be a security defect, not completeness."
    },
    "public.copilot_turn_dependencies": {
      "disposition": "excluded-internal",
      "reason": "Dependencies of a Copilot turn. It is machinery, not the person's record."
    },
    "public.correction_assignments": {
      "disposition": "out-of-scope",
      "reason": "Staff correction assignments; the outcome is on the request itself. It is not the requester's own record."
    },
    "public.correction_requests": {
      "disposition": "deferred",
      "reason": "The person's own correction requests. No correction surface ships and the statement is ciphertext. Belongs to the non-self and independent projections (docs/export-member-selection-design.md, step 3), which are not built."
    },
    "public.correction_working_data": {
      "disposition": "excluded-protected",
      "reason": "Working ciphertext of a correction request. The export contracts always exclude contact values, identity documents and evidence bytes."
    },
    "public.directional_grants": {
      "disposition": "deferred",
      "reason": "Grants from other people to this account. Belongs to the non-self and independent projections (docs/export-member-selection-design.md, step 3), which are not built."
    },
    "public.download_ranges": {
      "disposition": "excluded-internal",
      "reason": "Byte ranges served by a download session. It is machinery, not the person's record."
    },
    "public.download_sessions": {
      "disposition": "excluded-credential",
      "reason": "Download sessions bound to an auth session. Exporting it would be a security defect, not completeness."
    },
    "public.draft_participant_slots": {
      "disposition": "out-of-scope",
      "reason": "Participant slots of a short-lived draft. It is not the requester's own record."
    },
    "public.embryo_basis_bindings": {
      "disposition": "deferred",
      "reason": "The legal basis a cohort rests on. Belongs to the embryo cohort projection (embryos.json and the subject partitions of a cohort), which is not built. No production embryo ingest runs today."
    },
    "public.embryo_cohort_drafts": {
      "disposition": "out-of-scope",
      "reason": "A short-lived cohort draft; a finalized cohort is embryo_cohorts. It is not the requester's own record."
    },
    "public.embryo_cohorts": {
      "disposition": "deferred",
      "reason": "Embryo cohorts this account owns. Belongs to the embryo cohort projection (embryos.json and the subject partitions of a cohort), which is not built. No production embryo ingest runs today."
    },
    "public.embryo_disposition_confirmations": {
      "disposition": "deferred",
      "reason": "Disposition confirmations. Belongs to the embryo cohort projection (embryos.json and the subject partitions of a cohort), which is not built. No production embryo ingest runs today."
    },
    "public.embryo_disposition_proposals": {
      "disposition": "deferred",
      "reason": "Disposition proposals. Belongs to the embryo cohort projection (embryos.json and the subject partitions of a cohort), which is not built. No production embryo ingest runs today."
    },
    "public.embryo_donor_attributions": {
      "disposition": "deferred",
      "reason": "Donor attributions. Belongs to the embryo cohort projection (embryos.json and the subject partitions of a cohort), which is not built. No production embryo ingest runs today."
    },
    "public.embryo_draft_participants": {
      "disposition": "out-of-scope",
      "reason": "Participants of a short-lived cohort draft. It is not the requester's own record."
    },
    "public.embryo_figures": {
      "disposition": "deferred",
      "reason": "Embryo figures. Belongs to the embryo cohort projection (embryos.json and the subject partitions of a cohort), which is not built. No production embryo ingest runs today."
    },
    "public.embryo_fragment_handle_maps": {
      "disposition": "excluded-internal",
      "reason": "Embryo ingest handle maps. It is machinery, not the person's record."
    },
    "public.embryo_ingest_chunks": {
      "disposition": "excluded-internal",
      "reason": "Embryo ingest chunks. It is machinery, not the person's record."
    },
    "public.embryo_ingest_delete_objects": {
      "disposition": "excluded-internal",
      "reason": "Objects queued for an ingest unwind. It is machinery, not the person's record."
    },
    "public.embryo_ingest_fragments": {
      "disposition": "excluded-internal",
      "reason": "Embryo ingest fragments and their object names. It is machinery, not the person's record."
    },
    "public.embryo_ingest_sessions": {
      "disposition": "excluded-credential",
      "reason": "Embryo ingest sessions and their cookie hashes. Exporting it would be a security defect, not completeness."
    },
    "public.embryo_ingest_unwinds": {
      "disposition": "excluded-internal",
      "reason": "Embryo ingest unwinds. It is machinery, not the person's record."
    },
    "public.embryo_mapping_challenges": {
      "disposition": "excluded-credential",
      "reason": "Ingest mapping challenges and their nonce hashes. Exporting it would be a security defect, not completeness."
    },
    "public.embryo_operation_nonces": {
      "disposition": "excluded-credential",
      "reason": "Embryo operation nonces and rights receipts. Exporting it would be a security defect, not completeness."
    },
    "public.embryo_participant_sets": {
      "disposition": "deferred",
      "reason": "Cohort participant sets. Belongs to the embryo cohort projection (embryos.json and the subject partitions of a cohort), which is not built. No production embryo ingest runs today."
    },
    "public.embryo_qc": {
      "disposition": "deferred",
      "reason": "Embryo quality control (embryos.json). Belongs to the embryo cohort projection (embryos.json and the subject partitions of a cohort), which is not built. No production embryo ingest runs today."
    },
    "public.embryo_scores": {
      "disposition": "deferred",
      "reason": "Embryo scores. Belongs to the embryo cohort projection (embryos.json and the subject partitions of a cohort), which is not built. No production embryo ingest runs today."
    },
    "public.embryo_terminal_mail": {
      "disposition": "excluded-protected",
      "reason": "Terminal embryo mail with encrypted recipients and a claim token. The export contracts always exclude contact values, identity documents and evidence bytes."
    },
    "public.embryo_variants": {
      "disposition": "deferred",
      "reason": "Embryo variants, as a sanitized subject projection. Belongs to the embryo cohort projection (embryos.json and the subject partitions of a cohort), which is not built. No production embryo ingest runs today."
    },
    "public.embryos": {
      "disposition": "deferred",
      "reason": "Embryos. Belongs to the embryo cohort projection (embryos.json and the subject partitions of a cohort), which is not built. No production embryo ingest runs today."
    },
    "public.encrypted_contact_references": {
      "disposition": "excluded-protected",
      "reason": "Encrypted contact addresses and their HMACs. The export contracts always exclude contact values, identity documents and evidence bytes."
    },
    "public.family_pairs": {
      "disposition": "deferred",
      "reason": "Family pairs. Belongs to the family projection (portrait.json and joint results), which is not built."
    },
    "public.family_sharing_pauses": {
      "disposition": "deferred",
      "reason": "Family sharing pauses, which name the other account. Belongs to the family projection (portrait.json and joint results), which is not built."
    },
    "public.family_sharing_stops": {
      "disposition": "deferred",
      "reason": "Family sharing stops, which name the other account. Belongs to the family projection (portrait.json and joint results), which is not built."
    },
    "public.future_person_claim_assignments": {
      "disposition": "out-of-scope",
      "reason": "Staff claim assignments. It is not the requester's own record."
    },
    "public.future_person_claim_documents": {
      "disposition": "excluded-protected",
      "reason": "Identity and authority evidence documents. The export contracts always exclude contact values, identity documents and evidence bytes."
    },
    "public.future_person_claim_notices": {
      "disposition": "excluded-internal",
      "reason": "Claim notice mail. It is machinery, not the person's record."
    },
    "public.future_person_claim_objections": {
      "disposition": "deferred",
      "reason": "Objections to a claim. Belongs to the approved Future Person export (approved-future-person-export-v1). Claims are not open (G5.4)."
    },
    "public.future_person_claim_release_credentials": {
      "disposition": "excluded-credential",
      "reason": "Claim release credential hashes. Exporting it would be a security defect, not completeness."
    },
    "public.future_person_claim_review_packages": {
      "disposition": "excluded-internal",
      "reason": "Claim review packages. It is machinery, not the person's record."
    },
    "public.future_person_claim_sessions": {
      "disposition": "excluded-credential",
      "reason": "Claim sessions. Exporting it would be a security defect, not completeness."
    },
    "public.future_person_claimant_identity_hmacs": {
      "disposition": "excluded-protected",
      "reason": "Claimant identity HMACs. The export contracts always exclude contact values, identity documents and evidence bytes."
    },
    "public.future_person_claimant_principals": {
      "disposition": "deferred",
      "reason": "Claimant principals. Belongs to the approved Future Person export (approved-future-person-export-v1). Claims are not open (G5.4)."
    },
    "public.future_person_claims": {
      "disposition": "deferred",
      "reason": "Future Person claims. Belongs to the approved Future Person export (approved-future-person-export-v1). Claims are not open (G5.4)."
    },
    "public.future_person_identity": {
      "disposition": "excluded-protected",
      "reason": "Parent-supplied identity ciphertext and its HMAC. The export contracts always exclude contact values, identity documents and evidence bytes."
    },
    "public.future_person_record_key_hashes": {
      "disposition": "excluded-credential",
      "reason": "Record key hashes. Exporting it would be a security defect, not completeness."
    },
    "public.future_person_record_key_print_rights": {
      "disposition": "excluded-credential",
      "reason": "Rights to print a record key. Exporting it would be a security defect, not completeness."
    },
    "public.future_person_record_key_recipients": {
      "disposition": "excluded-credential",
      "reason": "Who may receive a record key. Exporting it would be a security defect, not completeness."
    },
    "public.future_person_recovery_key_hashes": {
      "disposition": "excluded-credential",
      "reason": "Recovery key hashes. Exporting it would be a security defect, not completeness."
    },
    "public.generated_exports": {
      "disposition": "excluded-internal",
      "reason": "Export jobs themselves, not the person's data. It is machinery, not the person's record."
    },
    "public.genome_files": {
      "disposition": "exported",
      "reason": "The files this account holds for its own subjects, as manifest.json describes them. Never the object key, storage id or processing internals. The runs-of-homozygosity summary (roh_*) feeds family features only and is not exported; it belongs with the family projection.",
      "scope": "user_id = the requesting account (legacy files); a subject this account IS (canonical files).",
      "members": [
        "archive:manifest.json",
        "archive:reports.json",
        "archive:reports.txt",
        "archive:canonical/"
      ],
      "columns": [
        "id",
        "original_name",
        "file_type",
        "tier",
        "size_bytes",
        "sha256",
        "status",
        "build",
        "variant_count",
        "created_at",
        "subject_id",
        "source_sha256",
        "upload_revision",
        "normalization_completed_at"
      ],
      "withheld": [
        "user_id",
        "bucket_path",
        "error",
        "processing_started_at",
        "processing_finished_at",
        "cohort_id",
        "is_cohort_file",
        "sample_count",
        "source_publication_state",
        "source_publication_revision",
        "source_binding_fingerprint",
        "storage_object_id",
        "structural_validator_version",
        "single_logical_sample_verified_at",
        "canonical_build",
        "roh_status",
        "roh_reason",
        "roh_total_bases",
        "roh_covered_bases",
        "roh_fraction",
        "roh_measured_at",
        "observed_call_sha256",
        "observed_call_version",
        "input_provenance",
        "input_source_sha256",
        "processing_run_id",
        "normalization_source_revision"
      ]
    },
    "public.genome_storage_objects": {
      "disposition": "excluded-internal",
      "reason": "Storage bookkeeping; the bytes are exported as originals/. It is machinery, not the person's record."
    },
    "public.invitation_candidates": {
      "disposition": "excluded-protected",
      "reason": "Invitation candidates pointing at encrypted contacts. The export contracts always exclude contact values, identity documents and evidence bytes."
    },
    "public.invitation_refusal_hmacs": {
      "disposition": "excluded-protected",
      "reason": "HMACs of refused invitation addresses. The export contracts always exclude contact values, identity documents and evidence bytes."
    },
    "public.invitation_reminders": {
      "disposition": "excluded-internal",
      "reason": "Invitation reminder mail. It is machinery, not the person's record."
    },
    "public.legal_audit_log": {
      "disposition": "exported",
      "reason": "L-34 and the owner's decision of 28 Sep 2026 (docs/export-legal-audit-resolver.md, option A): the events a person caused themselves. An event names who acted only when the transaction proved it, by a consumed session-bound nonce or the person's own JWT, and only on the closed list of events a person causes; events written before attribution began (20260928160000) name no one and never leave. Never the pseudonym or the chain hashes.",
      "scope": "audit_principal_id is the requesting account's own pseudonym (private.legal_audit_account_principals). Account exports only: an event records no subject.",
      "members": [
        "archive:legal-audit.json",
        "reader:history.legal-audit"
      ],
      "columns": [
        "seq",
        "occurred_at",
        "event_code",
        "route_id",
        "outcome_code",
        "coded_context"
      ],
      "withheld": [
        "audit_principal_id",
        "previous_hash",
        "row_hash"
      ]
    },
    "public.legal_audit_retention_checkpoints": {
      "disposition": "excluded-internal",
      "reason": "Non-identifying checkpoints of the audit chain's retention. It is machinery, not the person's record."
    },
    "public.legal_evidence_assignments": {
      "disposition": "out-of-scope",
      "reason": "Staff review assignments. It is not the requester's own record."
    },
    "public.legal_evidence_documents": {
      "disposition": "excluded-protected",
      "reason": "Legal evidence documents. The export contracts always exclude contact values, identity documents and evidence bytes."
    },
    "public.legal_evidence_fragments": {
      "disposition": "excluded-protected",
      "reason": "Upload fragments of legal evidence documents. The export contracts always exclude contact values, identity documents and evidence bytes."
    },
    "public.legal_evidence_ingest_sessions": {
      "disposition": "excluded-credential",
      "reason": "Evidence ingest sessions. Exporting it would be a security defect, not completeness."
    },
    "public.legal_evidence_review_copies": {
      "disposition": "excluded-protected",
      "reason": "Reviewer copies of legal evidence documents. The export contracts always exclude contact values, identity documents and evidence bytes."
    },
    "public.legal_evidence_working_data": {
      "disposition": "excluded-protected",
      "reason": "Working ciphertext of legal evidence. The export contracts always exclude contact values, identity documents and evidence bytes."
    },
    "public.legal_reviews": {
      "disposition": "out-of-scope",
      "reason": "Staff legal review decisions. It is not the requester's own record."
    },
    "public.llm_keys": {
      "disposition": "excluded-credential",
      "reason": "The person's stored provider API key. Exporting it would be a security defect, not completeness."
    },
    "public.llm_settings": {
      "disposition": "excluded-credential",
      "reason": "Sits beside the stored key: key_last4 is a fragment of the credential and base_url can embed one. Exporting it would be a security defect, not completeness."
    },
    "public.mail_deliveries": {
      "disposition": "excluded-internal",
      "reason": "Mail delivery events. It is machinery, not the person's record."
    },
    "public.mail_outbox": {
      "disposition": "excluded-internal",
      "reason": "The mail outbox. It is machinery, not the person's record."
    },
    "public.mail_provider_attempts": {
      "disposition": "excluded-internal",
      "reason": "Mail provider attempts. It is machinery, not the person's record."
    },
    "public.model_contexts": {
      "disposition": "excluded-internal",
      "reason": "Model context fingerprints. It is machinery, not the person's record."
    },
    "public.pending_source_rows": {
      "disposition": "excluded-internal",
      "reason": "Pending source rows of a worker job. It is machinery, not the person's record."
    },
    "public.portrait_results": {
      "disposition": "deferred",
      "reason": "Portrait results. Belongs to the family projection (portrait.json and joint results), which is not built."
    },
    "public.profiles": {
      "disposition": "exported",
      "reason": "This account's own profile, reduced to what the person gave for their record: the birth date and the declared country and state. The remaining columns are internal revisions and flags. display_name and digest_opt_in are the person's own settings and are not yet exported; they are named here so the gap is visible.",
      "scope": "id = the requesting account.",
      "members": [
        "archive:subject-record.json"
      ],
      "columns": [
        "id",
        "jurisdiction_code",
        "jurisdiction_revision",
        "date_of_birth",
        "jurisdiction_declared_at",
        "jurisdiction_attestation_version",
        "jurisdiction_attestation_sha256",
        "jurisdiction_subdivision"
      ],
      "withheld": [
        "display_name",
        "digest_opt_in",
        "created_at",
        "account_revision",
        "auth_session_revision",
        "non_self_upload_suspended_at",
        "deletion_requested_at",
        "mail_contact_revision",
        "copilot_settings_revision"
      ]
    },
    "public.provider_recipient_grants": {
      "disposition": "exported",
      "reason": "The provider grants recorded against this account.",
      "scope": "account_id = the requesting account.",
      "members": [
        "archive:subject-record.json",
        "reader:history.recipient-grants"
      ],
      "columns": [
        "id",
        "account_id",
        "recipient_principal_id",
        "provider_id",
        "purpose",
        "artifact_key",
        "artifact_version",
        "grant_revision",
        "model_recipient_revision",
        "status",
        "created_at",
        "ended_at"
      ],
      "withheld": []
    },
    "public.providers": {
      "disposition": "reference",
      "reason": "The testing-provider catalog. It holds no person's data."
    },
    "public.prs_scores": {
      "disposition": "reference",
      "reason": "The score catalog. It holds no person's data."
    },
    "public.prs_weights": {
      "disposition": "reference",
      "reason": "The score weights. It holds no person's data."
    },
    "public.purge_manifest_class_targets": {
      "disposition": "reference",
      "reason": "The purge registry. It holds no person's data."
    },
    "public.purge_manifest_classes": {
      "disposition": "reference",
      "reason": "The purge registry. It holds no person's data."
    },
    "public.purge_manifest_entries": {
      "disposition": "excluded-internal",
      "reason": "Purge manifest entries: row keys of data being deleted. It is machinery, not the person's record."
    },
    "public.purge_manifests": {
      "disposition": "excluded-internal",
      "reason": "Purge manifests. It is machinery, not the person's record."
    },
    "public.purge_target_stores": {
      "disposition": "reference",
      "reason": "The purge registry. It holds no person's data."
    },
    "public.purge_targets": {
      "disposition": "reference",
      "reason": "The purge registry. It holds no person's data."
    },
    "public.purpose_grant_nonces": {
      "disposition": "excluded-credential",
      "reason": "Purpose grant nonces. Exporting it would be a security defect, not completeness."
    },
    "public.purpose_grants": {
      "disposition": "exported",
      "reason": "The permissions on the subjects this account IS that rest on its own signatures. The asynchronous reader has no class for them yet.",
      "scope": "target is a subject this account IS, and the signature is this account's own.",
      "members": [
        "archive:subject-record.json"
      ],
      "columns": [
        "grant_id",
        "grant_revision",
        "target_kind",
        "target_id",
        "purpose",
        "artifact_key",
        "artifact_version",
        "artifact_body_sha256",
        "signature_id",
        "signer_principal_id",
        "data_subject_principal_id",
        "subject_binding_revision",
        "jurisdiction_code",
        "jurisdiction_revision",
        "granted_at",
        "expires_at",
        "revoked_at",
        "revocation_reason"
      ],
      "withheld": [
        "copilot_recipient_revision"
      ]
    },
    "public.rate_limit_hmac_buckets": {
      "disposition": "excluded-internal",
      "reason": "Rate-limit counters keyed by HMAC. It is machinery, not the person's record."
    },
    "public.ref_genes": {
      "disposition": "reference",
      "reason": "Reference genes. It holds no person's data."
    },
    "public.ref_region_releases": {
      "disposition": "reference",
      "reason": "Reference region releases. It holds no person's data."
    },
    "public.ref_regions": {
      "disposition": "reference",
      "reason": "Reference regions. It holds no person's data."
    },
    "public.ref_variants": {
      "disposition": "reference",
      "reason": "Reference variants. It holds no person's data."
    },
    "public.report_artifacts": {
      "disposition": "deferred",
      "reason": "Subject and cohort report artifacts. No writer ships today. Belongs to the non-self and independent projections (docs/export-member-selection-design.md, step 3), which are not built."
    },
    "public.report_observed_calls": {
      "disposition": "exported",
      "reason": "Literal source observations, including reference and no-call records. The filter, quality and depth fields stay in the original upload, which is exported byte for byte.",
      "scope": "file_id is an exported canonical file of the requesting account.",
      "members": [
        "archive:observed/",
        "reader:observed"
      ],
      "columns": [
        "file_id",
        "source_line",
        "source_sha256",
        "source_build",
        "source_chrom",
        "source_pos",
        "source_ref",
        "source_alt",
        "source_gt",
        "rsid",
        "chrom",
        "pos",
        "ref",
        "alt",
        "genotype",
        "quality_state",
        "usable"
      ],
      "withheld": [
        "user_id",
        "subject_id",
        "extraction_version",
        "site_filter",
        "sample_filter",
        "genotype_quality",
        "read_depth"
      ]
    },
    "public.report_templates": {
      "disposition": "reference",
      "reason": "The report catalog. It holds no person's data."
    },
    "public.research_releases": {
      "disposition": "reference",
      "reason": "Research release bookkeeping. It holds no person's data."
    },
    "public.retention_due_phases": {
      "disposition": "excluded-internal",
      "reason": "Due retention phases with their claim token hash. It is machinery, not the person's record."
    },
    "public.retention_notice_campaigns": {
      "disposition": "excluded-internal",
      "reason": "Retention notice campaigns. It is machinery, not the person's record."
    },
    "public.retention_phase_registry": {
      "disposition": "reference",
      "reason": "The retention registry. It holds no person's data."
    },
    "public.retention_registry": {
      "disposition": "reference",
      "reason": "The retention registry. It holds no person's data."
    },
    "public.retention_rows": {
      "disposition": "excluded-internal",
      "reason": "Retention deadlines for a target. The deadlines a person needs are shown on their pages. It is machinery, not the person's record."
    },
    "public.reviewed_evidence": {
      "disposition": "excluded-protected",
      "reason": "Reviewed evidence documents and their storage ids. The export contracts always exclude contact values, identity documents and evidence bytes."
    },
    "public.rights_nonces": {
      "disposition": "excluded-credential",
      "reason": "Rights-session nonces. Exporting it would be a security defect, not completeness."
    },
    "public.rights_sessions": {
      "disposition": "excluded-credential",
      "reason": "Rights sessions and their hashes. Exporting it would be a security defect, not completeness."
    },
    "public.risk_models": {
      "disposition": "reference",
      "reason": "The risk model catalog. It holds no person's data."
    },
    "public.subject_account_bindings": {
      "disposition": "exported",
      "reason": "The bindings between this account and its own subjects.",
      "scope": "account_id = the requesting account.",
      "members": [
        "archive:subject-record.json",
        "reader:history.bindings"
      ],
      "columns": [
        "id",
        "subject_id",
        "subject_principal_id",
        "account_id",
        "account_principal_id",
        "binding_kind",
        "binding_revision",
        "status",
        "bound_at",
        "ended_at"
      ],
      "withheld": []
    },
    "public.subject_consents": {
      "disposition": "exported",
      "reason": "The subject-level consents this account gave. A row may carry another subject's id: it records something this account did (operator decision, 2026-09-11).",
      "scope": "account_id = the requesting account.",
      "members": [
        "archive:subject-record.json",
        "reader:history.account-consents"
      ],
      "columns": [
        "id",
        "signature_id",
        "subject_id",
        "cohort_id",
        "account_id",
        "consent_type",
        "scope",
        "provider_key",
        "grant_revision",
        "granted_at",
        "expires_at",
        "revoked_at",
        "revocation_reason",
        "copilot_recipient"
      ],
      "withheld": []
    },
    "public.subject_control_refusal_authorities": {
      "disposition": "deferred",
      "reason": "Refusal authority over a subject. Belongs to the non-self and independent projections (docs/export-member-selection-design.md, step 3), which are not built."
    },
    "public.subject_demographics": {
      "disposition": "exported",
      "reason": "The birth date and declared chromosomal sex of the subjects this account IS.",
      "scope": "subject_id in the subjects exported above.",
      "members": [
        "archive:subject-record.json",
        "reader:history.demographics"
      ],
      "columns": [
        "subject_id",
        "date_of_birth",
        "chromosomal_sex",
        "demographics_revision",
        "updated_at"
      ],
      "withheld": []
    },
    "public.subject_invitations": {
      "disposition": "excluded-protected",
      "reason": "Invitations carry the invitee's encrypted address, its HMAC and the token hash. The fact of an invitation belongs to the non-self projection (step 3). The export contracts always exclude contact values, identity documents and evidence bytes."
    },
    "public.subject_principals": {
      "disposition": "exported",
      "reason": "The principals that connect this account to its own subjects.",
      "scope": "account_id = the requesting account.",
      "members": [
        "archive:subject-record.json",
        "reader:history.principals"
      ],
      "columns": [
        "id",
        "subject_id",
        "account_id",
        "principal_kind",
        "principal_revision",
        "status",
        "created_at"
      ],
      "withheld": []
    },
    "public.subject_relationships": {
      "disposition": "deferred",
      "reason": "Relationships where this account is the recipient. Belongs to the non-self and independent projections (docs/export-member-selection-design.md, step 3), which are not built."
    },
    "public.subjects": {
      "disposition": "exported",
      "reason": "The subjects this account IS. A row never names the account that holds it or a cohort: for an adult held by another uploader, owner_account_id is that other person's account.",
      "scope": "subject_account_id = the requesting account (synchronous); the captured partitions, which are the same subjects (reader).",
      "members": [
        "archive:subject-record.json",
        "reader:history.subjects"
      ],
      "columns": [
        "id",
        "subject_account_id",
        "subject_class",
        "upload_class",
        "display_label",
        "lifecycle",
        "subject_binding_revision",
        "lifecycle_revision",
        "created_at",
        "updated_at",
        "portrait_acknowledged_at",
        "independent_login_at"
      ],
      "withheld": [
        "owner_account_id",
        "cohort_id"
      ]
    },
    "public.suppressions": {
      "disposition": "deferred",
      "reason": "Condition suppressions that follow a correction. Belongs to the non-self and independent projections (docs/export-member-selection-design.md, step 3), which are not built."
    },
    "public.template_reviews": {
      "disposition": "out-of-scope",
      "reason": "Staff reviews of catalog templates. It is not the requester's own record."
    },
    "public.token_candidates": {
      "disposition": "excluded-credential",
      "reason": "Mailed token candidates. Exporting it would be a security defect, not completeness."
    },
    "public.token_hashes": {
      "disposition": "excluded-credential",
      "reason": "Hashes of mailed tokens. Exporting it would be a security defect, not completeness."
    },
    "public.upload_chunks": {
      "disposition": "excluded-internal",
      "reason": "Upload chunks. It is machinery, not the person's record."
    },
    "public.upload_sessions": {
      "disposition": "excluded-credential",
      "reason": "Upload sessions, their token ids and staging names. Exporting it would be a security defect, not completeness."
    },
    "public.upload_staging_objects": {
      "disposition": "excluded-internal",
      "reason": "Upload staging objects. It is machinery, not the person's record."
    },
    "public.user_prs": {
      "disposition": "exported",
      "reason": "Score-panel coverage only. Unvalidated score numbers (raw_score, zscore, percentile) are not exported (prs_format coverage-only-v1).",
      "scope": "user_id = the requesting account, for its exported files.",
      "members": [
        "archive:prs.json",
        "reader:prs"
      ],
      "columns": [
        "file_id",
        "pgs_id",
        "matched",
        "computed_at"
      ],
      "withheld": [
        "id",
        "user_id",
        "raw_score",
        "zscore",
        "percentile",
        "coverage",
        "subject_id"
      ]
    },
    "public.user_variants": {
      "disposition": "exported",
      "reason": "Normalized GRCh38 variants, one CSV per file, and the genotypes legacy reports are resolved from.",
      "scope": "file_id is an exported file of the requesting account.",
      "members": [
        "archive:variants/",
        "archive:reports.json",
        "archive:reports.txt",
        "reader:variants"
      ],
      "columns": [
        "file_id",
        "rsid",
        "chrom",
        "pos",
        "ref",
        "alt",
        "genotype"
      ],
      "withheld": [
        "id",
        "user_id",
        "subject_id"
      ]
    },
    "public.worker_job_batches": {
      "disposition": "excluded-internal",
      "reason": "Worker job batches. It is machinery, not the person's record."
    },
    "public.worker_jobs": {
      "disposition": "excluded-internal",
      "reason": "Worker queue rows with claim token hashes. It is machinery, not the person's record."
    },
    "public.other_adult_held_uploads": {
      "disposition": "out-of-scope",
      "reason": "The uploader's quarantined original belongs to another adult. It is not the uploader's own record; no genetic result or held source can leave in the uploader's export."
    }
  }
}
$plan$::jsonb as plan;
-- END GENERATED

-- Every ordinary table in public and private, and whether it is person-scoped:
-- a column named user_id or account_id or ending in _user_id or _account_id, a
-- foreign key to auth.users or public.audit_principals, or a foreign key to a
-- table that is already person-scoped.
create function pg_temp.export_universe() returns table(table_name text, person_scoped boolean)
language sql stable as $$
 with recursive edges as (
  select k.conrelid as child, k.confrelid as parent from pg_catalog.pg_constraint k where k.contype='f'),
 tables as (
  select c.oid, n.nspname||'.'||c.relname as table_name from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','private') and c.relkind in ('r','p') and not c.relispartition),
 seed as (
  select t.oid from tables t where exists(select 1 from pg_catalog.pg_attribute a where a.attrelid=t.oid
   and a.attnum>0 and not a.attisdropped
   and (a.attname in ('user_id','account_id') or a.attname ~ '_(user|account)_id$'))
  union select e.child from edges e where e.parent in ('auth.users'::regclass,'public.audit_principals'::regclass)
  union select 'public.audit_principals'::regclass::oid),
 closure(oid) as (select oid from seed union select e.child from edges e join closure c on e.parent=c.oid)
 select t.table_name, t.oid in (select oid from closure) from tables t
$$;

create function pg_temp.export_columns(p_table text) returns setof text language sql stable as $$
 select a.attname::text from pg_catalog.pg_attribute a
 where a.attrelid=p_table::regclass and a.attnum>0 and not a.attisdropped
$$;

-- Every way a plan can disagree with the catalog, as named lists. The plan
-- holds when every list is empty.
create function pg_temp.export_plan_verdict(p_plan jsonb) returns jsonb language plpgsql stable as $$
declare
 dispositions text[]:=array['exported','excluded-credential','excluded-protected','excluded-internal',
  'out-of-scope','deferred','reference'];
 -- A credential, key, token, nonce or session table is an excluded credential.
 credential_table text:='(^|_)(nonces?|tokens?|sessions?|keys?|credentials?|secrets?|cookies?|passwords?)(_|$)';
 -- A table of HMACs is never exported, now or later.
 hmac_table text:='(^|_)hmacs?(_|$)';
 -- No exported column may look like a secret, a contact or a network trace.
 secret_column text:='(encrypted|ciphertext|hmac|secret|password|token|nonce|cookie|_hash$|_hash_|user_agent|(^|_)ip(_|$)|key_last4|base_url)';
 verdict jsonb;
begin
 with universe as (select * from pg_temp.export_universe()),
 plan as (select key as table_name, value as entry from jsonb_each(p_plan->'tables')),
 exported as (select p.table_name, p.entry from plan p join universe u using(table_name)
  where p.entry->>'disposition'='exported' and jsonb_typeof(p.entry->'columns')='array'
   and jsonb_typeof(p.entry->'withheld')='array'),
 listed as (
  select e.table_name, c.value as column_name, 'columns' as list
  from exported e cross join jsonb_array_elements_text(e.entry->'columns') c
  union all
  select e.table_name, w.value, 'withheld' from exported e cross join jsonb_array_elements_text(e.entry->'withheld') w),
 catalog as (select e.table_name, c.column_name from exported e cross join lateral pg_temp.export_columns(e.table_name) c(column_name))
 select jsonb_build_object(
  'version',p_plan->>'version',
  'tableCount',(select count(*) from plan),
  'unplanned',(select coalesce(jsonb_agg(u.table_name order by u.table_name),'[]') from universe u
   where not (p_plan->'tables' ? u.table_name)),
  'stale',(select coalesce(jsonb_agg(p.table_name order by p.table_name),'[]') from plan p
   where not exists(select 1 from universe u where u.table_name=p.table_name)),
  'invalid',(select coalesce(jsonb_agg(p.table_name order by p.table_name),'[]') from plan p
   where not coalesce(p.entry->>'disposition'=any(dispositions),false)
    or coalesce(length(p.entry->>'reason'),0)<20
    or (p.entry->>'disposition'='exported' and (jsonb_typeof(p.entry->'members') is distinct from 'array'
     or coalesce(jsonb_array_length(case when jsonb_typeof(p.entry->'members')='array' then p.entry->'members' end),0)=0
     or jsonb_typeof(p.entry->'columns') is distinct from 'array' or jsonb_typeof(p.entry->'withheld') is distinct from 'array'
     or coalesce(length(p.entry->>'scope'),0)<10))),
  'personScopedAsReference',(select coalesce(jsonb_agg(p.table_name order by p.table_name),'[]') from plan p
   join universe u using(table_name) where u.person_scoped and p.entry->>'disposition'='reference'),
  'credentialsNotExcluded',(select coalesce(jsonb_agg(p.table_name order by p.table_name),'[]') from plan p
   where split_part(p.table_name,'.',2) ~ credential_table and p.entry->>'disposition' is distinct from 'excluded-credential'),
  'hmacTablesExported',(select coalesce(jsonb_agg(p.table_name order by p.table_name),'[]') from plan p
   where split_part(p.table_name,'.',2) ~ hmac_table and p.entry->>'disposition' in ('exported','deferred')),
  'unclassifiedColumns',(select coalesce(jsonb_agg(c.table_name||'.'||c.column_name order by 1),'[]') from catalog c
   where not exists(select 1 from listed l where l.table_name=c.table_name and l.column_name=c.column_name)),
  'staleColumns',(select coalesce(jsonb_agg(l.table_name||'.'||l.column_name order by 1),'[]') from listed l
   where not exists(select 1 from catalog c where c.table_name=l.table_name and c.column_name=l.column_name)),
  'duplicateColumns',(select coalesce(jsonb_agg(d.name order by d.name),'[]') from (
   select l.table_name||'.'||l.column_name as name from listed l group by l.table_name,l.column_name having count(*)>1) d),
  'secretColumnsExported',(select coalesce(jsonb_agg(l.table_name||'.'||l.column_name order by 1),'[]') from listed l
   where l.list='columns' and l.column_name ~ secret_column)
 ) into verdict;
 return verdict||jsonb_build_object('ok',not exists(select 1 from jsonb_each(verdict) x
  where case when jsonb_typeof(x.value)='array' then jsonb_array_length(x.value) else 0 end>0));
end $$;

create temporary table verdict as select pg_temp.export_plan_verdict(plan) as v from export_member_plan;

select is((select plan->>'version' from export_member_plan),'export-member-plan-v1','the plan is versioned');
select set_eq('select table_name from pg_temp.export_universe()',
 $$select jsonb_object_keys(plan->'tables') from export_member_plan$$,
 'the plan names every table in public and private, and no other');
select is((select v->'unplanned' from verdict),'[]'::jsonb,'no table is missing from the plan');
select is((select v->'stale' from verdict),'[]'::jsonb,'no plan entry names a table that does not exist');
select is((select v->'invalid' from verdict),'[]'::jsonb,'every entry has a known disposition and a reason, and every exported one its scope, members and columns');
select is((select v->'personScopedAsReference' from verdict),'[]'::jsonb,'no person-scoped table is waved off as reference data');
select is((select v->'credentialsNotExcluded' from verdict),'[]'::jsonb,'every credential, key, token, nonce and session table is an excluded credential');
select is((select v->'hmacTablesExported' from verdict),'[]'::jsonb,'no table of HMACs is exported or deferred');
select is((select v->'unclassifiedColumns' from verdict),'[]'::jsonb,'every column of an exported table is classified as exported or withheld');
select is((select v->'staleColumns' from verdict),'[]'::jsonb,'no exported table lists a column it does not have');
select is((select v->'duplicateColumns' from verdict),'[]'::jsonb,'no column is both exported and withheld, or listed twice');
select is((select v->'secretColumnsExported' from verdict),'[]'::jsonb,'no exported column looks like a secret, a contact or a network trace');
select ok((select (v->>'ok')::boolean from verdict),'the plan holds against the catalog');

-- The credentials the brief names, each held by name as well as by pattern.
select is((select plan#>>'{tables,public.llm_keys,disposition}' from export_member_plan),'excluded-credential',
 'the stored provider key is never exported');
select is((select plan#>>'{tables,public.llm_settings,disposition}' from export_member_plan),'excluded-credential',
 'the provider settings beside the key are never exported');
select is((select plan#>>'{tables,public.copilot_context_tokens,disposition}' from export_member_plan),'excluded-credential',
 'Copilot context tokens are never exported');
select is_empty($$select key from export_member_plan,jsonb_each(plan->'tables')
 where key ~ '(nonce|session)' and value->>'disposition'<>'excluded-credential'$$,
 'every nonce and session table is an excluded credential');
select ok((select count(*) from export_member_plan,jsonb_each(plan->'tables') where key ~ '(nonce|session)')>=13,
 'the nonce and session check is not vacuous');

-- The redaction the export relies on, held by name.
select ok((select plan#>'{tables,public.consent_signatures,withheld}' ? 'signing_name_encrypted' from export_member_plan),
 'a signature never leaves with its encrypted signing name');
select ok((select plan#>'{tables,public.subjects,withheld}' ? 'owner_account_id' from export_member_plan),
 'a subject never leaves naming the account that holds it');
select ok((select plan#>'{tables,public.genome_files,withheld}' @> '["bucket_path","storage_object_id"]' from export_member_plan),
 'a file never leaves with its object key or storage id');

-- The scope rule reaches through foreign keys, so a table keyed only by a
-- subject or a file is person-scoped and cannot be classified as reference.
select ok((select person_scoped from pg_temp.export_universe() where table_name='public.subject_demographics'),
 'a table keyed only by subject is person-scoped');
select ok((select person_scoped from pg_temp.export_universe() where table_name='public.user_variants'),
 'a table keyed by account and file is person-scoped');
select ok((select person_scoped from pg_temp.export_universe() where table_name='public.legal_audit_log'),
 'the legal audit ledger is person-scoped through its pseudonyms');
select ok(not (select person_scoped from pg_temp.export_universe() where table_name='public.report_templates'),
 'the report catalog is not person-scoped');

-- Planted regressions: each must make the check fail, or it proves nothing.
select ok((select (pg_temp.export_plan_verdict(plan #- '{tables,public.llm_keys}')->'unplanned') ? 'public.llm_keys'
 from export_member_plan),
 'a table dropped from the plan is reported as unplanned');
select ok((select (pg_temp.export_plan_verdict(jsonb_set(plan,'{tables,public.llm_keys}',
 '{"disposition":"exported","reason":"planted: the stored provider key exported","scope":"planted scope",
   "members":["archive:planted.json"],"columns":["user_id","encrypted_key","updated_at"],"withheld":[]}'))
 ->'credentialsNotExcluded') ? 'public.llm_keys' from export_member_plan),
 'a credential table marked exported is reported');
select ok((select (pg_temp.export_plan_verdict(jsonb_set(plan,'{tables,public.llm_keys}',
 '{"disposition":"exported","reason":"planted: the stored provider key exported","scope":"planted scope",
   "members":["archive:planted.json"],"columns":["user_id","encrypted_key","updated_at"],"withheld":[]}'))
 ->'secretColumnsExported') ? 'public.llm_keys.encrypted_key' from export_member_plan),
 'and so is its encrypted key column');
select ok((select (pg_temp.export_plan_verdict(jsonb_set(jsonb_set(plan,
 '{tables,public.consent_signatures,columns}',(plan#>'{tables,public.consent_signatures,columns}')||'["signing_name_encrypted"]'),
 '{tables,public.consent_signatures,withheld}',(plan#>'{tables,public.consent_signatures,withheld}')-'signing_name_encrypted'))
 ->'secretColumnsExported') ? 'public.consent_signatures.signing_name_encrypted' from export_member_plan),
 'removing the signing-name redaction is reported');
select ok((select jsonb_array_length(pg_temp.export_plan_verdict(jsonb_set(plan,
 '{tables,public.subjects,withheld}',(plan#>'{tables,public.subjects,withheld}')-'owner_account_id'))
 ->'unclassifiedColumns')=1 from export_member_plan),
 'dropping a withheld column without classifying it is reported');
select ok((select (pg_temp.export_plan_verdict(jsonb_set(plan,'{tables,public.no_such_table}',
 '{"disposition":"reference","reason":"planted: a table that does not exist"}'))->'stale') ? 'public.no_such_table'
 from export_member_plan),
 'a plan entry for a missing table is reported as stale');
select ok((select (pg_temp.export_plan_verdict(jsonb_set(plan,'{tables,public.report_templates,disposition}','"exported"'))
 ->'invalid') ? 'public.report_templates' from export_member_plan),
 'an exported entry without scope, members or columns is invalid');

create table public.export_plan_probe_account(id uuid primary key, account_id uuid);
create table private.export_plan_probe_subject(id uuid primary key, subject_id uuid references public.subjects(id));
alter table public.consent_grants add column export_plan_probe text;
create temporary table planted as select pg_temp.export_plan_verdict(plan) as v from export_member_plan;
select ok((select v->'unplanned' ? 'public.export_plan_probe_account' from planted),
 'a new table keyed to an account fails the plan until it has an entry');
select ok((select v->'unplanned' ? 'private.export_plan_probe_subject' from planted),
 'a new table keyed only to a subject fails the plan too');
select ok((select person_scoped from pg_temp.export_universe() where table_name='private.export_plan_probe_subject'),
 'and it is person-scoped through its foreign key');
select ok((select (pg_temp.export_plan_verdict(jsonb_set(plan,'{tables,private.export_plan_probe_subject}',
 '{"disposition":"reference","reason":"planted: a subject table called reference data"}'))
 ->'personScopedAsReference') ? 'private.export_plan_probe_subject' from export_member_plan),
 'so it cannot be classified as reference data');
select ok((select v->'unclassifiedColumns' ? 'public.consent_grants.export_plan_probe' from planted),
 'a new column on an exported table fails the plan until it is classified');
select ok((select not (v->>'ok')::boolean from planted),'the planted schema does not hold');

select * from finish();
rollback;
