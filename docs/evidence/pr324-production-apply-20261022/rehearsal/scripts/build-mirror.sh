#!/usr/bin/env bash
# LOCAL ONLY. Build the production mirror for the PR 324 release on the isolated
# stack "rel324" (container supabase_db_rel324, 127.0.0.1:55322; never the shared
# stack on 54322). Steps:
#   0. (optional, with --reset) supabase db reset of the rel324 project, whose
#      supabase/migrations holds main 12f24475's 245 files;
#   1. fresh-main fingerprint must equal the reference fresh build;
#   2. 3 ledger stand-ins for production's 3 rows without a repository file
#      (production: 248 rows, max 20261011010251 after PR 323);
#   3. the 8 comment-stripped function bodies production has;
#   4. pg_cron, as production has it;
#   5. the mirror's full fingerprint must equal production's read-back of
#      2026-10-22 (fp-after-merge.json) object for object, and its summary
#      must equal the PR 323 batch-4 post-state exactly.
set -euo pipefail
S=/tmp/claude-0/-home-user-Inherit-bio/6541a88f-5423-5787-89b6-a4effe2d1864/scratchpad/rel324
R=/tmp/claude-0/-home-user-Inherit-bio/6541a88f-5423-5787-89b6-a4effe2d1864/scratchpad/release
K=/home/user/wt-release2/docs/evidence/pr323-production-apply-20261016
FP=$K/fingerprint.sql
PROD=$K/results/run-2026-10-22/fp-after-merge.json
DB=postgresql://postgres:postgres@127.0.0.1:55322/postgres
L=${MIRROR_LOG:-$S/logs/mirror}; mkdir -p "$L"
export PGCLIENTENCODING=UTF8
case "$DB" in *:54322/*) echo "refusing the shared stack"; exit 1;; esac
if [ "${1:-}" = --reset ]; then
  [ "$(ls "$S/proj/supabase/migrations" | wc -l)" = 245 ]
  diff -r "$S/proj/supabase/migrations" "$S/src/main-supabase/migrations"
  ( time /home/user/Inherit.bio/node_modules/.bin/supabase db reset --local --workdir "$S/proj" ) > "$L/reset.log" 2>&1
  grep -c 'Applying migration' "$L/reset.log" > "$L/reset-count.txt"
fi
psql "$DB" -X -q -At -v ON_ERROR_STOP=1 -f "$FP" -o "$L/fp-fresh-main.json"
cmp "$L/fp-fresh-main.json" "$R/fp-B-merge.json"
echo "fresh main fingerprint == reference fresh build (fp-B-merge.json)"
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
python3 -I "$R/rehearsal/strip_comments.py" "$L/drift-localdefs.tsv" "$L/drift-strip.sql" > "$L/drift-strip.log"
psql "$DB" -X -q -v ON_ERROR_STOP=1 -1 -f "$L/drift-strip.sql" >> "$L/drift-strip.log" 2>&1
psql "$DB" -X -q -At -v ON_ERROR_STOP=1 -o "$L/drift-acl-after.txt" -c "$ACLQ"
cmp "$L/drift-acl-before.txt" "$L/drift-acl-after.txt"
psql "$DB" -X -At -v ON_ERROR_STOP=1 -f "$R/linehash.sql" > "$L/mirror-linehash.txt"
diff "$L/mirror-linehash.txt" "$R/prod-linehash.txt"
echo "8 drifted bodies: owner/ACL/proconfig/secdef unchanged; line hashes == production's"
# 4. pg_cron
psql "$DB" -X -q -v ON_ERROR_STOP=1 -c "create extension if not exists pg_cron" > "$L/pg_cron.log" 2>&1
psql "$DB" -X -At -v ON_ERROR_STOP=1 -c "select string_agg(x.extname||'@'||n.nspname||'@'||x.extversion, ',' order by x.extname) from pg_extension x join pg_namespace n on n.oid=x.extnamespace" > "$L/mirror-extensions.txt"
[ "$(cat "$L/mirror-extensions.txt")" = "$(cat "$R/prod-extensions.txt")" ] && echo "extensions == production's"
# 5. the mirror against production's own read-back
psql "$DB" -X -q -At -v ON_ERROR_STOP=1 -f "$FP" -o "$L/fp-mirror-pre.json"
psql "$DB" -X -At -v ON_ERROR_STOP=1 -c "select count(*)||' '||max(version) from supabase_migrations.schema_migrations" > "$L/mirror-ledger.txt"
python3 -I "$S/tools/fpcompare.py" "$L/fp-mirror-pre.json" "$PROD" > "$L/mirror-vs-production.txt"
cat "$L/mirror-vs-production.txt"
echo built
