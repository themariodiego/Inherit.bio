# Genome controls inside shadow roots — 22 September 2026

The shared first-viewport control count queried only the main document. The
installed genome viewer places its controls in an open shadow root, so that
query omitted its search, zoom, track and menu controls. The ancestry suite
also carried a separate copy of the same query.

The counter now walks the composed tree already used by the keyboard audit.
It includes nested open shadow roots and assigned slots, without counting
slotted controls twice or counting unrendered light-DOM children. Navigation,
the skip link and the dock retain their existing exclusions. The selectors,
box checks, viewport boundary and twelve-control limit stay the same.
Accessible names improve failure messages. Ancestry uses the shared counter.

Five native Chromium cases cover the previously omitted controls, nested
roots and slots, navigation and dock ancestry, viewport boundaries, and a
thirteen-control fixture that the old counter incorrectly counted as two.
All five pass, along with the fourteen existing keyboard-audit cases.

A separate installed-library probe at 1280 by 844 pixels found fifteen
controls when the complete widget was placed between two test buttons;
the old document query saw only those two buttons. That probe is not the
registered app layout and does not certify its twelve-control budget. The
complete app sweeps must use the corrected counter and pass on this head.
No controls were moved, hidden or exempted to change that count.

This addresses the control-count helper only. The separate frozen pixel-area
measurement still needs a consistent baseline and candidate remeasurement
before any new density comparison. The density ceiling remains 0.6.
G1.13b stays NO while the remaining viewer and full-app evidence is unfinished.
