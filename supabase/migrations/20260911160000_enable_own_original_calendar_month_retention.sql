-- Turn on `source.original-calendar-month`, the one-calendar-month original
-- retention the product's own retention registry has registered since
-- 20260909001117 and which nothing has ever exercised: measured 2026-09-11,
-- `enabled` was false and `own_original_retirements` held zero rows against
-- 403 sources. Owner decision, 2026-09-11.
--
-- `applies_after` MOVES IN THE SAME STATEMENT, and that is the load-bearing
-- half rather than a tidy-up. `track_own_original_retirement_v1` skips a file
-- created before the boundary, but once a file is PAST it the function stops
-- skipping and starts raising: a missing or malformed Storage version, or a
-- source already older than a month, is `original_retention_unavailable`,
-- which aborts the prepared-manifest insert. The boundary has stood at the
-- table's own creation time since 20260909001117, so enabling alone would
-- admit every source published since then and turn an ordinary publication
-- into a failed one. Setting the boundary to now is what keeps this an opt-in
-- for new publications, exactly as the registry says: no existing-source
-- backfill and no quota reduction.
--
-- Nothing else changes. Retirement still deletes only the exact registered
-- original object/version, still requires the provider's own nonempty
-- acknowledgement, and still preserves verified prepared results through the
-- retirement receipt. An earlier withdrawal or deletion keeps its existing
-- stricter disposition.
update private.own_original_retention_config
 set enabled=true, applies_after=clock_timestamp()
 where singleton;

do $$
begin
 if not exists(select 1 from private.own_original_retention_config
  where singleton and enabled and applies_after is not null) then
  raise exception 'original retention did not enable';
 end if;
 -- The boundary must be at or after this migration, or the guarantee above is
 -- not the one this file claims to make.
 if exists(select 1 from private.own_original_retention_config
  where singleton and applies_after < clock_timestamp() - interval '1 minute') then
  raise exception 'original retention boundary was not moved to now';
 end if;
end $$;
