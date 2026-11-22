# First rehearsal (19 November 2026): the defect it found

These are the results of the kit's first rehearsal, kept as they were recorded. It
pinned the follow-up branch head `d8dcb61a` (migrations tree `151259da`), in which
`20261025400000_path_a_account_accept_typed_name.sql` required the repository body of
`private.current_adult_subject_invitation_v1` (md5 `7fa7e1fe…`). On the mirror of the
state production will hold after the follow-up's release, that callee is production's
comment-stripped body (`78d14793…`), so #4 refused with
`55000 path a typed name prerequisite differs`. The record of the defect and its
reproduction is `../defect-20261025400000.txt`.

What ran then: the mirror built four times; the step analysis (#1-#3 applied, #4
refused); the pre-checks (10 of 11 guards ok, `guarded_bodies_not_as_rehearsed = 1`);
batch 1 only, from `local/` (`generate.py local 1`, since `final` refused): dry run,
apply, read-backs EQUAL, re-apply refused; the negative checks; the follow-up's suite
before and after batch 1; the 4 suites after batch 1 (24, 30, 34 passed;
`path_a_account_accept_typed_name` failed, its door absent); order equivalence for
batch 1. `local-expected-summaries.json` is the batch-0 and batch-1 measurement then;
the second rehearsal measured the same batch-1 post-state.

The scripts in `../../scripts/` have since been pointed at the revised tree
(`guarded/generate.py`, `REV_TREE`), so they no longer reproduce this run byte for byte;
`../defect-20261025400000.txt` gives the exact reproduction steps. The second rehearsal's
results are in `../`.
