# G1.13b integrated accessibility verification

On 23 September 2026, [CI run 35834704734](https://github.com/themariodiego/Inherit.bio/actions/runs/35834704734), attempt 1, completed successfully at 09:01 UTC. The [checks job](https://github.com/themariodiego/Inherit.bio/actions/runs/35834704734/job/107095269548) tested merge `6ba93840fdbf570d055858e3da0ff1658cdadf15`, containing PR207 head `109089d143e2efd723f7461cf7e493eac45fb4ae` and main `3af31bf5945dc30e7ab069a5dfc54366f6a7897c`.

[The scoped receipt](verified-ci.json) records the full log's SHA-256, eight exact timestamped browser pass records, fourteen unit-file pass records and SHA-256 hashes for fifty reviewed source files. All fifty hashes were compared with the working tree at the tested head before this documentary reconciliation. The receipt preserves the pre-reconciliation accessibility ledger hash; only its historical status notes change here. [The reconciliation record](reconciliation.json) binds these evidence bytes and records the unchanged checks.

The full browser step passed 530 unique cases, with no skips or retries. Browser test discovery was not used as execution evidence. The four required measurements and four app journeys each have one terminal passing record in that full step:

| Required measurement | Exact executed case |
| --- | --- |
| Reflow | `reflow: no page scrolls horizontally at a 320 CSS px viewport` |
| Target size | `target size: every control is at least 44x44 CSS px at 390x844` |
| Keyboard traversal | `keyboard traversal: tab order is DOM order, and no page traps focus` |
| Text alternatives | `text alternatives: the ancestry map and every chart have an equivalent list and text` |
| Current native track | `the current track has an open source-matched text alternative after native position changes` |
| Track scrolling | `a synthetic overlapping-region response can be scrolled with the keyboard` |
| Menus and image actions | `genome track details and image actions work from the keyboard` |
| Settings and dialogs | `genome track settings preserve keyboard focus, apply edits and escape back into the page` |

The installed widget, composed-tree traversal, current-track identity and figure checks passed 78 tests across ten core files. Four adjacent lifecycle files passed 17 tests; these support the integration but are not counted as 17 extra accessibility assertions. The full unit step passed 5,844 tests across 359 files. The receipt also retains the full CI summary: 3,536 database assertions in 87 files, 30 transition-lock checks and nine Lighthouse audits. Those broader results do not replace the named accessibility measurements.

The reviewed widget work covers native settings/edit/cancel/color/reorder/display/remove controls, modal focus, context menus, image actions and scroll controls. The current native track's open text equivalent is tied to the displayed source and viewport; it does not rely on the separate search-results table. Its focused checks include pan/search/zoom/resize/multilocus/removal, unknown-feature handling and the 500-row boundary. The overlapping-region app case uses a synthetic UI response; it is not evidence of upload capacity. The owner's accepted in-page ancestry table remains the map's text equivalent.

The `reflow`, `targetSize` and `keyboardTraversal` ledger groups remain empty. The exact undersized-control occurrence ratchet remains zero. No route, viewport, control, threshold, exception, timeout or assertion changed for this reconciliation. All other acceptance verdicts and their historical prose are unchanged.

This evidence closes the automated measurements specified by [G1.13b](../../inherit-v2-brief.md). It does not establish a human assistive-technology study, new region fetching, density acceptance, hosted large-file capacity, hosted deployment, live inference or full release completion. G1.13a and G1.14 retain their separate evidence and verdicts.
