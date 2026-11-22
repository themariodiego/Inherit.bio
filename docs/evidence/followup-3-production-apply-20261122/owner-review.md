# Kit 4 (release 4): what needs the owner's review

Kit: `docs/evidence/followup-3-production-apply-20261122/`, built and rehearsed locally
on 22 November 2026 (isolated stack `relk4`, never the shared stack; nothing hosted
contacted). None of the items below is an owner decision yet; each is an engineering
choice of the session that built the kit, or an open point it found.

## 1. The batch cut (engineering choice)

Four batches: #1-#2, #3-#7, #8, #9-#21. No migration breaks release 3's
production-reachable code (`compat-analysis.md`), so, as in releases 1 and 2, the cut
follows the locks each batch holds to commit and the dependencies between files. The rule
chosen: **each batch holds a strong lock on at most one table the production app writes
on a live path** (`genome_storage_objects`, `mail_outbox`, `account_operation_nonces`,
`subjects`, in that order), and **the transfer switch (#13) commits in the same batch as
every migration that makes its approved notice true** (#17 for e-signature records, #19
and #20 for reviewed-document records) and the rest of D-166 (#21). A finer cut (for
example #10's SHARE ROW EXCLUSIVE on `subjects` alone, as PR 324 put its ACCESS EXCLUSIVE
on `subjects` alone) is possible; it would leave a state between batches where the
acceptance clocks (#9) exist without the readers that ask them (#12, #15, #18). The owner
may prefer another cut; any change means re-measuring and re-rehearsing (the expected
summaries are per batch).

## 2. The pre-checks are stricter than some guards (engineering choice)

`production-readonly-prechecks.sql` checks all 87 pre-existing function bodies the 21
files pin **with the ACL the mirror holds**, also where a file's own guard compares the
md5 only (for example #12's and #15's values lists, #13's three doors). The batch's own
fingerprint check compares every ACL anyway, so a production ACL that differs would stop
the release at the dry run in any case; the pre-check only says which one, earlier.

## 2b. The pre-checks were revised once after the rehearsal (engineering choice)

The first run of the missing-release negative showed `production-readonly-prechecks.sql`
failing outright on a state without release 3 (`relation
"private.session_csrf_token_uses" does not exist`). That is a stop, but not a report. Five
values that read an object releases 1-3 create now read it only when it exists (through
`query_to_xml`, NULL otherwise, which no stop rule accepts), and the callers check uses
`to_regprocedure`. On the pre-state the revised file gives exactly the rehearsed file's
JSON; the tamper and missing-release negatives were run again with it. No batch file
changed. A state missing release 1 or 2 would still make the query fail on a missing
column (for example `subjects.ownership_transferred_at`); that is still a stop, and the
release cannot start there anyway (the ledger check).

## 3. Release 1-3 bodies are pinned without a production read-back (open point)

Of the 87 pinned pre-existing bodies, 56 are production's own (2026-10-22 read-back); 26
are written by release 1, 2 by release 2 and 3 by release 3, none of which has run. The
notes for `20261119150000` and `20261119160000` say those pins "must be compared with
release 1's read-back before this release's kit is built" (D-136: a comment-stripped
body is reviewed, not loosened). The kit had to be built before that read-back exists. It
assumes what the earlier kits rehearsed: the Management API transport stores bodies as
sent, comments included, so the mirror (built through the three earlier kits) holds
exactly what production will. The pre-checks compare every one of them at the release's
step 4; if production differs, the release stops there with nothing written, and the
remedy (a D-136-style review of the pin) is the owner's call. None of the 87 is among the
8 bodies production already holds comment-stripped.

## 4. Which commit merges after release 3 (open point, as in release 3's kit)

Release 3's kit pins tree `be49d283` and refuses any head without it. The branch head this
kit was built on (`fe8c69d1`) carries release 4's 21 files (tree `d43b12a8`), so it cannot
be the merge after release 3. The last commit on the branch carrying `be49d283` is
`6252566a` (the first is `a2a4d8e9`). The order this kit assumes: release 3, merge a
`be49d283` commit (for example `6252566a`), deploy, then release 4, then merge a commit
carrying `d43b12a8`. The alternatives release 3's README lists for releases 2 and 3
apply here too (merge once after releases 3 and 4 back to back, which needs release 3's
step 7 and this kit's step 0 restated).

## 5. The deploy order differs from the order some notes call "expected" (for review)

The kit applies all 21 migrations before the merge that deploys their code (as every
earlier kit did). The notes of `20261119134500` (D-139) call "code deployed, migration not
yet applied" the expected window, and those of `20261122120000` assume the hand-over code
of `20261122100000` is deployed before the switch opens. With this kit's order, between
batch 4 and the merge the switch is open while release 3's code runs: its
`api.subject-transfer` would transfer, and its mail worker does not know the five new
notice kinds. Every such path needs a confirmed Path B record, which exists only under the
test jurisdiction, so nothing is reachable in production. Both windows are analysed in
`compat-analysis.md`; the owner may still want the merge to follow batch 4 promptly.

## 6. The release notes have three editorial defects (recorded, not fixed)

The task allowed the notes to be changed only to point at the kit, so these are recorded
for whoever edits them next (`rehearsal/scripts/notes.py` repairs the first for the
rehearsal only):

- The pre-check SQL block of `20261119150000` has no closing fence: it stops after
  `context_live_self_upload_consents,` (line 227) and the next section's heading follows,
  so the `20261119120000` section and its own SQL block render inside a code block.
- Two paragraphs inside the `20261119120000` section (lines 265 and 277) describe
  `20261119150000`'s pre-check and md5s, and that section has two "Locks and duration"
  headings.
- The first section still says release 4 "holds two migrations" and gives a ledger of
  285/286 rows; the release holds 21 and ends at 305 rows, max `20261122200000`. The
  closing section appended to the notes says so.

Every one of the 21 pre-check SELECTs (the first one repaired as above) was run on the
mirror at the state its section was written for, and every `must_be_*` column held.

## 7. The release checklist is stale for release 4 (draft, not applied)

`docs/release-checklist.md` item 4 still says one migration with no kit. Proposed text:

> 4. **Release 4: 21 migrations, kit built and rehearsed locally, not run**:
>    `20261119110000_dropped_bucket_literals_and_guard` to
>    `20261122200000_reviewed_document_person_appeal`. Kit:
>    `docs/evidence/followup-3-production-apply-20261122/`, four batches (#1-#2, #3-#7,
>    #8, #9-#21) that end at 305 rows, rehearsed against release 3's post-state with
>    production's drift, which it reproduces byte for byte. Every migration applied there
>    in order, every batch read back EQUAL, and the negative cases refused with nothing
>    written. The kit pins the migrations tree `d43b12a8` (`fe8c69d1`); the head that
>    merges after it must carry it, and the head that merges after release 3 must still
>    carry `be49d283` (the last such commit on the branch is `6252566a`). It runs only
>    after releases 1-3 are applied, merged and deployed with release 3's fingerprint
>    unchanged. No batch breaks release 3's deployed code; the merge follows batch 4.
