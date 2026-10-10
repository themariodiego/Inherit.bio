begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- G8.5: genomes-staging is gone, and nothing live still depends on it.
-- 20260930140000_drop_genomes_staging_bucket.sql refuses to run while the
-- bucket holds anything, so on a fresh database this is its whole effect.

select is((select count(*) from storage.buckets where id='genomes-staging'),0::bigint,'the genomes-staging bucket is gone');
select set_eq('select id from storage.buckets',array['genomes','exports','future-person-identity','legal-evidence'],
 'the exact surviving buckets include private claim identity and sealed legal evidence');
select ok((select not public and name='legal-evidence' and file_size_limit=20000028
 and allowed_mime_types=array['application/octet-stream'] from storage.buckets
 where id='legal-evidence'),'legal evidence stays private with its exact sealed-byte configuration');
select is_empty($$select policyname from pg_policies where schemaname='storage' and tablename='objects'
 and (coalesce(qual,'')||coalesce(with_check,'')) like '%legal-evidence%'$$,
 'no user Storage policy grants access to legal evidence');
select is((select column_default from information_schema.columns where table_schema='public' and table_name='upload_sessions'
 and column_name='storage_bucket'),'''genomes''::text','a session that omits its bucket names genomes, which exists');
select ok((select allowed_mime_types is null and not public from storage.buckets where id='genomes'),'genomes is unchanged');

-- No policy or live function body still names the dropped bucket. The account
-- manifest builder now preserves exact current Storage identity without a
-- retired-bucket literal, so its former exception is no longer appropriate.
select is_empty($$select policyname from pg_policies where schemaname='storage'
 and (coalesce(qual,'')||coalesce(with_check,'')) like '%genomes-staging%'$$,'no storage policy names the dropped bucket');
select is_empty($$select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','private') and p.prosrc like '%genomes-staging%'$$,
 'no live function names the retired staging bucket');

-- The one surviving upload path cannot reach it: every token-bearing
-- session must name genomes.
select ok((select pg_get_constraintdef(oid) like '%(token_jti IS NULL) OR ((storage_bucket = ''genomes''::text)%'
 from pg_constraint where conname='upload_sessions_token_snapshot_check'),
 'a token-bearing upload session can name only genomes');

select * from finish();
rollback;
