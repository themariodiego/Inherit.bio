-- Security hardening (Supabase advisor 0028/0029): the new-user trigger
-- function is not meant to be callable directly by clients. Revoke EXECUTE
-- so it is only invoked by the auth.users insert trigger.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- processing_time_stats() stays executable by anon/authenticated on purpose:
-- it returns only aggregate durations (no user rows), powering the honest
-- p50/p95 processing-time label. It is SECURITY DEFINER because it must read
-- across users to aggregate; the function body selects only counts and
-- percentiles, never user-identifying columns.
