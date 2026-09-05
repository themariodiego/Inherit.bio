begin;
select plan(19);

insert into auth.users (id, email, raw_user_meta_data) values
  ('7c100000-0000-0000-0000-000000000001', 'prs-owner@example.invalid', '{}'),
  ('7c100000-0000-0000-0000-000000000002', 'prs-other@example.invalid', '{}');
insert into public.prs_scores (pgs_id, name, trait, n_variants, citation, source_url, ancestry_note)
values ('PGSOUTPUTFIXTURE', 'Fixture panel', 'Fixture', 50, '{}', 'https://example.invalid', 'Fixture');
insert into public.genome_files (id, user_id, subject_id, bucket_path, original_name, file_type, tier, size_bytes, status)
select '7c200000-0000-0000-0000-000000000001', owner_account_id, id,
  '7c100000-0000-0000-0000-000000000001/fixture', 'fixture.txt', 'array_ancestry', 1, 1, 'annotated'
from public.subjects where owner_account_id = '7c100000-0000-0000-0000-000000000001' and subject_class = 'self';
insert into public.user_prs (user_id, file_id, subject_id, pgs_id, raw_score, zscore, percentile, coverage, matched)
select user_id, id, subject_id, 'PGSOUTPUTFIXTURE', 7, 3, 99, 0.5, 25
from public.genome_files where id = '7c200000-0000-0000-0000-000000000001';

select is((select count(*) from public.user_prs where pgs_id = 'PGSOUTPUTFIXTURE'), 1::bigint, 'fixture has one stored calculation');
select ok((select relrowsecurity from pg_class where oid = 'public.user_prs'::regclass), 'row security remains enabled');
select ok(not has_table_privilege('authenticated', 'public.user_prs', 'select'), 'authenticated has no table-wide select');
select ok(not has_column_privilege('authenticated', 'public.user_prs', 'raw_score', 'select'), 'raw score inaccessible');
select ok(not has_column_privilege('authenticated', 'public.user_prs', 'zscore', 'select'), 'z-score inaccessible');
select ok(not has_column_privilege('authenticated', 'public.user_prs', 'percentile', 'select'), 'percentile inaccessible');
select ok(not has_column_privilege('authenticated', 'public.user_prs', 'coverage', 'select'), 'coverage fraction inaccessible');
select ok(has_column_privilege('authenticated', 'public.user_prs', 'matched', 'select'), 'matched count remains readable');
select ok(not has_any_column_privilege('anon', 'public.user_prs', 'select'), 'anonymous role has no column access');

set local role authenticated;
select set_config('request.jwt.claim.sub', '7c100000-0000-0000-0000-000000000001', true);
select is((select matched from public.user_prs where pgs_id = 'PGSOUTPUTFIXTURE'), 25, 'owner can read their coverage');
select throws_ok($$select raw_score from public.user_prs$$, '42501', null, 'owner cannot read raw score directly');
select throws_ok($$select zscore from public.user_prs$$, '42501', null, 'owner cannot read z-score directly');
select throws_ok($$select percentile from public.user_prs$$, '42501', null, 'owner cannot read percentile directly');
select throws_ok($$select * from public.user_prs$$, '42501', null, 'wildcard cannot bypass column restriction');
select throws_ok($$select matched from public.user_prs where percentile > 50$$, '42501', null, 'filtering cannot reveal hidden percentile');
select set_config('request.jwt.claim.sub', '7c100000-0000-0000-0000-000000000002', true);
select is((select count(matched) from public.user_prs where pgs_id = 'PGSOUTPUTFIXTURE'), 0::bigint, 'another account sees no coverage');

reset role;
set local role anon;
select throws_ok($$select matched from public.user_prs$$, '42501', null, 'anonymous caller cannot read coverage');
reset role;
set local role service_role;
select is((select raw_score::integer from public.user_prs where pgs_id = 'PGSOUTPUTFIXTURE'), 7, 'internal computation retains numeric read access');
select lives_ok($$update public.user_prs set percentile = 98 where pgs_id = 'PGSOUTPUTFIXTURE'$$, 'internal computation retains write access');
reset role;

select * from finish();
rollback;
