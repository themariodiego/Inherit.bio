# Genome track settings and keyboard controls — 22 September 2026

This change builds on the toolbar and composed-tree keyboard audit in PR 187.
It does not close G1.13b or change an acceptance, density or route threshold.

## Reproduced defects

The installed igv.js 3.8.5 widget rendered its track gears at 16 by 16 pixels,
without names, roles or keyboard activation. Track menus, color swatches and
track-order handles also lacked keyboard access. Its input dialog had no
accessible input name or focus containment; its OK and Cancel text failed
contrast against their backgrounds. These were reproduced with the actual
installed library, a first-party chromosome-size reference and an invented
single annotation. No account, database or genome upload was needed.

## Change

`enhanceIgvInteractions` adapts the library's existing controls and callbacks.
Track settings and reorder handles have names and 44-pixel targets. Arrow keys
reorder through the same library operations used by pointer dragging. Menus
support arrow navigation, Home, End, Enter, Space, Tab and Escape; their position
is clamped to the viewport and long menus scroll. Checked display modes retain
their state. Removing a track returns focus to the position search.

Existing settings dialogs are wrapped in native modal dialogs, with labels,
readable colors, focus containment and focus restoration. Escape first closes
the active menu or dialog; a subsequent Escape can leave the whole widget.
Track heights cannot undercut their 44-pixel controls. The library's existing
color text field is exposed beside its gradients as a keyboard alternative.
Custom colors still use the library's color parser and callback.

The event adapter requires a matching press and release on the same control.
This prevents two reproduced focus-transfer bugs: Enter opening and immediately
submitting an input dialog, and Enter confirming a color then reopening its
picker when focus returns to the More colors button.

## Verification and limits

The 32 targeted tests in `scripts/igv-interactions.test.ts`,
`scripts/keyboard-traversal.test.ts` and `src/copy/genome/data.test.ts` pass.
The new interaction suite runs native Chromium against the installed library.
It covers normal tab order, name/height changes, cancellation, focus restoration,
modal containment, palette and typed colors, track ordering, display modes,
reference menu controls and removal. The name/height journeys run at 320, 390
and 1280 CSS pixels in both themes, with zero WCAG 2.1 A/AA axe violations,
44-pixel control targets and no document overflow required.

The existing keyboard audit's positive and deliberately broken fixtures remain
unchanged. `e2e/genome-data.spec.ts` adds a real-app keyboard settings journey
after the existing synthetic upload and report preparation. That journey must
pass full CI; standalone widget tests are not evidence of an app pass.

Canvas context menus, track-label popovers and vertical track scrolling still
need a complete interaction inventory and equivalent keyboard verification.
Full route accessibility, density and network sweeps remain required. No
production deployment or genomic interpretation changed in this work.
