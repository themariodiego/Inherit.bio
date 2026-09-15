# Family ancestry authority — D-123

Status: implementation under verification. D-123 remains open until fresh SQL and browser end-to-end evidence passes.

## Defect and scope

The shared ancestry route used the own-account result reader with a counterpart's self-subject. A valid directional Family grant cannot satisfy the viewer's own-subject grant check. The Family landing page also hid its ancestry link whenever no report layer was shared.

The new Family reader has its own authority. The own reader retains its existing candidate, source, purpose and final confirmation gates; only its pure captured-content display projection is shared. The own page preserves its initially selected row through final confirmation, so a removed newest result cannot be replaced with an older row carrying the wrong provenance.

## Consent and authority

New ancestry sharing uses the existing `consent.share-with-adult` artifact, body hash and four statement keys. No approved wording or existing signed record changes. The presentation binds the current endpoints, exact purpose and recipient to the actual signing session and single-use nonce. The grant transaction checks current endpoint revisions under locks and records private proof.

An existing grant without current endpoint proof remains historical. It never gains canonical access by backfill. Its owner can explicitly confirm ancestry sharing again; that transaction revokes/replaces the old grant. The ordinary Turn off control remains available, including when proof cannot be issued. Historical grants can expose separately checked legacy ancestry rows, with current owner-purpose and recipient authority.

Every content capture checks the recipient's actual live session, current directional ancestry grant and artifact, endpoint/binding/principal/relationship revisions and pause state. It independently checks the owner's current storage and ancestry purpose authority without requiring an owner login. Ordinary canonical results must match the current file, original object, normalization identity and completed `own-ancestry-v1` journal. Legacy results use their own source branch and remain bound to their saved fields.

The browser receives display rows and authorized input provenance, not the source hashes, object paths, journal claims or permission receipts. Captured v1, v2 and v3 payloads pass the existing closed union and retain their saved analysis versions. This change never reruns an estimator or borrows current ranges for an older capture.

The final RPC takes nonblocking locks and recomputes every expected page receipt in one transaction, including empty and terminal pages. Missing pages, changed results, source replacement, withdrawal or contested locks withhold the capture. That RPC is the final awaited operation after current viewer-session/jurisdiction checks. An ancestry-only landing link uses a separate source-free permission capture and confirmation; no DNA or source count is fetched for it.

## Operational-proof retention and rights boundary

`private.family_ancestry_grant_snapshots` is an operational child of registered `public.purpose_grants`, under `subject-bound-authority-and-lifecycle-terminalization` (`20260831224119_retention_dispositions.sql`). Its endpoint JSON proves current accounts, principals, bindings and relationship revisions for one ancestry direction. It is not an independent store of retained consent evidence: the existing signed artifact, signature and terminal grant history remain their own records.

Narrow protected triggers delete only that grant's ancestry snapshot in the same transaction when the base grant is revoked or its revision changes, or when the directional row terminalizes, changes revision or is deleted. Parent-grant deletion also removes the child through its existing cascade. No trigger updates a grant, signature, another purpose's proof or another recipient's proof. Pause and resume change the pause predicate rather than these grant fields and preserve current proof unchanged.

Time-only expiry does not execute a database row trigger. Readers already deny an expired grant immediately; its snapshot is cleaned when an explicit expired/terminal transition occurs or its parent is deleted. This slice does not add or prove an automatic expiry-terminalization scheduler, and does not claim immediate storage cleanup merely because time passed.

Raw counterpart endpoint identifiers/revisions are not added to account exports or result DTOs. This operational record is private; only checked display content and source provenance leave the reader. Existing Family graph deletion/export coverage gaps, including counterpart references and older report/Portrait/Health Picture proof stores, remain open. A cascade or these targeted trigger tests do not close the broader account-deletion/export journey.

## Explicit prepared-source limit

Family ancestry does not yet validate the complete prepared publication/membership/retirement authority. A published manifest or an active prepared job is therefore withheld before both the canonical and legacy branches; an older database normalization is never a fallback for it. The page explicitly says that ancestry from a prepared genome is unavailable in Family. Independently authorized ordinary sources can still appear. This is not a prepared-source completion claim and does not change original retention or activate a backend.

## Verification

- The integrated clean-tree implementation at `f65ff12` passed all 5,072 unit tests across 303 files, with zero skips (136.02 seconds, two workers). This includes the 120 focused own/Family reader, consent, grant-token, permission and actual ancestry-page regression checks. Subsequent lifecycle edits affect only SQL and documentation; their 84 assertions require fresh CI.
- Full TypeScript passed after generating current Next route types, with incremental checking disabled. ESLint checked all 13 changed TypeScript files without warnings. Full browser discovery found 412 tests across 68 files; no full local build or browser journey was run.
- ESLint passed with zero warnings; `git diff --check` is clean.
- Playwright discovers the new synthetic journey. It exercises invitation acceptance, actual upload/preparation/explicit ancestry choice, an explicitly historical directional grant, fresh UI confirmation, ancestry-only discovery, saved v3 disclosure, directional withdrawal/regrant and owner-purpose withdrawal with source preservation. Its mail provider is the established local capture server; it must run only in the isolated browser environment.
- New rollback-only pgTAP tests exercise service ACLs, unchanged signed statement keys, owner logout, live recipient session, historical grant replacement, legacy and v1/v2/v3 captures, exact provenance, owner/directional withdrawal, pause, stale bindings/source/result, prepared refusal and complete pagination. Historical v1/v2 payloads complete through real withdrawal/regrant/new-claim transitions inside savepoints; the completed-row immutability trigger remains active and is checked explicitly. Additional lifecycle checks preserve current proof, pause/resume, unrelated proof and signed history while proving exact revocation, revision, terminal-direction and parent-cascade cleanup. They have not run locally.
- No local database or Docker operation, dependency install, production action, email delivery or full build was used for this slice. Fresh CI must supply SQL and browser evidence before D-123 can close.
