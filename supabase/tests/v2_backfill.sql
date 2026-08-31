begin;
select plan(8);

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
