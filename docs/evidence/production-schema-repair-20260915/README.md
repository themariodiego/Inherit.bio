# Production schema reconciliation — 15 September 2026

The `www.inherit.bio` deployment was independently verified READY at
`75729f070603334975ab08d211bb16fbac6b053b` before this repair. The exact SHA
is recorded in the adjacent receipt; deployment identity and schema are
separate checks.

Two already-merged migrations were absent from the Inherit Supabase project:
`20260914080000_declared_chromosomal_sex.sql` and
`20260914120000_ancestry_share_ranges.sql`. Their exact committed SQL bodies
were independently reviewed and applied through the migration API. The hosted
runner assigned execution timestamps while preserving their migration names.
Name-based reconciliation then found all 109 repository migrations plus one
recorded operator migration, with no missing repository migration.

The adjacent receipt contains the live function hashes, owner/search path/ACL
checks and security-advisor comparison. All three function bodies matched the
committed files; browser and restricted-upload roles cannot execute them, and
service-role access is retained. Advisors showed the same 150 informational and
two existing warning findings, with no error-level findings.

Synthetic verification: four valid and twelve invalid ancestry captures behaved
as expected. Seventeen scoped declaration checks passed in a transaction that
was rolled back; eight scoped inventories showed zero residual fixture rows.
The first declaration fixture lacked a required embryo cohort and was rejected
before assertions; adding that legitimate fixture prerequisite allowed the
unchanged checks to execute. No real customer genetic records were used, no
external messages were sent, and no unrelated data was deleted.

This reconciles the schema for the existing deployment. It does not verify the
subsequent seven-region migration, a new browser release, hosted WGS capacity or
retention delivery.
