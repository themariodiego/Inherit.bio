# Public UI adversarial review — rounds 1 and 2

This is an agent-simulated review using invented personas and actual local Chromium interaction, not human usability research. No production account, email, purchase, or genome data was submitted. Implementation files were not edited by this reviewer.

## Method and evidence

App: http://localhost:3100. Desktop 1440×1000, tablet 768×1024, phone 390×844. Additional 320×568 checks on landing and provider comparison. Read AGENTS.md and the browser skill; used bundled Playwright because agent-browser was not installed.

All 37 public route samples were loaded at the three standard sizes: 111 page renders/screenshots. All had zero horizontal page overflow. Each route had an axe WCAG A/AA pass at phone width (37 passes). These checks do not substitute for human accessibility testing. Visual inspection covered landing, provider table/cards, About, science, legal/index/docs/artifacts/diffs, authentication, embryo availability, future-person claim, and withdrawal unavailable states. Dynamic consent routes use seeded local consent.own-monogenic versions 1 and 2.

Evidence directory: `work/ui-renewal/public-review/`.

- `results.json`: core 14 routes ×3 sizes.
- `remaining-results.json`: remaining 23 routes ×3 sizes.
- `task-evidence.json`: newcomer/provider/form/reduced-motion tasks.
- `access-evidence.json`: legal anchors, skip link, keyboard country selection, dark provider scan.
- `round2-results.json`: provider fix at four widths and About copy recheck.
- `round2-*.png`: direct retest screenshots after fixes.

Scripts are review-only artifacts: `review-public.mjs`, `public-tasks.mjs`, `public-remaining.mjs`, `public-access.mjs`, `public-retest.mjs`.

## Personas and actual tasks

1. **Novice without a DNA file:** opened landing, used “Find a sequencing provider,” selected Denmark and Genotyping array, and inspected a provider's price, compatible raw file, depth and turnaround. Country and test-type selection worked. Round 1 hid the price offscreen. Round 2 presents each mobile/tablet product as labeled details before the outbound Buy action.
2. **Older phone user:** reviewed the landing at 390 and 320px, provider comparison, and sign-up form. Empty sign-up submission focused Email and retained native required-field validation (two invalid required fields). No email was sent. All public text and controls fit the phone width; 320px header reflows to three rows rather than clipping. The 320px layout is taller but usable.
3. **Skeptical privacy-first newcomer:** opened Privacy, expanded “On this page,” and jumped to “Deletion that actually deletes.” The destination was below the sticky header (target y336, header bottom118 in the captured state). Inspected About/Plus Bio relationship, legal library and versioned consent. The TOC and explicit legal headings make policy scanning feasible.

Additional interaction evidence: first Tab on landing reveals a 44px-high “Skip to main content”; Enter focuses `main#main`. Keyboard country selection via Enter, “d”, Enter selected Denmark. Providers in dark theme had no axe violations. Reduced-motion landing had no active animations. Disclosure/button/nav transitions are brief and do not compete with the content.

## Round 1: fail and required fixes

### P1 — Mobile provider purchase information hidden offscreen

At390px, after Denmark + Genotyping array, the first provider contained a704px table inside a300px scroll region. The prominent Buy action appeared before the table, while price/raw-file details were outside the visible region. A novice could choose a provider before noticing those decision fields. Keyboard scrolling existed, but that did not solve discoverability for a touch user.

Evidence: `provider-array-phone.png`, `provider-array-phone-price.png`, `task-evidence.json` (tableWidth704, visibleWidth300). This was an inherited presentation limitation, not a newly introduced backend problem. It failed this redesign's mobile usability threshold.

Required fix: expose product, compatibility, price and raw-file format together on narrow screens; keep the outbound action after the comparison information. Preserve the same data and filtering semantics.

### P2 — About contradicts the upload contract

About claimed “VCF, BAM, or CRAM,” while landing, providers and Privacy correctly stated BAM/CRAM/FASTQ are unsupported. This was inherited copy inconsistency, not a new feature defect. It could send a novice down an unsupported path.

Evidence: `_about-desktop.png`, under “What Inherit is.” Required fix: align the visible About description with the existing upload contract.

Round1 scores (0–5; pass requires every axis ≥4 and mean≥4.3):

| Area | Visual coherence | Hierarchy/comprehension | Task usability | Responsive/accessibility | Motion restraint | Result |
|---|---:|---:|---:|---:|---:|---|
| Landing |4.5|4.5|4.5|4.5|4.6|Pass|
| Providers |4.2|4.0|3.0|3.5|4.6|Fail|
| About |4.5|3.5|4.0|4.5|4.6|Fail|
| Science |4.5|4.3|4.3|4.5|4.6|Pass|
| Legal/privacy/consent |4.5|4.3|4.3|4.5|4.6|Pass|
| Authentication |4.5|4.4|4.2|4.5|4.6|Pass|
| Availability/unavailable states |4.4|4.4|4.2|4.5|4.6|Pass|

## Round 2: pass after fixes

Retested providers at1440,768,390 and320px. Every tested width has zero page overflow and no axe WCAG A/AA violations. At768 and390, compatibility explanation, price/date, raw files, depth and turnaround are visibly grouped under the product. At1440 the table remains readable. The Buy action follows product details. At320 all text wraps within the card. About now says VCF/gVCF and explicitly states BAM/CRAM/FASTQ are not accepted.

Evidence: `round2-provider-desktop.png`, `round2-provider-tablet.png`, `round2-provider-phone.png`, `round2-provider-narrow.png`, `round2-about-desktop.png`, `round2-results.json`. The updated landing headline is balanced at desktop/tablet/phone (`round2-home-*.png`).

| Area | Visual coherence | Hierarchy/comprehension | Task usability | Responsive/accessibility | Motion restraint | Result |
|---|---:|---:|---:|---:|---:|---|
| Landing |4.6|4.5|4.5|4.5|4.6|Pass|
| Providers |4.4|4.3|4.3|4.5|4.6|Pass|
| About |4.5|4.5|4.4|4.5|4.6|Pass|
| Science |4.5|4.3|4.3|4.5|4.6|Pass|
| Legal/privacy/consent |4.5|4.3|4.3|4.5|4.6|Pass|
| Authentication |4.5|4.4|4.2|4.5|4.6|Pass|
| Availability/unavailable states |4.4|4.4|4.2|4.5|4.6|Pass|

Overall public assessment: visual4.5, hierarchy4.4, task usability4.3, responsive/accessibility4.5, motion restraint4.6; mean4.46/5. No remaining blocking or major UI issue found in the tested public flows.

## Existing scope limits and optional follow-ups

- The phone provider directory is long because it includes many providers/products and their existing disclosures. Details now remain readable and comparable; keeping the directory data current is outside this UI-only review. Captured dates remain visible.
- Consent artifact headings still expose identifiers such as `consent.own-monogenic`; the adjacent summary/body explains the choice. A friendly display title could improve comprehension in a separate content pass. It does not block the present public flow.
- Sign-up/reset use native validation but do not show a password-length hint before submission. A visible hint would be a minor convenience improvement.
- The local changelog has a seeded E2E report, not production editorial content. This is a test fixture, not a new visual defect.
- Embryo tools and future-person claims explicitly remain unavailable. This is existing product policy and is clearly communicated.
- `/withdraw/session` returns a designed404 without a valid request session. This is expected privacy behavior. No valid third-party request token or real withdrawal was used.
- Legal content semantics were not rewritten or legally audited. Some existing pages describe different deletion/retention contexts; this review assesses presentation and navigation, not the legal accuracy of those policies.

## Route coverage

- `/` — desktop/tablet/phone loaded and captured; phone axe pass; zero page overflow.
- `/about` — desktop/tablet/phone loaded and captured; phone axe pass; zero page overflow.
- `/auth/forgot-password` — desktop/tablet/phone loaded and captured; phone axe pass; zero page overflow.
- `/auth/reset-password` — desktop/tablet/phone loaded and captured; phone axe pass; zero page overflow.
- `/auth/sign-in` — desktop/tablet/phone loaded and captured; phone axe pass; zero page overflow.
- `/auth/sign-up` — desktop/tablet/phone loaded and captured; phone axe pass; zero page overflow.
- `/changelog` — desktop/tablet/phone loaded and captured; phone axe pass; zero page overflow.
- `/embryo-analysis` — desktop/tablet/phone loaded and captured; phone axe pass; zero page overflow.
- `/future-person/claim` — desktop/tablet/phone loaded and captured; phone axe pass; zero page overflow.
- `/legal` — desktop/tablet/phone loaded and captured; phone axe pass; zero page overflow.
- `/legal/appeals` — desktop/tablet/phone loaded and captured; phone axe pass; zero page overflow.
- `/legal/consent.own-monogenic` — desktop/tablet/phone loaded and captured; phone axe pass; zero page overflow.
- `/legal/consent.own-monogenic/diff/1/2` — desktop/tablet/phone loaded and captured; phone axe pass; zero page overflow.
- `/legal/consent.own-monogenic/versions/1` — desktop/tablet/phone loaded and captured; phone axe pass; zero page overflow.
- `/legal/consent/consent.own-monogenic` — desktop/tablet/phone loaded and captured; phone axe pass; zero page overflow.
- `/legal/consent/consent.own-monogenic/diff/1/2` — desktop/tablet/phone loaded and captured; phone axe pass; zero page overflow.
- `/legal/consent/consent.own-monogenic/v/1` — desktop/tablet/phone loaded and captured; phone axe pass; zero page overflow.
- `/legal/consents` — desktop/tablet/phone loaded and captured; phone axe pass; zero page overflow.
- `/legal/deceased` — desktop/tablet/phone loaded and captured; phone axe pass; zero page overflow.
- `/legal/future-person` — desktop/tablet/phone loaded and captured; phone axe pass; zero page overflow.
- `/legal/gdpr` — desktop/tablet/phone loaded and captured; phone axe pass; zero page overflow.
- `/legal/gina` — desktop/tablet/phone loaded and captured; phone axe pass; zero page overflow.
- `/legal/incident-response` — desktop/tablet/phone loaded and captured; phone axe pass; zero page overflow.
- `/legal/insurance-and-discrimination` — desktop/tablet/phone loaded and captured; phone axe pass; zero page overflow.
- `/legal/law-enforcement` — desktop/tablet/phone loaded and captured; phone axe pass; zero page overflow.
- `/legal/research-consent` — desktop/tablet/phone loaded and captured; phone axe pass; zero page overflow.
- `/legal/self-hosting` — desktop/tablet/phone loaded and captured; phone axe pass; zero page overflow.
- `/legal/state-genetic-privacy` — desktop/tablet/phone loaded and captured; phone axe pass; zero page overflow.
- `/legal/where-inherit-works` — desktop/tablet/phone loaded and captured; phone axe pass; zero page overflow.
- `/privacy` — desktop/tablet/phone loaded and captured; phone axe pass; zero page overflow.
- `/providers` — desktop/tablet/phone loaded and captured; phone axe pass; zero page overflow.
- `/science` — desktop/tablet/phone loaded and captured; phone axe pass; zero page overflow.
- `/science/limits` — desktop/tablet/phone loaded and captured; phone axe pass; zero page overflow.
- `/science/positions` — desktop/tablet/phone loaded and captured; phone axe pass; zero page overflow.
- `/terms` — desktop/tablet/phone loaded and captured; phone axe pass; zero page overflow.
- `/withdraw/request` — desktop/tablet/phone loaded and captured; phone axe pass; zero page overflow.
- `/withdraw/session` — desktop/tablet/phone loaded and captured; phone axe pass; zero page overflow.

## Valid withdrawal/session state addendum

The previous audit's `/withdraw/session` sample was its privacy-preserving404. The valid signed-out adult invitation review was subsequently rendered and visually reviewed at1440×1000,768×1024 and390×844. All three returned200 with “Review invitation,” zero page overflow, zero axe WCAG A/AA violations, and no captured browser errors. The consent, sign-in-to-accept action, Refuse action and Delete reserved record action remain readable and fit; refusal/deletion buttons wrap naturally on phone. Score: visual4.5, hierarchy4.4, task usability4.3, responsive/accessibility4.5, motion restraint4.6; pass.

Evidence: `public-review/withdrawal/desktop.png`, `tablet.png`, `phone.png`, `results.json`. Seed identity/scope is documented in `public-review/withdrawal/fixture.json`; it contains no credential. `review-withdrawal-state.mjs` is the rendering reproduction.

The fixture is a newly created `ui-withdraw-review-…@e2e.local` account on the confirmed127.0.0.1:54321 local database, with a synthetic empty invited subject. Its mail outbox was inserted as `invalidated`, was never queued or sent, and was checked to remain invalidated after review. No existing real account was changed. No accept/refuse/delete form operation was submitted. The temporary rights session was revoked after screenshots.

Important validation boundary: the shared local DB lacks the repository's20260913070000 adult rights-activation migration. A read-only `pg_get_functiondef` check found no adult branch in live `activate_rights_session_v1`; `private.current_adult_subject_invitation_v1` was absent. Therefore the browser's genuine fragment-link → Continue activation could not resolve this adult fixture. No shared database migration was applied. The form was reviewed using a dedicated synthetic consumed token + active rights-session record and its local cookie, following the loader's exact data contract. This closes rendering/accessibility coverage for a valid state, not end-to-end activation or invitation mutation behavior.
