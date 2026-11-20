#!/usr/bin/env bash
# LOCAL ONLY order equivalence on the relfu stack (127.0.0.1:56322). Precondition: the
# stack holds the rehearsed final mirror (production mirror + PR 324's four batches +
# this kit's batches). Steps:
#   1. the final mirror: fingerprint and normalised schema dump;
#   2. fresh 538dcee6 (270 migrations, supabase db reset) + the 7 follow-up files, each
#      `psql -1 -f` as the CLI applies them;
#   3. fresh 77d04563 (277 migrations), then the same drift as production (the 8
#      comment-stripped bodies and pg_cron);
#   4. the project's migrations are put back to main's 245 files.
# Then: 2 == 3 (undrifted) and 1 == 3 (drifted), by fingerprint bytes and normalised dump.
# The caller exports PGPASSWORD for the local stack.
set -euo pipefail
W=${RELFU_SCRATCH:?scratch directory of the relfu project}
SCRIPTS=$(cd "$(dirname "$0")" && pwd)
G=${G:-/home/user/wt-release3/docs/evidence/followup-production-apply-20261023/guarded}
DB=${RELFU_DB:-postgresql://postgres@127.0.0.1:56322/postgres}
case "$DB" in *:54322/*) echo "refusing the shared stack"; exit 1;; esac
L=${EQ_LOG:-$W/logs/equivalence}; mkdir -p "$L"
export PGCLIENTENCODING=UTF8
CLI=/home/user/Inherit.bio/node_modules/.bin/supabase
fp() { psql "$DB" -X -q -At -v ON_ERROR_STOP=1 -f "$G/fingerprint.sql" -o "$L/fp-$1.json"; echo "fp-$1.json $(sha256sum < "$L/fp-$1.json" | cut -d' ' -f1) $(wc -c < "$L/fp-$1.json") bytes"; }
dump() { echo "dump-$1 $(bash "$SCRIPTS/dump.sh" "$L/dump-$1.sql")"; }
reset_to() {  # reset_to <src name> <expected count>
  rm -rf "$W/proj/supabase/migrations"; cp -r "$W/src/$1/supabase/migrations" "$W/proj/supabase/migrations"
  [ "$(ls "$W/proj/supabase/migrations" | wc -l)" = "$2" ]
  ( time "$CLI" db reset --local --workdir "$W/proj" ) > "$L/reset-$1.log" 2>&1
  [ "$(grep -c 'Applying migration' "$L/reset-$1.log")" = "$2" ]
}
{
[ "$(psql "$DB" -X -At -c "select count(*)||' '||max(version) from supabase_migrations.schema_migrations")" = "280 20261023140000" ]
fp final; dump final
reset_to pr324 270
t0=$(date +%s.%N)
for f in $(cd "$W/src/fu/supabase/migrations" && ls | sort); do
  [ -e "$W/src/pr324/supabase/migrations/$f" ] && continue
  psql "$DB" -X -q -v ON_ERROR_STOP=1 -1 -f "$W/src/fu/supabase/migrations/$f" > /dev/null
done
echo "538dcee6 + the 7 (psql -1 -f each): $(printf '%.3f' "$(echo "$(date +%s.%N)-$t0" | bc)") s"
fp pr324-plus-7; dump pr324-plus-7
reset_to fu 277
fp fresh-fu; dump fresh-fu
bash "$SCRIPTS/drift.sh" "$L/drift" > /dev/null
fp fresh-fu-drift; dump fresh-fu-drift
cmp "$L/fp-pr324-plus-7.json" "$L/fp-fresh-fu.json" && echo "(a) undrifted: fingerprint byte-identical"
cmp "$L/dump-pr324-plus-7.norm.sql" "$L/dump-fresh-fu.norm.sql" && echo "(a) undrifted: normalised dump identical"
cmp "$L/fp-final.json" "$L/fp-fresh-fu-drift.json" && echo "(b) drifted: fingerprint byte-identical"
cmp "$L/dump-final.norm.sql" "$L/dump-fresh-fu-drift.norm.sql" && echo "(b) drifted: normalised dump identical"
echo "(c) final mirror vs plain fresh 77d04563:"
python3 -I "${K324:-/home/user/wt-release3/docs/evidence/pr324-production-apply-20261022}/rehearsal/scripts/fpcompare.py" "$L/fp-final.json" "$L/fp-fresh-fu.json" | grep -v ': equal' || true
d=$(diff "$L/dump-fresh-fu.norm.sql" "$L/dump-final.norm.sql" || true)
echo "  dump: $(grep -c '^<' <<<"$d" || true) lines only in fresh 77d04563, $(grep -c '^>' <<<"$d" || true) only in the final mirror"
echo "  lines only in fresh 77d04563 that are not full-line comments: $( (grep '^<' <<<"$d" || true) | grep -vc '^<\s*--' || true)"
echo "  lines only in the final mirror that are not blank, a bare '--' or about cron: $( (grep '^>' <<<"$d" || true) | grep -vi cron | grep -v '^> *$' | grep -vc '^> --$' || true)"
rm -rf "$W/proj/supabase/migrations"; cp -r "$W/src/main/supabase/migrations" "$W/proj/supabase/migrations"
echo "project migrations restored to main's $(ls "$W/proj/supabase/migrations" | wc -l)"
} 2>&1 | tee "$L/equivalence.txt"
