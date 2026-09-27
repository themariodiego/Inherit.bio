# Adversarial app review — round 1

Date: 2026-09-22. This is a simulated persona review performed by an AI reviewer using actual Chrome browser navigation, DOM measurements, accessibility checks and screenshots. It is not human usability validation.

**Result: iterate once more.** Core tasks passed. No blocker or major functional UI defect was reproduced. The 768px Family and Embryos hubs retain narrow three-column cards; this keeps tablet responsive quality below the required score of 4.0. The author is addressing it.

## Scope and method

Local app only: http://localhost:3100. Synthetic signed-in account with no genome file. No production access and no consent, data, deletion, email preference, account-completion or model-provider mutation. The baseline sweep used the supplied local storage state. Later interaction checks used a separate UI login so simultaneous contexts would not rely on one refresh session.

Browser: Playwright controlling installed Chrome; the agent-browser CLI was unavailable. Read repository AGENTS.md and browser-verification skill. No implementation files were edited by this reviewer.

21 routes were loaded at each of 1440×1000, 768×1024, 390×844 and 320×740: 84 captures and DOM measurements. Reviewed contact sheets for all 84 screens, with full-size inspection of representative and problematic screens. Phone axe checks covered WCAG 2 A/AA and 2.1 AA on all 21 routes. All had one or more h1, no horizontal document overflow and zero axe violations. Every screenshot remained authenticated. Reduced-motion and keyboard tasks were additional targeted checks.

Routes: /overview; /genome/me; /genome/me/reports; /genome/me/ancestry; /genome/me/data; /genome/me/data/browser; /copilot/me; /files; /files/upload; /family; /family/invite; /family/health-picture; /embryos; /embryos/upload; /embryos/request-data; /embryos/compare; /settings; /settings/consents; /settings/copilot; /settings/data; /settings/people.

Dynamic populated report, family-person and embryo data states are outside this empty-account review. The separate route sweep covers additional route outcomes. It would be inaccurate to claim this review validates every possible data or permission state.

## Persona tasks and findings

### Impatient phone user

1. At /overview, selected “I have a DNA file.” Arrived at /files/upload, where the “Complete your account” prerequisite, labelled date field and “Save and continue” action were clear. Stopped before submitting data.
2. Used bottom navigation to My Genome, then “Open Reports.” Reached /genome/me/reports. The file-empty state is explicit while the report library remains browsable.
3. Opened global Search, entered “ancestry,” and closed with Escape. Search fits the viewport and focus returns to the Search control.
4. Inspected all 21 pages at 390px and 320px, including settings and unavailable Family/Embryos states. No content caused horizontal page scrolling. Buttons and full-card links remained legible.

The consistent five-item bottom navigation is easy to recover. Empty-state actions preserve the restrained green/cream visual language. Report content is long but supports search and filtering. Copilot setup remains lengthy because the product requires the user to connect a provider; that is pre-existing capability and content, not a new design defect.

### Tablet user with low confidence

1. Inspected My Genome, Reports, Ancestry, Family and Embryos at 768px.
2. The initial tablet account header wrapped the long synthetic email and “Sign out” to two lines. This was reported immediately. Later screenshots show the author’s fix: email hidden on tablet, single-line sign-out control, clear search control.
3. Reports now use one legible column at tablet width. My Genome was changed during the sweep; its first tablet capture predates the new full-card/single-column treatment and requires a clean retest.
4. Family and Embryos still use three columns within the 512px content area. Each card is about 160px wide, leaving approximately 118px for text. Availability paragraphs break into six lines of two to three words. This is the remaining layout concern.
5. Unavailable-feature pages explain what is unavailable and offer a useful back route where appropriate. The review did not bypass these capability gates.

### Keyboard-only researcher

1. Opened /genome/me/data/browser and pressed Tab once. “Skip to main content” became visible at x16/y16, 168.7×44px.
2. Pressed Enter. Focus moved to MAIN#main.
3. Opened Search with Control+K, entered “settings,” waited for the actual search response, pressed Arrow Down, then Enter. Focus moved to the Settings result and navigation completed at /settings; dialog closed.
4. Confirmed Escape closes Search and returns focus to its opener.
5. Enabled prefers-reduced-motion: reduce. Visible nav glider, links and buttons reported 0s transition durations; no running animation remained.

An early fixed 1.2-second wait was insufficient for local development compilation. Repeating with an actual /api/search response wait verified the complete keyboard flow. That transient test timing is not classified as a navigation defect.

## Findings and iteration requests

| ID | Severity | Finding | Evidence | Requested change |
| --- | --- | --- | --- | --- |
| APP-01 | Moderate visual issue, fixed pending clean spot retest | Tablet account controls wrap and make the header unnecessarily tall. | Initial `adversarial-app/overview-tablet.png`, `genome-me-tablet.png`; later `settings-consents-tablet.png` shows corrected header. | Hide email until large screens and prevent sign-out wrapping. Author implemented this during review. |
| APP-02 | Moderate visual issue; current iteration requirement | Family and Embryos tablet cards have overly narrow text columns. | `adversarial-app/family-tablet.png`, `adversarial-app/embryos-tablet.png`. | One card column below 1024px, as applied to My Genome; preserve desktop three-column layout. Retest tablet plus phone/desktop. |
| APP-03 | Minor usability issue | Search shows no visible progress text while a nonempty query is awaiting its response. On this dev server, the result area was blank for longer than 1.2 seconds. | `adversarial-app/phone-search.png`; `interactions.json` pending-query snapshot; successful completion in `adversarial-search.log`. | Consider an understated “Searching…” live-status message until the current query is answered. This is existing behavior, not a demonstrated regression. |

No additional scope is implied by the following capability limits: local account has no uploaded genome; Family/Embryos functionality is jurisdiction-gated; /settings/people explicitly says it is not built yet; Copilot requires a configured provider and relevant permissions. These are not failures introduced by this UI update.

## Scores (0–5)

Pass requires every dimension at least 4.0, mean at least 4.3, and no blocker or major defect.

| Persona | Coherence | Hierarchy | Task usability | Responsive / accessibility | Motion restraint | Mean |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Impatient phone user | 4.6 | 4.2 | 4.4 | 4.4 | 4.7 | 4.46 |
| Tablet, low-confidence reader | 4.5 | 4.1 | 4.3 | **3.9** | 4.7 | 4.30 |
| Keyboard-only researcher | 4.5 | 4.2 | 4.4 | 4.5 | 4.7 | 4.46 |

The tablet score must be raised through a verified layout correction, not by averaging it away. A clean retest of APP-01/02 plus My Genome will determine the next round.

## Evidence

- `adversarial-app/results.json`: all 84 route/viewport measurements and phone axe results.
- `adversarial-app/all-desktop.jpg`, `all-tablet.jpg`, `all-phone.jpg`, `all-small.jpg`: complete first-viewport contact sheets.
- `adversarial-app/<route-with-hyphens>-<desktop|tablet|phone|small>.png`: full-page route screenshots.
- `adversarial-app/interactions.json`: actual navigation, focus and reduced-motion observations.
- `adversarial-search.log`: completed keyboard search result flow, HTTP 200 and final /settings destination.
- `adversarial-app.mjs`, `adversarial-interactions.mjs`, `adversarial-search.mjs`: reproducible local review scripts. They contain only local synthetic test identity, never printed auth cookies.

Development-only Next.js indicators visible in some captures are excluded from product UI ratings.

## Follow-up

Round 2 closed APP-01, APP-02 and APP-03 through actual browser retesting. See `review-app-round2.md`: final score 4.48/5, all dimensions at least 4.0, no blocker or major defect in the reviewed scope.
