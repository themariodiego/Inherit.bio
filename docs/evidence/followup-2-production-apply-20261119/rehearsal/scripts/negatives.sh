#!/usr/bin/env bash
# LOCAL ONLY negative checks on the local mirror (127.0.0.1:54322). Each runs in one
# transaction that is rolled back, and the fingerprint and ledger must be unchanged
# afterwards. The caller exports PGPASSWORD for the local stack.
#   negatives.sh tamper     on the follow-up's post-state: a guarded predecessor body that
#                           differs (one extra grant on #1's writer; #4's shared body with its
#                           2 comment lines stripped, as a comment-dropping transport would
#                           leave it; batch 1's guarded bodies have no comment line) must show
#                           in the pre-checks and make the whole-release dry run refuse; a check value
#                           the $widen$ parse cannot read must show in the pre-checks (the
#                           parse would drop it).
#   negatives.sh before-followup   on PR 324's post-state (the follow-up's release not yet
#                           run): the pre-checks, and batch 1's dry run and apply, which
#                           must refuse on the ledger.
set -u
. "$(dirname "$0")/env.sh"
L=${NEG_LOG:-$W/logs/negatives}; mkdir -p "$L"
OUT=$L/results.tsv
M=$L/m01.sql
TREE=$(sed -n "s/^REV_TREE = '\([0-9a-f]*\)'.*/\1/p" "$G/generate.py")
git -C "$REPO" show "$TREE:20261024110000_copilot_settings_delete_nonce.sql" > "$M"
M4=$L/m04.sql
git -C "$REPO" show "$TREE:20261025400000_path_a_account_accept_typed_name.sql" > "$M4"
st() { echo "$(fpto /dev/stdout | sha256sum | cut -c1-16) $(ledger)"; }
summ() {  # summ <prechecks json> -> nonzero keys and failed guards
  python3 -I -c "import json,sys
t=open(sys.argv[1]).read().strip()
if not t.startswith('{'): print('no result (the pre-checks query failed; see the log)'); sys.exit()
p=json.loads(t.split('\n')[0])
nz={k:v for k,v in {**p['must_be_zero'], **p['compat_must_be_zero']}.items() if v}
bad=[(k.split(' ')[0]+' '+v['function'].split('(')[0], v['have_md5']) for k,v in p['guards'].items() if not v['ok']]
print('ledger', p['ledger']['count'], p['ledger']['max'], '| nonzero', nz, '| guards not ok', len(bad), bad)" "$1"
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
  echo -e "$name\tprechecks: $(summ "$L/$name-prechecks.json")\truns: $(grep -o 'ERROR:.*' "$L/$name.log" | grep -v 'current transaction is aborted' | cut -c1-160 | tr '\n' '|')\tstate $([ "$before" = "$after" ] && echo unchanged || echo CHANGED)" | tee -a "$OUT"
}
case "${1:-}" in
tamper)
  : > "$OUT"
  [ "$(ledger)" = "280 20261023140000" ]
  tx extra-grant "grant execute on function public.remove_own_copilot_settings_v1(uuid,uuid) to authenticated;" "$G/all-batches-dry-run.sql" "$M"
  tx strip-comments "do \$neg\$ declare d text; begin
  select pg_catalog.pg_get_functiondef('private.adult_subject_invitation_response_v1(uuid,uuid,text,uuid,text)'::regprocedure) into d;
  if d !~ E'\\n[ \\t]*--' then raise exception 'no full-line comment to strip'; end if;
  execute pg_catalog.regexp_replace(d, E'\\n[ \\t]*--[^\\n]*', '', 'g'); end \$neg\$;" "$G/all-batches-dry-run.sql" "$M4"
  tx unparsed-check-value "do \$neg\$ declare d text; begin
  select pg_catalog.pg_get_constraintdef(c.oid) into d from pg_catalog.pg_constraint c
   where c.conrelid='public.account_operation_nonces'::regclass and c.conname='account_operation_nonces_operation_check';
  alter table public.account_operation_nonces drop constraint account_operation_nonces_operation_check;
  execute 'alter table public.account_operation_nonces add constraint account_operation_nonces_operation_check '
   || replace(d, '''subject_transfer''::text', '''subject_transfer''::text, ''x2''::text'); end \$neg\$;"
  ;;
before-followup)
  [ "$(ledger)" = "273 20261016221000" ]
  tx before-followup "" "$G/all-batches-dry-run.sql" "$G/batch-1-apply.sql"
  ;;
*) echo "usage: negatives.sh tamper | before-followup"; exit 2;;
esac
