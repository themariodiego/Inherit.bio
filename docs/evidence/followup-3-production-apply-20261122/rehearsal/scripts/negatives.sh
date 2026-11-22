#!/usr/bin/env bash
# LOCAL ONLY negative checks on the relk4 mirror (127.0.0.1:58322). Each runs in one
# transaction that is rolled back, and the fingerprint and ledger must be unchanged
# afterwards. Release 3's negatives.sh, for release 4. The caller exports PGPASSWORD.
#   negatives.sh tamper    on release 3's post-state, a predecessor body or ACL that differs
#                          from the reviewed one must show in the pre-checks, make the
#                          whole-release dry run and the batch refuse, and make the
#                          migration's own predecessor block refuse when it is run as a file:
#     wrong-body-batch1    private.create_adult_subject_invitation_core_v1 (pinned by #01)
#                          with one comment line added, as a hand-edit or a different
#                          transport would leave it;
#     wrong-body-batch4    private.path_b_subject_v1 (pinned by #19, #20, #21: the last batch)
#                          the same way; the file run is #01..#19 in order, so #19's own block
#                          is the one that refuses;
#     extra-grant          one extra grant on public.claim_due_account_deletion_v1 (pinned
#                          with its ACL by #01).
#   negatives.sh missing-release   on release 2's post-state (build-mirror.sh with
#                          STOP_AFTER=followup: release 3 not applied): the pre-checks, the
#                          whole-release dry run and batch 1's dry run and apply.
set -u
. "$(dirname "$0")/env.sh"
L=${NEG_LOG:-$W/logs/negatives}; mkdir -p "$L"
OUT=$L/results.tsv
TREE=$(sed -n "s/^REV_TREE = '\([0-9a-f]*\)'.*/\1/p" "$G/generate.py")
for f in $(git -C "$REPO" diff --name-only --no-renames --diff-filter=A be49d283ec9a435c635ca54f28986d4676886910 "$TREE"); do
  git -C "$REPO" show "$TREE:$f" > "$L/${f:0:14}.sql"
done
{ for v in $(ls "$L" | grep -E '^2026[0-9]{10}\.sql$' | sort | head -19); do echo "\\i $L/$v"; done; } > "$L/chain-01-to-19.sql"
st() { echo "$(fpto /dev/stdout | sha256sum | cut -c1-16) $(ledger)"; }
summ() {  # summ <prechecks json> -> nonzero keys and failed guards
  python3 -I -c "import json,sys
t=open(sys.argv[1]).read().strip()
if not t.startswith('{'): print('no result (the pre-checks query failed; see the log)'); sys.exit()
p=json.loads(t.split('\n')[0])
nz={k:v for k,v in p['must_be_zero'].items() if v}
bad=[(k.split('(')[0], v['have_md5'], v['proacl']) for k,v in p['guards'].items() if not v['ok']]
cbad=[k for k,v in p['constraint_guards'].items() if not v['ok']]
print('ledger', p['ledger']['count'], p['ledger']['max'], '| nonzero', nz, '| guards not ok', len(bad), bad[:4], '| constraints not ok', cbad)" "$1"
}
tx() {  # tx <name> <setup sql> [file ...]: one rolled-back transaction; each file in its own savepoint
  local name=$1 setup=$2 before after f; shift 2
  before=$(st)
  { echo '\set ON_ERROR_STOP 0'; echo 'begin;'; echo "set statement_timeout = '180s';"; echo "$setup"
    echo 'savepoint pre;'; echo "\\o $L/$name-prechecks.json"; echo "\\i $G/production-readonly-prechecks.sql"; echo '\o'
    echo 'rollback to savepoint pre;'
    for f in "$@"; do echo 'savepoint f;'; echo "\\i $f"; echo 'rollback to savepoint f;'; done
    echo 'rollback;'; } > "$L/$name.sql"
  psql "$DB" -X -q -At -f "$L/$name.sql" > "$L/$name.log" 2>&1
  after=$(st)
  echo -e "$name\tprechecks: $(summ "$L/$name-prechecks.json")\truns: $(grep -o 'ERROR:.*' "$L/$name.log" | grep -v 'current transaction is aborted' | cut -c1-170 | tr '\n' '|')\tstate $([ "$before" = "$after" ] && echo unchanged || echo CHANGED)" | tee -a "$OUT"
}
comment_line() {  # comment_line <regprocedure>: the same body with one added comment line
  echo "do \$neg\$ declare d text; begin
  select pg_catalog.pg_get_functiondef('$1'::regprocedure) into d;
  if position('AS \$function\$' in d) = 0 then raise exception 'unexpected definition'; end if;
  execute pg_catalog.regexp_replace(d, 'AS \\\$function\\\$', E'AS \$function\$\\n-- not the reviewed body'); end \$neg\$;"
}
case "${1:-}" in
tamper)
  : > "$OUT"
  [ "$(ledger)" = "284 20261025400000" ]
  tx wrong-body-batch1 "$(comment_line 'private.create_adult_subject_invitation_core_v1(uuid,bytea,text,text,boolean)')" \
    "$G/all-batches-dry-run.sql" "$G/batch-1-apply.sql" "$L/20261119110000.sql"
  tx wrong-body-batch4 "$(comment_line 'private.path_b_subject_v1(uuid,uuid)')" \
    "$G/all-batches-dry-run.sql" "$L/chain-01-to-19.sql"
  tx extra-grant "grant execute on function public.claim_due_account_deletion_v1(text,integer) to authenticated;" \
    "$G/all-batches-dry-run.sql" "$G/batch-1-apply.sql" "$L/20261119110000.sql"
  ;;
missing-release)
  [ "$(ledger)" = "280 20261023140000" ]
  tx missing-release-3 "" "$G/all-batches-dry-run.sql" "$G/batch-1-dry-run.sql" "$G/batch-1-apply.sql"
  ;;
*) echo "usage: negatives.sh tamper | missing-release"; exit 2;;
esac
