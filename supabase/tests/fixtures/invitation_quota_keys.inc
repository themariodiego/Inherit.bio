-- Invitation RPCs require the securityRateLimitContract bucket digests the
-- application derives (global-contact-refusal-bar-v1.quotaAuthority). A suite
-- that is not about quotas gets fresh random digests on every call, so its
-- invitations never share a bucket with each other or with any other suite.
-- The quota itself is exercised by supabase/tests/invitation_attempt_quotas.sql.
create or replace function pg_temp.invitation_quota_keys()
returns jsonb language sql volatile as $$
  select jsonb_build_object('1', jsonb_build_object(
    'authenticated-principal', encode(extensions.gen_random_bytes(32), 'hex'),
    'source-network', encode(extensions.gen_random_bytes(32), 'hex')));
$$;
