-- A completed synthetic embryo upload: the signed two-parent cohort of three
-- embryos from embryo_cohort_pre_finalize.inc, its minted attempt configured
-- as a GRCh38 VCF through the configure transaction (which issues the one
-- completion nonce), two stored chunks of three fragments each whose objects
-- landed through the write fence, and the completion that queued one
-- split_cohort_vcf job. Fragment digests are digests of fixed strings, not of
-- any genome; object rows are metadata only, written as Storage writes them.
\ir embryo_cohort_pre_finalize.inc

create temporary table minted as select private.finalize_embryo_cohort_ingest_v1(
  '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
  (select draft_id from draft),(select insurance from acks),(select charter from acks),
  'nonce-split-fixture-finalize','http://localhost:3000',true) as body;
create temporary table live as select s.* from public.embryo_ingest_sessions s
  where s.id=(select (body->'ingest'->>'session')::uuid from minted);
select is(private.configure_embryo_vcf_ingest_v1(
  '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
  (select id from live),(select cookie_hash from live),'http://localhost:3000',
  (select cohort_id from live),(select ingest_revision from live),'GRCh38',3,
  'nonce-split-fixture-configure',repeat('W',43),'nonce-split-fixture-complete','nonce-split-fixture-csrf',true)->>'status',
  'configured','fixture: the attempt records a VCF format, a header-derived build and a completion nonce');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
-- Metadata-only tests land fragments on the Supabase backend when the
-- fragment store's configuration exists. Canonical parts always go to R2, so
-- a synthetic bucket name is configured for them.
do $$ begin
  if to_regclass('private.embryo_ingest_object_config') is not null then
    execute 'update private.embryo_ingest_object_config set provider=''supabase'',r2_bucket=''inherit-embryo-synthetic''';
  end if;
end $$;

create function pg_temp.fixture_chunk(p_sequence integer) returns text language plpgsql as $$
declare r jsonb; v_sha text := encode(extensions.digest('synthetic-chunk:'||p_sequence,'sha256'),'hex');
begin
  r:=private.reserve_embryo_ingest_chunk_v1((select id from live),p_sequence,v_sha,400,12,120,
    (select jsonb_agg(jsonb_build_object('ordinal',o,
      'sha256',encode(extensions.digest('synthetic-fragment:'||p_sequence||':'||o,'sha256'),'hex'),
      'bytes',80+o,'lines',4) order by o) from generate_series(0,2) o));
  insert into storage.objects(bucket_id,name,version,metadata)
    select f.bucket_id,f.object_name,gen_random_uuid()::text,jsonb_build_object('size',f.byte_count)
    from public.embryo_ingest_fragments f
    where f.session_id=(select id from live) and f.sequence=p_sequence;
  return private.commit_embryo_ingest_chunk_v1((select id from live),p_sequence,v_sha)->>'status';
end $$;
select is(pg_temp.fixture_chunk(0),'stored','fixture: chunk 0 is stored');
select is(pg_temp.fixture_chunk(1),'stored','fixture: chunk 1 is stored');

create temporary table completed as select private.complete_embryo_ingest_v1(
  '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
  (select id from live),(select cookie_hash from live),'http://localhost:3000',
  (select cohort_id from live),(select ingest_revision from live),2,
  'nonce-split-fixture-complete',true) as body;
select is((select body->>'status' from completed),'sanitization_pending',
  'fixture: the upload completes into one queued sanitization job');
create temporary table job as select w.* from public.worker_jobs w
  where w.id=(select (body->>'jobId')::uuid from completed);

-- Reserve and land every canonical part of one embryo, the way the worker
-- does after a pass: one part per fragment, each ACKed with a synthetic
-- provider identity and the size and digest the receipt names. A part this
-- attempt already reserved is left as it is. Returns the number landed.
create function pg_temp.land_parts(p_ordinal integer,p_token text,p_attempt integer default 1)
returns integer language plpgsql as $$
declare f record; t jsonb; n integer:=0;
begin
  for f in select x.sequence from public.embryo_ingest_fragments x
    where x.session_id=(select id from live) and x.sample_ordinal=p_ordinal and not exists (
      select 1 from private.embryo_canonical_parts p where p.worker_job_id=(select id from job)
        and p.attempt=p_attempt and p.sample_ordinal=p_ordinal and p.sequence=x.sequence)
    order by x.sequence loop
    t:=public.reserve_embryo_canonical_part_v1((select id from job),p_attempt,p_token,p_ordinal,f.sequence);
    perform public.ack_embryo_canonical_part_v1((select id from job),p_attempt,p_token,(t->>'sessionId')::uuid,
      (t->>'sequence')::integer,(t->>'ordinal')::integer,t,md5('version:'||(t->>'objectKey')),
      md5('etag:'||(t->>'objectKey')),t->>'sha256',(t->>'byteCount')::bigint);
    n:=n+1;
  end loop;
  return n;
end $$;
