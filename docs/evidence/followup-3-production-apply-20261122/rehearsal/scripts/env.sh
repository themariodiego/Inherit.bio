# LOCAL ONLY. Sourced by every rehearsal script of this kit. The rehearsal runs on an
# isolated local stack, "relk4" (setup-stack.sh: its own project id, its own ports
# 58320-58329, the database on 127.0.0.1:58322, container supabase_db_relk4), as the
# follow-up kit's rehearsal did with "relfu". It never touches the shared stack on 54322
# (project "sequence"), which other work uses: every script refuses any other database.
# The caller exports PGPASSWORD for the local stack (the Supabase CLI's local default);
# nothing here reads or prints it.
set -o pipefail
REPO=${REPO:-$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)}
KIT=$REPO/docs/evidence/followup-3-production-apply-20261122
G=${G:-$KIT/guarded}
K323=$REPO/docs/evidence/pr323-production-apply-20261016
K324=$REPO/docs/evidence/pr324-production-apply-20261022
KFU=$REPO/docs/evidence/followup-production-apply-20261023
KFU2=$REPO/docs/evidence/followup-2-production-apply-20261119
FP=$KIT/fingerprint.sql
DB=${REHEARSAL_DB:-postgresql://postgres@127.0.0.1:58322/postgres}
case "$DB" in postgresql://postgres@127.0.0.1:58322/postgres) ;; *) echo "refusing $DB: only the isolated stack relk4 on 127.0.0.1:58322" >&2; exit 1;; esac
W=${K4_SCRATCH:?scratch directory for the relk4 project, logs and read-backs}
CONTAINER=supabase_db_relk4
CLI=$REPO/node_modules/.bin/supabase
export PGCLIENTENCODING=UTF8
export NODE_OPTIONS="--use-openssl-ca --max-old-space-size=8192"
ledger() { psql "$DB" -X -At -c "select count(*)||' '||max(version) from supabase_migrations.schema_migrations"; }
fpto() { psql "$DB" -X -q -At -v ON_ERROR_STOP=1 -f "$FP" -o "$1"; }
sha() { sha256sum < "$1" | cut -d' ' -f1; }
