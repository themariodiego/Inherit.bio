#!/usr/bin/env bash
# LOCAL ONLY. Apply PR 324's four guarded batches from its kit to the relfu mirror
# (127.0.0.1:56322), exactly as its RUNBOOK runs them with the psql transport: each
# dry run (rc 3, exactly the sentinel) read back EQUAL to its pre-state, each apply
# (rc 0) read back EQUAL to its post-state. The result must be PR 324's rehearsed
# final mirror: ledger 273 rows / max 20261016221000 and a fingerprint byte-identical
# to its fp-final.json (SHA-256 4d2a2747...). The caller exports PGPASSWORD.
set -euo pipefail
W=${RELFU_SCRATCH:?scratch directory of the relfu project}
K324=${K324:-/home/user/wt-release3/docs/evidence/pr324-production-apply-20261022}
DB=${RELFU_DB:-postgresql://postgres@127.0.0.1:56322/postgres}
L=${MIRROR_LOG:-$W/logs/mirror}; mkdir -p "$L"
export PGCLIENTENCODING=UTF8
case "$DB" in *:54322/*) echo "refusing the shared stack"; exit 1;; esac
[ "$(psql "$DB" -X -At -c "select count(*)||' '||max(version) from supabase_migrations.schema_migrations")" = "248 20261011010251" ]
# 6. PR 324's guarded batches, exactly as its RUNBOOK runs them (psql transport).
G=$K324/guarded
( cd "$G" && sha256sum -c --quiet SHA256SUMS ) > "$L/pr324-sha256sums.txt" 2>&1
: > "$L/pr324-batches.tsv"
for k in 1 2 3 4; do
  timeout 190 psql "$DB" -X -v ON_ERROR_STOP=1 -c "set statement_timeout = '180s'" -f "$G/batch-$k-dry-run.sql" > "$L/pr324-dry-$k.log" 2>&1 && rc=0 || rc=$?
  [ $rc = 3 ] && [ "$(grep -c 'ERROR:' "$L/pr324-dry-$k.log")" = 1 ] && grep -q 'ERROR:  DRY_RUN_COMPLETE_ALL_CHECKS_PASSED' "$L/pr324-dry-$k.log"
  psql "$DB" -X -q -At -v ON_ERROR_STOP=1 -f "$G/fingerprint.sql" -o "$L/fp-pr324-$k-after-dry.json"
  python3 -I "$G/check-readback.py" "$L/fp-pr324-$k-after-dry.json" $k pre
  t0=$(date +%s.%N)
  timeout 190 psql "$DB" -X -v ON_ERROR_STOP=1 -c "set statement_timeout = '180s'" -f "$G/batch-$k-apply.sql" > "$L/pr324-apply-$k.log" 2>&1
  t1=$(date +%s.%N)
  psql "$DB" -X -q -At -v ON_ERROR_STOP=1 -f "$G/fingerprint.sql" -o "$L/fp-pr324-$k-post.json"
  rb=$(python3 -I "$G/check-readback.py" "$L/fp-pr324-$k-post.json" $k post)
  led=$(psql "$DB" -X -At -c "select count(*)||' '||max(version) from supabase_migrations.schema_migrations")
  echo -e "pr324 b$k\tdry rc=$rc sentinel\tapply rc=0 $(echo "$t1-$t0" | bc)s\t$rb\tledger $led" | tee -a "$L/pr324-batches.tsv"
done
[ "$(psql "$DB" -X -At -c "select count(*)||' '||max(version) from supabase_migrations.schema_migrations")" = "273 20261016221000" ]
sha256sum "$L/fp-pr324-4-post.json" | tee "$L/fp-pr324-4-post.sha256"
[ "$(sha256sum < "$L/fp-pr324-4-post.json" | cut -d' ' -f1)" = 4d2a2747b665310617b958dce91438c8adb2d1de6262af3db58fbf307d264fa8 ]
echo "PR 324 post-state: fingerprint byte-identical to PR 324's rehearsed final mirror (4d2a2747...)"
