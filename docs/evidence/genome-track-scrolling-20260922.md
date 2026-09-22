# Genome track scrolling — 22 September 2026

The installed igv.js 3.8.5 viewer was probed with 40 overlapping synthetic
annotations in a 100-pixel track. Its vertical thumb measured 10 by 10 pixels
and exposed no role, name or keyboard behavior. Distinct non-overlapping
positions pack into one row in this viewer; their number alone does not create
a vertically scrollable track. This is a widget interaction fixture, not a DNA
file, source preparation result or large-file capacity measurement.

`enhanceIgvTrackScrolling` replaces that pointer-only thumb with a native
vertical range control. It uses the viewer's existing `scrollByPixels` callback,
reads its actual content bounds, and updates when the viewer moves or resizes.
The control is at least 44 pixels wide and spans the track height. Home, End,
arrow keys and pointer input reach the same positions. When the content fits,
the control disappears; focus returns to track settings if it was active.
Cleanup removes the adapter and restores the original thumb.

Seven installed-library Chromium cases pass: both endpoints, arrow movement,
pointer movement, external viewer updates, resizing and focus return. The main
journey runs at 320, 390 and 1280 pixels in both themes and requires zero WCAG
2.1 A/AA axe violations, normal tab order and no document overflow. The existing
32 widget, keyboard and copy cases remain intact; the additional plain word
`scroll` is registered without changing any readability threshold.

The new full-app browser case deliberately supplies an overlapping synthetic
region response after the ordinary signed-in setup. It asserts the native
control's endpoints, the actual canvas movement and Escape back to the page.
It proves UI wiring only and still requires CI execution. Existing upload,
preparation, report and region tests keep their real responses.

G1.13b remains NO. Canvas context menus and track-label popovers still need
their full interaction treatment and verification; the complete app sweeps
remain required. No server route, source data, interpretation, acceptance
threshold or production configuration changed.
