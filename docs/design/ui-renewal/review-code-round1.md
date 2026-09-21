# Adversarial implementation review — round 1

Reviewed the UI renewal diff, AGENTS.md, and the Vercel React Best Practices checklist. Verified suspected regressions in a fresh Chrome/Playwright context against localhost:3100 using the synthetic test account; no account/data/settings mutations were performed. The agent-browser executable was unavailable on PATH. Parent is concurrently editing, so the findings below record the code and browser state observed during this review.

## Scores (0–5; every dimension must reach 4)

| Dimension | Score | Reason |
| --- | ---: | --- |
| Robustness | 3.5 | Navigation highlight assumes fixed pixel row geometry; sticky navigation does not handle short viewports. |
| Accessibility | 3.5 | Offscreen navigation cannot be revealed by focus; dark switch state thumb has insufficient contrast. |
| Motion | 4.5 | Brief feedback, focus support, and reduced-motion overrides are appropriate; no action delay or scroll animation. |
| Scope discipline | 5 | Diff is presentation/copy only. No changed API, database, permission, consent, source, eligibility, or clinical logic found. |

**Gate: not yet passed.** All three actionable findings below need retest after fixes. These are reproduced defects, not aesthetic preferences.

## 1. P2 — Gliding navigation highlight loses alignment when text is enlarged

Location: `src/components/site/app-nav.tsx`, original `translateY(highlightIndex * 56)` span (around line 60 before the concurrent fix).

At /settings, 768×500 with root text size 24px, the navigation rows become 60px high and the rem-based gap becomes 18px. The highlight still moves 4×56px. Its screen top was 386px; Settings starts at 474px, an 88px mismatch. The highlight also remained 66px tall while the link was 60px tall. Default 16px text rows aligned.

Fix: measure the current/hovered link's actual `offsetTop` and `offsetHeight`, updating on resize and font/layout changes, rather than converting its index to a hard-coded pixel offset. A ResizeObserver-based fix is now appearing in the working tree and needs verification.

Evidence: `code-nav-textzoom.png`; browser geometry recorded during review.

## 2. P2 — Sticky desktop rail traps navigation below the viewport

Location: `src/app/globals.css:217`, `.app-rail { position: sticky; top: 0; height: 100dvh; }`; its use in `src/components/site/app-shell.tsx`.

At 800×300, Settings occupies y332–376. Scrolling the document to its end leaves Settings at y331.53–375.53. Focusing that link programmatically also leaves it outside the viewport. The rail has no internal scrolling and remains stuck to the viewport, making its lower controls impossible to see. Enlarged default text makes this affect taller viewports as well.

Fix: give the rail `overflow-y: auto`, keep its navigation and attribution from shrinking, and provide a minimum gap between them. Verify that Tab brings the focused lower link into the visible rail and that pointer users can scroll it.

Evidence: `code-nav-short.png` and the before/after/focused bounding rectangles above.

## 3. P2 — Dark-mode switch thumb loses contrast against its track

Location: `src/components/ui/switch.tsx:28`, `dark:bg-ink` on the thumb.

The rendered unchecked switch uses thumb #e8ede2 over pseudo-element track #a3b0a7: **1.89:1**. Checked-state CSS uses the same thumb over #7fb298: **2.02:1**. Thumb position conveys state, so this graphic should meet 3:1 against its adjacent track. The original checked thumb used the dark primary-foreground token and had sufficient contrast. The larger 56×44 target is an improvement but does not fix state visibility.

Fix: remove `dark:bg-ink` so `bg-paper` resolves to dark #101713, or explicitly use `dark:bg-paper`. Contrast becomes 8.08:1 unchecked and 7.56:1 checked. Preserve the Radix checked/unchecked semantics and existing keyboard behavior.

Evidence: `code-switch-dark.png`; inspected computed pseudo-element/child colors. Axe on this page reports zero violations because it does not assess this pseudo-element state contrast; manual measurement is required.

## Checks that passed / non-findings

- Provider cards retain country/availability filtering, actual checkout links, gating text, date, file formats, depth, turnaround, and compatibility source functions. Desktop uses a table; mobile uses semantic sections and definition lists, with inactive layout removed by CSS display.
- Mobile policy contents use native details/summary; disclosure semantics and keyboard support remain native. The existing summary target minimum remains active.
- Legal section text and artifact body/version/hash values remain unchanged.
- New global button wrapping keeps normal 44px minimums; icon buttons remain 44px targets in inspected signed-in chrome. The global focus outline survives the shadow removal.
- Reduced-motion CSS removes animations/transitions and the press/arrow motion. Navigation decoration is aria-hidden and pointer-events:none.
- New whole-card genome links preserve destinations and contain no nested interactive descendants.
- The transient global-search busy indicator changes presentation only; query/request/routing behavior is untouched.
- The SubjectBar selector mismatch seen during static review was fixed concurrently by the parent. Live bars measured 56px at desktop, tablet, 390px, and 320px; it is not an outstanding finding.
- About copy is corrected to the supported upload formats; this describes existing behavior rather than changing support.

No further scope, permission, content-integrity, or React hook regressions found in the reviewed diff.
