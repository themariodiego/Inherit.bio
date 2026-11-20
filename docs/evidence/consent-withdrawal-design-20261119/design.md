# Withdrawing three kinds of consent: the design put to the owner

19 November 2026. The owner decided that day ("G8.5: a withdrawal is built for
three kinds of consent") that each of the three kinds in
`docs/register-contract-divergence.json#consentWithdrawalNotRegistered` gets a
way to be withdrawn "without deleting more than that consent covers", and that
the design comes back to the owner before it is built. This is that design.
Nothing here is built. The facts it rests on are in `facts.txt` beside this
file (a read of the code at `e313bfb4`, with file and line for each).

Common to all three: a signature row can never be edited
(`consent_signatures_immutable`), so a withdrawal is its own record, with a
legal audit event, and the consent row is marked revoked and kept. Every
button, confirmation, receipt and notice is new wording and is shown to the
owner before it ships. Each needs a migration and a later guarded release.

## 1. A person's consent to store their own DNA file (live today)

What exists. The consent text already says "You can withdraw this permission
and ask to delete your file." The brief (§2.7) already says what withdrawing it
means: the files and everything made from them are deleted, with a
confirmation email. The database already has that operation
(`private.empty_self_subject_v1`, registered as the self case of
`api.subject-delete`): it deletes every file on the person's own record, every
result, report and Copilot conversation made from them, ends every permission
and family link that shared them, removes the copies other people's accounts
held, marks every consent on the record withdrawn, and keeps the account. No
screen offers it, and its migration has not been released.

Proposed. Offer exactly that operation as the withdrawal, from Settings →
Consents (where the brief says every signature is listed with a control) and
from the Files page: one control, a confirmation that names what goes, then a
receipt and the confirmation email. Afterwards the upload page asks for the
consent again before any new file. Deleting a single file stays what it is
today and is not a withdrawal.

Why the whole record and not less. The consent is the permission to store and
prepare the person's files at all, so nothing made from them can stay. Keeping
the family links and sharing permissions "asleep" was considered and rejected:
they would silently apply to a file the person uploads later, which shares
new data under an old permission.

The alternative the owner could choose instead: withdrawal deletes the files
and results but leaves family links and permissions in place for a later
upload.

## 2. An uploader's consent for another adult's file (test mode only)

What exists. The other adult can already refuse one file, or delete everything
about themselves, from their emailed link; their delete also ends the
uploader's consent. The uploader has no control at all. The database has a
whole-record delete for the uploader (`delete_path_b_subject_for_route_v1`,
the adult case of `api.subject-delete`): it ends every file the uploader
added, deletes the other adult's record and contact, and so also ends that
adult's own confirmation. No screen offers it.

Proposed. A "withdraw my permission" control on the uploader's card for that
person, with two outcomes:

- The other adult has not taken the record over with their own account (the
  usual case): everything the uploader added for them is deleted, confirmed or
  not, the request ends, and the other adult is sent a short notice that it
  was withdrawn and deleted. This is the existing whole-record delete plus the
  notice.
- The other adult has their own account on the record: the record and the
  files they confirmed stay theirs. The uploader's consent ends, files not yet
  confirmed are deleted, the uploader can add nothing more and keeps no access.
  The other adult is told. This branch is new database work.

Why. The uploader's consent covers what the uploader added. Where the other
adult has no account, the uploader's account is the only custodian, so ending
it by deletion is the private outcome. Where they have an account, their own
signature is an independent basis and the uploader's withdrawal must not
delete their record.

The alternative: always delete the whole record, whoever holds it (simpler,
nothing new in the database, but it deletes a record its own adult has taken
over).

## 3. A non-parent uploader's consent for an embryo upload (test mode only; ingest is closed)

What exists. The statement the uploader signs says "I can withdraw at any time
without giving a reason. Inherit then stops all analysis of these embryos and
deletes what it built from the files." The register already names the
consequence (`cohort-restriction-v1`, case
`nonparent-required-uploader-basis-loss`): losing this signature restricts the
cohort. The restriction exists and is what a genetic parent's withdrawal runs:
analysis stops, results and source files are deleted, record keys and
permissions end, and the parents are notified. The uploader cannot trigger it.

Proposed. A "withdraw my upload permission" control for the uploader on the
cohort's page. Before the cohort is finalised it deletes the draft and its
files. After, it records the withdrawal and runs the existing restriction
under the register's named case, with the existing notices to the genetic
parents. It gives the uploader no parent role and no say over any other
cohort, as the register requires.

The alternative: after finalisation the uploader's withdrawal only removes the
uploader (their access and their signature) and the genetic parents keep the
cohort. That contradicts the signed statement and the register's named case,
so it is not recommended.
