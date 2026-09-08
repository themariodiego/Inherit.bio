-- The checked read-observed branch performs exact file/chromosome/position
-- lookups, then paginates by source_line. Keep duplicate source observations
-- addressable without rescanning every observed call in a dense VCF source.
-- Owner, subject, source hash/version/build and all authority checks remain
-- predicates in the existing reader. No genetic payload is copied into INCLUDE.
create index report_observed_calls_file_locus_line_idx
 on public.report_observed_calls (file_id, chrom, pos, source_line);
