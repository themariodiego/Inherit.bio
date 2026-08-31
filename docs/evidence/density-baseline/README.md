# Density baseline evidence

This directory freezes the first-viewport evidence for baseline commit
`864736979c92a08ba77e8580d61946eba6864918`. The capture used only a clean
`git archive` of that commit, a loopback Next.js production server, and the
deterministic synthetic Supabase protocol fixture in
`scripts/density-baseline/supabase-fixture.mjs`. It did not read production
data, contact Supabase, or mutate any cloud service.

## Frozen environment

- macOS 26.5.1 (25F80), Darwin 25.5.0, arm64
- Node.js 22.17.0
- pnpm 10.33.0 from the baseline `packageManager` field
- Next.js 16.3.3
- Playwright 1.62.1
- Google Chrome 151.0.7922.175
- Browser locale `en-US`, timezone `UTC`, light theme, DPR 1
- Exact viewports: 390×844 and 1280×800 CSS pixels
- Service workers blocked; reduced motion enabled
- Fixture clock: `2026-08-31T12:00:00.000Z`

The final capture was generated with this exact command from the repository
root:

```sh
DENSITY_WORKING_ROOT=/private/tmp/inherit-density-baseline-final4 \
DENSITY_OUTPUT_ROOT=/private/tmp/inherit-density-baseline-final4/evidence \
scripts/density-baseline/reproduce.sh
```

`reproduce.sh` performs these steps without relying on the current working
tree's application files:

1. `git archive --format=tar 864736979c92a08ba77e8580d61946eba6864918`
   into a fresh checkout.
2. `corepack pnpm install --frozen-lockfile` in that checkout.
3. `corepack pnpm build` with the environment below.
4. `corepack pnpm start -p 3102` for the archived checkout.
5. Start the fixture on `127.0.0.1:3100`, proxying non-Supabase requests to
   `127.0.0.1:3102`.
6. Run `capture.mjs` and `compute.mjs` against `127.0.0.1:3100`.

The exact build and runtime environment is:

```text
CI=1
NODE_ENV=production
NEXT_TELEMETRY_DISABLED=1
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3100
NEXT_PUBLIC_SUPABASE_ANON_KEY=density-baseline-anon-key
SUPABASE_SERVICE_ROLE_KEY=density-baseline-service-role-key
INHERIT_STUB_PORT=3100
INHERIT_NEXT_ORIGIN=http://127.0.0.1:3102
INHERIT_DENSITY_FIXED_TIME=2026-08-31T12:00:00.000Z
```

## Evidence and verification

- `capture-manifest.json` is the raw DOM/browser measurement output.
- `computed-measurements.json` is the independently recomputed pixel and DOM
  record consumed by `docs/density-baseline.json`.
- `screenshots/` contains the 44 immutable PNG first viewports. Each path and
  full SHA-256 appears beside its measurement in the baseline document.
- All harness and evidence-file paths and full SHA-256 values are recorded in
  `docs/density-baseline.json`.

Run the independent verifier from the repository root:

```sh
DENSITY_REQUIRE_CURRENT_SOURCE_IDENTITY=1 \
node scripts/density-baseline/verify.mjs
```

The current-source check is intentionally optional: it proves X0.3 before UI
work starts, but must be omitted after the post-change implementation begins.
The verifier always checks the immutable baseline commit, full Git tree, `src`
tree, fixture inputs, every PNG, every recorded measurement, and every durable
artifact hash. It also reruns the pixel computation and requires byte-for-byte
equality with `computed-measurements.json`.

## Canonical manifest hash algorithm

Template and PRS manifest hashes are independent of filesystem enumeration.
For every matching file, sort by repository-relative POSIX path, compute the
SHA-256 of the raw file bytes, and append one UTF-8 line with exactly this
shape (two ASCII spaces):

```text
<64-lowercase-hex-sha256>  <repository-relative-path>\n
```

The manifest SHA-256 is the SHA-256 of the concatenated UTF-8 lines. The
working directory and absolute checkout path therefore do not affect it.

## Measurement notes

The normative selectors, exclusions, thresholds, and detailed algorithms live
once in `docs/density-baseline.json`; the harness reads that document. Raw and
budgeted decorated-element counts are both retained. Required-accuracy text
can remove only the text contribution from the budgeted count: a filled or
bordered container continues to count. Mobile primary-content padding prefers
an explicit primary-content marker and otherwise measures the leftmost visible
text/control/media edge inside the primary content root. Baseline future-budget
observations describe the old UI and are not capture anomalies.
