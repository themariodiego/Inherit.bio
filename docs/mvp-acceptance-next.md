# MVP-first acceptance sequence

Read-only plan audit, 2026-09-06. Full-plan acceptance remains **18/65**.
This is a delivery order, not a replacement specification or launch approval.
The parent task is integrating parallel work on upload, normalization and
separate report choices. Unmerged code is not a production capability.

## Why the count looks stuck

There is both real progress and a real bottleneck. PR72 released useful,
source-backed report improvements, but its evidence covers eight reports,
not the catalog-wide G1.11/G4.7 gates. The new own-upload implementation has
local consent, transport, complete-source validation and cleanup receipts;
it does not yet prove browser file selection through chosen personal results.
The temporary new-source processing refusal must not ship as the finished
experience. More foundation-only PRs would leave this user problem unsolved.

Many NO rows are whole-product conjunctions: G2.6 requires all four upload
journeys; G1.12 requires every registered route/state; G4.7 requires every
scientific claim. One completed slice cannot truthfully turn such a row YES.
Use the milestone table below alongside, never instead of, the 65-item ledger.

## Delivery milestones, in priority order

| Journey | Useful outcome | Required proof before calling the milestone delivered | Full-plan relation |
| --- | --- | --- | --- |
| 1. My file → my first findings | Choose an ordinary supported file, understand progress, select report purposes once, open a covered source-backed finding. | Production-build browser test through real restricted Storage, complete-source finalization, exact-source normalization, one selected purpose and real rendered result. A second purpose remains off; denied/expired consent produces no analytic output. Retry does not duplicate a source or grant. Deployed signer/capacity configuration and retention execution are verified. | Own-genome part of G2.6; partial G5.2/G2.2. Other three journeys still required. |
| 2. Find and understand what my file says | Locate a useful finding, distinguish no coverage from a negative result, inspect its source, return to the same search. | Covered and genuinely uncovered synthetic inputs; mobile and desktop; keyboard recovery from empty filters; meaningful first heading and source/input facts; no fabricated risk or percentile. Keep report-layer counts separate. | Builds on accepted G4.3/G4.6. Contributes to G2.4, G3.5, G4.7; none becomes YES from one library test. |
| 3. Control my files without getting trapped | Download or delete a chosen file, see a clear failure, retry safely, retain unrelated files and their results. | Two synthetic files in one account; deleting one removes its exact object and derivatives while the other remains usable; failed provider deletion stays visible and retryable. Verify free export and account notice/cancellation separately. | Existing deletion regression is valuable, not full G5.3a/G5.6. Broader adult/embryo graphs remain necessary. |
| 4. Another adult participates willingly | Invite an adult, complete the appropriate upload/confirmation path, grant one purpose and see only the shared result. | Actual file journey, exact uploader/subject ownership, pre-confirmation unreadability, purpose-specific output, accountless refusal, revocation and deadline-bound physical cleanup. Positive and refused contributor jurisdictions must be exercised. | Adult part of G2.6; closes only the proved slices of G5.3/G5.4/G5.1b. Existing invitation acceptance alone is insufficient. |
| 5. Parents understand embryo results | Complete both permitted embryo uploader paths, see per-embryo QC and supported comparisons, with clear missing-data states and no ranking. | Real synthetic source ingestion and all required signers; complete ordinal publication or named QC failure; useful comparison and trade-off output; failure notices and exact retention/purge proof. Neither a placeholder nor a refusal-only test counts as the positive workflow. | Remaining two G2.6 paths; embryo half of G4.5 and broader G5 rights gates. |

### Keep the first journey simple

The canonical `analysis-eligibility-v1` matrix explicitly permits
`ingest.normalize` under current upload/store consent with **no analytic
purpose grant**. Basic preparation must not request a second upload permission.
Monogenic reports, polygenic reports and ancestry have separate purposes;
turning one on must not require turning on the other two. Normalization and
storage success must not be described as reports ready.

Keep the existing usable report catalog available. Prioritize reviewed
takeaways and understandable coverage over adding unsupported numerical
claims. A genuinely unavailable score can be honest and useful when it
explains what was checked and what is missing; a dead-end generic refusal is
not the intended MVP.

## Parallel lanes and acceptance closure

- **Integration lane:** finish milestone 1 as one vertical slice. Parent owns
  browser/API wiring and real provider trust; normalization and report-choice
  agents own separate modules. Test this boundary before expanding uploads.
- **UX lane:** report-library filter recovery and browser-back regression,
  scoped to existing authorized cards. No new data permission, purpose or
  report meaning. This is independently reviewable, but not a new G gate.
- **Next bounded acceptance gate:** G1.14 has a finite three-route scope:
  extend Lighthouse to per-category thresholds, authenticated Overview and
  covered report detail, and assert final URLs. Record performance ≥90 and
  accessibility 100 on `/`, Overview and one report. Do not run this against
  a login redirect or treat it as full accessibility acceptance.
- **After the core flow stabilizes:** finish complete route/state coverage and
  route dispositions for G1.12/G2.2/G2.3, then their required CI integration.
  Repeatedly rerunning incomplete full suites does not close those gates.

The comprehension lane requires actual independent simulations and blind
grading under G3.1–G3.3. A written protocol or invented transcripts cannot
close it. Human recruitment remains an explicitly recorded launch condition.

## Reporting after each PR

Report: the user-visible outcome; merged/deployed/locally tested status;
which milestone advanced; exact G gate IDs newly proved (if any); and the
next user-visible blocker. Keep **18/65** until a complete gate has its actual
required proof. Do not equate PR, test, migration or report counts with a
whole-project percentage.

## Evidence inspected

- `docs/acceptance-matrix.md`: G1–G8 ledger and PR72 scope.
- `docs/route-register.json`: `analysis-eligibility-v1`, canonical report paths.
- Original plan attachment: G1.12–G1.17, G2 and G3 requirements, read alongside
  the canonical register and overriding ADRs rather than replacing them.
- `src/app/(app)/genome/[subject]/reports/page.tsx`: authorized library,
  preview-first ordering within categories, separate layers, input provenance.
- `src/components/reports/report-library.tsx`: local filtering; missing clear
  action at audit time. Browser-back preservation requires a runtime receipt.
- `e2e/report-previews.spec.ts`: actual covered/uncovered preview assertions.
- `e2e/file-deletion.spec.ts`: exact source/derivative deletion, failure/retry
  and foreign-account guards. Its ingestion helper must migrate with the new
  upload API before this branch can claim a fresh passing deletion run.

No hosted project, real account, genome file or acceptance status changed in
this audit. The proposed sequence does not waive any legal or safety gate.
