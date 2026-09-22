# Genome context menus and details — 22 September 2026

The installed igv.js 3.8.5 viewer had pointer-only track-label activation,
small popover close controls, and a track context menu without keyboard
navigation. This follows the toolbar, track-settings and scrolling changes;
it does not close G1.13b.

`enhanceIgvPopovers` keeps the library's existing callbacks. Track labels
become named keyboard buttons with 44-pixel targets. Track viewports expose
Shift+F10 and the context-menu key; the same context-menu event reaches the
library. Its image actions support arrows, Home, End, Enter, Space, Tab and
Escape, with viewport clamping and focus restoration. PNG and SVG exports
still use the library's actual download callbacks.

Track details, feature popovers and library messages use native modal dialogs.
Their close or OK control is reachable, has a 44-pixel target, and closes with
Escape. Tab stays within the dialog. Removing or hiding a source popover
closes its wrapper and restores its opener. Cleanup restores adapter attributes
and supports reattachment. The 320-pixel dark-theme details state was also
visually inspected; its text and close control remain within the viewport.

Eight new native Chromium cases pass against the installed library and a
first-party chromosome-size reference. The main keyboard journey runs at
320, 390 and 1280 pixels in both themes, with zero findings across the full app axe tags, including WCAG 2.2 AA
and best practice,
44-pixel controls, no document overflow and normal closed-widget Tab order.
Additional cases exercise actual downloads, a pointer-opened feature popover,
repeated message dialogs and cleanup. All 49 targeted cases across the widget,
scrolling, keyboard and copy suites pass. The five new control-counter cases
also pass, for 54 distinct targeted cases across six suites. Five ordinary words are added to the
plain vocabulary; no readability threshold changes.

The added full-app browser journey starts from the existing synthetic uploaded
file, opens track details by keyboard, exports an SVG through the keyboard
menu and checks Escape back to the page. The inherited track-settings geometry
and menu-focus correction is included, with all existing assertions retained.
Full-app CI on this correction is still required.
No source file, server route, upload limit or scientific interpretation changes.

## Remaining evidence

Feature popovers can now be closed from the keyboard, but this does not prove
keyboard selection of every plotted feature. The in-page results table and
the wider plotted region need a complete equivalence audit. The shared
`firstViewportInteractives` helper now includes open shadow roots and slots;
its five new regressions pass. Full-app sweeps must pass with that corrected
count. This does not replace the separate pixel-area density measurement,
which still needs a consistent baseline and candidate remeasurement. No gap
is treated as an exemption.
The fixed density ceiling and every existing route/test ratchet stay intact.
The app's complete route sweeps must also pass before G1.13b can close.
