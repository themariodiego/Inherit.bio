-- Schema fingerprint (catalog-only, read-only, deterministic).
--
-- One SELECT, one row, one jsonb column "fp".
-- Scope: schemas public and private; plus storage: RLS policies on
-- storage.objects and storage.buckets, and the storage.buckets config
-- columns id, public, file_size_limit, allowed_mime_types.
--
-- Run:  psql "$DB_URL" -X -q -At -v ON_ERROR_STOP=1 -f fingerprint.sql -o fp.json
--
-- Determinism notes:
--  * Deparsed text (pg_get_functiondef / constraintdef / indexdef / viewdef /
--    triggerdef / pg_get_expr / format_type) depends on search_path and on
--    constant output GUCs. The one-time filter at the bottom pins, with
--    set_config(..., is_local => true), search_path=pg_catalog, TimeZone=UTC,
--    DateStyle=ISO, MDY, IntervalStyle=postgres, extra_float_digits=1 and
--    bytea_output=hex for the duration of this statement's transaction
--    (it is an InitPlan in a Result one-time filter, so it runs before the
--    target list is projected). Nothing is written.
--  * Every aggregate uses an explicit ORDER BY with COLLATE "C".
--  * Objects that are members of an extension are excluded from the
--    per-object categories; extensions are listed by name/schema/version.
--  * jsonb text output is canonical (sorted keys), so md5(category::text)
--    is stable for equal content.
--  * Additions beyond the base definition (all catalog-only):
--    policies carry "permissive"; triggers carry "enabled" (tgenabled);
--    views carry relacl and reloptions; extensions carry schema;
--    sequences carry their parameters, acl and OWNED BY column;
--    types include domains and ranges besides enums and composites.
WITH
ns AS (
  SELECT n.oid, n.nspname
  FROM pg_catalog.pg_namespace n
  WHERE n.nspname IN ('public', 'private')
),
extmember AS (
  SELECT d.classid, d.objid
  FROM pg_catalog.pg_depend d
  WHERE d.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass
    AND d.deptype = 'e'
),
functions AS (
  SELECT coalesce(jsonb_agg(f.j ORDER BY f.s COLLATE "C", f.n COLLATE "C", f.a COLLATE "C"), '[]'::jsonb) AS j,
         count(*) AS c
  FROM (
    SELECT ns.nspname AS s, p.proname AS n,
           pg_catalog.pg_get_function_identity_arguments(p.oid) AS a,
           jsonb_build_object(
             'schema', ns.nspname,
             'name', p.proname,
             'args', pg_catalog.pg_get_function_identity_arguments(p.oid),
             'kind', p.prokind,
             'def_md5', md5(pg_catalog.pg_get_functiondef(p.oid)),
             'prosecdef', p.prosecdef,
             'proconfig', to_jsonb(p.proconfig),
             'proacl', p.proacl::text
           ) AS j
    FROM pg_catalog.pg_proc p
    JOIN ns ON ns.oid = p.pronamespace
    WHERE p.prokind IN ('f', 'p')
      AND NOT EXISTS (SELECT 1 FROM extmember e
                      WHERE e.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass AND e.objid = p.oid)
  ) f
),
tbl AS (
  SELECT c.oid, ns.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity, c.relacl
  FROM pg_catalog.pg_class c
  JOIN ns ON ns.oid = c.relnamespace
  WHERE c.relkind IN ('r', 'p')
    AND NOT EXISTS (SELECT 1 FROM extmember e
                    WHERE e.classid = 'pg_catalog.pg_class'::pg_catalog.regclass AND e.objid = c.oid)
),
tables AS (
  SELECT coalesce(jsonb_agg(t.j ORDER BY t.s COLLATE "C", t.n COLLATE "C"), '[]'::jsonb) AS j,
         count(*) AS c
  FROM (
    SELECT tbl.nspname AS s, tbl.relname AS n,
      jsonb_build_object(
        'schema', tbl.nspname,
        'name', tbl.relname,
        'relrowsecurity', tbl.relrowsecurity,
        'relforcerowsecurity', tbl.relforcerowsecurity,
        'relacl', tbl.relacl::text,
        'columns', (
          SELECT coalesce(jsonb_agg(jsonb_build_array(
                   a.attname,
                   pg_catalog.format_type(a.atttypid, a.atttypmod),
                   a.attnotnull,
                   md5(pg_catalog.pg_get_expr(ad.adbin, ad.adrelid)))
                 ORDER BY a.attname COLLATE "C"), '[]'::jsonb)
          FROM pg_catalog.pg_attribute a
          LEFT JOIN pg_catalog.pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
          WHERE a.attrelid = tbl.oid AND a.attnum > 0 AND NOT a.attisdropped
        ),
        'constraints', (
          SELECT coalesce(jsonb_agg(jsonb_build_array(
                   co.conname,
                   md5(pg_catalog.pg_get_constraintdef(co.oid)))
                 ORDER BY co.conname COLLATE "C", md5(pg_catalog.pg_get_constraintdef(co.oid)) COLLATE "C"), '[]'::jsonb)
          FROM pg_catalog.pg_constraint co
          WHERE co.conrelid = tbl.oid
        ),
        'indexes', (
          SELECT coalesce(jsonb_agg(jsonb_build_array(
                   ic.relname,
                   md5(pg_catalog.pg_get_indexdef(i.indexrelid)))
                 ORDER BY ic.relname COLLATE "C"), '[]'::jsonb)
          FROM pg_catalog.pg_index i
          JOIN pg_catalog.pg_class ic ON ic.oid = i.indexrelid
          WHERE i.indrelid = tbl.oid
        ),
        'triggers', (
          SELECT coalesce(jsonb_agg(jsonb_build_array(
                   tg.tgname,
                   md5(pg_catalog.pg_get_triggerdef(tg.oid)),
                   tg.tgenabled::text)
                 ORDER BY tg.tgname COLLATE "C"), '[]'::jsonb)
          FROM pg_catalog.pg_trigger tg
          WHERE tg.tgrelid = tbl.oid AND NOT tg.tgisinternal
        ),
        'policies', (
          SELECT coalesce(jsonb_agg(jsonb_build_array(
                   po.policyname,
                   po.cmd,
                   to_jsonb(po.roles),
                   md5(po.qual),
                   md5(po.with_check),
                   po.permissive)
                 ORDER BY po.policyname COLLATE "C"), '[]'::jsonb)
          FROM pg_catalog.pg_policies po
          WHERE po.schemaname = tbl.nspname AND po.tablename = tbl.relname
        )
      ) AS j
    FROM tbl
  ) t
),
views AS (
  SELECT coalesce(jsonb_agg(v.j ORDER BY v.s COLLATE "C", v.n COLLATE "C"), '[]'::jsonb) AS j,
         count(*) AS c
  FROM (
    SELECT ns.nspname AS s, c.relname AS n,
      jsonb_build_object(
        'schema', ns.nspname,
        'name', c.relname,
        'kind', c.relkind::text,
        'def_md5', md5(pg_catalog.pg_get_viewdef(c.oid)),
        'relacl', c.relacl::text,
        'reloptions', to_jsonb(c.reloptions)
      ) AS j
    FROM pg_catalog.pg_class c
    JOIN ns ON ns.oid = c.relnamespace
    WHERE c.relkind IN ('v', 'm')
      AND NOT EXISTS (SELECT 1 FROM extmember e
                      WHERE e.classid = 'pg_catalog.pg_class'::pg_catalog.regclass AND e.objid = c.oid)
  ) v
),
sequences AS (
  SELECT coalesce(jsonb_agg(q.j ORDER BY q.s COLLATE "C", q.n COLLATE "C"), '[]'::jsonb) AS j,
         count(*) AS c
  FROM (
    SELECT ns.nspname AS s, c.relname AS n,
      jsonb_build_object(
        'schema', ns.nspname,
        'name', c.relname,
        'type', pg_catalog.format_type(sq.seqtypid, NULL),
        'start', sq.seqstart,
        'increment', sq.seqincrement,
        'min', sq.seqmin,
        'max', sq.seqmax,
        'cache', sq.seqcache,
        'cycle', sq.seqcycle,
        'relacl', c.relacl::text,
        'owned_by', (
          SELECT oc.relname || '.' || oa.attname || ':' || d.deptype::text
          FROM pg_catalog.pg_depend d
          JOIN pg_catalog.pg_class oc ON oc.oid = d.refobjid
          JOIN pg_catalog.pg_attribute oa ON oa.attrelid = d.refobjid AND oa.attnum = d.refobjsubid
          WHERE d.classid = 'pg_catalog.pg_class'::pg_catalog.regclass
            AND d.objid = c.oid
            AND d.refclassid = 'pg_catalog.pg_class'::pg_catalog.regclass
            AND d.refobjsubid > 0
            AND d.deptype IN ('a', 'i')
          ORDER BY (oc.relname || '.' || oa.attname || ':' || d.deptype::text) COLLATE "C"
          LIMIT 1
        )
      ) AS j
    FROM pg_catalog.pg_class c
    JOIN ns ON ns.oid = c.relnamespace
    JOIN pg_catalog.pg_sequence sq ON sq.seqrelid = c.oid
    WHERE c.relkind = 'S'
      AND NOT EXISTS (SELECT 1 FROM extmember e
                      WHERE e.classid = 'pg_catalog.pg_class'::pg_catalog.regclass AND e.objid = c.oid)
  ) q
),
types AS (
  SELECT coalesce(jsonb_agg(y.j ORDER BY y.s COLLATE "C", y.n COLLATE "C"), '[]'::jsonb) AS j,
         count(*) AS c
  FROM (
    SELECT ns.nspname AS s, t.typname AS n,
      jsonb_build_object(
        'schema', ns.nspname,
        'name', t.typname,
        'typtype', t.typtype::text,
        'enum_labels', CASE WHEN t.typtype = 'e' THEN (
          SELECT coalesce(jsonb_agg(e.enumlabel ORDER BY e.enumsortorder), '[]'::jsonb)
          FROM pg_catalog.pg_enum e WHERE e.enumtypid = t.oid) END,
        'attributes', CASE WHEN t.typtype = 'c' THEN (
          SELECT coalesce(jsonb_agg(jsonb_build_array(
                   a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod))
                 ORDER BY a.attnum), '[]'::jsonb)
          FROM pg_catalog.pg_attribute a
          WHERE a.attrelid = t.typrelid AND a.attnum > 0 AND NOT a.attisdropped) END,
        'domain', CASE WHEN t.typtype = 'd' THEN jsonb_build_object(
          'base', pg_catalog.format_type(t.typbasetype, t.typtypmod),
          'notnull', t.typnotnull,
          'default_md5', md5(t.typdefault),
          'constraints', (
            SELECT coalesce(jsonb_agg(jsonb_build_array(
                     co.conname, md5(pg_catalog.pg_get_constraintdef(co.oid)))
                   ORDER BY co.conname COLLATE "C"), '[]'::jsonb)
            FROM pg_catalog.pg_constraint co WHERE co.contypid = t.oid)) END,
        'range_subtype', CASE WHEN t.typtype = 'r' THEN (
          SELECT pg_catalog.format_type(r.rngsubtype, NULL)
          FROM pg_catalog.pg_range r WHERE r.rngtypid = t.oid) END,
        'typacl', t.typacl::text
      ) AS j
    FROM pg_catalog.pg_type t
    JOIN ns ON ns.oid = t.typnamespace
    LEFT JOIN pg_catalog.pg_class tc ON tc.oid = t.typrelid
    WHERE t.typtype IN ('e', 'c', 'd', 'r')
      AND (t.typtype <> 'c' OR tc.relkind = 'c')
      AND NOT EXISTS (SELECT 1 FROM extmember e
                      WHERE e.classid = 'pg_catalog.pg_type'::pg_catalog.regclass AND e.objid = t.oid)
  ) y
),
extensions AS (
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'name', x.extname,
           'schema', xn.nspname,
           'version', x.extversion)
         ORDER BY x.extname COLLATE "C"), '[]'::jsonb) AS j,
         count(*) AS c
  FROM pg_catalog.pg_extension x
  JOIN pg_catalog.pg_namespace xn ON xn.oid = x.extnamespace
),
schema_acls AS (
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'schema', ns.nspname,
           'nspacl', n.nspacl::text)
         ORDER BY ns.nspname COLLATE "C"), '[]'::jsonb) AS j,
         count(*) AS c
  FROM ns
  JOIN pg_catalog.pg_namespace n ON n.oid = ns.oid
),
storage_policies AS (
  SELECT coalesce(jsonb_agg(jsonb_build_array(
           po.tablename,
           po.policyname,
           po.cmd,
           to_jsonb(po.roles),
           md5(po.qual),
           md5(po.with_check),
           po.permissive)
         ORDER BY po.tablename COLLATE "C", po.policyname COLLATE "C"), '[]'::jsonb) AS j,
         count(*) AS c
  FROM pg_catalog.pg_policies po
  WHERE po.schemaname = 'storage' AND po.tablename IN ('objects', 'buckets')
),
storage_buckets AS (
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', b.id,
           'public', b.public,
           'file_size_limit', b.file_size_limit,
           'allowed_mime_types', to_jsonb(b.allowed_mime_types))
         ORDER BY b.id COLLATE "C"), '[]'::jsonb) AS j,
         count(*) AS c
  FROM storage.buckets b
),
cats AS (
  SELECT 'functions' AS k, j, c FROM functions
  UNION ALL SELECT 'tables', j, c FROM tables
  UNION ALL SELECT 'views', j, c FROM views
  UNION ALL SELECT 'sequences', j, c FROM sequences
  UNION ALL SELECT 'types', j, c FROM types
  UNION ALL SELECT 'extensions', j, c FROM extensions
  UNION ALL SELECT 'schema_acls', j, c FROM schema_acls
  UNION ALL SELECT 'storage_policies', j, c FROM storage_policies
  UNION ALL SELECT 'storage_buckets', j, c FROM storage_buckets
)
SELECT (
  SELECT jsonb_object_agg(k, j ORDER BY k COLLATE "C")
         || jsonb_build_object('summary',
              jsonb_object_agg(k, jsonb_build_object('count', c, 'md5', md5(j::text)) ORDER BY k COLLATE "C"))
  FROM cats
) AS fp
WHERE (
  SELECT pg_catalog.set_config('search_path', 'pg_catalog', true)
      || pg_catalog.set_config('TimeZone', 'UTC', true)
      || pg_catalog.set_config('DateStyle', 'ISO, MDY', true)
      || pg_catalog.set_config('IntervalStyle', 'postgres', true)
      || pg_catalog.set_config('extra_float_digits', '1', true)
      || pg_catalog.set_config('bytea_output', 'hex', true)
) IS NOT NULL;
