# Adversarial dynamic-state review

Date: 2026-09-22. AI-simulated users operating the actual local application; not human usability validation. This extends `review-app-round2.md` beyond the empty-account states.

## What was genuinely exercised

The local Supabase API was asserted to be `http://127.0.0.1:54321` before fixture access. Only synthetic `@e2e.local` accounts were inspected. Dedicated embryo fixtures were created using the repository's `e2e/embryos.spec.ts` seedCohort structure, under two new synthetic accounts. Existing synthetic report and ancestry accounts were accessed through normal UI sign-in; their data, grants and completed analysis records were not altered. The app's configured TEST-LOCAL jurisdiction gate remained in force. No grant was fabricated and no production data was touched.

Each state below was rendered at **1440×1000, 768×1024 and 390×844**. All 36 valid captures returned HTTP 200, with zero horizontal document overflow. All 12 corresponding phone states had zero axe WCAG 2/2.1 A/AA violations. All captures were visually reviewed through full-size targeted screenshots and contact sheets.

| Surface | Real observed state | Captures |
| --- | --- | ---: |
| Embryo hub | Three synthetic cohorts; first has pass/marginal/fail QC records, second ingesting, third awaiting upload. Retention, labels and links visible. | 3 |
| Embryo detail, active cohort | Correct embryo label and **consent-required**. No derived results exposed. | 3 |
| Embryo comparison, active cohort | **Consent-required**, not a blank matrix and not a 404. | 3 |
| Embryo detail, ingesting cohort | **Processing**: still checking files. | 3 |
| Embryo comparison, ingesting cohort | **Processing**: still checking files. | 3 |
| Embryo detail, upload_pending cohort with pending embryo | **Processing** under the current resolver precedence; see limitation below. | 3 |
| Embryo comparison, upload_pending cohort | **Empty**: the laboratory's files have not yet been added. | 3 |
| Ancestry | Existing canonical synthetic AIMs-mixed result, 168/168 markers, populated map/table and ancestry shares. | 3 |
| Report library with source | One stored synthetic source, valid ancestry grant, separate observed-variant/estimate choices off. | 3 |
| Caffeine report detail | Existing generated synthetic **A/C** result; one genotype figure and interpretation, evidence, sources and file provenance. | 3 |
| Genome browser | `q=rs762551`, one observed A/C genotype, results table and local IGV track. | 3 |
| Data and methods | Stored-source coverage rows; absence of a completed polygenic score remains explicit. | 3 |

The exact valid report route is `/genome/me/reports/caffeine-metabolism-cyp1a2-rs762551`. An exploratory short slug `/genome/me/reports/caffeine-metabolism` returned the correct unavailable/404 page in three captures. **Those three captures are excluded from the 36 valid renders and from populated-report coverage.** They remain in the raw log for transparency.

## Adversarial findings

**DYN-01 — tablet report choices too narrow, iteration required.** The populated Reports page revealed a consent-choice grid that was absent from the empty-account sweep. At 768px it placed three tall, narrow permission cards inside the available 512px content area. Descriptions and action labels wrapped excessively. Evidence before correction: `dynamic-review/reports-with-source-tablet.png`. The author changed the breakpoint from `md:grid-cols-3` to `lg:grid-cols-3` in `own-report-choices.tsx`. This is a presentation-only change; permissions and generation were not altered.

The first dynamic review therefore held responsive quality at **3.9/5** pending a clean retest. The retest outcome and final score are recorded below, after measurement.

## Actual interactive checks

- On the populated ancestry phone screen, focused a real region path and pressed Enter. The region panel opened and focus moved to its Close button.
- Closed the panel. Focus returned to the originating Europe path, with its accessible regional-share label intact.
- Changed the “Show only what's well supported” switch from true to false. The display changed without page overflow or any stored-permission mutation.
- The populated genome table is 576px wide inside a 342px scroll container at 390px. The container has `overflow-x:auto` and `tabIndex=0`; this is contained wide data, not horizontal page overflow.
- Main content remains readable and ordered on the actual populated caffeine report, including the result, what it does not mean, evidence, sources and provenance. Existing keyboard/search/reduced-motion checks are documented in the prior app rounds.

## Exact limitations and existing behavior

1. Full embryo result matrices/QC detail after analysis permission were **not** exercised. `e2e/embryos.spec.ts` documents that analysis grants require paired writes that the fixture client cannot seed; its browser suite proves the same consent-required states, while pure renderer/unit tests cover the later states. This review did not bypass that boundary. Seeded QC records are fixture inputs, not proof of real embryo upload or analysis.
2. The current resolver checks `embryoStatus === "pending"` before `cohort.status === "upload_pending"` (`src/lib/embryos/access.ts:117–118`). Consequently the upload-pending fixture's detail page says “Still checking the files,” while comparison says files have not been added. The repository's dedicated detail-empty test deliberately uses a passing-QC fixture to reach the latter branch. Our screenshots faithfully record processing for this pending embryo; they must not be presented as proof of detail-empty rendering. This precedence and wording predate the UI update and were not changed by this review.
3. The genome browser emits an IGV console message about a blocked `https://igv.org/data/url_mappings.tsv` lookup. There was no uncaught page error, and the observed table and local track rendered. `src/components/browse/genome-browser.tsx` documents the existing first-party guard which deliberately blocks this startup request. Evidence: `populated-report-review/browser-interactions.json`. This is an existing integration diagnostic, not a new UI regression.
4. Parent reviewer separately captured valid synthetic family-person, permissions, Portrait waiting-for-other-person, and health-picture insufficient-consent states in `dynamic/results.json`. Those states were not replaced with invented enabled access in this review.
5. This extends data-state coverage at three requested viewports. It does not claim every scientific result, every permission combination, every IGV interaction, or a working embryo ingestion path.

## Evidence

- `dynamic-review/results.json`: 27 valid embryo/ancestry/library observations plus three explicitly excluded short-slug 404s.
- `populated-report-review/results.json`: nine populated report/browser/data observations.
- `dynamic-review/interactions.json`: ancestry keyboard panel and toggle outcomes.
- `dynamic-review/contact-{desktop,tablet,phone}.jpg`: reviewed dynamic contact sheets.
- `dynamic-review/*.png` and `populated-report-review/*.png`: full route captures and interaction states.
- `dynamic-embryo-fixture.json`: exact synthetic cohort/embryo identifiers. Local fixture identity only; do not publish as product data.
- `seed-dynamic-review.mts`: fixture source; `dynamic-review.mjs`, `populated-report-review.mjs`, `dynamic-interactions.mjs`, `genome-browser-interactions.mjs`: reproducible review scripts.

## Correction retest and final rating

**DYN-01 closed after browser retest.** The 768px permission grid now has one 470px column (after its enclosing card padding). The 1440px grid retains three approximately 316.7px columns. Both pages have zero document overflow. Full-size screenshots confirm that descriptions, independent consent controls and action labels are readable. Evidence: `dynamic-review/choices-retest.json`, `reports-choices-fixed-tablet.png` and `reports-choices-fixed-desktop.png`. No permission was clicked during the retest.

| Dimension | Final score / 5 |
| --- | ---: |
| Visual coherence | 4.5 |
| Information hierarchy | 4.2 |
| Task usability within supported states | 4.4 |
| Responsive layout and accessibility | 4.4 |
| Motion restraint | 4.7 |

Final mean: **4.44/5 — PASS**, with each dimension ≥4.0 and no remaining major or blocking UI regression observed in the reviewed states. The existing capability and diagnostic limitations above remain explicitly outside that pass claim.

This extension produced **36 valid route/viewport captures + 2 corrected-layout retest captures**, plus two ancestry interaction screenshots and three excluded short-slug 404 captures. No implementation file was edited by the reviewer.
