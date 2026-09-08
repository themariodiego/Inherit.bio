# Canonical own Copilot integration

The five existing tools now use a current self-subject Copilot purpose and the
exact provider-recipient configuration, in addition to store authority or the
separately selected completed report purpose. They never generate on read.

`own_copilot_chat_v1` is a service-only dispatcher. `prepare` creates a closed
source snapshot; `begin` consumes the signed RSC nonce; bounded `calls`,
`reports` and `prs` reads re-resolve that snapshot. `history` reads only server
pairs. `commit` compares the live snapshot and last turn ordinal and writes the
validated user/assistant pair atomically. First requests contain only
`contextToken,message`; later requests contain only `chatId,message`. No client
scope or history is accepted. Successful JSON and history preserve captured
citations. Invalid targets/tokens are opaque404; runtime authority/source
failure is closed403. Intent refusals keep the existing zero-write refusal
transport; output replacements are validated JSON pairs.

The provider's pinned connection factory calls the data/permission check after
DNS and immediately before connecting, as well as checking the named recipient.
The route also checks before each tool, after every page, before commit and
before response serialization. Provider output remains buffered behind the
existing output guard. No key means no invented Authorization credential.

Canonical calls require the exact source object, raw/decoded hashes, upload
revision and completed normalization manifest. Older processed files use the
existing exact-account/self/file authority with separate file hash/build
snapshots and an explicit unrecorded historical-normalization note. Any
canonical source marker or finalized lease excludes this compatibility path.
Unprovable source rows remain explicit unavailable sources. Conflicting calls
across either source class withhold the genotype. Historical reports/PRS lacking
a completed canonical purpose journal remain unavailable per source. Canonical
reports use captured `catalogSnapshot` title/evidence/citations; older journals
retain the explicit missing-reference note. PRS returns coverage only.

A canonical chat shell with no surviving messages is not a usable conversation.
List, history and existing-chat commit refuse it, including after exact retention
removes all pairs. No empty history can reset its turn ordinal or revive old
permission. New conversations still start through the independently signed nonce
and atomic first pair; unrelated history and retained chat identities survive.

A withdrawn Copilot grant freezes complete pairs and their dependent suffix in
the existing exact-grant purpose-derived disposition before queueing cleanup.
The existing executor checks frozen message, chat, turn and projection-hash
membership; later grants are not swept into the old manifest. Report-purpose
withdrawal keeps its synchronous attempt and durable fallback. Empty canonical
chat metadata is not an unsupported-output blocker; unverified legacy contexts
remain blockers. Queued Copilot-only cleanup uses the disposition's frozen
lifecycle revision for its immutable message IDs/hashes, without needing current
analysis eligibility. Report-purpose cleanup retains its existing additional
current-lifecycle check for report/PRS output dispositions.

Selected-file deletion freezes dependent message IDs in the existing retryable
Storage-ACK record. Finish removes those pairs after Storage acknowledgement
and before source deletion. Separate chats with no dependency on that file and
other files survive. Historical subject-only conversations without canonical,
retrieval, grant or lifecycle dependency markers are preserved, as the existing
selected-file contract requires. Turn IDs alone do not prove file attribution:
the earlier scope migration backfilled them on historical messages. Mixed or
incomplete canonical provenance still blocks deletion; text is never used to
guess membership.

The schema additions do not upgrade old contexts or model permissions. Install
the authority migration before the chat/cleanup migration, and do not enable
new grants between those two steps. Old Settings writes remain callable but
invalidate canonical authority; users must save and explicitly authorize the
new configuration. The current public release cannot drain the new exact-grant
cleanup jobs, so a compatible worker and verified execution are prerequisites
to hosted use. An existing minute schedule does not establish the cleanup
deadline. The catalog snapshot migration must precede new report writes, with
snapshot-aware export readers deployed together. After canonical use, rollback
must retain those readers and the compatible chat/cleanup application.

Account/session
teardown cascades the private nonce hashes; nine-minute expiry is enforced on
use, with expired-row housekeeping on later redemption. This is not a claim
that every broader retention scheduler or whole-plan Copilot scope is complete.

Focused unit tests cover raw-call fidelity, captured references, single-use
contexts, history shape, denial around provider/tool/output boundaries and
unchanged output guards. `canonical_own_copilot_chat.sql` is a synthetic,
rollback-only fixture using actual signed consent, Settings, report-purpose and
normalization operations. It targets only its exact cleanup jobs, never a global
worker sweep. This lane does not run hosted calls, models, builds or browser
suites; the integrated local receipts and remaining browser work are recorded
in `docs/local-upload-browser-verification.md`.
