# The interval on an ancestry share

Closes the half of D-017 that was real. The other half — "the shipped panel
cannot tell EUR from AMR" — was measured on 2026-09-14 and did not reproduce;
see `docs/protocol/decisions.md` for that and `src/lib/genome/admixture.test.ts`
for the code that holds it.

## What the surface claims

`/genome/[subject]/ancestry` prints, once per claim block:

> The range is how far a share moves when your markers are drawn again and
> again. On test files Inherit made up, the true share fell inside it about
> nine times in ten.
>
> Those test files were people made only of these five regions. Real people are
> not, so the true share may fall inside less often.

"About nine times in ten" is **91.5%**. Both sentences render together and
neither is allowed to render alone: a coverage figure without the limit of the
test that produced it is the reassurance this product must not give.

## The method

A **pivotal (basic) bootstrap over markers**. Resample, with replacement, the
panel markers this file supplied; re-fit; then take

    low  = 2·q̂ − q*(97.5th percentile)
    high = 2·q̂ − q*(2.5th percentile)

clamped to [0, 1] and rounded to three decimals. 200 resamples
(`RANGE_RESAMPLES`), from a constant seed, so one file always produces one
interval.

**Not the percentile method, and this is the whole design decision.** At 168
markers the estimator is biased inward: a simulated person who is entirely one
population comes back at about 0.95, and the percentile interval around 0.95
contained the true 1.000 in **0 of 30** seeds. The percentile method has no
mechanism for bias; the pivotal form reflects the replicate spread *through*
the estimate, which is exactly a bias correction. Measured side by side on five
truths at 30 seeds and 150 resamples:

| method | coverage | mean width |
| --- | --- | --- |
| percentile, resampling markers | 76.7% | 0.163 |
| **pivotal, resampling markers** | **95.7%** | **0.093** |
| percentile, simulating from the fit | 80.3% | 0.196 |
| pivotal, simulating from the fit | 95.1% | 0.094 |

The pivotal forms win on both axes and the two resampling schemes are
indistinguishable, so the cheaper one ships.

A population whose resamples all agreed carries **no interval at all** rather
than a zero-width one. "0% to 0%" states a certainty no measurement produced;
26% of region-estimates in the run below are in that position, almost all of
them shares the fit put at exactly zero.

## The measurement

```
node --import tsx scripts/ancestry-interval/measure.mts 60
```

Run against the shipped `estimateAdmixture` on 2026-09-14. 48 mixtures — each
population alone, every pair of eight at splits of 5/10/20/35/50%, and three
three-way mixes — at 60 draws each.

```
48 mixtures x 60 draws over 168 markers
14400 region-estimates

share shown        estimates   range held it   mean width   mean |share - truth|
0                      5807          94.9%        0.000                  0.005
0 to 5%                2168          89.3%        0.039                  0.026
5 to 15%               1621          90.1%        0.179                  0.078
15 to 35%              1311          86.2%        0.363                  0.116
35 to 70%              1887          93.1%        0.404                  0.091
70 to 100%             1606          86.4%        0.201                  0.059

overall                14400          91.5%        0.135
```

**Banded by the share the page shows, not by the truth.** That is the
conditioning a reader lives under: they see a number and want to know how often
the range around *that* holds. Banding by the truth answers a question nobody
can ask at run time, and it looks much worse — 47% in the 0–5% band — because
it pools every draw whose estimate landed somewhere else entirely.

## What this does not establish

- **The simulation is the estimator's own assumption.** Each made-up person is
  a mixture of exactly these five references drawn at exactly this panel's
  frequencies. Real people are not, so 91.5% is an upper bound. The surface
  says so in the second sentence rather than in this file.
- **Nominal is 95%; measured is 91.5%.** The weakest band, a shown share
  between 15% and 35%, is 86.2%. Nothing anywhere claims the nominal level.
- **Widening to reach 95% was measured and rejected.** Inflating every interval
  by 1.5x reaches 94.7% overall, at the cost of a 50% share reading "21% to
  79%". The factor is fitted, not derived, and the width makes the map useless;
  the honest figure is the measured one.
- **No real genetic file was used.** Nothing here reads one.

## The width is a panel problem, not an interval problem

The estimator is consistent: the bias shrinks as markers rise, so the interval
is wide because 168 markers cannot pin a share down, not because the method is
loose. Mean estimate for a truth of 1.000, over 25 seeds, replicating the panel
for independent draws:

| markers | 168 | 336 | 672 | 1,344 | 2,688 | 5,376 |
| --- | --- | --- | --- | --- | --- | --- |
| entirely EUR | 0.948 | 0.953 | 0.971 | 0.984 | 0.991 | 0.993 |
| entirely SAS | 0.897 | 0.923 | 0.950 | 0.968 | 0.979 | 0.989 |

So the remedy for the width is a larger ancestry-informative panel, which is
the expensive option D-017 already names and which remains the owner's call.
Until then the range says how little this panel can tell, which is worth more
than a single number that says nothing.

## Cost

200 resamples cost about 0.4 s per file, once, at the full 168 markers.
Measured over 6 truths at 40 seeds: coverage 94.7% at 100 resamples, 94.6% at
200 and 94.8% at 400, with mean width 0.096 at all three — so the count buys
stability in the tail quantiles and nothing else, and 200 is where it stops
paying (~212 ms at 100, ~410 ms at 200, ~803 ms at 400).

Below the panel's own reliability floor (42 of 168 markers) no interval is
computed: the surface shows no map there, and a spread around a number nobody
is shown is not worth 0.4 s.

## Where it is enforced

- `src/lib/genome/admixture.ts` — the estimator and the interval.
- `src/lib/uploads/own-ancestry-content.ts` — the captured shape, where
  `ranges` is optional because results captured before 2026-09-14 have none.
- `supabase/migrations/20260914120000_ancestry_share_ranges.sql` — the closed
  content contract. The database refused the new field until asked, which is
  what a closed contract is for; ten pgTAP assertions in
  `supabase/tests/canonical_own_ancestry_generation.sql` hold the rules.
- `src/app/(app)/genome/[subject]/ancestry/page.tsx` — a stored interval that
  is reversed, out of bounds, or does not bracket its own share is dropped
  rather than rendered.
- `e2e/ancestry.spec.ts` — the browser proof that shares carry a measured range
  and that both sentences render.
