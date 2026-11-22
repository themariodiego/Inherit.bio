#!/usr/bin/env bash
# LOCAL ONLY: apply production's drift (the 8 comment-stripped bodies + pg_cron) to
# whatever state the relfu stack holds; steps 3-4 of build-mirror.sh. The caller exports
# PGPASSWORD for the local stack.   drift.sh <log-dir>
set -euo pipefail
K324=${K324:-/home/user/wt-release3/docs/evidence/pr324-production-apply-20261022}
DB=${RELFU_DB:-postgresql://postgres@127.0.0.1:56322/postgres}
case "$DB" in *:54322/*) echo "refusing the shared stack"; exit 1;; esac
L=$1; mkdir -p "$L"
export PGCLIENTENCODING=UTF8
SEL="(n.nspname,p.proname) in (('private','claim_next_own_preparation_v1'),('private','current_adult_subject_invitation_v1'),('private','own_report_generation_v1'),('private','own_subject_purpose_grant_v1'),('private','read_own_upload_finalization_checkpoint_v1'),('private','write_own_upload_finalization_checkpoint_v1'),('public','claim_due_research_publication_v1'),('public','record_blocked_embryo_response_v1'))"
psql "$DB" -X -q -At -v ON_ERROR_STOP=1 -o "$L/drift-localdefs.tsv" -c "
with f as (
 select n.nspname||'.'||p.proname as fn, pg_catalog.pg_get_functiondef(p.oid) as def
 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
 where $SEL
   and (select pg_catalog.set_config('search_path','pg_catalog',true)||pg_catalog.set_config('TimeZone','UTC',true)||pg_catalog.set_config('DateStyle','ISO, MDY',true)||pg_catalog.set_config('IntervalStyle','postgres',true)||pg_catalog.set_config('extra_float_digits','1',true)) is not null
) select fn||chr(31)||def||chr(30) from f order by fn"
python3 -I "$K324/rehearsal/scripts/strip_comments.py" "$L/drift-localdefs.tsv" "$L/drift-strip.sql" > "$L/drift-strip.log"
psql "$DB" -X -q -v ON_ERROR_STOP=1 -1 -f "$L/drift-strip.sql" >> "$L/drift-strip.log" 2>&1
psql "$DB" -X -At -v ON_ERROR_STOP=1 -f "$K324/rehearsal/scripts/linehash.sql" > "$L/linehash.txt"
diff "$L/linehash.txt" "$K324/rehearsal/data/prod-linehash.txt"
psql "$DB" -X -q -v ON_ERROR_STOP=1 -c "create extension if not exists pg_cron" > "$L/pg_cron.log" 2>&1
echo drifted
