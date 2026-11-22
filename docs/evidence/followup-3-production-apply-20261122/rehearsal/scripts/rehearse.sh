#!/usr/bin/env bash
# LOCAL ONLY rehearsal of this kit on the mirror of release 3's rehearsed post-state
# (build-mirror.sh), on the isolated stack relk4 (127.0.0.1:58322). Release 3's
# rehearse.sh, for four batches: the operator command shape of guarded/README.md, the
# files `generate.py final` writes, and check-readback.py exactly as the operator runs it.
# The caller exports PGPASSWORD for the local stack.
#   SUITES=1     run the pgTAP suites the branch added or changed since release 3's tree
#                (33 files of supabase/tests at the pinned head) on the final state
#   OLDSUITE=1   run release 3's whole pgTAP suite (6252566a, the last commit carrying its
#                migration tree) on the final state
set -u
. "$(dirname "$0")/env.sh"
SCRIPTS=$(cd "$(dirname "$0")" && pwd)
L=${REHEARSAL_LOG:-$W/logs/rehearsal}; mkdir -p "$L"
OUT=$L/results.tsv
: > "$OUT"
N=$(python3 -I -c "import json,sys; print(len(json.load(open(sys.argv[1]))['batches']))" "$G/expected-summaries.json")

run() {  # run <file> <log> [timeout] -> prints rc; the operator command shape
  timeout 190 psql "$DB" -X -v ON_ERROR_STOP=1 -c "set statement_timeout = '${3:-180s}'" -f "$1" > "$2" 2>&1
  echo $?
}
state() {  # state <tag> -> fingerprint + ledger snapshot
  fpto "$L/fp-$1.json"
  psql "$DB" -X -q -At -v ON_ERROR_STOP=1 -o "$L/ledger-$1.txt" -c "select version||'|'||coalesce(name,'')||'|'||coalesce(array_length(statements,1),0)||'|'||coalesce(md5(statements[1]),'') from supabase_migrations.schema_migrations order by version"
}
same() { cmp -s "$L/fp-$1.json" "$L/fp-$2.json" && cmp -s "$L/ledger-$1.txt" "$L/ledger-$2.txt" && echo unchanged || echo CHANGED; }
readback() { python3 -I "$G/check-readback.py" "$L/fp-$1.json" "$2" "$3" | tr '\n' ' '; }
secs() { printf '%.3f' "$(echo "$2-$1" | bc)"; }
errs() { echo "$(grep -c 'ERROR:' "$1") ERROR line(s): $(grep -o 'ERROR:.*' "$1" | cut -c1-200 | tr '\n' '|')"; }
neg() {  # neg <label> <file> [timeout]: a run that must refuse, state unchanged
  local tag=neg-$((++NEGN)) rc
  state "$tag-before"; rc=$(run "$2" "$L/$tag.log" "${3:-180s}"); state "$tag-after"
  echo -e "neg\t$1\trc=$rc\t$(grep -o 'ERROR:.*' "$L/$tag.log" | head -1 | cut -c1-220)\t$(same "$tag-before" "$tag-after")" | tee -a "$OUT"
}
NEGN=0

state pre-b1
echo -e "pre\tread-back of the mirror\t$(readback pre-b1 1 pre)\tledger $(ledger)" | tee -a "$OUT"
psql "$DB" -X -q -At -v ON_ERROR_STOP=1 -f "$G/production-readonly-prechecks.sql" -o "$L/prechecks-mirror-pre.json"
echo -e "pre\tprechecks\trc=$?\t$(python3 -I -c "import json,sys; p=json.load(open(sys.argv[1])); print('must_be_zero nonzero:', {k:v for k,v in p['must_be_zero'].items() if v} or 'none', '| guards ok', sum(g['ok'] for g in p['guards'].values()), '/', len(p['guards']), '| constraint guards ok', sum(g['ok'] for g in p['constraint_guards'].values()), '/', len(p['constraint_guards']))" "$L/prechecks-mirror-pre.json")" | tee -a "$OUT"

# Whole-release dry run, under the Management API's session timeout (2min).
t0=$(date +%s.%N); rc=$(run "$G/all-batches-dry-run.sql" "$L/all-batches-dry-run.log" 2min); t1=$(date +%s.%N)
state after-all-dry
echo -e "all\tdry run (statement_timeout 2min)\trc=$rc\t$(errs "$L/all-batches-dry-run.log")\t$(secs $t0 $t1)s\t$(same pre-b1 after-all-dry)\t$(readback after-all-dry 1 pre)" | tee -a "$OUT"

# Negative checks before anything is applied. Tampered copies: one byte of an embedded
# migration changed (in its header comment, so only the integrity check can see it), and
# the embedded fingerprint query changed; everything else as generated.
python3 -I - "$G/batch-1-apply.sql" "$L/tampered-m01-apply.sql" "$G/batch-4-apply.sql" "$L/tampered-m13-apply.sql" <<'PY'
import sys
def tamper(src, dst, tag):
    t = open(src, encoding='utf-8').read()
    a = t.split(tag)[1]
    assert a.count('PRODUCTION RELEASE: GUARDED') == 1
    open(dst, 'w', encoding='utf-8').write(t.replace(a, a.replace('PRODUCTION RELEASE: GUARDED', 'PRODUCTION RELEASE: GUARDEd'), 1))
tamper(sys.argv[1], sys.argv[2], '$inherit_m_20261119110000$')
tamper(sys.argv[3], sys.argv[4], '$inherit_m_20261122120000$')
PY
python3 -I - "$G/batch-1-apply.sql" "$L/tampered-fingerprint-apply.sql" <<'PY'
import sys
t = open(sys.argv[1], encoding='utf-8').read()
a = t.split('$inherit_release_fp$')[1]
b = a.replace("'private'", "'privatE'", 1)
assert b != a
open(sys.argv[2], 'w', encoding='utf-8').write(t.replace(a, b, 1))
PY
state neg-start
timeout 190 psql "$DB" -X -v ON_ERROR_STOP=1 -f "$G/batch-1-dry-run.sql" > "$L/neg-no-session-timeout.log" 2>&1
echo -e "neg\tbatch-1 dry run without a session statement_timeout\trc=$?\t$(grep -o 'ERROR:.*' "$L/neg-no-session-timeout.log" | head -1)" | tee -a "$OUT"
neg "batch-1 dry run with statement_timeout 190s" "$G/batch-1-dry-run.sql" 190s
neg "batch-2 dry run before batch 1 (out of order)" "$G/batch-2-dry-run.sql"
neg "batch-2 apply before batch 1 (out of order)" "$G/batch-2-apply.sql"
neg "batch-4 apply before batch 1 (out of order)" "$G/batch-4-apply.sql"
neg "batch-1 apply with one byte of the embedded 20261119110000 changed" "$L/tampered-m01-apply.sql"
neg "batch-1 apply with the embedded fingerprint query changed" "$L/tampered-fingerprint-apply.sql"
state after-neg; echo -e "neg\tstate after the negative checks\t$(same neg-start after-neg)" | tee -a "$OUT"

for k in $(seq 1 "$N"); do
  [ "$k" -gt 1 ] && cp "$L/fp-post-b$((k-1)).json" "$L/fp-pre-b$k.json" && cp "$L/ledger-post-b$((k-1)).txt" "$L/ledger-pre-b$k.txt"
  if [ "$k" = 3 ]; then
    neg "batch-4 apply after batch 2, before batch 3 (out of order)" "$G/batch-4-apply.sql"
    neg "batch-1 apply after batch 2 (re-run of an applied batch)" "$G/batch-1-apply.sql"
  fi
  if [ "$k" = 4 ]; then
    neg "batch-4 apply with one byte of the embedded 20261122120000 changed" "$L/tampered-m13-apply.sql"
  fi
  rc=$(run "$G/local/batch-$k-probe.sql" "$L/probe-b$k.log")
  state after-probe-b$k
  echo -e "b$k\tlock probe\trc=$rc\t$(grep -c 'ERROR:  PROBE_LOCKS' "$L/probe-b$k.log") PROBE_LOCKS line\t$(same pre-b$k after-probe-b$k)" | tee -a "$OUT"
  t0=$(date +%s.%N); rc=$(run "$G/batch-$k-dry-run.sql" "$L/dry-run-b$k.log"); t1=$(date +%s.%N)
  state after-dry-run-b$k
  echo -e "b$k\tdry run\trc=$rc\t$(errs "$L/dry-run-b$k.log")\t$(secs $t0 $t1)s\t$(same pre-b$k after-dry-run-b$k)\t$(readback after-dry-run-b$k $k pre)" | tee -a "$OUT"
  t0=$(date +%s.%N); rc=$(run "$G/batch-$k-apply.sql" "$L/apply-b$k.log"); t1=$(date +%s.%N)
  state post-b$k
  echo -e "b$k\tapply\trc=$rc\t$(tr '\n' ' ' < "$L/apply-b$k.log" | cut -c1-200)\t$(secs $t0 $t1)s\t$(readback post-b$k $k post)" | tee -a "$OUT"
  echo -e "b$k\tledger\t$(wc -l < "$L/ledger-post-b$k.txt") rows, max $(tail -1 "$L/ledger-post-b$k.txt" | cut -d'|' -f1)" | tee -a "$OUT"
  rc=$(run "$G/batch-$k-apply.sql" "$L/reapply-b$k.log")
  state after-reapply-b$k
  echo -e "b$k\tre-apply\trc=$rc\t$(grep -o 'ERROR:.*' "$L/reapply-b$k.log" | head -1)\t$(same post-b$k after-reapply-b$k)" | tee -a "$OUT"
done
neg "batch-1 apply after batch 4 (re-run of an applied batch)" "$G/batch-1-apply.sql"
neg "whole-release dry run after batch 4 (re-run)" "$G/all-batches-dry-run.sql" 2min
psql "$DB" -X -q -At -v ON_ERROR_STOP=1 -f "$G/production-readonly-prechecks.sql" -o "$L/prechecks-mirror-final.json"
echo -e "final\tprechecks on the final state\trc=$?\t$(python3 -I -c "import json,sys; p=json.load(open(sys.argv[1])); print('ledger', p['ledger']['count'], p['ledger']['max'], '| must_be_zero nonzero:', sorted(k for k,v in p['must_be_zero'].items() if v), '| guards ok', sum(g['ok'] for g in p['guards'].values()), '/', len(p['guards']))" "$L/prechecks-mirror-final.json")" | tee -a "$OUT"
echo -e "final\tfingerprint\t$(sha "$L/fp-post-b$N.json")" | tee -a "$OUT"
if [ "${SUITES:-0}" = 1 ]; then
  for f in $(git -C "$REPO" diff --name-only --diff-filter=AM a2a4d8e9263cc6580bf46fda360a4187a78b0817 HEAD -- supabase/tests); do
    s=$(basename "$f" .sql)
    ( cd "$W/proj-head" && "$CLI" test db --local --workdir "$W/proj-head" "supabase/tests/$s.sql" ) > "$L/pgtap-$s.log" 2>&1; rc=$?
    psql "$DB" -X -q -c "drop extension if exists pgtap" > /dev/null 2>&1
    state after-pgtap-$s
    echo -e "pgtap\t$s.sql on the final state\trc=$rc\t$(grep -E '^(Files=|Result:)' "$L/pgtap-$s.log" | cut -d'(' -f1 | tr '\n' ' ')\t$(grep -E '^(not ok|# Failed)|ERROR' "$L/pgtap-$s.log" | head -3 | cut -c1-160 | tr '\n' '|')\t$(same post-b$N after-pgtap-$s)" | tee -a "$OUT"
  done
fi
if [ "${OLDSUITE:-0}" = 1 ]; then
  bash "$SCRIPTS/suite.sh" 6252566acf7d94064b6e899ac76a72796036b8d8 "$L/pgtap-release3-on-final.log" > /dev/null
  state after-oldsuite
  echo -e "final\trelease 3's pgTAP suite (6252566a) on the final state\t$(grep -E '^(Files=|Result:)' "$L/pgtap-release3-on-final.log" | cut -d'(' -f1 | tr '\n' ' ')\t$(sed -n '/Test Summary Report/,/^Files=/p' "$L/pgtap-release3-on-final.log" | grep -o '[a-z_0-9]*\.sql *(Wstat: [0-9]* Tests: [0-9]* Failed: [0-9]*)' | sed 's/ *(Wstat: [0-9]* Tests: [0-9]* Failed: /:/; s/)//' | tr '\n' ' ')\t$(same post-b$N after-oldsuite)" | tee -a "$OUT"
fi
echo done
