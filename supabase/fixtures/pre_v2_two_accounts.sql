-- Two interleaved v1 accounts used to prove the v2 attribution backfill.

insert into auth.users (id, email, raw_user_meta_data)
values
  ('10000000-0000-0000-0000-000000000001', 'migration-a@example.invalid', '{"display_name":"Migration A"}'),
  ('20000000-0000-0000-0000-000000000002', 'migration-b@example.invalid', '{"display_name":"Migration B"}');

update public.profiles
set display_name = case id
  when '10000000-0000-0000-0000-000000000001'::uuid then 'Migration A'
  when '20000000-0000-0000-0000-000000000002'::uuid then 'Migration B'
end
where id in (
  '10000000-0000-0000-0000-000000000001'::uuid,
  '20000000-0000-0000-0000-000000000002'::uuid
);

insert into public.genome_files (
  id, user_id, bucket_path, original_name, file_type, tier, size_bytes,
  sha256, status, build, variant_count
)
values
  (
    '11000000-0000-0000-0000-000000000011',
    '10000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001/a.txt',
    'a.txt', 'array_23andme', 1, 100,
    repeat('a', 64), 'annotated', 'GRCh37', 2
  ),
  (
    '22000000-0000-0000-0000-000000000022',
    '20000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000002/b.txt',
    'b.txt', 'array_ancestry', 1, 100,
    repeat('b', 64), 'annotated', 'GRCh37', 2
  );

insert into public.user_variants (user_id, file_id, rsid, chrom, pos, ref, alt, genotype)
values
  ('10000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000011', 1, 1, 101, 'A', 'G', 'A/G'),
  ('20000000-0000-0000-0000-000000000002', '22000000-0000-0000-0000-000000000022', 2, 2, 202, 'C', 'T', 'C/T'),
  ('10000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000011', 3, 3, 303, 'G', 'A', 'G/G'),
  ('20000000-0000-0000-0000-000000000002', '22000000-0000-0000-0000-000000000022', 4, 4, 404, 'T', 'C', 'T/T');

insert into public.ancestry_results (user_id, file_id, kind, result, support_note)
values
  ('10000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000011', 'admixture', '{"fixture":"a"}', 'fixture a'),
  ('20000000-0000-0000-0000-000000000002', '22000000-0000-0000-0000-000000000022', 'admixture', '{"fixture":"b"}', 'fixture b');

insert into public.prs_scores (
  pgs_id, name, trait, n_variants, citation, source_url, ancestry_note
)
values ('PGSFIXTURE', 'Fixture score', 'Fixture', 1, '{}', 'https://example.invalid', 'fixture only');

insert into public.user_prs (
  user_id, file_id, pgs_id, raw_score, zscore, percentile, coverage, matched
)
values
  ('10000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000011', 'PGSFIXTURE', 1, 0, 50, 1, 1),
  ('20000000-0000-0000-0000-000000000002', '22000000-0000-0000-0000-000000000022', 'PGSFIXTURE', 2, 1, 84, 1, 1);
