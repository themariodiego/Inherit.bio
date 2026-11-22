#!/usr/bin/env bash
# LOCAL ONLY: schema-only pg_dump (PostgreSQL 17 client inside the relfu container),
# normalised by dropping its two random \restrict/\unrestrict key lines.
#   dump.sh <out.sql>   writes <out.sql> (raw) and <out.norm.sql>
# The caller exports PGPASSWORD for the local stack; docker exec passes it through.
docker exec -e PGPASSWORD supabase_db_relfu pg_dump -h 127.0.0.1 -U postgres -d postgres --schema-only > "$1" 2> "$1.err"
rc=$?
grep -v -E '^\\(restrict|unrestrict) ' "$1" > "${1%.sql}.norm.sql"
echo "rc=$rc $(wc -l < "${1%.sql}.norm.sql") lines $(sha256sum < "${1%.sql}.norm.sql" | cut -c1-16)"
