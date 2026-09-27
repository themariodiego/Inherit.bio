# Text for the native genome track · 22 September 2026

The search-results table and the native track have different inputs: a search
may combine files or show a reference-derived position, while the track reads
the selected file's bounded region. The search table therefore cannot serve as
the track's equivalent text view.

The track now has a light-DOM figure with a caption and a definition list for
each current native viewport. Each entry identifies its chromosome, position,
available rsID and alleles, then presents the recorded genotype through an
attributed `ClaimBlock`. The authorized subject identifier comes from the page.
No control or disclosure must be opened to reach this text. The search table
and its conflict/coverage rules remain unchanged.

The list reads the native inline feature source and applies the viewport's
intersection bounds. A `WeakMap` preserves the identity of the original rows,
including the originals behind whole-genome projections. Locus changes,
feature loads and track removal refresh the text. Older asynchronous reads
cannot overwrite a newer view; disposal unsubscribes and rejects late results.
An unknown native feature yields an unavailable state instead of an incomplete
list labelled as equivalent.

The page distinguishes the originally loaded range from the current view.
It states when the bounded API response may be truncated, when a view includes
positions for which calls were never loaded, when no loaded calls intersect,
and when the track is removed or its text cannot be read. Panning does not issue
new region requests. Fresh authorized region fetching, signed pagination and
nonce/CSRF work remain separate protocol requirements.

The full-route text-alternative audit now uses the composed shadow/slot tree.
It counts visible unnamed canvases, resolves ARIA references within their own
tree scope, and requires a nonzero count of actual genome canvases. It retains
the ancestry-map checks. Closed text disclosures are opened with the keyboard
and then audited again, so a list that stays hidden cannot pass merely because
its enclosing disclosure opened. Standalone Chromium regressions plant these
defects and verify that they are detected.

G1.13b remains **NO** pending the complete current full-app evidence. This
change does not alter the accessibility ledger, route/task ratchets, density
threshold, upload/preparation bounds or scientific interpretation. Local native
tests use the existing isolated patched IGV 3.8.5 install from the parent change;
the shared dependency install is unchanged. No local full app, hosted job or
production write is part of this verification.

Validation used pnpm 10.33.0. The new native, snapshot-ownership and figure
helper run passed 22 tests, and the audit's eight planted-defect regressions
passed. Native cases cover 320/390/1280 CSS pixels in both themes, initial
within-range and empty snapshots, all 500 loaded rows, exact popup identity,
pointer pan, keyboard zoom/search, resize, multi-locus and whole-genome views,
removal, stale completion, disposal and failed reads.

The combined run covered 103 cases in 15 suites: 102 passed and one existing
320-pixel keyboard case hit its unchanged five-second timeout while other local
checks ran. That test and its traversal/control adapters are byte-identical to
the branch base. The entire unchanged keyboard suite then passed 14/14 alone
with the same timeouts. The cause of the initial timeout is not established.
No assertion, timeout or test was relaxed or removed.

Changed-file lint, typecheck, the readability gate (2,705 blocks), the claims
gate and diff checks pass. Playwright discovers all 95 cases across the modified
genome-data and accessibility specs, including the added real-response identity
journey. Discovery does not establish an app pass; full-app CI is pending.

The first full CI run, 35752596544 at 25f7f029, passed 5,413 unit cases and
failed the new resize fixture. Its static text had been captured before the
native resize event completed, then compared with a later observer snapshot
(region end 74,750,600 versus 74,750,439). The installed native handler updates
the reference frames and viewport width before it emits the new locus. A prior
snapshot can still have `ready` status when `setViewportSize` returns.

The fixture now waits for the actual native viewport to shrink and for its
range to match the observer. It then checks both the rendered range and exact
row identities against native `getInViewFeatures()`. All 12 current-track
native cases pass with that correction. Product code and test timeouts are
unchanged. The earlier CI run did not reach its database, app build, browser or
Lighthouse steps; the corrected head still needs their full verification.
