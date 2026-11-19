# LOCAL ONLY. Sourced by every rehearsal script of this kit. The rehearsal ran on the
# one local Supabase stack this machine runs (project "sequence", container
# supabase_db_sequence, 127.0.0.1:54322), which the owner allowed for this rehearsal;
# the earlier kits used an isolated stack instead. Every script refuses any other
# database. The caller exports PGPASSWORD for the local stack (the Supabase CLI's
# local default); nothing here reads or prints it.
set -o pipefail
REPO=${REPO:-$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)}
KIT=$REPO/docs/evidence/followup-2-production-apply-20261119
G=${G:-$KIT/guarded}
K323=$REPO/docs/evidence/pr323-production-apply-20261016
K324=$REPO/docs/evidence/pr324-production-apply-20261022
KFU=$REPO/docs/evidence/followup-production-apply-20261023
FP=$KIT/fingerprint.sql
DB=${REHEARSAL_DB:-postgresql://postgres@127.0.0.1:54322/postgres}
case "$DB" in postgresql://postgres@127.0.0.1:54322/postgres) ;; *) echo "refusing $DB: only the local stack on 127.0.0.1:54322" >&2; exit 1;; esac
W=${FU2_SCRATCH:?scratch directory for logs and read-backs}
CLI=$REPO/node_modules/.bin/supabase
export PGCLIENTENCODING=UTF8
export NODE_OPTIONS="--use-openssl-ca --max-old-space-size=8192"
ledger() { psql "$DB" -X -At -c "select count(*)||' '||max(version) from supabase_migrations.schema_migrations"; }
fpto() { psql "$DB" -X -q -At -v ON_ERROR_STOP=1 -f "$FP" -o "$1"; }
sha() { sha256sum < "$1" | cut -d' ' -f1; }
