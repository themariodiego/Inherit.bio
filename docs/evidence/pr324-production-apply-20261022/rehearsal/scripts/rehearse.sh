#!/usr/bin/env bash
# LOCAL ONLY rehearsal of the guarded PR 324 batches on the production mirror built
# by build-mirror.sh, on the isolated stack rel324 (127.0.0.1:55322), never the shared
# stack. Uses the operator command shape of guarded/README.md, and check-readback.py
# exactly as the operator does.
#   MAINSUITE_AFTER="1 2 3 4"  run main 12f24475's pgTAP suite after those batches
set -uo pipefail
S=/tmp/claude-0/-home-user-Inherit-bio/6541a88f-5423-5787-89b6-a4effe2d1864/scratchpad/rel324
G=/home/user/wt-release2/docs/evidence/pr324-production-apply-20261022/guarded
DB=postgresql://postgres:postgres@127.0.0.1:55322/postgres
L=${REHEARSAL_LOG:-$S/logs/rehearsal}; mkdir -p "$L"
OUT=$L/results.tsv
: > "$OUT"
export PGCLIENTENCODING=UTF8
N=$(python3 -I -c "import json; print(len(json.load(open('$G/expected-summaries.json'))['batches']))")

run() {  # run <file> <log> [timeout]  -> prints rc; the operator command shape
  timeout 190 psql "$DB" -X -v ON_ERROR_STOP=1 -c "set statement_timeout = '${3:-180s}'" -f "$1" > "$2" 2>&1
  echo $?
}
state() {  # state <tag> -> fingerprint + ledger snapshot
  psql "$DB" -X -q -At -v ON_ERROR_STOP=1 -f "$G/fingerprint.sql" -o "$L/fp-$1.json"
  psql "$DB" -X -q -At -v ON_ERROR_STOP=1 -o "$L/ledger-$1.txt" -c "select version||'|'||coalesce(name,'')||'|'||coalesce(array_length(statements,1),0)||'|'||coalesce(md5(statements[1]),'') from supabase_migrations.schema_migrations order by version"
}
same() { cmp -s "$L/fp-$1.json" "$L/fp-$2.json" && cmp -s "$L/ledger-$1.txt" "$L/ledger-$2.txt" && echo unchanged || echo CHANGED; }
readback() { python3 -I "$G/check-readback.py" "$L/fp-$1.json" "$2" "$3" | tr '\n' ' '; }
secs() { printf '%.3f' "$(echo "$2-$1" | bc)"; }
mainsuite() {
  "$S/tools/mainsuite.sh" "$1"
  psql "$DB" -X -q -c "drop extension if exists pgtap" 2>/dev/null
}

state pre-b1
echo -e "pre\tread-back of the mirror\t$(readback pre-b1 1 pre)" | tee -a "$OUT"
psql "$DB" -X -q -At -v ON_ERROR_STOP=1 -f "$G/production-readonly-prechecks.sql" -o "$L/prechecks-mirror-pre.json"
echo -e "pre\tprechecks\trc=$?\tmust_be_zero nonzero: $(python3 -I -c "import json,sys; p=json.load(open(sys.argv[1])); print([k for k,v in p['must_be_zero'].items() if v] or 'none', 'guards ok', sum(g['ok'] for g in p['guards'].values()), '/', len(p['guards']))" "$L/prechecks-mirror-pre.json")" | tee -a "$OUT"

# Whole-release dry run, under the Management API's session timeout (2min).
t0=$(date +%s.%N); rc=$(run "$G/all-batches-dry-run.sql" "$L/all-batches-dry-run.log" 2min); t1=$(date +%s.%N)
state after-all-dry
echo -e "all\tdry run (statement_timeout 2min)\trc=$rc\t$(grep -c 'ERROR:' "$L/all-batches-dry-run.log") ERROR line(s): $(grep -o 'ERROR:.*' "$L/all-batches-dry-run.log")\t$(secs $t0 $t1)s\t$(same pre-b1 after-all-dry)\t$(readback after-all-dry 1 pre)" | tee -a "$OUT"

# Negative checks before anything is applied.
timeout 190 psql "$DB" -X -v ON_ERROR_STOP=1 -f "$G/batch-1-dry-run.sql" > "$L/neg-no-session-timeout.log" 2>&1
echo -e "neg\tbatch-1 dry run without a session statement_timeout\trc=$?\t$(grep -o 'ERROR:.*' "$L/neg-no-session-timeout.log" | head -1)" | tee -a "$OUT"
rc=$(run "$G/batch-1-dry-run.sql" "$L/neg-timeout-190s.log" 190s)
echo -e "neg\tbatch-1 dry run with statement_timeout 190s\trc=$rc\t$(grep -o 'ERROR:.*' "$L/neg-timeout-190s.log" | head -1)" | tee -a "$OUT"
rc=$(run "$G/batch-2-dry-run.sql" "$L/neg-b2-before-b1.log")
echo -e "neg\tbatch-2 dry run before batch 1\trc=$rc\t$(grep -o 'ERROR:.*' "$L/neg-b2-before-b1.log" | head -1)" | tee -a "$OUT"
rc=$(run "$G/batch-$N-apply.sql" "$L/neg-b$N-apply-first.log")
echo -e "neg\tbatch-$N apply before batch 1\trc=$rc\t$(grep -o 'ERROR:.*' "$L/neg-b$N-apply-first.log" | head -1)" | tee -a "$OUT"
state after-neg; echo -e "neg\tstate after the negative checks\t$(same pre-b1 after-neg)" | tee -a "$OUT"

if [[ " ${MAINSUITE_AFTER:-} " == *" 0 "* ]]; then
  mainsuite "$L/pgtap-main-on-pre.log"
  state after-mainsuite-pre
  echo -e "b0\tmain pgTAP suite on the pre-state\t$(grep -E '^(Files=|Result:)' "$L/pgtap-main-on-pre.log" | cut -d'(' -f1 | tr '\n' ' ')\t$(same pre-b1 after-mainsuite-pre)" | tee -a "$OUT"
fi

for k in $(seq 1 "$N"); do
  [ "$k" -gt 1 ] && cp "$L/fp-post-b$((k-1)).json" "$L/fp-pre-b$k.json" && cp "$L/ledger-post-b$((k-1)).txt" "$L/ledger-pre-b$k.txt"
  rc=$(run "$G/local/batch-$k-probe.sql" "$L/probe-b$k.log")
  state after-probe-b$k
  echo -e "b$k\tlock probe\trc=$rc\t$(grep -c 'ERROR:  PROBE_LOCKS' "$L/probe-b$k.log") PROBE_LOCKS line\t$(same pre-b$k after-probe-b$k)" | tee -a "$OUT"
  t0=$(date +%s.%N); rc=$(run "$G/batch-$k-dry-run.sql" "$L/dry-run-b$k.log"); t1=$(date +%s.%N)
  state after-dry-run-b$k
  echo -e "b$k\tdry run\trc=$rc\t$(grep -c 'ERROR:' "$L/dry-run-b$k.log") ERROR line(s): $(grep -o 'ERROR:.*' "$L/dry-run-b$k.log")\t$(secs $t0 $t1)s\t$(same pre-b$k after-dry-run-b$k)\t$(readback after-dry-run-b$k $k pre)" | tee -a "$OUT"
  t0=$(date +%s.%N); rc=$(run "$G/batch-$k-apply.sql" "$L/apply-b$k.log"); t1=$(date +%s.%N)
  state post-b$k
  echo -e "b$k\tapply\trc=$rc\t$(tr '\n' ' ' < "$L/apply-b$k.log" | cut -c1-200)\t$(secs $t0 $t1)s\t$(readback post-b$k $k post)" | tee -a "$OUT"
  echo -e "b$k\tledger\t$(wc -l < "$L/ledger-post-b$k.txt") rows, max $(tail -1 "$L/ledger-post-b$k.txt" | cut -d'|' -f1)" | tee -a "$OUT"
  if [[ " ${MAINSUITE_AFTER:-} " == *" $k "* ]]; then
    mainsuite "$L/pgtap-main-on-post-b$k.log"
    state after-mainsuite-b$k
    echo -e "b$k\tmain pgTAP suite on the post-state\t$(grep -E '^(Files=|Result:)' "$L/pgtap-main-on-post-b$k.log" | cut -d'(' -f1 | tr '\n' ' ')\t$(sed -n '/Test Summary Report/,/^Files=/p' "$L/pgtap-main-on-post-b$k.log" | grep -o '[a-z_0-9]*\.sql *(Wstat: [0-9]* Tests: [0-9]* Failed: [0-9]*)' | sed 's/ *(Wstat: [0-9]* Tests: [0-9]* Failed: /:/; s/)//' | tr '\n' ' ')\t$(same post-b$k after-mainsuite-b$k)" | tee -a "$OUT"
  fi
  rc=$(run "$G/batch-$k-apply.sql" "$L/reapply-b$k.log")
  state after-reapply-b$k
  echo -e "b$k\tre-apply\trc=$rc\t$(grep -o 'ERROR:.*' "$L/reapply-b$k.log" | head -1)\t$(same post-b$k after-reapply-b$k)" | tee -a "$OUT"
done
echo done
