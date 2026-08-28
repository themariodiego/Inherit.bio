-- Structured shipping data for country filtering, exclusion notes, and the
-- verification summary produced during provider research.
alter table public.providers
  add column shipping jsonb not null default '{"mode":"worldwide","excluded":[]}'::jsonb,
  add column us_state_exclusion_notes text[] not null default '{}',
  add column verification_summary text,
  drop column ships_to_countries;
