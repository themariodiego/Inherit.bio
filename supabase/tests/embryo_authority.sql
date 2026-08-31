begin;
select plan(7);

insert into public.embryo_cohort_drafts (
  id, owner_account_id, uploader_principal_id, upload_class, basis_case,
  embryo_count, state, fixed_expires_at
)
select
  '30000000-0000-0000-0000-000000000003',
  '10000000-0000-0000-0000-000000000001',
  sp.id,
  'embryo_own',
  'true_two_parent',
  1,
  'ready',
  clock_timestamp() + interval '30 days'
from public.subject_principals sp
where sp.account_id = '10000000-0000-0000-0000-000000000001'
  and sp.principal_kind = 'account_subject';

insert into public.embryo_cohorts (
  id, draft_id, owner_account_id, upload_class, basis_case,
  basis_revision, participant_set_revision, donor_attribution_revision,
  embryo_count, retention_expires_at
)
values (
  '40000000-0000-0000-0000-000000000004',
  '30000000-0000-0000-0000-000000000003',
  '10000000-0000-0000-0000-000000000001',
  'embryo_own', 'true_two_parent', 1, 1, 1, 1,
  clock_timestamp() + interval '30 days'
);

insert into public.subjects (
  id, owner_account_id, subject_class, upload_class,
  display_label, lifecycle, cohort_id
)
values (
  '50000000-0000-0000-0000-000000000005',
  '10000000-0000-0000-0000-000000000001',
  'embryo', 'embryo_own', 'Embryo 1', 'active',
  '40000000-0000-0000-0000-000000000004'
);

insert into public.embryos (
  id, cohort_id, subject_id, sample_ordinal, retention_expires_at
)
values (
  '60000000-0000-0000-0000-000000000006',
  '40000000-0000-0000-0000-000000000004',
  '50000000-0000-0000-0000-000000000005',
  0,
  clock_timestamp() + interval '30 days'
);

select is(
  (select display_label from public.embryos where id = '60000000-0000-0000-0000-000000000006'),
  'Embryo 1',
  'embryo labels are generated from neutral ordinals'
);

select throws_ok(
  $$insert into public.subject_demographics (subject_id, chromosomal_sex)
    values ('50000000-0000-0000-0000-000000000005', 'XX')$$,
  '23514',
  'embryo demographics are forbidden',
  'embryo demographics are rejected'
);

select lives_ok(
  $$insert into public.embryo_variants (
      embryo_id, chromosome, position, genotype, source_binding_fingerprint
    ) values (
      '60000000-0000-0000-0000-000000000006', 22, 100, 'A/G', repeat('a', 64)
    )$$,
  'autosomal embryo variants are accepted'
);

select throws_ok(
  $$insert into public.embryo_variants (
      embryo_id, chromosome, position, genotype, source_binding_fingerprint
    ) values (
      '60000000-0000-0000-0000-000000000006', 23, 100, 'A/G', repeat('b', 64)
    )$$,
  '23514',
  null,
  'non-autosomal embryo variants are rejected'
);

select lives_ok(
  $$insert into public.embryo_scores (
      embryo_id, condition_id, condition_name, finding, evidence_label,
      coverage_state, citation_ids, source_binding_fingerprint, computation_revision
    ) values (
      '60000000-0000-0000-0000-000000000006', 'fixture', 'Fixture condition',
      '{"kind":"absolute_risk","value":0.1}'::jsonb, 'established',
      'covered', array['fixture-citation'], repeat('c', 64), 1
    )$$,
  'closed valid embryo finding is accepted'
);

select throws_ok(
  $$insert into public.embryo_scores (
      embryo_id, condition_id, condition_name, finding, evidence_label,
      coverage_state, source_binding_fingerprint, computation_revision
    ) values (
      '60000000-0000-0000-0000-000000000006', 'forbidden', 'Forbidden field',
      '{"kind":"absolute_risk","sex":"XX"}'::jsonb, 'established',
      'covered', repeat('d', 64), 1
    )$$,
  '23514',
  null,
  'sex fields are rejected from embryo findings'
);

select is(
  has_table_privilege('authenticated', 'public.embryo_scores', 'select'),
  false,
  'embryo findings remain closed to authenticated clients by default'
);

select * from finish();
rollback;
