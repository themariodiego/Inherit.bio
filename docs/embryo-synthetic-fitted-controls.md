# Invented fitted statistical controls

10 October 2026. A separate pure-source child of the frozen below-floor
producer. No native admission, worker, renderer, registry or installer imports
this package. It does not supply a public embryo finding or clinical result.

The immutable artifact is `data/embryo/test-statistical-fit-population.json`,
SHA-256 `5355327cfe90cda24ca2d27cd3afab2e53d26b5d6995b69cb296d3b975c6d408`.
Every record is invented. There are 64 training rows, 48 independent holdout
rows, 96 reference rows, 200 binary calibration controls and 32 arbitrary paired
controls. These pairs are not siblings. No human observation or published
sibling study is represented. Partition IDs are disjoint, and the complete
artifact must match; a subset, edited observation or extra authority field
refuses. The original ten-row panel and all clinical registries remain exact.

The source construction uses separate fixed LCG seeds recorded in the artifact.
For each training, holdout and paired row it draws ten doses in {0,1,2}, then
one noise draw. The invented outcome is the dot product of centered doses
with `[.31,-.27,.19,-.16,.13,.11,-.09,.08,.06,-.04]`, plus a uniform draw in
[-.2,.2), rounded to nine decimal places. Reference rows retain the ten doses
only. Calibration records use a separate uniform draw and an invented .22
event threshold. That threshold is a construction instruction; the baseline
point is calculated from all actual artifact events, not set to .22.

## Actual calculations

The pure module fits an intercept and ten centered coefficients by bounded,
full-rank ordinary least squares. It computes residuals and
`SSE / (n - p)`, and the complete coefficient covariance
`residualVariance * inverse(X'X)`. Singular or nonfinite inputs refuse.
The training set is not reused as holdout. The independent holdout supplies
`R² = 1 - SSE / SST`, and 256 deterministic resamples yield a labelled
percentile bootstrap interval. It is a finite invented-data diagnostic,
not validated human performance or a claim that its interval has clinical
coverage. The paired difference diagnostic remains separate from the public
within-family contract.

The invented reference supplies the full ten-by-ten sample covariance,
reference means and observed sample size. The calibration records supply a
combined-sex, lifetime toy baseline and strict Wilson bounds. The birth and
calibration cohort names explicitly identify invented controls. They do not
qualify any real population baseline.

For an internal own-call experiment, the existing complete source/panel matcher
first determines all ten row states. It accepts no parent or sibling calls.
Every missing, unreadable or disputed locus stays in the denominator. Below
.80, no experiment interval is produced. At/above the floor, readable own doses
are centered against the fixed reference; missing doses contribute zero
centered signal and their complete covariance submatrix to uncertainty. This
is not individual genotype imputation.

The toy log-liability center is the observed baseline logit plus the fitted
centered signal scaled by `sqrt(holdout R²)`. Four components are combined in
the brief's order:

1. Coefficient covariance plus the uncertainty in the square-root holdout
   performance scale, derived from its finite bootstrap interval.
2. Reference sampling variance, using the complete reference covariance and n.
3. Baseline logit variance derived from both Wilson bounds.
4. The covariance quadratic form for all missing own loci, including cross
   terms; no independence assumption replaces that submatrix.

The source sums these nonnegative components on the same scale and applies
one logistic transform to each endpoint. Unmeasured dropout widens the log
interval half-width by exactly1.5 before those transforms. The original
.95 call-rate, .05 contamination and .10 dropout boundaries are unchanged.
This recipe exercises finite math and propagation. It is not a calibrated
clinical predictor, liability-scale genetic validation or approved model.

## Authority remains absent

The package and experiment always return `publicationEligible: false` and
`clinicalRegistryEligible: false`. The experiment has `publicFinding: null`.
The public sibling contract remains `not_measured`, disabled by default,
with no numeric ratio, interval, family count or citation. Invented paired
metrics cannot change those fields.

The three partial-coverage route-state pairs remain unclosed. An actual native
and browser producer would need a separately reviewed reference/receipt design
and whole-source/currentness qualification, and a criterion requiring a
published human sibling citation cannot be satisfied by these invented data.
No native door is expanded here. No API, application, scientific acceptance
flag or production condition is enabled.

Authored pure controls check analytic OLS/covariance, full-data integrity,
holdout identity and actual metrics, unavailable sibling fields, strict data
and authority refusals, baseline arithmetic, all four components, inclusive
coverage/QC boundaries, actual own-call refusal and dropout widening. Actual
test outcomes are recorded separately; this document makes no execution claim.
