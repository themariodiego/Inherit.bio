-- The analytic PRS values are internal computations, not validated personal
-- score/risk outputs. RLS controls rows, not columns; keep these values out
-- of direct REST/GraphQL access as well as the application serializers.
-- Existing service-role processing/export reads remain available.
revoke select on table public.user_prs from public, anon, authenticated;
revoke select (
  id, user_id, file_id, subject_id, pgs_id, matched, computed_at,
  raw_score, zscore, percentile, coverage
) on table public.user_prs from public, anon, authenticated;

grant select (
  id, user_id, file_id, subject_id, pgs_id, matched, computed_at
) on table public.user_prs to authenticated;

-- Do not alter the existing ownership RLS policy or remove stored data.
notify pgrst, 'reload schema';
