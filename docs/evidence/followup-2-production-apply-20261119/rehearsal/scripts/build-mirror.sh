#!/usr/bin/env bash
# LOCAL ONLY. Build this release's pre-state on the local stack: production as the
# follow-up kit expects to leave it. The steps are the follow-up kit's
# (../../../followup-production-apply-20261023/rehearsal/scripts/build-mirror.sh and
# apply-pr324-kit.sh), on the local stack instead of an isolated one:
#   0. supabase db reset --local --version 20261011010251 from the repository root.
#      The 245 working-tree files up to that version are asserted blob-identical to
#      main 12f24475's 245 (git hash-object of each file).
#   1. the fresh-main fingerprint must be byte-identical to the reference fresh build
#      (SHA-256 8860eee4..., PR 324 kit, rehearsal/data/equivalence.txt);
#   2. 3 ledger stand-ins for production's 3 rows without a repository file;
#   3. the 8 comment-stripped bodies production has (PR 324 kit's strip_comments.py),
#      whose per-line hashes must equal production's (PR 324 kit, prod-linehash.txt);
#   4. pg_cron, as production has it;
#   5. the full fingerprint must equal production's 2026-10-22 read-back
#      (PR 323 kit, results/run-2026-10-22/fp-after-merge.json) object for object;
#   6. PR 324's four guarded batches from its kit (--head cf79b1b6): the final
#      fingerprint must be byte-identical to PR 324's rehearsed final mirror (4d2a2747...);
#   7. the follow-up's two guarded batches from its kit (--head 77d04563): the final
#      fingerprint must be byte-identical to the follow-up's rehearsed final mirror
#      (3a0f4d68..., its rehearsal/data/equivalence.txt), and the ledger 280 / 20261023140000.
# With STOP_AFTER_PR324=1 it stops after step 6 (the state before the follow-up's release,
# for negatives.sh before-followup).
# The caller exports PGPASSWORD for the local stack.
set -eu
. "$(dirname "$0")/env.sh"
L=$W/logs/mirror; mkdir -p "$L"
main=$(git -C "$REPO" ls-tree -r 12f24475094653afe8f9935b75f352d76012b1b4 supabase/migrations/ | awk '{print $3, $4}')
work=$(cd "$REPO" && for f in supabase/migrations/*.sql; do v=$(basename "$f"); [[ "${v:0:14}" > 20261011010251 ]] || echo "$(git hash-object "$f") $f"; done)
[ "$main" = "$work" ] && [ "$(wc -l <<<"$main")" = 245 ]
echo "the 245 working-tree files up to 20261011010251 are main 12f24475's, blob for blob"
( cd "$REPO" && time "$CLI" db reset --local --version 20261011010251 ) > "$L/reset-main.log" 2>&1
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
psql "$DB" -X -q -At -v ON_ERROR_STOP=1 -o "$L/drift-localdefs.tsv" -c "
with f as (
 select n.nspname||'.'||p.proname as fn, pg_catalog.pg_get_functiondef(p.oid) as def
 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
 where $SEL
   and (select pg_catalog.set_config('search_path','pg_catalog',true)||pg_catalog.set_config('TimeZone','UTC',true)||pg_catalog.set_config('DateStyle','ISO, MDY',true)||pg_catalog.set_config('IntervalStyle','postgres',true)||pg_catalog.set_config('extra_float_digits','1',true)) is not null
) select fn||chr(31)||def||chr(30) from f order by fn"
ACLQ="select n.nspname||'.'||p.proname||' '||coalesce(p.proacl::text,'')||' '||coalesce(p.proconfig::text,'')||' '||p.prosecdef||' '||pg_get_userbyid(p.proowner) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where $SEL order by 1"
psql "$DB" -X -q -At -v ON_ERROR_STOP=1 -o "$L/drift-acl-before.txt" -c "$ACLQ"
python3 -I "$K324/rehearsal/scripts/strip_comments.py" "$L/drift-localdefs.tsv" "$L/drift-strip.sql" > "$L/drift-strip.log"
psql "$DB" -X -q -v ON_ERROR_STOP=1 -1 -f "$L/drift-strip.sql" >> "$L/drift-strip.log" 2>&1
psql "$DB" -X -q -At -v ON_ERROR_STOP=1 -o "$L/drift-acl-after.txt" -c "$ACLQ"
cmp "$L/drift-acl-before.txt" "$L/drift-acl-after.txt"
psql "$DB" -X -At -v ON_ERROR_STOP=1 -f "$K324/rehearsal/scripts/linehash.sql" > "$L/mirror-linehash.txt"
diff "$L/mirror-linehash.txt" "$K324/rehearsal/data/prod-linehash.txt"
echo "3. 8 drifted bodies: owner/ACL/proconfig/secdef unchanged; line hashes == production's ($(grep -c 'removed' "$L/drift-strip.sql") stripped)"
psql "$DB" -X -q -v ON_ERROR_STOP=1 -c "create extension if not exists pg_cron" > "$L/pg_cron.log" 2>&1
psql "$DB" -X -At -v ON_ERROR_STOP=1 -c "select string_agg(x.extname||'@'||n.nspname||'@'||x.extversion, ',' order by x.extname) from pg_extension x join pg_namespace n on n.oid=x.extnamespace" > "$L/mirror-extensions.txt"
[ "$(cat "$L/mirror-extensions.txt")" = "$(cat "$K324/rehearsal/data/prod-extensions.txt")" ]
echo "4. extensions == production's: $(cat "$L/mirror-extensions.txt")"
fpto "$L/fp-mirror-pr323.json"
python3 -I "$K324/rehearsal/scripts/fpcompare.py" "$L/fp-mirror-pr323.json" "$K323/results/run-2026-10-22/fp-after-merge.json" > "$L/mirror-vs-production.txt"
echo "5. mirror vs production's 2026-10-22 read-back: $(tail -1 "$L/mirror-vs-production.txt")"
[ "$(ledger)" = "248 20261011010251" ]
bash "$(dirname "$0")/apply-kit.sh" "$K324" cf79b1b66e5391019ca47365971a9d8e44391ef1 pr324
[ "$(ledger)" = "273 20261016221000" ]
[ "$(sha "$L/fp-pr324-final.json")" = 4d2a2747b665310617b958dce91438c8adb2d1de6262af3db58fbf307d264fa8 ]
echo "6. after PR 324's kit: fingerprint byte-identical to PR 324's rehearsed final mirror (4d2a2747...); ledger $(ledger)"
if [ "${STOP_AFTER_PR324:-0}" = 1 ]; then echo "stopped after PR 324's kit (STOP_AFTER_PR324=1)"; exit 0; fi
bash "$(dirname "$0")/apply-kit.sh" "$KFU" 77d04563e3d568571215284afb8a3aae47b02d56 followup
[ "$(ledger)" = "280 20261023140000" ]
[ "$(sha "$L/fp-followup-final.json")" = 3a0f4d6860a49143b0f939a4185fbae3e1f7a89cb9d114c7c8e3975aab6ba4b4 ]
python3 -I "$KFU/guarded/check-readback.py" "$L/fp-followup-final.json" 2 post
echo "7. after the follow-up's kit: fingerprint byte-identical to the follow-up's rehearsed final mirror (3a0f4d68...); ledger $(ledger)"
cp "$L/fp-followup-final.json" "$L/fp-pre-state.json"
echo built
