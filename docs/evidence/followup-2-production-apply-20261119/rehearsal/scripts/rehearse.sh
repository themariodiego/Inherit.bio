#!/usr/bin/env bash
# LOCAL ONLY rehearsal of this kit on the mirror of the follow-up's rehearsed
# post-state (build-mirror.sh), on the local stack (127.0.0.1:54322). Uses the operator
# command shape of guarded/README.md, the files `generate.py final` writes, and
# check-readback.py exactly as the operator does. The caller exports PGPASSWORD.
#   SUITES=1     run the 4 suites of these migrations (supabase/tests at the working tree)
#                on the final state
#   OLDSUITE=1   run the follow-up's whole suite (77d04563) on the final state
# (The first rehearsal, against tree 151259da, ran batch 1 only, from local/; see
# ../data/first-rehearsal/.)
set -u
. "$(dirname "$0")/env.sh"
SCRIPTS=$(cd "$(dirname "$0")" && pwd)
L=${REHEARSAL_LOG:-$W/logs/rehearsal2}; mkdir -p "$L"
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

state pre-b1
echo -e "pre\tread-back of the mirror\t$(readback pre-b1 1 pre)\tledger $(ledger)" | tee -a "$OUT"
psql "$DB" -X -q -At -v ON_ERROR_STOP=1 -f "$G/production-readonly-prechecks.sql" -o "$L/prechecks-mirror-pre.json"
echo -e "pre\tprechecks\trc=$?\t$(python3 -I -c "import json,sys; p=json.load(open(sys.argv[1])); print('must_be_zero nonzero:', {k:v for k,v in {**p['must_be_zero'], **p['compat_must_be_zero']}.items() if v} or 'none', '| guards ok', sum(g['ok'] for g in p['guards'].values()), '/', len(p['guards']))" "$L/prechecks-mirror-pre.json")" | tee -a "$OUT"

# Whole-release dry run, under the Management API's session timeout (2min).
t0=$(date +%s.%N); rc=$(run "$G/all-batches-dry-run.sql" "$L/all-batches-dry-run.log" 2min); t1=$(date +%s.%N)
state after-all-dry
echo -e "all\tdry run (statement_timeout 2min)\trc=$rc\t$(errs "$L/all-batches-dry-run.log")\t$(secs $t0 $t1)s\t$(same pre-b1 after-all-dry)\t$(readback after-all-dry 1 pre)" | tee -a "$OUT"

# Negative checks before anything is applied.
timeout 190 psql "$DB" -X -v ON_ERROR_STOP=1 -f "$G/batch-1-dry-run.sql" > "$L/neg-no-session-timeout.log" 2>&1
echo -e "neg\tbatch-1 dry run without a session statement_timeout\trc=$?\t$(grep -o 'ERROR:.*' "$L/neg-no-session-timeout.log" | head -1)" | tee -a "$OUT"
rc=$(run "$G/batch-1-dry-run.sql" "$L/neg-timeout-190s.log" 190s)
echo -e "neg\tbatch-1 dry run with statement_timeout 190s\trc=$rc\t$(grep -o 'ERROR:.*' "$L/neg-timeout-190s.log" | head -1)" | tee -a "$OUT"
rc=$(run "$G/batch-2-dry-run.sql" "$L/neg-b2-before-b1.log")
echo -e "neg\tbatch-2 dry run before batch 1\trc=$rc\t$(grep -o 'ERROR:.*' "$L/neg-b2-before-b1.log" | head -1)" | tee -a "$OUT"
rc=$(run "$G/batch-2-apply.sql" "$L/neg-b2-apply-first.log")
echo -e "neg\tbatch-2 apply before batch 1\trc=$rc\t$(grep -o 'ERROR:.*' "$L/neg-b2-apply-first.log" | head -1)" | tee -a "$OUT"
# Tampered copies: one byte of an embedded migration changed, and the embedded fingerprint
# query changed; everything else as generated.
python3 -I - "$G/batch-1-apply.sql" "$L/tampered-m01-apply.sql" "$G/batch-2-apply.sql" "$L/tampered-m04-apply.sql" <<'PY'
import sys
def tamper(src, dst, tag, old, new):
    t = open(src, encoding='utf-8').read()
    a = t.split(tag)[1]
    assert a.count(old) == 1 and len(old) == len(new)
    open(dst, 'w', encoding='utf-8').write(t.replace(a, a.replace(old, new), 1))
tamper(sys.argv[1], sys.argv[2], '$inherit_m_20261024110000$', "'provider_setting_delete',p_nonce_hash", "'provider_setting_delet3',p_nonce_hash")
tamper(sys.argv[3], sys.argv[4], '$inherit_m_20261025400000$', "'78d147935e25d657d8df631583c6faea'", "'78d147935e25d657d8df631583c6faeb'")
PY
python3 -I - "$G/batch-1-apply.sql" "$L/tampered-fingerprint-apply.sql" <<'PY'
import sys
t = open(sys.argv[1], encoding='utf-8').read()
a = t.split('$inherit_release_fp$')[1]
b = a.replace("'private'", "'privatE'", 1)
assert b != a
open(sys.argv[2], 'w', encoding='utf-8').write(t.replace(a, b, 1))
PY
rc=$(run "$L/tampered-m01-apply.sql" "$L/neg-tampered-m01.log")
echo -e "neg\tbatch-1 apply with one byte of the embedded 20261024110000 changed\trc=$rc\t$(grep -o 'ERROR:.*' "$L/neg-tampered-m01.log" | head -1)" | tee -a "$OUT"
rc=$(run "$L/tampered-fingerprint-apply.sql" "$L/neg-tampered-fingerprint.log")
echo -e "neg\tbatch-1 apply with the embedded fingerprint query changed\trc=$rc\t$(grep -o 'ERROR:.*' "$L/neg-tampered-fingerprint.log" | head -1)" | tee -a "$OUT"
state after-neg; echo -e "neg\tstate after the negative checks\t$(same pre-b1 after-neg)" | tee -a "$OUT"

for k in $(seq 1 "$N"); do
  [ "$k" -gt 1 ] && cp "$L/fp-post-b$((k-1)).json" "$L/fp-pre-b$k.json" && cp "$L/ledger-post-b$((k-1)).txt" "$L/ledger-pre-b$k.txt"
  if [ "$k" = 2 ]; then
    rc=$(run "$L/tampered-m04-apply.sql" "$L/neg-tampered-m04.log")
    state after-neg-b2
    echo -e "neg\tbatch-2 apply with one byte of the embedded 20261025400000 changed (its stripped-body md5)\trc=$rc\t$(grep -o 'ERROR:.*' "$L/neg-tampered-m04.log" | head -1)\t$(same pre-b2 after-neg-b2)" | tee -a "$OUT"
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
if [ "${SUITES:-0}" = 1 ]; then
  for s in copilot_settings_delete_nonce session_csrf_tokens consent_revoke_provider_nonce path_a_account_accept_typed_name; do
    ( cd "$REPO" && "$CLI" test db --local "supabase/tests/$s.sql" ) > "$L/pgtap-$s.log" 2>&1; rc=$?
    psql "$DB" -X -q -c "drop extension if exists pgtap" > /dev/null 2>&1
    state after-pgtap-$s
    echo -e "pgtap\t$s.sql on the final state\trc=$rc\t$(grep -E '^(Files=|Result:)' "$L/pgtap-$s.log" | cut -d'(' -f1 | tr '\n' ' ')\t$(grep -E '^(not ok|# Failed)|ERROR' "$L/pgtap-$s.log" | head -3 | cut -c1-160 | tr '\n' '|')\t$(same post-b$N after-pgtap-$s)" | tee -a "$OUT"
  done
fi
if [ "${OLDSUITE:-0}" = 1 ]; then
  bash "$SCRIPTS/suite.sh" 77d04563e3d568571215284afb8a3aae47b02d56 "$L/pgtap-followup-on-final.log" > /dev/null
  state after-oldsuite
  echo -e "final\tfollow-up pgTAP suite (77d04563) on the final state\t$(grep -E '^(Files=|Result:)' "$L/pgtap-followup-on-final.log" | cut -d'(' -f1 | tr '\n' ' ')\t$(sed -n '/Test Summary Report/,/^Files=/p' "$L/pgtap-followup-on-final.log" | grep -o '[a-z_0-9]*\.sql *(Wstat: [0-9]* Tests: [0-9]* Failed: [0-9]*)' | sed 's/ *(Wstat: [0-9]* Tests: [0-9]* Failed: /:/; s/)//' | tr '\n' ' ')\t$(same post-b$N after-oldsuite)" | tee -a "$OUT"
fi
echo done
