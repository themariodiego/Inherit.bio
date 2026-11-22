#!/usr/bin/env bash
# LOCAL ONLY. Build release 4's pre-state on the isolated stack relk4 (127.0.0.1:58322):
# production as release 3's kit expects to leave it. The steps are release 3's
# (../../../followup-2-production-apply-20261119/rehearsal/scripts/build-mirror.sh), on an
# isolated stack as the follow-up kit's were, plus release 3's own kit:
#   0. supabase db reset of the scratch project relk4 (setup-stack.sh), whose
#      supabase/migrations holds main 12f24475's 245 files, asserted file for file;
#   1. the fresh-main fingerprint must be byte-identical to the reference fresh build
#      (SHA-256 8860eee4..., PR 324 kit, rehearsal/data/equivalence.txt);
#   2. 3 ledger stand-ins for production's 3 rows without a repository file;
#   3. the 8 comment-stripped bodies production has (PR 324 kit's strip_comments.py),
#      whose per-line hashes must equal production's (PR 324 kit, prod-linehash.txt);
#   4. pg_cron, as production has it;
#   5. the full fingerprint must equal production's 2026-10-22 read-back
#      (PR 323 kit, results/run-2026-10-22/fp-after-merge.json) object for object;
#   6. release 1, PR 324's four guarded batches from its kit (--head cf79b1b6): the final
#      fingerprint must be byte-identical to PR 324's rehearsed final mirror (4d2a2747...);
#   7. release 2, the follow-up's two guarded batches from its kit (--head 77d04563): the
#      final fingerprint must be byte-identical to its rehearsed final mirror (3a0f4d68...);
#   8. release 3, follow-up 2's two guarded batches from its kit (--head a2a4d8e9, the
#      first commit carrying its tree be49d283): the final fingerprint must be
#      byte-identical to release 3's rehearsed final mirror (7bef9657..., its
#      rehearsal/data/equivalence.txt and final-pass.txt), its summary EQUAL to release 3's
#      batch-2 post-state, and the ledger 284 / 20261025400000.
# STOP_AFTER=pr324 or STOP_AFTER=followup stops after step 6 or 7 (a state before an
# earlier release, for negatives.sh missing-release).
# The caller exports PGPASSWORD for the local stack.
set -eu
. "$(dirname "$0")/env.sh"
L=$W/logs/mirror; mkdir -p "$L"
[ "$(ls "$W/proj/supabase/migrations" | wc -l)" = 245 ]
main=$(git -C "$REPO" ls-tree -r 12f24475094653afe8f9935b75f352d76012b1b4 supabase/migrations/ | awk '{print $3}')
proj=$(cd "$W/proj" && for f in supabase/migrations/*.sql; do git hash-object "$f"; done)
[ "$main" = "$proj" ]
echo "the relk4 project's 245 migration files are main 12f24475's, blob for blob"
( time "$CLI" db reset --local --workdir "$W/proj" ) > "$L/reset-main.log" 2>&1
echo "reset: $(grep -c 'Applying migration' "$L/reset-main.log") migrations applied"
fpto "$L/fp-fresh-main.json"
[ "$(sha "$L/fp-fresh-main.json")" = 8860eee482938e4792009efe5c20c6a6cc1e2b8937a2379659d7b30e9b5d35da ]
echo "1. fresh main fingerprint == reference fresh build (8860eee4...)"
[ "$(ledger)" = "245 20261011010251" ]
psql "$DB" -X -q -v ON_ERROR_STOP=1 -c "insert into supabase_migrations.schema_migrations(version,name,statements) values
 ('00000000000001','mirror_stand_in_production_row_1',null),
 ('00000000000002','mirror_stand_in_production_row_2',null),
 ('00000000000003','mirror_stand_in_production_row_3',null)"
echo "2. ledger stand-ins: $(ledger)"
SEL="(n.nspname,p.proname) in (('private','claim_next_own_preparation_v1'),('private','current_adult_subject_invitation_v1'),('private','own_report_generation_v1'),('private','own_subject_purpose_grant_v1'),('private','read_own_upload_finalization_checkpoint_v1'),('private','write_own_upload_finalization_checkpoint_v1'),('public','claim_due_research_publication_v1'),('public','record_blocked_embryo_response_v1'))"
ACLQ="select n.nspname||'.'||p.proname||' '||coalesce(p.proacl::text,'')||' '||coalesce(p.proconfig::text,'')||' '||p.prosecdef||' '||pg_get_userbyid(p.proowner) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where $SEL order by 1"
psql "$DB" -X -q -At -v ON_ERROR_STOP=1 -o "$L/drift-acl-before.txt" -c "$ACLQ"
bash "$(dirname "$0")/drift.sh" "$L/drift" > /dev/null
psql "$DB" -X -q -At -v ON_ERROR_STOP=1 -o "$L/drift-acl-after.txt" -c "$ACLQ"
cmp "$L/drift-acl-before.txt" "$L/drift-acl-after.txt"
echo "3. 8 drifted bodies: owner/ACL/proconfig/secdef unchanged; line hashes == production's ($(grep -c 'removed' "$L/drift/drift-strip.sql") stripped)"
psql "$DB" -X -At -v ON_ERROR_STOP=1 -c "select string_agg(x.extname||'@'||n.nspname||'@'||x.extversion, ',' order by x.extname) from pg_extension x join pg_namespace n on n.oid=x.extnamespace" > "$L/mirror-extensions.txt"
[ "$(cat "$L/mirror-extensions.txt")" = "$(cat "$K324/rehearsal/data/prod-extensions.txt")" ]
echo "4. extensions == production's: $(cat "$L/mirror-extensions.txt")"
fpto "$L/fp-mirror-pr323.json"
python3 -I "$K324/rehearsal/scripts/fpcompare.py" "$L/fp-mirror-pr323.json" "$K323/results/run-2026-10-22/fp-after-merge.json" > "$L/mirror-vs-production.txt"
[ "$(tail -1 "$L/mirror-vs-production.txt")" = "RESULT EQUAL" ]
echo "5. mirror vs production's 2026-10-22 read-back: $(tail -1 "$L/mirror-vs-production.txt")"
[ "$(ledger)" = "248 20261011010251" ]
bash "$(dirname "$0")/apply-kit.sh" "$K324" cf79b1b66e5391019ca47365971a9d8e44391ef1 pr324
[ "$(ledger)" = "273 20261016221000" ]
[ "$(sha "$L/fp-pr324-final.json")" = 4d2a2747b665310617b958dce91438c8adb2d1de6262af3db58fbf307d264fa8 ]
echo "6. release 1 (PR 324's kit): fingerprint byte-identical to its rehearsed final mirror (4d2a2747...); ledger $(ledger)"
if [ "${STOP_AFTER:-}" = pr324 ]; then echo "stopped after release 1 (STOP_AFTER=pr324)"; exit 0; fi
bash "$(dirname "$0")/apply-kit.sh" "$KFU" 77d04563e3d568571215284afb8a3aae47b02d56 followup
[ "$(ledger)" = "280 20261023140000" ]
[ "$(sha "$L/fp-followup-final.json")" = 3a0f4d6860a49143b0f939a4185fbae3e1f7a89cb9d114c7c8e3975aab6ba4b4 ]
echo "7. release 2 (the follow-up's kit): fingerprint byte-identical to its rehearsed final mirror (3a0f4d68...); ledger $(ledger)"
if [ "${STOP_AFTER:-}" = followup ]; then echo "stopped after release 2 (STOP_AFTER=followup)"; exit 0; fi
bash "$(dirname "$0")/apply-kit.sh" "$KFU2" a2a4d8e9263cc6580bf46fda360a4187a78b0817 followup2
[ "$(ledger)" = "284 20261025400000" ]
[ "$(sha "$L/fp-followup2-final.json")" = 7bef9657d2f2c19e9784d07b8eb22a58ef829b77341b2ceb9471fe8150f6a868 ]
python3 -I "$KFU2/guarded/check-readback.py" "$L/fp-followup2-final.json" 2 post
echo "8. release 3 (follow-up 2's kit): fingerprint byte-identical to its rehearsed final mirror (7bef9657...); ledger $(ledger)"
cp "$L/fp-followup2-final.json" "$L/fp-pre-state.json"
echo built
