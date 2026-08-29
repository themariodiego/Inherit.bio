# ADR-0003 — No imputation in v1

- Status: **Accepted** · 2026-08-28

## Decision

Inherit v1 performs **no genotype imputation**. Array-file reports are
limited to variants the chip actually genotyped; everything else renders the
honest "your file does not cover this variant" state. Coverage is always a
number (per file, per PRS), never a slogan.

## Rationale

Imputation done properly needs phased reference panels and real pipelines
(Beagle/IMPUTE-class), far outside serverless limits (ADR-0001) and easy to
get silently wrong. The incumbent pattern — implying whole-genome insight
from array data — is exactly the coverage inflation this project bans
(Section 1 legal requirement 4).

## Revisiting

Only via a superseding ADR **with a real implementation** (worker-based
imputation stage with published accuracy on GIAB truth data), never by copy
change.
