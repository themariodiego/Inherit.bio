# Copilot for an adult's own second record: built, then shelved · 19 November 2026

**Nothing in this folder is applied.** `own-adult-copilot.patch` is a saved
change, not part of the product. The migration inside it is not under
`supabase/migrations/` and no release carries it.

## Why it was built

On 19 November the owner was asked whether Copilot should work for an adult's
own record after they accept an invitation, and chose "Build it"
(`docs/protocol/decisions.md`, "G8.5: Copilot for an adult's own record is
built"). The question said such a person gets a not-found page when asking
Copilot about their own results.

## Why it is shelved

That premise was wrong, and the owner was told so the same day and chose to
shelve the work (`docs/protocol/decisions.md`, "Correction: Copilot for an
adult's own record is shelved").

- After a Path A acceptance the invited person's file is on their main (`self`)
  record. The Family graph reads the counterpart's `self` subject
  (`src/lib/family/graph.ts`), and Copilot about their own results works at
  `/copilot/me`.
- The not-found page is only for the second, empty `other_adult` record the
  invitation created. No screen links its holder to that record's Copilot
  page (`src/app/(app)/genome/[subject]/page.tsx` offers Copilot for the
  viewer's own record only).
- That record cannot get its own-file permission: no screen signs
  `consent.upload-self` for any record but the `self` record, and report
  purposes are `self`-only. So the built case cannot be reached through the
  product, and would be empty if it were.

## What the patch contains

Made against commit `02c3e360`; 20 files, 1,521 insertions and 46 deletions.

- `supabase/migrations/20261119100000_own_adult_copilot.sql`: a new owner-only
  function `private.own_copilot_context_v1`, and guarded patches to
  `private.own_copilot_configuration_v1`, `private.own_report_purge_scope_v1`
  and `private.purge_path_a_subject_v1`. Its companion pgTAP file has 168
  assertions.
- Application changes under `src/lib/copilot/`, the Copilot and Settings
  pages and the permission component, with their unit tests.
- Two browser specs gain steps that pin today's refusals.

Its builder reported, on the local stack: the companion and the whole pgTAP
suite passing from a fresh reset (240 files, 16,347 tests), the unit tests
passing in both flag states, and seven planted defects each caught. That
report is `test-notes.md`. The orchestrating session did not re-run those
results and did not review the migration line by line, because the work was
shelved before integration. Anyone who picks this up reviews it as new work.

## What would make it worth applying

A way to upload a file to, and give permissions for, an adult's second record.
That needs new screens and wording, which are the owner's to approve. Two
questions also come back with it: whether the 72-hour hold after an account is
created from an invitation covers the person's own Copilot (D-141), and what
happens to such a record when `consent.subject-adult` gets a new version.

Patch SHA-256: `a9373d964358606b4100cdaad07d522ec3551600306c287c3c0c5a0f6cbcabec`
