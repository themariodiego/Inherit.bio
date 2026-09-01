begin;
select plan(8);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('10000000-0000-0000-0000-000000000001', 'migration-a@example.invalid', '{"display_name":"Migration A"}'),
  ('20000000-0000-0000-0000-000000000002', 'migration-b@example.invalid', '{"display_name":"Migration B"}');

delete from public.subject_relationships;
delete from public.subject_account_bindings;
delete from public.subject_principals;
delete from public.subjects;

insert into public.subjects (
  id, owner_account_id, subject_account_id, subject_class, upload_class,
  display_label, lifecycle
)
values
  ('13000000-0000-0000-0000-000000000013', '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'self', 'self', 'Migration A', 'active'),
  ('23000000-0000-0000-0000-000000000023', '20000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'self', 'self', 'Migration B', 'active');

insert into public.subject_principals (
  id, subject_id, account_id, principal_kind, principal_revision, status
)
values
  ('14000000-0000-0000-0000-000000000014', '13000000-0000-0000-0000-000000000013', '10000000-0000-0000-0000-000000000001', 'account_subject', 1, 'active'),
  ('24000000-0000-0000-0000-000000000024', '23000000-0000-0000-0000-000000000023', '20000000-0000-0000-0000-000000000002', 'account_subject', 1, 'active');

insert into public.genome_files (
  id, user_id, subject_id, bucket_path, original_name, file_type, tier,
  size_bytes, sha256, status, build, variant_count
)
values
  ('11000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000013', '10000000-0000-0000-0000-000000000001/a.txt', 'a.txt', 'array_23andme', 1, 100, repeat('a', 64), 'annotated', 'GRCh37', 2),
  ('22000000-0000-0000-0000-000000000022', '20000000-0000-0000-0000-000000000002', '23000000-0000-0000-0000-000000000023', '20000000-0000-0000-0000-000000000002/b.txt', 'b.txt', 'array_ancestry', 1, 100, repeat('b', 64), 'annotated', 'GRCh37', 2);

insert into public.user_variants (
  user_id, file_id, subject_id, rsid, chrom, pos, ref, alt, genotype
)
values
  ('10000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000011', '13000000-0000-0000-0000-000000000013', 1, 1, 101, 'A', 'G', 'A/G'),
  ('20000000-0000-0000-0000-000000000002', '22000000-0000-0000-0000-000000000022', '23000000-0000-0000-0000-000000000023', 2, 2, 202, 'C', 'T', 'C/T'),
  ('10000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000011', '13000000-0000-0000-0000-000000000013', 3, 3, 303, 'G', 'A', 'G/G'),
  ('20000000-0000-0000-0000-000000000002', '22000000-0000-0000-0000-000000000022', '23000000-0000-0000-0000-000000000023', 4, 4, 404, 'T', 'C', 'T/T');

insert into public.ancestry_results (
  user_id, file_id, subject_id, kind, result, support_note
)
values
  ('10000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000011', '13000000-0000-0000-0000-000000000013', 'admixture', '{"fixture":"a"}', 'fixture a'),
  ('20000000-0000-0000-0000-000000000002', '22000000-0000-0000-0000-000000000022', '23000000-0000-0000-0000-000000000023', 'admixture', '{"fixture":"b"}', 'fixture b');

insert into public.prs_scores (
  pgs_id, name, trait, n_variants, citation, source_url, ancestry_note
)
values ('PGSFIXTURE', 'Fixture score', 'Fixture', 1, '{}', 'https://example.invalid', 'fixture only');

insert into public.user_prs (
  user_id, file_id, subject_id, pgs_id, raw_score, zscore, percentile,
  coverage, matched
)
values
  ('10000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000011', '13000000-0000-0000-0000-000000000013', 'PGSFIXTURE', 1, 0, 50, 1, 1),
  ('20000000-0000-0000-0000-000000000002', '22000000-0000-0000-0000-000000000022', '23000000-0000-0000-0000-000000000023', 'PGSFIXTURE', 2, 1, 84, 1, 1);

select is((select count(*) from public.subjects where subject_class = 'self'), 2::bigint,
  'one self subject exists per baseline account');
select is((select count(*) from public.subject_principals where principal_kind = 'account_subject'), 2::bigint,
  'one account-subject principal exists per baseline account');
select is((select count(*) from public.genome_files where subject_id is not null), 2::bigint,
  'all baseline genome files are attributed');
select is((select count(*) from public.user_variants where subject_id is not null), 4::bigint,
  'all interleaved variants are attributed');
select is((select count(*) from public.ancestry_results where subject_id is not null), 2::bigint,
  'all ancestry results are attributed');
select is((select count(*) from public.user_prs where subject_id is not null), 2::bigint,
  'all PRS results are attributed');
select is((
  select count(*)
  from public.user_variants uv
  join public.subjects s on s.id = uv.subject_id
  where s.owner_account_id is distinct from uv.user_id
), 0::bigint, 'no variant crosses account attribution');
select is((
  select count(*)
  from public.genome_files gf
  join public.subjects s on s.id = gf.subject_id
  where s.owner_account_id is distinct from gf.user_id
), 0::bigint, 'no file crosses account attribution');

select * from finish();
rollback;
