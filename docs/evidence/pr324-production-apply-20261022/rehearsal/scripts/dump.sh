#!/usr/bin/env bash
# LOCAL ONLY: schema-only pg_dump (PostgreSQL 17 client inside the rel324 container).
# The caller exports PGPASSWORD for the local stack (the Supabase CLI's local default);
# docker exec passes it through. The rehearsal ran this with that default written inline.
docker exec -e PGPASSWORD supabase_db_rel324 pg_dump -h 127.0.0.1 -U postgres -d postgres --schema-only > "$1" 2> "$1.err"
echo "rc=$? $(wc -l < "$1") lines $(sha256sum "$1" | cut -c1-16)"
