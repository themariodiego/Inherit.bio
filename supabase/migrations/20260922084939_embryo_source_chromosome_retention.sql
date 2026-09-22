-- Owner direction, 22 September 2026: retain observed X/Y DNA calls in embryo
-- sources. This changes source retention, not sex inference or result shapes.
-- No policy, grant, subject binding, metadata or consent boundary is widened.
alter table public.embryo_variants
  drop constraint embryo_variants_chromosome_check,
  add constraint embryo_variants_chromosome_check check (chromosome between 1 and 24);

-- Keep the early path for allowed chromosomes; a disallowed chromosome still
-- checks the subject class so self/adult normalization retains its behavior.
-- CREATE OR REPLACE preserves the function's existing ownership and grants.
create or replace function private.enforce_subject_variant_chromosome()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.chrom not between 1 and 24 then
    if exists (
      select 1 from public.subjects s
      where s.id = new.subject_id and s.subject_class = 'embryo'
    ) then
      raise exception using errcode = '23514', message = 'unsupported embryo source chromosome';
    end if;
  end if;
  return new;
end;
$$;

-- Keep the deployed trigger name for dependency compatibility. Its new rule
-- is pinned by embryo_authority.sql and own_normalization_capacity_budget.sql.
