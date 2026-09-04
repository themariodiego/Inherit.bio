-- Runs of homozygosity, measured once at ingest and stored per file (D-030).
--
-- The carrier panel refuses its arithmetic unless each file, on its own,
-- is below the brief's thresholds (100 Mb of runs, F_ROH 0.0156; brief line
-- 1349). Measuring at request time from `user_variants` needed a read
-- budget that every real array or sequence file exceeds, so the branch was
-- unreachable. The processing route now measures the parsed calls it
-- already holds and writes the result here; readers never re-derive it.
--
-- `roh_status`: 'measured' or 'not_measurable'. `roh_reason` names why a
-- file is not measurable: 'no-autosomal-calls' (no autosomal call at all),
-- 'no-reference-calls' (no call homozygous for the reference, the shape of
-- a differences-only VCF, D-040), or 'no-runs-reported' (no autosomal
-- stretch at all, so no run could be reported and there is no denominator).
-- A run follows McQuillan et al. 2008 (doi:10.1016/j.ajhg.2008.08.007). `roh_total_bases` and `roh_fraction` are the two
-- quantities the thresholds apply to; `roh_covered_bases` is the autosomal
-- span the file covers, the denominator. All are null until processed.

alter table public.genome_files
  add column roh_status text
    check (roh_status is null or roh_status in ('measured', 'not_measurable')),
  add column roh_reason text
    check (roh_reason is null or roh_reason in ('no-runs-reported', 'no-autosomal-calls', 'no-reference-calls')),
  add column roh_total_bases bigint check (roh_total_bases is null or roh_total_bases >= 0),
  add column roh_covered_bases bigint check (roh_covered_bases is null or roh_covered_bases > 0),
  add column roh_fraction numeric(8, 6)
    check (roh_fraction is null or (roh_fraction >= 0 and roh_fraction <= 1)),
  add column roh_measured_at timestamptz,
  add constraint genome_files_roh_shape check (
    (roh_status is null and roh_reason is null and roh_total_bases is null
      and roh_covered_bases is null and roh_fraction is null and roh_measured_at is null)
    or (roh_status = 'measured' and roh_reason is null and roh_total_bases is not null
      and roh_covered_bases is not null and roh_fraction is not null and roh_measured_at is not null)
    or (roh_status = 'not_measurable' and roh_reason is not null and roh_total_bases is null
      and roh_covered_bases is null and roh_fraction is null and roh_measured_at is not null)
  );

comment on column public.genome_files.roh_fraction is
  'F_ROH of this one file: total run bases over the autosomal span the file covers. Never compared between files.';
