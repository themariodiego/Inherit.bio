# Export member-selection bridge: read-only design

Reviewed source: `codex/async-export-delivery`, commit `5842d39e508dcca5a73745624ff019bfa0c6027a` in `/Users/mariodiego/Documents/ChatGPT/Inherit Bio/async-export-delivery`. This is a repository-source audit, with no database, provider, browser or application execution. No repository or index edits. G5.6 remains NO.

## Exact next bounded implementation

Add one separate, service-only, read-only RPC:

```sql
public.export_archive_content_v1(
  p_operation text, p_export_id uuid, p_attempt_id uuid,
  p_authority_receipt text, p_payload jsonb default null
) returns jsonb
```

Every operation resolves route, export contract, target and origin from the stored job; calls `private.export_archive_current_v1`; checks the exact active writing attempt, pinned receipt and unexpired lease; reads only the captured target; and rechecks the same source/attempt/lease/current graph before returning. Maintain the existing source-before-job lock order. No nonce, lease renewal or other write belongs in this reader. A digest is not authority. Reject unsupported origins/partitions for the whole request.

Proposed closed operations:

| Operation | Payload | Result and restriction |
| --- | --- | --- |
| context | null | Actual stored account/session, route/contract/target, pinned receipt and lease/deadline. Worker-internal only; never archive members or client response. |
| files | `{afterFileId}` | Keyset page of at most 100 exact source snapshots plus next cursor. Enumerate every in-scope genome_files row and refuse any null/unavailable source. Never reuse the filtered old list operation to claim completeness. |
| check | `{fileId,snapshot}` | Exact current snapshot confirmation for one file belonging to a captured subject partition. |
| variants/observed/reports/prs/ancestry | `{fileId,snapshot,offset}` | Existing bounded projection under both per-file authority and job authority. No caller account/session, source URL, bucket, key, arbitrary operation or limit. |
| original, later | exact file/expected descriptor | The real retained-original authorization or explicit retirement state; never caller-selected Storage paths. |

Prepared database call operations continue to refuse with `prepared_object_reader_required`. Existing `exportOwnPreparedRecords` consumes the real published immutable records using the DB-returned actor, with job checks around every read/consumer checkpoint. Returning an internal actor merely composes existing checks; it never permits a rights session to borrow an uploader identity.

Before delegation, apply current-purpose and completed-run authority for reports/PRS on BOTH database and prepared backends. The latest existing content helper adds that extra gate only for prepared sources; ancestry already applies it to both. Preserve original captured text/catalog snapshots, including known correction notices, rather than generating or upgrading reports during export.

This first slice is not the complete member selector and cannot remove the publication hold.

## Full member/source mapping

The current authority hashes profile, subject/binding/principal/source state, target grants/signatures/artifacts, subject consents and own analysis runs. It does not yet cover every export member. The following work is required before the same authority can support a complete member manifest.

| Required class | Real existing source/scoping | Required addition |
| --- | --- | --- |
| Own subject identity and history | subjectRecordOf: subjects.subject_account_id; subject_principals/account_bindings/subject_consents/provider_recipient_grants.account_id; demographics only through those owned-subject IDs | Closed keyset pages, exact archived columns, content/fingerprint binding. Existing direct unpaginated SELECTs can hit configured max_rows=1000. |
| Canonical file identity/calls | private.own_export_source_v1 plus own_subject_export_content_v1; immutable prepared-source manifest/record reader | Job/attempt binding, exhaustive source enumeration and per-file row-count/member-hash proof. |
| Captured reports, ancestry and PRS coverage | Current own completed-run/source authority and stored results | Purpose gating for both backends, bounded pages, final equality. Do not regenerate legacy report wording using current templates. |
| Legacy account consent history | consent_grants.user_id | Closed pagination and receipt inclusion, distinguished from subject_consents. |
| Signatures/attestations | consent_signatures signer principal/account plus exact target; attestations principal/target/signature FKs | Requester-owned and per-subject slices, redaction, pagination, immutable identity/content binding. No encrypted signing-name bytes, evidence keys or contact fields in generic projections. |
| Chats/messages | chats and chat_messages owner, scope and canonical authority/projection fields | Exhaustive export-specific selector with live contributor scope, preservation of saved history/correction notices, no model call or provider-configuration prerequisite. |
| Legal audit | legal_audit_log with audit_principals and encrypted audit_principal_links/link_keys | Actual requester-to-audit-principal resolver and closed paginated ledger slice. No such resolver was found in current application or migration code. Absence of a resolver does not prove zero rows. |
| Subject directories and top-level indexes | subject-partitioned-archive-v1 requiredArtifacts, topLevelIndexContract and conditionalRawArtifacts | Deterministic server member plan, exact pointers, per-member/per-file count and digest, and final complete-set equality. Required empty JSON artifacts still carry their schema version/empty array. |

`audit-log.json` and `legal-audit.json` must project the single canonical ledger as registered. The register explicitly names public.audit_log as a prohibited parallel store; do not create it.

The real `own_copilot_chat_v1` cannot be the exhaustive exporter: list is limited to 50 chats, history to 100 messages, and it starts by requiring current Copilot configuration/grants. The synchronous route's buildChats also cannot be the safety boundary: it queries account-owned rows without the required per-chat contributor projection, and its claim that conversations are not stored is stale.

The synchronous export route is not the new producer: its layout differs from the registered partitioned archive, its legacy original path materializes a Blob, some missing originals become warnings, legacy report generation uses current templates, and some row-count differences are warnings. None of those behaviors establish complete asynchronous export.

The retained prepared-original reader is a useful exact-source range primitive, but its current descriptor has a finite approximately 270-second authorization horizon and the reader has an existing 300-second overall bound. Do not silently extend those limits to support large archive generation; compose a separately reviewed worker source contract. Earlier verified original ranges can enter an UNPUBLISHED archive, but final size/hash mismatch must abort the attempt and its reserved-key cleanup obligation.

## Missing non-self/independent scopes

- Account required-partition discovery must ultimately include owned adult subjects, actor-bound adult subjects held by another uploader, claimed-bound Future Person records, owned/evidenced-parent cohorts, and live granted subject/pair/cohort/joint artifacts. Current SQL refuses the whole request when an unsupported class is present. Keep that behavior until the exact projector is supplied.
- Granted adult/shared report and ancestry readers already have recipient/source authority and locked confirmation primitives. They provide reusable checks, not complete export projection: their UI omissions/legacy/readiness behavior and raw-export restrictions must remain explicit. Add minimized consent/file metadata, live joint-contributor projection and independent raw-export grants separately.
- Claimed-bound and approved Future Person exports need exact approved claim, transfer, subject binding and independent rights authority. Parent grant revocation cannot veto the approved subject's own historical agreement slice; parent genomes, contacts, chats and siblings remain excluded.
- Adult subject-control and parent/cohort independent exports require the exact live rights-session principal/target, not a pending invitation or an uploader session. Current activation/responder implementations cover pending adult/co-parent invitations; those are not held-data export authority.
- Current generated_exports.account_id is NOT NULL and current export_archive_authority_v1 accepts only `{kind:'account',accountId,sessionId}`. Accountless origins need a reviewed ownership/FK/purge representation and their own authority capture. Do not invent an account identity to fit the existing schema. Token support alone does not implement this origin.

These are implementation gaps under existing decisions, not reasons to seek a new scope decision from the owner. Existing privacy and capacity limits remain unchanged.

## Integration order and meaningful verification

1. Implement and verify the bounded job/content reader above, while preserving the ready hold.
2. Add the remaining own-history/artifact selectors and a versioned, immutable member-plan receipt. Bind every selected row/revision/content digest and inclusion/exclusion reason. Enumerate and compare the entire authorized set before ready, not only a caller-supplied subset or file count. If the fingerprint changes, the old job fails and is cleaned; no silent recapture or adoption.
3. Add the non-self and independent rights projections and their exact origin/schema authority. An unsupported partition must continue to fail the entire account request.
4. Connect the bounded ZIP64 producer, member completion/count/hash proof, segment manifest and final current full-graph CAS; separately prove provider late-write fencing, exact cleanup and bounded download delivery. Only then consider lifting ready publication.

First reader pgTAP should prove no-files authorized context, >100-file pagination without omissions, null-source failure, same-account wrong-subject/foreign-file refusal, wrong export/attempt/receipt, expired/stopped attempt, session change/logout/regrant refusal, current-purpose expiry/revocation for both backends, prepared database-call refusal, after-read drift and no mutation/nonces/lease changes. Later full membership tests need >1000 metadata/message rows, absent/extra/duplicate members, scope redaction and final set equality. Authored SQL tests are not execution evidence.

## Exact source locators

- supabase/migrations/20260923123240_export_archive_persistence.sql:130 authority; 225 current receipt; 344 worker protocol.
- supabase/migrations/20260909001117_own_prepared_original_retirement.sql:332 latest own source; 437 retained-original authorization.
- supabase/migrations/20260908233445_own_prepared_export_content.sql:91 latest content reader; 103 filtered list; 140 prepared-only reports/PRS grant gate.
- src/lib/exports/own-subject-content.ts:59 adapter; 84 buffered file list; 124 prepared records; 139 reports; 177 original Blob path.
- src/lib/genome/prepared-source/export-source.ts: existing complete prepared-record stream.
- src/lib/uploads/prepared-original-download.ts: finite per-range authorization and complete original hash.
- src/lib/export/subject-record.ts:59 requester-scoped history reads; supabase/config.toml:18 max_rows=1000.
- supabase/migrations/20260922230433_own_copilot_prepared_sources.sql:90 chat protocol; list/history bounded views.
- src/app/api/export/route.ts:352 buildChats; 415 existing content assembly; 690 legacy/current reports; 801 synchronous finalization.
- supabase/migrations/20260831221908_legal_artifacts_and_consents.sql:19 signatures; 48 subject consents; 83 attestations.
- supabase/migrations/20260831224033_legal_audit_chain.sql:8 encrypted links; 40 ledger; no requester resolver in later code.
- supabase/migrations/20260913070000_adult_subject_rights_activation.sql:94 pending invitation activation.
- docs/route-register.json:5176 layout; 5240 account contract; 5292 subject; 5319 Future Person; 5352 independent target; 5725 single audit store; 8515 worker checkpoints.
- docs/inherit-v2-brief.md:2649 G5.6 and 2651 segmented large-export/action-form clarification.
