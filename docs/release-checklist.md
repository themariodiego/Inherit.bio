# Release checklist

**Nothing here has been completed.** This file lists what must be true before
Inherit is opened to people who did not build it. It is not a progress report;
`docs/acceptance-matrix.md` is the authority on gate state and this file
deliberately repeats none of it, because a duplicated count is a count that goes
stale.

## The distinction this file exists to hold

Brief G3.4 and brief line 2548 both separate **code completion** from **launch**,
and the separation is easy to lose. Code completion is a property of this
repository: every gate row reads YES. Launch additionally requires acts that no
repository can perform — a person reads something, a person signs something, a
person runs a round with other people. Those are listed in Part B, and **no
amount of engineering shortens any of them**.

A build in which every gate is green and Part B is untouched is a correct,
complete, unlaunchable build. That is the expected state at the end of
engineering, not a failure.

---

## Part A — code completion

**A1. Every row in `docs/acceptance-matrix.md` reads YES.** No exceptions, no
"YES with a note". A row's evidence must be a working capability, not a test
count or a document.

**A2. `pnpm test`, `pnpm e2e` and every `pnpm gate:*` script pass twice
consecutively** from a clean database with a fresh build, with identical results
(G8.4). The comprehension harness is explicitly excluded from "the whole suite"
because it is stochastic; its stability requirement is its own two-consecutive-
clean-runs rule in G3.3.

**A3. The simulated comprehension round is green** (G3.3): two consecutive full
runs of 30 independently meet every threshold, with raw answers and verdicts
committed under `docs/comprehension-runs/<date>/`.

**A4. No placeholder reaches a shipped surface.** `pnpm gate:legal`,
`pnpm gate:claims` and `pnpm gate:first-glance` pass, and no legal page carries a
figure counsel has not supplied.

---

## Part B — launch-blocking, and not satisfiable by code

### B1. The human comprehension round

`docs/comprehension-protocol.md` is packaged and runnable. **It has not been
run.** Launch requires:

- Twelve participants recruited against the protocol's three criteria, screened
  by asking and with the answers recorded.
- The round run unmoderated, against a `TEST-LOCAL` build, never production.
- Grading blind and external, against `scripts/comprehension/rubric.md`, with a
  10% independent re-grade reaching at least 90% agreement.
- **≥ 10/12 per task** on T1, T2, T3, T4, T8, T9; **zero** prohibited answers on
  T5, T6, T7; zero "no route found" answers on T10; T9 within 8 actions and with
  no account created.
- Results committed to `docs/comprehension-results-<date>.md`.
- Where any task returns below 10/12, the simulated threshold for that task rises
  to 29/30, the simulated round is re-run, and the human round is repeated.

**No part of this repository may generate that results file.** A round that was
not run has no results, and a results file that nobody earned is worse than none.

### B2. A signed jurisdiction review for every capability offered

`data/jurisdictions.json` holds **zero** `realJurisdictions` entries, so all 249
selectable catalogue codes resolve to `unreviewed` and every one of the twelve
restricted capabilities is off everywhere. `pnpm gate:jurisdictions` enforces the
`signedReviewContract` structurally; it cannot supply a determination.

Shipping with zero real jurisdictions permitted is a **PASS, not a failure** —
every restricted capability renders its `jurisdiction-unavailable` state and
`adult_self_analysis` is exempt, so My Genome ships. What is launch-blocking is
offering a capability *without* a review, not declining to offer it.

For each jurisdiction and capability to be offered, before it is offered:

- A named, qualified person reaches a determination, in their own words, in
  `docs/reviews/jurisdictions/{jurisdiction}/{capability}.md`
  (`docs/reviews/jurisdictions/TEMPLATE.md` is the form).
- The record's final non-blank line is that person's `Signed-off-by:`.
- The matching reference object is written into `data/jurisdictions.json` and
  `pnpm gate:jurisdictions` passes.
- **Review first, declaration second.** A status written before the review exists
  is the failure the gate was built to make impossible.

Reviews expire. `warnAfterDays` and `failAboveDays` make this a standing
obligation, not a one-time unlock: a launched capability whose review has aged
past the limit fails the gate, and the correct response is a fresh review.

### B3. Counsel has supplied every figure and clause on a legal page

Brief §12 item 7: the liability cap figure "must be a real number before any
build ships, and no dimension can invent one." The same holds for every other
figure, deadline and named authority on a legal page.

`docs/protocol/legal-copy-proposed.md` carries one drafted wording change that is
**unapplied and unsigned**. Applying it is counsel's call, not an editorial one.

### B4. The brief corrections are signed or rejected

`docs/protocol/brief-corrections-proposed.md` carries drafted corrections to
`docs/inherit-v2-brief.md`, **unsigned and unapplied**. Each is either signed and
applied or rejected on the record. Launching against a specification with known
uncorrected errors means the acceptance matrix measures the wrong thing.

### B5. The proposed ADRs are decided

`docs/adr/0028-jurisdiction-gating-mechanism.md` and
`docs/adr/0029-density-contract.md` are **Proposed**. Both record mechanisms that
are already load-bearing. Launch requires each moved to Accepted or the mechanism
changed to match a different decision.

### B6. Hosted capacity, cost and lifecycle evidence exists for the stated limits

The product targets 100 genomes per month and one calendar month of original
retention. Raising either requires hosted evidence first — measured capacity,
measured cost, measured lifecycle — not an estimate. Launching at the stated
limits requires that the hosted numbers have been observed at least once at those
limits, not inferred from local runs.

### B7. Deletion deadlines are verified against the hosted system

Registered deadlines are 60 seconds for derived data and seven days for sources.
Launch requires both observed end to end on hosted infrastructure — a revocation
issued, the derived rows gone inside 60 seconds, the source bytes gone inside
seven days, and unrelated data of the same account and of other accounts intact
afterwards. A local pgTAP assertion is necessary and is not this.

---

## What launching without one of these means

Each item in Part B exists because skipping it moves a cost onto someone who did
not choose it:

- **B1** — a person who does not understand what they are reading, believing they
  do. The whole product is one claim: a beginner can understand a genetic file.
  Nobody has checked that claim with a beginner.
- **B2** — a person's genetic data analysed under a legal regime nobody read. No
  later review can un-analyse it.
- **B3** — a person relying on a promise that was never made by anyone entitled
  to make it.
- **B6, B7** — a person whose deletion request the system cannot actually meet,
  discovering this only after they trusted it.

None of these announces itself at launch. That is why they are on a checklist.
