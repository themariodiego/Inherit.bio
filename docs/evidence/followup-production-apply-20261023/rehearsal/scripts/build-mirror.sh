#!/usr/bin/env bash
# LOCAL ONLY. Build the production mirror for the follow-up release on the isolated
# stack "relfu" (container supabase_db_relfu, 127.0.0.1:56322; never the shared stack
# on 54322). The caller exports PGPASSWORD for the local stack (the Supabase CLI's
# local default). Steps, as PR 324's rehearsal/scripts/build-mirror.sh:
#   0. (with --reset) supabase db reset of the relfu project, whose supabase/migrations
#      holds main 12f24475's 245 files;
#   1. the fresh-main fingerprint must be byte-identical to the reference fresh build
#      (SHA-256 8860eee4..., PR 324's rehearsal/data/equivalence.txt);
#   2. 3 ledger stand-ins for production's 3 rows without a repository file;
#   3. the 8 comment-stripped function bodies production has (PR 323's strip_comments.py);
#   4. pg_cron, as production has it;
#   5. the mirror's full fingerprint must equal production's 2026-10-22 read-back
#      (fp-after-merge.json) object for object;
#   6. (with --pr324) PR 324's four guarded batches from its kit, each dry run (rc 3,
#      sentinel) and apply (rc 0) read back with its check-readback.py; the result must
#      equal PR 324's rehearsed batch-4 post-state, and the fingerprint must be
#      byte-identical to PR 324's rehearsed final mirror (fp-final.json, 4d2a2747...).
set -euo pipefail
W=${RELFU_SCRATCH:?scratch directory of the relfu project}
K324=${K324:-/home/user/wt-release3/docs/evidence/pr324-production-apply-20261022}
K323=${K323:-/home/user/wt-release3/docs/evidence/pr323-production-apply-20261016}
FP=$K324/fingerprint.sql
PROD=$K323/results/run-2026-10-22/fp-after-merge.json
DB=${RELFU_DB:-postgresql://postgres@127.0.0.1:56322/postgres}
L=${MIRROR_LOG:-$W/logs/mirror}; mkdir -p "$L"
export PGCLIENTENCODING=UTF8
case "$DB" in *:54322/*) echo "refusing the shared stack"; exit 1;; esac
reset=0; pr324=0
for a in "$@"; do case "$a" in --reset) reset=1;; --pr324) pr324=1;; *) echo "unknown $a"; exit 2;; esac; done
if [ $reset = 1 ]; then
  [ "$(ls "$W/proj/supabase/migrations" | wc -l)" = 245 ]
  diff -r "$W/proj/supabase/migrations" "$W/src/main/supabase/migrations"
  ( time /home/user/Inherit.bio/node_modules/.bin/supabase db reset --local --workdir "$W/proj" ) > "$L/reset.log" 2>&1
  grep -c 'Applying migration' "$L/reset.log" > "$L/reset-count.txt"
fi
psql "$DB" -X -q -At -v ON_ERROR_STOP=1 -f "$FP" -o "$L/fp-fresh-main.json"
[ "$(sha256sum < "$L/fp-fresh-main.json" | cut -d' ' -f1)" = 8860eee482938e4792009efe5c20c6a6cc1e2b8937a2379659d7b30e9b5d35da ]
echo "fresh main fingerprint == reference fresh build (8860eee4...)"
[ "$(psql "$DB" -X -At -c "select count(*)||' '||max(version) from supabase_migrations.schema_migrations")" = "245 20261011010251" ]
# 2. ledger stand-ins
psql "$DB" -X -q -v ON_ERROR_STOP=1 -c "insert into supabase_migrations.schema_migrations(version,name,statements) values
 ('00000000000001','mirror_stand_in_production_row_1',null),
 ('00000000000002','mirror_stand_in_production_row_2',null),
 ('00000000000003','mirror_stand_in_production_row_3',null)"
# 3. the 8 comment-stripped bodies
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
echo "8 drifted bodies: owner/ACL/proconfig/secdef unchanged; line hashes == production's"
# 4. pg_cron
psql "$DB" -X -q -v ON_ERROR_STOP=1 -c "create extension if not exists pg_cron" > "$L/pg_cron.log" 2>&1
psql "$DB" -X -At -v ON_ERROR_STOP=1 -c "select string_agg(x.extname||'@'||n.nspname||'@'||x.extversion, ',' order by x.extname) from pg_extension x join pg_namespace n on n.oid=x.extnamespace" > "$L/mirror-extensions.txt"
[ "$(cat "$L/mirror-extensions.txt")" = "$(cat "$K324/rehearsal/data/prod-extensions.txt")" ] && echo "extensions == production's"
# 5. the mirror against production's own read-back
psql "$DB" -X -q -At -v ON_ERROR_STOP=1 -f "$FP" -o "$L/fp-mirror-pr323.json"
python3 -I "$K324/rehearsal/scripts/fpcompare.py" "$L/fp-mirror-pr323.json" "$PROD" > "$L/mirror-vs-production.txt"
cat "$L/mirror-vs-production.txt"
[ "$(psql "$DB" -X -At -c "select count(*)||' '||max(version) from supabase_migrations.schema_migrations")" = "248 20261011010251" ]
[ $pr324 = 1 ] && bash "$(dirname "$0")/apply-pr324-kit.sh"
echo built
