# Complete account archive member frame

This TEST-LOCAL prerequisite pins the metadata and legacy genetic content of an
actual consumed account export request. It keeps the original current actor,
session, whole owned graph, source and active writing-attempt guards. It does
not complete the archive assembler, non-self/cohort/joint readers, asynchronous
POST/status flow or delivery. Public binding and READY remain closed.

Migration `20261001021000` adds an internal `genome_files` content revision.
Actual INSERT, UPDATE, DELETE and privileged TRUNCATE statements on
`user_variants` and `report_observed_calls` advance each affected old/new file
once, in stable file row-lock order. No plaintext call hashing or complete call
scan occurs during the authority check. An empty statement advances nothing.
The initial value and every later increment are trigger-owned; API roles cannot
forge, rewind or choose the revision or bypass it with TRUNCATE. Counter
overflow and lock contention refuse the mutation. The revision stays internal
and uses the file's existing retention and cascade disposal; no store is added.

The complete current frame supplements the original owned capture with the
actual requester profile, selected subject demographics, requester-signed
subject purpose grants and selected file revisions. Existing unsupported graph
refusals remain. Ordinary metadata was already part of the original ordinary
authority; this also pins it for the combined ordinary/bound account capture
and pins same-cardinality legacy source changes. Existing jobs are never
silently recaptured under a new frame.

The service-only `export_archive_account_metadata_v1` resolves the requester,
selection and active attempt from the stored consumed request. Its closed
operations return the approved profile fields, all requester-signed selected
subject grants in 500-row UUID pages and all selected ordinary file counts in
100-row pages. Actual source row counts are read only during preparation. Every
call rechecks the whole current frame before and after its read. Bound canonical
records keep their distinct source reader; this door cannot borrow original
parent source descriptors or create an analytical grant.

`prepareAccountArchiveMetadata` independently requires the complete server
selection, exact page counts, strict increasing IDs, exact current requester
and subject IDs, bounded closed DTOs and current durable authority before and
after every call. It rejects missing, duplicated, foreign or changed pages,
credential/provider fields, unsafe counters and unexplained source counts. A
normalized legacy file's actual variant count must match its captured source;
an unnormalized or prepared file cannot silently contain unmatched legacy
rows. The returned clocks stay internal to archive preparation. Calls observe
the actual deadline and cancellation and remain bounded to 30 seconds.

The SQL fixture reuses the original actual Auth, signing, normalization and
saved report/PRS producers, then creates and consumes the genuine request and
writing attempt. It checks actual multi-row and same-count source mutations,
old/new retargets, deletions, empty statements, profile/session revocation and
the unchanged durable job. The file-purge probe uses the existing prepare and
finish protocol with its unchanged storage-absence refusal, cascade and final
deferred-constraint check. Its Storage metadata ACK seam is SQL-only, as in the
original deletion fixture; it is not actual provider evidence. Original
scientific assertions and all authority/refusal guards remain.

The new SQL remains authored until independently executed. Unit RPC seams
prove consumer validation only. Complete whole-account member generation,
every registered non-self/cohort/joint class, real POST/status worker wiring,
actual provider delivery and uncertain-write cleanup remain required. G5.4 and
G5.6 remain NO; no hosted browser, provider or acceptance credit is claimed.
