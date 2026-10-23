#!/usr/bin/env bash
# LOCAL ONLY negative checks on the relfu mirror (127.0.0.1:56322). Each runs in one
# transaction that is rolled back, and the fingerprint and ledger must be unchanged
# afterwards. The caller exports PGPASSWORD for the local stack.
#   negatives.sh tamper   on PR 324's post-state: a guarded predecessor body that differs
#                         (comments stripped, as a comment-dropping transport would leave it;
#                         or one extra grant) must show in the pre-checks and make the
#                         whole-release dry run refuse with that guard's message; a check
#                         value the $widen$ parse cannot read must show in the pre-checks.
#   negatives.sh before-pr324   on the production mirror before PR 324's release: the
#                         pre-checks, and the whole-release dry run and batch-1 apply, which
#                         must refuse on the ledger.
set -uo pipefail
W=${RELFU_SCRATCH:?scratch directory of the relfu project}
G=${G:-/home/user/wt-release3/docs/evidence/followup-production-apply-20261023/guarded}
DB=${RELFU_DB:-postgresql://postgres@127.0.0.1:56322/postgres}
case "$DB" in *:54322/*) echo "refusing the shared stack"; exit 1;; esac
L=${NEG_LOG:-$W/logs/negatives}; mkdir -p "$L"
OUT=$L/results.tsv
M=$W/src/fu/supabase/migrations
export PGCLIENTENCODING=UTF8
fp() { psql "$DB" -X -q -At -v ON_ERROR_STOP=1 -f "$G/fingerprint.sql" | sha256sum | cut -c1-16;
       psql "$DB" -X -At -c "select count(*)||' '||max(version) from supabase_migrations.schema_migrations"; }
summ() {  # summ <prechecks json> -> nonzero keys and failed guards
  python3 -I -c "import json,sys
t=open(sys.argv[1]).read().strip()
if not t.startswith('{'): print('no result (the pre-checks query failed; see the log)'); sys.exit()
p=json.loads(t.split('\n')[0])
nz={k:v for k,v in {**p['must_be_zero'], **p['compat_must_be_zero']}.items() if v}
bad=[(k.split(' ')[0]+' '+v['function'].split('(')[0], v['have_md5']) for k,v in p['guards'].items() if not v['ok']]
print('ledger', p['ledger']['count'], p['ledger']['max'], '| nonzero', nz, '| guards not ok', len(bad), bad[:3])" "$1"
}
tx() {  # tx <name> <setup sql> [file ...]: one rolled-back transaction; each file in its own savepoint
  local name=$1 setup=$2 before after f; shift 2
  before=$(fp)
  { echo '\set ON_ERROR_STOP 0'; echo 'begin;'; echo "set statement_timeout = '180s';"; echo "$setup"
    echo 'savepoint pre;'; echo "\\o $L/$name-prechecks.json"; echo "\\i $G/production-readonly-prechecks.sql"; echo '\o'
    echo 'rollback to savepoint pre;'
    for f in "$@"; do echo 'savepoint f;'; echo "\\i $f"; echo 'rollback to savepoint f;'; done
    echo 'rollback;'; } > "$L/$name.sql"
  psql "$DB" -X -q -At -f "$L/$name.sql" > "$L/$name.log" 2>&1
  after=$(fp)
  echo -e "$name\tprechecks: $(summ "$L/$name-prechecks.json")\truns: $(grep -o 'ERROR:.*' "$L/$name.log" | grep -v 'permission_documents" does not exist' | cut -c1-160 | tr '\n' '|')\tstate $([ "$before" = "$after" ] && echo unchanged || echo CHANGED)" | tee -a "$OUT"
}
case "${1:-}" in
tamper)
  : > "$OUT"
  cat "$M/20261023100000_subject_export_joint_results.sql" "$M/20261023110000_export_completeness.sql" > "$L/m03-then-m04.sql"
  [ "$(psql "$DB" -X -At -c "select count(*)||' '||max(version) from supabase_migrations.schema_migrations")" = "273 20261016221000" ]
  tx strip-comments "do \$neg\$ declare d text; begin
  select pg_catalog.pg_get_functiondef('private.export_subject_graph_capture_v1(uuid,jsonb)'::regprocedure) into d;
  execute pg_catalog.regexp_replace(d, E'\\n[ \\t]*--[^\\n]*', '', 'g'); end \$neg\$;" "$G/all-batches-dry-run.sql" "$L/m03-then-m04.sql"
  tx extra-grant "grant execute on function private.export_subject_joint_results_v1(uuid) to service_role;" "$G/all-batches-dry-run.sql" "$M/20261023100000_subject_export_joint_results.sql"
  tx unparsed-check-value "alter table public.account_operation_nonces drop constraint account_operation_nonces_operation_check;
alter table public.account_operation_nonces add constraint account_operation_nonces_operation_check check (operation in
 ('account_delete','account_delete_cancel','consents_revoke_all','other_adult_upload_artifact_sign','own_account_completion',
  'own_upload_artifact_sign','subject_delete','subject_sharing_stop','subject_transfer','x2'));"
  ;;
before-pr324)
  [ "$(psql "$DB" -X -At -c "select count(*)||' '||max(version) from supabase_migrations.schema_migrations")" = "248 20261011010251" ]
  tx before-pr324 "" "$G/all-batches-dry-run.sql" "$G/batch-1-apply.sql"
  ;;
*) echo "usage: negatives.sh tamper | before-pr324"; exit 2;;
esac
