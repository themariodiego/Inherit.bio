-- Read-only release check. Require true immediately before merging D-081 retirement.
-- Public cutover: PR #118 (e06b0a9c), successful production deployment
-- 6421907003 at 2026-09-13T13:11:24Z. No user dates, hashes or counts are returned.
-- Conservatively includes every pre-cutover adult invitation regardless of status.
select not exists (
  select 1 from public.subject_invitations
  where invitation_kind = 'adult_subject'
    and created_at <= timestamptz '2026-09-13 13:11:24+00'
    and expires_at > clock_timestamp()
) as no_unexpired_pre_cutover_invitations;
