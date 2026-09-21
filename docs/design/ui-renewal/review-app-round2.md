# Adversarial app review — round 2

Date: 2026-09-22. AI-simulated persona review with actual local Chrome interaction; not human usability validation.

**PASS for the reviewed signed-in empty-state surfaces.** Every scoring dimension is at least 4.0, each persona mean is above 4.3, and no blocker or major UI defect remains in this review scope.

## Verified corrections

- **APP-01 closed:** clean captures at /overview, /genome/me, /family and /embryos show a 53px header and 44px single-line Sign out control at desktop, tablet and phone. The email no longer crowds tablet controls.
- **APP-02 closed:** My Genome, Family and Embryos each render a single 512px card column at 768px viewport width. At 390px they retain a single 342px column. At 1440px the desktop three-column layouts remain intact. No horizontal overflow across these 12 clean captures. Full-size tablet screenshots confirm readable availability paragraphs rather than narrow word stacks.
- **APP-03 closed:** after entering a search query with a deliberately delayed local response, visible “Searching…” text appears in a polite live-status region. The result arrives and Escape closes the dialog. Screenshot: `adversarial-app-round2/search-pending-phone.png`.

The complete round-1 sweep still supplies the broad 21-route × 4-viewport coverage (84 authenticated captures, zero overflow, zero phone axe WCAG A/AA violations). Round 2 adds the 12 corrected-layout captures and targeted interactions. Unchanged pages were not unnecessarily retested.

## Additional adversarial tasks

- Tablet reader searched the report library for “caffeine.” Relevant cards appeared across the applicable categories and each clearly stated “Awaiting your data.”
- Checked “With results” on the empty account. The UI explained that no results match and how to recover.
- Selected “Clear filters.” The query cleared and focus returned to the search input. This is a useful recovery path for keyboard and low-confidence users.
- Measured the desktop navigation glider moving from Overview to a hovered Family item: transform changed from y=0 to y=112px over 0.2 seconds. This supplies clear, restrained pointer feedback.
- Enabled reduced motion: the glider duration became 0s and the browser reported no running animations.
- Round 1 already verified first-Tab skip-link visibility, focus transfer to main, keyboard global search and Enter navigation to /settings, and Escape focus restoration.

## Final scores

| Persona | Coherence | Hierarchy | Task usability | Responsive / accessibility | Motion restraint | Mean |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Impatient phone user | 4.6 | 4.2 | 4.5 | 4.4 | 4.7 | 4.48 |
| Tablet, low-confidence reader | 4.5 | 4.3 | 4.4 | 4.4 | 4.7 | 4.46 |
| Keyboard-only researcher | 4.5 | 4.2 | 4.5 | 4.6 | 4.7 | 4.50 |

Overall mean: **4.48 / 5**. The existing cream/forest-green feel remains recognizable. The revised card surfaces and quieter interaction feedback improve consistency without obscuring real capability limits.

## Limits

No production access or data, consent, deletion, account-completion, email preference or provider mutation was performed. The session used a synthetic local account with no uploaded genome. Populated analyses, real family members, valid embryo data and successful provider-backed Copilot responses are not validated by this empty-state review. Jurisdiction-gated Family/Embryos actions and the explicitly unbuilt People settings page are existing capabilities, not design regressions. The independent route audit covers additional paths.

Evidence: `adversarial-app-round2/results.json`, `adversarial-round2.log`, all PNGs in `adversarial-app-round2/`, and the complete evidence manifest in `review-app-round1.md`.
